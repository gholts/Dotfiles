// Based on Raycast IP Geolocation, Copyright (c) 2021 Raycast, MIT License. See NOTICE.

@import Foundation;
#include <arpa/inet.h>
#include <ifaddrs.h>
#include <net/if.h>
#include <netdb.h>

static NSString *env(NSString *name, NSString *fallback) {
    NSString *value = NSProcessInfo.processInfo.environment[name];
    return value.length ? value : fallback;
}

static NSString *string(id value) {
    if ([value isKindOfClass:NSNumber.class]) return [NSString stringWithFormat:@"%.15g", [value doubleValue]];
    return value && value != NSNull.null ? [value description] : @"";
}

static NSString *jsonString(id value, NSJSONWritingOptions options) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value
        options:options | NSJSONWritingFragmentsAllowed | NSJSONWritingWithoutEscapingSlashes error:nil];
    return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

static NSString *encode(NSString *value) {
    NSCharacterSet *allowed = [NSCharacterSet characterSetWithCharactersInString:
        @"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"];
    return [value stringByAddingPercentEncodingWithAllowedCharacters:allowed];
}

static NSString *cachePath(NSString *key) {
    NSString *directory = env(@"alfred_workflow_cache",
        [NSTemporaryDirectory() stringByAppendingPathComponent:@"ip-geolocation-alfred"]);
    [NSFileManager.defaultManager createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:nil error:nil];
    return [[directory stringByAppendingPathComponent:key] stringByAppendingPathExtension:@"json"];
}

static NSDictionary *cacheGet(NSString *key, NSTimeInterval ttl) {
    NSString *path = cachePath(key);
    NSDate *modified = [NSFileManager.defaultManager attributesOfItemAtPath:path error:nil].fileModificationDate;
    if (!modified || -modified.timeIntervalSinceNow > ttl) return nil;
    NSData *data = [NSData dataWithContentsOfFile:path];
    id value = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
    return [value isKindOfClass:NSDictionary.class] ? value : nil;
}

static void cacheSet(NSString *key, NSDictionary *value) {
    [[NSJSONSerialization dataWithJSONObject:value options:0 error:nil] writeToFile:cachePath(key) atomically:YES];
}

static NSData *fetch(NSString *address, NSTimeInterval timeout) {
    NSURL *url = [NSURL URLWithString:address];
    if (!url) return nil;
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url
        cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:timeout];
    [request setValue:@"IP-Geolocation-Alfred/1.0" forHTTPHeaderField:@"User-Agent"];
    __block NSData *result;
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    [[NSURLSession.sharedSession dataTaskWithRequest:request
        completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        if (!error && ((NSHTTPURLResponse *)response).statusCode / 100 == 2) result = data;
        dispatch_semaphore_signal(done);
    }] resume];
    dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
    return result;
}

static BOOL showIPv6(void) {
    return [@[@"1", @"true", @"yes"] containsObject:env(@"show_ipv6", @"0").lowercaseString];
}

static NSString *publicIP(int version) {
    NSString *key = [NSString stringWithFormat:@"public-ipv%d", version];
    NSString *cached = string(cacheGet(key, 3600)[@"ip"]);
    if (cached.length) return cached;
    NSData *data = fetch(version == 4 ? @"https://api.ipify.org" : @"https://api6.ipify.org", 5);
    NSString *ip = data ? [[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]
        stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet] : @"";
    if (ip.length) cacheSet(key, @{@"ip": ip});
    return ip ?: @"";
}

static NSString *localIP(int family) {
    struct ifaddrs *list;
    if (getifaddrs(&list) != 0) return @"";
    NSString *global = @"", *linkLocal = @"";
    for (struct ifaddrs *entry = list; entry && !global.length; entry = entry->ifa_next) {
        if (!entry->ifa_addr || entry->ifa_addr->sa_family != family) continue;
        if (!(entry->ifa_flags & IFF_UP) || (entry->ifa_flags & IFF_LOOPBACK)) continue;
        char host[NI_MAXHOST];
        if (getnameinfo(entry->ifa_addr, entry->ifa_addr->sa_len, host, sizeof host, NULL, 0, NI_NUMERICHOST)) continue;
        NSString *ip = [@(host) componentsSeparatedByString:@"%"].firstObject;
        BOOL local = family == AF_INET ? [ip hasPrefix:@"169.254."] : [ip.lowercaseString hasPrefix:@"fe80:"];
        if (!local) global = ip;
        else if (!linkLocal.length && family == AF_INET6) linkLocal = ip;
    }
    freeifaddrs(list);
    return global.length ? global : linkLocal;
}

