require("fzf-lua").register_ui_select()
require("fzf-lua").setup({
	winopts = {
		split = "belowright new", -- open in a split instead?
		-- "belowright new"  : split below
		-- "aboveleft new"   : split above
		-- "belowright vnew" : split right
		-- "aboveleft vnew   : split left
		-- border argument passthrough to nvim_open_win()
		-- border = "rounded",
		fullscreen = false, -- start fullscreen?
		treesitter = {
			enabled = true,
			fzf_colors = { ["hl"] = "-1:reverse", ["hl+"] = "-1:reverse" },
		},
		preview = {
			default = "bat", -- override the default previewer?
			border = "single", -- preview border: accepts both `nvim_open_win`
			-- and fzf values (e.g. "border-top", "none")
			-- native fzf previewers (bat/cat/git/etc)
			-- can also be set to `fun(winopts, metadata)`
			wrap = false, -- preview line wrap (fzf's 'wrap|nowrap')
			hidden = false, -- start preview hidden
			vertical = "down:50%", -- up|down:size
			horizontal = "right:60%", -- right|left:size
			layout = "flex", -- horizontal|vertical|flex
			flip_columns = 100, -- #cols to switch to horizontal on flex
			-- Only used with the builtin previewer:
			title = false, -- preview border title (file/buf)?
			title_pos = "center", -- left|center|right, title alignment
			scrollbar = "float", -- `false` or string:'float|border'
			-- float:  in-window floating border
			-- border: in-border "block" marker
			scrolloff = -1, -- float scrollbar offset from right
			-- applies only when scrollbar = 'float'
			delay = 20, -- delay(ms) displaying the preview
		},
	},
	previewers = {
		bat = {
			cmd = "bat",
			args = "--color=always --style=numbers,changes",
		},
		git_diff = {
			-- if required, use `{file}` for argument positioning
			-- e.g. `cmd_modified = "git diff --color HEAD {file} | cut -c -30"`
			cmd_deleted = "git diff --color HEAD --",
			cmd_modified = "git diff --color HEAD",
			cmd_untracked = "git diff --color --no-index /dev/null",
			-- git-delta is automatically detected as pager, set `pager=false`
			-- to disable, can also be set under 'git.status.preview_pager'
		},
		man = {
			-- NOTE: remove the `-c` flag when using man-db
			-- replace with `man -P cat %s | col -bx` on OSX
			cmd = "man -P bat %s | col -bx",
		},
	},
})
