-- Keeps the log small by moving finished sessions to archive files, and keeps those from
-- growing without end by emptying the oldest when none has room.
--
-- An add-on can't create or copy files: it has one saved file, which the game reads at
-- every login. But the game reads the file of a load-on-demand add-on only when that
-- add-on is loaded. So StoryLog_Archive1 to 12 hold older sessions, and are loaded only
-- here, when sessions move.
--
-- The game can fail to load a saved file, and then saves the empty result over it. So
-- nothing leaves the main log until an archive file has been seen to hold it, one login
-- after it was copied there.
--
-- When every archive file is full, the one whose sessions are oldest is emptied and used
-- again. StoryLog warns a file ahead, so that it can be added to the app first.

local _, ns = ...
local say, try, finite = ns.say, ns.try, ns.finite

local VOLUMES = 12
local MB = 1024 * 1024
local DAY = 86400
-- What one archive file takes before the next one is used.
ns.VOLUME_BYTES = ns.MAX_LIMIT * MB
-- Lua 5.1 reads a saved file as one piece of code, which may hold at most 262,143
-- different strings and numbers. Whether the game reads saved files that way is not
-- known, so StoryLog stays well below it.
ns.VOLUME_CONSTANTS = 200000
-- The main log moves to an archive file past this many, whatever its size in MB.
ns.LOG_CONSTANTS = 150000
ns.ARCHIVE_VOLUMES = VOLUMES

local function addonName(volume)
	return "StoryLog_Archive" .. volume
end

-- Roughly the bytes that a value takes in the saved file, which has a line for each field:
-- `["key"] = value,`. An add-on can't see files. The different strings and numbers in it
-- go into `distinct`.
local function size(value, distinct)
	local kind = type(value)
	-- NaN can't be a key, and is never saved.
	if (kind == "string" or kind == "number") and value == value then distinct[value] = true end
	if kind == "string" then return #value + 2 end
	if kind == "number" then return #tostring(value) end
	if kind ~= "table" then return 5 end
	local bytes, count = 5, #value
	for i = 1, count do bytes = bytes + size(value[i], distinct) + 3 end
	for key, item in pairs(value) do
		if type(key) ~= "number" or key < 1 or key > count or key % 1 ~= 0 then
			distinct[key] = true
			bytes = bytes + #tostring(key) + 10 + size(item, distinct)
		end
	end
	return bytes
end

-- The bytes that a session takes, and the different strings and numbers in it.
function ns.sessionSize(session)
	local distinct, constants = {}, 0
	local bytes = size(session, distinct)
	for _ in pairs(distinct) do constants = constants + 1 end
	return bytes, constants
end

