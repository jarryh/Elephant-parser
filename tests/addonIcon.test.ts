/**
 * The StoryLog icon at the minimap. Run against the simulated client in
 * tests/addon/mock.lua, which can't show how it looks in the game.
 */
import { describe, expect, it } from 'vitest';
import { Client } from './addon/client';

const settings = (client: Client) => client.get<Record<string, unknown>>('StoryLogDB.settings');
const said = (client: Client) => client.get<{ m?: string }[]>('NS.session.messages').map((message) => message.m);
const SAY = 'chat("SAY", { text = "hello", sender = "Borin Fixture", guid = "Player-1-B" })';
const click = (button: string) => `NS.icon:Click(${JSON.stringify(button)})`;

describe('the icon at the minimap', () => {
  it('sits on the edge of the minimap, at the lower left', () => {
    const icon = new Client().login().icon()!;
    expect(icon).toMatchObject({ shown: true, grey: false });
    // 75 pixels from the middle, at 210 degrees.
    expect(icon.x).toBeCloseTo(-65, 0);
    expect(icon.y).toBeCloseTo(-37.5, 1);
  });

  it('opens and closes the window with a click', () => {
    const client = new Client().login().run(click('LeftButton'));
    expect(client.get('StoryLogOptions:IsShown()')).toBe(true);
    client.run(click('LeftButton'));
    expect(client.get('StoryLogOptions:IsShown()')).toBe(false);
  });

  it('turns recording off and on with a right-click, and is grey while it is off', () => {
    const client = new Client().login().run(click('RightButton'));
    expect(settings(client).recording).toBe(false);
    expect(client.printed()).toContain('recording');
    expect(client.icon()!.grey).toBe(true);
    client.run(SAY);
    expect(said(client)).toEqual([]);

    client.run(click('RightButton'));
    expect(settings(client).recording).toBe(true);
    expect(client.icon()!.grey).toBe(false);
  });

  it('turns grey when recording is turned off another way', () => {
    const client = new Client().login().run('slash("off")');
    expect(client.icon()!.grey).toBe(true);
    client.run('slash("")').click('Recording');
    expect(client.icon()!.grey).toBe(false);
  });

  it('starts grey when recording was off at logout', () => {
    const saved = 'StoryLogDB = { version = 1, settings = { recording = false } }';
    expect(new Client({ saved }).login().icon()!.grey).toBe(true);
  });

  it('is moved by dragging, and stays where it was put', () => {
    const client = new Client().login().run('dragIcon(1000, 700)');
    expect(settings(client).iconAngle).toBe(90);
    expect(client.icon()!.x).toBeCloseTo(0, 1);
    expect(client.icon()!.y).toBeCloseTo(75, 1);

    const again = new Client({ saved: client.logout() }).login();
    expect(again.icon()!.y).toBeCloseTo(75, 1);
  });

  it('follows the minimap scale when it is dragged', () => {
    // At twice the scale, the minimap's middle is at (2000, 1200) on the screen.
    const client = new Client().login().run('Minimap._scale = 2; dragIcon(1800, 1200)');
    expect(settings(client).iconAngle).toBe(180);
  });

  it.each([
    ['"lots"', 210],
    ['450', 90],
    ['-90', 270],
  ])('takes a saved angle of %s as %i', (angle, expected) => {
    const saved = `StoryLogDB = { version = 1, settings = { iconAngle = ${angle} } }`;
    expect(settings(new Client({ saved }).login()).iconAngle).toBe(expected);
  });

  it('is hidden by /storylog icon off, and stays hidden', () => {
    const client = new Client().login().run('slash("icon off")');
    expect(client.icon()!.shown).toBe(false);
    expect(settings(client).icon).toBe(false);
    expect(client.printed()).toContain('icon at the minimap');

    const again = new Client({ saved: client.logout() }).login();
    expect(again.icon()!.shown).toBe(false);
    again.run('slash("icon on")');
    expect(again.icon()!.shown).toBe(true);
  });

  it('is shown and hidden from the window too', () => {
    const client = new Client().login().run('slash("")').click('Icon at the minimap');
    expect(client.icon()!.shown).toBe(false);
    client.run('slash("icon on")');
    expect(client.checkboxes().find((check) => check.label === 'Icon at the minimap')!.checked).toBe(true);
  });

  it('refuses /storylog icon without on or off', () => {
    const client = new Client().login().run('slash("icon maybe")');
    expect(client.printed()).toContain('use /storylog icon on / off');
    expect(settings(client).icon).toBe(true);
  });

  it('says what is recorded when the mouse is over it', () => {
    const client = new Client().login().run(SAY).run('NS.icon.scripts.OnEnter(NS.icon)');
    const lines = client.get<string[]>('GameTooltip.lines');
    expect(lines[0]).toBe('StoryLog');
    expect(lines.join('\n')).toContain('Recording');
    expect(lines.join('\n')).toContain('1 lines this session');
    expect(client.get('GameTooltip.shown')).toBe(true);
    client.run('NS.icon.scripts.OnLeave(NS.icon)');
    expect(client.get('GameTooltip.shown')).toBe(false);
  });

  it('is drawn at the sizes of each client', () => {
    expect(new Client({ build: 16001 }).login().get('NS.icon.image._width')).toBe(17);
    const retail = new Client({ build: 120105, regional: false }).login();
    expect(retail.get('NS.icon.image._width')).toBe(18);
    // A pixel above the middle, where the ring of the border is.
    expect(retail.get('{ NS.icon.image._points[1][1], NS.icon.image._points[1][4], NS.icon.image._points[1][5] }')).toEqual(['CENTER', 0, 1]);
  });

  it('adds no globals', () => {
    expect(new Client().login().get('addedGlobals()')).toEqual(['SLASH_STORYLOG1', 'StoryLogDB']);
  });

  it('makes do without the parts that only some clients have', () => {
    const client = new Client({ pre: 'NO_METHOD = { SetDesaturated = true, SetTexCoord = true, RegisterForDrag = true }' }).login();
    expect(client.icon()!.shown).toBe(true);
    client.run(click('RightButton'));
    expect(client.get('NS.icon.image._color')).toEqual([0.5, 0.5, 0.5]);
    expect(client.get('NS.iconProblem')).toBeNull();
  });

  it.each([
    ['without a minimap', 'NO_MINIMAP = true', 'this client has no minimap'],
    ['that lacks a part it needs', 'NO_METHOD = { RegisterForClicks = true }', 'RegisterForClicks'],
  ])('is left out on a client %s, and recording goes on', (_name, pre, problem) => {
    const client = new Client({ pre }).login();
    expect(client.icon()).toBeNull();
    expect(client.printed()).toBe('');
    expect(client.get<string>('NS.iconProblem')).toContain(problem);
    expect(client.get('NS.failures.count')).toBe(0);

    client.run(SAY);
    expect(said(client)).toEqual(['hello']);
    client.run('slash("status")');
    expect(client.printed()).toContain('The icon at the minimap had a problem on this client');
    client.run('W.printed = {}; slash("icon on")');
    expect(client.printed()).toContain("this client can't show it");
  });

  it('keeps a failed click to itself', () => {
    const client = new Client().login().run('NS.showOptions = function() error("no window today") end');
    expect(() => client.run(click('LeftButton'))).not.toThrow();
    expect(client.get<string>('NS.iconProblem')).toContain('no window today');
    expect(client.get('NS.failures.count')).toBe(0);
  });
});
