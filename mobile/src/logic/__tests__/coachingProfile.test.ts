import fs from 'fs';
import path from 'path';

import {
  GAIN_RATE_DEFAULT_PCT,
  GAIN_RATE_MAX_PCT,
  GAIN_RATE_MIN_PCT,
  HEIGHT_MAX_CM,
  HEIGHT_MIN_CM,
  LOSS_RATE_DEFAULT_PCT,
  LOSS_RATE_MAX_PCT,
  LOSS_RATE_MIN_PCT,
  MAX_WEIGHT_KG,
  MIN_WEIGHT_KG,
  WIZARD_STEPS,
  calculateBody,
  canProceed,
  clampRate,
  coachingDataFromRow,
  estimateGoalDate,
  goalWeightBounds,
  kgPerWeek,
  newWizard,
  nextStep,
  prevStep,
  profileFromWizard,
  progress,
  rateBadge,
  rateBounds,
  shouldSkip,
  snapGoal,
  standardZone,
  trainingDays,
  visibleSteps,
  withAnswer,
  type CoachingData,
  type Wizard,
} from '../coachingProfile';

const wizard = (over: Partial<Wizard> = {}): Wizard => ({ ...newWizard(null), ...over });
const stored: CoachingData = {
  aspiration: 'lose', gender: 'female', weightKg: 70, goalWeightKg: 62, heightCm: 165, bodyFatRangeId: 'f3', activityLevel: 'lift_only',
  proteinPreference: 'high', dietPreference: 'low_carb', distribution: 'weekly', lossRatePct: 0.5, gainRatePct: null, createdOn: '2026-01-05', lastAdjustmentOn: '2026-10-20',
};

