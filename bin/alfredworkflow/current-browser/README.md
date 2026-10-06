# Current Browser

Alfred searches, pasted web links, and workflow actions using the default browser → active browser. When a non-browser app is active → saved default browser.

## Install

1. Import `Current Browser.alfredworkflow`.
2. Run `cbsetup` in Alfred.
3. In System Settings → Desktop & Dock → Default web browser, choose **Current Browser**.

Continue using normal Alfred keywords and links. No prefix needed. Setup saves the existing HTTP and HTTPS handlers separately. A small background helper remembers the app active before Alfred opens and starts at login. Switching to a non-browser clears browser context. No Accessibility or Screen Recording permission needed.

## Scope and compatibility

An Alfred workflow cannot intercept URLs opened by other commands. This workflow installs a URL handler, so **default-browser links from other apps also use this routing**. The system default becomes Current Browser; your former default is the fallback. To change fallback, select a regular default browser, run `cbsetup` again, then select Current Browser again.

Explicit browser targets bypass routing. Browser Selector's `browser`, `Safari`, `Firefox`, and configured browser keywords continue to open the browser you select. Browser Selector explicitly excludes the helper by bundle identifier. This workflow uses only `cbsetup` and `cbremove` and does not modify Browser Selector or Alfred search settings. Workflows hardcoding a browser likewise keep that browser. Non-HTTP(S) schemes keep their existing handlers.

Browser detection requires HTTP, HTTPS, and HTML support in the app manifest. Routing chooses the browser application; that browser controls profiles, windows, and tabs. When the helper has just restarted while Alfred is already active, prior context is unavailable and fallback is used.

## Remove

Choose your regular browser as system default, then run `cbremove`. Finally remove the Alfred workflow. Removing only the workflow does not remove the installed helper.

## Build

Run `./build` with Xcode Command Line Tools installed. Produces `/tmp/Current Browser.alfredworkflow`, containing an ad-hoc signed universal binary for Apple silicon and Intel, macOS 12+.

Alfred documents its default-browser behavior in [Open URL](https://www.alfredapp.com/help/workflows/actions/open-url/). The helper uses Apple's [application:openURLs:](https://developer.apple.com/documentation/appkit/nsapplicationdelegate/application(_:open:)) and workspace application activation notifications.