static NSString *normalizeTarget(NSString *raw) {
    NSString *query = [raw stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (![query containsString:@"."] && ![query containsString:@":"]) return @"";
    NSRange scheme = [query rangeOfString:@"://"];
    if ([query hasPrefix:@"http://"] || [query hasPrefix:@"https://"]) query = [query substringFromIndex:NSMaxRange(scheme)];
    query = [query componentsSeparatedByCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@"/?#"]].firstObject;
    query = [query componentsSeparatedByString:@"@"].lastObject;

    NSUInteger colons = [query componentsSeparatedByString:@":"].count - 1;
    if ([query hasPrefix:@"["] && [query containsString:@"]"]) {
        query = [query substringWithRange:NSMakeRange(1, [query rangeOfString:@"]"].location - 1)];
        colons = [query componentsSeparatedByString:@":"].count - 1;
    } else if (colons == 1 && [query containsString:@"."]) {
        query = [query componentsSeparatedByString:@":"].firstObject;
        colons = 0;
    }

    BOOL numeric = [query rangeOfCharacterFromSet:
        [NSCharacterSet characterSetWithCharactersInString:@"0123456789."].invertedSet].location == NSNotFound;
    unsigned char buffer[sizeof(struct in6_addr)];
    if (numeric && [query componentsSeparatedByString:@"."].count == 4 && inet_pton(AF_INET, query.UTF8String, buffer) != 1) return @"";
    if (colons >= 2 && inet_pton(AF_INET6, query.UTF8String, buffer) != 1) return @"";
    return query;
}

static NSDictionary *geolocation(NSString *target) {
    if (!target.length) return nil;
    NSString *language = env(@"language", @"en");
    NSString *identity = [NSString stringWithFormat:@"%@-%@-%@", target, language, env(@"coordinates_format", @"latLon")];
    NSRegularExpression *unsafe = [NSRegularExpression regularExpressionWithPattern:@"[^A-Za-z0-9_.-]" options:0 error:nil];
    NSString *key = [@"geo-" stringByAppendingString:[unsafe stringByReplacingMatchesInString:identity
        options:0 range:NSMakeRange(0, identity.length) withTemplate:@"_"]];
    NSDictionary *cached = cacheGet(key, 300);
    if (cached) return cached;

    NSData *data = fetch([NSString stringWithFormat:@"http://ip-api.com/json/%@?lang=%@&fields=585727",
        encode(target), encode(language)], 6);
    id value = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
    if (![value isKindOfClass:NSDictionary.class] || ![value[@"status"] isEqual:@"success"]) return nil;
    cacheSet(key, value);
    return value;
}

static NSArray<NSArray<NSString *> *> *geolocationRows(NSDictionary *data, BOOL includeIP) {
    NSMutableArray *parts = [NSMutableArray array];
    for (NSString *field in @[@"country", @"regionName", @"city", @"district"])
        if (string(data[field]).length) [parts addObject:string(data[field])];
    NSString *location = [parts componentsJoinedByString:@", "];
    NSString *zip = string(data[@"zip"]);
    if (zip.length) location = location.length ? [location stringByAppendingFormat:@", ZIP: %@", zip] : [@"ZIP: " stringByAppendingString:zip];

    NSString *lat = string(data[@"lat"]), *lon = string(data[@"lon"]);
    BOOL lonLat = [env(@"coordinates_format", @"latLon") isEqual:@"lonLat"];
    NSString *coordinates = lat.length ? [NSString stringWithFormat:@"%@ , %@", lonLat ? lon : lat, lonLat ? lat : lon] : @"";

    NSArray *rows = @[
        @[@"IP", includeIP ? string(data[@"query"]) : @""],
        @[@"Location", location],
        @[@"GeoCoordinates", coordinates],
        @[@"Timezone", string(data[@"timezone"])],
        @[@"AS", [string(data[@"as"]) componentsSeparatedByString:@" "].firstObject],
        @[@"ISP", string(data[@"isp"])],
        @[@"Organization", string(data[@"org"])],
    ];
    return [rows filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"self[1].length > 0"]];
}

