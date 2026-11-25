import { NotLogFileError } from './document';
import { parseElephant } from './elephant';
import { isTable, parseLua } from './lua';
import { parseStoryLog } from './storylog';
import type { LogDocument } from './types';

/** Reads either format, told apart by the variable in the file. */
export function parseLog(source: string): LogDocument {
  const globals = parseLua(source);
  if (isTable(globals.get('ElephantDB'))) return parseElephant(source, globals);
  if (isTable(globals.get('StoryLogDB'))) return parseStoryLog(source, globals);
  throw new NotLogFileError();
}
