if exists('b:current_syntax')
  finish
endif

" Lexical highlighting only. Surge's LSP owns validation.
syntax case match
syntax match surgeSection /^\s*\[[^]]\+\]/
syntax match surgeKey /\%(^\s*\|,\s*\)\zs[a-zA-Z][a-zA-Z0-9_-]*\ze\s*=/
syntax match surgeRule /\%(^\s*\|(\)\zs[A-Z][A-Z0-9-]*\ze\s*,/
syntax region surgeString start=/"/ skip=/\\["\\]/ end=/"/ oneline contains=surgeParameter
syntax region surgeString start=/\%(^\|[[:space:],=]\)\zs'/ end=/'/ oneline contains=surgeParameter
syntax match surgeParameter /{{{[^}]\+}}}/
syntax match surgeParameter /%[A-Z][A-Z0-9_]*%/
syntax match surgeComment +\%(^\|\s\)\zs\%(#\|;\|//\).*$+
syntax match surgeDirective /^\s*#![a-zA-Z0-9_-]\+/

highlight default link surgeSection Title
highlight default link surgeKey Identifier
highlight default link surgeRule Keyword
highlight default link surgeString String
highlight default link surgeParameter Special
highlight default link surgeComment Comment
highlight default link surgeDirective PreProc

let b:current_syntax = 'surge'