static NSDictionary *item(NSString *title, NSString *subtitle, NSString *arg, BOOL valid, NSString *icon, NSString *all, NSString *uid) {
    NSMutableDictionary *item = [@{
        @"title": title, @"subtitle": subtitle ?: @"", @"arg": arg ?: @"", @"valid": @(valid),
        @"text": @{@"copy": arg ?: @"", @"largetype": arg ?: @""}, @"icon": @{@"path": icon},
    } mutableCopy];
    if (uid) item[@"uid"] = uid;
    if (all) item[@"mods"] = @{@"cmd": @{@"valid": @YES, @"arg": all, @"subtitle": @"Copy all info"}};
    return item;
}

static NSArray *itemsFromRows(NSArray<NSArray<NSString *> *> *rows, NSString *icon) {
    NSMutableArray *lines = [NSMutableArray array];
    for (NSArray *row in rows) [lines addObject:[NSString stringWithFormat:@"  %@: %@", jsonString(row[0], 0), jsonString(row[1], 0)]];
    NSString *all = [NSString stringWithFormat:@"{\n%@\n}", [lines componentsJoinedByString:@",\n"]];
    NSMutableArray *items = [NSMutableArray array];
    for (NSArray *row in rows) [items addObject:item(row[0], row[1], row[1], YES, icon, all, row[0])];
    return items;
}

static NSArray *queryItems(NSString *query) {
    NSString *icon = @"query-ip-geolocation.png";
    NSString *target = normalizeTarget(query);
    if (![query stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet].length) return @[item(@"IP Geolocation", @"Type IP address or domain", nil, NO, icon, nil, nil)];
    if (!target.length) return @[item(@"Invalid Query", @"Enter valid IP address or domain", nil, NO, icon, nil, nil)];
    NSDictionary *data = geolocation(target);
    if (!data) return @[item(@"No Geolocation Info", target, nil, NO, icon, nil, nil)];
    return itemsFromRows(geolocationRows(data, YES), icon);
}

static NSArray *myItems(void) {
    NSString *icon = @"my-ip-geolocation.png";
    BOOL ipv6 = showIPv6();
    NSString *public4 = publicIP(4);
    NSMutableArray *rows = [NSMutableArray arrayWithObject:@[@"Local IPv4", localIP(AF_INET)]];
    if (ipv6) [rows addObject:@[@"Local IPv6", localIP(AF_INET6)]];
    [rows addObject:@[@"Public IPv4", public4]];
    if (ipv6) [rows addObject:@[@"Public IPv6", publicIP(6)]];
    NSDictionary *data = geolocation(public4);
    if (data) [rows addObjectsFromArray:geolocationRows(data, NO)];
    [rows filterUsingPredicate:[NSPredicate predicateWithFormat:@"self[1].length > 0"]];
    return rows.count ? itemsFromRows(rows, icon) : @[item(@"No Geolocation Info", nil, nil, NO, icon, nil, nil)];
}

static NSArray *copyItems(NSString *query) {
    NSString *icon = @"copy-ip.png";
    NSString *needle = [query stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet].lowercaseString;
    BOOL byLabel = NO;
    for (NSString *token in @[@"local", @"public", @"ipv4", @"ipv6"]) byLabel |= [needle containsString:token];
    NSArray *candidates = @[
        @[@"Local IPv4", ^{ return localIP(AF_INET); }],
        @[@"Public IPv4", ^{ return publicIP(4); }],
        @[@"Local IPv6", ^{ return localIP(AF_INET6); }],
        @[@"Public IPv6", ^{ return publicIP(6); }],
    ];
    NSMutableArray *items = [NSMutableArray array];
    for (NSArray *candidate in candidates) {
        NSString *title = candidate[0];
        if (byLabel && ![title.lowercaseString containsString:needle]) continue;
        NSString *ip = ((NSString *(^)(void))candidate[1])();
        if (!ip.length) continue;
        if (needle.length && ![[NSString stringWithFormat:@"%@ %@", title, ip].lowercaseString containsString:needle]) continue;
        [items addObject:item(title, ip, ip, YES, icon, nil, title)];
    }
    return items.count ? items : @[item(@"No IP Found", @"Try local, public, ipv4, or ipv6", nil, NO, icon, nil, nil)];
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSArray<NSString *> *arguments = NSProcessInfo.processInfo.arguments;
        NSString *mode = arguments.count > 1 ? arguments[1] : @"";
        NSString *query = arguments.count > 2 ? arguments[2] : @"";
        NSArray *items = [mode isEqual:@"my"] ? myItems() : [mode isEqual:@"copy"] ? copyItems(query) : queryItems(query);
        puts(jsonString(@{@"items": items}, 0).UTF8String);
    }
    return 0;
}
