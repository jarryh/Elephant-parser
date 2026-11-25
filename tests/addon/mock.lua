-- A simulated WoW client for the StoryLog addon: only the functions it uses.
-- Return orders follow Blizzard's API documentation for the WoW Forever client (1.60.1).
-- It runs in fengari, which is Lua 5.3, while the game runs 5.1. Hence the two shims below.

unpack = unpack or table.unpack

local rawtype = type
local SECRET = setmetatable({}, { __mode = "k" })
local function boom() error("operated on a secret value", 2) end

local SECRET_META = {}
for _, key in ipairs({ "__index", "__newindex", "__concat", "__len", "__lt", "__le", "__add", "__sub", "__mul", "__div", "__call", "__tostring", "__unm" }) do
  SECRET_META[key] = boom
end

-- A value that the game hides from addons. Using it in any way is an error, as in the game.
function newSecret()
  local secret = setmetatable({}, SECRET_META)
  SECRET[secret] = true
  return secret
end
-- As in the game: type() of a secret gives the type of what is inside.
function type(value)
  if SECRET[value] then return "string" end
  return rawtype(value)
end
function issecretvalue(value) return value ~= nil and SECRET[value] == true end

-- The state of the world. Tests change it between events.
W = { regional = true, realm = "Testrealm", now = 1898622000, locale = "enUS", build = 16001, units = {}, infos = {}, rp = {}, printed = {}, maps = {} }

-- With W.allSecret, everything the game is allowed to hide comes back hidden.
local function out(...)
  if not W.allSecret then return ... end
  local count, values = select("#", ...), { ... }
  for i = 1, count do
    if values[i] ~= nil then values[i] = newSecret() end
  end
  return unpack(values, 1, count)
end

function GetServerTime() return W.now end
function GetBuildInfo() return "1.60.1", "71037", "", W.build end
function GetLocale() return W.locale end
function RegionalUniqueNamesEnabled() return W.regional end
function GetNormalizedRealmName() return W.realm end
function GetDefaultLanguage() return "Common" end
function UnitGUID(unit)
  local who = W.units[unit]
  if not who then return nil end
  if unit == "player" then return who.guid end
  return out(who.guid)
end
function UnitNameUnmodified(unit)
  local who = W.units[unit]
  if not who then return nil end
  if unit == "player" then return who.first, who.second end
  return out(who.first, who.second)
end
UnitName = UnitNameUnmodified
function UnitPosition(unit)
  local who = W.units[unit]
  if not who or not who.wx then return end
  return out(who.wx, who.wy, 0, who.cont)
end
C_Map = {}
function C_Map.GetBestMapForUnit(unit)
  local who = W.units[unit]
  return out(who and who.map)
end
function C_Map.GetPlayerMapPosition(_, unit)
  local who = W.units[unit]
  if not who or not who.x then return nil end
  return { x = who.x, y = who.y, GetXY = function(self) return out(self.x, self.y) end }
end
function C_Map.GetMapInfo(map) return { name = out(W.maps[map]), mapID = map } end
function GetRealZoneText() return out(W.zone) end
function GetZoneText() return out(W.zone) end
function GetSubZoneText() return out(W.sub or "") end
function GetMinimapZoneText() return out(W.mini or W.sub or W.zone) end
function IsIndoors() return out(W.indoors == true) end
function IsInInstance() return out(W.inst ~= nil, W.inst and "party" or "none") end
function GetInstanceInfo() return out(W.inst or W.zone, W.inst and "party" or "none", 1, "Normal", 5, 0, false, 34, 5) end
function IsInRaid() return W.raid == true end
function GetNumGroupMembers() return W.members or 0 end
function GetPlayerInfoByGUID(guid)
  local info = W.infos[guid]
  if not info then return end
  return out(info.class or info.classFile, info.classFile, info.race, info.race, info.sex, info.first, info.second)
end
RANDOM_ROLL_RESULT = ROLL_FORMAT or "%s rolls %d (%d-%d)"
C_ChatInfo = { InChatMessagingLockdown = function() return W.lockdown == true end }

-- Player housing, which only retail has.
if HOUSING then
  C_Housing = {
    IsInsideHouseOrPlot = function() return W.house ~= nil end,
    IsInsideHouse = function() return W.house ~= nil end,
    IsOnNeighborhoodMap = function() return W.hood ~= nil end,
    GetCurrentHouseInfo = function() return { plotID = 4, houseName = out(W.house), ownerName = "Someone", neighborhoodName = out(W.hood) } end,
  }
  C_HousingLayout = { GetRoomPlayerIsIn = function() return out("Housing-Room-1") end }
  C_HousingNeighborhood = { GetNeighborhoodName = function() return out(W.hood) end }
end

