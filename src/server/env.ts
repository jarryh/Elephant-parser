import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';

/**
 * Reads .env without copying it into `process.env`. It is read on every use, so
 * changes apply without a restart.
 */
export function readEnv(file: string): Record<string, string> {
  try {
    return parse(readFileSync(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}
