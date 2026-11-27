-- StoryLog records chat, who said it and where, for reading in the story-log app.
--
-- The game hides some values from add-ons ("secret values"). Comparing, joining or
-- indexing with one is an error, and they can't be saved. So every value that comes
-- from the game goes through `safe` or `try` first, and nothing past that is secret.

local ADDON, ns = ...

local VERSION = 1
-- In MB. Past it, finished sessions move to an archive file: see Archive.lua. Not past
-- the most, which is also what an archive file takes, as they all move to one.
local DEFAULT_LIMIT, MAX_LIMIT = 3, 8

local issecret = issecretvalue or function() return false end

local function safe(value)
	if issecret(value) then return nil end
	return value
end

local function clean(ok, ...)
	if not ok then return nil end
	local count = select("#", ...)
	local values = { ... }
	for i = 1, count do
		if issecret(values[i]) then values[i] = nil end
	end
	return unpack(values, 1, count)
end

-- Calls a game function that may be missing, may fail, or may return secrets.
local function try(fn, ...)
	if type(fn) ~= "function" then return nil end
	return clean(pcall(fn, ...))
end

local function filled(value)
	if type(value) == "string" and value ~= "" then return value end
end

local function finite(value)
	if type(value) == "number" and value == value and value > -math.huge and value < math.huge then
		return value
	end
end

-- Text of at most `bytes` bytes, cut where a character begins, so that no half of one is saved.
local function clip(text, bytes)
	text = filled(text)
	if not text or #text <= bytes then return text end
	local cut = bytes
	-- Bytes 128 to 191 continue a character.
	while cut > 0 and text:byte(cut + 1) and text:byte(cut + 1) >= 128 and text:byte(cut + 1) < 192 do cut = cut - 1 end
	return text:sub(1, cut) .. "…"
end

local function say(message)
	print("|cffa99cf0StoryLog:|r " .. message)
end

ns.safe, ns.try, ns.filled, ns.finite, ns.say, ns.clip = safe, try, filled, finite, say, clip
ns.VERSION, ns.DEFAULT_LIMIT, ns.MAX_LIMIT = VERSION, DEFAULT_LIMIT, MAX_LIMIT

--------------------------------------------------------------------------------
-- What is recorded

ns.CATEGORIES = {
	"speech", "party", "whispers", "creatures", "rolls", "guild", "channels", "notices",
	"group", "quests", "items", "travel", "combat", "npc", "actions", "profiles",
}

-- Where the icon sits on the edge of the minimap, in degrees counterclockwise from the
-- right: at the lower left.
local ICON_ANGLE = 210
ns.ICON_ANGLE = ICON_ANGLE

local DEFAULTS = {
	recording = true, icon = true,
	speech = true, party = true, whispers = true, creatures = true,
	rolls = true, guild = true, channels = false, notices = false,
	group = true, quests = true,
	items = true, travel = true, combat = true, npc = true, actions = true, profiles = true,
}

-- Once one switch, `speech`. A log from then gives them what it had for speech.
local FROM_SPEECH = { "party", "whispers", "creatures" }

local EVENTS = {
	speech = { "SAY", "YELL", "EMOTE", "TEXT_EMOTE" },
	party = {
		"PARTY", "PARTY_LEADER", "RAID", "RAID_LEADER", "RAID_WARNING",
		"INSTANCE_CHAT", "INSTANCE_CHAT_LEADER",
	},
	whispers = { "WHISPER", "WHISPER_INFORM", "BN_WHISPER", "BN_WHISPER_INFORM" },
	creatures = {
		"MONSTER_SAY", "MONSTER_YELL", "MONSTER_EMOTE", "MONSTER_WHISPER", "MONSTER_PARTY",
		"RAID_BOSS_EMOTE", "RAID_BOSS_WHISPER",
	},
	guild = { "GUILD", "OFFICER", "GUILD_DISCORD" },
	-- Numbered channels. Each can also be chosen by its name: see `chosenChannel`.
	channels = { "CHANNEL" },
	-- SYSTEM is also where dice rolls arrive.
	notices = {
		"SYSTEM", "LOOT", "MONEY", "SKILL", "CURRENCY", "OPENING", "TRADESKILLS",
		"ACHIEVEMENT", "GUILD_ACHIEVEMENT", "AFK", "DND",
		"COMBAT_XP_GAIN", "COMBAT_FACTION_CHANGE", "COMBAT_HONOR_GAIN",
		"BG_SYSTEM_ALLIANCE", "BG_SYSTEM_HORDE", "BG_SYSTEM_NEUTRAL",
	},
}

