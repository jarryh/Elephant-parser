import { describe, expect, it } from 'vitest';
import { holdsAll } from '../src/shared/covers';
import { parseLog } from '../src/shared/parse';
import { FIXTURE, STORYLOG } from './helpers';

const doc = parseLog(STORYLOG);
const list = '["sessions"] = {\n';
const from = STORYLOG.indexOf(list) + list.length;
const withoutFirst = parseLog(STORYLOG.slice(0, from) + STORYLOG.slice(STORYLOG.indexOf('{\n["id"] = "1898713700')));

describe('a StoryLog file that holds all of another', () => {
  it('is one with the same lines, whatever else changed', () => {
    expect(holdsAll(parseLog(STORYLOG.replace('["limit"] = 3,', '["limit"] = 5,')), doc)).toBe(true);
    expect(holdsAll(doc, doc)).toBe(true);
  });

  it('is one with more sessions', () => {
    expect(holdsAll(doc, withoutFirst)).toBe(true);
  });

  it('is not one that lost a session', () => {
    expect(holdsAll(withoutFirst, doc)).toBe(false);
  });

  it('is not one in which a line changed', () => {
    expect(holdsAll(parseLog(STORYLOG.replace('["m"] = "Again",', '["m"] = "Once more",')), doc)).toBe(false);
  });

  it('is never an Elephant file, nor one that holds one', () => {
    const elephant = parseLog(FIXTURE);
    expect(holdsAll(elephant, elephant)).toBe(false);
    expect(holdsAll(doc, elephant)).toBe(false);
  });
});
