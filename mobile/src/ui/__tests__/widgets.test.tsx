import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { addDays } from '@/logic/dates';

import { DateStrip } from '../DateStrip';
import { Bar, Chip, Ring, Row, Segmented, Sheet } from '../widgets';

describe('Bar', () => {
  const bar = (percent: number) => render(<Bar percent={percent} color="#000" label="Protein" />);

  it.each([
    [0, 0],
    [42.4, 42],
    [42.5, 43],
    [100, 100],
    [250, 100],
    [-30, 0],
  ])('%p% is announced as %p', async (percent, now) => {
    await bar(percent);
    expect(screen.getByRole('progressbar', { name: 'Protein' }).props.accessibilityValue).toEqual({ min: 0, max: 100, now });
  });
});

describe('Ring', () => {
  it.each([
    [0.5, 50],
    [1.7, 100],
    [-1, 0],
    [Number.NaN, 0],
  ])('a fill of %p is announced as %p%', async (fill, now) => {
    await render(<Ring fill={fill} color="#0a0" label="Calories" />);
    expect(screen.getByRole('progressbar', { name: 'Calories' }).props.accessibilityValue.now).toBe(now);
  });

  it('shows what is put in its middle', async () => {
    await render(
      <Ring fill={0.3} color="#0a0">
        <Text>1234</Text>
      </Ring>,
    );
    expect(screen.getByText('1234')).toBeOnTheScreen();
  });
});

describe('Segmented', () => {
  const options = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
  ] as const;

  it('marks the chosen option and reports a tap on another', async () => {
    const onChange = jest.fn();
    await render(<Segmented options={options} value="a" onChange={onChange} label="Pick" />);
    expect(screen.getByRole('radio', { name: 'Alpha' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('radio', { name: 'Beta' }).props.accessibilityState.selected).toBe(false);
    await fireEvent.press(screen.getByRole('radio', { name: 'Beta' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('Chip and Row', () => {
  it('a chip says whether it is selected and can be pressed', async () => {
    const onPress = jest.fn();
    await render(<Chip label="Half" selected onPress={onPress} />);
    expect(screen.getByRole('button', { name: 'Half' }).props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Half' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('a row with an action is a button; without one it is just a row', async () => {
    const onPress = jest.fn();
    await render(
      <>
        <Row onPress={onPress} label="Tap me">
          <Text>pressable</Text>
        </Row>
        <Row>
          <Text>plain</Text>
        </Row>
      </>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Tap me' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

describe('Sheet', () => {
  it('shows its content only while visible, and its close button closes it', async () => {
    const onClose = jest.fn();
    const view = await render(
      <Sheet visible={false} title="Title" closeLabel="Close" onClose={onClose}>
        <Text>inside</Text>
      </Sheet>,
    );
    expect(screen.queryByText('inside')).toBeNull();
    await view.rerender(
      <Sheet visible title="Title" closeLabel="Close" onClose={onClose}>
        <Text>inside</Text>
      </Sheet>,
    );
    expect(screen.getByText('inside')).toBeOnTheScreen();
    expect(screen.getByRole('header')).toHaveTextContent('Title');
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('DateStrip', () => {
  const noLabel = (date: string) => `${date}, logged`;

  it('shows the Monday-first week around the chosen day and reports the day tapped', async () => {
    const onSelect = jest.fn();
    await render(<DateStrip selected="2026-10-28" today="2026-10-28" loggedDays={new Set()} loggedLabel={noLabel} onSelect={onSelect} />);
    const days = screen.getAllByRole('button', { name: /^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,/ });
    expect(days).toHaveLength(7);
    expect(days[0].props.accessibilityLabel).toMatch(/^Monday, October 26/);
    expect(days[6].props.accessibilityLabel).toMatch(/^Sunday, November 1/);
    await fireEvent.press(days[1]);
    expect(onSelect).toHaveBeenCalledWith('2026-10-27');
  });

  it('marks the chosen day selected and the logged days with the screen reader label', async () => {
    await render(<DateStrip selected="2026-10-28" today="2026-10-28" loggedDays={new Set(['2026-10-27'])} loggedLabel={noLabel} onSelect={() => undefined} />);
    expect(screen.getByRole('button', { name: /^Wednesday, October 28/ }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('button', { name: /^Tuesday, October 27.*, logged$/ })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /^Monday, October 26$/ })).toBeOnTheScreen();
  });

  it('the arrows step a whole week either way', async () => {
    const onSelect = jest.fn();
    await render(<DateStrip selected="2026-10-28" today="2026-10-28" loggedDays={new Set()} loggedLabel={noLabel} onSelect={onSelect} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Previous week' }));
    expect(onSelect).toHaveBeenLastCalledWith(addDays('2026-10-28', -7));
    await fireEvent.press(screen.getByRole('button', { name: 'Next week' }));
    expect(onSelect).toHaveBeenLastCalledWith(addDays('2026-10-28', 7));
  });
});
