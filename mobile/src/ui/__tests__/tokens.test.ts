import { contrast } from '../contrast';
import { palette, type Scheme } from '../tokens';

const schemes: Scheme[] = ['light', 'dark'];
const AA = 4.5;

describe('contrast()', () => {
  it('is the WCAG ratio: 21:1 for black on white, 1:1 for a color on itself, order does not matter', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#336699', '#336699')).toBeCloseTo(1, 5);
    expect(contrast('#ffffff', '#777777')).toBeCloseTo(contrast('#777777', '#ffffff'), 10);
  });

  it('refuses anything that is not #rrggbb rather than computing nonsense', () => {
    expect(() => contrast('red', '#ffffff')).toThrow();
    expect(() => contrast('#fff', '#ffffff')).toThrow();
  });
});

describe.each(schemes)('%s palette', (scheme) => {
  const p = palette[scheme];
  const surfaces = { bg: p.bg, card: p.card };

  it.each(Object.entries(surfaces))('body and secondary text clear 4.5:1 on %s', (_name, surface) => {
    expect(contrast(p.text, surface)).toBeGreaterThanOrEqual(AA);
    expect(contrast(p.textSecondary, surface)).toBeGreaterThanOrEqual(AA);
  });

  it.each(Object.entries(surfaces))('the link color clears 4.5:1 on %s', (_name, surface) => {
    expect(contrast(p.link, surface)).toBeGreaterThanOrEqual(AA);
  });

  it.each(['green', 'amber', 'blue', 'red'] as const)('%s ink clears 4.5:1 on both surfaces and on its own tint', (accent) => {
    const ink = p.ink[accent];
    for (const surface of [p.bg, p.card, p[accent].tint]) expect(contrast(ink, surface)).toBeGreaterThanOrEqual(AA);
  });

  it('the primary button label (white) clears 4.5:1 on the button fill', () => {
    expect(contrast('#ffffff', p.buttonFill)).toBeGreaterThanOrEqual(AA);
  });

  it('every color is a plain #rrggbb value', () => {
    const hex = /^#[0-9a-f]{6}$/i;
    const values = [p.bg, p.card, p.text, p.textSecondary, p.border, p.link, p.buttonFill, ...Object.values(p.ink)];
    for (const accent of [p.green, p.red, p.amber, p.blue, p.purple, p.pink]) values.push(accent.fill, accent.tint);
    for (const v of values) expect(v).toMatch(hex);
  });
});

it('the two palettes define exactly the same tokens', () => {
  expect(Object.keys(palette.dark).sort()).toEqual(Object.keys(palette.light).sort());
  expect(Object.keys(palette.dark.ink).sort()).toEqual(Object.keys(palette.light.ink).sort());
});
