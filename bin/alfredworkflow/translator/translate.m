@import Foundation;
@import NaturalLanguage;
#include <objc/message.h>

@interface Consent : NSObject
@end

@implementation Consent
- (void)needsUserInterventionForTextSession:(id)session configuration:(id)configuration completion:(void (^)(id, NSError *))completion {
    completion(configuration, nil);
}
@end

@protocol TextSessionConfiguration <NSObject>
@property (copy) NSLocale *sourceLocale;
@property (copy) NSLocale *targetLocale;
@end

@protocol TextSession <NSObject>
- (instancetype)initWithSourceLocale:(NSLocale *)source targetLocale:(NSLocale *)target;
- (instancetype)initWithConfiguration:(id<TextSessionConfiguration>)configuration;
- (void)setDelegate:(id)delegate;
- (void)setAllowOnlineTranslation:(BOOL)allow;
- (void)translateString:(NSString *)text completionHandler:(void (^)(id, NSError *))completion;
- (void)cancel;
- (void)cancel:(BOOL)hard;
@end

static id<TextSession> activeSession;

static void cancelOnTermination(void) {
    static dispatch_source_t sources[3];
    int signals[] = {SIGTERM, SIGINT, SIGHUP};
    for (int index = 0; index < 3; index++) {
        signal(signals[index], SIG_IGN);
        sources[index] = dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, (uintptr_t)signals[index], 0,
            dispatch_get_main_queue());
        dispatch_source_set_event_handler(sources[index], ^{
            if ([activeSession respondsToSelector:@selector(cancel:)])
                [activeSession cancel:YES];
            else if ([activeSession respondsToSelector:@selector(cancel)])
                [activeSession cancel];
            if (activeSession) usleep(50000);
            _exit(0);
        });
        dispatch_resume(sources[index]);
    }
}

static NSError *failure(NSString *message) {
    return [NSError errorWithDomain:@"Translator" code:0 userInfo:@{NSLocalizedDescriptionKey: message}];
}

static id translate(NSString *text, NSString *source, NSString *target, NSError **error) {
    Class sessionClass = NSClassFromString(@"_LTTextSession");
    NSLocale *from = source ? [NSLocale localeWithLocaleIdentifier:source] : nil;
    NSLocale *to = [NSLocale localeWithLocaleIdentifier:target];
    id<TextSession> session = nil;
    if ([sessionClass instancesRespondToSelector:@selector(initWithSourceLocale:targetLocale:)]) {
        session = [[sessionClass alloc] initWithSourceLocale:from targetLocale:to];
    } else if ([sessionClass instancesRespondToSelector:@selector(initWithConfiguration:)]) {
        id<TextSessionConfiguration> config = [NSClassFromString(@"_LTTextSessionConfiguration") new];
        if ([config respondsToSelector:@selector(setSourceLocale:)] && [config respondsToSelector:@selector(setTargetLocale:)]) {
            config.sourceLocale = from;
            config.targetLocale = to;
            session = [(id<TextSession>)[sessionClass alloc] initWithConfiguration:config];
        }
    }
    if (![session respondsToSelector:@selector(setDelegate:)] || ![session respondsToSelector:@selector(setAllowOnlineTranslation:)] ||
        ![session respondsToSelector:@selector(translateString:completionHandler:)]) {
        *error = failure(@"macOS system translation is unavailable on this Mac.");
        return nil;
    }
    Consent *consent __attribute__((objc_precise_lifetime)) = [Consent new];
    [session setDelegate:consent];
    [session setAllowOnlineTranslation:YES];
    dispatch_sync(dispatch_get_main_queue(), ^{ activeSession = session; });

    __block id result;
    __block NSError *translationError;
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    [session translateString:text completionHandler:^(id value, NSError *valueError) {
        result = value;
        translationError = valueError;
        dispatch_semaphore_signal(done);
    }];
    if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC))) {
        *error = failure(@"Translation timed out.");
        return nil;
    }
    *error = translationError;
    return translationError ? nil : result;
}

