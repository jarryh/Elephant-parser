-- What changes hands: trades between characters, items that come your way, and letters.

local _, ns = ...
local try, safe, filled, finite, clip = ns.try, ns.safe, ns.filled, ns.finite, ns.clip

-- The seventh slot of the trade window is only enchanted, and stays with its owner.
local TRADE_SLOTS = 6
-- After the window closes, the game may still say that the trade went through.
local TRADE_LATE = 5
-- How long a trade that both accepted waits for the game to say that it failed after all.
local TRADE_VERDICT = 2

local function money(value)
	value = finite(tonumber((safe(value))))
	return value and value > 0 and math.floor(value) or nil
end

-- A count worth saving: more than one.
local function several(value)
	value = finite(tonumber((safe(value))))
	return value and value > 1 and value or nil
end

-- What lies in slots 1 to `count`, as `{ link =, count = }`. Nil for nothing.
-- `infoOf` gives an item's name and how many there are.
local function goods(count, linkOf, infoOf)
	local list = {}
	for slot = 1, count do
		local name, amount = infoOf(slot)
		local link = filled(linkOf(slot))
		-- The game may not have loaded the link yet. Then the name has to do, as a link shows it.
		if not link and filled(name) then link = "[" .. name .. "]" end
		if link then list[#list + 1] = { link = link, count = several(amount) } end
	end
	return #list > 0 and list or nil
end

--------------------------------------------------------------------------------
-- Trades

-- What is in the trade window, as last seen.
local trade

-- Once both have accepted, nothing can change, and the window empties as it closes.
local function look()
	if not trade or trade.accepted or trade.closed then return end
	trade.mine = goods(TRADE_SLOTS,
		function(slot) return try(GetTradePlayerItemLink, slot) end,
		function(slot)
			local name, _, amount = try(GetTradePlayerItemInfo, slot)
			return name, amount
		end)
	trade.theirs = goods(TRADE_SLOTS,
		function(slot) return try(GetTradeTargetItemLink, slot) end,
		function(slot)
			local name, _, amount = try(GetTradeTargetItemInfo, slot)
			return name, amount
		end)
	trade.myMoney = money(try(GetPlayerTradeMoney))
	trade.theirMoney = money(try(GetTargetTradeMoney))
end

local function saveTrade()
	local done = trade
	trade = nil
	if not done or not (done.mine or done.theirs or done.myMoney or done.theirMoney) then return end
	ns.event("items", "TRADE", { to = done.partner, a = done.mine, b = done.theirs, am = done.myMoney, bm = done.theirMoney })
end

ns.on("TRADE_SHOW", function()
	trade = nil
	if not ns.recording("items") then return end
	-- While trading, "npc" is the other player.
	local name = ns.unitPlayerName("npc")
	trade = { partner = name and (ns.speakerIndex(name, filled(try(UnitGUID, "npc")), false)) }
	look()
end)

for _, event in ipairs({ "TRADE_PLAYER_ITEM_CHANGED", "TRADE_TARGET_ITEM_CHANGED", "TRADE_MONEY_CHANGED", "TRADE_UPDATE" }) do
	ns.on(event, look)
end

ns.on("TRADE_ACCEPT_UPDATE", function(mine, theirs)
	if not trade or trade.closed then return end
	-- Taking an acceptance back opens the window to changes again.
	trade.accepted = false
	look()
	trade.accepted = safe(mine) == 1 and safe(theirs) == 1
end)

-- The window closes when a trade is done, and when it is called off. After both accepted
-- it can still fail, on full bags for one. The game then says so at once, so a trade
-- that it says nothing against counts as done: not every client says "Trade complete."
ns.on("TRADE_CLOSED", function()
	if not trade or trade.closed then return end
	trade.closed = ns.now()
	if not trade.accepted then return end
	local mine = trade
	local waiting = ns.after(TRADE_VERDICT, function()
		if trade == mine then saveTrade() end
	end)
	if not waiting then saveTrade() end
end)

local function complete()
	if trade and (not trade.closed or ns.now() - trade.closed <= TRADE_LATE) then saveTrade() end
end

-- The red error that follows a trade which both accepted is why it failed.
local function refused()
	if trade and trade.closed then trade = nil end
end

-- Newer clients give the message's type first.
ns.on("UI_INFO_MESSAGE", function(first, second)
	local text = filled(safe(second)) or filled(safe(first))
	if not text then return end
	if text == safe(ERR_TRADE_COMPLETE) then
		complete()
	elseif text == safe(ERR_TRADE_CANCELLED) then
		trade = nil
	end
end)
ns.on("UI_ERROR_MESSAGE", refused)
ns.wording("SYSTEM", "ERR_TRADE_COMPLETE", "items", complete)

--------------------------------------------------------------------------------
-- Items

local function item(kind)
	return function(link, count)
		link = filled(link)
		if link then ns.event("items", "ITEM", { k = kind, m = link, n = several(count) }) end
	end
end

-- The longer wordings first: "You receive loot: %sx%d." also fits "You receive loot: %s."
for _, wording in ipairs({
	{ "LOOT_ITEM_SELF_MULTIPLE", "loot" },
	{ "LOOT_ITEM_SELF", "loot" },
	{ "LOOT_ITEM_PUSHED_SELF_MULTIPLE", "got" },
	{ "LOOT_ITEM_PUSHED_SELF", "got" },
	{ "LOOT_ITEM_CREATED_SELF_MULTIPLE", "made" },
	{ "LOOT_ITEM_CREATED_SELF", "made" },
}) do
	ns.wording("LOOT", wording[1], "items", item(wording[2]))
end

--------------------------------------------------------------------------------
-- Letters

-- A letter on its way, until the game says that it was sent.
local sending

local function sent()
	local letter = sending
	sending = nil
	if letter then ns.event("items", "MAIL", letter) end
end

ns.hook("SendMail", function(recipient, subject, body)
	if not ns.recording("items") then return end
	sending = {
		k = "sent",
		who = clip(ns.plainName(safe(recipient)), 60),
		m = clip(safe(subject), 200),
		text = clip(safe(body), 2000),
		a = goods(finite(safe(ATTACHMENTS_MAX_SEND)) or 12,
			function(slot) return try(GetSendMailItemLink, slot) end,
			function(slot)
				local name, _, _, amount = try(GetSendMailItem, slot)
				return name, amount
			end),
		am = money(try(GetSendMailMoney)),
	}
	if not ns.has("MAIL_SEND_SUCCESS") then sent() end
end)

ns.on("MAIL_SEND_SUCCESS", sent)
ns.on("MAIL_FAILED", function() sending = nil end)

-- The letters read this session, so that opening one again saves nothing.
local read = {}

local function opened(_, index)
	index = finite(safe(index))
	if not index or not ns.recording("items") then return end
	local _, _, sender, subject, cash, _, _, _, _, _, _, canReply = try(GetInboxHeaderInfo, index)
	-- The auction house and the game's own letters can't be answered.
	if canReply == false then return end
	local body = try(GetInboxText, index)
	local key = table.concat({ tostring(sender), tostring(subject), tostring(body) }, "\n")
	if read[key] then return end
	read[key] = true

	ns.event("items", "MAIL", {
		k = "read",
		who = clip(ns.plainName(safe(sender)), 60),
		m = clip(safe(subject), 200),
		text = clip(safe(body), 2000),
		a = goods(finite(safe(ATTACHMENTS_MAX_RECEIVE)) or 16,
			function(slot) return try(GetInboxItemLink, index, slot) end,
			function(slot)
				local name, _, _, amount = try(GetInboxItem, index, slot)
				return name, amount
			end),
		am = money(cash),
	})
end

-- The mail window may be loaded only when it is first opened.
local hooked = false
local function hookInbox()
	if not hooked then hooked = ns.hook("InboxFrame_OnClick", opened) end
end
ns.atLogin(hookInbox)
ns.on("MAIL_SHOW", hookInbox)
ns.on("MAIL_INBOX_UPDATE", hookInbox)
