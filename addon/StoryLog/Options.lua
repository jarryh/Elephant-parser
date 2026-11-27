-- The window that /storylog opens: what is recorded, and how large the log is.
--
-- It is built the first time it opens, from the plainest parts that every client has.
-- When this client lacks one, /storylog prints the status instead and says why. Nothing
-- here can stop recording, and a problem here is not counted as a line that failed.

local _, ns = ...

local NAME = "StoryLogOptions"
local WIDTH = 480
local LEFT, RIGHT = 14, 250
local ROW = 24
-- More would not fit on a small screen.
local MAX_CHANNELS = 12

local LABELS = {
	speech = "Say, yell and emotes",
	party = "Party, raid and instance",
	whispers = "Whispers",
	creatures = "NPCs and bosses speaking",
	rolls = "Dice rolls",
	guild = "Guild and officers",
	notices = "System, loot and money",
	channels = "All channels",
	group = "Who is in the group",
	quests = "Quests",
	items = "Trades, loot and letters",
	travel = "Zones, flights, summons",
	combat = "Fights, deaths, duels",
	npc = "NPC windows and books",
	actions = "Spells, mounts, clothes",
	profiles = "Total RP 3 profiles",
}
local CHAT = { "speech", "party", "whispers", "creatures", "rolls", "guild", "notices" }
local EVENTS = { "group", "quests", "items", "travel", "combat", "npc", "actions", "profiles" }

local window, broken
-- Every checkbox, with what it shows: { button =, get = }.
local checks = {}
-- Checkboxes for channels, made as they are needed and used again.
local rows = {}
local channelsHeader, allChannels, noChannels, footer

-- Runs a script of the window. A failure is kept for /storylog status, and goes no further.
local function guard(fn, ...)
	local ok, problem = pcall(fn, ...)
	if not ok then ns.optionsProblem = tostring(problem) end
end

-- Calls what only some clients have, and goes on without it.
local function optional(fn, ...)
	if type(fn) == "function" then pcall(fn, ...) end
end

local function paint(texture, r, g, b, a)
	if type(texture.SetColorTexture) == "function" then
		texture:SetColorTexture(r, g, b, a)
	else
		texture:SetTexture("Interface\\Buttons\\WHITE8X8")
		texture:SetVertexColor(r, g, b, a)
	end
end

local function place(region, x, y)
	region:ClearAllPoints()
	region:SetPoint("TOPLEFT", window, "TOPLEFT", x, y)
end

local function text(template, x, y, words)
	local label = window:CreateFontString(nil, "ARTWORK", template)
	place(label, x, y)
	label:SetText(words)
	return label
end

