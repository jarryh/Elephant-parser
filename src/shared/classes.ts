/** The game's classes, by the token that chat events give. */
const CLASSES = new Map<string, [name: string, color: string]>([
  ['WARRIOR', ['Warrior', '#c69b6d']],
  ['PALADIN', ['Paladin', '#f48cba']],
  ['HUNTER', ['Hunter', '#aad372']],
  ['ROGUE', ['Rogue', '#fff468']],
  ['PRIEST', ['Priest', '#ffffff']],
  ['DEATHKNIGHT', ['Death Knight', '#c41e3a']],
  ['SHAMAN', ['Shaman', '#0070dd']],
  ['MAGE', ['Mage', '#3fc7eb']],
  ['WARLOCK', ['Warlock', '#8788ee']],
  ['MONK', ['Monk', '#00ff98']],
  ['DRUID', ['Druid', '#ff7c0a']],
  ['DEMONHUNTER', ['Demon Hunter', '#a330c9']],
  ['EVOKER', ['Evoker', '#33937f']],
]);

export function className(token: string | undefined): string | undefined {
  return token ? CLASSES.get(token)?.[0] : undefined;
}

export function classColor(token: string | undefined): string | undefined {
  return token ? CLASSES.get(token)?.[1] : undefined;
}
