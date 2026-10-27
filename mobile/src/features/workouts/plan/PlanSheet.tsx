import { useState } from 'react';
import { ActivityIndicator, TextInput, View } from 'react-native';

import { ApiError, getApi } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { useActions, useCustomExercises, useDataContext } from '@/data/hooks';
import { useTranslation } from '@/i18n';
import {
  LOCATIONS,
  MAX_DAYS,
  MONDAY_FIRST,
  SPLIT_TYPES,
  addCustomDay,
  applyDayCount,
  canProceedFromType,
  chooseMode,
  chooseType,
  dayFor,
  generateRequest,
  isSelfBuilt,
  newWizard,
  planFromGenerated,
  removeCustomDay,
  setDayExerciseList,
  setDayExercises,
  type SplitType,
  type Weekday,
  type Wizard,
} from '@/logic/splitPlan';
import type { SplitPlan } from '@/logic/types';
import { WEEKDAY_KEYS } from '@/logic/workouts';
import { AiConsent } from '@/ui/AiConsent';
import { Button, ErrorText, Field, Text } from '@/ui/components';
import { success } from '@/ui/haptics';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Row, Sheet } from '@/ui/widgets';

import { ExerciseChecklist } from './ExerciseChecklist';
import { PlanEditor } from './PlanEditor';

type Stage =
  | { kind: 'view' }
  | { kind: 'mode' }
  | { kind: 'type' }
  | { kind: 'location' }
  | { kind: 'goal' }
  | { kind: 'days' }
  | { kind: 'picker'; day: string; target: 'wizard' | 'plan'; back: 'view' | 'review' | 'type' }
  | { kind: 'working' }
  | { kind: 'consent' }
  | { kind: 'error'; message: string; back: Stage['kind'] }
  | { kind: 'review' };

const SPLIT_TITLES: Record<SplitType, 'workouts.split.ppl' | 'workouts.split.upperLower' | 'workouts.split.fullBody' | 'workouts.split.broSplit' | 'workouts.split.custom'> = {
  ppl: 'workouts.split.ppl',
  upper_lower: 'workouts.split.upperLower',
  full_body: 'workouts.split.fullBody',
  bro_split: 'workouts.split.broSplit',
  custom: 'workouts.split.custom',
};

function Choice({ title, sub, selected, onPress }: { title: string; sub?: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Row onPress={onPress} label={title} selected={selected} style={{ borderColor: selected ? colors.green.fill : colors.border, borderWidth: selected ? 2 : 1 }}>
      <View style={{ flex: 1 }}>
        <Text variant="rowTitle">{title}</Text>
        {sub ? (
          <Text variant="caption" secondary>
            {sub}
          </Text>
        ) : null}
      </View>
      <Text style={{ color: colors.ink.green }}>{selected ? '✓' : ''}</Text>
    </Row>
  );
}

function GoalInput({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <TextInput
      accessibilityLabel={t('workouts.wizard.goalTitle')}
      placeholder={t('workouts.wizard.goalPlaceholder')}
      placeholderTextColor={colors.textSecondary}
      multiline
      maxLength={300}
      value={value}
      onChangeText={onChange}
      style={{ minHeight: 110, textAlignVertical: 'top', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, color: colors.text, padding: space.md, fontSize: 16 }}
    />
  );
}

function DayCountRow({ value, onPick }: { value: number | null; onPick: (n: number) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      {Array.from({ length: MAX_DAYS }, (_, i) => i + 1).map((n) => (
        <Row key={n} onPress={() => onPick(n)} label={String(n)} selected={value === n} style={{ flex: 1, minHeight: 48, padding: 0, justifyContent: 'center', borderColor: value === n ? colors.green.fill : colors.border, borderWidth: value === n ? 2 : 1 }}>
          <Text variant="rowTitle" style={{ flex: 1, textAlign: 'center' }}>
            {n}
          </Text>
        </Row>
      ))}
    </View>
  );
}

