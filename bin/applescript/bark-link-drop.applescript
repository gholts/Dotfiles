------------------------------------------------------------------
-- Setting
------------------------------------------------------------------
set barkAPI to "https://api.day.app/" -- The Custom API Endpoint If Needed
set barkKey to "xxxxxxxxxxxx" -- The Bark Key
------------------------------------------------------------------
-- 1. Get links
------------------------------------------------------------------
tell application "Zen" -- Or Any Browser Based On Firefox
	activate
	
	------------------------------------------------------------------
	-- Get Title
	------------------------------------------------------------------
	set linkTitle to name of front window
	
	------------------------------------------------------------------
	-- Set A Mark Clipboard
	------------------------------------------------------------------
	try
		set originalClipboard to the clipboard as text
	on error
		set originalClipboard to ""
	end try
	
	------------------------------------------------------------------
	-- Copy Link
	------------------------------------------------------------------
	tell application "System Events"
		keystroke "c" using {command down, shift down} -- The Copy URL Shortcut Only Zen Browser Has
	end tell
end tell

------------------------------------------------------------------
-- 1.2 Loop Detect Clipboard Change
------------------------------------------------------------------
repeat 20 times
	try
		set currentClipboard to the clipboard as text
	on error
		set currentClipboard to ""
	end try
	
	if currentClipboard is not equal to originalClipboard then exit repeat
	
	delay 0.1
end repeat

------------------------------------------------------------------
-- 1.3 Then Set theLink to New Clipboard
------------------------------------------------------------------
set theLink to the clipboard

------------------------------------------------------------------
-- 1.4 Set Original Clipboard Back
------------------------------------------------------------------
set the clipboard to originalClipboard

------------------------------------------------------------------
-- 2. Build Bark Request And Send
------------------------------------------------------------------
if theLink contains "http" then
	set barkEndpoint to barkAPI & barkKey
	
	try
		do shell script "curl -G " & quoted form of barkEndpoint & ¬
			" --data-urlencode " & quoted form of "title=LinkDropped" & ¬
			" --data-urlencode " & quoted form of ("body=" & linkTitle) & ¬
			" --data-urlencode " & quoted form of ("url=" & theLink) & ¬
			" --data-urlencode " & quoted form of "group=LinkDrop" & ¬
			" --data-urlencode " & quoted form of "level=timeSensitive"
		
	on error errMsg
		display dialog "Send failed: " & errMsg
	end try
else
	display notification "No new link detected (or identical to clipboard content)."
end if

