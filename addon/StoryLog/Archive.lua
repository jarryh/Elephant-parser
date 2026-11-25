-- Keeps the log small by moving finished sessions to archive files.
--
-- An add-on can't create or copy files: it has one saved file, which the game reads at
-- every login. But the game reads the file of a load-on-demand add-on only when that
-- add-on is loaded. So StoryLog_Archive1 to 5 hold older sessions, and are loaded only
-- here, when sessions move.
--
-- The game can fail to load a saved file, and then saves the empty result over it. So
-- nothing leaves the main log until an archive file has been seen to hold it, one login
-- after it was copied there.

local _, ns = ...
local say, try, finite = ns.say, ns.try, ns.finite

local VOLUMES = 5
local MB = 1024 * 1024
-- What one archive file takes before the next one is used.
ns.VOLUME_BYTES = 8 * MB
ns.ARCHIVE_VOLUMES = VOLUMES

local function addonName(volume)
	return "StoryLog_Archive" .. volume
end

-- Roughly the bytes that a session takes in the saved file. An add-on can't see files.
function ns.sessionSize(session)
	local bytes = 300
	for _, message in ipairs(session.messages or {}) do
		bytes = bytes + 80 + #(message.m or "")
		if message.g then bytes = bytes + 12 + 4 * #message.g end
	end
	return bytes + 190 * #(session.places or {}) + 150 * #(session.speakers or {})
end

local function measure(sessions)
	local lines, bytes = 0, 0
	for _, session in ipairs(sessions) do
		lines = lines + #(session.messages or {})
		bytes = bytes + ns.sessionSize(session)
	end
	return { sessions = #sessions, lines = lines, bytes = bytes }
end

function ns.logSize()
	return measure(ns.db.sessions).bytes
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
	say(("the log is large, but %s can't be used (%s), so nothing was moved. Install or enable that add-on."):format(addonName(volume), reason))
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
	if not intact(archive, volume, file) then
		-- Whatever else it held, the sessions that were on their way are still here.
		local waiting = {}
		for _, session in ipairs(db.sessions) do
			if session.id and pending.ids[session.id] then waiting[#waiting + 1] = session end
		end
		pending.ids = copyTo(file, waiting)
		archive.held[volume] = measure(file.sessions)
		return false
	end

	local there = byId(file.sessions)
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

-- Step 2: copies every finished session to the archive file in use, or the next one.
local function copy(archive, incoming)
	local db = ns.db
	for volume = archive.volume, VOLUMES do
		local file, reason = open(volume)
		if not file then
			cannotOpen(volume, reason)
			return
		end
		intact(archive, volume, file)

		local held = measure(file.sessions)
		archive.held[volume] = held
		-- An empty file takes anything, or a limit above its size could never be met.
		if held.sessions == 0 or held.bytes + incoming <= ns.VOLUME_BYTES then
			local ids = copyTo(file, db.sessions)
			archive.volume = volume
			archive.held[volume] = measure(file.sessions)
			archive.pending = { volume = volume, ids = ids }
			say(("the log passed %s MB, so %d sessions were copied to %s.lua. They leave the main log at the next login."):format(
				tostring(db.settings.limit), #db.sessions, addonName(volume)))
			return
		end
	end

	archive.volume = VOLUMES
	say(("all %d archive files are full, so the log keeps growing. Quit the game, add the StoryLog_Archive files in SavedVariables to the app, delete them there, and type /storylog archive clear."):format(VOLUMES))
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
	local bytes = ns.logSize()
	if movable and bytes > limit * MB then copy(archive, bytes) end
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
