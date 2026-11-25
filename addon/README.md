# StoryLog

A World of Warcraft addon that records roleplay chat together with the place where it was
said, for the [story-log app](../README.md) to read. It has no window: you browse in the app.

It targets WoW Forever (1.60.1) and retail (12.1.5). It can run alongside Elephant.

> [!IMPORTANT]
> StoryLog has been tested against a simulated client, not yet inside the game. Keep
> Elephant running until an evening recorded with StoryLog looks right in the app.

## Install

Copy the `StoryLog` folder into the game's AddOns folder:

```text
World of Warcraft\_forever_\Interface\AddOns\StoryLog
```

For retail, use `_retail_` in place of `_forever_`. Then restart the game.

While developing, link the folder instead of copying it. In a Command Prompt:

```bat
mklink /J "<WoW>\_forever_\Interface\AddOns\StoryLog" "<repo>\addon\StoryLog"
```

## First check

1. Log in and type `/storylog`. It shows the place it would save and whether the game
   gives coordinates there.
2. Say something, use an emote and `/roll`.
3. Talk in a party with a member nearby.
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
| `/storylog prune <days>`             | Show what is older, to delete after confirming   |
| `/storylog help`                     | List the commands                                |

| Category   | Records                                                            | Default |
| ---------- | ------------------------------------------------------------------ | ------- |
| `speech`   | Say, yell, emotes, party, raid, instance, whispers and NPC speech  | on      |
| `rolls`    | Dice rolls                                                         | on      |
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

Battle.net whispers are saved without the friend's name or BattleTag.

## What the game doesn't allow

- **Strangers' positions.** A stranger's line is saved with your position. They were in
  earshot, which the WoW wiki puts at about 60 yards for say and emotes and 400 for yell.
- **Coordinates in dungeons, raids and battlegrounds.** Their names are still saved.
- **Some chat.** During boss encounters, Mythic+ runs and PvP matches, the game hides chat
  from addons, possibly elsewhere in dungeons and raids too. StoryLog saves only how many
  lines were hidden.

## Looking after the file

- WoW writes it only on logout, exit or `/reload`. A crash loses what came after the last one.
- Nothing is deleted automatically, and the whole file loads at every login. At 50,000
  lines (about 5 MB) StoryLog suggests pruning. Add the file to the app first.
- After pruning, saved edits still apply to the sessions that remain. A copy under another
  file name starts without edits.
- Don't rename the addon's folder. The saved file takes its name from it.
- When a game patch marks the addon out of date, update `## Interface` in `StoryLog.toc`.
