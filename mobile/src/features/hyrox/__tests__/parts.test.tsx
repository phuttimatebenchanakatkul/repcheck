import { render, screen } from '@testing-library/react-native';

import { RaceBreakdown } from '../RaceBreakdown';
import { comboLabel } from '../labels';

const flat = (style: unknown): Record<string, unknown> => (Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : ((style as Record<string, unknown>) ?? {}));
const widthOf = (id: string) => flat(screen.getByTestId(id).props.style).width;

describe('the breakdown bars', () => {
  it('are scaled to the longest segment, never thinner than 4%, rounded to the nearest percent', async () => {
    await render(
      <RaceBreakdown
        race={{
          splits: [
            { key: 'run1', title: 'Run', atSeconds: 300 },
            { key: 'skierg', title: 'SkiErg', atSeconds: 500 }, // 200 s: 66.67%
            { key: 'run2', title: 'Run', atSeconds: 511 }, // 11 s: 3.67% -> the 4% floor
            { key: 'row', title: 'Rowing', atSeconds: 811 }, // 300 s: 100%
          ],
        }}
      />,
    );
    expect(widthOf('bar-0')).toBe('100%');
    expect(widthOf('bar-1')).toBe('67%');
    expect(widthOf('bar-2')).toBe('4%');
    expect(widthOf('bar-3')).toBe('100%');
  });

  it('a race with no time on any segment still draws, at the floor', async () => {
    await render(<RaceBreakdown race={{ splits: [{ key: 'run1', title: 'Run', atSeconds: 0 }] }} />);
    expect(widthOf('bar-0')).toBe('4%');
  });

  it('runs and stations are drawn in different colours', async () => {
    await render(
      <RaceBreakdown
        race={{
          splits: [
            { key: 'run1', title: 'Run', atSeconds: 100 },
            { key: 'skierg', title: 'SkiErg', atSeconds: 200 },
          ],
        }}
      />,
    );
    const run = flat(screen.getByTestId('bar-0').props.style).backgroundColor;
    const station = flat(screen.getByTestId('bar-1').props.style).backgroundColor;
    expect(run).toBeTruthy();
    expect(station).toBeTruthy();
    expect(run).not.toBe(station);
  });

  it('with no splits, just the totals', async () => {
    await render(<RaceBreakdown race={{ splits: [] }} />);
    expect(screen.getByTestId('total-running')).toHaveTextContent('0:00');
    expect(screen.queryByTestId('segment-0')).toBeNull();
  });
});

describe('the combo label', () => {
  const t = (key: string, vars?: Record<string, string | number>) => (vars ? `${key}:${Object.values(vars).join('|')}` : key);

  it('names gender, category and format', () => {
    expect(comboLabel(t as never, 'women', 'pro', 'doubles')).toBe('hyrox.finishLabel:hyrox.gender.women|hyrox.category.pro.title|hyrox.format.doubles.title');
  });

  it('a hand-built race says so', () => {
    expect(comboLabel(t as never, null, 'custom', null)).toBe('hyrox.category.custom.title');
  });

  it('something it does not know is shown as it is, or as mixed', () => {
    expect(comboLabel(t as never, 'x', 'elite', 'relay')).toBe('hyrox.finishLabel:Mixed|elite|relay');
    expect(comboLabel(t as never, null, 'open', null)).toBe('hyrox.finishLabel:Mixed|hyrox.category.open.title|Mixed Relay');
  });
});