local categoryOf = {}
for category, types in pairs(EVENTS) do
	for _, chatType in ipairs(types) do categoryOf[chatType] = category end
end

-- The sender of these is an NPC.
local FROM_NPC = {
	MONSTER_SAY = true, MONSTER_YELL = true, MONSTER_EMOTE = true, MONSTER_WHISPER = true, MONSTER_PARTY = true,
	RAID_BOSS_EMOTE = true, RAID_BOSS_WHISPER = true,
}

-- These have no player behind them, whatever the sender argument holds.
local NO_SPEAKER = {
	BN_WHISPER = true, BN_WHISPER_INFORM = true,
	SYSTEM = true, LOOT = true, MONEY = true, SKILL = true, CURRENCY = true, OPENING = true, TRADESKILLS = true,
	COMBAT_XP_GAIN = true, COMBAT_FACTION_CHANGE = true, COMBAT_HONOR_GAIN = true,
	BG_SYSTEM_ALLIANCE = true, BG_SYSTEM_HORDE = true, BG_SYSTEM_NEUTRAL = true,
}

-- When these are said, the speaker's target is probably whom they mean.
local ADDRESSED = { SAY = true, YELL = true, EMOTE = true, TEXT_EMOTE = true }

-- A session with only these lines in it was not worth one.
local PASSING = { GROUP = true, ZONE = true }

--------------------------------------------------------------------------------
-- Events
--
-- Every module adds its handlers with `ns.on`. They are registered at login, and only
-- when this client has the event: registering one that it lacks is an error, and some
-- that it has are forbidden to add-ons, so nothing is ever tried blindly.

local frame = CreateFrame("Frame")
local handlers = {}
-- Events that are only wanted for one unit, such as the player's own spells.
local unitOf = {}
local registered = {}
ns.missing = {}

