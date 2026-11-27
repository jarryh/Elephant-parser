-- The round icon on the edge of the minimap: a click opens the window, a right-click
-- turns recording on or off, and it is grey while nothing is recorded.
--
-- It is made at login from the plainest parts that every client has. When this client
-- lacks one, there is no icon and /storylog status says why. Nothing here can stop
-- recording, and a problem here is not counted as a line that failed.

local _, ns = ...

-- A book, which every client has among its item icons.
local IMAGE = "Interface\\Icons\\INV_Misc_Book_09"

local atan2 = math.atan2 or math.atan
local button, image

-- Calls what only some clients have, and goes on without it.
local function optional(fn, ...)
	if type(fn) == "function" then pcall(fn, ...) end
end

-- Puts the icon on the edge of the minimap, at an angle in degrees.
local function place(angle)
	local radius = Minimap:GetWidth() / 2 + 5
	local rad = math.rad(angle)
	button:ClearAllPoints()
	button:SetPoint("CENTER", Minimap, "CENTER", math.cos(rad) * radius, math.sin(rad) * radius)
end

-- The angle from the middle of the minimap to the mouse.
local function cursorAngle()
	local x, y = GetCursorPosition()
	local scale = Minimap:GetEffectiveScale()
	local cx, cy = Minimap:GetCenter()
	return math.deg(atan2(y / scale - cy, x / scale - cx)) % 360
end

local function refresh()
	local settings = ns.db.settings
	if settings.icon then button:Show() else button:Hide() end
	local off = not settings.recording
	if type(image.SetDesaturated) == "function" then
		image:SetDesaturated(off)
	else
		local shade = off and 0.5 or 1
		image:SetVertexColor(shade, shade, shade)
	end
end

function ns.refreshIcon()
	if button then pcall(refresh) end
end

local function tooltip(owner)
	local settings = ns.db.settings
	GameTooltip:SetOwner(owner, "ANCHOR_LEFT")
	GameTooltip:SetText("StoryLog")
	GameTooltip:AddLine(settings.recording and "|cff40c060Recording|r" or "|cffff7070Not recording|r")
	GameTooltip:AddLine(("%d lines this session"):format(#ns.session.messages), 1, 1, 1)
	GameTooltip:AddLine("Click: the window. Right-click: recording on or off.", 0.7, 0.7, 0.7)
	GameTooltip:AddLine("Drag to move this icon. /storylog icon off hides it.", 0.7, 0.7, 0.7)
	GameTooltip:Show()
end

-- Runs a script of the icon. A failure is kept for /storylog status, and goes no further.
local function guard(fn, ...)
	local ok, problem = pcall(fn, ...)
	if not ok then ns.iconProblem = tostring(problem) end
end

local function build()
	if type(Minimap) ~= "table" then error("this client has no minimap") end
	button = CreateFrame("Button", nil, Minimap)
	button:SetFrameStrata("MEDIUM")
	button:SetFrameLevel(8)
	button:SetSize(31, 31)
	button:RegisterForClicks("LeftButtonUp", "RightButtonUp")
	button:SetHighlightTexture("Interface\\Minimap\\UI-Minimap-ZoomButton-Highlight")

	-- The round border, and the image inside it. Retail draws them at other sizes.
	local retail = (tonumber((select(4, GetBuildInfo()))) or 0) >= 100000
	local border = button:CreateTexture(nil, "OVERLAY")
	border:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")
	local background = button:CreateTexture(nil, "BACKGROUND")
	background:SetTexture("Interface\\Minimap\\UI-Minimap-Background")
	image = button:CreateTexture(nil, "ARTWORK")
	image:SetTexture(IMAGE)
	-- Without the edge that item icons have.
	optional(image.SetTexCoord, image, 0.08, 0.92, 0.08, 0.92)
	if retail then
		border:SetSize(50, 50)
		border:SetPoint("TOPLEFT", button, "TOPLEFT", 0, 0)
		-- A pixel up, where the ring of the border is.
		background:SetSize(24, 24)
		background:SetPoint("CENTER", button, "CENTER", 0, 1)
		image:SetSize(18, 18)
		image:SetPoint("CENTER", button, "CENTER", 0, 1)
	else
		border:SetSize(53, 53)
		border:SetPoint("TOPLEFT", button, "TOPLEFT", 0, 0)
		background:SetSize(20, 20)
		background:SetPoint("TOPLEFT", button, "TOPLEFT", 7, -5)
		image:SetSize(17, 17)
		image:SetPoint("TOPLEFT", button, "TOPLEFT", 7, -6)
	end
	button.image = image

	button:SetScript("OnClick", function(_, mouse)
		guard(function()
			if mouse == "RightButton" then
				ns.setRecording(not ns.db.settings.recording)
				ns.sayRecording()
			else
				ns.showOptions()
			end
		end)
	end)
	local function hideTooltip() GameTooltip:Hide() end
	button:SetScript("OnEnter", function(self) guard(tooltip, self) end)
	button:SetScript("OnLeave", function() guard(hideTooltip) end)

	-- Dragged around the edge of the minimap. A client without dragging keeps it in place.
	optional(button.RegisterForDrag, button, "LeftButton")
	button:SetScript("OnDragStart", function(self)
		guard(hideTooltip)
		self:SetScript("OnUpdate", function() guard(function() place(cursorAngle()) end) end)
	end)
	button:SetScript("OnDragStop", function(self)
		self:SetScript("OnUpdate", nil)
		guard(function()
			local angle = math.floor(cursorAngle() + 0.5) % 360
			ns.db.settings.iconAngle = angle
			place(angle)
		end)
	end)

	place(ns.db.settings.iconAngle)
	refresh()
	ns.icon = button
end

ns.atLogin(function()
	local ok, problem = pcall(build)
	if ok then return end
	ns.iconProblem = tostring(problem)
	if button then pcall(button.Hide, button) end
	button = nil
end)
