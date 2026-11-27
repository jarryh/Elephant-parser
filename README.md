# story-log

A local web app for World of Warcraft chat logs, and the addon that records them. Browse
and filter the logs, trim them by clicking, export them, and optionally turn a roleplay
evening into a story with Claude.

The app reads the logs of two addons:

- [StoryLog](addon/README.md), this project's own addon, which also saves where each line
  was said, who was in your group, and what happened besides talking: trades, quests,
  travel, fights, what NPCs said in their windows
- [Elephant](https://www.curseforge.com/wow/addons/elephant)

The app never edits a log. Adding a file saves a copy in the `Data` folder, and an older
file of the same name is kept under a dated name, unless the new StoryLog file holds every
line of it.

## Quick start

You need [Node.js](https://nodejs.org/) 20.9 or newer (20.x, or 22+).

1. Install:

   ```sh
   npm ci
   ```

2. Start, then open <http://127.0.0.1:5180>:

   ```sh
   npm run dev
   ```

3. Drop your log, `StoryLog.lua` or `Elephant.lua`, anywhere on the window, or press
   **Add file…**. WoW keeps both in:

   ```text
   World of Warcraft\<game>\WTF\Account\<account>\SavedVariables\
   ```

   `<game>` is `_forever_` for WoW Forever and `_retail_` for retail. WoW writes these
   files only on logout, exit or `/reload`.

The app saves the file in a `Data` folder in this project. You can also copy files there
yourself and press **Reload**. Choose between the files with the **File** menu at the top.
StoryLog's archive files, `StoryLog_Archive1.lua` and so on, open in the same way. Add
them now and then: when all are full, StoryLog empties the one with the oldest sessions
and warns you a file ahead (see [When the log grows](addon/README.md#when-the-log-grows)).

## Don't lose old logs

Elephant keeps **1,000 lines per log** by default and deletes the oldest. A busy Say log
can lose an RP evening within a day.

- In game, type `/elephant` to open the addon's options and raise **Max log lines** (up
  to 10,000). The setting is per realm and faction.
- Add each newer file to the app. It keeps the one before as a dated copy, such as
  `Elephant-2030-03-01.lua`, and nothing in `Data` is ever deleted.
- A StoryLog file that holds every line of the one before replaces it without a copy, as
  a copy would only take space. A StoryLog file that lost lines, such as `StoryLog.lua`
  after sessions moved to an archive file, keeps the copy.
- The app lists every `.lua` file in `Data`, so the dated copies stay readable.

## Using it

### Filter

The left panel filters by period, scene, place, character, channel, message type, sender
and text.
All channels form one timeline, and a message that Elephant saved to several logs is
shown once. **Roleplay types only** keeps speech, emotes, party, raid and NPC lines, dice
rolls, quests, and StoryLog's lines about what happened. Letters are private like
whispers, so they are not among them: tick **Mail** under Channel to see them.

### Scenes and places

A scene is a stretch of one character's roleplay. A new one starts:

- after 20 minutes without roleplay
- with a StoryLog file, also on entering or leaving a dungeon or house
- and when say, yell or an emote happens on another map, or more than 120 yards (twice
  earshot) from where the scene began. Party and raid chat don't move a scene.

NPC lines, quests and what happened (a trade, a fight, a flight) count in a scene only
between players' lines. They don't start one, move it or keep it going. Letters are no
part of a scene.

Choosing a scene sets the character, the period and the roleplay types, so the chat shows
exactly its lines, and removing, exporting and Story all work on it. To see whispers or
other chat from the same minutes, tick them under Message type. `/storylog note <text>` in
game names a scene.

With a StoryLog file you also get:

- the place above the lines where it changes, a Place filter, and places in exports
- roleplay names from Total RP 3, and `<OOC>` on lines said out of character
- a line where your party or raid changes, saying who joined or left and who leads, and
  under each scene the members who were there and said nothing
- the quests you accepted and handed in, linked to Wowhead, under the channel **Quests**,
  with what the quest giver said
- what happened, each kind under a channel of its own:

  | Channel          | Lines                                                         |
  | ---------------- | ------------------------------------------------------------- |
  | Group            | Invitations                                                   |
  | Trades and items | Trades, with what each side gave; items looted, received, made |
  | Mail             | Letters you sent or opened                                    |
  | Travel           | Zones you entered, flights, summons                           |
  | Fights           | Fights, boss fights, deaths, duels, new levels                |
  | NPC text         | What NPCs said in their windows, your answers, books and plaques |
  | Actions          | Spells and items you used out of combat, mounts, clothes      |

  Letters, books and quest texts show their first lines under the line, and the rest
  when you point at them.
- a **Map** tab. A filled dot is where the speaker stood. A ring is where you stood when
  you heard them. It draws what was said nearby (say, yell, emotes, NPC speech, dice
  rolls) and party or raid chat from members whose position is known. Quests and what
  happened are drawn where you stood. Guild chat, whispers and channels reach you
  anywhere, so they are not drawn.

The map has a plain grid. For a background, save a picture of the whole map (3:2) as
`Data/maps/<map id>.jpg`. The map's ID is shown in its menu.

Items, quests, spells and zones link to Wowhead, and NPCs can be looked up by
right-clicking their lines.

### Remove

| To                                   | Do                                            |
| ------------------------------------ | --------------------------------------------- |
| Remove or restore a line             | Click it                                      |
| Do the same to a range               | Click the first line, Shift+click the last    |
| Act on a sender or channel           | Right-click a line, or click a sender's name  |
| Remove a whole channel or sender     | Click × next to it in the filter panel        |
| Remove a period                      | Set the period, then click **Remove shown**   |
| Set a period from the log            | Right-click, then **Start/End the period here** |
| Undo or redo                         | Ctrl+Z / Ctrl+Y                               |

The × acts within the chosen characters and period, like the count beside it. The menu
actions act on the whole file.

The **Raw Lua** tab shows the same selection in the original source. Click a block to
remove it, or preview the cleaned export there.

Edits and filters save automatically to `workspace/`, separately for each file name.
They are stored by message rather than by line number, so they still apply when a newer
copy replaces the file: add it in the app, or copy it over and press **Reload**. A copy
under another name, such as a dated backup, starts without edits.

### Export

Exports contain the selection: what matches the filters and isn't removed.

- **Plain text**, **Markdown** or **JSON**
- **Elephant Lua** or **StoryLog Lua**: the original file with the other messages cut
  out. Settings stay, and so do Elephant's session markers. A StoryLog file also keeps
  each session's lists of speakers and places, including those of lines you cut. To use
  it in game, quit WoW and back up the original first.

Exports can contain whispers and BattleTags, so check before you share one.

### Story

1. Put your key in `.env` (see [.env.example](.env.example)):

   ```ini
   ANTHROPIC_API_KEY=your-key
   ```

2. Switch back to the browser. A **Story** button appears.
3. Select the scene with the filters, check the cost and write the story.

With a StoryLog file, the story gets more than the chat: who joined or left the group,
your notes, what happened (trades, fights, travel, what NPCs said), the time of day in the
game world and the festivals, where party members spoke from when they were elsewhere,
whom a line was addressed to, and what each character's Total RP 3 profile says about
them. Lines said out of character are marked, and the story leaves them out. Grey items
are left out, and letters go with whispers. A line you remove is not sent.

Finished stories are also saved to `workspace/stories/`.

The default model is `claude-opus-5-5`; set `ANTHROPIC_MODEL` to change it. If a safety
check declines a request, as can happen with violent RP, the API hands it to a fallback
model and the app tells you.

## Privacy

- The server listens only on 127.0.0.1 and refuses requests from other websites.
- `Data/`, `workspace/` and `.env` are ignored by Git.
- A file that you add in the app goes to `Data` on your computer and nowhere else. Only
  readable Elephant and StoryLog logs are accepted.
- Nothing leaves your computer unless you click **Write story** or **Count exactly**.
  Both send only the text shown under "See exactly what will be sent".
- Whispers, letters, game notices and status flags are left out of stories by default,
  and BattleTags are always masked. Character names and public chat are sent as they are.
- With a StoryLog file, stories also get the places, your quests and what happened, and
  for those who speak in the lines that are sent: their roleplay name, race, class, sex,
  guild and what their Total RP 3 profile says. Members of your party or raid at that
  time are named too, even if they said nothing.
- Wowhead links are plain links: Wowhead sees nothing until you click one. Players are
  never looked up there.
- The API key stays on the server. Only the key in `.env` is used.

## Development

| Command             | What it does               |
| ------------------- | -------------------------- |
| `npm run dev`       | Start the app              |
| `npm test`          | Run the tests              |
| `npm run typecheck` | Check types                |
| `npm run lint`      | Lint                       |
| `npm run check`     | All three checks           |

```text
addon/        the StoryLog addon for the game
src/shared/   parsers, filters, scenes, selection, exports, story prompt
src/server/   local server: files, saved edits, map images, Claude
src/web/      React interface
tests/        tests, with invented logs in tests/fixtures/
```

- The tests never call the real Claude API.
- `tests/real-data.test.ts` also checks your own `Data/Elephant.lua` and
  `Data/StoryLog.lua`, and is skipped without them. Run `npm test` after adding a new
  file: a failure there prints only numbers. This repository is public: never copy real
  names or chat into tests.
- The addon is tested against a simulated game client, `tests/addon/mock.lua`, run by
  [fengari](https://github.com/fengari-lua/fengari). That shows its own logic is right,
  not that the game behaves as simulated, so it still has to be tried in game.
  `tests/fixtures/storylog.lua` is what the addon saves there: a test fails if they differ.
- Several dev dependencies are pinned to keep Node 20.9 working (Vite 6, jsdom 26,
  ESLint 9, plugin-react 4).
- npm 10.2, bundled with Node 20.9, can fail with `edgesOut` when changing dependencies.
  `npm ci` works. To change dependencies use `npx npm@10.9.4 install <package>`.