-- When a session began, and when its last line was said.
local function timesOf(session)
	local messages = session.messages or {}
	local first, last = messages[1], messages[#messages]
	local began = finite(session.started) or (first and finite(first.t))
	local ended = (last and finite(last.t)) or finite(session.ended) or began
	return began, ended
end

-- A finished session never changes, so it is measured once. The one being played is not.
local measured = setmetatable({}, { __mode = "k" })

local function sizeOf(session)
	local known = measured[session]
	if known then return known end
	local bytes, constants = ns.sessionSize(session)
	known = { bytes = bytes, constants = constants }
	if session ~= ns.session then measured[session] = known end
	return known
end

-- What a list of sessions holds. The different values of each session are added up, so
-- `constants` is at least as many as the file has.
local function measure(sessions)
	local held = { sessions = #sessions, lines = 0, bytes = 0, constants = 0 }
	for _, session in ipairs(sessions) do
		held.lines = held.lines + #(session.messages or {})
		local known = sizeOf(session)
		held.bytes = held.bytes + known.bytes
		held.constants = held.constants + known.constants
		local began, ended = timesOf(session)
		if began and (not held.oldest or began < held.oldest) then held.oldest = began end
		if ended and (not held.newest or ended > held.newest) then held.newest = ended end
	end
	return held
end

-- The main log's size in bytes, and its different strings and numbers.
function ns.logSize()
	local held = measure(ns.db.sessions)
	return held.bytes, held.constants
end

-- A warning when the main log holds nearly as many different strings and numbers as
-- Lua can read in one file, and what to do. Nil while it is well below.
function ns.logWarning(constants)
	if not constants then constants = select(2, ns.logSize()) end
	if constants <= ns.LOG_CONSTANTS then return nil end
	local warning = "|cffff7070The log is close to the most that the game can load.|r "
	if (finite(ns.db.settings.limit) or 0) <= 0 then
		return warning .. "/storylog limit 3 splits it at the next login."
	end
	return warning .. "/reload, so that finished sessions can move to an archive file."
end

-- The bookkeeping in the main log: which file is in use, what each should hold, and
-- which sessions were copied but not yet seen in their file.
local function state()
	local db = ns.db
	if type(db.archive) ~= "table" then db.archive = {} end
	local archive = db.archive
	if type(archive.held) ~= "table" then archive.held = {} end
	for volume = 1, VOLUMES do
		local held = archive.held[volume]
		if type(held) ~= "table" or not finite(held.sessions) then
			archive.held[volume] = { sessions = 0, lines = 0, bytes = 0 }
		end
	end
	local volume = finite(archive.volume)
	if not volume or volume < 1 or volume > VOLUMES or volume % 1 ~= 0 then archive.volume = 1 end
	local pending = archive.pending
	if type(pending) ~= "table" or type(pending.ids) ~= "table" or not archive.held[pending.volume] then
		archive.pending = nil
	end
	return archive
end

ns.archiveState = state

-- "today", "1 day ago", "12 days ago".
function ns.ago(t)
	local days = math.floor((GetServerTime() - t) / DAY)
	if days < 1 then return "today" end
	if days == 1 then return "1 day ago" end
	return ("%d days ago"):format(days)
end

-- How far back what a file holds reaches, from its bookkeeping. Nil when that is unknown.
function ns.span(held)
	local oldest, newest = finite(held.oldest), finite(held.newest)
	if not oldest or not newest then return nil end
	local from, to = ns.ago(oldest), ns.ago(newest)
	if from == to then return from end
	return from .. " to " .. to
end

-- The file to use after `volume`: the next empty one in turn, or else the one whose
-- newest session is oldest. The second result is true when that file is full and would
-- be emptied. Age, not turn, decides, as a file may have been emptied or moved away.
local function successor(archive, volume)
	local oldest, oldestAge
	for step = 1, VOLUMES - 1 do
		local candidate = (volume + step - 1) % VOLUMES + 1
		local held = archive.held[candidate]
		if held.sessions == 0 then return candidate, false end
		-- A file from before the bookkeeping had dates counts as the oldest.
		local age = finite(held.newest) or 0
		if not oldest or age < oldestAge then oldest, oldestAge = candidate, age end
	end
	return oldest, true
end

-- The archive file that is emptied when the one in use is full. Nil while one is empty.
function ns.archiveNext()
	local archive = state()
	local volume, full = successor(archive, archive.volume)
	if full then return volume end
end

-- An archive file's table, after loading its add-on. Nil and a reason when that fails.
local function open(volume)
	local name = addonName(volume)
	local addons = C_AddOns
	local isLoaded = addons and addons.IsAddOnLoaded or IsAddOnLoaded
	local load = addons and addons.LoadAddOn or LoadAddOn

	if try(isLoaded, name) ~= true then
		if type(load) ~= "function" then return nil, "this game can't load add-ons on demand" end
		local loaded, reason = try(load, name)
		if loaded ~= true then return nil, tostring(reason or "it did not load") end
	end

	local variable = "StoryLogArchive" .. volume .. "DB"
	local db = _G[variable]
	if type(db) ~= "table" then
		db = {}
		_G[variable] = db
	end
	if type(db.version) == "number" and db.version > ns.VERSION then return nil, "a newer StoryLog wrote it" end
	db.version = ns.VERSION
	if type(db.sessions) ~= "table" then db.sessions = {} end
	return db
end

local function cannotOpen(volume, reason)
	say(("the log is large, but %s can't be used (%s), so nothing was moved and the log keeps growing. Install or enable that add-on."):format(addonName(volume), reason))
end

-- True when the file holds what was saved to it. Otherwise the game did not load it, or
-- it was removed: the player is told, and the count starts again from what is there.
local function intact(archive, volume, file)
	local held = archive.held[volume]
	if #file.sessions >= held.sessions then return true end

	say(("|cffff7070%s.lua came back with %d sessions where %d were saved.|r If you did not remove it yourself, copy that file and its .bak out of SavedVariables now, before you log out or reload. Nothing was deleted from the main log.")
		:format(addonName(volume), #file.sessions, held.sessions))
	archive.held[volume] = measure(file.sessions)
	return false
end

-- Empties a full file to make room. What it held stays on disk until logout.
local function empty(volume, file)
	local held = measure(file.sessions)
	if held.sessions == 0 then return end
	local span = ns.span(held)
	say(("|cffff7070every archive file is full, so %s.lua was emptied for newer sessions.|r It held %d sessions%s. To keep them, copy that file out of SavedVariables before you log out or reload, and add it to the app.")
		:format(addonName(volume), held.sessions, span and (", " .. span) or ""))
	file.sessions = {}
end

local function byId(sessions)
	local found = {}
	for index, session in ipairs(sessions) do
		if session.id then found[session.id] = index end
	end
	return found
end

-- Copies the given sessions to a file, without doubling what is already there.
local function copyTo(file, sessions)
	local there = byId(file.sessions)
	local ids = {}
	for _, session in ipairs(sessions) do
		if session.id then
			local index = there[session.id]
			if not index then
				file.sessions[#file.sessions + 1] = session
			elseif #(file.sessions[index].messages or {}) < #(session.messages or {}) then
				file.sessions[index] = session
			end
			ids[session.id] = #(session.messages or {})
		end
	end
	return ids
end

-- Step 1: removes from the main log what an archive file is now seen to hold.
local function confirm(archive)
	local pending = archive.pending
	local volume = pending.volume
	local file, reason = open(volume)
	if not file then
		cannotOpen(volume, reason)
		return false
	end

	local db = ns.db
	local there = byId(file.sessions)
	local saved = intact(archive, volume, file)
	if saved then
		-- The file can be whole and still not hold them: the game kept what it had before.
		for id in pairs(pending.ids) do
			if not there[id] then saved = false end
		end
		if not saved then
			say(("%s.lua was not saved with the sessions copied to it, so they were copied again. Nothing was deleted from the main log."):format(addonName(volume)))
		end
	end
	if not saved then
		-- An emptying that was not saved either is done again, or a newer file would go.
		if pending.emptied then empty(volume, file) end
		-- Whatever else it held, the sessions that were on their way are still here.
		local waiting = {}
		for _, session in ipairs(db.sessions) do
			if session.id and pending.ids[session.id] then waiting[#waiting + 1] = session end
		end
		pending.ids = copyTo(file, waiting)
		archive.held[volume] = measure(file.sessions)
		return false
	end

	local keep, moved = {}, 0
	for _, session in ipairs(db.sessions) do
		local index = session.id and pending.ids[session.id] and there[session.id]
		if index and #(file.sessions[index].messages or {}) >= #(session.messages or {}) then
			moved = moved + 1
		else
			keep[#keep + 1] = session
		end
	end
	db.sessions = keep
	archive.pending = nil
	archive.held[volume] = measure(file.sessions)
	if moved > 0 then
		say(("%d older sessions are now in %s.lua and no longer in the main log."):format(moved, addonName(volume)))
	end
	return true
end

-- Says which file goes next, when the one in use is full, while there is time to save it.
local function warnAhead(archive)
	local volume, full = successor(archive, archive.volume)
	if not full then return end
	local held = archive.held[volume]
	local span = ns.span(held)
	say(("when %s.lua is full, %s.lua will be emptied: %d sessions%s. Add it to the app before then."):format(
		addonName(archive.volume), addonName(volume), held.sessions, span and (", " .. span) or ""))
end

local function fits(held, incoming)
	return held.bytes + incoming.bytes <= ns.VOLUME_BYTES
		and (finite(held.constants) or 0) + incoming.constants <= ns.VOLUME_CONSTANTS
end

-- Step 2: copies every finished session to the archive file in use, or the next one.
-- `incoming` is what the main log holds, and `why` why it moves.
local function copy(archive, incoming, why)
	local db = ns.db
	local volume, emptying = archive.volume, false
	-- Each file is opened at most once, and then one is emptied, which takes anything.
	for _ = 1, VOLUMES + 1 do
		local file, reason = open(volume)
		if not file then
			cannotOpen(volume, reason)
			return
		end
		intact(archive, volume, file)
		if emptying then empty(volume, file) end

		local held = measure(file.sessions)
		archive.held[volume] = held
		-- An empty file takes anything, or a limit above its size could never be met.
		if held.sessions == 0 or fits(held, incoming) then
			local ids = copyTo(file, db.sessions)
			archive.volume = volume
			archive.held[volume] = measure(file.sessions)
			archive.pending = { volume = volume, ids = ids, emptied = emptying or nil }
			say(("%s, so %d sessions were copied to %s.lua. They leave the main log at the next login."):format(
				why, #db.sessions, addonName(volume)))
			warnAhead(archive)
			return
		end
		volume, emptying = successor(archive, volume)
	end
end

-- Runs at login, before the new session exists: every session here is finished.
function ns.archiveAtLogin()
	local db = ns.db
	local archive = state()

	if archive.pending and not confirm(archive) then return end

	local limit = finite(db.settings.limit) or 0
	if limit <= 0 then return end
	-- Only a session with an ID can be found again in an archive file.
	local movable = false
	for _, session in ipairs(db.sessions) do
		if session.id then movable = true end
	end
	if not movable then return end

	local log = measure(db.sessions)
	if log.bytes > limit * MB then
		copy(archive, log, ("the log passed %s MB"):format(tostring(limit)))
	elseif log.constants > ns.LOG_CONSTANTS then
		copy(archive, log, "the log is close to the most that the game can load")
	end
end

-- One line about the archive files, from the bookkeeping, for the status and the window.
function ns.archiveSummary()
	local archive = state()
	local sessions, bytes, oldest, newest = 0, 0, nil, nil
	for volume = 1, VOLUMES do
		local held = archive.held[volume]
		sessions = sessions + held.sessions
		bytes = bytes + (finite(held.bytes) or 0)
		local from, to = finite(held.oldest), finite(held.newest)
		if from and (not oldest or from < oldest) then oldest = from end
		if to and (not newest or to > newest) then newest = to end
	end
	local most = math.floor(VOLUMES * ns.VOLUME_BYTES / MB + 0.5)
	if sessions == 0 then return ("Archive files: empty, with room for about %d MB."):format(most) end

	local text = ("Archive files: %d sessions, about %s of %d MB"):format(sessions, ns.megabytes(bytes), most)
	local span = ns.span({ oldest = oldest, newest = newest })
	if span then text = text .. ", " .. span end
	text = text .. (". %s.lua is in use"):format(addonName(archive.volume))
	local following = ns.archiveNext()
	if following then text = text .. (", and %s.lua is emptied when it is full"):format(addonName(following)) end
	return text .. "."
end

-- For /storylog archive clear: the player moved the archive files away.
function ns.archiveClear()
	local archive = state()
	for volume = 1, VOLUMES do
		archive.held[volume] = { sessions = 0, lines = 0, bytes = 0 }
	end
	archive.volume = 1
	archive.pending = nil
end

function ns.megabytes(bytes)
	return ("%.1f"):format(bytes / MB)
end
