/**
 * The coaching profile wizard's rules: static/coaching.js (the "wizard" half) is the original. The calorie and macro maths stays on the
 * server (`POST /api/coaching/calculate`, the website's own coaching_engine); this decides which questions are asked, what answers are
 * allowed, and what a profile looks like once saved.
 */

export const ASPIRATIONS = ['lose', 'maintain', 'gain'] as const;
export const GENDERS = ['male', 'female'] as const;
export const ACTIVITY_LEVELS = ['lift_and_cardio', 'cardio_only', 'lift_only', 'none'] as const;
export const PROTEIN_LEVELS = ['low_moderate', 'moderate', 'high', 'highest'] as const;
export const DIETS = ['balanced', 'low_fat', 'low_carb', 'keto'] as const;
export const DISTRIBUTIONS = ['stable', 'weekly'] as const;

export type Aspiration = (typeof ASPIRATIONS)[number];
export type Gender = (typeof GENDERS)[number];
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];
export type ProteinPreference = (typeof PROTEIN_LEVELS)[number];
export type DietPreference = (typeof DIETS)[number];
export type Distribution = (typeof DISTRIBUTIONS)[number];

export const WIZARD_STEPS = ['aspiration', 'weight_gender', 'goal_weight', 'height', 'body_type', 'activity', 'protein', 'diet', 'distribution', 'result'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export const HEIGHT_MIN_CM = 130;
export const HEIGHT_MAX_CM = 230;
export const MIN_WEIGHT_KG = 35;
export const MAX_WEIGHT_KG = 400;

// Mirrors coaching_engine.py's LOSS_RATE_* / GAIN_RATE_* (tests/test_mobile_app.py compares them): a rate is a percentage of body weight
// per week, and "standard" is a kg-per-week band at a 75 kg reference body.
export const RATE_REFERENCE_WEIGHT_KG = 75;
export const LOSS_STANDARD_MIN_KG_PER_WEEK = 0.2;
export const LOSS_STANDARD_MAX_KG_PER_WEEK = 0.8;
export const LOSS_RATE_MIN_PCT = 0.1;
export const LOSS_RATE_MAX_PCT = 2.0;
export const LOSS_RATE_DEFAULT_PCT = (LOSS_STANDARD_MIN_KG_PER_WEEK / RATE_REFERENCE_WEIGHT_KG) * 100;
export const GAIN_RATE_MIN_PCT = 0.25;
export const GAIN_STANDARD_MAX_KG_PER_WEEK = 0.6;
export const GAIN_RATE_MAX_PCT = (GAIN_STANDARD_MAX_KG_PER_WEEK / RATE_REFERENCE_WEIGHT_KG) * 100;
export const GAIN_RATE_DEFAULT_PCT = 0.35;

/** What is kept of a finished wizard (and what an existing profile is read into). */
export interface CoachingData {
  aspiration: Aspiration;
  gender: Gender;
  weightKg: number;
  goalWeightKg: number | null;
  heightCm: number | null;
  bodyFatRangeId: string;
  activityLevel: ActivityLevel;
  proteinPreference: ProteinPreference;
  dietPreference: DietPreference;
  distribution: Distribution;
  lossRatePct: number | null;
  gainRatePct: number | null;
  /** The day the profile was first made ("2026-10-27"), kept across edits. */
  createdOn: string | null;
  lastAdjustmentOn: string | null;
}

/** The wizard's answers while it is being filled in. Numbers the person types stay text until they are used. */
export interface Wizard {
  step: WizardStep;
  aspiration: Aspiration | null;
  gender: Gender | null;
  weightKg: string;
  goalWeightKg: string;
  heightCm: number;
  bodyFatRangeId: string | null;
  activityLevel: ActivityLevel | null;
  proteinPreference: ProteinPreference | null;
  dietPreference: DietPreference;
  distribution: Distribution;
  lossRatePct: number;
  gainRatePct: number;
}

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value);
const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** A fresh wizard, or one opened on an existing profile (so editing starts from what is already there). */
export function newWizard(profile: CoachingData | null): Wizard {
  return {
    step: 'aspiration',
    aspiration: profile?.aspiration ?? null,
    gender: profile?.gender ?? null,
    weightKg: profile ? String(profile.weightKg) : '',
    goalWeightKg: profile?.goalWeightKg ? String(profile.goalWeightKg) : '',
    heightCm: profile?.heightCm ?? 170,
    bodyFatRangeId: profile?.bodyFatRangeId ?? null,
    activityLevel: profile?.activityLevel ?? null,
    proteinPreference: profile?.proteinPreference ?? null,
    dietPreference: profile?.dietPreference ?? 'balanced',
    distribution: profile?.distribution ?? 'stable',
    lossRatePct: profile?.lossRatePct || LOSS_RATE_DEFAULT_PCT,
    gainRatePct: profile?.gainRatePct || GAIN_RATE_DEFAULT_PCT,
  };
}

