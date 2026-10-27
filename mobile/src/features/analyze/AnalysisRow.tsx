import { View } from 'react-native';

import { useTranslation } from '@/i18n';
import { scoreTone, type HistoryEntry } from '@/logic/analyzeResult';
import { localeFor } from '@/logic/units';
import { Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { Row } from '@/ui/widgets';

import { whenLabel } from './labels';

/** One past analysis: the exercise, when and how many reps, and its score in the colour of its bucket. */
export function AnalysisRow({ entry, now, onPress }: { entry: HistoryEntry; now: number; onPress: () => void }) {
  const { t, language } = useTranslation();
  const { colors } = useTheme();
  const when = whenLabel(entry.created_at, now, localeFor(language), t);
  const tone = scoreTone(entry.overall_score);
  const color = tone === 'good' ? colors.ink.green : tone === 'ok' ? colors.ink.amber : tone === 'bad' ? colors.ink.red : colors.textSecondary;
  const meta = entry.reps ? `${when} · ${entry.reps} ${t('workouts.exercise.repsLabel')}` : when;
  return (
    <Row onPress={onPress} label={t('app.analyze.openAnalysis', { exercise: entry.exercise_label, when, score: entry.overall_score ?? '—' })}>
      <View style={{ flex: 1 }}>
        <Text variant="rowTitle" numberOfLines={1}>
          {entry.exercise_label}
        </Text>
        <Text variant="caption" secondary numberOfLines={1}>
          {meta}
        </Text>
      </View>
      {entry.overall_score !== null ? (
        <Text variant="rowTitle" style={{ color }}>
          {entry.overall_score}
        </Text>
      ) : null}
    </Row>
  );
}
