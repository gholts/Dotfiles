vim.api.nvim_create_autocmd("User", {
	group = vim.api.nvim_create_augroup("SurgeParser", { clear = true }),
	pattern = "TSUpdate",
	callback = function()
		require("nvim-treesitter.parsers").surge = {
			install_info = {
				url = "https://github.com/gholts/tree-sitter-surge",
				queries = "queries",
				generate = true,
				generate_from_json = false,
				revision = "5b790485f5336abdca3f73bb8431143d7fa49678",
			},
		}
	end,
})
vim.treesitter.language.register("surge", { "surge", "surge.module", "surge.ruleset" })

local treesitter = {
	-- filetype(keys) = parser(values)
	help = "vimdoc",
	regex = "regex",
	javascript = "javascript",
	typescript = "typescript",
	typescriptreact = "typescript",
	python = "python",
	lua = "lua",
	json = "json",
	bash = "bash",
	sh = "bash",
	css = "css",
	html = "html",
	astro = "astro",
	swift = "swift",
	yaml = "yaml",
	surge = "surge",
	["surge.module"] = "surge",
	["surge.ruleset"] = "surge",
}

require("nvim-treesitter").install(vim.tbl_values(treesitter))
-- Update Surge only when its pinned revision changes.
require("nvim-treesitter").update({ "surge" })

vim.api.nvim_create_autocmd("FileType", {
	pattern = vim.tbl_keys(treesitter),
	callback = function(args)
		pcall(vim.treesitter.start, args.buf)
	end,
})
