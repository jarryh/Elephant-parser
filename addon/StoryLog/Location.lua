-- Where the recorder and their group members are, who is in the group, and how the
-- recorder travels.
--
-- The game gives positions for you and your group only, and none inside dungeons,
-- raids and battlegrounds. Zone and instance names still work there.

local _, ns = ...
local try, safe, filled, finite = ns.try, ns.safe, ns.filled, ns.finite

-- A new place is saved only after moving this far.
local MOVED_YARDS = 3
local MOVED_ON_MAP = 0.002

local NAME_KEYS = { "map", "zone", "sub", "mini", "inst", "indoors", "neighborhood", "house", "room", "cont" }
-- What a place is called, as opposed to where on it you are.
local PLACE_NAMES = { "zone", "sub", "mini", "inst", "neighborhood", "house", "room" }

-- A raid that is filling up changes many times within seconds. It is saved as one line.
local GROUP_SETTLES = 10
-- How long after login the game may take to know the group that you are in.
local LOGIN_SETTLES = 10
-- How long you have to stay in a part of a zone before it counts as somewhere you went.
local ZONE_SETTLES = 20

local lastPlace = {}
local roster = {}
-- The group as it was last saved: "" for none, nil before the first look.
local lastGroup

local function round(value, scale)
	return math.floor(value * scale + 0.5) / scale
end

local function addPosition(place, unit)
	local C_Map = C_Map
	local map = C_Map and finite(try(C_Map.GetBestMapForUnit, unit))
	if map then
		place.map = map
		local position = try(C_Map.GetPlayerMapPosition, map, unit)
		if type(position) == "table" then
			local x, y = try(position.GetXY, position)
			x, y = finite(x), finite(y)
			-- 0,0 is the corner that stands for "unknown".
			if x and y and (x > 0 or y > 0) then
				place.x, place.y = round(x, 10000), round(y, 10000)
			end
		end
	end

	-- In yards, for distances. The first is north-south, the second east-west.
	local north, west, _, continent = try(UnitPosition, unit)
	north, west = finite(north), finite(west)
	if north and west and (north ~= 0 or west ~= 0) then
		place.wx, place.wy = round(north, 10), round(west, 10)
		place.cont = finite(continent)
	end
end

-- Player housing, which only retail has.
local function addHousing(place)
	local housing = C_Housing
	if not housing then return end

	if try(housing.IsInsideHouseOrPlot) == true then
		local info = try(housing.GetCurrentHouseInfo)
		if type(info) == "table" then
			place.neighborhood = filled(safe(info.neighborhoodName))
			place.house = filled(safe(info.houseName)) or filled(safe(info.ownerName))
		end
		if try(housing.IsInsideHouse) == true and C_HousingLayout then
			place.room = filled(try(C_HousingLayout.GetRoomPlayerIsIn))
		end
	elseif try(housing.IsOnNeighborhoodMap) == true and C_HousingNeighborhood then
		place.neighborhood = filled(try(C_HousingNeighborhood.GetNeighborhoodName))
	end
end

function ns.describePlayer()
	local place = {}
	addPosition(place, "player")

	local zone = filled(try(GetRealZoneText)) or filled(try(GetZoneText))
	local sub = filled(try(GetSubZoneText))
	local mini = filled(try(GetMinimapZoneText))
	place.zone = zone
	if sub ~= zone then place.sub = sub end
	if mini ~= zone and mini ~= sub then place.mini = mini end

	local indoors = try(IsIndoors)
	if type(indoors) == "boolean" then place.indoors = indoors end

	if try(IsInInstance) == true then
		local name, kind = try(GetInstanceInfo)
		place.inst, place.instType = filled(name), filled(kind)
	end

	addHousing(place)
	return place
end

local function sameNames(old, new)
	for _, key in ipairs(PLACE_NAMES) do
		if old[key] ~= new[key] then return false end
	end
	return true
end

local function samePlace(old, new)
	for _, key in ipairs(NAME_KEYS) do
		if old[key] ~= new[key] then return false end
	end
	if old.wx and new.wx then
		local dx, dy = old.wx - new.wx, old.wy - new.wy
		return dx * dx + dy * dy < MOVED_YARDS * MOVED_YARDS
	end
	if old.x and new.x then
		return math.abs(old.x - new.x) < MOVED_ON_MAP and math.abs(old.y - new.y) < MOVED_ON_MAP
	end
	return old.x == new.x and old.wx == new.wx
end

-- The index of a place in this session's list. `who` keeps two people from taking turns
-- to add the same two places.
local function store(who, place)
	local places = ns.session.places
	local last = lastPlace[who]
	if last and samePlace(places[last], place) then return last end

	local index = #places + 1
	places[index] = place
	lastPlace[who] = index
	return index
end

function ns.playerPlace()
	return store("player", ns.describePlayer())
end

-- The unit of a group member, while that roster slot is still theirs.
function ns.memberUnit(guid)
	local unit = roster[guid]
	if unit and try(UnitGUID, unit) == guid then return unit end
