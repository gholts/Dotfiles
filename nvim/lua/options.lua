local g, o = vim.g, vim.o
------------------------------------------------------------------
g.mapleader = " " -- remap leader key
g.maplocalleader = "," -- remap local leader key
g.netrw_nogx = 1
------------------------------------------------------------------
o.nu = true -- line number
o.rnu = false -- relative line number
o.wrap = false -- line warpping
o.scrolloff = 10 -- add n(10) line offset from the windows edge
o.splitkeep = "screen" -- make split keep same line
o.termguicolors = true -- true color
o.winborder = "single"
o.softtabstop = 4 -- in I, make <Tab> like 4 spaces
o.tabstop = 4 -- what tab character occupies looks like
o.shiftwidth = 4 -- how many space for indent
o.expandtab = true -- make <Tab> actually type space
------------------------------------------------------------------
o.autocomplete = false -- native autocomplete
o.clipboard = "unnamedplus" -- make (y),(p) directly work with system clipboard
o.smartindent = true -- like smart indent
o.smartcase = true -- like smart auto case insensitive
o.smoothscroll = true
o.autochdir = false -- automatically change current dir
o.undofile = true -- persistent undo
