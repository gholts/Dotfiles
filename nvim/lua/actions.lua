local cmd, fn, api = vim.cmd, vim.fn, vim.api

local M = {}

--------------------------------------------------helper_functions
function M.fzf(action)
	return function()
		cmd.FzfLua(action)
	end
end

function M.buf_del()
	return function()
		MiniBufremove.delete(0, false)
	end
end

function M.toggle_oil_float()
	return function()
		require("oil").toggle_float()
	end
end

function M.q_bang()
	return function()
		cmd("q!")
	end
end

function M.wincmd(action)
	return function()
		cmd.wincmd(action)
	end
end

--------------------------------------------------custom_functions
function M.toggle_virtual_text()
	local current_config = vim.diagnostic.config() or {}
	local vt = current_config.virtual_text
	local new_state = not vt

	vim.diagnostic.config({ virtual_text = new_state })
	print("Virtual Text: " .. tostring(new_state))
end

function M.switch_boolean()
	local word = fn.expand("<cword>")

	if word == "true" then
		api.nvim_command("normal! ciwfalse")
	elseif word == "false" then
		api.nvim_command("normal! ciwtrue")
	end
end

function M.copy_full_text()
	local original_view = fn.winsaveview()

	cmd("normal! ggVGy")

	fn.winrestview(original_view)
end

function M.format_indent()
	local original_view = fn.winsaveview()

	cmd("normal! ggVG=")

	fn.winrestview(original_view)
end

return M
