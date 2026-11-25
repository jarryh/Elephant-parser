/** The few parts of fengari (a Lua VM in JavaScript) that the tests use. It ships no types. */
declare module 'fengari' {
  type State = object;
  const fengari: {
    lua: {
      LUA_OK: number;
      lua_pcall(L: State, args: number, results: number, handler: number): number;
      lua_tojsstring(L: State, index: number): string;
      lua_pushstring(L: State, text: Uint8Array): void;
      lua_setglobal(L: State, name: Uint8Array): void;
      lua_settop(L: State, index: number): void;
    };
    lauxlib: {
      luaL_newstate(): State;
      luaL_loadbuffer(L: State, code: Uint8Array, size: number | null, name: Uint8Array): number;
    };
    lualib: { luaL_openlibs(L: State): void };
    to_luastring(text: string): Uint8Array;
  };
  export default fengari;
}
