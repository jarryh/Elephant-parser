import { NotLogFileError } from './document';
import { parseElephant } from './elephant';
import { isTable, parseLua } from './lua';
import { parseStoryLog } from './storylog';
import type { LogDocument } from './types';

/** StoryLog's own file, and the archive files that it moves older sessions to. */
const STORYLOG = /^StoryLog(?:Archive\d+)?DB$/;

/** Reads either format, told apart by the variable in the file. */
export function parseLog(source: string): LogDocument {
  const globals = parseLua(source);
  if (isTable(globals.get('ElephantDB'))) return parseElephant(source, globals);
  for (const [name, value] of globals) {
    if (STORYLOG.test(name) && isTable(value)) return parseStoryLog(source, globals, name);
  }
  throw new NotLogFileError();
}
