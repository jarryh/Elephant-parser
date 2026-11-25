-- Where the recorder and their group members are.
--
-- The game gives positions for you and your group only, and none inside dungeons,
-- raids and battlegrounds. Zone and instance names still work there.

local _, ns = ...
local try, filled, finite = ns.try, ns.filled, ns.finite

-- A new place is saved only after moving this far.
local MOVED_YARDS = 3
local MOVED_ON_MAP = 0.002

local NAME_KEYS = { "map", "zone", "sub", "mini", "inst", "indoors", "neighborhood", "house", "room", "cont" }

-- A raid that is filling up changes many times within seconds. It is saved as one line.
local GROUP_SETTLES = 10

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
			place.neighborhood = filled(ns.safe(info.neighborhoodName))
			place.house = filled(ns.safe(info.houseName)) or filled(ns.safe(info.ownerName))
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

local function describeMember(guid)
	local unit = roster[guid]
	if not unit or try(UnitGUID, unit) ~= guid then return nil end

	local place = {}
	addPosition(place, unit)
	if not place.x and not place.wx then return nil end

	if place.map then
		local info = try(C_Map.GetMapInfo, place.map)
		if type(info) == "table" then place.zone = filled(ns.safe(info.name)) end
	end
	return place
end

function ns.memberPlace(guid)
	local place = describeMember(guid)
	if place then return store(guid, place) end
end

-- Saves who is in the group, when that has changed.
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
		if name then members[#members + 1] = { name = name, guid = unit.guid } end
	end
	if #members < others then return end
	if others == 0 then members = {} end
	table.sort(members, function(a, b) return a.name < b.name end)

	local parts = {}
	for i, member in ipairs(members) do parts[i] = member.guid end
	local key = #members == 0 and "" or (inRaid and "raid:" or "party:") .. table.concat(parts, ",")
	if key == lastGroup then return end
	local first = lastGroup == nil
	lastGroup = key
	-- Not being in a group needs no line, unless you just left one.
	if first and key == "" then return end

	local list = {}
	for i, member in ipairs(members) do list[i] = ns.speakerIndex(member.name, member.guid, false) end

	local messages = ns.session.messages
	local last = messages[#messages]
	local time = ns.now()
	if last and last.e == "GROUP" and time - last.t < GROUP_SETTLES then
		last.g, last.raid = list, inRaid or nil
	else
		ns.add({ t = time, e = "GROUP", g = list, raid = inRaid or nil, p = ns.playerPlace() })
	end
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

-- For the status line: how many group members have a position right now.
function ns.groupPositions()
	local known, total = 0, 0
	for guid in pairs(roster) do
		total = total + 1
		if describeMember(guid) then known = known + 1 end
	end
	return known, total
end
