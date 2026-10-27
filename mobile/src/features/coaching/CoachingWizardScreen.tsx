import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ApiError, getApi } from '@/api';
import type { Calculation } from '@/api/coaching';
import { markOnboardingDone } from '@/auth/onboarding';
import { useAuth } from '@/auth/AuthProvider';
import { useActions, useCoachingProfile, useSettings, useSplitPlan } from '@/data/hooks';
import { useTranslation } from '@/i18n';
import bodyFat from '@/data/bodyfat.json';
import {
  calculateBody,
  canProceed,
  newWizard,
  nextStep,
  prevStep,
  profileFromWizard,
  progress,
  snapGoal,
  trainingDays,
  withAnswer,
  type CoachingData,
  type Wizard,
} from '@/logic/coachingProfile';
import { toIsoDate } from '@/logic/dates';
import { getSupabase } from '@/supabase/client';
import { Button, Card, ErrorText, Screen, Text } from '@/ui/components';
import { success } from '@/ui/haptics';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';

import { ActivityStep, AspirationStep, BodyTypeStep, DietStep, DistributionStep, GoalWeightStep, HeightStep, ProteinStep, WeightGenderStep } from './steps';

const RANGES = bodyFat as Record<'male' | 'female', { id: string; label: string }[]>;

function Result({ calculation, onBack, onSave, saving, error }: { calculation: Calculation; onBack: () => void; onSave: () => void; saving: boolean; error: string | null }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { targets } = calculation;
  return (
    <View style={{ gap: space.md }}>
      <Text variant="title" accessibilityRole="header">
        {t('coaching.wizard.yourTarget')}
      </Text>
      <Card style={{ alignItems: 'center', gap: space.xs }}>
        <Text testID="target-calories" style={{ fontSize: 56, lineHeight: 64, fontWeight: '800', color: colors.text }}>
          {targets.calories}
        </Text>
        <Text variant="label" secondary>
          {t('coaching.wizard.kcalPerDay')}
        </Text>
      </Card>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {(
          [
            ['protein', targets.protein],
            ['fat', targets.fat],
            ['carbs', targets.carbs],
          ] as const
        ).map(([key, grams]) => (
          <Card key={key} style={{ flex: 1, alignItems: 'center', gap: space.xs }}>
            <Text variant="rowTitle" testID={`target-${key}`}>
              {grams}g
            </Text>
            <Text variant="caption" secondary>
              {t(`common.${key}`)}
            </Text>
          </Card>
        ))}
      </View>
      <Text variant="caption" secondary testID="target-detail">
        {t('coaching.wizard.maintenance', { tdee: targets.tdee, bmr: targets.bmr })}
      </Text>
      <ErrorText>{error}</ErrorText>
      <Button title={t('coaching.wizard.saveStart')} loading={saving} onPress={onSave} />
      <Button tone="plain" title={t('common.back')} disabled={saving} onPress={onBack} />
    </View>
  );
}

