/** Turns WoW chat escape codes (`|c`, `|H`, `|T`, ...) into readable segments. */

export interface Segment {
  text: string;
  color?: string;
  /** What a link points to, as Wowhead writes it: `item=19019`. */
  link?: string;
}

const NAMED_COLORS = new Map<string, string>([
  ['IQ0', '#9d9d9d'],
  ['IQ1', '#ffffff'],
  ['IQ2', '#1eff00'],
  ['IQ3', '#0070dd'],
  ['IQ4', '#a335ee'],
  ['IQ5', '#ff8000'],
  ['IQ6', '#e6cc80'],
  ['IQ7', '#00ccff'],
  ['IQ8', '#00ccff'],
]);

const ESCAPE =
  /\|\||\|c([0-9a-fA-F]{8})|\|cn([^:|]+):|\|r|\|H.*?\|h|\|h|\|T.*?\|t|\|A.*?\|a|(\|K.*?\|k)|\|n|\|[Ww]|\|4([^:;|]*):([^;|]*);/g;

const LINK = /^\|H(item|quest|spell|enchant|achievement):(\d{1,9})(?=[:|])/;
// |Htrade:<player>:<spell>:<skill>
const TRADE_LINK = /^\|Htrade:[^:|]+:(\d{1,9})(?=[:|])/;

function linkTarget(code: string): string | undefined {
  const trade = TRADE_LINK.exec(code);
  if (trade) return `spell=${trade[1]}`;
  const found = LINK.exec(code);
  // Enchants are spells.
  return found ? `${found[1] === 'enchant' ? 'spell' : found[1]}=${found[2]}` : undefined;
}

export function parseMarkup(raw: string): Segment[] {
  if (!raw.includes('|')) return raw ? [{ text: raw }] : [];

  const segments: Segment[] = [];
  const colors: (string | undefined)[] = [];
  let plain = '';
  let link: string | undefined;
  const push = (text: string) => {
    if (!text) return;
    plain += text;
    const color = colors.at(-1);
    const last = segments.at(-1);
    if (last && last.color === color && last.link === link) {
      last.text += text;
      return;
    }
    const segment: Segment = { text };
    if (color) segment.color = color;
    if (link) segment.link = link;
    segments.push(segment);
  };

  let pos = 0;
  for (const found of raw.matchAll(ESCAPE)) {
    push(raw.slice(pos, found.index));
    pos = found.index + found[0].length;

    const [code, hex, name, secret, singular, plural] = found;
    if (code === '||') push('|');
    else if (code === '|n') push('\n');
    else if (code === '|r') colors.pop();
    else if (hex) colors.push(`#${hex.slice(2).toLowerCase()}`);
    else if (name) colors.push(NAMED_COLORS.get(name));
    else if (code === '|h') link = undefined;
    else if (code.startsWith('|H')) link = linkTarget(code);
    else if (secret) push('[hidden]');
    else if (singular !== undefined) {
      const count = /(\d+)\D*$/.exec(plain)?.[1];
      push((count === '1' ? singular : plural) ?? '');
    }
  }
  push(raw.slice(pos));
  return segments;
}

export function stripMarkup(raw: string): string {
  return parseMarkup(raw)
    .map((segment) => segment.text)
    .join('');
}
