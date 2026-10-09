vim.filetype.add({
	extension = {
		sgconf = "surge",
		dconf = "surge",
		sgmodule = "surge.module",
	},
	filename = { ["Surge.conf"] = "surge" },
	pattern = {
		[".*/Surge/Profiles/.*%.conf"] = "surge",
		[".*/iCloud~com~nssurge~inc/Documents/Profiles/.*%.conf"] = "surge",
	},
})