static NSString *detect(NSString *text) {
    NSDictionary<NLLanguage, NSString *> *locales = @{
        NLLanguageArabic: @"ar_AE", NLLanguageSimplifiedChinese: @"zh_CN", NLLanguageTraditionalChinese: @"zh_TW",
        NLLanguageDutch: @"nl_NL", NLLanguageEnglish: @"en_US", NLLanguageFrench: @"fr_FR", NLLanguageGerman: @"de_DE",
        NLLanguageHindi: @"hi_IN", NLLanguageIndonesian: @"id_ID", NLLanguageItalian: @"it_IT", NLLanguageJapanese: @"ja_JP",
        NLLanguageKorean: @"ko_KR", NLLanguagePolish: @"pl_PL", NLLanguagePortuguese: @"pt_BR", NLLanguageRussian: @"ru_RU",
        NLLanguageSpanish: @"es_ES", NLLanguageThai: @"th_TH", NLLanguageTurkish: @"tr_TR", NLLanguageUkrainian: @"uk_UA",
        NLLanguageVietnamese: @"vi_VN",
    };
    NLLanguageRecognizer *recognizer = [NLLanguageRecognizer new];
    recognizer.languageConstraints = locales.allKeys;
    [recognizer processString:text];
    return recognizer.dominantLanguage ? locales[recognizer.dominantLanguage] : nil;
}

static NSArray<NSString *> *supportedLocales(void) {
    Class translator = NSClassFromString(@"_LTTranslator");
    SEL selector = NSSelectorFromString(@"availableLocalePairsForTask:useDedicatedMachPort:completion:");
    if (![translator respondsToSelector:selector]) return @[];
    NSMutableSet *locales = [NSMutableSet set];
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    ((void (*)(Class, SEL, long, BOOL, id))objc_msgSend)(translator, selector, 0, YES, ^(NSArray *pairs, NSError *error) {
        for (id pair in pairs) {
            [locales addObject:[[pair valueForKey:@"sourceLocale"] localeIdentifier]];
            [locales addObject:[[pair valueForKey:@"targetLocale"] localeIdentifier]];
        }
        dispatch_semaphore_signal(done);
    });
    if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC))) return @[];
    return [locales.allObjects sortedArrayUsingSelector:@selector(compare:)];
}

static NSString *language(NSString *locale) {
    return [locale componentsSeparatedByString:@"_"].firstObject;
}

static NSString *resolve(NSString *keyword, NSArray<NSString *> *locales) {
    NSString *compact = [[keyword.lowercaseString stringByReplacingOccurrencesOfString:@"-" withString:@""]
        stringByReplacingOccurrencesOfString:@"_" withString:@""];
    if (compact.length != 2 && compact.length != 4) return nil;
    NSString *code = [compact substringToIndex:2];
    NSString *region = compact.length == 4 ? [compact substringFromIndex:2].uppercaseString : nil;
    NSArray *candidates = [locales filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSString *locale, NSDictionary *bindings) {
        return [language(locale) isEqual:code];
    }]];
    if (region) return [candidates containsObject:[NSString stringWithFormat:@"%@_%@", code, region]] ? [NSString stringWithFormat:@"%@_%@", code, region] : nil;
    for (NSString *preferred in NSLocale.preferredLanguages) {
        NSLocale *locale = [NSLocale localeWithLocaleIdentifier:preferred];
        NSString *match = [NSString stringWithFormat:@"%@_%@", code, locale.countryCode];
        if ([locale.languageCode isEqual:code] && [candidates containsObject:match]) return match;
    }
    for (NSString *fallback in @[[NSString stringWithFormat:@"%@_%@", code, code.uppercaseString], @"en_US"])
        if ([candidates containsObject:fallback]) return fallback;
    return candidates.firstObject;
}

static NSArray<NSString *> *languageKeywords(void) {
    NSDictionary *info = [NSDictionary dictionaryWithContentsOfFile:@"info.plist"];
    for (NSDictionary *object in info[@"objects"]) {
        NSDictionary *config = object[@"config"];
        if (![config[@"script"] containsString:@"alfred_workflow_keyword"]) continue;
        return [config[@"keyword"] componentsSeparatedByString:@"||"];
    }
    return @[@"en"];
}

static NSString *unsupportedLanguage(NSString *text, NSSet<NSString *> *supported) {
    NLLanguageRecognizer *recognizer = [NLLanguageRecognizer new];
    [recognizer processString:text];
    NSDictionary<NLLanguage, NSNumber *> *hypotheses = [recognizer languageHypothesesWithMaximum:1];
    NSString *code = [hypotheses.allKeys.firstObject componentsSeparatedByString:@"-"].firstObject;
    if (!code || hypotheses.allValues.firstObject.doubleValue < 0.8 || !supported.count || [supported containsObject:code]) return nil;
    return [NSLocale.currentLocale localizedStringForLanguageCode:code] ?: code;
}