-- A checkbox with its label beside it. `set` gets true or false when it is clicked.
local function checkbox(caption, x, y, get, set)
	local made, button = pcall(CreateFrame, "CheckButton", nil, window, "UICheckButtonTemplate")
	if not made or not button then
		button = CreateFrame("CheckButton", nil, window)
		button:SetNormalTexture("Interface\\Buttons\\UI-CheckBox-Up")
		button:SetPushedTexture("Interface\\Buttons\\UI-CheckBox-Down")
		button:SetHighlightTexture("Interface\\Buttons\\UI-CheckBox-Highlight", "ADD")
		button:SetCheckedTexture("Interface\\Buttons\\UI-CheckBox-Check")
	end
	button:SetSize(24, 24)
	place(button, x, y)

	local label = button:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
	label:SetPoint("LEFT", button, "RIGHT", 2, 1)
	label:SetText(caption)
	button.caption = label
	-- The label can be clicked too.
	optional(button.SetHitRectInsets, button, 0, -190, 0, 0)

	-- Some clients give 1 and nil for checked.
	button:SetScript("OnClick", function(self) guard(set, self:GetChecked() and true or false) end)
	local entry = { button = button, get = get }
	checks[#checks + 1] = entry
	return entry
end

local function category(name, x, y)
	return checkbox(LABELS[name], x, y,
		function() return ns.db.settings[name] == true end,
		function(on) ns.setCategory(name, on) end)
end

-- The channels to list: those the player is in, then others chosen before.
local function channelList(settings)
	local list, seen = {}, {}
	for _, channel in ipairs(ns.joinedChannels()) do
		seen[channel.key] = true
		list[#list + 1] = channel
	end
	local others = {}
	for key in pairs(settings.channelNames) do
		if not seen[key] then others[#others + 1] = key end
	end
	table.sort(others)
	for _, key in ipairs(others) do list[#list + 1] = { key = key, name = key .. " (not joined)" } end
	return list
end

local function channelRow(index)
	local row = rows[index]
	if row then return row end
	row = {}
	local entry = checkbox("", LEFT + 16, 0,
		function() return ns.db.settings.channels == true or ns.db.settings.channelNames[row.key] == true end,
		function(on) ns.setChannel(row.key, on) end)
	row.button = entry.button
	rows[index] = row
	return row
end

-- Lays out the channels under their heading. The y of what comes below them.
local function layoutChannels(settings, top)
	place(channelsHeader, LEFT, top)
	place(allChannels.button, LEFT, top - 20)
	local y = top - 20 - ROW

	local list = channelList(settings)
	local all = settings.channels == true
	for index = 1, math.max(#list, #rows) do
		local channel = index <= MAX_CHANNELS and list[index]
		local row = channel and channelRow(index) or rows[index]
		if channel then
			row.key = channel.key
			row.button.caption:SetText(channel.name)
			place(row.button, LEFT + 16, y)
			-- With all channels on, each one is recorded whatever its own box says.
			if all then row.button:Disable() else row.button:Enable() end
			local shade = all and 0.5 or 1
			row.button.caption:SetTextColor(shade, shade, shade)
			row.button:Show()
			y = y - ROW
		elseif row then
			row.key = nil
			row.button:Hide()
		end
	end
	local more = #list - MAX_CHANNELS
	if #list == 0 or more > 0 then
		noChannels:SetText(#list == 0 and "You are in no channels."
			or ("and %d more, which /storylog channel lists"):format(more))
		place(noChannels, LEFT + 20, y - 4)
		noChannels:Show()
		y = y - ROW
	else
		noChannels:Hide()
	end
	return y
end

local function footerText(settings)
	local lines = {}
	local bytes, constants = ns.logSize()
	local limit = settings.limit
	lines[#lines + 1] = ("Main log: about %s MB, %d lines. %s"):format(ns.megabytes(bytes), ns.lineCount(),
		limit > 0 and ("Older sessions move to an archive file past %s MB."):format(tostring(limit)) or "It is never split.")
	local warning = ns.logWarning(constants)
	if warning then lines[#lines + 1] = warning end
	lines[#lines + 1] = ns.archiveSummary()
	if ns.failures.count > 0 then
		lines[#lines + 1] = ("|cffff7070%d lines were not recorded in full.|r /storylog status shows the first error."):format(ns.failures.count)
	end
	lines[#lines + 1] = "Changes take effect at once. /storylog help lists the commands."
	return table.concat(lines, "\n"), #lines
end

local function refresh()
	local settings = ns.db.settings
	-- First, as it can add checkboxes.
	local left = layoutChannels(settings, -96 - #CHAT * ROW - 8)
	for _, entry in ipairs(checks) do entry.button:SetChecked(entry.get() == true) end

	local right = -96 - #EVENTS * ROW
	local y = math.min(left, right) - 8
	place(footer, LEFT + 2, y)
	local words, count = footerText(settings)
	footer:SetText(words)
	local ok, height = pcall(footer.GetStringHeight, footer)
	if not ok or type(height) ~= "number" or height <= 0 then height = count * 24 end
	window:SetHeight(-y + height + 16)
end

function ns.refreshOptions()
	if window and not broken then
		guard(function()
			if window:IsShown() then refresh() end
		end)
	end
end

local function build()
	window = CreateFrame("Frame", NAME, UIParent)
	window:Hide()
	window:SetSize(WIDTH, 420)
	window:SetPoint("CENTER")
	window:SetFrameStrata("DIALOG")
	optional(window.SetClampedToScreen, window, true)
	optional(window.SetToplevel, window, true)
	optional(function()
		window:EnableMouse(true)
		window:SetMovable(true)
		window:RegisterForDrag("LeftButton")
		window:SetScript("OnDragStart", window.StartMoving)
		window:SetScript("OnDragStop", window.StopMovingOrSizing)
	end)
	-- Escape closes it, as it does the game's own windows.
	if type(UISpecialFrames) == "table" then table.insert(UISpecialFrames, NAME) end

	local background = window:CreateTexture(nil, "BACKGROUND")
	background:SetAllPoints(window)
	paint(background, 0.06, 0.05, 0.09, 0.94)
	local bar = window:CreateTexture(nil, "BORDER")
	bar:SetPoint("TOPLEFT", window, "TOPLEFT", 0, 0)
	bar:SetPoint("TOPRIGHT", window, "TOPRIGHT", 0, 0)
	bar:SetHeight(32)
	paint(bar, 0.66, 0.61, 0.94, 0.25)

	text("GameFontNormalLarge", 16, -9, "StoryLog")
	local made, close = pcall(CreateFrame, "Button", nil, window, "UIPanelCloseButton")
	if not made or not close then
		close = CreateFrame("Button", nil, window)
		close:SetSize(24, 24)
		local cross = close:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
		cross:SetPoint("CENTER", close, "CENTER", 0, 0)
		cross:SetText("x")
	end
	close:ClearAllPoints()
	close:SetPoint("TOPRIGHT", window, "TOPRIGHT", -2, -2)
	close:SetScript("OnClick", function() window:Hide() end)

	checkbox("Recording", LEFT, -40,
		function() return ns.db.settings.recording == true end,
		function(on) ns.setRecording(on) end)
	checkbox("Icon at the minimap", RIGHT, -40,
		function() return ns.db.settings.icon == true end,
		function(on) ns.setIcon(on) end)

	text("GameFontNormal", LEFT, -76, "Chat")
	text("GameFontNormal", RIGHT, -76, "What happens")
	for index, name in ipairs(CHAT) do category(name, LEFT, -96 - (index - 1) * ROW) end
	for index, name in ipairs(EVENTS) do category(name, RIGHT, -96 - (index - 1) * ROW) end

	channelsHeader = text("GameFontNormal", LEFT, 0, "Channels")
	allChannels = category("channels", LEFT, 0)
	noChannels = text("GameFontDisableSmall", LEFT + 20, 0, "You are in no channels.")

	footer = window:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
	footer:SetJustifyH("LEFT")
	footer:SetWidth(WIDTH - 32)
end

local function toggle()
	if not window then build() end
	if window:IsShown() then
		window:Hide()
		return false
	end
	refresh()
	window:Show()
	return true
end

-- Opens the window, or closes it: true when it is open now. Nil and the reason when this
-- client can't show it.
function ns.toggleOptions()
	if broken then return nil, broken end
	local ok, result = pcall(toggle)
	if ok then return result end
	broken = tostring(result)
	ns.optionsProblem = broken
	if window then pcall(window.Hide, window) end
	return nil, broken
end
