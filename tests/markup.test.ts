import { describe, expect, it } from 'vitest';
import { parseMarkup, stripMarkup } from '../src/shared/markup';

describe('markup', () => {
  it.each([
    ['plain', 'plain'],
    ['a || b', 'a | b'],
    ['|Hplayer:Ann|h[Ann]|h waves', '[Ann] waves'],
    ['|cnIQ3:|Hitem:1:::|h[Blade]|h|r!', '[Blade]!'],
    ['icon |TInterface\\Icons\\x:16|t|A:atlas:16:16|a here', 'icon  here'],
    ['first|nsecond', 'first\nsecond'],
    ['1 |4Copper:Coppers;', '1 Copper'],
    ['12 |4Copper:Coppers;', '12 Coppers'],
    ['from |Kq12|k', 'from [hidden]'],
    ['a lone | pipe', 'a lone | pipe'],
  ])('reads %j as %j', (raw, text) => {
    expect(stripMarkup(raw)).toBe(text);
  });

  it('keeps colours, including nested and named ones', () => {
    expect(parseMarkup('a |cffFF0000red |cnIQ2:green|r red|r b')).toEqual([
      { text: 'a ' },
      { text: 'red ', color: '#ff0000' },
      { text: 'green', color: '#1eff00' },
      { text: ' red', color: '#ff0000' },
      { text: ' b' },
    ]);
  });

  it('never passes an unknown colour name through as a colour', () => {
    expect(parseMarkup('|cnurl(evil):text|r')).toEqual([{ text: 'text' }]);
  });
});
