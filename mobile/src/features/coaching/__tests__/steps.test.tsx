import { fireEvent, render, screen } from '@testing-library/react-native';

import { newWizard, rateBounds, type Wizard } from '@/logic/coachingProfile';
import { DEFAULT_UNITS, type UnitPrefs } from '@/logic/units';
import { palette } from '@/ui/tokens';

import { ChoiceList, GoalWeightStep, HeightStep, RateControl, WeightGenderStep } from '../steps';

const LB: UnitPrefs = { ...DEFAULT_UNITS, weight: 'lb' };
const FTIN: UnitPrefs = { ...DEFAULT_UNITS, height: 'ftin' };
const wizard = (over: Partial<Wizard> = {}): Wizard => ({ ...newWizard(null), ...over });
const flat = (node: { props: { style?: unknown } }) => Object.assign({}, ...[node.props.style].flat(5).filter(Boolean)) as Record<string, unknown>;

describe('ChoiceList', () => {
  const options = [{ id: 'a', title: 'Alpha' }, { id: 'b', title: 'Beta' }] as const;

  it('marks the chosen one, and only that one, selected and ticked', async () => {
    await render(<ChoiceList options={options} value="b" onChange={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Beta' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('button', { name: 'Alpha' }).props.accessibilityState.selected).toBe(false);
    expect(screen.getAllByText('✓', { includeHiddenElements: true })).toHaveLength(1);
  });

  it('nothing chosen marks nothing', async () => {
    await render(<ChoiceList options={options} value={null} onChange={jest.fn()} />);
    expect(screen.queryAllByText('✓', { includeHiddenElements: true })).toHaveLength(0);
    for (const name of ['Alpha', 'Beta']) expect(screen.getByRole('button', { name }).props.accessibilityState.selected).toBe(false);
  });

  it('choosing reports the id', async () => {
    const onChange = jest.fn();
    await render(<ChoiceList options={options} value={null} onChange={onChange} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Alpha' }));
    expect(onChange).toHaveBeenCalledWith('a');
  });
});

describe('typing a weight', () => {
  it('starts empty for no weight, or a zero one', async () => {
    for (const weightKg of ['', '0', 'x']) {
      const view = await render(<WeightGenderStep wizard={wizard({ weightKg })} set={jest.fn()} units={DEFAULT_UNITS} />);
      expect(screen.getByLabelText('Current weight (kg)').props.value).toBe('');
      await view.unmount();
    }
  });

  it('shows a weight in the person’s unit and reports kilograms', async () => {
    const set = jest.fn();
    await render(<WeightGenderStep wizard={wizard({ weightKg: '80' })} set={set} units={LB} />);
    expect(screen.getByLabelText('Current weight (lb)').props.value).toBe('176.4');
    await fireEvent.changeText(screen.getByLabelText('Current weight (lb)'), '200');
    expect(set).toHaveBeenLastCalledWith('weightKg', expect.stringMatching(/^90\.7/));
    await fireEvent.changeText(screen.getByLabelText('Current weight (lb)'), 'abc');
    expect(set).toHaveBeenLastCalledWith('weightKg', '');
  });
});

describe('the goal weight', () => {
  const now = new Date(2026, 9, 27, 12);
  const step = (w: Wizard) => render(<GoalWeightStep wizard={w} set={jest.fn()} units={DEFAULT_UNITS} now={now} />);

  it('shows how far there is to go, not for an empty or zero goal', async () => {
    const view = await step(wizard({ aspiration: 'lose', weightKg: '80', goalWeightKg: '70' }));
    expect(screen.getByTestId('goal-hint')).toHaveTextContent('10 kg to go from 80 kg.');
    await view.unmount();
    for (const goalWeightKg of ['', '0']) {
      const again = await step(wizard({ aspiration: 'lose', weightKg: '80', goalWeightKg }));
      expect(screen.queryByTestId('goal-hint')).toBeNull();
      await again.unmount();
    }
  });

  it('with no room to move there is no pace to choose and no date', async () => {
    await step(wizard({ aspiration: 'lose', weightKg: '35', goalWeightKg: '' }));
    expect(screen.getByTestId('goal-no-room')).toBeOnTheScreen();
    expect(screen.queryByTestId('rate-slider')).toBeNull();
    expect(screen.queryByTestId('goal-eta')).toBeNull();
  });

  it('maintaining has no pace', async () => {
    await step(wizard({ aspiration: 'maintain', weightKg: '80', goalWeightKg: '80' }));
    expect(screen.queryByTestId('rate-slider')).toBeNull();
  });
});

describe('the pace control', () => {
  const control = (aspiration: 'lose' | 'gain', value: number, weightKg = 75, onChange = jest.fn()) => render(<RateControl aspiration={aspiration} value={value} weightKg={weightKg} units={DEFAULT_UNITS} onChange={onChange} />);

  it('the slider covers the engine’s range in a hundred steps', async () => {
    for (const aspiration of ['lose', 'gain'] as const) {
      const view = await control(aspiration, rateBounds(aspiration).min);
      const slider = screen.getByTestId('rate-slider');
      const { min, max } = rateBounds(aspiration);
      expect(slider.props.minimumValue).toBe(min);
      expect(slider.props.maximumValue).toBe(max);
      expect(slider.props.step).toBeCloseTo((max - min) / 100, 12);
      await view.unmount();
    }
  });

  it('the track is green on a standard pace and not otherwise', async () => {
    const standard = await control('lose', 0.5);
    const green = screen.getByTestId('rate-slider').props.minimumTrackTintColor;
    await standard.unmount();
    for (const value of [0.15, 1.9]) {
      const view = await control('lose', value);
      expect(screen.getByTestId('rate-slider').props.minimumTrackTintColor).not.toBe(green);
      await view.unmount();
    }
    const recommended = await control('lose', 0.2667);
    expect(screen.getByTestId('rate-slider').props.minimumTrackTintColor).toBe(green);
    await recommended.unmount();
  });

  it('a gain pace has no badge, no band and no warning', async () => {
    await control('gain', 0.8);
    expect(screen.queryByTestId('rate-badge')).toBeNull();
    expect(screen.queryByTestId('rate-caution')).toBeNull();
  });

  it('reports a pace kept inside the engine’s limits', async () => {
    const onChange = jest.fn();
    await control('lose', 0.5, 75, onChange);
    await fireEvent(screen.getByTestId('rate-slider'), 'valueChange', 7);
    expect(onChange).toHaveBeenLastCalledWith(2);
  });
});

describe('the height', () => {
  const set = jest.fn();
  beforeEach(() => set.mockClear());

  it('in centimetres starts at the nearest whole one', async () => {
    await render(<HeightStep wizard={wizard({ heightCm: 169.6 })} set={set} units={DEFAULT_UNITS} />);
    expect(screen.getByLabelText('Height —').props.value).toBe('170');
  });

  it.each([
    [170, '5', '7'],
    [177.8, '5', '10'],
    [182.88, '6', '0'],
    [160, '5', '3'],
  ])('%s cm is %s ft %s in', async (cm, feet, inches) => {
    await render(<HeightStep wizard={wizard({ heightCm: cm })} set={set} units={FTIN} />);
    expect(screen.getByLabelText('ft').props.value).toBe(feet);
    expect(screen.getByLabelText('in').props.value).toBe(inches);
  });

  it('typing feet and inches reports centimetres', async () => {
    await render(<HeightStep wizard={wizard({ heightCm: 170 })} set={set} units={FTIN} />);
    await fireEvent.changeText(screen.getByLabelText('ft'), '6');
    expect(set).toHaveBeenLastCalledWith('heightCm', expect.closeTo((6 * 12 + 7) * 2.54, 6));
    await fireEvent.changeText(screen.getByLabelText('in'), '2');
    expect(set).toHaveBeenLastCalledWith('heightCm', expect.closeTo((6 * 12 + 2) * 2.54, 6));
  });

  it('a blank part counts as nothing, and blank everything is zero', async () => {
    await render(<HeightStep wizard={wizard({ heightCm: 170 })} set={set} units={FTIN} />);
    await fireEvent.changeText(screen.getByLabelText('in'), '');
    expect(set).toHaveBeenLastCalledWith('heightCm', 0);
    await fireEvent.changeText(screen.getByLabelText('ft'), '');
    await fireEvent.changeText(screen.getByLabelText('in'), '3');
    expect(set).toHaveBeenLastCalledWith('heightCm', expect.closeTo(3 * 2.54, 6));
    await fireEvent.changeText(screen.getByLabelText('ft'), '4');
    await fireEvent.changeText(screen.getByLabelText('in'), '');
    expect(set).toHaveBeenLastCalledWith('heightCm', 0);
  });

  it('shows the height read back inside the range, and the range outside it, edges included', async () => {
    for (const [cm, shown] of [[130, '130 cm'], [230, '230 cm'], [129, '130 cm – 230 cm'], [231, '130 cm – 230 cm'], [170, '170 cm']] as const) {
      const view = await render(<HeightStep wizard={wizard({ heightCm: cm })} set={set} units={DEFAULT_UNITS} />);
      expect(screen.getByTestId('height-hint')).toHaveTextContent(shown);
      await view.unmount();
    }
  });

  it('a blank centimetre field is zero', async () => {
    await render(<HeightStep wizard={wizard({ heightCm: 170 })} set={set} units={DEFAULT_UNITS} />);
    await fireEvent.changeText(screen.getByLabelText('Height —'), '');
    expect(set).toHaveBeenLastCalledWith('heightCm', 0);
    expect(flat(screen.getByLabelText('Height —')).flex).toBe(1);
  });
});

describe('survivors: styling and tiny numbers', () => {
  it('the chosen row is outlined in green and the others are not', async () => {
    const options = [{ id: 'a', title: 'Alpha' }, { id: 'b', title: 'Beta' }] as const;
    await render(<ChoiceList options={options} value="a" onChange={jest.fn()} />);
    expect(flat(screen.getByRole('button', { name: 'Alpha' })).borderColor).toBe(palette.light.green.fill);
    expect(flat(screen.getByRole('button', { name: 'Alpha' })).backgroundColor).toBe(palette.light.green.tint);
    expect(flat(screen.getByRole('button', { name: 'Beta' })).borderColor).toBe(palette.light.border);
  });

  it('a weight under one unit is still shown', async () => {
    await render(<WeightGenderStep wizard={wizard({ weightKg: '0.5' })} set={jest.fn()} units={DEFAULT_UNITS} />);
    expect(screen.getByLabelText('Current weight (kg)').props.value).toBe('0.5');
  });

  it('a goal under one unit still gets its hint', async () => {
    await render(<GoalWeightStep wizard={wizard({ aspiration: 'lose', weightKg: '80', goalWeightKg: '0.5' })} set={jest.fn()} units={DEFAULT_UNITS} now={new Date(2026, 9, 27)} />);
    expect(screen.getByTestId('goal-hint')).toBeOnTheScreen();
  });

  it('feet with the inches field blank are feet alone', async () => {
    const set = jest.fn();
    await render(<HeightStep wizard={wizard({ heightCm: 170 })} set={set} units={FTIN} />);
    await fireEvent.changeText(screen.getByLabelText('in'), '');
    await fireEvent.changeText(screen.getByLabelText('ft'), '6');
    expect(set).toHaveBeenLastCalledWith('heightCm', expect.closeTo(6 * 12 * 2.54, 6));
  });
});
