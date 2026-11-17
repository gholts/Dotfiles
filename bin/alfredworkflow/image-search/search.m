@import AppKit;
@import ImageIO;
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>

static NSString *const UserAgent = @"Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Safari/605.1.15";

static NSString *env(NSString *name, NSString *fallback) {
    NSString *value = NSProcessInfo.processInfo.environment[name];
    return value.length ? value : fallback;
}

static NSString *encode(NSString *value, NSString *safe) {
    NSString *characters = [@"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~" stringByAppendingString:safe];
    return [value stringByAddingPercentEncodingWithAllowedCharacters:[NSCharacterSet characterSetWithCharactersInString:characters]];
}

static NSString *json(id value) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value
        options:NSJSONWritingFragmentsAllowed | NSJSONWritingWithoutEscapingSlashes error:nil];
    return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

static void openURL(NSString *url) {
    [NSWorkspace.sharedWorkspace openURL:[NSURL URLWithString:url]];
}

static NSData *capture(void) {
    NSString *path = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSUUID.UUID.UUIDString stringByAppendingString:@".png"]];
    NSTask *task = [NSTask launchedTaskWithExecutableURL:[NSURL fileURLWithPath:@"/usr/sbin/screencapture"]
        arguments:@[@"-i", @"-x", path] error:nil terminationHandler:nil];
    [task waitUntilExit];
    NSData *data = [NSData dataWithContentsOfFile:path];
    [NSFileManager.defaultManager removeItemAtPath:path error:nil];
    return data.length ? data : nil;
}

static NSData *jpeg(NSData *image, NSInteger maxSide, NSInteger quality) {
    CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)image, NULL);
    if (!source) return nil;
    NSDictionary *options = @{
        (id)kCGImageSourceCreateThumbnailFromImageAlways: @YES,
        (id)kCGImageSourceCreateThumbnailWithTransform: @YES,
        (id)kCGImageSourceThumbnailMaxPixelSize: @(maxSide),
    };
    CGImageRef thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)options);
    CFRelease(source);
    if (!thumbnail) return nil;
    NSMutableData *data = [NSMutableData data];
    CGImageDestinationRef destination = CGImageDestinationCreateWithData((__bridge CFMutableDataRef)data, CFSTR("public.jpeg"), 1, NULL);
    CGImageDestinationAddImage(destination, thumbnail,
        (__bridge CFDictionaryRef)@{(id)kCGImageDestinationLossyCompressionQuality: @(quality / 100.0)});
    BOOL finished = CGImageDestinationFinalize(destination);
    CFRelease(destination);
    CGImageRelease(thumbnail);
    return finished ? data : nil;
}

