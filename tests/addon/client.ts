/** Runs the real addon files in a Lua VM against the simulated client in mock.lua. */
import { readFileSync } from 'node:fs';
import fengari from 'fengari';

const { lua, lauxlib, lualib, to_luastring } = fengari;

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const MOCK = read('./mock.lua');
const TOC = read('../../addon/StoryLog/StoryLog.toc');
/** The addon's files, in the order the game loads them. */
const FILES = TOC.split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((name) => ({ name, source: read(`../../addon/StoryLog/${name}`) }));

/** A Lua string literal. */
export const q = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export interface Unit {
  guid: string;
  first: string;
  second?: string;
}

export const ELOWYN: Unit = { guid: 'Player-9999-0000000A', first: 'Élowyn', second: 'Testwood' };

interface Options {
  /** The saved-variables file from an earlier session. */
  saved?: string;
  /** All the files from an earlier session, as `logoutAll` returns them. `saved` is its `StoryLog`. */
  files?: Files;
  me?: Unit;
  /** Lua that runs before the client exists, to choose what it has: `TRP = true`, `HOUSING = true`. */
  pre?: string;
  /** WoW Forever names characters "First Surname". Retail uses "Name-Realm". */
  regional?: boolean;
  build?: number;
}

/** Saved files by add-on name, and `character` for the one that each character has. */
export type Files = Record<string, string>;

export interface Checkbox {
  label: string;
  checked: boolean;
  enabled: boolean;
}

/** The icon at the minimap: shown or hidden, grey while not recording, and where. */
export interface IconState {
  shown: boolean;
  grey: boolean;
  /** Pixels from the middle of the minimap. */
  x: number;
  y: number;
}

export class Client {
  private readonly L = lauxlib.luaL_newstate();
  private readonly files: Files;

  constructor({ saved, files = {}, me = ELOWYN, pre = '', regional = true, build = 16001 }: Options = {}) {
    this.files = files;
    saved ??= files.StoryLog;
    lualib.luaL_openlibs(this.L);
    this.run(pre, 'pre');
    this.run(MOCK, 'mock.lua');
    this.run(`W.regional = ${regional}; W.build = ${build}`);
    this.run(`W.units.player = { guid = ${q(me.guid)}, first = ${q(me.first)}, second = ${me.second ? q(me.second) : 'nil'} }`);

    this.run('NS = {}');
    for (const { name, source } of FILES) {
      this.setGlobal('SOURCE', source);
      this.run(`assert(load(SOURCE, ${q(`@${name}`)}))("StoryLog", NS)`);
    }
    if (saved) this.run(saved, 'saved');
    if (files.character) this.run(files.character, 'saved for the character');
    // The game reads these only when their add-on is loaded.
    for (const [name, text] of Object.entries(files)) {
      if (!name.startsWith('StoryLog_')) continue;
      this.setGlobal('SOURCE', text);
      this.run(`W.addons[${q(name)}].saved = SOURCE`);
    }
    this.run('fire("ADDON_LOADED", "StoryLog")');
  }

  login(): this {
    return this.run('fire("PLAYER_LOGIN"); fire("PLAYER_ENTERING_WORLD", true, false)');
  }

  /** Runs Lua. An error there, such as one the addon lets through, is thrown here. */
  run(code: string, name = 'test'): this {
    this.call(code, name, 0);
    return this;
  }

  /** The value of a Lua expression. Lists are arrays, so they count from 0 here. */
  get<T = unknown>(expression: string): T {
    this.call(`return json(${expression})`, 'get', 1);
    const text = lua.lua_tojsstring(this.L, -1);
    lua.lua_settop(this.L, 0);
    return JSON.parse(text) as T;
  }

  /** Everything the addon wrote to the chat window. */
  printed(): string {
    return this.get<string[]>('W.printed').join('\n');
  }

  /** The checkboxes that can be seen in the addon's window, in the order they were made. */
  checkboxes(): Checkbox[] {
    return this.get<Checkbox[]>('checkboxes()');
  }

  /** Clicks the checkbox with this label, as the player would. */
  click(label: string): this {
    return this.run(`click(${q(label)})`);
  }

  /** The text that can be seen in the addon's window. */
  texts(): string[] {
    return this.get<string[]>('texts()');
  }

  /** The icon at the minimap, or null when there is none. */
  icon(): IconState | null {
    return this.get<IconState | null>('iconState()');
  }

  /** Logs out, and returns the file that the game would save. */
  logout(): string {
    this.run('fire("PLAYER_LOGOUT")');
    return this.get<string>('serialize("StoryLogDB", StoryLogDB)');
  }

  /** Logs out, and returns every file as it then is: those the game wrote, and the others untouched. */
  logoutAll(): Files {
    this.run('fire("PLAYER_LOGOUT")');
    return { ...this.files, ...this.get<Files>('savedFiles()') };
  }

  private setGlobal(name: string, value: string): void {
    lua.lua_pushstring(this.L, to_luastring(value));
    lua.lua_setglobal(this.L, to_luastring(name));
  }

  private call(code: string, name: string, results: number): void {
    const loaded = lauxlib.luaL_loadbuffer(this.L, to_luastring(code), null, to_luastring(`@${name}`));
    if (loaded !== lua.LUA_OK || lua.lua_pcall(this.L, 0, results, 0) !== lua.LUA_OK) {
      const message = lua.lua_tojsstring(this.L, -1);
      lua.lua_settop(this.L, 0);
      throw new Error(`Lua: ${message}`);
    }
  }
}
