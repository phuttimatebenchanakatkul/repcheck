import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';

import { ApiError, getApi } from '@/api';
import type { PhotoAngle } from '@/api/coaching';
import type { PickedImage } from '@/api/scan';
import { useActions, useDayStatuses, useGoals, useNutritionRange, useSettings, useWeights } from '@/data/hooks';
import { useTranslation, type TranslationKey } from '@/i18n';
import { checkinRequest, cycleDay, goalReached, macroRows, weekDates, type Adjustment, type Targets } from '@/logic/checkin';
import { addDays, parseIso, toIsoDate } from '@/logic/dates';
import { sumMacrosForDay } from '@/logic/macros';
import { dayStatus, type DayStatus } from '@/logic/nutritionHistory';
import { displayToKg, formatWeightKg, localeFor, weightUnitLabel } from '@/logic/units';
import { Button, Card, ErrorText, Field, Screen, Text } from '@/ui/components';
import { success } from '@/ui/haptics';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { choosePhoto, takePhoto, type PhotoResult } from '@/ui/photos';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';

import { useCheckinStatus } from './useCheckin';

const STATUS_LABEL: Record<DayStatus, TranslationKey> = {
  logged: 'coaching.status.logged.title',
  incomplete: 'coaching.status.incomplete.title',
  none: 'coaching.status.notLogged.title',
  fasting: 'coaching.status.fasting.title',
};

type Photos = Partial<Record<PhotoAngle, PickedImage>>;
type Outcome = { kind: 'goal'; weightKg: number } | { kind: 'week'; adjustment: Adjustment | null; previous: Targets };

function PhotoSlot({ angle, image, onPick, onRemove, failed }: { angle: PhotoAngle; image?: PickedImage; onPick: (result: PhotoResult) => void; onRemove: () => void; failed: boolean }) {
  const { t } = useTranslation();
  const label = t(angle === 'front' ? 'coaching.checkin.front' : 'coaching.checkin.back');
  return (
    <Card style={{ flex: 1, alignItems: 'center' }}>
      <Text variant="label">{label}</Text>
      {image ? <Image source={{ uri: image.uri }} accessibilityIgnoresInvertColors accessibilityLabel={label} style={{ width: '100%', aspectRatio: 3 / 4, borderRadius: radius.md }} /> : null}
      {image ? (
        <Button tone="plain" title={t('common.remove')} onPress={onRemove} />
      ) : (
        <>
          <Button tone="plain" title={t('app.scan.take')} onPress={() => void takePhoto().then(onPick).catch(() => onPick({ kind: 'denied' }))} />
          <Button tone="plain" title={t('app.scan.choose')} onPress={() => void choosePhoto().then(onPick)} />
        </>
      )}
      {failed ? <ErrorText>{t('coaching.checkin.photoCameraFailed')}</ErrorText> : null}
    </Card>
  );
}

