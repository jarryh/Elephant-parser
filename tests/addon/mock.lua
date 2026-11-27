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
W = {
  regional = true, realm = "Testrealm", now = 1898622000, locale = "enUS", build = 16001,
  units = {}, infos = {}, rp = {}, printed = {}, maps = {}, quests = {}, timers = {}, addons = {},
  profiles = {}, status = {}, inbox = {}, spells = {}, mounts = {}, worn = {},
}
-- The archive add-ons are installed, and have saved nothing yet.
for volume = 1, 5 do W.addons["StoryLog_Archive" .. volume] = {} end

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
-- You count too, as in the game. Without W.members, it follows the units that exist.
function GetNumGroupMembers()
  if W.members then return W.members end
  local others = 0
  for i = 1, 40 do
    if W.units[(W.raid and "raid" or "party") .. i] and W.units[(W.raid and "raid" or "party") .. i] ~= W.units.player then
      others = others + 1
    end
  end
  return others > 0 and others + 1 or 0
end
function IsInGroup() return GetNumGroupMembers() > 0 end

-- The quest log. W.quests[id] = { title =, inLog =, hidden =, task = }
if not NO_QUESTLOG then
  local function inLog()
    local ids = {}
    for id, quest in pairs(W.quests) do
      if quest.inLog then ids[#ids + 1] = id end
    end
    table.sort(ids)
    return ids
  end
  C_QuestLog = {}
  function C_QuestLog.GetNumQuestLogEntries() return #inLog(), #inLog() end
  function C_QuestLog.GetInfo(index)
    local id = inLog()[index]
    local quest = id and W.quests[id]
    if not quest then return nil end
    return { title = out(quest.title), questID = id, questLogIndex = index, isHeader = false, isBounty = false,
      isHidden = quest.hidden == true, isTask = quest.task == true }
  end
  function C_QuestLog.GetLogIndexForQuestID(id)
    for index, found in ipairs(inLog()) do
      if found == id then return index end
    end
  end
  function C_QuestLog.GetTitleForQuestID(id)
    local quest = W.quests[id]
    return out(quest and quest.title)
  end
end

-- Timers run when a test says that time has passed: all of them, or with `seconds` only
-- those that are due by then, while the others wait that much less.
C_Timer = { After = function(seconds, callback) W.timers[#W.timers + 1] = { left = seconds, callback = callback } end }
function runTimers(seconds)
  local waiting = W.timers
  W.timers = {}
  local due = {}
  for _, timer in ipairs(waiting) do
    if not seconds or timer.left <= seconds then
      due[#due + 1] = timer
    else
      timer.left = timer.left - seconds
      W.timers[#W.timers + 1] = timer
    end
  end
  for _, timer in ipairs(due) do timer.callback() end
end

-- Load-on-demand add-ons. W.addons[name] = { saved = "the file's text", disabled =, forgets = }
-- With `forgets`, the game loads the add-on without its saved file, as a beta of this client did.
C_AddOns = {}
function C_AddOns.IsAddOnLoaded(name)
  local addon = W.addons[name]
  return addon ~= nil and addon.loaded == true
end
function C_AddOns.LoadAddOn(name)
  local addon = W.addons[name]
  if not addon then return false, "MISSING" end
  if addon.disabled then return false, "DISABLED" end
  if not addon.loaded then
    if addon.saved and not addon.forgets then assert(load(addon.saved, "@" .. name .. ".lua"))() end
    addon.loaded = true
  end
  return true
end
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

-- The part of Total RP 3 that the addon calls. W.profiles[id] is laid out as Total RP 3
-- keeps a profile; W.status[id] is 1 in character, 2 out of character.
if TRP then
  local function object(id)
    local function profile() return W.profiles[id] end
    local function part(name, key)
      return function()
        local found = profile() and profile()[name]
        return found and found[key]
      end
    end
    return {
      GetFullName = function() return out(W.rp[id]) end,
      GetProfile = profile,
      GetRoleplayStatus = function() return W.status[id] end,
      GetFullTitle = part("characteristics", "FT"),
      GetTitle = part("characteristics", "TI"),
      GetCustomRace = part("characteristics", "RA"),
      GetCustomClass = part("characteristics", "CL"),
      GetCurrentlyText = part("character", "CU"),
      GetCustomPronouns = function() return profile() and profile().pronouns end,
      GetCustomGuildMembership = function() return { name = profile() and profile().guild } end,
    }
  end
  local static = { CreateFromCharacterID = function(id) assert(rawtype(id) == "string"); return object(id) end }
  AddOn_TotalRP3 = { Player = { static = static, GetCurrentUser = function() return object("player") end } }
end

-- Which events this client has: all but those in NO_EVENT.
C_EventUtils = { IsEventValid = function(event) return not (NO_EVENT and NO_EVENT[event]) end }

-- As in the game: the hook runs after the function, with its arguments.
function hooksecurefunc(owner, name, hook)
  if rawtype(owner) == "string" then owner, name, hook = _G, owner, name end
  local original = owner[name]
  assert(rawtype(original) == "function", "no function to hook: " .. tostring(name))
  owner[name] = function(...)
    local results = table.pack(original(...))
    hook(...)
    return table.unpack(results, 1, results.n)
  end
end

-- The game's wording, in English.
ERR_INVITE_PLAYER_S = "You have invited %s to join your group."
ERR_INVITED_TO_GROUP_SS = "|Hplayer:%s|h[%s]|h has invited you to join a group."
ERR_DECLINE_GROUP_S = "%s declines your group invitation."
ERR_LEFT_GROUP_YOU = "You leave the group."
ERR_GROUP_DISBANDED = "Your group has been disbanded."
ERR_UNINVITE_YOU = "You have been removed from the group."
ERR_JOINED_GROUP_S = "%s joins the party."
ERR_LEFT_GROUP_S = "%s leaves the party."
ERR_TRADE_COMPLETE = "Trade complete."
LOOT_ITEM_SELF = "You receive loot: %s."
LOOT_ITEM_SELF_MULTIPLE = "You receive loot: %sx%d."
LOOT_ITEM_PUSHED_SELF = "You receive item: %s."
LOOT_ITEM_PUSHED_SELF_MULTIPLE = "You receive item: %sx%d."
LOOT_ITEM_CREATED_SELF = "You create: %s."
LOOT_ITEM_CREATED_SELF_MULTIPLE = "You create: %sx%d."
DUEL_WINNER_KNOCKOUT = "%1$s has defeated %2$s in a duel"
DUEL_WINNER_RETREAT = "%2$s has fled from %1$s in a duel"
ATTACHMENTS_MAX_SEND = 12
ATTACHMENTS_MAX_RECEIVE = 16

function UnitIsGroupLeader(unit) return out(W.leader ~= nil and W.leader == unit) end
function UnitCanAttack(_, unit) return W.units[unit] ~= nil and W.units[unit].hostile == true end
function UnitIsPlayer(unit)
  local who = W.units[unit]
  return who ~= nil and rawtype(who.guid) == "string" and who.guid:find("^Player%-") ~= nil
end
function UnitIsDeadOrGhost() return W.dead == true end
function InCombatLockdown() return W.combat == true end
function UnitOnTaxi() return W.taxi == true end
function GetGuildInfo(unit) return out(W.units[unit] and W.units[unit].guild) end
function GetGameTime() if W.gameTime then return out(W.gameTime[1], W.gameTime[2]) end end
function StartDuel() end

-- The trade window. W.trade = { mine = { { link =, count = } }, theirs = ..., myMoney =, theirMoney = }
local function slotOf(side, slot) return W.trade and W.trade[side] and W.trade[side][slot] end
function GetTradePlayerItemLink(slot) local it = slotOf("mine", slot); return out(it and it.link) end
function GetTradeTargetItemLink(slot) local it = slotOf("theirs", slot); return out(it and it.link) end
function GetTradePlayerItemInfo(slot) local it = slotOf("mine", slot); if it then return out(it.name or "Item", 1, it.count or 1, 2, true) end end
function GetTradeTargetItemInfo(slot) local it = slotOf("theirs", slot); if it then return out(it.name or "Item", 1, it.count or 1, 2, true) end end
function GetPlayerTradeMoney() return out(W.trade and W.trade.myMoney or 0) end
function GetTargetTradeMoney() return out(W.trade and W.trade.theirMoney or 0) end

-- Letters. W.outgoing = { items = { { link =, count = } }, money = }; W.inbox[i] = { sender =, subject =, body =, money =, items =, canReply = }
function SendMail() end
function GetSendMailItemLink(slot) local it = W.outgoing and W.outgoing.items[slot]; return it and it.link end
function GetSendMailItem(slot) local it = W.outgoing and W.outgoing.items[slot]; if it then return "Item", 1, 0, it.count or 1, 2 end end
function GetSendMailMoney() return W.outgoing and W.outgoing.money or 0 end
function GetInboxHeaderInfo(index)
  local letter = W.inbox[index]
  if not letter then return nil end
  return 1, nil, out(letter.sender), out(letter.subject), letter.money or 0, 0, 30, #(letter.items or {}), false, false, true, letter.canReply ~= false, false
end
function GetInboxText(index) return out(W.inbox[index] and W.inbox[index].body) end
function GetInboxItemLink(index, slot) local it = W.inbox[index] and (W.inbox[index].items or {})[slot]; return it and it.link end
function GetInboxItem(index, slot) local it = W.inbox[index] and (W.inbox[index].items or {})[slot]; if it then return "Item", 1, 0, it.count or 1, 2, true end end
function InboxFrame_OnClick() end

C_SummonInfo = {
  GetSummonConfirmSummoner = function() return out(W.summoner) end,
  GetSummonConfirmAreaName = function() return out(W.summonArea) end,
  ConfirmSummon = function() end,
}

-- Dialogue windows, books and quest windows.
C_GossipInfo = {
  GetText = function() return out(W.gossip and W.gossip.text) end,
  GetOptions = function()
    local list = {}
    for i, name in ipairs(W.gossip and W.gossip.options or {}) do
      list[i] = { name = out(name), gossipOptionID = 100 + i, orderIndex = i - 1 }
    end
    return list
  end,
  SelectOption = function() end,
  SelectOptionByIndex = function() end,
}
function ItemTextGetItem() return out(W.book and W.book.title) end
function ItemTextGetText() return out(W.book and W.book.pages[W.book.page or 1]) end
function ItemTextGetPage() return W.book and W.book.page or 1 end
function GetQuestID() return W.window and W.window.id or 0 end
function GetTitleText() return out(W.window and W.window.title) end
function GetQuestText() return out(W.window and W.window.text) end
function GetObjectiveText() return out(W.window and W.window.goal) end
function GetRewardText() return out(W.window and W.window.reward) end

-- Spells, mounts and what is worn. W.spells[id] = name, W.mounts[id] = mount ID, W.worn[slot] = link.
C_Spell = { GetSpellName = function(id) return out(W.spells[id]) end }
C_MountJournal = { GetMountFromSpell = function(id) return W.mounts[id] end }
function GetInventoryItemLink(_, slot) return out(W.worn[slot]) end

-- The calendar, which only some clients have.
if CALENDAR then
  C_DateAndTime = { GetCurrentCalendarTime = function() return { monthDay = 31, month = 10, year = 2026 } end }
  C_Calendar = {
    OpenCalendar = function() W.calendarAsked = true end,
    GetMonthInfo = function() return { month = W.calendarMonth or 10, year = 2026 } end,
    GetNumDayEvents = function() return #(W.holidays or {}) end,
    GetDayEvent = function(_, _, index)
      local event = W.holidays[index]
      return { title = out(event.title), calendarType = event.kind or "HOLIDAY" }
    end,
  }
end

local frames = {}
function CreateFrame()
  local frame = { events = {}, scripts = {} }
  function frame:RegisterEvent(event)
    if NO_EVENT and NO_EVENT[event] then error("Attempt to register unknown event " .. event) end
    self.events[event] = true
  end
  function frame:RegisterUnitEvent(event) return self:RegisterEvent(event) end
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
-- Every event that a frame has registered.
function registeredEvents()
  local list = {}
  for _, frame in ipairs(frames) do
    for event in pairs(frame.events) do list[#list + 1] = event end
  end
  table.sort(list)
  return list
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

-- Every file that the game would write at logout: only those of loaded add-ons.
function savedFiles()
  local files = { StoryLog = serialize("StoryLogDB", StoryLogDB) }
  for name, addon in pairs(W.addons) do
    if addon.loaded then
      local variable = name:gsub("_", "") .. "DB"
      files[name] = _G[variable] == nil and (variable .. " = nil") or serialize(variable, _G[variable])
    end
  end
  if StoryLogCharDB ~= nil then files.character = serialize("StoryLogCharDB", StoryLogCharDB) end
  return files
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
