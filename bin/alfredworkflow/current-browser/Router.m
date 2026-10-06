#import <AppKit/AppKit.h>

static NSString *const RouterID = @"com.gholts.current-browser.router";

static BOOL isBrowser(NSURL *appURL) {
    if (!appURL) return NO;
    NSBundle *bundle = [NSBundle bundleWithURL:appURL];
    if (!bundle || [bundle.bundleIdentifier isEqual:RouterID]) return NO;
    NSMutableSet *schemes = [NSMutableSet set];
    for (NSDictionary *type in [bundle objectForInfoDictionaryKey:@"CFBundleURLTypes"])
        [schemes addObjectsFromArray:type[@"CFBundleURLSchemes"] ?: @[]];
    if (![schemes containsObject:@"http"] || ![schemes containsObject:@"https"]) return NO;
    for (NSDictionary *type in [bundle objectForInfoDictionaryKey:@"CFBundleDocumentTypes"]) {
        for (NSString *key in @[@"LSItemContentTypes", @"CFBundleTypeExtensions", @"CFBundleTypeMIMETypes"])
            for (NSString *value in type[key])
                if ([@[@"public.html", @"public.xhtml", @"html", @"htm", @"text/html"] containsObject:value]) return YES;
    }
    return NO;
}

@interface Router : NSObject <NSApplicationDelegate>
@property NSURL *context;
@end

@implementation Router
- (void)remember:(NSRunningApplication *)app {
    NSString *identifier = app.bundleIdentifier;
    if (!app || [identifier isEqual:RouterID] || [identifier isEqual:@"com.runningwithcrayons.Alfred"]) return;
    // Non-browser activations clear the browser context, rather than retaining a stale browser.
    self.context = app.bundleURL;
}
- (void)applicationWillFinishLaunching:(NSNotification *)notification {
    [self remember:NSWorkspace.sharedWorkspace.frontmostApplication];
    [NSWorkspace.sharedWorkspace.notificationCenter addObserver:self selector:@selector(activated:)
        name:NSWorkspaceDidActivateApplicationNotification object:nil];
}
- (void)activated:(NSNotification *)notification {
    [self remember:notification.userInfo[NSWorkspaceApplicationKey]];
}
- (NSURL *)fallback:(NSString *)scheme {
    NSURL *current = [NSWorkspace.sharedWorkspace URLForApplicationToOpenURL:[NSURL URLWithString:[scheme stringByAppendingString:@"://example.com"]]];
    if (current && ![[NSBundle bundleWithURL:current].bundleIdentifier isEqual:RouterID]) return current;
    NSString *identifier = [NSUserDefaults.standardUserDefaults stringForKey:[@"fallback." stringByAppendingString:scheme]];
    return identifier ? [NSWorkspace.sharedWorkspace URLForApplicationWithBundleIdentifier:identifier] : nil;
}
- (void)open:(NSURL *)url target:(NSURL *)target retry:(BOOL)retry {
    if (!target || [[NSBundle bundleWithURL:target].bundleIdentifier isEqual:RouterID]) {
        NSAlert *alert = [NSAlert new];
        alert.messageText = @"Current Browser needs a fallback browser";
        alert.informativeText = @"Choose a regular default browser in System Settings, then run cbsetup again.";
        [alert runModal];
        return;
    }
    [NSWorkspace.sharedWorkspace openURLs:@[url] withApplicationAtURL:target
        configuration:NSWorkspaceOpenConfiguration.configuration completionHandler:^(NSRunningApplication *app, NSError *error) {
        if (error) dispatch_async(dispatch_get_main_queue(), ^{
            NSURL *fallback = [self fallback:url.scheme];
            if (retry && fallback && ![fallback isEqual:target]) [self open:url target:fallback retry:NO];
            else {
                NSAlert *alert = [NSAlert new];
                alert.messageText = @"Could not open link";
                alert.informativeText = error.localizedDescription;
                [alert runModal];
            }
        });
    }];
}
- (void)application:(NSApplication *)application openURLs:(NSArray<NSURL *> *)urls {
    [self remember:NSWorkspace.sharedWorkspace.frontmostApplication];
    NSURL *context = self.context;
    for (NSURL *url in urls) {
        if (![@[@"http", @"https"] containsObject:url.scheme.lowercaseString]) continue;
        [self open:url target:isBrowser(context) ? context : [self fallback:url.scheme] retry:YES];
    }
}
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc > 1 && strcmp(argv[1], "--save-defaults") == 0) {
            for (NSString *scheme in @[@"http", @"https"]) {
                NSURL *app = [NSWorkspace.sharedWorkspace URLForApplicationToOpenURL:[NSURL URLWithString:[scheme stringByAppendingString:@"://example.com"]]];
                NSString *identifier = [NSBundle bundleWithURL:app].bundleIdentifier;
                NSString *key = [@"fallback." stringByAppendingString:scheme];
                if (identifier && ![identifier isEqual:RouterID]) [NSUserDefaults.standardUserDefaults setObject:identifier forKey:key];
                if (![NSUserDefaults.standardUserDefaults stringForKey:key]) return 1;
            }
            [NSUserDefaults.standardUserDefaults synchronize];
            return 0;
        }
        if (argc > 1 && strcmp(argv[1], "--inspect") == 0) {
            NSURL *context = NSWorkspace.sharedWorkspace.frontmostApplication.bundleURL;
            Router *router = [Router new];
            NSDictionary *result = @{@"activeApp": context.path ?: @"", @"activeIsBrowser": @(isBrowser(context)),
                @"fallback": [router fallback:@"https"].path ?: @""};
            NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
            puts([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
            return 0;
        }
        NSApplication *app = NSApplication.sharedApplication;
        Router *delegate = [Router new];
        app.delegate = delegate;
        [app run];
    }
    return 0;
}
