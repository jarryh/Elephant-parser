-- What Total RP 3 says about a character: their roleplay name, whether their player is
-- in character, and what their profile tells about them. And their guild.

local _, ns = ...
local try, safe, filled, finite, clip = ns.try, ns.safe, ns.filled, ns.finite, ns.clip

-- What is saved with a speaker, and how many bytes of each.
local LIMITS = {
	title = 120, rpRace = 60, rpClass = 60, pron = 40, age = 40, eyes = 40, height = 40, build = 60,
	now = 300, glance = 600, look = 1200, guild = 80,
}
ns.DETAILS = { "title", "rpRace", "rpClass", "pron", "age", "eyes", "height", "build", "now", "glance", "look", "guild" }

-- A profile is read at most this often per character, as that is not free.
local REFRESH = 30
local readAt = {}

local function playerOf(name, isSelf)
	local api = AddOn_TotalRP3
	local Player = api and api.Player
	if not Player then return nil end
	local player = try(function()
		if isSelf then return Player.GetCurrentUser() end
		return Player.static.CreateFromCharacterID(name)
	end)
	return type(player) == "table" and player or nil
end

-- A method of a profile, which older versions may lack.
local function ask(player, method)
	return try(function() return player[method](player) end)
end

local function text(value, key)
	value = filled(safe(value))
	return value and clip(value, LIMITS[key])
end

local function field(owner, key)
	local value = type(owner) == "table" and safe(owner[key])
	return value or nil
end

-- The "at first glance" notes that are shown.
local function glances(profile)
	local slots = field(field(profile, "misc"), "PE")
	if type(slots) ~= "table" then return nil end
	local parts = {}
	for slot = 1, 5 do
		local glance = slots[tostring(slot)] or slots[slot]
		if type(glance) == "table" and field(glance, "AC") then
			local title, body = filled(field(glance, "TI")), filled(field(glance, "TX"))
			local part = title and body and (title .. ": " .. body) or title or body
			if part then parts[#parts + 1] = part end
		end
	end
	return #parts > 0 and clip(table.concat(parts, " / "), LIMITS.glance) or nil
end

-- The physical description, which only the third template of "About" has.
local function looks(profile)
	local about = field(profile, "about")
	if field(about, "TE") ~= 3 then return nil end
	return text(field(field(field(about, "T3"), "PH"), "TX"), "look")
end

-- The guild that the game shows, for those whose unit is known: you, your group, your target.
local function gameGuild(guid, isSelf)
	local unit = isSelf and "player" or (guid and ns.memberUnit(guid))
	if not unit and guid and try(UnitGUID, "target") == guid then unit = "target" end
	return unit and text((try(GetGuildInfo, unit)), "guild")
end

local function details(player, guid, isSelf)
	local found = {}
	local profile = player and ask(player, "GetProfile")
	if type(profile) == "table" then
		local traits = field(profile, "characteristics")
		found.title = text(ask(player, "GetFullTitle"), "title") or text(ask(player, "GetTitle"), "title")
		found.rpRace = text(ask(player, "GetCustomRace"), "rpRace")
		found.rpClass = text(ask(player, "GetCustomClass"), "rpClass")
		found.pron = text(ask(player, "GetCustomPronouns"), "pron")
		found.age = text(field(traits, "AG"), "age")
		found.eyes = text(field(traits, "EC"), "eyes")
		found.height = text(field(traits, "HE"), "height")
		found.build = text(field(traits, "WE"), "build")
		found.now = text(ask(player, "GetCurrentlyText"), "now")
		found.glance = glances(profile)
		found.look = looks(profile)
		local guild = ask(player, "GetCustomGuildMembership")
		found.guild = text(field(guild, "name"), "guild")
	end
	found.guild = found.guild or gameGuild(guid, isSelf)
	return found, type(profile) == "table"
end

-- The roleplay name of a character, their roleplay status (1 in character, 2 out of
-- character), and, with profiles recorded, what is known about them: a table with the
-- fields of `ns.DETAILS` and `read`, or nil when it was read too recently to read again.
function ns.profileOf(name, guid, isSelf)
	if not name then return nil end
	local player = playerOf(name, isSelf)
	local rp = player and filled(ask(player, "GetFullName"))
	-- A default profile just repeats the character's name.
	if rp and (rp == name or rp == name:match("^([^%-]+)")) then rp = nil end
	if not ns.db.settings.profiles then return rp end

	local status = player and finite(ask(player, "GetRoleplayStatus"))
	local time = ns.now()
	if readAt[name] and time - readAt[name] < REFRESH then return rp, status end
	local found, fromProfile = details(player, guid, isSelf)
	-- A profile that is not there yet may arrive any moment, so only a read one waits.
	if fromProfile then readAt[name] = time end
	-- Only a profile that was read can say that something is no longer in it.
	found.read = fromProfile
	return rp, status, found
end
