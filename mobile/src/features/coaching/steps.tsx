import Slider from '@react-native-community/slider';
import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, TextInput, View } from 'react-native';

import { useTranslation } from '@/i18n';
import {
  ACTIVITY_LEVELS,
  ASPIRATIONS,
  DIETS,
  DISTRIBUTIONS,
  GENDERS,
  HEIGHT_MAX_CM,
  HEIGHT_MIN_CM,
  PROTEIN_LEVELS,
  clampRate,
  estimateGoalDate,
  goalWeightBounds,
  kgPerWeek,
  rateBadge,
  rateBounds,
  standardZone,
  type Wizard,
} from '@/logic/coachingProfile';
import { CM_PER_IN, displayToKg, formatHeightCm, formatWeightKg, kgToDisplay, localeFor, weightUnitLabel, type UnitPrefs } from '@/logic/units';
import { Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Row } from '@/ui/widgets';

import { BODY_TYPE_IMAGES } from './bodyImages';

type Set = <K extends keyof Wizard>(field: K, value: Wizard[K]) => void;

/** A list of choices, one selected: the title of each, with a tick on the chosen one. */
export function ChoiceList<T extends string>({ options, value, onChange }: { options: readonly { id: T; title: string }[]; value: T | null; onChange: (id: T) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      {options.map((option) => (
        <Row key={option.id} onPress={() => onChange(option.id)} label={option.title} selected={value === option.id} style={value === option.id ? { borderColor: colors.green.fill, backgroundColor: colors.green.tint } : undefined}>
          <Text variant="rowTitle" style={{ flex: 1 }}>
            {option.title}
          </Text>
          {value === option.id ? (
            <Text variant="rowTitle" style={{ color: colors.ink.green }} accessibilityElementsHidden importantForAccessibility="no">
              ✓
            </Text>
          ) : null}
        </Row>
      ))}
    </View>
  );
}

function Heading({ children }: { children: string }) {
  return (
    <Text variant="title" accessibilityRole="header">
      {children}
    </Text>
  );
}

export function AspirationStep({ wizard, set }: { wizard: Wizard; set: Set }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: space.md }}>
      <Heading>{t('coaching.wizard.stepAspiration')}</Heading>
      <ChoiceList options={ASPIRATIONS.map((id) => ({ id, title: t(`coaching.aspiration.${id}.title`) }))} value={wizard.aspiration} onChange={(id) => set('aspiration', id)} />
    </View>
  );
}

/** A number the person types in their own unit, kept in kilograms underneath. */
function WeightInput({ label, kg, units, onChange }: { label: string; kg: string; units: UnitPrefs; onChange: (kg: string) => void }) {
  const { colors } = useTheme();
  const shown = (value: string) => (value && Number.parseFloat(value) > 0 ? String(kgToDisplay(Number.parseFloat(value), units)) : '');
  const [text, setText] = useState(shown(kg));
  // What this field last reported: a different answer arriving (not typed here) replaces the text, typing never does.
  const reported = useRef(kg);
  useEffect(() => {
    if (kg !== reported.current) {
      reported.current = kg;
      setText(shown(kg));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kg]);
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="label">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={text}
        onChangeText={(next) => {
          setText(next);
          const value = displayToKg(next, units);
          reported.current = Number.isFinite(value) ? String(value) : '';
          onChange(reported.current);
        }}
        keyboardType="decimal-pad"
        maxLength={7}
        style={{ minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, color: colors.text, paddingHorizontal: space.md, fontSize: 18 }}
      />
    </View>
  );
}

export function WeightGenderStep({ wizard, set, units }: { wizard: Wizard; set: Set; units: UnitPrefs }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: space.md }}>
      <Heading>{t('coaching.wizard.stepWeightGender')}</Heading>
      <WeightInput label={t('coaching.wizard.currentWeight', { unit: weightUnitLabel(units) })} kg={wizard.weightKg} units={units} onChange={(kg) => set('weightKg', kg)} />
      <ChoiceList options={GENDERS.map((id) => ({ id, title: t(`coaching.gender.${id}`) }))} value={wizard.gender} onChange={(id) => set('gender', id)} />
    </View>
  );
}

