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
  me?: Unit;
  /** Lua that runs before the client exists, to choose what it has: `TRP = true`, `HOUSING = true`. */
  pre?: string;
  /** WoW Forever names characters "First Surname". Retail uses "Name-Realm". */
  regional?: boolean;
  build?: number;
}

export class Client {
  private readonly L = lauxlib.luaL_newstate();

  constructor({ saved, me = ELOWYN, pre = '', regional = true, build = 16001 }: Options = {}) {
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

  /** Logs out, and returns the file that the game would save. */
  logout(): string {
    this.run('fire("PLAYER_LOGOUT")');
    return this.get<string>('serialize("StoryLogDB", StoryLogDB)');
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