-- The part of Total RP 3 that the addon calls.
if TRP then
  local function object(id) return { GetFullName = function() return out(W.rp[id]) end } end
  local static = { CreateFromCharacterID = function(id) assert(rawtype(id) == "string"); return object(id) end }
  AddOn_TotalRP3 = { Player = { static = static, GetCurrentUser = function() return object("player") end } }
end

local frames = {}
function CreateFrame()
  local frame = { events = {}, scripts = {} }
  function frame:RegisterEvent(event)
    if NO_EVENT and NO_EVENT[event] then error("Attempt to register unknown event " .. event) end
    self.events[event] = true
  end
  function frame:UnregisterEvent(event) self.events[event] = nil end
  function frame:SetScript(kind, handler) self.scripts[kind] = handler end
  frames[#frames + 1] = frame
  return frame
end
function fire(event, ...)
  for _, frame in ipairs(frames) do
    if frame.events[event] then frame.scripts.OnEvent(frame, event, ...) end
  end
end
SlashCmdList = {}
function print(...) W.printed[#W.printed + 1] = table.concat({ ... }, " ") end
function slash(input) SlashCmdList.STORYLOG(input) end

-- A chat event, with its 18 arguments in the game's order.
function chat(kind, a)
  fire("CHAT_MSG_" .. kind, a.text, a.sender or "", a.lang or "", a.channel or "", "", a.flag or "",
    a.zoneID or 0, 0, a.base or "", 0, 1, a.guid or "", 0, false, false, false, false, a.discord)
end

-- Puts a unit somewhere: on a map, and in yards on a continent.
function at(unit, map, x, y, wx, wy, cont)
  local who = W.units[unit]
  who.map, who.x, who.y, who.wx, who.wy, who.cont = map, x, y, wx, wy, cont
end

local function quoted(text)
  return '"' .. text:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\n", "\\n"):gsub("\r", "\\r") .. '"'
end

-- Writes a saved-variables file as this client does: no indentation, no index comments,
-- CRLF. It refuses what the game can't save: secrets, and lists with holes.
function serialize(name, value)
  local lines = {}
  local function scalar(v)
    local kind = rawtype(v)
    if kind == "string" then return quoted(v) end
    if kind == "number" then return string.format("%.14g", v) end
    if kind == "boolean" then return tostring(v) end
    error("cannot be saved: " .. (SECRET[v] and "a secret" or kind))
  end
  local function write(prefix, v, tail)
    if rawtype(v) ~= "table" or SECRET[v] then
      lines[#lines + 1] = prefix .. scalar(v) .. tail
      return
    end
    lines[#lines + 1] = prefix .. "{"
    local count = #v
    for i = 1, count do write("", v[i], ",") end
    local keys = {}
    for key in pairs(v) do
      if rawtype(key) == "number" then assert(key >= 1 and key <= count, "a list with a hole") else keys[#keys + 1] = key end
    end
    -- The game's order is arbitrary. This one puts what identifies an entry first.
    local order = { version = 1, t = 2, e = 3, id = 2, name = 2, zone = 2 }
    table.sort(keys, function(a, b)
      local x, y = order[a] or 9, order[b] or 9
      if x ~= y then return x < y end
      return a < b
    end)
    for _, key in ipairs(keys) do write("[" .. quoted(key) .. "] = ", v[key], ",") end
    lines[#lines + 1] = "}" .. tail
  end
  write(name .. " = ", value, "")
  return "\r\n" .. table.concat(lines, "\r\n") .. "\r\n"
end

-- A value as JSON, for the tests to read. A table with a first element is a list.
function json(value)
  local kind = rawtype(value)
  if value == nil then return "null" end
  if SECRET[value] then return '"<secret>"' end
  if kind == "string" then
    -- In brackets, to return the text without gsub's count.
    return (quoted(value):gsub("[\0-\31]", function(c) return string.format("\\u%04x", c:byte()) end))
  end
  if kind == "number" then return string.format("%.14g", value) end
  if kind == "boolean" then return tostring(value) end
  if kind ~= "table" then return '"<' .. kind .. '>"' end

  local parts = {}
  if #value > 0 or next(value) == nil then
    for i = 1, #value do parts[i] = json(value[i]) end
    return "[" .. table.concat(parts, ",") .. "]"
  end
  for key, item in pairs(value) do parts[#parts + 1] = quoted(tostring(key)) .. ":" .. json(item) end
  return "{" .. table.concat(parts, ",") .. "}"
end

-- The globals so far, to find what the addon adds.
local before = { addedGlobals = true }
for key in pairs(_G) do before[key] = true end
function addedGlobals()
  local added = {}
  for key in pairs(_G) do
    if not before[key] and key ~= "NS" and key ~= "SOURCE" and key ~= "SOURCE_NAME" then added[#added + 1] = key end
  end
  table.sort(added)
  return added
end