function Result({ outcome, onDone, onGoals }: { outcome: Outcome; onDone: () => void; onGoals: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const units = useSettings().data.units;
  if (outcome.kind === 'goal') {
    return (
      <View style={{ gap: space.md }}>
        <Text variant="title" accessibilityRole="header">
          {t('coaching.checkin.goalAchievedTitle')}
        </Text>
        <Text variant="body" secondary>
          {t('coaching.checkin.goalAchievedSub', { weight: formatWeightKg(outcome.weightKg, units) })}
        </Text>
        <Button title={t('coaching.checkin.setNewGoals')} onPress={onGoals} />
        <Button tone="plain" title={t('common.done')} onPress={onDone} />
      </View>
    );
  }
  const { adjustment, previous } = outcome;
  return (
    <View style={{ gap: space.md }}>
      <Text variant="title" accessibilityRole="header">
        {t('coaching.checkin.doneTitle')}
      </Text>
      {adjustment ? (
        <>
          <Card style={{ alignItems: 'center' }}>
            <Text testID="new-target" variant="rowTitle">
              {t('coaching.checkin.newTarget', { n: Math.round(adjustment.calories) })}
            </Text>
            <Text variant="caption" secondary testID="delta">
              {adjustment.delta > 0 ? '+' : ''}
              {Math.round(adjustment.delta)} kcal
            </Text>
          </Card>
          {adjustment.reason ? (
            <Text variant="body" secondary testID="reason">
              {adjustment.reason}
            </Text>
          ) : null}
          <Text variant="label">{t('coaching.checkin.macrosTitle')}</Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {macroRows(adjustment, previous).map((row) => (
              <Card key={row.key} style={{ flex: 1, alignItems: 'center', gap: space.xs }}>
                <Text variant="caption" secondary>
                  {t(`common.${row.key}`)}
                </Text>
                <Text variant="rowTitle" testID={`macro-${row.key}`}>
                  {row.after}g
                </Text>
                <Text variant="caption" style={{ color: row.diff === 0 ? colors.textSecondary : colors.text }} testID={`macro-${row.key}-diff`}>
                  {row.diff === 0 ? t('coaching.checkin.sameChip') : `${row.diff > 0 ? '+' : ''}${row.diff}g`}
                </Text>
              </Card>
            ))}
          </View>
        </>
      ) : (
        <Card style={{ alignItems: 'center' }}>
          <Text variant="rowTitle" testID="on-track">
            {t('coaching.checkin.onTrack')}
          </Text>
          <Text variant="body" secondary style={{ textAlign: 'center' }}>
            {t('coaching.checkin.onTrackSub')}
          </Text>
        </Card>
      )}
      <Button title={t('common.done')} onPress={onDone} />
    </View>
  );
}

/**
 * The weekly check-in (`/checkin`): the week's days (tap to correct), today's weight, optional progress photos, then the server's call
 * on whether the calorie target should move. static/coaching.js (openCheckin / submitCheckin) is the original.
 */
export default function CheckinScreen() {
  const { t, language } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const actions = useActions();
  const today = toIsoDate(new Date());
  const days = weekDates(today);
  const status = useCheckinStatus(today);
  const units = useSettings().data.units;
  const goals = useGoals().data;
  const weights = useWeights(addDays(today, -365), today);
  const range = useNutritionRange(days[0], today);
  const overrides = useDayStatuses(days[0], today);
  const [weightText, setWeightText] = useState('');
  const [photos, setPhotos] = useState<Photos>({});
  const [cameraFailed, setCameraFailed] = useState<PhotoAngle | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  if (status.loading) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }
  const { profile } = status;
  if (!profile) {
    return (
      <Screen>
        <OfflineBanner />
        <Text variant="body" secondary>
          {t('coaching.setup.body')}
        </Text>
        <Button title={t('coaching.checkin.fixProfile')} onPress={() => router.replace('/coaching-wizard')} />
      </Screen>
    );
  }
  if (outcome) {
    return (
      <Screen>
        <Result outcome={outcome} onDone={() => router.back()} onGoals={() => router.replace('/coaching-wizard')} />
      </Screen>
    );
  }
  if (status.daysRemaining !== 0) {
    const n = status.daysRemaining ?? 0;
    return (
      <Screen>
        <Text variant="body" secondary testID="come-back">
          {t('coaching.checkin.comeBackIn', { n, s: n === 1 ? '' : 's' })}
        </Text>
        <Button tone="plain" title={t('common.done')} onPress={() => router.back()} />
      </Screen>
    );
  }

  const todaysWeight = weights.data.find((entry) => entry.day === today);
  const hasEntries = (day: string) => range.data.some((entry) => entry.day === day);
  const statusOf = (day: string) => dayStatus(hasEntries(day), overrides.data[day]);
  const locale = localeFor(language);

  const cycle = (day: string) => {
    const next = cycleDay(statusOf(day), hasEntries(day));
    void actions.setDayStatus(day, next.override);
  };

  const pick = (angle: PhotoAngle) => (result: PhotoResult) => {
    setCameraFailed(result.kind === 'denied' ? angle : null);
    if (result.kind === 'photo') setPhotos((current) => ({ ...current, [angle]: result.image }));
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      let entries = weights.data;
      if (!todaysWeight && weightText.trim()) {
        const kg = displayToKg(weightText, units);
        const entry = { day: today, kg, loggedAt: new Date().getTime() };
        if (!Number.isFinite(kg) || !(await actions.saveWeight(entry))) {
          setError(t('app.home.weightInvalid'));
          return; // the finally below puts the button back
        }
        entries = [...entries.filter((e) => e.day !== today), entry];
      }

      const newest = entries[entries.length - 1];
      if (newest && goalReached(profile, newest.kg)) {
        await actions.saveCheckin({ adjustment: null, goalReached: true });
        success();
        setOutcome({ kind: 'goal', weightKg: profile.goalWeightKg ?? newest.kg });
        return;
      }

      const api = getApi();
      const date = today;
      const [front, back] = await Promise.all([
        photos.front ? api.uploadCheckinPhoto(photos.front, 'front', date) : null,
        photos.back ? api.uploadCheckinPhoto(photos.back, 'back', date) : null,
      ]);
      const photoIds = [front, back].filter((id): id is number => id !== null);
      const calorieDays = days
        .filter((day) => statusOf(day) === 'logged')
        .map((day) => ({ day, calories: sumMacrosForDay(range.data.filter((entry) => entry.day === day)).calories })); // whole already: each entry rounds
      const weekWeights = entries.filter((entry) => entry.day >= days[0] && entry.day <= today);
      const previous = { protein: goals.protein, fat: goals.fat, carbs: goals.carbs };
      const adjustment = await api.weeklyAdjustment(checkinRequest(profile, previous, weekWeights, calorieDays, photoIds));
      await actions.saveCheckin({ adjustment, goalReached: false });
      success();
      setOutcome({ kind: 'week', adjustment, previous });
    } catch (failure) {
      setError(failure instanceof ApiError && failure.status !== 0 && failure.status < 500 ? failure.message : t('coaching.checkin.error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <OfflineBanner />
      <Text variant="body" secondary>
        {t('coaching.checkin.sub')}
      </Text>

      <Text variant="label">{t('coaching.checkin.daysLabel')}</Text>
      <Text variant="caption" secondary>
        {t('coaching.checkin.daysSub')}
      </Text>
      <View style={{ gap: space.xs }}>
        {days.map((day) => {
          const current = statusOf(day);
          const date = parseIso(day) as Date;
          const label = date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric' });
          return (
            <Pressable
              key={day}
              accessibilityRole="button"
              accessibilityLabel={`${label}, ${t(STATUS_LABEL[current])}`}
              onPress={() => cycle(day)}
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}
            >
              <Text variant="body">{label}</Text>
              <Text variant="label" secondary testID={`status-${day}`}>
                {t(STATUS_LABEL[current])}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {todaysWeight ? (
        <Text variant="body" secondary testID="weight-logged">
          {t('coaching.checkin.weightAlreadyLogged')}
        </Text>
      ) : (
        <Field label={t('app.home.weightLabel', { unit: weightUnitLabel(units) })} value={weightText} onChangeText={setWeightText} keyboardType="decimal-pad" />
      )}

      <Text variant="label">{t('coaching.checkin.photosLabel')}</Text>
      <Text variant="caption" secondary>
        {t('coaching.checkin.photosSub')}
      </Text>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {(['front', 'back'] as const).map((angle) => (
          <PhotoSlot
            key={angle}
            angle={angle}
            image={photos[angle]}
            failed={cameraFailed === angle}
            onPick={pick(angle)}
            onRemove={() => setPhotos((current) => ({ ...current, [angle]: undefined }))}
          />
        ))}
      </View>

      <ErrorText>{error}</ErrorText>
      <Button title={t('coaching.checkin.complete')} loading={submitting} onPress={() => void submit()} />
    </Screen>
  );
}
