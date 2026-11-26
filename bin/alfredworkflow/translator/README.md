# Translator

Alfred workflow that translates with the built-in macOS translation service and shows the result right in Alfred. No API keys or Shortcuts needed.

## Languages are keywords

Each keyword of the first Script Filter is a target language. The default is `en||zhtw`:

- `en <text>`: translate to English (US).
- `zhtw <text>`: translate to Chinese (Taiwan).

To add or remove languages, edit that Script Filter's keyword, for example `en||zhtw||ja||fr`. A keyword is either a language code (`ja`, `fr`, `en`) or a language plus region (`zhtw`, `zh-cn`, `engb`, `ptbr`). A bare code uses your macOS preferred languages to pick the region, then the language's main locale.

## Other ways in

- `tr <text>`: translate into the first keyword language that differs from the text's language. With `en||zhtw`, English goes to Chinese (Taiwan) and everything else goes to English.
- Universal Action **Translate**, or the included hotkey once assigned: runs `tr` on the selected text.

Return copies the translation. Command-Return pastes it into the frontmost app.

## Notes

The source language is detected automatically. When macOS can't tell what short text like `hi` or `ok` is written in, the workflow favors your keyword languages and your macOS preferred languages. The workflow uses the private `_LTTextSession` class from Apple's Translation framework with online translation allowed, so text may be sent to Apple when offline language models aren't downloaded. Requests abandoned while typing are cancelled so they don't queue up. If macOS changes the private API, the workflow shows an error row instead of crashing.
