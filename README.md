# Elephant-parser

A local web app for chat logs saved by the World of Warcraft addon
[Elephant](https://www.curseforge.com/wow/addons/elephant). Browse and filter them, trim
them by clicking, export them, and optionally turn a roleplay evening into a story with
Claude.

Your Lua file is only ever read, never changed.

## Quick start

You need [Node.js](https://nodejs.org/) 20.9 or newer (20.x, or 22+).

1. Install:

   ```sh
   npm ci
   ```

2. Copy your log into a `Data` folder in this project. WoW keeps it at:

   ```text
   World of Warcraft\_retail_\WTF\Account\<account>\SavedVariables\Elephant.lua
   ```

   WoW writes this file only on logout, exit or `/reload`.

3. Start, then open <http://127.0.0.1:5180>:

   ```sh
   npm run dev
   ```

## Don't lose old logs

Elephant keeps **1,000 lines per log** by default and deletes the oldest. A busy Say log
can lose an RP evening within a day.

- In game, type `/elephant` to open the addon's options and raise **Max log lines** (up
  to 10,000). The setting is per realm and faction.
- Keep dated copies of the file in `Data`, for example `Elephant-2030-03-01.lua`. The app
  lists every `.lua` file there.

## Using it

### Filter

The left panel filters by period, character, channel, message type, sender and text.
All channels form one timeline, and a message that Elephant saved to several logs is
shown once. **Roleplay types only** keeps speech, emotes, party, raid and NPC lines.

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
copy replaces the file. Press **Reload** to read it. A copy under another name, such as
a dated backup, starts without edits.

### Export

Exports contain the selection: what matches the filters and isn't removed.

- **Plain text**, **Markdown** or **JSON**
- **Elephant Lua**: the original file with the other messages cut out. Settings and
  session markers stay. To use it in game, quit WoW and back up the original first.

Exports can contain whispers and BattleTags, so check before you share one.

### Story

1. Put your key in `.env` (see [.env.example](.env.example)):

   ```ini
   ANTHROPIC_API_KEY=your-key
   ```

2. Switch back to the browser. A **Story** button appears.
3. Select the scene with the filters, check the cost and write the story.

Finished stories are also saved to `workspace/stories/`.

The default model is `claude-opus-5-5`; set `ANTHROPIC_MODEL` to change it. If a safety
check declines a request, as can happen with violent RP, the API hands it to a fallback
model and the app tells you.

## Privacy

- The server listens only on 127.0.0.1 and refuses requests from other websites.
- `Data/`, `workspace/` and `.env` are ignored by Git.
- Nothing leaves your computer unless you click **Write story** or **Count exactly**.
  Both send only the text shown under "See exactly what will be sent".
- Whispers, game notices and status flags are left out of stories by default, and
  BattleTags are always masked. Character names and public chat are sent as they are.
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
src/shared/   parser, filters, selection, exports, story prompt
src/server/   local server: files, saved edits, Claude
src/web/      React interface
tests/        tests, with an invented log in tests/fixtures/
```

- The tests never call the real Claude API.
- `tests/real-data.test.ts` also checks your own `Data/Elephant.lua`, and is skipped
  without one. This repository is public: never copy real names or chat into tests.
- Several dev dependencies are pinned to keep Node 20.9 working (Vite 6, jsdom 26,
  ESLint 9, plugin-react 4).
- npm 10.2, bundled with Node 20.9, can fail with `edgesOut` when changing dependencies.
  `npm ci` works. To change dependencies use `npx npm@10.9.4 install <package>`.
