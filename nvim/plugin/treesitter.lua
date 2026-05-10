vim.api.nvim_create_autocmd("FileType", {
	pattern = { "css", "html", "javascript", "typescript", "tsx", "astro" },
	callback = function()
		vim.treesitter.start()
	end,
})
require("nvim-treesitter").install({
	"vimdoc",
	"regex",
	"javascript",
	"typescript",
	"python",
	"lua",
	"json",
	"bash",
	"css",
	"html",
	"tsx",
	"astro",
	"swift",
})
