-- Fights, boss fights, deaths, duels and levels.
--
-- Never the combat log: retail forbids add-ons to read it, and even trying shows the
-- player an error. So a fight is only its start, its end, and whom you had targeted.

local _, ns = ...
local try, safe, filled, finite, clip = ns.try, ns.safe, ns.filled, ns.finite, ns.clip

-- A fight that starts this soon after the last one ended, with nothing in between, is the same fight.
local FIGHT_RESUMES = 30
-- The names saved for one fight.
local FOES = 6

-- The fight going on: its line, and the names in it so far.
local fight
-- The line of the last fight, while another one could still join it.
local lastFight

local function addFoe(unit)
	if not fight or try(UnitCanAttack, "player", unit) ~= true then return end
	local name
	if try(UnitIsPlayer, unit) == true then
		name = ns.unitPlayerName(unit)
	else
		name = filled((try(UnitName, unit)))
	end
	if not name or fight.seen[name] or #fight.foes >= FOES then return end
	fight.seen[name] = true
	fight.foes[#fight.foes + 1] = clip(name, 60)
	fight.line.foes = fight.foes
end

ns.on("PLAYER_REGEN_DISABLED", function()
	if not ns.recording("combat") then return end
	local messages = ns.session.messages
	local last = messages[#messages]
	if last and last == lastFight and ns.now() - (last.t + (last.n or 0)) <= FIGHT_RESUMES then
		fight = { line = last, foes = last.foes or {}, seen = {} }
		for _, name in ipairs(fight.foes) do fight.seen[name] = true end
	else
		local line = ns.event("combat", "FIGHT")
		fight = line and { line = line, foes = {}, seen = {} }
	end
	addFoe("target")
end)

ns.on("PLAYER_TARGET_CHANGED", function() addFoe("target") end)

ns.on("PLAYER_REGEN_ENABLED", function()
	if not fight then return end
	fight.line.n = ns.now() - fight.line.t
	lastFight = fight.line
	fight = nil
end)

-- A boss fight: its line, until it ends.
local encounter

ns.on("ENCOUNTER_START", function(id, name)
	encounter = ns.event("combat", "ENCOUNTER", { id = finite(safe(id)), m = clip(safe(name), 120) })
end)

ns.on("ENCOUNTER_END", function(_, _, _, _, success)
	local line = encounter
	encounter = nil
	if not line then return end
	line.n = ns.now() - line.t
	success = safe(success)
	if success == 1 or success == true then
		line.won = true
	elseif success == 0 or success == false then
		line.won = false
	end
end)

--------------------------------------------------------------------------------
-- Death

local dead = false
-- Who offered to bring you back: { name =, at = }.
local resurrector

local function stillDead()
	local gone = try(UnitIsDeadOrGhost, "player")
	if gone == nil then gone = try(UnitIsGhost, "player") or try(UnitIsDead, "player") end
	return gone == true
end

local function person(name)
	name = ns.plainName(name)
	return name and (ns.speakerIndex(ns.qualify(name), nil, false))
end

ns.on("PLAYER_DEAD", function()
	dead, resurrector = true, nil
	ns.event("combat", "DEATH")
end)

ns.on("RESURRECT_REQUEST", function(name)
	name = ns.plainName(safe(name))
	resurrector = name and { name = name, at = ns.now() }
end)

-- Releasing the spirit makes you alive as a ghost, which is not being back.
local function alive()
	if not dead or stillDead() then return end
	dead = false
	local by = resurrector and ns.now() - resurrector.at <= 120 and resurrector.name
	resurrector = nil
	if ns.recording("combat") then ns.event("combat", "REVIVED", { s = by and person(by) or false }) end
end

ns.on("PLAYER_ALIVE", alive)
ns.on("PLAYER_UNGHOST", alive)

--------------------------------------------------------------------------------
-- Duels, which the game announces to everyone nearby

local function me()
	return (ns.speakerIndex(ns.me.name, ns.me.guid, false))
end

ns.on("DUEL_REQUESTED", function(name)
	if not ns.recording("combat") then return end
	local from = person(safe(name))
	if from then ns.event("combat", "DUEL", { k = "challenge", s = from, to = me() }) end
end)

ns.hook("StartDuel", function(who)
	if not ns.recording("combat") then return end
	who = filled(safe(who)) or "target"
	local to = ns.unitSpeaker(who, ns.me.guid)
	-- With /duel it is a name, which is no unit unless they are in the group. Units are
	-- written small: "target", "party2".
	if not to and not who:find("^%l+%d*$") then to = person(who) end
	if to then ns.event("combat", "DUEL", { k = "challenge", to = to }) end
end)

local function duelEnded(kind)
	return function(winner, loser)
		ns.event("combat", "DUEL", { k = kind, s = person(winner) or false, to = person(loser) })
	end
end

-- "%1$s has defeated %2$s in a duel", "%2$s has fled from %1$s in a duel": the winner is first.
ns.wording("SYSTEM", "DUEL_WINNER_KNOCKOUT", "combat", duelEnded("won"))
ns.wording("SYSTEM", "DUEL_WINNER_RETREAT", "combat", duelEnded("fled"))

ns.on("PLAYER_LEVEL_UP", function(level)
	ns.event("combat", "LEVEL", { n = finite(safe(level)) })
end)
