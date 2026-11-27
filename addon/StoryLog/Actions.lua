-- What the recorder does without saying it: spells and items they use, mounts, clothes.
-- Only out of combat, where it is something done for the scene.

local _, ns = ...
local try, safe, filled, finite, clip = ns.try, ns.safe, ns.filled, ns.finite, ns.clip

-- The same spell on the same target again within this time of a line counts that line up.
local REPEATS = 60
-- Changing clothes is a few changes in a row. The outfit is saved once they stop.
local DRESSED = 5
-- The slots that others can see.
local VISIBLE = { 1, 3, 4, 5, 6, 7, 8, 9, 10, 15, 16, 17, 18, 19 }

local function inCombat()
	return try(InCombatLockdown) == true or try(UnitAffectingCombat, "player") == true
end

local function spellName(id)
	local spell = C_Spell
	local name = spell and filled(try(spell.GetSpellName, id))
	if not name and spell then
		local info = try(spell.GetSpellInfo, id)
		name = type(info) == "table" and filled(safe(info.name)) or nil
	end
	return name or filled((try(GetSpellInfo, id)))
end

local function isMount(id)
	local journal = C_MountJournal
	return journal ~= nil and finite(try(journal.GetMountFromSpell, id)) ~= nil
end

-- The casts that the player started, and at whom. Spells that start by themselves,
-- or as part of another, never come through here.
local started, startedCount = {}, 0

ns.on("UNIT_SPELLCAST_SENT", function(unit, target, cast)
	cast = filled(safe(cast))
	if safe(unit) ~= "player" or not cast then return end
	-- Casts that failed are never removed, so the list is cleared now and then.
	if startedCount > 50 then started, startedCount = {}, 0 end
	started[cast] = filled(safe(target)) or ""
	startedCount = startedCount + 1
end, "player")

-- The last line of each spell and target.
local recent = {}

ns.on("UNIT_SPELLCAST_SUCCEEDED", function(unit, cast, id)
	if safe(unit) ~= "player" or not ns.recording("actions") or inCombat() then return end
	cast, id = filled(safe(cast)), finite(safe(id))
	if not id then return end

	local target
	if ns.has("UNIT_SPELLCAST_SENT") then
		target = cast and started[cast]
		if not target then return end
		started[cast] = nil
	end
	local name = spellName(id)
	if not name then return end
	local mount = isMount(id)

	-- The target's name is all the game says of it, so it counts if it is still the target.
	local to
	local shown = filled((try(UnitName, "target")))
	if target and target ~= "" and not mount and shown and target:sub(1, #shown) == shown then
		to = ns.unitSpeaker("target", ns.me.guid)
	end

	-- Counted from the line's own time, or a spell cast every minute would be one line for hours.
	local key = id .. ":" .. tostring(to)
	local last = recent[key]
	if last and ns.now() - last.t <= REPEATS then
		last.n = (last.n or 1) + 1
		return
	end
	recent[key] = ns.event("actions", "CAST", { m = clip(name, 120), id = id, to = to, mount = mount or nil })
end, "player")

--------------------------------------------------------------------------------
-- Clothes

-- What was worn when last saved: slot to link, or false.
local worn
-- The slots that the game said changed since, and how many changes there were.
local changed, changes = {}, 0

local seen = {}
for _, slot in ipairs(VISIBLE) do seen[slot] = true end

local function wearing()
	local links = {}
	for _, slot in ipairs(VISIBLE) do
		links[slot] = filled(try(GetInventoryItemLink, "player", slot)) or false
	end
	return links
end

ns.atLogin(function() worn = wearing() end)

ns.on("PLAYER_EQUIPMENT_CHANGED", function(slot)
	slot = finite(safe(slot))
	if not worn or not slot or not seen[slot] then return end
	changed[slot] = true
	changes = changes + 1
	local mine = changes
	ns.after(DRESSED, function()
		if mine ~= changes then return end
		-- Only the slots that changed: an item that the game had not loaded at login is no new one.
		local now = wearing()
		local on, off = {}, {}
		for _, visible in ipairs(VISIBLE) do
			if changed[visible] and now[visible] ~= worn[visible] then
				if now[visible] then on[#on + 1] = now[visible] end
				if worn[visible] then off[#off + 1] = worn[visible] end
			end
		end
		worn, changed = now, {}
		if #on + #off == 0 then return end
		ns.event("actions", "OUTFIT", { on = #on > 0 and on or nil, off = #off > 0 and off or nil })
	end)
end)
