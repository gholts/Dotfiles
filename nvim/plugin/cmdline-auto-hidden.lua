local api, o = vim.api, vim.o
local cmdline_group = api.nvim_create_augroup("MinimalCmdLine", { clear = true })

o.cmdheight = 0
o.laststatus = 2

api.nvim_create_autocmd("CmdlineEnter", {
	group = cmdline_group,
	pattern = "*",
	callback = function()
		o.laststatus = 2
		o.cmdheight = 1
	end,
})

api.nvim_create_autocmd("CmdlineLeave", {
	group = cmdline_group,
	pattern = "*",
	callback = function()
		o.cmdheight = 0
		o.laststatus = 2
	end,
})
