vim.pack.add({
	"https://github.com/f-person/auto-dark-mode.nvim",
	"https://github.com/nyoom-engineering/oxocarbon.nvim",
})

vim.cmd.colorscheme("oxocarbon")

local function set_bg(bg)
	vim.o.background = bg
	local colors = require("oxocarbon").oxocarbon
	if colors then
		vim.api.nvim_set_hl(0, "FloatBorder", { fg = colors.base03, bg = "none" })
	end
end

require("auto-dark-mode").setup({
	set_dark_mode = function()
		set_bg("dark")
	end,
	set_light_mode = function()
		set_bg("light")
	end,
	update_interval = 3000,
	fallback = "dark",
})