static NSString *name(NSString *identifier) {
    NSString *localized = [NSLocale.currentLocale localizedStringForLocaleIdentifier:identifier];
    return localized.length ? localized : identifier;
}

static BOOL unsupportedPair(NSError *error) {
    return [error.domain isEqual:@"TranslationErrorDomain"] && error.code == 11;
}

static void output(NSDictionary *item) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"items": @[item]} options:NSJSONWritingWithoutEscapingSlashes error:nil];
    puts([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
}

static int run(void) {
    @autoreleasepool {
        [[NSBundle bundleWithPath:@"/System/Library/Frameworks/Translation.framework"] load];
        NSArray<NSString *> *arguments = NSProcessInfo.processInfo.arguments;
        NSString *keyword = arguments.count > 1 ? arguments[1] : @"";
        NSString *text = [arguments.count > 2 ? arguments[2] : @"" stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
        BOOL automatic = [keyword isEqual:@"auto"];

        NSArray<NSString *> *locales = supportedLocales();
        NSMutableArray<NSString *> *targets = [NSMutableArray array];
        for (NSString *candidate in automatic ? languageKeywords() : @[keyword]) {
            NSString *locale = resolve([candidate stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet], locales);
            if (locale && ![targets containsObject:locale]) [targets addObject:locale];
        }
        if (!targets.count) {
            output(@{@"title": locales.count ? [NSString stringWithFormat:@"“%@” isn't a supported language", keyword]
                                             : @"macOS system translation is unavailable", @"valid": @NO});
            return 0;
        }
        NSString *target = targets.firstObject;

        if (!text.length) {
            output(@{@"title": automatic ? @"Translate" : [@"Translate to " stringByAppendingString:name(target)],
                     @"subtitle": @"Type text to translate", @"valid": @NO});
            return 0;
        }

        if ([text rangeOfCharacterFromSet:NSCharacterSet.letterCharacterSet].location == NSNotFound) {
            output(@{@"title": @"Nothing to translate", @"subtitle": text, @"valid": @NO});
            return 0;
        }

        NSError *error;
        NSString *message;
        id result = translate(text, nil, target, &error);
        if (unsupportedPair(error)) {
            NSMutableSet *supported = [NSMutableSet set];
            for (NSString *locale in locales) [supported addObject:language(locale)];
            NSString *unsupported = unsupportedLanguage(text, supported);
            NSString *source = detect(text);
            for (NSString *candidate in targets) {
                if (![language(candidate) isEqual:language(source)]) {
                    target = candidate;
                    break;
                }
            }
            if (unsupported)
                message = [unsupported stringByAppendingString:@" isn't supported"];
            else if (!source || [language(source) isEqual:language(target)])
                message = [@"Already in " stringByAppendingString:name(target)];
            else
                result = translate(text, source, target, &error);
        }

        if (!result) {
            message = message ?: error.localizedFailureReason ?: error.localizedDescription ?: @"Translation failed.";
            output(@{@"title": message, @"subtitle": text, @"valid": @NO});
            return 0;
        }

        NSString *translation = [result valueForKey:@"targetText"] ?: @"";
        if (![text containsString:@"\n\n"])
            translation = [translation stringByReplacingOccurrencesOfString:@"\n{2,}" withString:@"\n" options:NSRegularExpressionSearch range:NSMakeRange(0, translation.length)];
        NSArray *words = [[translation componentsSeparatedByCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet]
            filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"length > 0"]];
        id pair = [result valueForKey:@"localePair"];
        output(@{
            @"title": [words componentsJoinedByString:@" "],
            @"subtitle": [NSString stringWithFormat:@"%@ → %@", name([[pair valueForKey:@"sourceLocale"] localeIdentifier]),
                name([[pair valueForKey:@"targetLocale"] localeIdentifier])],
            @"arg": translation,
            @"text": @{@"copy": translation, @"largetype": translation},
            @"mods": @{@"cmd": @{@"arg": translation, @"subtitle": @"Paste to frontmost app"}},
        });
    }
    return 0;
}

int main(void) {
    cancelOnTermination();
    // macOS 27 delivers translation service work on the main queue.
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{ exit(run()); });
    dispatch_main();
}