function ns.on(event, handler, unit)
	local list = handlers[event]
	if not list then
		list = {}
		handlers[event] = list
	end
	list[#list + 1] = handler
	unitOf[event] = unit
end

local function register(event)
	if registered[event] then return end
	local valid = C_EventUtils and C_EventUtils.IsEventValid
	if type(valid) == "function" and try(valid, event) == false then
		ns.missing[#ns.missing + 1] = event
		return
	end
	local unit = unitOf[event]
	local done = unit and type(frame.RegisterUnitEvent) == "function" and pcall(frame.RegisterUnitEvent, frame, event, unit)
	if done or pcall(frame.RegisterEvent, frame, event) then
		registered[event] = true
	else
		ns.missing[#ns.missing + 1] = event
	end
end

-- The game hides add-on errors unless the player turns them on, so a failure must be
-- counted and reported here, or lines would go missing unnoticed.
local failures = { count = 0 }
ns.failures = failures

local function failed(problem)
	failures.count = failures.count + 1
	if failures.count > 1 then return end
	failures.first = tostring(problem)
	local function tell() say("something could not be recorded in full. /storylog status shows the error.") end
	-- Not now: printing from inside one of the game's own functions taints the chat window.
	if not (C_Timer and type(C_Timer.After) == "function" and pcall(C_Timer.After, 0, tell)) then tell() end
end

ns.failed = failed

-- Runs a function after a while, unless this client has no timers. An error must not
-- reach the game, which would hide it.
function ns.after(seconds, fn)
	if not C_Timer or type(C_Timer.After) ~= "function" then return false end
	local ok = pcall(C_Timer.After, seconds, function()
		local fine, problem = pcall(fn)
		if not fine then failed(problem) end
	end)
	return ok
end

-- Runs `fn` after one of the game's own functions, given by its name or by its table
-- and name. A hook only stores what it sees. True if it is in place.
function ns.hook(owner, name, fn)
	if type(hooksecurefunc) ~= "function" then return false end
	if type(owner) == "string" then
		owner, name, fn = nil, owner, name
		if type(_G[name]) ~= "function" then return false end
	elseif type(owner) ~= "table" or type(owner[name]) ~= "function" then
		return false
	end
	local wrapped = function(...)
		local ok, problem = pcall(fn, ...)
		if not ok then failed(problem) end
	end
	if owner then return (pcall(hooksecurefunc, owner, name, wrapped)) end
	return (pcall(hooksecurefunc, name, wrapped))
end

-- True when this client has the event, and it is registered.
function ns.has(event)
	return registered[event] == true
end

--------------------------------------------------------------------------------
-- The game's wording
--
-- Much of what happens is told only as a line of system text: "You have invited Borin
-- to join your group." The client has each wording as a format string in its own
-- language, which becomes a pattern here.

-- A pattern that matches what `format` makes, and the argument that each capture holds.
function ns.pattern(format)
	if type(format) ~= "string" or format == "" then return nil end
	local parts, order, position, i = { "^" }, {}, 0, 1
	while i <= #format do
		local _, finish, index, kind = format:find("^%%(%d?)%$?([sd])", i)
		if finish then
			position = position + 1
			order[#order + 1] = tonumber(index) or position
			parts[#parts + 1] = kind == "s" and "(.-)" or "(%-?%d+)"
			i = finish + 1
		else
			local char = format:sub(i, i)
			if char == "%" and format:sub(i + 1, i + 1) == "%" then i = i + 1 end
			parts[#parts + 1] = (char:gsub("[%^%$%(%)%%%.%[%]%*%+%-%?]", "%%%0"))
			i = i + 1
		end
	end
	parts[#parts + 1] = "$"
	return table.concat(parts), order
end

-- The values that `format` filled in to make `text`, by argument number. Nil when it
-- didn't make it, including when a pattern from another language is one Lua rejects.
local function captures(text, pattern, order)
	local found = { pcall(string.match, text, pattern) }
	if not found[1] or found[2] == nil then return nil end
	local values, count = {}, 0
	for i, argument in ipairs(order) do
		values[argument] = found[i + 1]
		if argument > count then count = argument end
	end
	return values, count
end

local wordings = {}

-- Says that a line of `chatType` in the wording of the global string `name` means
-- something to the `category`. `handle` gets what was filled in, and the line is not
-- saved as a notice too.
function ns.wording(chatType, name, category, handle)
	local list = wordings[chatType]
	if not list then
		list = {}
		wordings[chatType] = list
	end
	list[#list + 1] = { name = name, category = category, handle = handle }
end

-- "%s rolls %d (%d-%d)", in the client's language.
local ROLL, ROLL_ORDER

-- At login, not while this file loads: a wording that the game hides must not stop the add-on.
local function learnWordings()
	ROLL, ROLL_ORDER = ns.pattern(safe(RANDOM_ROLL_RESULT))
	for _, list in pairs(wordings) do
		for _, wording in ipairs(list) do
			wording.pattern, wording.order = ns.pattern(safe(_G[wording.name]))
		end
	end
end

local function listening(chatType, settings)
	for _, wording in ipairs(wordings[chatType] or {}) do
		if settings[wording.category] then return true end
	end
	return false
end

-- True when the text is in one of the wordings, which has dealt with it.
local function heard(chatType, text, settings)
	for _, wording in ipairs(wordings[chatType] or {}) do
		if wording.pattern and settings[wording.category] then
			local values, count = captures(text, wording.pattern, wording.order)
			if values then
				local ok, problem = pcall(wording.handle, unpack(values, 1, count))
				if not ok then failed(problem) end
				return true
			end
		end
	end
	return false
end

-- The name of a player in a line of system text, which may be a link to them.
function ns.plainName(text)
	text = filled(text)
	if not text then return nil end
	text = text:gsub("|H.-|h(.-)|h", "%1"):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")
	return filled(text:match("^%[(.*)%]$") or text)
end

--------------------------------------------------------------------------------
-- Names

local me = {}
ns.me = me
local regional = false

-- A player's name as it is saved: "First Surname" in WoW Forever, "Name-Realm" elsewhere.
local function qualify(name)
	if not name or not me.realm then return name end
	local suffix = "-" .. me.realm
	if regional then
		if #name > #suffix and name:sub(-#suffix) == suffix then return name:sub(1, -#suffix - 1) end
		return name
	end
	if name:find("-", 1, true) then return name end
	return name .. suffix
end

ns.qualify = qualify

local function unitPlayerName(unit)
	local name, second = try(UnitNameUnmodified or UnitName, unit)
	name, second = filled(name), filled(second)
	if not name then return nil end
	if second then
		if regional then
			-- The second value is the surname here, but the first can already contain it.
			if not name:find(" ", 1, true) then name = name .. " " .. second end
		else
			name = name .. "-" .. second
		end
	end
	return qualify(name)
end

--------------------------------------------------------------------------------
-- The session

local speakerByKey = {}

-- The index of a speaker in this session's list, and their roleplay status from Total
-- RP 3: 1 in character, 2 out of character.
local function speakerIndex(name, guid, npc)
	local speakers = ns.session.speakers
	local npcID
	if npc and guid then
		-- Creature-0-server-instance-zone-ID-spawn
		npcID = guid:match("^Creature%-[^-]+%-[^-]+%-[^-]+%-[^-]+%-(%d+)%-")
			or guid:match("^Vehicle%-[^-]+%-[^-]+%-[^-]+%-[^-]+%-(%d+)%-")
	end

	local key = npc and ("npc:" .. (npcID or "") .. ":" .. name) or ("player:" .. name)
	local index = speakerByKey[key]
	if not index then
		index = #speakers + 1
		speakers[index] = { name = name }
		if npc then
			speakers[index].npc = true
			speakers[index].id = tonumber(npcID)
		end
		speakerByKey[key] = index
	end
	if npc then return index end

	local speaker = speakers[index]
	if guid and guid:find("^Player%-") then
		speaker.guid = guid
		if not speaker.class then
			local _, class, race, _, sex = try(GetPlayerInfoByGUID, guid)
			speaker.class, speaker.race, speaker.sex = filled(class), filled(race), finite(sex)
		end
	end

	-- Looked up every time, because profiles arrive late. A changed name or "currently",
	-- or a "currently" that was taken away, gets a new entry, so that earlier lines keep
	-- what was true when they were said.
	local rp, status, details = ns.profileOf(name, speaker.guid, name == me.name)
	local doing = details and details.now
	local renamed = rp and speaker.rp and rp ~= speaker.rp
	local moved = speaker.now and details and ((doing and doing ~= speaker.now) or (details.read and not doing))
	if renamed or moved then
		local copy = {}
		for field, value in pairs(speaker) do copy[field] = value end
		index = #speakers + 1
		speakers[index] = copy
		speakerByKey[key] = index
		speaker = copy
	end
	if rp then speaker.rp = rp end
	if details then
		for _, field in ipairs(ns.DETAILS) do
			local value = details[field]
			if value ~= nil then
				speaker[field] = value
			elseif details.read and field ~= "guild" then
				-- Their player removed it. A guild can also come from the game, which shows it
				-- only while they are in the group or targeted, so that one is kept.
				speaker[field] = nil
			end
		end
	end
	return index, status
end

local function add(message)
	local messages = ns.session.messages
	messages[#messages + 1] = message
	return message
end

local function now()
	return GetServerTime()
end

-- True while lines of that category are recorded.
function ns.recording(category)
	local settings = ns.db and ns.db.settings
	return ns.session ~= nil and settings ~= nil and settings.recording == true and settings[category] == true
end

-- A channel's name as a switch, and as it is shown. The game numbers channels and adds
-- the zone to its own, so "2. General - Elwynn Forest" and "General - Stormwind City"
-- are both "general", shown as "General". Nil for no name.
function ns.channelKey(name)
	name = filled(name)
	if not name then return nil end
	name = name:gsub("^%s*%d+%.%s*", "")
	local zone = name:find("%s+%-%s")
	if zone then name = name:sub(1, zone - 1) end
	local shown = filled(name:match("^%s*(.-)%s*$"))
	if not shown then return nil end
	return shown:lower(), shown
end

-- True when the channel of that name was chosen on its own.
local function chosenChannel(settings, name)
	local key = ns.channelKey(name)
	local names = settings.channelNames
	return key ~= nil and type(names) == "table" and names[key] == true
end

-- The channels that the player is in, as { key =, name = }, in the game's order. Some
-- clients give a number and a name for each, others a third value too.
function ns.joinedChannels()
	local values = { n = 0 }
	local function keep(...)
		values.n = select("#", ...)
		for i = 1, values.n do values[i] = select(i, ...) end
	end
	keep(try(GetChannelList))

	local joined, seen, i = {}, {}, 1
	while i <= values.n do
		local id, name = values[i], values[i + 1]
		if type(id) == "number" and type(name) == "string" then
			local key, shown = ns.channelKey(name)
			if key and not seen[key] then
				seen[key] = true
				joined[#joined + 1] = { key = key, name = shown }
			end
			i = i + 2
		else
			i = i + 1
		end
	end
	return joined
end

--------------------------------------------------------------------------------
-- Switches, for /storylog and its window alike. A switch takes effect at once: every
-- event is registered at login, and the settings are read whenever one arrives.

local function changed()
	if ns.refreshOptions then ns.refreshOptions() end
	if ns.refreshIcon then ns.refreshIcon() end
end

function ns.setRecording(on)
	ns.db.settings.recording = on == true
	changed()
end

-- Shows or hides the icon at the minimap.
function ns.setIcon(on)
	ns.db.settings.icon = on == true
	changed()
end

-- False when there is no such category.
function ns.setCategory(category, on)
	for _, known in ipairs(ns.CATEGORIES) do
		if known == category then
			ns.db.settings[known] = on == true
			changed()
			return true
		end
	end
	return false
end

-- Chooses a channel by its name, or forgets it. Its key, or nil for no name.
function ns.setChannel(name, on)
	local key = ns.channelKey(name)
	if not key then return nil end
	ns.db.settings.channelNames[key] = on == true or nil
	changed()
	return key
end

-- Saves a line about something that happened. `fields` are the line's own; `s` is the
-- one who did it, the recorder unless it says otherwise, and `false` for nobody.
-- Nil while that category is not recorded.
function ns.event(category, event, fields)
	if not ns.recording(category) then return nil end
	local message = fields or {}
	local who = message.s
	message.t, message.e, message.s = now(), event, nil
	add(message)
	-- What follows can fail: the line is saved already.
	local ok, problem = pcall(function()
		if not message.p then message.p = ns.playerPlace() end
		if who == nil then who = speakerIndex(me.name, me.guid, false) end
		message.s = who or nil
	end)
	if not ok then failed(problem) end
	return message
end

local function recordHidden()
	local messages = ns.session.messages
	local last = messages[#messages]
	if last and last.e == "HIDDEN" then
		last.n = last.n + 1
	else
		add({ t = now(), e = "HIDDEN", n = 1, p = ns.playerPlace() })
	end
end

-- The speaker index of whoever `unit` is, unless that is the one with the GUID `except`.
local function unitSpeaker(unit, except)
	local guid = filled(try(UnitGUID, unit))
	if not guid or guid == except then return nil end

	if guid:find("^Player%-") then
		local name = guid == me.guid and me.name or unitPlayerName(unit)
		return name and (speakerIndex(name, guid, false))
	elseif guid:find("^Creature%-") or guid:find("^Vehicle%-") or guid:find("^GameObject%-") then
		local name = filled((try(UnitName, unit)))
		return name and (speakerIndex(name, guid, true))
	end
end

-- Adds who said it and where. The text is already saved when this runs, so whatever
-- goes wrong here costs the details and never the line.
local function describe(message, sender, guid, ...)
	local event = message.e
	local _, _, rawLanguage, rawChannel, _, rawFlags, _, _, rawBaseName = ...

	message.p = ns.playerPlace()

	if event == "GUILD_DISCORD" and not sender then
		local info = safe((select(18, ...)))
		if type(info) == "table" then sender = filled(safe(info.lastOnlineName)) end
	end

	if sender and not NO_SPEAKER[event] then
		local npc = FROM_NPC[event] == true
		local name = npc and sender or qualify(sender)
		local isSelf = not npc and (name == me.name or (guid ~= nil and guid == me.guid))
		if isSelf then name, guid = me.name, me.guid end

		local index, status = speakerIndex(name, guid, npc)
		message.s = index
		if status == 2 and ns.db.settings.profiles then message.ooc = true end

		if isSelf then
			if ADDRESSED[event] then message.to = unitSpeaker("target", me.guid) end
		elseif not npc and event ~= "WHISPER_INFORM" then
			-- A roll has no GUID, but the speaker may be known from earlier lines.
			local id = guid or ns.session.speakers[index].guid
			if id then
				message.sp = ns.memberPlace(id)
				-- Whom a group member had targeted, which the game shows for them only.
				local unit = ADDRESSED[event] and ns.memberUnit(id)
				if unit then message.to = unitSpeaker(unit .. "target", id) end
			end
		end
	end

	local language = filled(safe(rawLanguage))
	if language and language ~= ns.session.language then message.lang = language end
	local flag = filled(safe(rawFlags))
	if flag then message.flag = flag end
	if event == "CHANNEL" then message.ch = filled(safe(rawBaseName)) or filled(safe(rawChannel)) end
end

local function record(chatType, ...)
	local category = categoryOf[chatType]
	local settings = ns.db.settings
	if not settings.recording then return end

	local wanted = settings[category] == true
	if not wanted and chatType == "CHANNEL" then
		-- A hidden name chooses nothing.
		local _, _, _, rawChannel, _, _, _, _, rawBaseName = ...
		wanted = chosenChannel(settings, filled(safe(rawBaseName)) or filled(safe(rawChannel)))
	end

	local isSystem = chatType == "SYSTEM"
	local rolls = isSystem and settings.rolls
	local listened = listening(chatType, settings)
	if not wanted and not rolls and not listened then return end

	local rawText, rawSender, _, _, _, _, _, _, _, _, _, rawGUID = ...
	if issecret(rawText) then
		-- A hidden system line can't be told from a roll, so it only counts as a notice.
		if wanted then recordHidden() end
		return
	end

	local text = filled(rawText)
	if not text then return end
	local sender, guid = filled(safe(rawSender)), filled(safe(rawGUID))

	local event = chatType
	if rolls and ROLL then
		local values = captures(text, ROLL, ROLL_ORDER)
		local roller = values and filled(values[1])
		if roller then event, sender, guid = "ROLL", roller, nil end
	end
	if event == chatType then
		if listened and heard(chatType, text, settings) then return end
		if not wanted then return end
	end

	local message = add({ t = now(), e = event, m = text })
	local ok, problem = pcall(describe, message, sender, guid, ...)
	if not ok then failed(problem) end
end

--------------------------------------------------------------------------------
-- Quests

-- The quests in the quest log that the player can see. Nil on a client without the
-- functions to tell, where every quest is recorded.
local visibleQuests

-- The game also "accepts" and "hands in" hidden quests that only keep track of things,
-- and tasks that start by walking into an area.
local function shown(info)
	return type(info) == "table" and safe(info.isHeader) ~= true and safe(info.isHidden) ~= true and safe(info.isTask) ~= true
end

local function scanQuests()
	local log = C_QuestLog
	if not log or type(log.GetInfo) ~= "function" then return end
	local count = finite(try(log.GetNumQuestLogEntries))
	if not count then return end

	visibleQuests = visibleQuests or {}
	for index = 1, count do
		local info = try(log.GetInfo, index)
		local id = shown(info) and finite(safe(info.questID))
		if id then visibleQuests[id] = true end
	end
end

local function acceptedIsShown(id)
	local log = C_QuestLog
	local index = log and finite(try(log.GetLogIndexForQuestID, id))
	if not index then return true end
	local info = try(log.GetInfo, index)
	return type(info) ~= "table" or shown(info)
end

local function questTitle(id)
	local log = C_QuestLog
	return log and filled(try(log.GetTitleForQuestID, id)) or nil
end

-- Adds the title, the place, the quest's NPC and what the NPC said about it. The line
-- is already saved.
local function describeQuest(message)
	message.p = ns.playerPlace()
	message.m = questTitle(message.q)
	message.s = speakerIndex(me.name, me.guid, false)

	-- "npc" is whoever the quest window belongs to, while it is open.
	local guid = filled(try(UnitGUID, "npc"))
	if guid and (guid:find("^Creature%-") or guid:find("^Vehicle%-")) then
		local name = filled((try(UnitName, "npc")))
		if name then message.to = speakerIndex(name, guid, true) end
	end

	local said = ns.questWords(message.e, message.q, message.m)
	if said then message.text, message.goal = said.text, said.goal end
end

local function recordQuest(event, first, second)
	-- Some clients put the quest log index first when a quest is accepted.
	local id = event == "QUEST_ACCEPTED" and finite(safe(second)) or finite(safe(first))
	if not id then return end

	if visibleQuests then
		if event == "QUEST_ACCEPTED" then
			if not acceptedIsShown(id) then return end
			visibleQuests[id] = true
		else
			if not visibleQuests[id] then return end
			visibleQuests[id] = nil
		end
	end

	local settings = ns.db.settings
	if not settings.recording or not settings.quests then return end

	local message = add({ t = now(), e = event, q = id })

	local ok, problem = pcall(describeQuest, message)
	if not ok then failed(problem) end

	-- The title of a quest that the game has not loaded yet arrives a moment later.
	if not message.m then
		ns.after(1, function()
			if not message.m then message.m = questTitle(id) end
		end)
	end
end

function ns.note(text)
	add({ t = now(), e = "NOTE", m = text, p = ns.playerPlace() })
end

ns.add, ns.now, ns.speakerIndex, ns.unitPlayerName, ns.unitSpeaker = add, now, speakerIndex, unitPlayerName, unitSpeaker

function ns.lineCount()
	local count = 0
	for _, session in ipairs(ns.db.sessions) do
		count = count + #(session.messages or {})
	end
	return count
end

function ns.ownRoleplayName()
	return (ns.profileOf(me.name, me.guid, true))
end

--------------------------------------------------------------------------------
-- Time and festivals

-- The game world's time, in minutes after midnight. Not the server's clock.
local function gameMinutes()
	local hour, minute = try(GetGameTime)
	hour, minute = finite(hour), finite(minute)
	if not hour or not minute or hour < 0 or hour > 23 or minute < 0 or minute > 59 then return nil end
	return hour * 60 + minute
end

-- The festivals of today, which the game knows only once the calendar has been read.
-- Until then it says that there are none, so finding none is no answer.
local function readHolidays()
	local session, calendar = ns.session, C_Calendar
	if not session or session.holidays or not calendar or not ns.db.settings.recording then return end

	local today = C_DateAndTime and try(C_DateAndTime.GetCurrentCalendarTime)
	local day = type(today) == "table" and finite(safe(today.monthDay))
	if not day then return end
	-- The calendar shows the month that was last looked at.
	local shownMonth = try(calendar.GetMonthInfo, 0)
	if type(shownMonth) == "table" and (safe(shownMonth.month) ~= safe(today.month) or safe(shownMonth.year) ~= safe(today.year)) then
		return
	end

	local count = finite(try(calendar.GetNumDayEvents, 0, day))
	if not count then return end
	local names, seen = {}, {}
	for index = 1, math.min(count, 20) do
		local info = try(calendar.GetDayEvent, 0, day, index)
		local title = type(info) == "table" and filled(safe(info.title))
		if title and safe(info.calendarType) == "HOLIDAY" and not seen[title] then
			seen[title] = true
			names[#names + 1] = clip(title, 80)
		end
	end
	if #names > 0 then session.holidays = names end
end

ns.on("CALENDAR_UPDATE_EVENT_LIST", readHolidays)

--------------------------------------------------------------------------------
-- Sessions

local function startSession()
	regional = try(RegionalUniqueNamesEnabled) == true
	me.guid = filled(try(UnitGUID, "player"))
	me.realm = filled(try(GetNormalizedRealmName))
	me.name = unitPlayerName("player") or "Unknown"

	local started = now()
	ns.session = {
		id = started .. "-" .. (me.guid or me.name),
		character = me.name,
		guid = me.guid,
		realm = not regional and me.realm or nil,
		started = started,
		clock = gameMinutes(),
		interface = finite((select(4, GetBuildInfo()))),
		locale = GetLocale(),
		language = filled((try(GetDefaultLanguage, "player"))),
		speakers = {},
		places = {},
		messages = {},
	}
	local sessions = ns.db.sessions
	sessions[#sessions + 1] = ns.session

	readHolidays()
	-- Asks the server for the calendar, which answers with CALENDAR_UPDATE_EVENT_LIST.
	if C_Calendar then try(C_Calendar.OpenCalendar) end
end

local function endSession()
	local session, sessions = ns.session, ns.db.sessions
	-- Being in a group, or walking about, is not worth a session of its own.
	local happened = false
	for _, message in ipairs(session.messages) do
		if not PASSING[message.e] then
			happened = true
			break
		end
	end
	if happened then
		session.ended = now()
		return
	end
	for i = #sessions, 1, -1 do
		if sessions[i] == session then table.remove(sessions, i) end
	end
end

--------------------------------------------------------------------------------
-- Loading

local function loadDatabase()
	local db = StoryLogDB
	if type(db) ~= "table" then
		-- This character has saved a log before, so the game should have given one.
		ns.lost = type(StoryLogCharDB) == "table" and StoryLogCharDB.saved == true
		db = {}
		StoryLogDB = db
	end
	if type(db.version) == "number" and db.version > VERSION then
		ns.blocked = true
		return
	end
	db.version = VERSION
	if type(db.sessions) ~= "table" then db.sessions = {} end
	if type(db.settings) ~= "table" then db.settings = {} end
	local settings = db.settings
	if type(settings.speech) == "boolean" then
		for _, key in ipairs(FROM_SPEECH) do
			if type(settings[key]) ~= "boolean" then settings[key] = settings.speech end
		end
	end
	for key, value in pairs(DEFAULTS) do
		if type(settings[key]) ~= "boolean" then settings[key] = value end
	end
	-- Channels chosen by name: { general = true }.
	local names = {}
	if type(settings.channelNames) == "table" then
		for key, value in pairs(settings.channelNames) do
			if type(key) == "string" and value == true then names[key] = true end
		end
	end
	settings.channelNames = names
	settings.iconAngle = (finite(settings.iconAngle) or ICON_ANGLE) % 360
	if not finite(db.settings.limit) or db.settings.limit < 0 then db.settings.limit = DEFAULT_LIMIT end
	if db.settings.limit > MAX_LIMIT then db.settings.limit = MAX_LIMIT end
	ns.db = db
end

for chatType in pairs(categoryOf) do
	ns.on("CHAT_MSG_" .. chatType, function(...) record(chatType, ...) end)
end
ns.on("QUEST_ACCEPTED", function(...) recordQuest("QUEST_ACCEPTED", ...) end)
ns.on("QUEST_TURNED_IN", function(...) recordQuest("QUEST_TURNED_IN", ...) end)
-- The quest log is read again each time, as it may not be there yet at login.
local function lookAround()
	ns.updateRoster()
	scanQuests()
end
ns.on("GROUP_ROSTER_UPDATE", lookAround)
ns.on("PLAYER_ENTERING_WORLD", lookAround)

local function onLogin()
	if ns.blocked then
		say("the saved log was made by a newer StoryLog, so nothing is recorded. Update the add-on.")
		return
	end
	if not ns.db then return end

	if ns.lost then
		say("|cffff7070the game did not load your saved log.|r If you did not delete it yourself, copy StoryLog.lua and StoryLog.lua.bak out of SavedVariables now, before you log out or reload.")
	end

	-- Before the session starts, so that only finished sessions can move.
	local ok, problem = pcall(ns.archiveAtLogin)
	if not ok then say("the log could not be split: " .. tostring(problem)) end

	learnWordings()
	startSession()
	ns.updateRoster()
	scanQuests()
	for _, start in ipairs(ns.starters) do
		local fine, trouble = pcall(start)
		if not fine then failed(trouble) end
	end

	for event in pairs(handlers) do register(event) end
	frame:RegisterEvent("PLAYER_LOGOUT")

	if not ns.db.settings.recording then say("recording is off. /storylog on, or /storylog for the window, starts it.") end
end

-- What the other modules want done at login, once the session exists.
ns.starters = {}
function ns.atLogin(fn)
	ns.starters[#ns.starters + 1] = fn
end

frame:SetScript("OnEvent", function(_, event, ...)
	if event == "ADDON_LOADED" then
		if (...) == ADDON then
			frame:UnregisterEvent(event)
			loadDatabase()
		end
	elseif event == "SAVED_VARIABLES_TOO_LARGE" then
		local name = ...
		if type(name) == "string" and name:find("^StoryLog") then
			say(("%s.lua is too large to load, and the game won't save it this session. Move it out of SavedVariables."):format(name))
		end
	elseif event == "PLAYER_LOGIN" then
		onLogin()
	elseif event == "PLAYER_LOGOUT" then
		endSession()
		StoryLogCharDB = { saved = true }
	else
		-- An error must not reach the game: it would be hidden.
		for _, handler in ipairs(handlers[event] or {}) do
			local ok, problem = pcall(handler, ...)
			if not ok then failed(problem) end
		end
	end
end)

frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("PLAYER_LOGIN")
pcall(frame.RegisterEvent, frame, "SAVED_VARIABLES_TOO_LARGE")
