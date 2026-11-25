import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/** Writes through a temporary file, so a crash can't leave half a file. */
export async function atomicWrite(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, 'utf8');

  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temporary, file);
      return;
    } catch (error) {
      // On Windows, antivirus and indexers hold new files open for a moment.
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (attempt < 6 && ['EPERM', 'EBUSY', 'EACCES'].includes(code)) {
        await sleep(25 * 2 ** attempt);
        continue;
      }
      await rm(temporary, { force: true });
      throw error;
    }
  }
}
