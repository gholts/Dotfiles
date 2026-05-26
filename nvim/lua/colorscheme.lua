local api, o, g = vim.api, vim.o, vim.g
local colorScheme = "oxocarbon"

vim.pack.add({
	"https://github.com/f-person/auto-dark-mode.nvim",
	"https://github.com/nyoom-engineering/oxocarbon.nvim",
})

api.nvim_create_autocmd("ColorScheme", {
	pattern = colorScheme,
	group = api.nvim_create_augroup("ThemeOverrides", { clear = true }),
	callback = function()
		local ok, themeModule = pcall(require, colorScheme)
		local c = (ok and themeModule[colorScheme]) or {}
		local hl = api.nvim_set_hl

		hl(0, "FloatTitle", { fg = c.base05 })
		hl(0, "FloatFooter", { fg = c.base05 })
		hl(0, "FloatBorder", { fg = c.base03, bg = "NONE" })
		hl(0, "NormalFloat", { fg = c.base05, bg = c.base00 })
	end,
})

local function set_theme(bg)
	if g.colors_name ~= colorScheme then
		vim.cmd.colorscheme(colorScheme)
	end

	if o.background ~= bg then
		o.background = bg
	end
end

require("auto-dark-mode").setup({
	update_interval = 1000,
	fallback = "dark",
	set_dark_mode = function()
		set_theme("dark")
	end,
	set_light_mode = function()
		set_theme("light")
	end,
})