/**
 * One answer changed. Body-type ids belong to a gender (m1-m6, f1-f6): changing gender drops a body type that is not the new gender's, so
 * it cannot sit there chosen while being invalid.
 */
export function withAnswer<K extends keyof Wizard>(wizard: Wizard, field: K, value: Wizard[K], validRangeIds: readonly string[] = []): Wizard {
  const next = { ...wizard, [field]: value };
  if (field === 'gender' && next.bodyFatRangeId !== null && !validRangeIds.includes(next.bodyFatRangeId)) next.bodyFatRangeId = null;
  return next;
}

/** Whether the question can be answered at all: a goal weight is only asked when moving away from the current weight. */
export function shouldSkip(step: WizardStep, wizard: Pick<Wizard, 'aspiration'>): boolean {
  return step === 'goal_weight' && wizard.aspiration === 'maintain';
}

export function visibleSteps(wizard: Pick<Wizard, 'aspiration'>): WizardStep[] {
  return WIZARD_STEPS.filter((step) => !shouldSkip(step, wizard));
}

export function nextStep(step: WizardStep, wizard: Pick<Wizard, 'aspiration'>): WizardStep | null {
  const steps = visibleSteps(wizard);
  const at = steps.indexOf(step);
  return at >= 0 && at < steps.length - 1 ? steps[at + 1] : null;
}

export function prevStep(step: WizardStep, wizard: Pick<Wizard, 'aspiration'>): WizardStep | null {
  const steps = visibleSteps(wizard);
  const at = steps.indexOf(step);
  return at > 0 ? steps[at - 1] : null;
}

/** How far along, 0..1, for the progress bar. */
export function progress(step: WizardStep, wizard: Pick<Wizard, 'aspiration'>): number {
  const steps = visibleSteps(wizard);
  const at = steps.indexOf(step);
  return at < 0 ? 0 : (at + 1) / steps.length;
}

/** The bounds a goal weight may take: below the current weight to lose, above it to gain (whole kg), so a goal on the wrong side is unreachable. */
export function goalWeightBounds(aspiration: Aspiration | null, currentKg: string | number): { min: number; max: number; valid: boolean } {
  const current = typeof currentKg === 'number' ? currentKg : Number.parseFloat(currentKg) || 0;
  if (aspiration === 'lose') {
    const max = Math.min(MAX_WEIGHT_KG, Math.ceil(current) - 1);
    return { min: MIN_WEIGHT_KG, max, valid: max >= MIN_WEIGHT_KG };
  }
  if (aspiration === 'gain') {
    const min = Math.max(MIN_WEIGHT_KG, Math.floor(current) + 1);
    return { min, max: MAX_WEIGHT_KG, valid: min <= MAX_WEIGHT_KG };
  }
  return { min: MIN_WEIGHT_KG, max: MAX_WEIGHT_KG, valid: true };
}

/** A goal carried in from before may sit outside what this direction allows: bring it inside (whole kg), or start at the nearest end. */
export function snapGoal(aspiration: Aspiration | null, currentKg: string, goalKg: string): string {
  const bounds = goalWeightBounds(aspiration, currentKg);
  if (!bounds.valid) return '';
  const seeded = Number.parseFloat(goalKg) || 0;
  const start = seeded > 0 ? Math.round(seeded) : aspiration === 'gain' ? bounds.min : bounds.max;
  return String(Math.max(bounds.min, Math.min(bounds.max, start)));
}

