-----------------------------------------------------------conform
local formatters_by_ft = {
	lua = { "stylua" },
	toml = { "taplo" },
	python = { "ruff" },
	applescript = { "applescript_mac" },
}

for _, ft in ipairs({ "markdown", "javascript", "typescript", "astro", "css", "html", "yaml", "yml" }) do
	formatters_by_ft[ft] = { "prettierd" }
end
for _, ft in ipairs({ "sh", "zsh", "bash" }) do
	formatters_by_ft[ft] = { "shfmt" }
end

require("conform").setup({
	formatters_by_ft = formatters_by_ft,
	format_on_save = { timeout_ms = 500, lsp_format = "fallback" },
	formatters = {
		applescript_mac = {
			command = "bash",
			args = {
				"-c",
				-- Uses osacompile -> osadecompile to enforce Apple's official stylistic guidelines.
				'tmpdir=$(mktemp -d -t as_fmt); tmp="$tmpdir/fmt.scpt"; osacompile -o "$tmp" "$1" && osadecompile "$tmp" > "$1"; exit_code=$?; rm -rf "$tmpdir"; exit $exit_code',
				"--",
				"$FILENAME",
			},
			stdin = false,
			exit_codes = { 0 },
		},
	},
})

---------------------------------------------------------------lsp
require("mason").setup({
	ui = {
		border = "single",
		backdrop = 100,
		width = 0.8,
		height = 0.8,
		icons = { package_installed = "✓", package_pending = "➜", package_uninstalled = "✗" },
	},
})

local capabilities = vim.tbl_deep_extend(
	"force",
	vim.lsp.protocol.make_client_capabilities(),
	require("cmp_nvim_lsp").default_capabilities()
)

local lsp_servers_config = {
	astro = {},
	docker_language_server = {},
	html = {},
	jsonls = {},
	ruff = {},
	yamlls = {},
	lua_ls = {
		settings = {
			Lua = {
				runtime = { version = "LuaJIT" },
				diagnostics = { globals = { "vim", "require" } },
				workspace = {
					library = vim.api.nvim_get_runtime_file("", true),
					checkThirdParty = false,
				},
				format = { enable = false },
			},
		},
	},
	tailwindcss = {
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
	},
}

local lsp_servers = {}
for name, config in pairs(lsp_servers_config) do
	table.insert(lsp_servers, name)
	config.capabilities = capabilities
	vim.lsp.config(name, config)
end

require("mason-lspconfig").setup({ ensure_installed = lsp_servers })
vim.lsp.enable(lsp_servers)

---------------------------------------------------------------cmp
require("cmp-tailwind-colors").setup({
	enable_alpha = true,
	format = function(itemColor)
		return { fg = itemColor, bg = nil, text = " ██" }
	end,
})

local cmp = require("cmp")
local sel_opt = { behavior = cmp.SelectBehavior.Select }

local function cmp_win(opts)
	return vim.tbl_extend("force", {
		border = "single",
		winblend = 0,
		winhighlight = "Normal:NormalFloat,FloatBorder:FloatBorder,CursorLine:PmenuSel,Search:None",
	}, opts or {})
end

cmp.setup({
	mapping = cmp.mapping.preset.insert({
		["<C-p>"] = cmp.mapping.select_prev_item(sel_opt),
		["<C-n>"] = cmp.mapping.select_next_item(sel_opt),
		["<C-CR>"] = cmp.mapping.complete(),
		["<C-d>"] = cmp.mapping.complete(),
		["<Tab>"] = cmp.mapping.confirm({ select = true }),
		["<CR>"] = cmp.mapping.confirm({ select = true }),
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
			item.menu = item.kind
			item.menu_hl_group = "CmpItemKind" .. item.kind
			item = require("cmp-tailwind-colors").format(entry, item)

			if not (item.kind_hl_group and item.kind_hl_group:find("^cmp_tailwind_colors_")) then
				item.kind = ""
				item.kind_hl_group = ""
			end
			return item
		end,
	},
	window = {
		completion = cmp_win({ max_height = 10, scrollbar = true, scrolloff = 3, side_padding = 0 }),
		documentation = cmp_win({ max_height = 10 }),
	},
})

cmp.setup.cmdline({ "/", "?" }, {
	mapping = cmp.mapping.preset.cmdline(),
	sources = { { name = "buffer" } },
	window = { completion = cmp_win({ max_height = 4 }) },
})

cmp.setup.cmdline(":", {
	mapping = cmp.mapping.preset.cmdline(),
	sources = cmp.config.sources({ { name = "path" } }, { { name = "cmdline" } }),
	window = { completion = cmp_win({ max_height = 5 }) },
})
