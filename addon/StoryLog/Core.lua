-- StoryLog records chat, who said it and where, for reading in the story-log app.
--
-- The game hides some values from add-ons ("secret values"). Comparing, joining or
-- indexing with one is an error, and they can't be saved. So every value that comes
-- from the game goes through `safe` or `try` first, and nothing past that is secret.

local ADDON, ns = ...

local VERSION = 1
local PRUNE_HINT_AT = 50000

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

local function say(message)
	print("|cffa99cf0StoryLog:|r " .. message)
end

ns.safe, ns.try, ns.filled, ns.finite, ns.say = safe, try, filled, finite, say

--------------------------------------------------------------------------------
-- What is recorded

ns.CATEGORIES = { "speech", "rolls", "guild", "channels", "notices" }

local DEFAULTS = { recording = true, speech = true, rolls = true, guild = true, channels = false, notices = false }

local EVENTS = {
	speech = {
		"SAY", "YELL", "EMOTE", "TEXT_EMOTE",
		"PARTY", "PARTY_LEADER", "RAID", "RAID_LEADER", "RAID_WARNING",
		"INSTANCE_CHAT", "INSTANCE_CHAT_LEADER",
		"WHISPER", "WHISPER_INFORM", "BN_WHISPER", "BN_WHISPER_INFORM",
		"MONSTER_SAY", "MONSTER_YELL", "MONSTER_EMOTE", "MONSTER_WHISPER", "MONSTER_PARTY",
		"RAID_BOSS_EMOTE", "RAID_BOSS_WHISPER",
	},
	guild = { "GUILD", "OFFICER", "GUILD_DISCORD" },
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

-- When the recorder says these, their target is probably whom they mean.
local ADDRESSED = { SAY = true, YELL = true, EMOTE = true, TEXT_EMOTE = true }

--------------------------------------------------------------------------------
-- Names

local me = {}
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

-- The roleplay name from Total RP 3, when there is one.
local function roleplayName(name, isSelf)
	local api = AddOn_TotalRP3
	local Player = api and api.Player
	if not Player then return nil end

	local rp = filled(try(function()
		local player = isSelf and Player.GetCurrentUser() or Player.static.CreateFromCharacterID(name)
		return player:GetFullName()
	end))
	if not rp then return nil end
	-- A default profile just repeats the character's name.
	if rp == name or rp == name:match("^([^%-]+)") then return nil end
	return rp
end

-- "%s rolls %d (%d-%d)", in the client's language, as a pattern that captures the name.
local function rollPattern(format)
	if type(format) ~= "string" then return nil end
	local pattern = format:gsub("%%%d?%$?s", "\1"):gsub("%%%d?%$?d", "\2")
	pattern = pattern:gsub("[%^%$%(%)%%%.%[%]%*%+%-%?]", "%%%0")
	pattern = pattern:gsub("\1", "(.+)"):gsub("\2", "%%d+")
	return "^" .. pattern .. "$"
end

local ROLL = rollPattern(RANDOM_ROLL_RESULT)

--------------------------------------------------------------------------------
-- The session

local speakerByKey = {}

-- The index of a speaker in this session's list.
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

	-- Looked up every time, because profiles arrive late. A changed name gets a new
	-- entry, so that earlier lines keep the name they were said under.
	local rp = roleplayName(name, name == me.name)
	if rp and rp ~= speaker.rp then
		if speaker.rp then
			index = #speakers + 1
			speakers[index] = { name = name, guid = speaker.guid, class = speaker.class, race = speaker.race, sex = speaker.sex }
			speakerByKey[key] = index
		end
		speakers[index].rp = rp
	end
	return index
end

local function add(message)
	local messages = ns.session.messages
	messages[#messages + 1] = message
end

local function now()
	return GetServerTime()
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

local function targetOfPlayer()
	local guid = filled(try(UnitGUID, "target"))
	if not guid or guid == me.guid then return nil end

	if guid:find("^Player%-") then
		local name = unitPlayerName("target")
		return name and speakerIndex(name, guid, false)
	elseif guid:find("^Creature%-") or guid:find("^Vehicle%-") then
		local name = filled((try(UnitName, "target")))
		return name and speakerIndex(name, guid, true)
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
	say("a chat line could not be recorded in full. /storylog shows the error.")
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

		message.s = speakerIndex(name, guid, npc)

		if isSelf then
			if ADDRESSED[event] then message.to = targetOfPlayer() end
		elseif not npc and event ~= "WHISPER_INFORM" then
			-- A roll has no GUID, but the speaker may be known from earlier lines.
			local id = guid or ns.session.speakers[message.s].guid
			if id then message.sp = ns.memberPlace(id) end
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

	local isSystem = chatType == "SYSTEM"
	if not settings[category] and not (isSystem and settings.rolls) then return end

	local rawText, rawSender, _, _, _, _, _, _, _, _, _, rawGUID = ...
	if issecret(rawText) then
		-- A hidden system line can't be told from a roll, so it only counts as a notice.
		if settings[category] then recordHidden() end
		return
	end

	local text = filled(rawText)
	if not text then return end
	local sender, guid = filled(safe(rawSender)), filled(safe(rawGUID))

	local event = chatType
	if isSystem then
		local roller
		if settings.rolls and ROLL then
			-- A pattern built from another language's wording could be one that Lua rejects.
			local ok, name = pcall(string.match, text, ROLL)
			roller = ok and name or nil
		end
		if roller then
			event, sender, guid = "ROLL", roller, nil
		elseif not settings.notices then
			return
		end
	end

	local message = { t = now(), e = event, m = text }
	add(message)

	local ok, problem = pcall(describe, message, sender, guid, ...)
	if not ok then failed(problem) end
end

-- Called for every chat event. An error must not reach the game: it would be hidden.
local function onChat(chatType, ...)
	local ok, problem = pcall(record, chatType, ...)
	if not ok then failed(problem) end
end

function ns.note(text)
	add({ t = now(), e = "NOTE", m = text, p = ns.playerPlace() })
end

function ns.lineCount()
	local count = 0
	for _, session in ipairs(ns.db.sessions) do
		count = count + #(session.messages or {})
	end
	return count
end

function ns.ownRoleplayName()
	return roleplayName(me.name, true)
end

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
		interface = finite((select(4, GetBuildInfo()))),
		locale = GetLocale(),
		language = filled((try(GetDefaultLanguage, "player"))),
		speakers = {},
		places = {},
		messages = {},
	}
	local sessions = ns.db.sessions
	sessions[#sessions + 1] = ns.session
end

local function endSession()
	local session, sessions = ns.session, ns.db.sessions
	if #session.messages > 0 then
		session.ended = now()
		return
	end
	for i = #sessions, 1, -1 do
		if sessions[i] == session then table.remove(sessions, i) end
	end
end

--------------------------------------------------------------------------------
-- Events

local frame = CreateFrame("Frame")

local function loadDatabase()
	local db = StoryLogDB
	if type(db) ~= "table" then
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
	for key, value in pairs(DEFAULTS) do
		if type(db.settings[key]) ~= "boolean" then db.settings[key] = value end
	end
	ns.db = db
end

local function onLogin()
	if ns.blocked then
		say("the saved log was made by a newer StoryLog, so nothing is recorded. Update the add-on.")
		return
	end
	if not ns.db then return end

	startSession()
	ns.updateRoster()

	for chatType in pairs(categoryOf) do
		-- Not every client has every event.
		pcall(frame.RegisterEvent, frame, "CHAT_MSG_" .. chatType)
	end
	frame:RegisterEvent("GROUP_ROSTER_UPDATE")
	frame:RegisterEvent("PLAYER_ENTERING_WORLD")
	frame:RegisterEvent("PLAYER_LOGOUT")

	if not ns.db.settings.recording then say("recording is off. /storylog on starts it.") end
	local lines = ns.lineCount()
	if lines >= PRUNE_HINT_AT then
		say(("%d lines are saved, which slows down login. Copy StoryLog.lua to the app's Data folder, then use /storylog prune 90."):format(lines))
	end
end

frame:SetScript("OnEvent", function(_, event, ...)
	if event == "ADDON_LOADED" then
		if (...) == ADDON then
			frame:UnregisterEvent(event)
			loadDatabase()
		end
	elseif event == "SAVED_VARIABLES_TOO_LARGE" then
		if (...) == ADDON then
			say("the saved log is too large to load, and the game won't save this session. Move StoryLog.lua out of SavedVariables.")
		end
	elseif event == "PLAYER_LOGIN" then
		onLogin()
	elseif event == "PLAYER_LOGOUT" then
		endSession()
	elseif event == "GROUP_ROSTER_UPDATE" or event == "PLAYER_ENTERING_WORLD" then
		ns.updateRoster()
	else
		onChat(event:sub(10), ...)
	end
end)

frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("PLAYER_LOGIN")
pcall(frame.RegisterEvent, frame, "SAVED_VARIABLES_TOO_LARGE")
