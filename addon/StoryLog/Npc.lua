-- What NPCs say in their dialogue windows, what the recorder answers, what they read,
-- and what quest givers say about their quests.

local _, ns = ...
local try, safe, filled, finite, clip = ns.try, ns.safe, ns.filled, ns.finite, ns.clip

local TEXT_BYTES = 2000

-- Whose dialogue window is open, and the answers in it by ID, by order and by position.
local npc
local answers = { id = {}, order = {}, position = {} }
-- Each text is saved once per session, however often the window opens.
local seen = {}

local function readAnswers()
	answers = { id = {}, order = {}, position = {} }
	local gossip = C_GossipInfo
	local list = gossip and try(gossip.GetOptions)
	if type(list) == "table" then
		for position, option in ipairs(list) do
			option = safe(option)
			local name = type(option) == "table" and filled(safe(option.name))
			if name then
				local id, order = finite(safe(option.gossipOptionID)), finite(safe(option.orderIndex))
				if id then answers.id[id] = name end
				if order then answers.order[order] = name end
				answers.position[position] = name
			end
		end
		return
	end
	-- Older clients: text, type, text, type, ...
	local values = { try(GetGossipOptions) }
	for i = 1, #values, 2 do
		local name = filled(values[i])
		if name then answers.position[(i + 1) / 2] = name end
	end
end

ns.on("GOSSIP_SHOW", function()
	readAnswers()
	npc = nil
	if not ns.recording("npc") then return end
	npc = ns.unitSpeaker("npc", ns.me.guid)
	local gossip = C_GossipInfo
	local text = filled(try(gossip and gossip.GetText or GetGossipText))
	if not text then return end
	local key = tostring(npc) .. "\n" .. text
	if seen[key] then return end
	seen[key] = true
	ns.event("npc", "GOSSIP", { s = npc or false, m = clip(text, TEXT_BYTES) })
end)

-- The last answer, as several of the game's functions may report the same one.
local lastAnswer

local function answered(name)
	name = filled(name)
	if not name or not ns.recording("npc") then return end
	local time = ns.now()
	if lastAnswer and lastAnswer.name == name and time - lastAnswer.at <= 1 then return end
	lastAnswer = { name = name, at = time }
	ns.event("npc", "CHOICE", { to = npc, m = clip(name, 300) })
end

ns.hook(C_GossipInfo, "SelectOption", function(id)
	answered(answers.id[finite(safe(id)) or -1])
end)
ns.hook(C_GossipInfo, "SelectOptionByIndex", function(index)
	index = finite(safe(index)) or -1
	answered(answers.order[index] or answers.position[index])
end)
ns.hook("SelectGossipOption", function(index)
	answered(answers.position[finite(safe(index)) or -1])
end)

--------------------------------------------------------------------------------
-- Books, letters and plaques

ns.on("ITEM_TEXT_READY", function()
	if not ns.recording("npc") then return end
	local text = filled(try(ItemTextGetText))
	if not text then return end
	local title = filled(try(ItemTextGetItem))
	local page = finite(try(ItemTextGetPage)) or 1
	local key = table.concat({ title or "", tostring(page), text }, "\n")
	if seen[key] then return end
	seen[key] = true
	ns.event("npc", "READ", { m = clip(title, 120), n = page > 1 and page or nil, text = clip(text, TEXT_BYTES) })
end)

--------------------------------------------------------------------------------
-- Quests

-- What the quest window said, until the quest is accepted or handed in.
local offered, finished

local function questId()
	local id = finite(try(GetQuestID))
	return id and id > 0 and id or nil
end

ns.on("QUEST_DETAIL", function()
	offered = {
		id = questId(),
		title = filled(try(GetTitleText)),
		text = clip(try(GetQuestText), TEXT_BYTES),
		goal = clip(try(GetObjectiveText), 600),
	}
end)

ns.on("QUEST_COMPLETE", function()
	finished = { id = questId(), title = filled(try(GetTitleText)), text = clip(try(GetRewardText), TEXT_BYTES) }
end)

-- What the quest giver said about the quest that was just accepted or handed in. The
-- last window may have been that of another quest, which was turned down: so it has to
-- be this quest's by its number, or without one by its title.
function ns.questWords(event, id, title)
	local said
	if event == "QUEST_ACCEPTED" then
		said, offered = offered, nil
	else
		said, finished = finished, nil
	end
	if not said or not ns.recording("npc") then return nil end
	if said.id then
		if said.id ~= id then return nil end
	elseif not said.title or said.title ~= title then
		return nil
	end
	return said
end
