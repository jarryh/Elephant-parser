/** The addon can't run outside the game, so this checks what can be checked from here. */
import { readdirSync, readFileSync } from 'node:fs';
import luaparse from 'luaparse';
import { describe, expect, it } from 'vitest';

const folder = new URL('../addon/StoryLog/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, folder), 'utf8');
const files = readdirSync(folder).filter((name) => name.endsWith('.lua'));
const toc = read('StoryLog.toc').split(/\r?\n/);

const parse = (name: string) =>
  luaparse.parse(Buffer.from(read(name), 'utf8').toString('latin1'), {
    luaVersion: '5.1',
    scope: true,
    encodingMode: 'pseudo-latin1',
  } as Partial<luaparse.Options>);

describe('the StoryLog addon', () => {
  it.each(files)('%s is valid Lua 5.1', (name) => {
    expect(() => parse(name)).not.toThrow();
  });

  it('loads every file, Core first, as the others need it', () => {
    const listed = toc.filter((line) => line && !line.startsWith('#'));
    expect([...listed].sort()).toEqual([...files].sort());
    expect(listed[0]).toBe('Core.lua');
  });

  it('loads in WoW Forever and in retail', () => {
    const versions = toc.find((line) => line.startsWith('## Interface:'))!.slice(13).split(',').map(Number);
    expect(versions.some((version) => version >= 16000 && version < 20000)).toBe(true);
    expect(versions.some((version) => version >= 120000)).toBe(true);
  });

  it('saves the variable that the app reads', () => {
    expect(toc).toContain('## SavedVariables: StoryLogDB');
  });

  it('comes with the archive add-ons that it fills, which the game loads only on demand', () => {
    const addons = new URL('../addon/', import.meta.url);
    const archives = readdirSync(addons).filter((name) => name.startsWith('StoryLog_Archive'));
    const count = Number(/local VOLUMES = (\d+)/.exec(read('Archive.lua'))![1]);
    expect(archives).toEqual(Array.from({ length: count }, (_, index) => `StoryLog_Archive${index + 1}`));

    for (const name of archives) {
      const lines = readFileSync(new URL(`${name}/${name}.toc`, addons), 'utf8').split(/\r?\n/);
      expect(lines).toContain('## LoadOnDemand: 1');
      expect(lines).toContain('## Dependencies: StoryLog');
      // The variable that Archive.lua and the app look for.
      expect(lines).toContain(`## SavedVariables: ${name.replace('_', '')}DB`);
      expect(lines).toContain(toc.find((line) => line.startsWith('## Interface:')));
      const files = lines.filter((line) => line && !line.startsWith('#'));
      expect(readdirSync(new URL(`${name}/`, addons)).sort()).toEqual([...files, `${name}.toc`].sort());
    }
  });

  it('makes no stray globals, which other addons would share', () => {
    const assigned = files.flatMap((name) =>
      [...read(name).matchAll(/^\s*([A-Za-z_]\w*) = /gm)]
        .map((found) => found[1]!)
        .filter((variable) => {
          const { globals } = parse(name) as unknown as { globals: { name: string }[] };
          return globals.some((global) => global.name === variable);
        }),
    );
    expect(assigned.sort()).toEqual(['SLASH_STORYLOG1', 'StoryLogCharDB', 'StoryLogDB']);
  });
});
