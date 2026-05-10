local map, cmd, fn, api = vim.keymap.set, vim.cmd, vim.fn, vim.api
---------------------------------------------------general_keymaps
map("x", "p", "P", { desc = "paste without yanking" })
map({ "n", "v" }, "gl", "g_", { desc = "jump to last character of the line" })
map({ "n", "v" }, "gh", "^", { desc = "jump to first character of the line" })
map("i", "<C-n>", "<Nop>", { desc = "disable default C-n" })
map("i", "<C-p>", "<Nop>", { desc = "disable default C-p" })
------------------------------------------file_&_neovim_operations
map("n", "<leader>s", "<cmd>w<cr>", { desc = "save" })
map("n", "<Bslash>q", "<cmd>q!<CR>", { desc = "force quit" })
map("n", "<leader>qq", "<cmd>q<cr>", { desc = "quit" })
map("n", "<leader>ro", "<cmd>so<CR>", { desc = "source configs" })
-----------------------------------window,_tab_&_buffer_management
map("n", "<leader><tab>", "<c-w>w", { desc = "switch to next window" })
map("n", "gn", "<cmd>tabnew<cr>", { desc = "open new tab" })
map("n", "gw", "<cmd>tabclose<cr>", { desc = "close tab" })
map("n", "<leader>w", "<cmd>lua MiniBufremove.delete(0, false)<cr>", { desc = "close current buffer" })
-----------------------------------------------------------plugins
map("n", "-", "<cmd>Oil<cr>", { desc = "open oil" })
map("n", "<C-c>", "<cmd>lua require('oil').toggle_float()<cr>", { desc = "toggle oil float" })
map("n", "<C-/>", "<cmd>FzfLua files<cr>", { desc = "fuzzy file search fzf-lua" })
map("n", "<C-f>", "<cmd>FzfLua grep<cr>", { desc = "fuzzy rg search fzf-lua" })
map("n", "<leader>xx", "<cmd>FzfLua diagnostics_document<CR>", { desc = "fuzzy error search fzf-lua" })
map("n", "<leader>xX", "<cmd>FzfLua diagnostics_workspace<CR>", { desc = "fuzzy workspace error search fzf-lua" })
map("n", "<D-C-v>", "<cmd>UndotreeToggle<cr>", { desc = "toggle undotree" })
--------------------------------------------------custom_functions
local function toggle_virtual_text()
	local current_config = vim.diagnostic.config() or {}
	local vt = current_config.virtual_text
	vim.diagnostic.config({ virtual_text = not vt })
	print("Virtual Text: " .. tostring(not vt))
end

local function switch_boolean()
	local word = fn.expand("<cword>")
	if word == "true" then
		api.nvim_command("normal! ciwfalse")
	elseif word == "false" then
		api.nvim_command("normal! ciwtrue")
	end
end

local function copy_full_text()
	local original_view = fn.winsaveview()
	cmd("normal! ggVGy")
	fn.winrestview(original_view)
end

local function format_indent()
	local original_view = fn.winsaveview()
	cmd("normal! ggVG=")
	fn.winrestview(original_view)
end

map("n", "<leader>vt", toggle_virtual_text, { desc = "toggle diagnostic virtual text" })
map("n", "<leader>t", switch_boolean, { desc = "switch boolean" })
map("n", "<C-0>", copy_full_text, { desc = "copy full text" })
map("n", "<C-=>", format_indent, { desc = "format indent" })
------------------------------------------------------autocommands
api.nvim_create_autocmd("FileType", {
	pattern = "help",
	callback = function(event)
		cmd("only")
		map("n", "q", "<cmd>lua MiniBufremove.delete(0, false)<cr>", {
			buffer = event.buf,
			desc = "quit help screen",
		})
	end,
})