/**
 * The planner. With no plan it walks the website's wizard: the AI path (where you train, your goal, how many days, then the server
 * builds it) or the self-built path (name the days, tick the exercises for each). A built plan is shown for review — change which
 * day falls on which weekday, add or remove exercises, set sets and reps — and saved. With a plan already saved it opens on that plan:
 * edits save as they are made, and "Edit split" starts the wizard over.
 */
function PlanBody({ saved, onSave, onClose }: { saved: SplitPlan | null; onSave: (plan: SplitPlan) => Promise<void>; onClose: () => void }) {
  const { t } = useTranslation();
  const { state, refreshProfile } = useAuth();
  const { data } = useDataContext();
  const actions = useActions();
  const customExercises = useCustomExercises();
  const consented = state.status === 'ready' && state.profile.ai_consent;

  const [stage, setStage] = useState<Stage>(saved ? { kind: 'view' } : { kind: 'mode' });
  const [wizard, setWizard] = useState<Wizard>(newWizard());
  const [draft, setDraft] = useState<SplitPlan | null>(null);
  const [view, setView] = useState<SplitPlan | null>(saved);
  const [customInput, setCustomInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  /** What the server said about the plan it built, kept while the person edits it. */
  const [meta, setMeta] = useState<{ rationale: string | null; aiChose: string | null }>({ rationale: null, aiChose: null });
  const localToday = WEEKDAY_KEYS[new Date().getDay()] as Weekday;

  const set = (next: Wizard) => setWizard(next);
  const go = (next: Stage) => {
    setError(null);
    setStage(next);
  };

  /** `allowed`: consent was just recorded, and the profile this closure holds has not caught up with it yet. */
  const generate = async (w: Wizard = wizard, allowed = false) => {
    if (!isSelfBuilt(w) && !consented && !allowed) return go({ kind: 'consent' });
    go({ kind: 'working' });
    try {
      const profile = w.type === 'ai_suggest' ? await data.fetch.coachingProfile() : {};
      const generated = await getApi().generateSplit(generateRequest(w, profile));
      setDraft(planFromGenerated(w, generated, generated.schedule, {}));
      const chose = w.type === 'ai_suggest' && generated.splitType && (SPLIT_TYPES as readonly string[]).includes(generated.splitType) ? t(SPLIT_TITLES[generated.splitType as SplitType]) : null;
      setMeta({ rationale: generated.rationale, aiChose: chose });
      go({ kind: 'review' });
    } catch (e) {
      if (e instanceof ApiError && e.needsAiConsent) go({ kind: 'consent' });
      else go({ kind: 'error', message: e instanceof ApiError ? e.message : t('workouts.wizard.errorBody'), back: isSelfBuilt(w) ? 'type' : 'days' });
    }
  };

  const allow = async () => {
    go({ kind: 'working' });
    try {
      await getApi().setAiConsent(true);
      await refreshProfile();
    } catch (e) {
      return go({ kind: 'error', message: e instanceof ApiError ? e.message : t('workouts.wizard.errorBody'), back: 'days' });
    }
    await generate(wizard, true);
  };

  const firstTraining = (plan: SplitPlan): Weekday => MONDAY_FIRST.find((key) => dayFor(plan, key)) ?? 'monday';

  const exercisesFor = (s: Extract<Stage, { kind: 'picker' }>): string[] => {
    if (s.target === 'wizard') return wizard.customDayExercises[s.day] ?? [];
    const plan = s.back === 'view' ? view : draft;
    return plan?.days.find((d) => d.label === s.day)?.exercises ?? [];
  };

  const persistView = (plan: SplitPlan) => {
    setView(plan);
    void onSave(plan);
  };

  switch (stage.kind) {
    case 'view':
      return view ? (
        <View style={{ gap: space.lg }}>
          <PlanEditor
            plan={view}
            initialWeekday={localToday}
            today={localToday}
            customExercises={customExercises.data}
            onChange={persistView}
            onPickExercises={(day) => go({ kind: 'picker', day, target: 'plan', back: 'view' })}
          />
          <Button
            title={t('workouts.plan.editSplit')}
            onPress={() => {
              set(newWizard());
              go({ kind: 'mode' });
            }}
          />
        </View>
      ) : null;

    case 'mode':
      return (
        <View style={{ gap: space.md }}>
          <Text variant="eyebrow" secondary>
            {t('workouts.wizard.stepMode')}
          </Text>
          <Choice title={t('workouts.wizard.mode.ai.title')} selected={wizard.mode === 'ai'} onPress={() => set(chooseMode(wizard, 'ai'))} />
          <Choice title={t('workouts.wizard.mode.self.title')} selected={wizard.mode === 'self'} onPress={() => set(chooseMode(wizard, 'self'))} />
          <Button title={t('common.next')} disabled={!wizard.mode} onPress={() => go(wizard.mode === 'ai' ? { kind: 'location' } : { kind: 'type' })} />
        </View>
      );

    case 'type': {
      const ready = canProceedFromType(wizard);
      return (
        <View style={{ gap: space.md }}>
          <Text variant="eyebrow" secondary>
            {t('workouts.wizard.stepChooseSplit')}
          </Text>
          {SPLIT_TYPES.map((type) => (
            <Choice key={type} title={t(SPLIT_TITLES[type])} selected={wizard.type === type} onPress={() => set(chooseType(wizard, type))} />
          ))}
          {isSelfBuilt(wizard) && (
            <>
              <Text variant="eyebrow" secondary>
                {t('workouts.wizard.chooseWeekTitle')}
              </Text>
              <DayCountRow value={wizard.customDays.length || null} onPick={(n) => set(applyDayCount(wizard, n, t('workouts.split.custom')))} />
              <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
                <View style={{ flex: 1 }}>
                  <Field label={t('workouts.wizard.customPlaceholder')} placeholder={t('workouts.wizard.customPlaceholder')} value={customInput} onChangeText={setCustomInput} maxLength={60} autoCapitalize="words" />
                </View>
                <Button
                  tone="plain"
                  title={t('workouts.wizard.add')}
                  onPress={() => {
                    set(addCustomDay(wizard, customInput));
                    setCustomInput('');
                  }}
                />
              </View>
              {wizard.customDays.map((day, index) => {
                const picked = (wizard.customDayExercises[day] ?? []).length;
                return (
                  <View key={day} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <Text variant="rowTitle" style={{ flex: 1 }} numberOfLines={1}>
                      {day}
                    </Text>
                    <Button tone="plain" title={picked ? t('workouts.wizard.exercisesPicked', { n: picked }) : t('workouts.wizard.pickExercises')} onPress={() => go({ kind: 'picker', day, target: 'wizard', back: 'type' })} />
                    <Button tone="plain" title={t('common.remove')} onPress={() => set(removeCustomDay(wizard, index))} />
                  </View>
                );
              })}
            </>
          )}
          <Button title={isSelfBuilt(wizard) ? t('workouts.wizard.generatePlan') : t('common.next')} disabled={!ready} onPress={() => (isSelfBuilt(wizard) ? void generate() : go({ kind: 'location' }))} />
        </View>
      );
    }

    case 'location':
      return (
        <View style={{ gap: space.md }}>
          <Text variant="eyebrow" secondary>
            {t('workouts.wizard.stepLocationAi')}
          </Text>
          {LOCATIONS.map((location) => (
            <Choice key={location} title={t(`workouts.wizard.location.${location}.title`)} sub={t(`workouts.wizard.location.${location}.sub`)} selected={wizard.location === location} onPress={() => set({ ...wizard, location })} />
          ))}
          <Button title={t('common.next')} disabled={!wizard.location} onPress={() => go({ kind: 'goal' })} />
        </View>
      );

    case 'goal':
      return (
        <View style={{ gap: space.md }}>
          <Text variant="eyebrow" secondary>
            {t('workouts.wizard.stepGoalAi')}
          </Text>
          <Text variant="rowTitle">{t('workouts.wizard.goalTitle')}</Text>
          <GoalInput value={wizard.goal} onChange={(goal) => set({ ...wizard, goal })} />
          <Text variant="caption" secondary>
            {t('workouts.wizard.goalHint')}
          </Text>
          <Button title={t('common.next')} onPress={() => go({ kind: 'days' })} />
        </View>
      );

    case 'days':
      return (
        <View style={{ gap: space.md }}>
          <Text variant="eyebrow" secondary>
            {t('workouts.wizard.stepDaysAi')}
          </Text>
          <Text variant="rowTitle">{t('workouts.wizard.chooseWeekTitle')}</Text>
          <DayCountRow value={wizard.daysPerWeek} onPick={(n) => set({ ...wizard, daysPerWeek: n })} />
          <Button title={t('workouts.wizard.generatePlan')} disabled={!wizard.daysPerWeek} onPress={() => void generate()} />
        </View>
      );

    case 'picker': {
      const s = stage;
      return (
        <ExerciseChecklist
          initial={exercisesFor(s)}
          customExercises={customExercises.data}
          onCreate={(name) => actions.createCustomExercise({ name })}
          onDelete={(exercise) => actions.deleteCustomExercise(exercise.id)}
          onDone={(selected) => {
            if (s.target === 'wizard') {
              set(setDayExercises(wizard, s.day, selected));
              go({ kind: 'type' });
            } else if (s.back === 'view' && view) {
              persistView(setDayExerciseList(view, s.day, selected));
              go({ kind: 'view' });
            } else if (draft) {
              setDraft(setDayExerciseList(draft, s.day, selected));
              go({ kind: 'review' });
            }
          }}
        />
      );
    }

    case 'working':
      return (
        <View style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xl }}>
          <ActivityIndicator />
          <Text variant="body" secondary>
            {isSelfBuilt(wizard) ? t('workouts.wizard.buildingBodyCustom') : t('workouts.wizard.buildingBody', { n: wizard.daysPerWeek ?? '' })}
          </Text>
        </View>
      );

    case 'consent':
      return <AiConsent onAllow={() => void allow()} onDecline={() => go({ kind: 'days' })} />;

    case 'error': {
      const back = stage.back;
      return (
        <View style={{ gap: space.md }}>
          <ErrorText>{stage.message}</ErrorText>
          <Button title={t('common.back')} onPress={() => go({ kind: back } as Stage)} />
        </View>
      );
    }

    case 'review': {
      if (!draft) return null;
      return (
        <View style={{ gap: space.lg }}>
          {meta.aiChose ? (
            <Text variant="body" style={{ fontWeight: '700' }}>
              {t('workouts.wizard.aiChose', { split: meta.aiChose })}
            </Text>
          ) : null}
          <Text variant="eyebrow" secondary>
            {t('workouts.wizard.chooseWorkoutDays')}
          </Text>
          <PlanEditor
            plan={draft}
            initialWeekday={firstTraining(draft)}
            customExercises={customExercises.data}
            onChange={setDraft}
            onPickExercises={(day) => go({ kind: 'picker', day, target: 'plan', back: 'review' })}
          />
          {meta.rationale ? (
            <View style={{ gap: space.xs, padding: space.md, borderRadius: radius.md }}>
              <Text variant="label">{t('workouts.wizard.whyThisSchedule')}</Text>
              <Text variant="body" secondary>
                {meta.rationale}
              </Text>
            </View>
          ) : null}
          <ErrorText>{error}</ErrorText>
          <Button
            title={t('workouts.wizard.savePlan')}
            onPress={() => {
              void onSave(draft).then(
                () => {
                  success();
                  onClose();
                },
                () => setError(t('nutrition.log.saveError')),
              );
            }}
          />
        </View>
      );
    }
  }
}

export function PlanSheet({ visible, saved, onSave, onClose }: { visible: boolean; saved: SplitPlan | null; onSave: (plan: SplitPlan) => Promise<void>; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Sheet visible={visible} title={t('workouts.wizard.title')} closeLabel={t('common.close')} onClose={onClose}>
      <PlanBody saved={saved} onSave={onSave} onClose={onClose} />
    </Sheet>
  );
}
