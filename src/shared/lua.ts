/**
 * A parser for the data subset of Lua that WoW writes to SavedVariables.
 * It never evaluates code, and it records source offsets so that entries can be
 * highlighted and cut out without re-serialising the file.
 */

export type LuaValue = string | number | boolean | null | LuaTable;

export interface LuaField {
  key: string | number | boolean;
  /** False for positional fields such as `{ "a", "b" }`. */
  explicitKey: boolean;
  value: LuaValue;
  start: number;
  valueStart: number;
  valueEnd: number;
  /** After the separator, if there is one. */
  end: number;
}

export interface LuaTable {
  fields: LuaField[];
}

export class LuaParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`Line ${line}: ${message}`);
    this.name = 'LuaParseError';
  }
}

const MAX_DEPTH = 200;

const ESCAPES: Record<string, number> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '\\': 92,
  '"': 34,
  "'": 39,
};

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/y;
const NUMBER = /-?(?:0[xX][0-9a-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/y;
const LONG_OPEN = /\[(=*)\[/y;

class Parser {
  private pos: number;
  private depth = 0;
  private readonly utf8 = new TextDecoder();

  constructor(private readonly src: string) {
    this.pos = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  }

  parseFile(): Map<string, LuaValue> {
    const globals = new Map<string, LuaValue>();
    for (;;) {
      this.skip();
      if (this.pos >= this.src.length) return globals;
      const name = this.match(IDENTIFIER);
      if (!name) this.fail('expected a variable name');
      this.skip();
      this.expect('=');
      globals.set(name[0], this.value());
      this.skip();
      if (this.src[this.pos] === ';') this.pos++;
    }
  }

  private value(): LuaValue {
    this.skip();
    const char = this.src[this.pos];
    if (char === '{') return this.table();
    if (char === '"' || char === "'") return this.quoted(char);
    if (char === '[') {
      const long = this.longBracket();
      if (long !== null) return long;
    }

    const number = this.match(NUMBER);
    if (number) return Number(number[0].startsWith('-') ? -Number(number[0].slice(1)) : number[0]);

    const word = this.match(IDENTIFIER)?.[0];
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'nil') return null;
    return this.fail('expected a string, number, boolean, nil or table');
  }

  private table(): LuaTable {
    if (++this.depth > MAX_DEPTH) this.fail('tables are nested too deeply');
    this.pos++;
    const fields: LuaField[] = [];
    let position = 1;

    for (;;) {
      this.skip();
      if (this.src[this.pos] === '}') break;

      const start = this.pos;
      const named = this.key();
      this.skip();
      const valueStart = this.pos;
      const value = this.value();
      const valueEnd = this.pos;
      const field: LuaField = {
        key: named ?? position++,
        explicitKey: named !== null,
        value,
        start,
        valueStart,
        valueEnd,
        end: valueEnd,
      };
      fields.push(field);

      this.skip();
      const separator = this.src[this.pos];
      if (separator === ',' || separator === ';') field.end = ++this.pos;
      else if (separator !== '}') this.fail('expected "," or "}"');
    }

    this.pos++;
    this.depth--;
    return { fields };
  }

  /** Consumes `[key] =` or `name =`. Returns null for a positional field. */
  private key(): LuaField['key'] | null {
    const start = this.pos;
    if (this.src[start] === '[') {
      if (this.src[start + 1] === '[' || this.src[start + 1] === '=') return null;
      this.pos++;
      const key = this.value();
      if (key === null || typeof key === 'object') this.fail('unsupported table key');
      this.skip();
      this.expect(']');
      this.skip();
      this.expect('=');
      return key;
    }

    const name = this.match(IDENTIFIER);
    if (!name) return null;
    this.skip();
    if (this.src[this.pos] === '=') {
      this.pos++;
      return name[0];
    }
    this.pos = start;
    return null;
  }

  private quoted(quote: string): string {
    this.pos++;
    let out = '';
    // Numeric escapes are bytes, so several of them can form one UTF-8 character.
    let bytes: number[] = [];
    const flush = () => {
      if (!bytes.length) return;
      out += this.utf8.decode(new Uint8Array(bytes));
      bytes = [];
    };

    for (;;) {
      const char = this.src[this.pos++];
      if (char === undefined || char === '\n' || char === '\r') this.fail('unfinished string');
      if (char === quote) break;
      if (char !== '\\') {
        flush();
        out += char;
        continue;
      }

      const next = this.src[this.pos++] ?? '';
      const simple = ESCAPES[next];
      if (simple !== undefined) {
        bytes.push(simple);
      } else if (next === '\n' || next === '\r') {
        const other = next === '\n' ? '\r' : '\n';
        if (this.src[this.pos] === other) this.pos++;
        bytes.push(10);
      } else if (next >= '0' && next <= '9') {
        this.pos--;
        const byte = Number(this.match(/\d{1,3}/y)?.[0]);
        if (byte > 255) this.fail('escape out of range');
        bytes.push(byte);
      } else if (next === 'x') {
        const hex = this.match(/[0-9a-fA-F]{2}/y);
        if (!hex) this.fail('bad hex escape');
        bytes.push(parseInt(hex[0], 16));
      } else {
        this.fail(`unknown escape "\\${next}"`);
      }
    }

    flush();
    return out;
  }

  private longBracket(): string | null {
    const open = this.match(LONG_OPEN);
    if (!open) return null;
    const close = `]${open[1]}]`;
    const end = this.src.indexOf(close, this.pos);
    if (end < 0) this.fail('unfinished long string');
    const body = this.src.slice(this.pos, end).replace(/^(?:\r\n|\n|\r)/, '');
    this.pos = end + close.length;
    return body;
  }

  /** Skips whitespace and comments. */
  private skip(): void {
    for (;;) {
      const char = this.src[this.pos];
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f' || char === '\v') {
        this.pos++;
      } else if (char === '-' && this.src[this.pos + 1] === '-') {
        this.pos += 2;
        if (this.longBracket() !== null) continue;
        while (this.pos < this.src.length && this.src[this.pos] !== '\n' && this.src[this.pos] !== '\r') this.pos++;
      } else {
        return;
      }
    }
  }

  private match(pattern: RegExp): RegExpExecArray | null {
    pattern.lastIndex = this.pos;
    const found = pattern.exec(this.src);
    if (found) this.pos = pattern.lastIndex;
    return found;
  }

  private expect(char: string): void {
    if (this.src[this.pos] !== char) this.fail(`expected "${char}"`);
    this.pos++;
  }

  private fail(message: string): never {
    const line = this.src.slice(0, this.pos).split(/\r\n|\r|\n/).length;
    throw new LuaParseError(message, line);
  }
}

export function parseLua(source: string): Map<string, LuaValue> {
  return new Parser(source).parseFile();
}

export function isTable(value: LuaValue | undefined): value is LuaTable {
  return typeof value === 'object' && value !== null;
}

/** The field for a key. As in Lua, the last one wins. */
export function getField(table: LuaTable, key: LuaField['key']): LuaField | undefined {
  for (let i = table.fields.length - 1; i >= 0; i--) {
    if (table.fields[i]!.key === key) return table.fields[i];
  }
  return undefined;
}
