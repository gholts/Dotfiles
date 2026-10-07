local fzf = require("fzf-lua")
local preview = (vim.env.XDG_CONFIG_HOME or vim.fn.expand("~/.config")) .. "/bin/fzf/preview"

fzf.setup({
	winopts = {
		split = "belowright new",
		treesitter = {
			enabled = true,
			fzf_colors = { ["hl"] = "-1:reverse", ["hl+"] = "-1:reverse" },
		},
		preview = {
			default = "bat_native",
			border = "single",
			vertical = "down:50%",
			horizontal = "right:60%",
			layout = "flex",
			flip_columns = 100,
			title = false,
		},
	},
	previewers = {
		-- Keep fzf-lua's path parsing, line highlighting, and scroll positioning.
		bat_native = { cmd = vim.fn.shellescape(preview), args = "" },
	},
	-- Unsaved and terminal buffers need Neovim's buffer previewer.
	buffers = { previewer = "builtin" },
})
fzf.register_ui_select()

-- Neovim consumes APC packets; forward only silent graphics from fzf buffers.
vim.api.nvim_create_autocmd("TermRequest", {
	group = vim.api.nvim_create_augroup("FzfGraphics", { clear = true }),
	callback = function(event)
		local control = event.data.sequence:match("^\027_G([^;]*);")
		if vim.bo[event.buf].filetype == "fzf" and control and ("," .. control .. ","):find(",q=2,", 1, true) then
			vim.api.nvim_ui_send(event.data.sequence .. event.data.terminator)
		end
	end,
})
