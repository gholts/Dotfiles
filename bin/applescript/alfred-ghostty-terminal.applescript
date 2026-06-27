-- AlfredGhostty Script - Ghostty AppleScript API rewrite
-- Source workflow: https://github.com/zeitlings/alfred-ghostty-script
-- Ghostty API: https://ghostty.org/docs/features/applescript

-- tab : t | window: n | split: d | quick terminal: qt
property open_new : "t"
property run_cmd : true
property reuse_tab : false
property timeout_seconds : 3
property shell_load_delay : 1.0
property switch_delay : 0.35

on isRunning()
	return application "/Applications/Ghostty.app" is running
end isRunning

on summon()
	tell application "/Applications/Ghostty.app" to activate
end summon

on hasWindows()
	if not my isRunning() then return false
	try
		tell application "/Applications/Ghostty.app"
			return (count of windows) > 0
		end tell
	on error
		return false
	end try
end hasWindows

on waitForWindow(timeout_s)
	set waited_s to 0
	repeat until my hasWindows() or (waited_s >= timeout_s)
		delay 0.05
		set waited_s to waited_s + 0.05
	end repeat
	return my hasWindows()
end waitForWindow

on focusedTerminal()
	if not my hasWindows() then return missing value
	try
		tell application "/Applications/Ghostty.app"
			return focused terminal of selected tab of front window
		end tell
	on error
		return missing value
	end try
end focusedTerminal

on waitForFocusedTerminal(timeout_s)
	set waited_s to 0
	repeat
		set term to my focusedTerminal()
		if term is not missing value then return term
		if waited_s >= timeout_s then exit repeat
		delay 0.05
		set waited_s to waited_s + 0.05
	end repeat
	return missing value
end waitForFocusedTerminal

on terminalID(term)
	if term is missing value then return ""
	try
		tell application "/Applications/Ghostty.app"
			return id of term
		end tell
	on error
		return ""
	end try
end terminalID

on waitForFocusedTerminalChanged(old_id, timeout_s)
	set waited_s to 0
	repeat
		set term to my focusedTerminal()
		if term is not missing value then
			if old_id is "" then return term
			if (my terminalID(term)) is not old_id then return term
		end if
		if waited_s >= timeout_s then exit repeat
		delay 0.05
		set waited_s to waited_s + 0.05
	end repeat
	return my focusedTerminal()
end waitForFocusedTerminalChanged

on replaceText(the_text, search_text, replacement_text)
	set old_delimiters to AppleScript's text item delimiters
	set AppleScript's text item delimiters to search_text
	set text_parts to text items of the_text
	set AppleScript's text item delimiters to replacement_text
	set new_text to text_parts as text
	set AppleScript's text item delimiters to old_delimiters
	return new_text
end replaceText

on stripLineBreaks(the_text)
	set clean_text to my replaceText(the_text as text, linefeed, "")
	set clean_text to my replaceText(clean_text, return, "")
	return clean_text
end stripLineBreaks

on targetTerminal(just_activated)
	if just_activated then return my waitForFocusedTerminal(timeout_seconds)
	
	set had_windows to my hasWindows()
	tell application "/Applications/Ghostty.app"
		if not had_windows then
			set win to new window
			return focused terminal of selected tab of win
		end if
		
		set win to front window
		set tab1 to selected tab of win
		set term1 to focused terminal of tab1
		
		if reuse_tab then
			return term1
		else if open_new is "n" then
			set win2 to new window
			return focused terminal of selected tab of win2
		else if open_new is "t" then
			set tab2 to new tab in win
			return focused terminal of tab2
		else if open_new is "d" then
			return split term1 direction right
		else
			return term1
		end if
	end tell
end targetTerminal

on inputCommand(a_command, target_term)
	set clean_command to my stripLineBreaks(a_command)
	tell application "/Applications/Ghostty.app"
		focus target_term
		input text clean_command to target_term
		if run_cmd then send key "enter" to target_term
	end tell
end inputCommand

on send(a_command, just_activated)
	if not just_activated then delay switch_delay
	set had_windows to my hasWindows()
	set target_term to my targetTerminal(just_activated)
	
	if target_term is missing value then
		error "Failed to find Ghostty terminal"
	end if
	
	if just_activated or (not reuse_tab) or (reuse_tab and not had_windows) then
		delay shell_load_delay
	end if
	
	my inputCommand(a_command, target_term)
end send

on toggleQuickTerminalWithAPI()
	set source_term to my waitForFocusedTerminal(timeout_seconds)
	if source_term is missing value then return false
	
	try
		tell application "/Applications/Ghostty.app"
			perform action "toggle_quick_terminal" on source_term
		end tell
		return true
	on error
		return false
	end try
end toggleQuickTerminalWithAPI

on toggleQuickTerminalWithMenu()
	try
		tell application "/Applications/Ghostty.app" to activate
		tell application "System Events"
			tell process "Ghostty"
				set viewMenu to menu 1 of menu bar item "View" of menu bar 1
				click menu item "Quick Terminal" of viewMenu
			end tell
		end tell
		return true
	on error
		return false
	end try
end toggleQuickTerminalWithMenu

on pasteViaClipboard(a_command)
	set clean_command to my stripLineBreaks(a_command)
	set backup_available to false
	
	try
		set backup to the clipboard as text
		set backup_available to true
	end try
	
	set the clipboard to clean_command
	delay 0.1
	
	tell application "System Events"
		tell process "Ghostty"
			keystroke "v" using command down
			if run_cmd then
				delay 0.1
				keystroke return
			end if
		end tell
	end tell
	
	if backup_available then
		try
			set the clipboard to backup
		end try
	end if
end pasteViaClipboard

on send_quick_terminal(a_command, needs_wakeup)
	if needs_wakeup then
		my summon()
		if not my waitForWindow(timeout_seconds) then
			error "Failed to create initial window"
		end if
	end if
	
	set before_id to my terminalID(my focusedTerminal())
	set toggled_by_api to my toggleQuickTerminalWithAPI()
	if not toggled_by_api then
		set toggled_by_menu to my toggleQuickTerminalWithMenu()
		if not toggled_by_menu then
			error "Failed to open Quick Terminal"
		end if
	end if
	
	delay 0.15
	set target_term to my waitForFocusedTerminalChanged(before_id, timeout_seconds)
	if target_term is missing value then
		my pasteViaClipboard(a_command)
	else
		my inputCommand(a_command, target_term)
	end if
end send_quick_terminal

on alfred_script(query)
	if open_new is "qt" then
		my send_quick_terminal(query, not my isRunning())
	else
		set just_activated to not my isRunning()
		my summon()
		if just_activated then
			if not my waitForWindow(timeout_seconds) then
				error "Failed to create initial window"
			end if
		end if
		my send(query, just_activated)
	end if
end alfred_script