function WizardFlow({ initial, existing }: { initial: Wizard; existing: CoachingData | null }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const { state, refreshProfile } = useAuth();
  const actions = useActions();
  const units = useSettings().data.units;
  const plan = useSplitPlan().data;
  const [wizard, setWizard] = useState<Wizard>(initial);
  const [calculation, setCalculation] = useState<Calculation | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const sequence = useRef(0);
  const now = new Date();

  const set = <K extends keyof Wizard>(field: K, value: Wizard[K]) =>
    setWizard((w) => withAnswer(w, field, value, field === 'gender' ? RANGES[value as 'male' | 'female'].map((r) => r.id) : []));

  /** Asks the server for the targets for these answers. A late answer to an earlier ask (or one for a step since left) is ignored. */
  const compute = (answers: Wizard) => {
    const mine = ++sequence.current;
    setCalculating(true);
    setError(null);
    setCalculation(null);
    getApi()
      .calculateTargets(calculateBody(answers, trainingDays(plan?.schedule)))
      .then((result) => mine === sequence.current && setCalculation(result))
      .catch((failure) => mine === sequence.current && setError(failure instanceof ApiError && failure.status !== 0 && failure.status < 500 ? failure.message : t('coaching.wizard.error')))
      .finally(() => mine === sequence.current && setCalculating(false));
  };

  const go = (step: Wizard['step'] | null) => {
    if (!step) return;
    sequence.current += 1; // leaving a step abandons any ask still in flight
    // Arriving at the goal weight, a goal carried in from before is brought inside what this direction allows.
    setWizard((w) => ({ ...w, step, goalWeightKg: step === 'goal_weight' ? snapGoal(w.aspiration, w.weightKg, w.goalWeightKg) : w.goalWeightKg }));
    if (step === 'result') compute(wizard);
  };

  const save = async () => {
    if (!calculation || state.status !== 'ready') return;
    setSaving(true);
    setError(null);
    try {
      const today = toIsoDate(new Date());
      await actions.saveCoachingProfile(profileFromWizard(wizard, today, existing), calculation.distribution);
      await actions.saveGoals({ protein: calculation.targets.protein, fat: calculation.targets.fat, carbs: calculation.targets.carbs });
      if (await markOnboardingDone(getSupabase(), state.session.user.id)) await refreshProfile();
      success();
      router.back();
    } catch {
      setError(t('coaching.wizard.error'));
      setSaving(false);
    }
  };

  const step = wizard.step;
  const first = prevStep(step, wizard) === null;
  return (
    <Screen>
      <OfflineBanner />
      <View accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress(step, wizard) * 100) }} style={{ height: 6, borderRadius: radius.pill, backgroundColor: colors.border, overflow: 'hidden' }}>
        <View style={{ width: `${progress(step, wizard) * 100}%`, height: '100%', backgroundColor: colors.green.fill }} />
      </View>

      {step === 'aspiration' ? <AspirationStep wizard={wizard} set={set} /> : null}
      {step === 'weight_gender' ? <WeightGenderStep wizard={wizard} set={set} units={units} /> : null}
      {step === 'goal_weight' ? <GoalWeightStep wizard={wizard} set={set} units={units} now={now} /> : null}
      {step === 'height' ? <HeightStep wizard={wizard} set={set} units={units} /> : null}
      {step === 'body_type' ? <BodyTypeStep wizard={wizard} set={set} ranges={RANGES[wizard.gender ?? 'male']} /> : null}
      {step === 'activity' ? <ActivityStep wizard={wizard} set={set} /> : null}
      {step === 'protein' ? <ProteinStep wizard={wizard} set={set} /> : null}
      {step === 'diet' ? <DietStep wizard={wizard} set={set} /> : null}
      {step === 'distribution' ? <DistributionStep wizard={wizard} set={set} /> : null}

      {step === 'result' ? (
        calculating ? (
          <View style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xxl }}>
            <ActivityIndicator />
            <Text variant="body" secondary>
              {t('coaching.wizard.calculating')}
            </Text>
          </View>
        ) : calculation ? (
          <Result calculation={calculation} saving={saving} error={error} onBack={() => go(prevStep(step, wizard))} onSave={() => void save()} />
        ) : (
          <View style={{ gap: space.md }}>
            <ErrorText>{error}</ErrorText>
            <Button tone="plain" title={t('common.back')} onPress={() => go(prevStep(step, wizard))} />
          </View>
        )
      ) : (
        <View style={{ gap: space.sm }}>
          <Button title={t('common.next')} disabled={!canProceed(wizard)} onPress={() => go(nextStep(step, wizard))} />
          {!first ? <Button tone="plain" title={t('common.back')} onPress={() => go(prevStep(step, wizard))} /> : null}
        </View>
      )}
    </Screen>
  );
}

/** The questions behind a calorie and macro target (`/coaching-wizard`): goal, weight and gender, goal weight and pace, height, body type, activity, protein, diet. */
export default function CoachingWizardScreen() {
  const profile = useCoachingProfile();
  if (profile.isLoading) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }
  // Opened on the saved profile when there is one, so editing starts from what is there.
  return <WizardFlow initial={newWizard(profile.data)} existing={profile.data} />;
}
