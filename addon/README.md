# StoryLog

A World of Warcraft addon that records roleplay chat together with the place where it was
said, who was in your group, and the quests you took. The [story-log app](../README.md)
reads what it saves. It has no window: you browse in the app.

It targets WoW Forever (1.60.1) and retail (12.1.5). It can run alongside Elephant.

> [!IMPORTANT]
> Say, yell, emotes and NPC speech have been recorded in the game. Party and raid chat,
> the group, quests and the archive files have only been tested against a simulated
> client. Keep Elephant running until an evening recorded with StoryLog looks right.

## Install

Copy all six folders from `addon` into the game's AddOns folder: `StoryLog`, and
`StoryLog_Archive1` to `StoryLog_Archive5`.

```text
World of Warcraft\_forever_\Interface\AddOns\
```

For retail, use `_retail_` in place of `_forever_`. Then restart the game. The archive
folders show in the AddOns list as "StoryLog archive 1" to "5". Leave them enabled: the
game loads them only when StoryLog asks, as [When the log grows](#when-the-log-grows) explains.

While developing, link the folders instead of copying them. In a Command Prompt:

```bat
for %n in (StoryLog StoryLog_Archive1 StoryLog_Archive2 StoryLog_Archive3 StoryLog_Archive4 StoryLog_Archive5) do mklink /J "<WoW>\_forever_\Interface\AddOns\%n" "<repo>\addon\%n"
```

## First check

1. Log in and type `/storylog`. It shows the place it would save and whether the game
   gives coordinates there.
2. Say something, use an emote and `/roll`.
3. Join a party and talk in it with a member nearby. Accept a quest and hand one in.
4. Talk inside a dungeon, away from a boss fight. `/storylog` there says whether the game
   is hiding chat.
5. Type `/storylog` again. If a line could not be recorded in full, it says how many and
   shows the first error. The text of such a line is still saved.
6. Type `/storylog note First test`, then `/reload`.
7. Drop this file on the app's window, or copy it to the app's `Data` folder:

   ```text
   World of Warcraft\_forever_\WTF\Account\<account>\SavedVariables\StoryLog.lua
   ```

8. Run `npm test` in the app's folder. It checks the file against what the app read from
   it, and prints only numbers when something is wrong.

## Commands

| Command                              | What it does                                     |
| ------------------------------------ | ------------------------------------------------ |
| `/storylog`                          | Show the status, the place that would be saved, and any errors |
| `/storylog on` or `off`              | Start or stop recording                          |
| `/storylog record <category> on/off` | Choose what is recorded                          |
| `/storylog note <text>`              | Write a note, which names the scene              |
| `/storylog limit <MB>` or `off`      | Set the size at which the log is split (3 MB)    |
| `/storylog archive`                  | Show what each archive file holds                |
| `/storylog archive clear`            | Say that you moved the archive files away        |
| `/storylog prune <days>`             | Show what is older, to delete after confirming   |
| `/storylog help`                     | List the commands                                |

| Category   | Records                                                            | Default |
| ---------- | ------------------------------------------------------------------ | ------- |
| `speech`   | Say, yell, emotes, party, raid, instance, whispers and NPC speech  | on      |
| `rolls`    | Dice rolls                                                         | on      |
| `group`    | Who is in your party or raid, whenever that changes                | on      |
| `quests`   | The quests you accept and hand in, with their NPC                  | on      |
| `guild`    | Guild and officer chat                                             | on      |
| `channels` | General, Trade and other channels                                  | off     |
| `notices`  | System, loot, money, skill and similar lines                       | off     |

## What is saved

With each line: the time, the type, the text, the speaker and where you were. Where they
apply, also:

- the speaker's own position, for members of your group
- the language
- whom you had targeted when you spoke
- the speaker's race, class and Total RP 3 name
- who was in your party or raid, including members who said nothing
- for a quest: its title, its number and the NPC you were talking to

Battle.net whispers are saved without the friend's name or BattleTag.

## What the game doesn't allow

- **Strangers' positions.** A stranger's line is saved with your position. They were in
  earshot, which the WoW wiki puts at about 60 yards for say and emotes and 400 for yell.
- **Coordinates in dungeons, raids and battlegrounds.** Their names are still saved.
- **Some chat.** During boss encounters, Mythic+ runs and PvP matches, the game hides chat
  from addons, possibly elsewhere in dungeons and raids too. StoryLog saves only how many
  lines were hidden.
- **Other players' quests.** Only your own are visible.
- **More than one file per addon.** Hence the archive addons below.

## When the log grows

The game reads the whole of `StoryLog.lua` at every login. To keep it small, StoryLog moves
finished sessions to archive files, which the game reads only when StoryLog asks:

```text
SavedVariables\StoryLog_Archive1.lua  ...  StoryLog_Archive5.lua
```

1. At a login where the log is over the limit (about 3 MB, which is some 30,000 lines),
   the finished sessions are copied to the archive file in use. StoryLog says so in chat.
2. At the next login it checks that the archive file holds them, and only then removes
   them from the main log.
3. An archive file takes about 8 MB. Then the next one is used.

The app reads an archive file like any log: drop it on the app's window.

When all five are full, StoryLog says so at every login and the log keeps growing. Then:

1. Quit the game.
2. Add the `StoryLog_Archive` files to the app.
3. Delete them from `SavedVariables`.
4. Log in and type `/storylog archive clear`.

If StoryLog says that the game did not load a file, do what it says before you log out or
type `/reload`: copy that file and its `.bak` out of `SavedVariables`. The game saves what
it has in memory over the file on logout, so until then the file on disk is still whole.

## Looking after the file

- WoW writes it only on logout, exit or `/reload`. A crash loses what came after the last one.
- Nothing is deleted automatically. Older sessions move to the archive files, and
  `/storylog prune` deletes only when you confirm it. Add the file to the app first.
- After pruning, saved edits still apply to the sessions that remain. A copy under another
  file name starts without edits.
- Don't rename the addon's folder. The saved file takes its name from it.
- When a game patch marks the addon out of date, update `## Interface` in `StoryLog.toc`.