end

local function describeMember(guid)
	local unit = ns.memberUnit(guid)
	if not unit then return nil end

	local place = {}
	addPosition(place, unit)
	if not place.x and not place.wx then return nil end

	if place.map then
		local info = try(C_Map.GetMapInfo, place.map)
		if type(info) == "table" then place.zone = filled(safe(info.name)) end
	end
	return place
end

function ns.memberPlace(guid)
	local place = describeMember(guid)
	if place then return store(guid, place) end
end

--------------------------------------------------------------------------------
-- The group

-- The game says why a group ended in a message, which comes before or after the roster
-- empties. So either the reason waits for the line, { why =, at = }, or the line waits
-- for its reason, { line =, at = }.
local ending, left
-- Who led the group when it was last saved: { name =, guid = }.
local lastLeader

local function recordGroup(inRaid, units)
	local settings = ns.db.settings
	if not ns.session or not settings.recording or not settings.group then return end

	-- How many others the game says there are. During some fights it hides who they are,
	-- and then nothing is saved: it would look as if they had left.
	local others = #units
	if type(IsInGroup) == "function" then
		others = try(IsInGroup) == true and math.max(0, (finite(try(GetNumGroupMembers)) or 1) - 1) or 0
	end

	local members = {}
	for _, unit in ipairs(units) do
		local name = ns.unitPlayerName(unit.unit)
		if name then members[#members + 1] = { name = name, guid = unit.guid, unit = unit.unit } end
	end
	if #members < others then return end
	if others == 0 then members = {} end
	table.sort(members, function(a, b) return a.name < b.name end)

	-- Who leads. When the game can't say for a moment, the one who led still does, if they
	-- are still here: otherwise that moment would be a line, and its end another.
	local leader
	if #members > 0 then
		if try(UnitIsGroupLeader, "player") == true then
			leader = ns.me
		else
			for _, member in ipairs(members) do
				if try(UnitIsGroupLeader, member.unit) == true then leader = member end
			end
		end
		if not leader and lastLeader then
			if lastLeader.guid == ns.me.guid then leader = ns.me end
			for _, member in ipairs(members) do
				if member.guid == lastLeader.guid then leader = member end
			end
		end
	end

	local parts = {}
	for i, member in ipairs(members) do parts[i] = member.guid end
	local key = #members == 0 and "" or (inRaid and "raid:" or "party:") .. table.concat(parts, ",") .. "|" .. (leader and leader.guid or "")
	if key == lastGroup then return end

	local time = ns.now()
	-- The first look of a session. Shortly after login, a group is one that you were in already.
	local first = lastGroup == nil
	local atLogin = time - ns.session.started <= LOGIN_SETTLES
	if first and key == "" then
		-- Not being in a group needs no line. At login the game may not know the group yet,
		-- so "none" is believed only after a while.
		if not atLogin then lastGroup = key end
		return
	end
	lastGroup = key
	lastLeader = leader and { name = leader.name, guid = leader.guid } or nil

	local list = {}
	for i, member in ipairs(members) do list[i] = (ns.speakerIndex(member.name, member.guid, false)) end
	local lead = leader and (ns.speakerIndex(leader.name, leader.guid, false))

	local why
	if key == "" then
		if ending and time - ending.at <= GROUP_SETTLES then why = ending.why end
		ending = nil
	end

	local messages = ns.session.messages
	local line = messages[#messages]
	if line and line.e == "GROUP" and time - line.t < GROUP_SETTLES then
		line.g, line.raid, line.lead, line.why = list, inRaid or nil, lead, why
	else
		line = ns.add({
			t = time, e = "GROUP", g = list, raid = inRaid or nil, lead = lead, why = why,
			start = first and atLogin or nil, p = ns.playerPlace(),
		})
	end
	left = key == "" and not why and { line = line, at = time } or nil
end

function ns.updateRoster()
	local found, units = {}, {}
	local inRaid = try(IsInRaid) == true
	local count = inRaid and (finite(try(GetNumGroupMembers)) or 0) or 4
	local prefix = inRaid and "raid" or "party"
	local own = try(UnitGUID, "player")

	for i = 1, count do
		local unit = prefix .. i
		local guid = filled(try(UnitGUID, unit))
		if guid and guid ~= own then
			found[guid] = unit
			units[#units + 1] = { unit = unit, guid = guid }
		end
	end
	roster = found

	local ok, problem = pcall(recordGroup, inRaid, units)
	if not ok then ns.say("the group could not be recorded: " .. tostring(problem)) end
end

ns.on("PARTY_LEADER_CHANGED", function() ns.updateRoster() end)

-- For the status line: how many group members have a position right now.
function ns.groupPositions()
	local known, total = 0, 0
	for guid in pairs(roster) do
		total = total + 1
		if describeMember(guid) then known = known + 1 end
	end
	return known, total
end

local function person(name)
	name = ns.plainName(name)
	return name and (ns.speakerIndex(ns.qualify(name), nil, false))
end

local function ended(why)
	return function()
		local time = ns.now()
		if left and not left.line.why and #left.line.g == 0 and time - left.at <= GROUP_SETTLES then
			left.line.why, left = why, nil
		else
			ending = { why = why, at = time }
		end
	end
end

ns.wording("SYSTEM", "ERR_LEFT_GROUP_YOU", "group", ended("left"))
ns.wording("SYSTEM", "ERR_GROUP_DISBANDED", "group", ended("disbanded"))
ns.wording("SYSTEM", "ERR_UNINVITE_YOU", "group", ended("removed"))
ns.wording("SYSTEM", "ERR_INVITE_PLAYER_S", "group", function(name)
	local to = person(name)
	if to then ns.event("group", "INVITE", { k = "out", to = to }) end
end)
-- Retail links the name: "|Hplayer:%s|h[%s]|h has invited you to join a group."
local function invited(first, second)
	local from = person(second or first)
	if from then ns.event("group", "INVITE", { k = "in", s = from }) end
end
ns.wording("SYSTEM", "ERR_INVITED_TO_GROUP_SS", "group", invited)
ns.wording("SYSTEM", "ERR_INVITED_TO_GROUP_S", "group", invited)
ns.wording("SYSTEM", "ERR_DECLINE_GROUP_S", "group", function(name)
	local from = person(name)
	if from then ns.event("group", "INVITE", { k = "declined", s = from }) end
end)
-- The group lines say these already.
for _, name in ipairs({ "ERR_JOINED_GROUP_S", "ERR_LEFT_GROUP_S", "ERR_RAID_MEMBER_ADDED_S", "ERR_RAID_MEMBER_REMOVED_S" }) do
	ns.wording("SYSTEM", name, "group", function() end)
end

--------------------------------------------------------------------------------
-- Travel

local function onTaxi()
	return try(UnitOnTaxi, "player") == true
end

-- Saves where the recorder now is, unless the last line was there already.
local function arrived()
	if not ns.recording("travel") or onTaxi() then return end
	local here = ns.describePlayer()
	if not here.zone and not here.inst then return end
	local messages = ns.session.messages
	local last = messages[#messages]
	local there = last and last.p and ns.session.places[last.p]
	if there and sameNames(there, here) then return end
	ns.event("travel", "ZONE", { p = store("player", here) })
end

-- Only the latest change of each kind counts. The game reports a new zone together with
-- its first part, in either order, and that part must not put off the zone.
local zoneChanges, partChanges = 0, 0

ns.on("ZONE_CHANGED_NEW_AREA", function()
	zoneChanges = zoneChanges + 1
	partChanges = partChanges + 1
	local mine = zoneChanges
	-- The map has the new zone a moment later.
	ns.after(1, function()
		if mine == zoneChanges then arrived() end
	end)
end)

local function movedWithin()
	partChanges = partChanges + 1
	local mine = partChanges
	local before = ns.describePlayer()
	ns.after(ZONE_SETTLES, function()
		if mine == partChanges and sameNames(before, ns.describePlayer()) then arrived() end
	end)
end
ns.on("ZONE_CHANGED", movedWithin)
ns.on("ZONE_CHANGED_INDOORS", movedWithin)

-- A flight: where it began, and when.
local flight

local function landed()
	if not flight or onTaxi() then return false end
	local trip = flight
	flight = nil
	ns.event("travel", "TRAVEL", { k = "flight", from = trip.from, n = ns.now() - trip.at })
	return true
end

-- The game says that you got control back a little early, so this checks again.
local function watchFlight()
	if flight and not landed() then ns.after(5, watchFlight) end
end

ns.on("PLAYER_CONTROL_LOST", function()
	ns.after(1, function()
		if flight or not onTaxi() or not ns.recording("travel") then return end
		flight = { from = ns.playerPlace(), at = ns.now() }
		ns.after(5, watchFlight)
	end)
end)
ns.on("PLAYER_CONTROL_GAINED", landed)

-- A summons that is waiting for an answer.
local summons

ns.on("CONFIRM_SUMMON", function()
	local info = C_SummonInfo
	local who = filled(try(info and info.GetSummonConfirmSummoner or GetSummonConfirmSummoner))
	local area = filled(try(info and info.GetSummonConfirmAreaName or GetSummonConfirmAreaName))
	summons = { who = who, area = area, at = ns.now() }
end)

local function acceptSummons()
	local offer = summons
	summons = nil
	if not offer or ns.now() - offer.at > 120 or not ns.recording("travel") then return end
	ns.event("travel", "TRAVEL", { k = "summon", s = person(offer.who) or false, m = ns.clip(offer.area, 120) })
end

ns.hook(C_SummonInfo, "ConfirmSummon", acceptSummons)
ns.hook("ConfirmSummon", acceptSummons)