describe('against the website’s own wizard helpers', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../../../static/coaching.js'), 'utf8');
  const from = source.indexOf('const WIZARD_STEPS');
  const to = source.indexOf('// Custom continuous slider', from);
  const body = source.slice(from, to);
  // eslint-disable-next-line no-new-func
  const website = new Function(`${body}; return { goalWeightBounds, estimateGoalDate, WIZARD_STEPS, HEIGHT_MIN_CM, HEIGHT_MAX_CM, MIN_WEIGHT_KG, MAX_WEIGHT_KG, LOSS_RATE_MIN_PCT, LOSS_RATE_MAX_PCT, LOSS_RATE_DEFAULT_PCT, GAIN_RATE_MIN_PCT, GAIN_RATE_MAX_PCT, GAIN_RATE_DEFAULT_PCT };`)() as {
    goalWeightBounds: (a: string, c: string | number) => { min: number; max: number; valid: boolean };
    estimateGoalDate: (w: string | number, g: string | number, r: number) => Date | null;
    WIZARD_STEPS: string[];
  } & Record<string, number>;

  it('has the same steps, bounds and rate limits', () => {
    expect([...WIZARD_STEPS]).toEqual(website.WIZARD_STEPS);
    expect([HEIGHT_MIN_CM, HEIGHT_MAX_CM, MIN_WEIGHT_KG, MAX_WEIGHT_KG]).toEqual([website.HEIGHT_MIN_CM, website.HEIGHT_MAX_CM, website.MIN_WEIGHT_KG, website.MAX_WEIGHT_KG]);
    expect([LOSS_RATE_MIN_PCT, LOSS_RATE_MAX_PCT, GAIN_RATE_MIN_PCT, GAIN_RATE_DEFAULT_PCT]).toEqual([website.LOSS_RATE_MIN_PCT, website.LOSS_RATE_MAX_PCT, website.GAIN_RATE_MIN_PCT, website.GAIN_RATE_DEFAULT_PCT]);
    expect(LOSS_RATE_DEFAULT_PCT).toBeCloseTo(website.LOSS_RATE_DEFAULT_PCT, 12);
    expect(GAIN_RATE_MAX_PCT).toBeCloseTo(website.GAIN_RATE_MAX_PCT, 12);
  });

  it('draws goal-weight bounds the same way for 600 starting weights', () => {
    let seed = 1;
    const next = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const weights: (string | number)[] = ['', 'x', 0, 34, 35, 36, 400, 401, 1000];
    for (let i = 0; i < 600; i++) weights.push(next() < 0.5 ? Math.round(next() * 5000) / 10 : String(Math.round(next() * 5000) / 10));
    for (const weight of weights) {
      for (const aspiration of ['lose', 'gain', 'maintain'] as const) {
        expect(goalWeightBounds(aspiration, weight)).toEqual(website.goalWeightBounds(aspiration, weight));
      }
    }
  });

  it('projects the goal date the same way for 600 weights and rates', () => {
    const from = new Date(2026, 9, 27, 12);
    jest.useFakeTimers();
    jest.setSystemTime(from);
    try {
      let seed = 7;
      const next = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
      for (let i = 0; i < 600; i++) {
        const weight = Math.round((30 + next() * 150) * 10) / 10;
        const goal = Math.round((30 + next() * 150) * 10) / 10;
        const rate = next() < 0.05 ? 0 : Math.round(next() * 200) / 100;
        expect(estimateGoalDate(weight, goal, rate, from)?.getTime()).toBe(website.estimateGoalDate(weight, goal, rate)?.getTime());
        expect(estimateGoalDate(String(weight), String(goal), rate, from)?.getTime()).toBe(website.estimateGoalDate(String(weight), String(goal), rate)?.getTime());
      }
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('the steps', () => {
  it('maintain skips the goal weight, lose and gain ask it', () => {
    expect(shouldSkip('goal_weight', { aspiration: 'maintain' })).toBe(true);
    expect(shouldSkip('goal_weight', { aspiration: 'lose' })).toBe(false);
    expect(shouldSkip('goal_weight', { aspiration: null })).toBe(false);
    expect(shouldSkip('height', { aspiration: 'maintain' })).toBe(false);
    expect(visibleSteps({ aspiration: 'maintain' })).toHaveLength(WIZARD_STEPS.length - 1);
    expect(visibleSteps({ aspiration: 'gain' })).toEqual([...WIZARD_STEPS]);
  });

  it('walk forward and back past a skipped step, and stop at the ends', () => {
    expect(nextStep('weight_gender', { aspiration: 'maintain' })).toBe('height');
    expect(nextStep('weight_gender', { aspiration: 'lose' })).toBe('goal_weight');
    expect(prevStep('height', { aspiration: 'maintain' })).toBe('weight_gender');
    expect(prevStep('height', { aspiration: 'gain' })).toBe('goal_weight');
    expect(prevStep('aspiration', { aspiration: 'lose' })).toBeNull();
    expect(nextStep('result', { aspiration: 'lose' })).toBeNull();
    expect(nextStep('goal_weight', { aspiration: 'maintain' })).toBeNull();
  });

  it('the bar fills a step at a time', () => {
    expect(progress('aspiration', { aspiration: 'lose' })).toBeCloseTo(0.1, 9);
    expect(progress('result', { aspiration: 'lose' })).toBe(1);
    expect(progress('result', { aspiration: 'maintain' })).toBe(1);
    expect(progress('height', { aspiration: 'maintain' })).toBeCloseTo(3 / 9, 9);
    expect(progress('goal_weight', { aspiration: 'maintain' })).toBe(0);
  });
});

describe('what lets a step go on', () => {
  it.each([
    ['aspiration', {}, false],
    ['aspiration', { aspiration: 'lose' }, true],
    ['weight_gender', { gender: 'male', weightKg: '80' }, true],
    ['weight_gender', { gender: null, weightKg: '80' }, false],
    ['weight_gender', { gender: 'male', weightKg: '' }, false],
    ['weight_gender', { gender: 'male', weightKg: '0' }, false],
    ['weight_gender', { gender: 'male', weightKg: '400' }, true],
    ['weight_gender', { gender: 'male', weightKg: '400.1' }, false],
    ['goal_weight', { goalWeightKg: '35' }, true],
    ['goal_weight', { goalWeightKg: '34' }, false],
    ['goal_weight', { goalWeightKg: '400' }, true],
    ['goal_weight', { goalWeightKg: '401' }, false],
    ['goal_weight', { goalWeightKg: '' }, false],
    ['height', { heightCm: 130 }, true],
    ['height', { heightCm: 129 }, false],
    ['height', { heightCm: 230 }, true],
    ['height', { heightCm: 231 }, false],
    ['body_type', {}, false],
    ['body_type', { bodyFatRangeId: 'm3' }, true],
    ['activity', {}, false],
    ['activity', { activityLevel: 'none' }, true],
    ['protein', {}, false],
    ['protein', { proteinPreference: 'high' }, true],
    ['diet', {}, true],
    ['distribution', {}, true],
    ['result', {}, true],
  ] as const)('%s with %j: %s', (step, answers, ok) => {
    expect(canProceed(wizard({ step, ...answers } as Partial<Wizard>))).toBe(ok);
  });
});

describe('answers', () => {
  it('a new wizard starts blank with the website’s defaults', () => {
    expect(newWizard(null)).toEqual({
      step: 'aspiration', aspiration: null, gender: null, weightKg: '', goalWeightKg: '', heightCm: 170, bodyFatRangeId: null, activityLevel: null,
      proteinPreference: null, dietPreference: 'balanced', distribution: 'stable', lossRatePct: LOSS_RATE_DEFAULT_PCT, gainRatePct: GAIN_RATE_DEFAULT_PCT,
    });
  });

  it('opened on a profile it starts from what is there', () => {
    const w = newWizard(stored);
    expect(w).toMatchObject({ aspiration: 'lose', gender: 'female', weightKg: '70', goalWeightKg: '62', heightCm: 165, bodyFatRangeId: 'f3', activityLevel: 'lift_only', proteinPreference: 'high', dietPreference: 'low_carb', distribution: 'weekly', lossRatePct: 0.5, gainRatePct: GAIN_RATE_DEFAULT_PCT });
    expect(newWizard({ ...stored, goalWeightKg: null, heightCm: null, lossRatePct: null }).goalWeightKg).toBe('');
    expect(newWizard({ ...stored, heightCm: null }).heightCm).toBe(170);
  });

  it('changing gender drops a body type that is not the new gender’s, and keeps one that is', () => {
    const w = wizard({ gender: 'male', bodyFatRangeId: 'm3' });
    expect(withAnswer(w, 'gender', 'female', ['f1', 'f2']).bodyFatRangeId).toBeNull();
    expect(withAnswer(wizard({ bodyFatRangeId: 'f2' }), 'gender', 'female', ['f1', 'f2']).bodyFatRangeId).toBe('f2');
    expect(withAnswer(w, 'activityLevel', 'none').bodyFatRangeId).toBe('m3');
  });

  it('does not change the wizard it was given', () => {
    const w = wizard({ gender: 'male', bodyFatRangeId: 'm3' });
    withAnswer(w, 'gender', 'female', []);
    expect(w.gender).toBe('male');
  });
});

describe('the goal weight', () => {
  it('losing allows only weights below the current one, gaining only above', () => {
    expect(goalWeightBounds('lose', '80')).toEqual({ min: 35, max: 79, valid: true });
    expect(goalWeightBounds('lose', '80.2')).toEqual({ min: 35, max: 80, valid: true });
    expect(goalWeightBounds('gain', '80')).toEqual({ min: 81, max: 400, valid: true });
    expect(goalWeightBounds('gain', '80.7')).toEqual({ min: 81, max: 400, valid: true });
    expect(goalWeightBounds('maintain', '80')).toEqual({ min: 35, max: 400, valid: true });
  });

  it('can be out of room', () => {
    expect(goalWeightBounds('lose', '35').valid).toBe(false);
    expect(goalWeightBounds('gain', '400').valid).toBe(false);
    expect(goalWeightBounds('lose', '36').valid).toBe(true);
    expect(goalWeightBounds('gain', '399').valid).toBe(true);
  });

  it('a goal brought in from before is snapped inside, or starts at the near end', () => {
    expect(snapGoal('lose', '80', '90')).toBe('79');
    expect(snapGoal('lose', '80', '20')).toBe('35');
    expect(snapGoal('lose', '80', '70.4')).toBe('70');
    expect(snapGoal('lose', '80', '')).toBe('79');
    expect(snapGoal('gain', '80', '')).toBe('81');
    expect(snapGoal('gain', '80', '60')).toBe('81');
    expect(snapGoal('lose', '35', '30')).toBe('');
  });
});

describe('the rate of change', () => {
  it('has the engine’s limits and the website’s defaults', () => {
    expect(rateBounds('lose')).toEqual({ min: 0.1, max: 2 });
    expect(rateBounds('gain')).toEqual({ min: 0.25, max: 0.8 });
    expect(LOSS_RATE_DEFAULT_PCT).toBeCloseTo(0.2667, 4);
    expect(GAIN_RATE_DEFAULT_PCT).toBe(0.35);
  });

  it('is kept inside its limits', () => {
    expect(clampRate('lose', 5)).toBe(2);
    expect(clampRate('lose', 0)).toBe(0.1);
    expect(clampRate('gain', 5)).toBeCloseTo(0.8, 9);
    expect(clampRate('gain', 0.1)).toBe(0.25);
    expect(clampRate('lose', 0.5)).toBe(0.5);
  });

  it('the standard band is 0.2 to 0.8 kg a week at the person’s weight, only when losing', () => {
    expect(standardZone('lose', 75)?.min).toBeCloseTo(0.2667, 4);
    expect(standardZone('lose', 75)?.max).toBeCloseTo(1.0667, 4);
    expect(standardZone('lose', 100)?.min).toBeCloseTo(0.2, 9);
    expect(standardZone('lose', 100)?.max).toBeCloseTo(0.8, 9);
    expect(standardZone('gain', 75)).toBeNull();
    expect(standardZone('lose', 0)).toBeNull();
  });

  it('the band is kept inside the slider’s own limits', () => {
    const light = standardZone('lose', 35)!;
    expect(light.max).toBe(2);
    const heavy = standardZone('lose', 400)!;
    expect(heavy.min).toBe(0.1);
  });

  it('says slower, standard, recommended or faster', () => {
    const zone = { min: 0.2667, max: 1.0667 };
    expect(rateBadge(0.15, zone)).toBe('slower');
    expect(rateBadge(0.2667, zone)).toBe('recommended');
    expect(rateBadge(0.28, zone)).toBe('recommended');
    expect(rateBadge(0.5, zone)).toBe('standard');
    expect(rateBadge(1.0667, zone)).toBe('standard');
    expect(rateBadge(1.2, zone)).toBe('faster');
    expect(rateBadge(0.5, null)).toBeNull();
  });

  it('the recommended tolerance is two percent of the slider’s range', () => {
    const zone = { min: 0.5, max: 1.5 };
    expect(rateBadge(0.5 + 0.037, zone)).toBe('recommended');
    expect(rateBadge(0.5 + 0.039, zone)).toBe('standard');
  });

  it('kilograms a week', () => {
    expect(kgPerWeek(0.5, 80)).toBeCloseTo(0.4, 9);
    expect(kgPerWeek(1, 0)).toBe(0);
  });
});

describe('estimateGoalDate edges', () => {
  const from = new Date(2026, 9, 27, 12);
  it('nothing to project is null', () => {
    expect(estimateGoalDate(0, 70, 0.5, from)).toBeNull();
    expect(estimateGoalDate(80, 0, 0.5, from)).toBeNull();
    expect(estimateGoalDate(80, 70, 0, from)).toBeNull();
    expect(estimateGoalDate(80, 80, 0.5, from)).toBeNull();
    expect(estimateGoalDate('x', 70, 0.5, from)).toBeNull();
  });

  it('ten kilos at one percent of eighty is a bit over twelve weeks', () => {
    const eta = estimateGoalDate(80, 70, 1, from)!;
    expect(Math.round((eta.getTime() - from.getTime()) / 86_400_000)).toBe(88);
  });

  it('works the same up as down, and does not move the date it is given', () => {
    expect(estimateGoalDate(70, 80, 1, from)?.getTime()).toBe(estimateGoalDate(80, 70, 0.875, from)?.getTime());
    expect(from.getTime()).toBe(new Date(2026, 9, 27, 12).getTime());
  });
});

describe('the request, and the profile a finished wizard saves', () => {
  const done = wizard({ step: 'result', aspiration: 'lose', gender: 'female', weightKg: '70', goalWeightKg: '62', heightCm: 165, bodyFatRangeId: 'f3', activityLevel: 'lift_only', proteinPreference: 'high', dietPreference: 'low_carb', distribution: 'weekly', lossRatePct: 0.5, gainRatePct: 0.4 });

  it('sends the rate for the direction chosen and null for the other', () => {
    expect(calculateBody(done, ['monday', 'friday'])).toEqual({
      aspiration: 'lose', gender: 'female', weight_kg: 70, height_cm: 165, body_fat_range_id: 'f3', activity_level: 'lift_only', protein_preference: 'high',
      diet_preference: 'low_carb', distribution: 'weekly', loss_rate_pct: 0.5, gain_rate_pct: null, training_days: ['monday', 'friday'],
    });
    expect(calculateBody({ ...done, aspiration: 'gain' }, [])).toMatchObject({ loss_rate_pct: null, gain_rate_pct: 0.4 });
    expect(calculateBody({ ...done, aspiration: 'maintain' }, [])).toMatchObject({ loss_rate_pct: null, gain_rate_pct: null });
  });

  it('keeps the first day it was made and starts adjusting today', () => {
    expect(profileFromWizard(done, '2026-10-27', null)).toMatchObject({ createdOn: '2026-10-27', lastAdjustmentOn: '2026-10-27', goalWeightKg: 62, lossRatePct: 0.5, gainRatePct: null });
    expect(profileFromWizard(done, '2026-10-27', stored)).toMatchObject({ createdOn: '2026-01-05', lastAdjustmentOn: '2026-10-27' });
  });

  it('maintaining has no distinct target: the goal is the current weight and there is no rate', () => {
    expect(profileFromWizard({ ...done, aspiration: 'maintain', goalWeightKg: '' }, '2026-10-27', null)).toMatchObject({ goalWeightKg: 70, lossRatePct: null, gainRatePct: null });
  });

  it('gaining keeps the gain rate only', () => {
    expect(profileFromWizard({ ...done, aspiration: 'gain', goalWeightKg: '80' }, '2026-10-27', null)).toMatchObject({ lossRatePct: null, gainRatePct: 0.4, goalWeightKg: 80 });
  });

  it('a wizard opened on a profile and finished unchanged saves the same answers', () => {
    const w = { ...newWizard(stored), step: 'result' as const };
    expect(profileFromWizard(w, '2026-10-27', stored)).toEqual({ ...stored, lastAdjustmentOn: '2026-10-27' });
  });
});

describe('training days', () => {
  it('every scheduled day that is not rest', () => {
    expect(trainingDays({ monday: 'Push', tuesday: 'Rest', wednesday: 'Pull', thursday: '', friday: 'Legs' })).toEqual(['monday', 'wednesday', 'friday']);
    expect(trainingDays(null)).toEqual([]);
    expect(trainingDays({})).toEqual([]);
  });
});

describe('reading a stored profile', () => {
  const row = {
    aspiration: 'lose', gender: 'female', weight_kg: 70, goal_weight_kg: 62, height_cm: 165, body_fat_range_id: 'f3', activity_level: 'lift_only', protein_preference: 'high',
    diet_preference: 'low_carb', distribution_mode: 'weekly', loss_rate_pct: 0.5, gain_rate_pct: null, created_on: '2026-01-05', last_adjustment_on: '2026-10-20',
  };

  it('reads a whole one', () => {
    expect(coachingDataFromRow(row)).toEqual(stored);
  });

  it('nothing stored is nothing', () => {
    expect(coachingDataFromRow(null)).toBeNull();
  });

  it.each([
    ['no weight', { weight_kg: null }],
    ['an unknown goal', { aspiration: 'bulk' }],
    ['no goal', { aspiration: null }],
    ['an unknown gender', { gender: 'x' }],
    ['no activity', { activity_level: null }],
    ['an unknown protein level', { protein_preference: 'lots' }],
    ['no body type', { body_fat_range_id: null }],
  ])('a profile with %s starts afresh', (_name, over) => {
    expect(coachingDataFromRow({ ...row, ...over })).toBeNull();
  });

  it('an older profile without the diet or the spread is balanced and stable', () => {
    expect(coachingDataFromRow({ ...row, diet_preference: null, distribution_mode: null })).toMatchObject({ dietPreference: 'balanced', distribution: 'stable' });
    expect(coachingDataFromRow({ ...row, diet_preference: 'carnivore', distribution_mode: 'odd' })).toMatchObject({ dietPreference: 'balanced', distribution: 'stable' });
  });

  it('optional numbers that are missing stay null', () => {
    expect(coachingDataFromRow({ ...row, goal_weight_kg: null, height_cm: null, loss_rate_pct: null })).toMatchObject({ goalWeightKg: null, heightCm: null, lossRatePct: null });
  });
});

describe('survivors: edges', () => {
  it('a stored number that is not a number is none', () => {
    const row = {
      aspiration: 'lose', gender: 'female', weight_kg: 70, goal_weight_kg: 62, height_cm: 165, body_fat_range_id: 'f3', activity_level: 'lift_only', protein_preference: 'high',
      diet_preference: 'low_carb', distribution_mode: 'weekly', loss_rate_pct: 0.5, gain_rate_pct: null, created_on: null, last_adjustment_on: null,
    };
    expect(coachingDataFromRow({ ...row, weight_kg: NaN })).toBeNull();
    expect(coachingDataFromRow({ ...row, weight_kg: Infinity })).toBeNull();
    expect(coachingDataFromRow({ ...row, goal_weight_kg: NaN, height_cm: Infinity })).toMatchObject({ goalWeightKg: null, heightCm: null });
  });

  it('the first question has a next, and the second a previous', () => {
    expect(nextStep('aspiration', { aspiration: 'lose' })).toBe('weight_gender');
    expect(prevStep('weight_gender', { aspiration: 'lose' })).toBe('aspiration');
  });

  it('a goal is rounded to the nearest whole kilogram, and a goal under a kilogram still counts as given', () => {
    expect(snapGoal('lose', '80', '70.6')).toBe('71');
    expect(snapGoal('lose', '80', '70.4')).toBe('70');
    expect(snapGoal('lose', '80', '0.5')).toBe('35');
  });

  it('any weight above zero lets the question go on', () => {
    expect(canProceed(wizard({ step: 'weight_gender', gender: 'male', weightKg: '0.5' }))).toBe(true);
  });

  it('the standard band exists for any weight above zero', () => {
    expect(standardZone('lose', 0.5)).not.toBeNull();
  });

  it('a goal date can be projected for weights under one kilogram, and not for a rate below zero', () => {
    const from = new Date(2026, 9, 27, 12);
    expect(estimateGoalDate(0.5, 0.2, 1, from)).not.toBeNull();
    expect(estimateGoalDate(80, 0.5, 1, from)).not.toBeNull();
    expect(estimateGoalDate(80, 70, -1, from)).toBeNull();
  });
});
