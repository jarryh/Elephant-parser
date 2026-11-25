-- /storylog

local _, ns = ...
local say, try = ns.say, ns.try

local DAY = 86400

local function onOff(value)
	return value and "|cff40c060on|r" or "|cffff7070off|r"
end

local function help()
	say("commands:")
	print("  /storylog  - status, and the place that would be saved now")
	print("  /storylog on / off")
	print("  /storylog record <" .. table.concat(ns.CATEGORIES, "|") .. "> on / off")
	print("  /storylog note <text>  - a note that names the scene")
	print("  /storylog prune <days>  - delete sessions older than that")
end

-- Also the in-game test of what this client lets an add-on see.
local function status()
	local settings = ns.db.settings
	say("recording " .. onOff(settings.recording))

	local parts = {}
	for _, category in ipairs(ns.CATEGORIES) do
		parts[#parts + 1] = category .. " " .. onOff(settings[category])
	end
	print("  " .. table.concat(parts, ", "))
	print(("  Lines: %d this session, %d saved in all"):format(#ns.session.messages, ns.lineCount()))

	local here = ns.describePlayer()
	local names = {}
	for _, key in ipairs({ "inst", "zone", "neighborhood", "house", "sub", "mini" }) do
		if here[key] and here[key] ~= names[#names] then names[#names + 1] = here[key] end
	end
	local line = "  Here: " .. (#names > 0 and table.concat(names, ", ") or "unknown")
	if here.indoors ~= nil then line = line .. (here.indoors and " (indoors)" or " (outdoors)") end
	print(line)

	if here.x then
		print(("  Coordinates: %.1f, %.1f on map %d"):format(here.x * 100, here.y * 100, here.map))
	else
		print("  Coordinates: the game gives none here")
	end
	print("  Distances in yards: " .. (here.wx and "available" or "the game gives none here"))

	local known, total = ns.groupPositions()
	if total > 0 then print(("  Group members with a position: %d of %d"):format(known, total)) end

	if C_ChatInfo and try(C_ChatInfo.InChatMessagingLockdown) == true then
		print("  The game is hiding chat from add-ons right now")
	end

	if AddOn_TotalRP3 then
		print("  Your Total RP 3 name: " .. (ns.ownRoleplayName() or "same as the character"))
	else
		print("  Total RP 3 is not loaded, so no roleplay names")
	end
	local failures = ns.failures
	if failures.count > 0 then
		print(("  |cffff7070%d lines were not recorded in full.|r First error: %s"):format(failures.count, failures.first or "unknown"))
	end
	print("  /storylog help lists the commands")
end

local function prune(argument)
	local number, confirm = argument:match("^(%d+)%s*(%a*)$")
	local days = tonumber(number)
	if not days or days < 1 then
		say("use /storylog prune <days>, for example /storylog prune 90")
		return
	end

	local cutoff = GetServerTime() - days * DAY
	local keep, sessions, lines = {}, 0, 0
	for _, session in ipairs(ns.db.sessions) do
		local messages = session.messages or {}
		local last = messages[#messages]
		local lastTime = (last and last.t) or session.ended or session.started or 0
		if session == ns.session or lastTime >= cutoff then
			keep[#keep + 1] = session
		else
			sessions = sessions + 1
			lines = lines + #messages
		end
	end

	if sessions == 0 then
		say(("nothing is older than %d days."):format(days))
	elseif confirm:lower() == "confirm" then
		ns.db.sessions = keep
		say(("deleted %d sessions (%d lines). The file changes on logout or /reload."):format(sessions, lines))
	else
		say(("this would delete %d sessions (%d lines) for good. Copy StoryLog.lua first, then type /storylog prune %d confirm"):format(sessions, lines, days))
	end
end

local function record(argument)
	local category, value = argument:lower():match("^(%a+)%s+(%a+)$")
	for _, known in ipairs(ns.CATEGORIES) do
		if known == category and (value == "on" or value == "off") then
			ns.db.settings[known] = value == "on"
			say(known .. " " .. onOff(ns.db.settings[known]))
			return
		end
	end
	say("use /storylog record <" .. table.concat(ns.CATEGORIES, "|") .. "> on / off")
end

local function note(text)
	if text == "" then
		say("use /storylog note <text>")
	elseif not ns.db.settings.recording then
		say("recording is off, so the note was not saved.")
	else
		ns.note(text)
		say("note saved.")
	end
end

SLASH_STORYLOG1 = "/storylog"
SlashCmdList.STORYLOG = function(input)
	if not ns.session then
		say("not running, so nothing is recorded.")
		return
	end

	local command, rest = (input or ""):match("^%s*(%S*)%s*(.-)%s*$")
	command = command:lower()

	if command == "" or command == "status" then
		status()
	elseif command == "on" or command == "off" then
		ns.db.settings.recording = command == "on"
		say("recording " .. onOff(ns.db.settings.recording))
	elseif command == "record" then
		record(rest)
	elseif command == "note" then
		note(rest)
	elseif command == "prune" then
		prune(rest)
	else
		help()
	end
end