/** Whether the answers to this question are complete enough to go on. */
export function canProceed(wizard: Wizard): boolean {
  switch (wizard.step) {
    case 'aspiration':
      return wizard.aspiration !== null;
    case 'weight_gender': {
      const weight = Number.parseFloat(wizard.weightKg);
      return wizard.gender !== null && weight > 0 && weight <= MAX_WEIGHT_KG;
    }
    case 'goal_weight': {
      const goal = Number.parseFloat(wizard.goalWeightKg);
      return goal >= MIN_WEIGHT_KG && goal <= MAX_WEIGHT_KG;
    }
    case 'height':
      return wizard.heightCm >= HEIGHT_MIN_CM && wizard.heightCm <= HEIGHT_MAX_CM;
    case 'body_type':
      return wizard.bodyFatRangeId !== null;
    case 'activity':
      return wizard.activityLevel !== null;
    case 'protein':
      return wizard.proteinPreference !== null;
    case 'diet':
      return true;
    case 'distribution':
      return true;
    case 'result':
      return true;
  }
}

/** The weekday names a split plan trains on (every scheduled day that is not "Rest"), for spreading calories across the week. */
export function trainingDays(schedule: Readonly<Record<string, string>> | null | undefined): string[] {
  if (!schedule) return [];
  return Object.keys(schedule).filter((day) => schedule[day] && schedule[day] !== 'Rest');
}

/** The body `POST /api/coaching/calculate` takes. The rate sent is the one for the direction chosen, null for the other. */
export function calculateBody(wizard: Wizard, days: readonly string[]): Record<string, unknown> {
  return {
    aspiration: wizard.aspiration,
    gender: wizard.gender,
    weight_kg: Number.parseFloat(wizard.weightKg),
    height_cm: wizard.heightCm,
    body_fat_range_id: wizard.bodyFatRangeId,
    activity_level: wizard.activityLevel,
    protein_preference: wizard.proteinPreference,
    diet_preference: wizard.dietPreference,
    distribution: wizard.distribution,
    loss_rate_pct: wizard.aspiration === 'lose' ? wizard.lossRatePct : null,
    gain_rate_pct: wizard.aspiration === 'gain' ? wizard.gainRatePct : null,
    training_days: [...days],
  };
}

/**
 * The profile a finished wizard saves. "Maintain" has no distinct target, so its goal weight is the current weight; the creation day is
 * kept from an earlier profile; the adjustment day starts today.
 */
export function profileFromWizard(wizard: Wizard, today: string, existing: CoachingData | null): CoachingData {
  const weight = Number.parseFloat(wizard.weightKg);
  return {
    aspiration: wizard.aspiration as Aspiration,
    gender: wizard.gender as Gender,
    weightKg: weight,
    goalWeightKg: wizard.aspiration === 'maintain' ? weight : Number.parseFloat(wizard.goalWeightKg),
    heightCm: wizard.heightCm,
    bodyFatRangeId: wizard.bodyFatRangeId as string,
    activityLevel: wizard.activityLevel as ActivityLevel,
    proteinPreference: wizard.proteinPreference as ProteinPreference,
    dietPreference: wizard.dietPreference,
    distribution: wizard.distribution,
    lossRatePct: wizard.aspiration === 'lose' ? wizard.lossRatePct : null,
    gainRatePct: wizard.aspiration === 'gain' ? wizard.gainRatePct : null,
    createdOn: existing?.createdOn ?? today,
    lastAdjustmentOn: today,
  };
}

// -- the rate of change --------------------------------------------------------------------------------------------------------

export function rateBounds(aspiration: 'lose' | 'gain'): { min: number; max: number } {
  return aspiration === 'lose' ? { min: LOSS_RATE_MIN_PCT, max: LOSS_RATE_MAX_PCT } : { min: GAIN_RATE_MIN_PCT, max: GAIN_RATE_MAX_PCT };
}

export const clampRate = (aspiration: 'lose' | 'gain', value: number): number => {
  const { min, max } = rateBounds(aspiration);
  return Math.max(min, Math.min(max, value));
};

