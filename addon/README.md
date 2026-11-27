# StoryLog

A World of Warcraft addon that records roleplay chat together with the place where it was
said, who was in your group, and what happened besides talking: trades, quests, travel,
fights, what NPCs said in their windows. The [story-log app](../README.md) reads what it
saves. Its one window, which `/storylog` or the book icon at the minimap opens, chooses
what is recorded: you browse in the app.

It targets WoW Forever (1.60.1) and retail (12.1.5). It can run alongside Elephant.

> [!IMPORTANT]
> Say, yell, emotes and NPC speech have been recorded in the game. Party and raid chat,
> the group, quests, everything in the categories `items` to `profiles`, channels chosen
> by name, the window, the icon at the minimap and the archive files have only been
> tested against a simulated client. Keep Elephant running until an evening recorded with
> StoryLog looks right.

## Install

Copy all thirteen folders from `addon` into the game's AddOns folder: `StoryLog`, and
`StoryLog_Archive1` to `StoryLog_Archive12`.

```text
World of Warcraft\_forever_\Interface\AddOns\
```

For retail, use `_retail_` in place of `_forever_`. Then restart the game. The archive
folders show in the AddOns list as "StoryLog archive 1" to "12". Leave them enabled: the
game loads them only when StoryLog asks, as [When the log grows](#when-the-log-grows) explains.

While developing, link the folders instead of copying them. In a Command Prompt:

```bat
for %n in (StoryLog StoryLog_Archive1 StoryLog_Archive2 StoryLog_Archive3 StoryLog_Archive4 StoryLog_Archive5 StoryLog_Archive6 StoryLog_Archive7 StoryLog_Archive8 StoryLog_Archive9 StoryLog_Archive10 StoryLog_Archive11 StoryLog_Archive12) do mklink /J "<WoW>\_forever_\Interface\AddOns\%n" "<repo>\addon\%n"
```

A link that exists already is left as it is, so the same line adds the new folders after
an update.

## First check

1. Log in and type `/storylog status`. It shows the place it would save and whether the
   game gives coordinates there. "Not on this client" lists the game events that this
   client lacks, so what depends on them is not recorded.
2. Click the book icon at the edge of the minimap, or type `/storylog`. A window opens
   with a box for each kind of line and for each channel you are in. Untick **Whispers**,
   have someone whisper you, and tick it again. Close the window with Escape.
   Right-click the icon: it turns grey and recording stops. Right-click it again, then
   drag it somewhere else on the edge and type `/reload`: it stays there.
3. Say something, use an emote and `/roll`.
4. Invite someone to a party and talk in it with a member nearby. Pass the lead, then
   leave the party.
5. Accept a quest and hand one in. Talk to an NPC who has more to say, and choose an
   answer. Read a plaque or a book.
6. Trade an item and some coins. Loot something. Send a letter and open one.
7. Cross into another zone, take a flight, fight something, die and come back, duel.
8. Out of combat, cast a spell on someone, mount, and change a piece of clothing.
9. Talk inside a dungeon, away from a boss fight. `/storylog status` there says whether
   the game is hiding chat.
10. Type `/storylog status` again. If something could not be recorded in full, it says
    how many and shows the first error. The text of such a line is still saved.
11. Type `/storylog note First test`, then `/reload`.
12. Drop this file on the app's window, or copy it to the app's `Data` folder:

    ```text
    World of Warcraft\_forever_\WTF\Account\<account>\SavedVariables\StoryLog.lua
    ```

13. Run `npm test` in the app's folder. It checks the file against what the app read from
    it, and prints only numbers when something is wrong.

## Commands

| Command                              | What it does                                     |
| ------------------------------------ | ------------------------------------------------ |
| `/storylog`                          | Open or close the window                         |
| `/storylog status`                   | Show the status, the place that would be saved, and any errors |
| `/storylog on` or `off`              | Start or stop recording                          |
| `/storylog record <category> on/off` | Choose what is recorded                          |
| `/storylog channel <name> on/off`    | Record one channel, such as `Trade`, while `channels` is off. Alone, it lists them |
| `/storylog icon on/off`              | Show or hide the icon at the minimap             |
| `/storylog note <text>`              | Write a note, which names the scene              |
| `/storylog limit <MB>` or `off`      | Set the size at which the log is split: 1 to 8 MB, 3 at first |
| `/storylog archive`                  | Show what each archive file holds, and which is emptied next |
| `/storylog archive clear`            | Say that you moved the archive files away        |
| `/storylog prune <days>`             | Show what is older, to delete after confirming   |
| `/storylog help`                     | List the commands                                |

The window has a box for each category and for each channel you are in, and shows how
large the log and the archive files are. A change takes effect at once, and is the same
for all your characters. If the window can't open on a client, `/storylog` prints the
status instead and says why; recording goes on.

The icon at the minimap opens the window with a click, and turns recording on or off
with a right-click. It is grey while nothing is recorded, and says so when the mouse is
over it. Drag it to move it around the edge. A box in the window, or `/storylog icon off`,
hides it.

| Category    | Records                                                           | Default |
| ----------- | ----------------------------------------------------------------- | ------- |
| `speech`    | Say, yell and emotes                                              | on      |
| `party`     | Party, raid and instance chat, raid warnings                      | on      |
| `whispers`  | Whispers, including Battle.net whispers                           | on      |
| `creatures` | What NPCs and bosses say, yell and emote in chat                  | on      |
| `rolls`     | Dice rolls                                                        | on      |
| `group`    | Who is in your party or raid and who leads it, whenever that changes; invitations | on |
| `quests`   | The quests you accept and hand in, with their NPC                  | on      |
| `items`    | Trades, items you loot, receive or make, letters you send or open  | on      |
| `travel`   | Zones you enter, flights, summons                                  | on      |
| `combat`   | Fights and whom you fought, boss fights, deaths, duels, new levels | on      |
| `npc`      | What NPCs say in their windows, your answers, books, quest texts   | on      |
| `actions`  | Spells and items you use out of combat, mounts, clothes you change | on      |
| `profiles` | What Total RP 3 profiles say about a character, and whether a line was out of character | on |
| `guild`    | Guild and officer chat                                             | on      |
| `channels` | Every numbered channel: General, Trade and your own. While it is off, `/storylog channel` or the window choose single ones | off |
| `notices`  | System, loot, money, skill and similar lines                       | off     |

A channel chosen by name is recorded in every zone: `Trade` covers "Trade - City" and
"Trade - English 38" alike, but not "Trade (Services)". A log from before `party`,
`whispers` and `creatures` had their own switches gives them what `speech` had.

## What is saved

With each line: the time, the type, the text, the speaker and where you were. Where they
apply, also:

- the speaker's own position, for members of your group
- the language
- whom you had targeted when you spoke, and whom a group member had targeted
- the speaker's race, class, sex and Total RP 3 name
- what their Total RP 3 profile says: title, race, class, pronouns, age, eyes, height,
  build, "currently", "at first glance" and, for the third template of "About", the
  physical description; and their guild. A profile is read at most every 30 seconds.
  When the name or "currently" changes, earlier lines keep what was true then.
- whether Total RP 3 said that the speaker was out of character
- who was in your party or raid and who led it, including members who said nothing, and
  why you left: by yourself, removed, or disbanded. A group that the game shows within
  ten seconds of login counts as one that you were in already
- for a quest: its title, its number, the NPC you were talking to, and what they said
- with each session: the game world's time of day, and the day's festivals where the
  game has a calendar

And lines about what happened:

| Line        | What it saves                                                          |
| ----------- | ---------------------------------------------------------------------- |
| Invitation  | Whom you invited, who invited you, who declined                       |
| Trade       | With whom, the items and money each side gave. Saved when the game says "Trade complete.", or when both accepted and it reports no error within two seconds |
| Item        | Items you looted, received or made, with how many                     |
| Letter      | To or from whom, the subject, the text, items and money. Only letters you open, not those from the auction house |
| Zone        | A zone you entered, or a part of one where you stayed 20 seconds. Not while flying |
| Flight      | Where it began and ended, and how long it took                        |
| Summons     | Who summoned you, and where to                                        |
| Fight       | How long, and up to six enemies you targeted. Fights within 30 seconds of each other are one |
| Boss fight  | The boss, how long, and whether you won                               |
| Death       | That you died, and who brought you back                               |
| Duel        | Who challenged whom, and who won or fled. Also others' duels nearby  |
| Level       | Your new level                                                         |
| NPC text    | What an NPC says when you talk to them, once per NPC and text         |
| Answer      | The answer you chose in an NPC's window                               |
| Reading     | A book, letter or plaque you read, a page at a time                   |
| Action      | A spell or item you used, on whom, and how often within the minute that followed. Only out of combat, and only what you started |
| Clothes     | What you put on and took off, once you stop changing                  |

Battle.net whispers are saved without the friend's name or BattleTag.

## What the game doesn't allow

- **Strangers' positions.** A stranger's line is saved with your position. They were in
  earshot, which the WoW wiki puts at about 60 yards for say and emotes and 400 for yell.
- **Coordinates in dungeons, raids and battlegrounds.** Their names are still saved.
- **Some chat.** During boss encounters, Mythic+ runs and PvP matches, the game hides chat
  from addons, possibly elsewhere in dungeons and raids too. StoryLog saves only how many
  lines were hidden.
- **Other players' quests, trades and letters.** Only your own are visible.
- **The combat log on retail.** Add-ons may not read it, and even trying shows an error.
  So a fight is its start, its end and whom you targeted, not who hit whom, and a death
  doesn't say who killed you.
- **Some events on some clients.** StoryLog registers only the events that the client
  says it has. `/storylog status` lists those it lacks.
- **Who someone is, in combat on retail.** Enemy names, others' targets and spell targets
  can be hidden then. A line is saved without them.
- **More than one file per addon.** Hence the archive addons below.

## When the log grows

The game reads the whole of `StoryLog.lua` at every login. To keep it small, StoryLog moves
finished sessions to archive files, which the game reads only when StoryLog asks:

```text
SavedVariables\StoryLog_Archive1.lua  ...  StoryLog_Archive12.lua
```

1. At a login where the log is over the limit (about 3 MB, which is some 30,000 lines),
   the finished sessions are copied to the archive file in use. StoryLog says so in chat.
2. At the next login it checks that the archive file holds them, and only then removes
   them from the main log.
3. An archive file takes about 8 MB. Then the next one is used.

So the log and its archive files take about 100 MB at most, which is a year or more of
busy roleplay. A file also counts as full once it holds about 200,000 different texts and
numbers. Lua 5.1 can't read a file with more than 262,143 in one piece. Whether the game
reads saved files that way is not known, so StoryLog stays well below it. The main log
moves to an archive file at that point too, whatever the limit in MB, and
`/storylog status` and the window warn when one long session takes it close.

The app reads an archive file like any log: drop it on the app's window.

**When all twelve are full**, StoryLog empties the one whose sessions are oldest and uses
it again. It warns you a file ahead, at each copy: "when StoryLog_Archive3.lua is full,
StoryLog_Archive4.lua will be emptied". `/storylog archive` and the window show the same.
Add that file to the app before then, and nothing is lost: the app keeps it in `Data`.

When a file is emptied, StoryLog says so in red. The file on disk is still whole until
you log out or type `/reload`, so you can still copy it out of `SavedVariables` then.

To make room by hand instead, quit the game, add the `StoryLog_Archive` files to the app,
delete them from `SavedVariables`, then log in and type `/storylog archive clear`.

If StoryLog says that the game did not load a file, do what it says before you log out or
type `/reload`: copy that file and its `.bak` out of `SavedVariables`. The game saves what
it has in memory over the file on logout, so until then the file on disk is still whole.

## Looking after the file

- WoW writes it only on logout, exit or `/reload`. A crash loses what came after the last one.
- Only the oldest archive file is ever emptied without asking, after a warning, when all
  are full. Older sessions move to the archive files, and `/storylog prune` deletes only
  when you confirm it. Add the file to the app first.
- After pruning, saved edits still apply to the sessions that remain. A copy under another
  file name starts without edits.
- Don't rename the addon's folder. The saved file takes its name from it.
- When a game patch marks the addon out of date, update `## Interface` in `StoryLog.toc`.
