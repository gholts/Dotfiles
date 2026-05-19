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
}

require("nvim-treesitter").install(vim.tbl_values(treesitter))

vim.api.nvim_create_autocmd("FileType", {
	pattern = vim.tbl_keys(treesitter),
	callback = function(args)
		pcall(vim.treesitter.start, args.buf)
	end,
})
