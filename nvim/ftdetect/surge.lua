-- Recognize document signatures; leave syntax validation to surge-cli.
-- https://manual.nssurge.com/tools/cli.html#editor-language-server-mac-6100
local rule = vim.regex(
	[=[^\s*[A-Z][A-Z0-9-]*\s*,\s*\%("\%([^"\\]\|\\.\)\+"\|'[^']\+'\|[^,"']\+\)\%(\s*,\s*\%(no-resolve\|extended-matching\|pre-matching\|debug\)\)*\s*\%([#;].*\|//.*\)\?$]=]
)

local function detect(_, bufnr)
	if not bufnr or not vim.api.nvim_buf_is_valid(bufnr) then
		return
	end
	local rules = 0
	for _, line in ipairs(vim.api.nvim_buf_get_lines(bufnr, 0, 200, false)) do
		line = vim.trim(line)
		if line:match("^#!name%s*=%s*%S") then
			return "surge.module"
		end
		local section = line:match("^%[([^%]]+)%]")
		if section == "Proxy" or section == "Proxy Group" or section == "Rule" then
			return "surge"
		end
		if line ~= "" and not line:match("^[#;]") and not vim.startswith(line, "//") then
			if not rule:match_str(line) then
				return
			end
			rules = rules + 1
			if rules == 20 then
				return "surge.ruleset"
			end
		end
	end
	if rules >= 2 then
		return "surge.ruleset"
	end
end

vim.filetype.add({
	extension = {
		conf = "surge",
		sgconf = "surge",
		dconf = "surge",
		sgmodule = "surge.module",
		iosinterface = "json",
	},
	pattern = {
		[".*%.conf"] = detect,
		[".*%.list"] = detect,
		[".*%.txt"] = detect,
		[".*%.module"] = detect,
		[".*"] = { detect, { priority = -math.huge } },
	},
})
