-- /storylog

local _, ns = ...
local say, try = ns.say, ns.try

local DAY = 86400

-- The categories, as "speech|party|...". A pipe is doubled: the game reads a single one
-- with the letter after it as a code, so that "|r" vanishes and "|n" breaks the line.
local CATEGORY_LIST = table.concat(ns.CATEGORIES, "||")

local function onOff(value)
	return value and "|cff40c060on|r" or "|cffff7070off|r"
end

local function help()
	say("commands:")
	print("  /storylog  - open or close the window with the switches")
	print("  /storylog status  - the status, and the place that would be saved now")
	print("  /storylog on / off")
	print("  /storylog record <" .. CATEGORY_LIST .. "> on / off")
	print("  /storylog channel <name> on / off  - one channel, such as Trade. Alone, it lists them")
	print("  /storylog icon on / off  - the icon at the minimap")
	print("  /storylog note <text>  - a note that names the scene")
	print("  /storylog limit <MB> / off  - the size at which older sessions move to an archive file")
	print("  /storylog archive  - what the archive files hold. When all are full, the oldest is emptied")
	print("  /storylog prune <days>  - delete sessions older than that")
end

-- The channels chosen by name, sorted.
local function chosenChannels()
	local names = {}
	for key in pairs(ns.db.settings.channelNames) do names[#names + 1] = key end
	table.sort(names)
	return names
end

-- Also the in-game test of what this client lets an add-on see.
local function status()
	local settings = ns.db.settings
	say("recording " .. onOff(settings.recording))

	local parts = {}
	for index, category in ipairs(ns.CATEGORIES) do
		parts[#parts + 1] = category .. " " .. onOff(settings[category])
		-- Two lines: the chat, then what happened.
		if category == "notices" or index == #ns.CATEGORIES then
			print("  " .. table.concat(parts, ", "))
			parts = {}
		end
	end
	if not settings.channels then
		local chosen = chosenChannels()
		print("  Channels chosen by name: " .. (#chosen > 0 and table.concat(chosen, ", ") or "none"))
	end
	print(("  Lines: %d this session, %d in the main log"):format(#ns.session.messages, ns.lineCount()))
	local limit = settings.limit
	local bytes, constants = ns.logSize()
	print(("  Size: about %s MB. %s"):format(
		ns.megabytes(bytes),
		limit > 0 and ("Past %s MB, finished sessions move to an archive file."):format(tostring(limit)) or "It is never split."))
	local warning = ns.logWarning(constants)
	if warning then print("  " .. warning) end
	print("  " .. ns.archiveSummary())

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
	if #ns.missing > 0 then
		local missing = {}
		for i, event in ipairs(ns.missing) do missing[i] = event end
		table.sort(missing)
		print("  Not on this client, so not recorded: " .. table.concat(missing, ", "))
	end

	local failures = ns.failures
	if failures.count > 0 then
		print(("  |cffff7070%d lines were not recorded in full.|r First error: %s"):format(failures.count, failures.first or "unknown"))
	end
	if ns.optionsProblem then print("  The window had a problem on this client: " .. ns.optionsProblem) end
	if ns.iconProblem then print("  The icon at the minimap had a problem on this client: " .. ns.iconProblem) end
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
		ns.refreshOptions()
	else
		say(("this would delete %d sessions (%d lines) for good. Copy StoryLog.lua first, then type /storylog prune %d confirm"):format(sessions, lines, days))
	end
end

local function limit(argument)
	local size = argument:lower() == "off" and 0 or tonumber(argument)
	if not size or size ~= size or size < 0 or size > ns.MAX_LIMIT or (size > 0 and size < 1) then
		say(("use /storylog limit <MB> with 1 to %d, or /storylog limit off. It is now "):format(ns.MAX_LIMIT)
			.. (ns.db.settings.limit > 0 and (tostring(ns.db.settings.limit) .. " MB.") or "off."))
		return
	end
	ns.db.settings.limit = size
	ns.refreshOptions()
	if size == 0 then
		say("the log is no longer split. It loads in full at every login, however large.")
	else
		say(("past about %s MB, finished sessions move to an archive file at login. The log is about %s MB now."):format(
			tostring(size), ns.megabytes(ns.logSize())))
	end
end

local function archive(argument)
	local state = ns.archiveState()
	if argument:lower() == "clear" then
		ns.archiveClear()
		ns.refreshOptions()
		say("the archive files count as empty again.")
		return
	end
	if argument ~= "" then
		say("use /storylog archive, or /storylog archive clear after moving the archive files away.")
		return
	end

	say("archive files, as last saved:")
	local following = ns.archiveNext()
	for volume = 1, ns.ARCHIVE_VOLUMES do
		local held = state.held[volume]
		local line = ("  StoryLog_Archive%d.lua: "):format(volume)
		if held.sessions == 0 then
			line = line .. "empty"
		else
			line = line .. ("%d sessions, %d lines, about %s MB"):format(held.sessions, held.lines, ns.megabytes(held.bytes))
			local span = ns.span(held)
			if span then line = line .. ", " .. span end
		end
		if volume == state.volume then line = line .. " (in use)" end
		if volume == following then line = line .. " (emptied when the one in use is full)" end
		print(line)
	end
	if state.pending then
		print(("  Sessions copied to file %d leave the main log at the next login."):format(state.pending.volume))
	end
end

local function record(argument)
	local category, value = argument:lower():match("^(%a+)%s+(%a+)$")
	if (value == "on" or value == "off") and ns.setCategory(category, value == "on") then
		say(category .. " " .. onOff(ns.db.settings[category]))
		return
	end
	say("use /storylog record <" .. CATEGORY_LIST .. "> on / off")
end

local function channel(argument)
	local settings = ns.db.settings
	if argument == "" then
		say("channels: " .. (settings.channels and "all are recorded (/storylog record channels off to choose)"
			or "only those chosen are recorded"))
		local chosen = chosenChannels()
		print("  Chosen: " .. (#chosen > 0 and table.concat(chosen, ", ") or "none"))
		local joined = {}
		for _, each in ipairs(ns.joinedChannels()) do joined[#joined + 1] = each.name end
		print("  You are in: " .. (#joined > 0 and table.concat(joined, ", ") or "none"))
		return
	end

	local name, value = argument:match("^(.-)%s+(%a+)$")
	value = value and value:lower()
	local key = (value == "on" or value == "off") and ns.setChannel(name, value == "on")
	if not key then
		say("use /storylog channel <name> on / off, for example /storylog channel Trade on")
		return
	end
	say(("channel %s %s"):format(key, onOff(value == "on"))
		.. (settings.channels and ". All channels are recorded anyway, until /storylog record channels off." or ""))
end

local function icon(argument)
	local value = argument:lower()
	if value ~= "on" and value ~= "off" then
		say("use /storylog icon on / off")
		return
	end
	ns.setIcon(value == "on")
	if ns.icon then
		say("icon at the minimap " .. onOff(ns.db.settings.icon))
	else
		say(("icon at the minimap %s, but this client can't show it (%s)."):format(
			onOff(ns.db.settings.icon), ns.iconProblem or "unknown"))
	end
end

-- For the slash command and the icon alike.
function ns.sayRecording()
	say("recording " .. onOff(ns.db.settings.recording))
end

-- Opens or closes the window. Where it can't open, prints the status instead.
function ns.showOptions()
	local _, problem = ns.toggleOptions()
	if problem then
		status()
		say("the window can't open on this client (" .. problem .. "), so this is the status instead.")
	end
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

	if command == "" or command == "options" then
		ns.showOptions()
	elseif command == "status" then
		status()
	elseif command == "on" or command == "off" then
		ns.setRecording(command == "on")
		ns.sayRecording()
	elseif command == "record" then
		record(rest)
	elseif command == "channel" then
		channel(rest)
	elseif command == "icon" then
		icon(rest)
	elseif command == "note" then
		note(rest)
	elseif command == "prune" then
		prune(rest)
	elseif command == "limit" then
		limit(rest)
	elseif command == "archive" then
		archive(rest)
	else
		help()
	end
end