static NSString *uploadYandex(NSData *image, int attempts) {
    NSString *file = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSUUID.UUID.UUIDString stringByAppendingString:@".jpg"]];
    if (![image writeToFile:file atomically:NO]) return nil;
    NSString *result;
    for (int attempt = 1; attempt <= attempts && !result; attempt++) {
        if (attempt > 1) sleep(1);
        NSTask *task = [NSTask new];
        task.executableURL = [NSURL fileURLWithPath:@"/usr/bin/curl"];
        task.arguments = @[@"-sS", @"--compressed", @"--connect-timeout", @"8", @"--max-time", @"25", @"-A", UserAgent,
            @"-H", @"Accept: application/json", @"-H", @"Expect:", @"-H", @"Referer: https://yandex.com/images/",
            @"-F", [@"upfile=@" stringByAppendingString:file], @"-w", @"\n%{http_code}",
            @"https://yandex.com/images/search?rpt=imageview&format=json&request=%7B%22blocks%22%3A%5B%7B%22block%22%3A%22b-page_type_search-by-image__link%22%7D%5D%7D"];
        NSPipe *output = NSPipe.pipe;
        task.standardOutput = output;
        if (![task launchAndReturnError:nil]) break;
        NSData *data = [output.fileHandleForReading readDataToEndOfFile];
        [task waitUntilExit];

        NSString *response = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"";
        NSRange split = [response rangeOfString:@"\n" options:NSBackwardsSearch];
        NSInteger status = split.location == NSNotFound ? 0 : [response substringFromIndex:NSMaxRange(split)].integerValue;
        if (task.terminationStatus) {
            fprintf(stderr, "Yandex upload attempt %d failed (curl %d).\n", attempt, task.terminationStatus);
            continue;
        }
        if (status / 100 != 2) {
            fprintf(stderr, "Yandex upload attempt %d failed (HTTP %ld).\n", attempt, (long)status);
            continue;
        }
        id payload = [NSJSONSerialization JSONObjectWithData:[[response substringToIndex:split.location]
            dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
        id blocks = [payload isKindOfClass:NSDictionary.class] ? payload[@"blocks"] : nil;
        id params = [blocks isKindOfClass:NSArray.class] && [blocks count] ? blocks[0][@"params"] : nil;
        NSString *cbir = [params isKindOfClass:NSDictionary.class] ? params[@"cbirId"] : nil;
        NSString *original = [params isKindOfClass:NSDictionary.class] ? params[@"originalImageUrl"] : nil;
        if ([cbir isKindOfClass:NSString.class] && cbir.length)
            result = [@"https://yandex.com/images/search?rpt=imageview&cbir_id=" stringByAppendingString:encode(cbir, @"/")];
        else if ([original isKindOfClass:NSString.class] && original.length)
            result = [@"https://yandex.com/images/search?rpt=imageview&url=" stringByAppendingString:encode(original, @"")];
        else
            fprintf(stderr, "Yandex upload attempt %d returned no result URL.\n", attempt);
    }
    [NSFileManager.defaultManager removeItemAtPath:file error:nil];
    return result;
}

static BOOL sendAll(int socket, NSData *data) {
    for (NSUInteger sent = 0; sent < data.length;) {
        ssize_t count = send(socket, (const char *)data.bytes + sent, data.length - sent, 0);
        if (count <= 0) return NO;
        sent += (NSUInteger)count;
    }
    return YES;
}

static BOOL openGoogleUpload(NSData *image) {
    NSString *document = [NSString stringWithFormat:@"<!doctype html>\n<meta charset=\"utf-8\">\n<title>Google Lens Upload</title>\n"
        "<p id=\"status\">Uploading to Google Lens…</p>\n"
        "<form id=\"upload\" method=\"post\" enctype=\"multipart/form-data\" action=\"https://lens.google.com/upload?ep=fcm\">\n"
        "  <input id=\"encoded_image\" type=\"file\" name=\"encoded_image\" hidden>\n</form>\n<script>\ntry {\n"
        "  const binary = atob(%@);\n"
        "  const bytes = new Uint8Array(binary.length);\n"
        "  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);\n"
        "  const transfer = new DataTransfer();\n"
        "  transfer.items.add(new File([bytes], \"image.jpg\", {type: \"image/jpeg\"}));\n"
        "  document.getElementById(\"encoded_image\").files = transfer.files;\n"
        "  document.getElementById(\"upload\").submit();\n"
        "} catch (error) {\n"
        "  document.getElementById(\"status\").textContent = \"Google Lens upload failed: \" + error;\n}\n</script>\n",
        json([image base64EncodedStringWithOptions:0])];
    NSData *page = [document dataUsingEncoding:NSUTF8StringEncoding];

    int server = socket(AF_INET, SOCK_STREAM, 0);
    struct sockaddr_in address = {.sin_len = sizeof address, .sin_family = AF_INET, .sin_addr.s_addr = htonl(INADDR_LOOPBACK)};
    socklen_t length = sizeof address;
    if (server < 0 || bind(server, (struct sockaddr *)&address, length) || listen(server, 4) ||
        getsockname(server, (struct sockaddr *)&address, &length)) {
        if (server >= 0) close(server);
        return NO;
    }

    uint8_t random[18];
    arc4random_buf(random, sizeof random);
    NSString *secret = [[[[NSData dataWithBytes:random length:sizeof random] base64EncodedStringWithOptions:0]
        stringByReplacingOccurrencesOfString:@"+" withString:@"-"] stringByReplacingOccurrencesOfString:@"/" withString:@"_"];
    NSString *path = [@"/" stringByAppendingString:secret];
    openURL([NSString stringWithFormat:@"http://127.0.0.1:%d%@", ntohs(address.sin_port), path]);

    BOOL served = NO;
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:20];
    while (!served && deadline.timeIntervalSinceNow > 0) {
        struct pollfd ready = {server, POLLIN, 0};
        if (poll(&ready, 1, (int)(deadline.timeIntervalSinceNow * 1000) + 1) <= 0) continue;
        int client = accept(server, NULL, NULL);
        if (client < 0) continue;
        int on = 1;
        struct timeval timeout = {5, 0};
        setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &on, sizeof on);
        setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof timeout);

        char buffer[4096];
        ssize_t count = recv(client, buffer, sizeof buffer, 0);
        NSString *request = count > 0 ? [[NSString alloc] initWithBytes:buffer length:(NSUInteger)count encoding:NSUTF8StringEncoding] : nil;
        NSArray *line = [[request componentsSeparatedByString:@"\r\n"].firstObject componentsSeparatedByString:@" "];
        BOOL match = line.count > 1 && [line[0] isEqual:@"GET"] && [line[1] isEqual:path];
        NSData *body = match ? page : [@"Not Found" dataUsingEncoding:NSUTF8StringEncoding];
        NSString *header = [NSString stringWithFormat:@"HTTP/1.1 %@\r\nContent-Type: %@\r\nContent-Length: %lu\r\n"
            "Cache-Control: no-store\r\nContent-Security-Policy: sandbox allow-forms allow-scripts\r\nConnection: close\r\n\r\n",
            match ? @"200 OK" : @"404 Not Found", match ? @"text/html; charset=utf-8" : @"text/plain", (unsigned long)body.length];
        NSMutableData *response = [[header dataUsingEncoding:NSUTF8StringEncoding] mutableCopy];
        [response appendData:body];
        served = sendAll(client, response) && match;
        close(client);
    }
    close(server);
    if (!served) fputs("Browser did not load Google Lens upload page.\n", stderr);
    return served;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSArray<NSString *> *arguments = NSProcessInfo.processInfo.arguments;
        NSString *service = arguments.count > 1 ? arguments[1] : @"";
        BOOL google = [service isEqual:@"google"];
        if (!google && ![service isEqual:@"yandex"]) {
            puts("Unknown image search service.");
            return 1;
        }
        NSString *name = google ? @"Google Lens" : @"Yandex Images";
        NSString *query = [[arguments.count > 2 ? arguments[2] : @"" stringByReplacingOccurrencesOfString:@"\r" withString:@""]
            componentsSeparatedByString:@"\n"].firstObject;

        if ([query hasPrefix:@"http://"] || [query hasPrefix:@"https://"]) {
            openURL([(google ? @"https://lens.google.com/upload?ep=fcm&url=" : @"https://yandex.com/images/search?rpt=imageview&url=")
                stringByAppendingString:encode(query, @"")]);
            printf("Opened %s URL search.\n", name.UTF8String);
            return 0;
        }

        NSData *original;
        if (!query.length) {
            original = capture();
            if (!original) {
                puts("Screenshot cancelled.");
                return 1;
            }
        } else {
            NSString *path = [query hasPrefix:@"file://"]
                ? [NSURL URLWithString:query].path ?: [query substringFromIndex:7].stringByRemovingPercentEncoding
                : query.stringByExpandingTildeInPath;
            BOOL directory = YES;
            if (path && [NSFileManager.defaultManager fileExistsAtPath:path isDirectory:&directory] && !directory)
                original = [NSData dataWithContentsOfFile:path];
        }

        NSString *prefix = google ? @"google" : @"yandex";
        NSData *image = original ? jpeg(original, env([prefix stringByAppendingString:@"_max_image_side"], google ? @"1280" : @"900").integerValue,
            env([prefix stringByAppendingString:@"_jpeg_quality"], google ? @"60" : @"45").integerValue) : nil;
        if (!image) {
            puts("Need image URL or local image path.");
            return 1;
        }

        if (google) {
            BOOL opened = openGoogleUpload(image);
            puts(opened ? "Opened Google Lens browser upload." : "Google Lens upload failed.");
            return opened ? 0 : 1;
        }

        NSString *result = uploadYandex(image, 2);
        if (!result) {
            fputs("Yandex retrying with a smaller image.\n", stderr);
            NSData *smaller = jpeg(original, env(@"yandex_fallback_max_image_side", @"640").integerValue,
                env(@"yandex_fallback_jpeg_quality", @"35").integerValue);
            result = smaller ? uploadYandex(smaller, 1) : nil;
        }
        if (!result) {
            puts("Yandex upload failed.");
            return 1;
        }
        openURL(result);
        puts("Opened Yandex Images results.");
    }
    return 0;
}
