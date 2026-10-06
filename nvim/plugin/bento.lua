require("bento").setup({
	lock_char = "",
	ui = {
		floating = {
			minimal_menu = "dashed",
		},
	},
})

local api = require("bento.api")

api.register_expand_key(";")
api.register_last_buffer_key(";")
api.register_collapse_key("<Esc>")
api.register_prev_page_key("[")
api.register_next_page_key("]")

local actions = {
	open = { "<CR>", "DiagnosticVirtualTextHint" },
	delete = { "<BS>", "DiagnosticVirtualTextError" },
	vsplit = { "|", "DiagnosticVirtualTextInfo" },
	split = { "_", "DiagnosticVirtualTextInfo" },
	lock = { "*", "DiagnosticVirtualTextWarn" },
}

for name, opts in pairs(actions) do
	api.register_action(name, {
		key = opts[1],
		action = api.actions[name],
		hl = opts[2],
	})
end

api.set_default_action("open")
