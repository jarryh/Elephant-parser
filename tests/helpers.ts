import { readFileSync } from 'node:fs';
import luaparse from 'luaparse';
import { isTable, type LuaValue } from '../src/shared/lua';

/** The invented log. Line endings are normalised because Git may check it out as CRLF. */
export const FIXTURE = readFileSync(new URL('./fixtures/elephant.lua', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);

/** WoW on Windows writes CRLF, so this is what real files look like. */
export const FIXTURE_CRLF = FIXTURE.replace(/\n/g, '\r\n');

/** A value as nested `[key, value]` pairs, for comparing two parsers. */
export type Plain = string | number | boolean | null | [key: Plain, value: Plain][];

export function toPlain(value: LuaValue): Plain {
  return isTable(value) ? value.fields.map((field) => [field.key, toPlain(field.value)]) : value;
}

/** Parses with an independent Lua parser, to check ours against. */
export function referenceParse(source: string): Plain {
  // This parser works on bytes, so give it one char per UTF-8 byte.
  const chunk = luaparse.parse(Buffer.from(source, 'utf8').toString('latin1'), {
    luaVersion: '5.1',
    comments: false,
    encodingMode: 'pseudo-latin1',
  } as Partial<luaparse.Options>);
  const statement = chunk.body[0];
  if (statement?.type !== 'AssignmentStatement') throw new Error('expected an assignment');
  return fromAst(statement.init[0]!);
}

function fromAst(node: luaparse.Expression): Plain {
  switch (node.type) {
    case 'StringLiteral':
      return Buffer.from(node.value, 'latin1').toString('utf8');
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return node.value;
    case 'NilLiteral':
      return null;
    case 'UnaryExpression':
      return -(fromAst(node.argument) as number);
    case 'TableConstructorExpression': {
      let position = 1;
      return node.fields.map((field): [Plain, Plain] => {
        if (field.type === 'TableKey') return [fromAst(field.key), fromAst(field.value)];
        if (field.type === 'TableKeyString') return [field.key.name, fromAst(field.value)];
        return [position++, fromAst(field.value)];
      });
    }
    default:
      throw new Error(`unexpected ${node.type}`);
  }
}
