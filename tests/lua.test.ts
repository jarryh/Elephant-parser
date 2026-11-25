import { describe, expect, it } from 'vitest';
import { LuaParseError, parseLua } from '../src/shared/lua';
import { FIXTURE, FIXTURE_CRLF, referenceParse, toPlain } from './helpers';

const value = (expression: string) => toPlain(parseLua(`X = ${expression}`).get('X')!);

describe('parseLua', () => {
  it.each([
    ['LF', FIXTURE],
    ['CRLF', FIXTURE_CRLF],
  ])('agrees with a reference parser (%s)', (_name, source) => {
    expect(toPlain(parseLua(source).get('ElephantDB')!)).toEqual(referenceParse(source));
  });

  it.each([
    [String.raw`"a\"b"`, 'a"b'],
    [String.raw`"back\\slash"`, 'back\\slash'],
    [String.raw`"line\nbreak\r\t"`, 'line\nbreak\r\t'],
    [String.raw`'single\'s'`, "single's"],
    [String.raw`"\195\137lowyn"`, 'Élowyn'],
    [String.raw`"\xC3\x89"`, 'É'],
    ['"příliš žluťoučký 🐘"', 'příliš žluťoučký 🐘'],
    ['"{ not, a = table } -- or a comment"', '{ not, a = table } -- or a comment'],
    ['[[long]]', 'long'],
    ['[==[a ]] b]==]', 'a ]] b'],
  ])('decodes the string %s', (input, expected) => {
    expect(value(input)).toBe(expected);
  });

  it.each([
    ['0', 0],
    ['1898622000', 1898622000],
    ['-12.5', -12.5],
    ['167.44658604332', 167.44658604332],
    ['1e3', 1000],
    ['0x1F', 31],
    ['-0x10', -16],
  ])('reads the number %s', (input, expected) => {
    expect(value(input)).toBe(expected);
  });

  it('numbers positional fields around explicit keys and nil', () => {
    expect(value('{ "a", ["k"] = 1, nil, name = true, "c"; [10] = false }')).toEqual([
      [1, 'a'],
      ['k', 1],
      [2, null],
      ['name', true],
      [3, 'c'],
      [10, false],
    ]);
  });

  it('skips comments, a BOM and reads several variables', () => {
    const globals = parseLua('﻿--[[ block\ncomment ]]\nA = 1 -- tail\nB = "two"\n');
    expect([...globals]).toEqual([
      ['A', 1],
      ['B', 'two'],
    ]);
  });

  it('keeps keys that are special in JavaScript', () => {
    expect(value('{ ["__proto__"] = 1 }')).toEqual([['__proto__', 1]]);
  });

  it('reports the line of an error', () => {
    expect(() => parseLua('X = {\r\n"ok",\r\n"broken\r\n}')).toThrowError(/Line [34]: unfinished string/);
  });

  it.each([
    'X = os.execute("calc")',
    'X = function() end',
    'X = {',
    'X = "\\q"',
    'print("hi")',
    `X = ${'{'.repeat(300)}${'}'.repeat(300)}`,
  ])('rejects anything that is not plain data: %.40s', (source) => {
    expect(() => parseLua(source)).toThrow(LuaParseError);
  });
});