/** The "standard" band of a weekly loss at this body weight, as percentages of it; null for gain (which has none) or no weight yet. */
export function standardZone(aspiration: 'lose' | 'gain', weightKg: number): { min: number; max: number } | null {
  if (aspiration !== 'lose' || !(weightKg > 0)) return null;
  const { min, max } = rateBounds('lose');
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return { min: clamp((LOSS_STANDARD_MIN_KG_PER_WEEK / weightKg) * 100), max: clamp((LOSS_STANDARD_MAX_KG_PER_WEEK / weightKg) * 100) };
}

export type RateBadge = 'slower' | 'standard' | 'recommended' | 'faster';

/** Where a rate sits against the standard band. The lower edge is the recommended entry point, with a small tolerance (2% of the range). */
export function rateBadge(current: number, zone: { min: number; max: number } | null): RateBadge | null {
  if (!zone) return null;
  const { min, max } = rateBounds('lose');
  if (current < zone.min) return 'slower';
  if (current > zone.max) return 'faster';
  return Math.abs(current - zone.min) <= (max - min) * 0.02 ? 'recommended' : 'standard';
}

/** Kilograms moved in a week at this rate and body weight. */
export const kgPerWeek = (ratePct: number, weightKg: number): number => (ratePct / 100) * weightKg;

/**
 * When the goal weight would be reached at a steady rate: pure linear arithmetic, so it is worked out here rather than asked of the
 * server. Null when there is nothing to project (no weights, no rate, or already there).
 */
export function estimateGoalDate(weightKg: string | number, goalWeightKg: string | number, ratePct: number, from: Date): Date | null {
  const current = Number.parseFloat(String(weightKg)) || 0;
  const goal = Number.parseFloat(String(goalWeightKg)) || 0;
  if (current <= 0 || goal <= 0 || !ratePct) return null;
  const weekly = current * (ratePct / 100);
  const weeks = weekly > 0 ? Math.abs(current - goal) / weekly : 0;
  if (!Number.isFinite(weeks) || weeks <= 0) return null;
  const eta = new Date(from);
  eta.setDate(eta.getDate() + Math.round(weeks * 7));
  return eta;
}

// -- reading what the server stored -----------------------------------------------------------------------------------------------

/** A stored profile as the wizard's data; null unless it has every field the calculation needs (an old or half-made one starts afresh). */
export function coachingDataFromRow(row: {
  aspiration: string | null;
  gender: string | null;
  weight_kg: number | null;
  goal_weight_kg: number | null;
  height_cm: number | null;
  body_fat_range_id: string | null;
  activity_level: string | null;
  protein_preference: string | null;
  diet_preference: string | null;
  distribution_mode: string | null;
  loss_rate_pct: number | null;
  gain_rate_pct: number | null;
  created_on: string | null;
  last_adjustment_on: string | null;
} | null): CoachingData | null {
  if (!row) return null;
  const weight = finite(row.weight_kg);
  if (weight === null || !isOneOf(ASPIRATIONS, row.aspiration) || !isOneOf(GENDERS, row.gender) || !isOneOf(ACTIVITY_LEVELS, row.activity_level) || !isOneOf(PROTEIN_LEVELS, row.protein_preference) || typeof row.body_fat_range_id !== 'string') return null;
  return {
    aspiration: row.aspiration,
    gender: row.gender,
    weightKg: weight,
    goalWeightKg: finite(row.goal_weight_kg),
    heightCm: finite(row.height_cm),
    bodyFatRangeId: row.body_fat_range_id,
    activityLevel: row.activity_level,
    proteinPreference: row.protein_preference,
    dietPreference: isOneOf(DIETS, row.diet_preference) ? row.diet_preference : 'balanced',
    distribution: isOneOf(DISTRIBUTIONS, row.distribution_mode) ? row.distribution_mode : 'stable',
    lossRatePct: finite(row.loss_rate_pct),
    gainRatePct: finite(row.gain_rate_pct),
    createdOn: row.created_on,
    lastAdjustmentOn: row.last_adjustment_on,
  };
}
