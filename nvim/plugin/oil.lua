require("oil").setup({
	default_file_explorer = true,
	win_options = {
		wrap = false,
		signcolumn = "auto",
	},
	float = {
		border = "single",
		preview_split = "right",
		win_options = {
			wrap = false,
		},
	},
	confirmation = {
		border = "single",
	},
	progress = {
		border = "single",
	},
	ssh = {
		border = "single",
	},
	keymaps_help = {
		border = "single",
	},
	view_options = {
		show_hidden = true,
		is_hidden_file = function(name)
			local m = name:match("^%.")
			return m ~= nil
		end,
		is_always_hidden = function(name)
			return name == ".DS_Store"
		end,
	},
})

vim.api.nvim_create_autocmd("FileType", {
	pattern = "oil_preview",
	callback = function(params)
		vim.keymap.set("n", "<CR>", "y", { buffer = params.buf, remap = true, nowait = true })
	end,
})

require("oil-git").setup({
	debounce_ms = 50,
	show_file_highlights = true,
	show_directory_highlights = true,
	show_file_symbols = true,
	show_directory_symbols = true,
	show_ignored_files = false, -- Show ignored file status
	show_ignored_directories = false, -- Show ignored directory status
	show_branch = true, -- Show current Git branch in oil buffers
	branch_format = "[%s]", -- Format string for branch display
	symbol_position = "eol", -- "eol", "signcolumn", or "none"
	can_use_signcolumn = nil, -- Optional callback(bufnr): nil|bool|string
	ignore_gitsigns_update = false, -- Ignore GitSignsUpdate events (fallback for flickering)
	debug = false, -- false, "minimal", or "verbose"

	symbols = {
		file = {
			added = "+",
			modified = "~",
			renamed = "->",
			deleted = "D",
			copied = "C",
			conflict = "!",
			untracked = "?",
			ignored = "o",
		},
	},

	-- Colors (only applied if highlight groups don't exist)
	highlights = {
		OilGitAdded = { fg = "#a6e3a1" },
		OilGitModifiedStaged = { fg = "#f9e2af" },
		OilGitModifiedUnstaged = { fg = "#e5c890" },
		OilGitBranch = { fg = "#89b4fa" },
		OilGitRenamed = { fg = "#cba6f7" },
		OilGitDeleted = { fg = "#f38ba8" },
		OilGitCopied = { fg = "#cba6f7" },
		OilGitConflict = { fg = "#fab387" },
		OilGitUntracked = { fg = "#89b4fa" },
		OilGitIgnored = { fg = "#6c7086" },
	},
})
