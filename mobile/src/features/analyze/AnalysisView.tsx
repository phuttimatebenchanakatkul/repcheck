import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { favoredNote, scoreTone, splitSections, tutorialLink, verdictKey, type Analysis, type FormSection, type SectionClass, type Tone } from '@/logic/analyzeResult';
import { Button, Card, Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';

import { ClipPlayer } from './ClipPlayer';
import { RichText } from './RichText';

/** Which accent each kind of feedback wears, so what kind of thing it says lands before the words do. */
const ACCENT: Record<SectionClass, 'blue' | 'green' | 'red' | 'amber' | 'pink' | 'purple'> = {
  summary: 'blue',
  positives: 'green',
  negatives: 'red',
  improvements: 'amber',
  injury: 'pink',
  progress: 'purple',
};

function SectionCard({ section }: { section: FormSection }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const accent = colors[ACCENT[section.css_class]];
  const title = t(section.title_key);
  return (
    <View testID={`section-${section.css_class}`} style={{ backgroundColor: accent.tint, borderRadius: radius.md, borderLeftWidth: 4, borderLeftColor: accent.fill, padding: space.lg, gap: space.sm }}>
      <Text variant="eyebrow" accessibilityRole="header">
        {title}
      </Text>
      <RichText html={section.summary_html} />
      {section.detail_html && open ? <RichText html={section.detail_html} /> : null}
      {section.detail_html ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? t('analyze.showLess') : t('app.analyze.sectionMore', { title })}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(!open)}
          style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text variant="label" style={{ color: colors.link }}>
            {open ? t('analyze.showLess') : t('analyze.readFullExplanation')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * One analysis: the clip, the score with its verdict, the two sections worth seeing straight away, and the rest behind "Full report".
 * The website's result screen (sectionsHtml in templates/index.html) rule for rule. `fresh` is for a result that has only just come
 * back (its clip link is still good); a stored one asks for a new link. `onAnother` adds the "Analyze another video" button.
 */
export function AnalysisView({ analysis, fresh = false, onAnother, onAsk }: { analysis: Analysis; fresh?: boolean; onAnother?: () => void; onAsk?: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [showAll, setShowAll] = useState(false);
  const tone: Tone | null = scoreTone(analysis.overall_score);
  const verdict = verdictKey(analysis.overall_score);
  const note = favoredNote(analysis.favored);
  const { primary, secondary } = splitSections(analysis.sections);
  const tutorial = tutorialLink(analysis.exercise_label);
  const scoreColor = tone === 'good' ? colors.ink.green : tone === 'ok' ? colors.ink.amber : tone === 'bad' ? colors.ink.red : colors.textSecondary;

  return (
    <View style={{ gap: space.md }}>
      <Text variant="title" accessibilityRole="header">
        {analysis.exercise_label}
      </Text>

      {analysis.video_url ? <ClipPlayer analysisId={analysis.id} freshUrl={fresh ? analysis.video_url : null} /> : null}

      <Card style={{ alignItems: 'center', gap: space.xs }}>
        <Text
          testID="overall-score"
          accessibilityLabel={analysis.overall_score === null ? t('app.analyze.noScore') : t('app.analyze.scoreLabel', { n: analysis.overall_score })}
          style={{ fontSize: 56, lineHeight: 64, fontWeight: '800', color: scoreColor }}>
          {analysis.overall_score ?? '—'}
        </Text>
        <Text variant="label" secondary>
          {t('analyze.overallFormTechnique')}
        </Text>
        {analysis.reps ? (
          <Text variant="label" testID="reps">
            {analysis.reps} {t('analyze.repsCounted')}
          </Text>
        ) : null}
        {verdict ? (
          <Text variant="rowTitle" testID="verdict" style={{ textAlign: 'center', color: scoreColor }}>
            {t(verdict)}
          </Text>
        ) : null}
        {note ? (
          <Text variant="body" secondary testID="favored-note" style={{ textAlign: 'center' }}>
            {note.key === 'analyze.balancedNote' ? t(note.key) : t(note.key, { favored: t(note.favored), other: t(note.other) })}
          </Text>
        ) : null}
      </Card>

      {onAsk ? <Button title={t('analyzeChat.headerTitle')} onPress={onAsk} /> : null}

      <Button tone="plain" title={tutorial.known ? t('analyze.howToTitle') : t('analyze.watchOnYoutube')} onPress={() => void Linking.openURL(tutorial.url)} />

      {primary.map((section, i) => (
        <SectionCard key={`${section.css_class}-${i}`} section={section} />
      ))}

      {secondary.length > 0 ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('analyze.fullReport')}
            accessibilityState={{ expanded: showAll }}
            onPress={() => setShowAll(!showAll)}
            style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
            <Text variant="rowTitle">{t('analyze.fullReport')}</Text>
            <Text variant="rowTitle" secondary accessibilityElementsHidden importantForAccessibility="no">
              {showAll ? '⌃' : '⌄'}
            </Text>
          </Pressable>
          {showAll ? secondary.map((section, i) => <SectionCard key={`${section.css_class}-${i}`} section={section} />) : null}
        </>
      ) : null}

      <Text variant="caption" secondary testID="estimate-note">
        {t('analyze.estimateNote')}
      </Text>

      {onAnother ? <Button title={t('analyze.analyzeAnother')} onPress={onAnother} /> : null}
    </View>
  );
}
