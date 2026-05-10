require("conform").setup({
	formatters_by_ft = {
		lua = { "stylua" },
		markdown = { "prettierd" },
		javascript = { "prettierd" },
		typescript = { "prettierd" },
		astro = { "prettierd" },
		css = { "prettierd" },
		html = { "prettierd" },
		yaml = { "prettierd" },
		sh = { "shfmt" },
		zsh = { "shfmt" },
		bash = { "shfmt" },
		toml = { "taplo" },
		python = { "ruff" },
		applescript = { "applescript_mac" },
	},
	format_on_save = {
		timeout_ms = 500,
		lsp_format = "fallback",
	},
	formatters = {
		applescript_mac = {
			command = "bash",
			args = {
				"-c",
				-- Execution Workflow:
				-- 1. Create a temporary binary script (.scpt) file.
				-- 2. Use `osacompile` to compile the input file ($1) passed by the formatter into the temporary file.
				-- 3. Upon successful compilation, use `osadecompile` to decompile the temporary file, redirecting standard output to overwrite the input file ($1) in-place.
				-- 4. Capture the exit status, safely remove the temporary file, and return the captured exit status.
				--
				-- AppleScript Formatting:
				-- AppleScript formatting fundamentally differs from traditional text-based formatters.
				-- Rather than utilizing string manipulation or syntax tree rewriting, it relies entirely
				-- on the native Open Scripting Architecture (OSA) engine. The canonical format is achieved
				-- through a strict two-step pipeline: compilation of the raw text into a binary representation,
				-- followed by decompilation back into plain text. The standard output produced by the
				-- decompiler inherently conforms to Apple's official stylistic guidelines, automatically
				-- enforcing correct keyword casing, indentation, and structural spacing.
				'tmpdir=$(mktemp -d -t as_fmt); tmp="$tmpdir/fmt.scpt"; osacompile -o "$tmp" "$1" && osadecompile "$tmp" > "$1"; exit_code=$?; rm -rf "$tmpdir"; exit $exit_code',
				"--",
				"$FILENAME",
			},
			stdin = false,
			exit_codes = { 0 },
		},
	},
})

local cmp = require("cmp")
local cmp_lsp = require("cmp_nvim_lsp")
local capabilities =
	vim.tbl_deep_extend("force", {}, vim.lsp.protocol.make_client_capabilities(), cmp_lsp.default_capabilities())

require("mason").setup({
	ui = {
		border = "single",
		backdrop = 100,
		width = 0.8,
		height = 0.8,
		icons = {
			package_installed = "✓",
			package_pending = "➜",
			package_uninstalled = "✗",
		},
	},
})

require("mason-lspconfig").setup({
	ensure_installed = {
		"lua_ls",
		"tailwindcss",
	},
})

require("cmp-tailwind-colors").setup({
	enable_alpha = true,
	format = function(itemColor)
		return {
			fg = itemColor,
			bg = nil,
			text = " ██",
		}
	end,
})

local cmp_select = { behavior = cmp.SelectBehavior.Select }

cmp.setup({
	mapping = cmp.mapping.preset.insert({
		["<C-p>"] = cmp.mapping.select_prev_item(cmp_select),
		["<C-n>"] = cmp.mapping.select_next_item(cmp_select),
		["<C-CR>"] = cmp.mapping.complete(),
		["<Tab>"] = cmp.mapping.confirm({ select = true }),
		["<CR>"] = cmp.mapping.confirm({ select = true }),
		["<C-d>"] = cmp.mapping.complete(),
	}),
	sources = cmp.config.sources({
		{ name = "nvim_lsp" },
		{ name = "path" },
	}, {
		{ name = "buffer", keyword_length = 7 },
	}),
	formatting = {
		fields = { "kind", "abbr", "menu" },
		format = function(entry, item)
			local original_kind = item.kind
			item.menu = original_kind
			item.menu_hl_group = "CmpItemKind" .. original_kind
			item = require("cmp-tailwind-colors").format(entry, item)
			if item.kind_hl_group and string.find(item.kind_hl_group, "^cmp_tailwind_colors_") then
			else
				item.kind = ""
				item.kind_hl_group = ""
			end

			return item
		end,
	},
	window = {
		completion = {
			border = "single",
			winblend = 0,
			winhighlight = "Normal:NormalFloat,FloatBorder:FloatBorder,CursorLine:PmenuSel,Search:None",
			max_height = 10,
			scrollbar = true,
			scrolloff = 3,
			side_padding = 0,
		},
		documentation = {
			border = "single",
			winblend = 0,
			winhighlight = "Normal:NormalFloat,FloatBorder:FloatBorder,CursorLine:PmenuSel,Search:None",
			max_height = 10,
		},
	},
})

cmp.setup.cmdline({ "/", "?" }, {
	mapping = cmp.mapping.preset.cmdline(),
	sources = {
		{ name = "buffer" },
	},
	window = {
		completion = {
			max_height = 4,
			winhighlight = "Normal:NormalFloat,FloatBorder:FloatBorder,CursorLine:PmenuSel,Search:None",
		},
	},
})

cmp.setup.cmdline(":", {
	mapping = cmp.mapping.preset.cmdline(),
	sources = cmp.config.sources({
		{ name = "path" },
	}, {
		{ name = "cmdline" },
	}),
	window = {
		completion = {
			max_height = 5,
			winhighlight = "Normal:NormalFloat,FloatBorder:FloatBorder,CursorLine:PmenuSel,Search:None",
		},
	},
})

vim.lsp.config("lua_ls", {
	capabilities = capabilities,
	settings = {
		Lua = {
			runtime = {
				version = "LuaJIT",
			},
			diagnostics = {
				globals = { "vim", "require" },
			},
			workspace = {
				library = vim.api.nvim_get_runtime_file("", true),
				checkThirdParty = false,
			},
			format = {
				enable = false,
			},
		},
	},
})

vim.lsp.config("tailwindcss", {
	capabilities = capabilities,
	filetypes = {
		"html",
		"css",
		"scss",
		"javascript",
		"javascriptreact",
		"typescript",
		"typescriptreact",
		"vue",
		"svelte",
		"astro",
	},
})

vim.lsp.enable("lua_ls")
vim.lsp.enable("tailwindcss")
