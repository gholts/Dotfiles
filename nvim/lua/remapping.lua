local map, cmd, api, actions = vim.keymap.set, vim.cmd, vim.api, require("actions")
---------------------------------------------------general_keymaps
map("x", "p", "P", { desc = "paste without yanking" })
map({ "n", "v" }, "gl", "g_", { desc = "jump to last character of the line" })
map({ "n", "v" }, "gh", "^", { desc = "jump to first character of the line" })
map("n", "<leader>h", "q:", { desc = "open command history" })
map("i", "<C-n>", "<Nop>", { desc = "disable default C-n" })
map("i", "<C-p>", "<Nop>", { desc = "disable default C-p" })
------------------------------------------file_&_neovim_operations
map("n", "<leader>ro", cmd.so, { desc = "source configs" })
map("n", "<leader>s", cmd.w, { desc = "save" })
map("n", "<leader>qq", cmd.q, { desc = "quit" })
map("n", "<Bslash>q", actions.q_bang(), { desc = "force quit" })
-----------------------------------window,_tab_&_buffer_management
map("n", "<leader><tab>", actions.wincmd("w"), { desc = "switch to next window" })
map("n", "<leader>w", actions.buf_del(), { desc = "close current buffer" })
map("n", "gn", cmd.tabnew, { desc = "open new tab" })
map("n", "gw", cmd.tabclose, { desc = "close tab" })
-----------------------------------------------------------plugins
map("n", "-", cmd.Oil, { desc = "open oil" })
map("n", "<D-C-v>", cmd.UndotreeToggle, { desc = "toggle undotree" })
map("n", "<C-'>", cmd.FzfLua, { desc = "open fzf-lua" })
map("n", "<C-/>", actions.fzf("files"), { desc = "fuzzy file search fzf-lua" })
map("n", "<C-f>", actions.fzf("grep"), { desc = "fuzzy rg search fzf-lua" })
map("n", "<C-h>", actions.fzf("helptags"), { desc = "fuzzy documentations search fzf-lua" })
map("n", "<leader>xx", actions.fzf("diagnostics_document"), { desc = "fuzzy error search fzf-lua" })
map("n", "<leader>xX", actions.fzf("diagnostics_workspace"), { desc = "fuzzy workspace error search fzf-lua" })
map("n", "<C-c>", actions.toggle_oil_float(), { desc = "toggle oil float" })
--------------------------------------custom_functions(action.lua)
map("n", "<leader>vt", actions.toggle_virtual_text, { desc = "toggle diagnostic virtual text" })
map("n", "<leader>t", actions.switch_boolean, { desc = "switch boolean" })
map("n", "<C-0>", actions.copy_full_text, { desc = "copy full text" })
map("n", "<C-=>", actions.format_indent, { desc = "format indent" })
--------------------------------------------------------conditions
api.nvim_create_autocmd("FileType", {
	pattern = "help",
	callback = function(event)
		cmd("only")
		map("n", "q", actions.buf_del(), {
			buffer = event.buf,
			desc = "quit help screen",
		})
	end,
})
