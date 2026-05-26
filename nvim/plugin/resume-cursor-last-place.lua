local ignore_buftype = { quickfix = true, nofile = true, help = true, terminal = true }
local ignore_filetype = { gitcommit = true, gitrebase = true, svn = true, hgcommit = true }

vim.api.nvim_create_autocmd({ "BufWinEnter", "FileType" }, {
	group = vim.api.nvim_create_augroup("nvim-lastplace", { clear = true }),
	callback = function()
		local bo = vim.bo

		if ignore_buftype[bo.buftype] then
			return
		end
		if ignore_filetype[bo.filetype] then
			vim.cmd("normal! gg")
			return
		end

		if vim.api.nvim_win_get_cursor(0)[1] > 1 then
			return
		end

		local last_line = vim.api.nvim_buf_get_mark(0, '"')[1]
		local total_lines = vim.api.nvim_buf_line_count(0)

		if last_line == 0 or last_line > total_lines then
			return
		end

		local win_height = vim.api.nvim_win_get_height(0)

		if total_lines <= win_height then
			vim.cmd('normal! g`"')
		elseif (total_lines - last_line) > ((win_height - 1) / 2) - 1 then
			vim.cmd('normal! g`"zz')
		else
			vim.cmd([[normal! G'"<c-e>]])
		end
	end,
})