/** The goal weight and, when moving, how fast. Only asked when losing or gaining. */
export function GoalWeightStep({ wizard, set, units, now }: { wizard: Wizard; set: Set; units: UnitPrefs; now: Date }) {
  const { t, language } = useTranslation();
  const bounds = goalWeightBounds(wizard.aspiration, wizard.weightKg);
  const current = Number.parseFloat(wizard.weightKg) || 0;
  const goal = Number.parseFloat(wizard.goalWeightKg);
  const moving = wizard.aspiration === 'lose' || wizard.aspiration === 'gain' ? wizard.aspiration : null;
  const eta = moving ? estimateGoalDate(wizard.weightKg, wizard.goalWeightKg, moving === 'lose' ? wizard.lossRatePct : wizard.gainRatePct, now) : null;

  return (
    <View style={{ gap: space.md }}>
      <Heading>{t('coaching.wizard.stepGoalWeight')}</Heading>
      {bounds.valid ? (
        <>
          <WeightInput label={t('coaching.wizard.goalWeight', { unit: weightUnitLabel(units) })} kg={wizard.goalWeightKg} units={units} onChange={(kg) => set('goalWeightKg', kg)} />
          <Text variant="caption" secondary testID="goal-bounds">
            {formatWeightKg(bounds.min, units)} – {formatWeightKg(bounds.max, units)}
          </Text>
          {Number.isFinite(goal) && goal > 0 ? (
            <Text variant="body" secondary testID="goal-hint">
              {t('coaching.wizard.goalWeightHint', { diff: formatWeightKg(Math.abs(current - goal), units), weight: formatWeightKg(current, units) })}
            </Text>
          ) : null}
        </>
      ) : (
        <Text variant="body" secondary testID="goal-no-room">
          {t('coaching.wizard.goalNoRoomHint')}
        </Text>
      )}
      {moving && bounds.valid ? <RateControl aspiration={moving} value={moving === 'lose' ? wizard.lossRatePct : wizard.gainRatePct} weightKg={current} units={units} onChange={(v) => set(moving === 'lose' ? 'lossRatePct' : 'gainRatePct', v)} /> : null}
      {eta ? (
        <View testID="goal-eta" accessible style={{ alignItems: 'center', gap: space.xs, padding: space.md, borderRadius: radius.md }}>
          <Text variant="title" style={{ fontSize: 20 }}>
            {eta.toLocaleDateString(localeFor(language), { month: 'short', day: 'numeric', year: 'numeric' })}
          </Text>
          <Text variant="caption" secondary>
            {t('coaching.wizard.rateEtaLabel')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** How fast: a slider over the engine's range, with where that sits against a standard pace and what a faster one costs. */
export function RateControl({ aspiration, value, weightKg, units, onChange }: { aspiration: 'lose' | 'gain'; value: number; weightKg: number; units: UnitPrefs; onChange: (value: number) => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { min, max } = rateBounds(aspiration);
  const current = clampRate(aspiration, value);
  const zone = standardZone(aspiration, weightKg);
  const badge = rateBadge(current, zone);
  const label = aspiration === 'lose' ? t('coaching.wizard.lossRate') : t('coaching.wizard.gainRate');
  const standard = badge === 'standard' || badge === 'recommended';
  const badgeKey = badge === 'slower' ? 'coaching.wizard.rateSlower' : badge === 'faster' ? 'coaching.wizard.rateFaster' : badge === 'recommended' ? 'coaching.wizard.rateStandardRecommended' : 'coaching.wizard.rateStandard';

  return (
    <View style={{ gap: space.sm }}>
      <Text variant="label" testID="rate-header">
        {label} {current.toFixed(2)}
        {t('coaching.wizard.perWeek')}
      </Text>
      {badge ? (
        <View style={{ alignSelf: 'center', paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.pill, backgroundColor: standard ? colors.green.tint : colors.border }}>
          <Text variant="label" testID="rate-badge" style={{ color: standard ? colors.ink.green : colors.textSecondary }}>
            {t(badgeKey)}
          </Text>
        </View>
      ) : null}
      <Slider
        testID="rate-slider"
        accessibilityLabel={label}
        minimumValue={min}
        maximumValue={max}
        value={current}
        step={(max - min) / 100}
        onValueChange={(next: number) => onChange(clampRate(aspiration, next))}
        minimumTrackTintColor={standard ? colors.green.fill : colors.blue.fill}
        maximumTrackTintColor={colors.border}
        thumbTintColor={standard ? colors.green.fill : colors.textSecondary}
        style={{ height: 40 }}
      />
      <Text variant="body" testID="rate-kg">
        {kgToDisplay(kgPerWeek(current, weightKg), units)} {weightUnitLabel(units)} {aspiration === 'lose' ? t('coaching.wizard.rateLost') : t('coaching.wizard.rateGained')} {t('coaching.wizard.perWeekLabel')}
      </Text>
      {/* Guideline 1.4: above the standard pace, say plainly what a faster cut costs and who should not do it unsupervised. */}
      {badge === 'faster' ? (
        <Text variant="caption" testID="rate-caution" style={{ color: colors.ink.amber }}>
          {t('coaching.wizard.rateCaution')}
        </Text>
      ) : null}
    </View>
  );
}

/** Height in the person's unit, kept in centimetres underneath. */
export function HeightStep({ wizard, set, units }: { wizard: Wizard; set: Set; units: UnitPrefs }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const inputStyle = { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, color: colors.text, paddingHorizontal: space.md, fontSize: 18, flex: 1 } as const;
  const totalInches = wizard.heightCm / CM_PER_IN;
  const [cm, setCm] = useState(String(Math.round(wizard.heightCm)));
  const [feet, setFeet] = useState(String(Math.floor(totalInches / 12)));
  const [inches, setInches] = useState(String(Math.round(totalInches - Math.floor(totalInches / 12) * 12)));
  const ranged = wizard.heightCm >= HEIGHT_MIN_CM && wizard.heightCm <= HEIGHT_MAX_CM;
  const update = (value: number) => set('heightCm', Number.isFinite(value) ? value : 0);

  return (
    <View style={{ gap: space.md }}>
      <Heading>{t('coaching.wizard.height')}</Heading>
      {units.height === 'cm' ? (
        <TextInput
          accessibilityLabel={t('coaching.wizard.height')}
          value={cm}
          onChangeText={(next) => {
            setCm(next);
            update(Number.parseFloat(next));
          }}
          keyboardType="number-pad"
          maxLength={3}
          style={inputStyle}
        />
      ) : (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <TextInput
            accessibilityLabel="ft"
            value={feet}
            onChangeText={(next) => {
              setFeet(next);
              update((Number.parseFloat(next) * 12 + (Number.parseFloat(inches) || 0)) * CM_PER_IN);
            }}
            keyboardType="number-pad"
            maxLength={1}
            style={inputStyle}
          />
          <TextInput
            accessibilityLabel="in"
            value={inches}
            onChangeText={(next) => {
              setInches(next);
              update(((Number.parseFloat(feet) || 0) * 12 + Number.parseFloat(next)) * CM_PER_IN);
            }}
            keyboardType="number-pad"
            maxLength={2}
            style={inputStyle}
          />
        </View>
      )}
      <Text variant="caption" secondary testID="height-hint">
        {ranged ? formatHeightCm(wizard.heightCm, units) : `${formatHeightCm(HEIGHT_MIN_CM, units)} – ${formatHeightCm(HEIGHT_MAX_CM, units)}`}
      </Text>
    </View>
  );
}

/** Pictures of six body types for the gender chosen, each with the body-fat range it stands for. */
export function BodyTypeStep({ wizard, set, ranges }: { wizard: Wizard; set: Set; ranges: readonly { id: string; label: string }[] }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.md }}>
      <Heading>{t('coaching.wizard.stepBodyType')}</Heading>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {ranges.map((range) => {
          const selected = wizard.bodyFatRangeId === range.id;
          return (
            <Pressable
              key={range.id}
              accessibilityRole="button"
              accessibilityLabel={range.label}
              accessibilityState={{ selected }}
              onPress={() => set('bodyFatRangeId', range.id)}
              style={{ width: '31%', alignItems: 'center', gap: space.xs, padding: space.sm, borderRadius: radius.md, borderWidth: 2, borderColor: selected ? colors.green.fill : 'transparent', backgroundColor: colors.card }}>
              <Image source={BODY_TYPE_IMAGES[range.id]} accessibilityIgnoresInvertColors style={{ width: '100%', aspectRatio: 1, borderRadius: radius.sm }} />
              <Text variant="label">{range.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ActivityStep({ wizard, set }: { wizard: Wizard; set: Set }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: space.md }}>
      <Heading>{t('coaching.wizard.stepActivity')}</Heading>
      <ChoiceList options={ACTIVITY_LEVELS.map((id) => ({ id, title: t(`coaching.activity.${id}.title`) }))} value={wizard.activityLevel} onChange={(id) => set('activityLevel', id)} />
    </View>
  );
}

export function ProteinStep({ wizard, set }: { wizard: Wizard; set: Set }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: space.md }}>
      <Heading>{t('coaching.wizard.stepProtein')}</Heading>
      <ChoiceList options={PROTEIN_LEVELS.map((id) => ({ id, title: t(`coaching.protein.${id}.title`) }))} value={wizard.proteinPreference} onChange={(id) => set('proteinPreference', id)} />
    </View>
  );
}

export function DietStep({ wizard, set }: { wizard: Wizard; set: Set }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: space.md }}>
      <Heading>{t('coaching.wizard.stepDiet')}</Heading>
      <ChoiceList options={DIETS.map((id) => ({ id, title: t(`coaching.diet.${id}.title`) }))} value={wizard.dietPreference} onChange={(id) => set('dietPreference', id)} />
    </View>
  );
}

export function DistributionStep({ wizard, set }: { wizard: Wizard; set: Set }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: space.md }}>
      <Heading>{t('coaching.wizard.stepDistribution')}</Heading>
      <ChoiceList options={DISTRIBUTIONS.map((id) => ({ id, title: t(`coaching.distribution.${id}.title`) }))} value={wizard.distribution} onChange={(id) => set('distribution', id)} />
    </View>
  );
}
