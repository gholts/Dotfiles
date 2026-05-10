local function change_cwd_to_arg()
	vim.schedule(function()
		local arg = vim.fn.argv(0)
		if type(arg) ~= "string" or arg == "" then
			return
		end

		arg = arg:gsub("^oil://", "")
		if arg == "" then
			return
		end

		local full_path = vim.fn.fnamemodify(arg, ":p")
		if vim.fn.isdirectory(full_path) == 1 then
			vim.cmd.cd(full_path)
			if vim.fn.getcwd() ~= full_path:gsub("/$", "") then
				vim.notify("The attempt to switch failed.", vim.log.levels.WARN)
			end
		end
	end)
end

vim.api.nvim_create_autocmd("VimEnter", { callback = change_cwd_to_arg })

if vim.v.vim_did_enter == 1 then
	change_cwd_to_arg()
end
