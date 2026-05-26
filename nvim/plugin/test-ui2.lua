require("vim._core.ui2").enable({
	enable = true,
	msg = {
		targets = "msg",
		msg = { timeout = 3000 },
	},
})

vim.api.nvim_create_autocmd("FileType", {
	group = vim.api.nvim_create_augroup("UI2_Window_Settings", { clear = true }),
	pattern = { "msg", "cmd", "dialog", "pager" },
	callback = function(args)
		local win = vim.api.nvim_get_current_win()

		vim.wo[win].winblend = 0

		if args.match == "msg" then
			vim.schedule(function()
				if vim.api.nvim_win_is_valid(win) and vim.api.nvim_win_get_config(win).relative ~= "" then
					vim.api.nvim_win_set_config(win, { border = "none" })
				end
			end)
		end
	end,
})
