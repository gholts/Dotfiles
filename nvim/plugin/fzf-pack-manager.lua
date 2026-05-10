local fzf = require("fzf-lua")
local utils = require("fzf-lua.utils")
local log = vim.log.levels

local function get_readme(path)
	if type(path) ~= "string" or path == "" then
		return ""
	end
	local md, txt = path .. "/README.md", path .. "/README"
	return vim.uv.fs_stat(md) and md or vim.uv.fs_stat(txt) and txt or path
end

local function run_pack_manager(non_active)
	local path = vim.fn.stdpath("config") .. "/nvim-pack-lock.json"
	local ok, lock = pcall(function()
		return vim.json.decode(io.open(path):read("*a"))
	end)

	if not ok or type(lock) ~= "table" or not lock.plugins then
		return vim.notify("Invalid or missing lockfile", log.WARN)
	end

	local packs = {}
	for _, p in ipairs(vim.pack.get()) do
		packs[p.spec.name] = p
	end

	local entries, pmap = {}, {}
	for name, info in pairs(lock.plugins) do
		local p = packs[name] or {}
		if not (non_active and p.active) then
			local rev = (info.rev or ""):sub(1, 7)
			local readme = get_readme(p.path)

			local entry = ("%s:1:1:[%s]  %s"):format(readme, utils.ansi_codes.green(rev), utils.ansi_codes.blue(name))
			local plain_entry = ("%s:1:1:[%s]  %s"):format(readme, rev, name)

			entries[#entries + 1] = entry
			pmap[plain_entry] = { name, p }
		end
	end

	if #entries == 0 then
		return vim.notify("No plugins to display", log.INFO)
	end

	local function act(fn)
		return function(sel)
			if not sel or not sel[1] then
				return
			end
			local d = pmap[sel[1]]
			if d then
				fn(d[1], d[2])
			end
		end
	end

	fzf.fzf_exec(entries, {
		prompt = "vim.pack> ",
		previewer = "builtin",
		fzf_opts = { ["--delimiter"] = ":", ["--with-nth"] = "4..", ["--tiebreak"] = "begin" },
		actions = {
			["default"] = act(function(_, p)
				if p.path then
					vim.cmd.edit(p.path)
				end
			end),
			["ctrl-u"] = act(function(name)
				vim.pack.update({ name })
			end),
			["ctrl-x"] = act(function(name, p)
				if not p.path then
					return vim.notify("Not on disk: " .. name, log.WARN)
				end
				if p.active then
					return vim.notify("Active plugin: " .. name, log.ERROR)
				end
				vim.pack.del({ name })
				vim.notify("Deleted: " .. name, log.INFO)
			end),
		},
	})
end

local cmd = vim.api.nvim_create_user_command
cmd("PackManage", function()
	run_pack_manager(false)
end, {})
cmd("PackManageNonActive", function()
	run_pack_manager(true)
end, {})
