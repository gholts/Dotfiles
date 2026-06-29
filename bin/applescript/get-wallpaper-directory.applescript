tell application "Finder"
set desktopPicture to (get desktop picture as alias)
end tell
return POSIX path of desktopPicture