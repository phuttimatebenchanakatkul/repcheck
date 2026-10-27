import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { ApiError, getApi } from '@/api';
import type { AnalysisAnswer } from '@/api/hyrox';
import { useAuth } from '@/auth/AuthProvider';
import { useTranslation, type TranslationKey } from '@/i18n';
import { STATIONS, analysisFromJson, canAnalyze, tipGroups, type Race, type Rating, type Tip } from '@/logic/hyrox';
import { AiConsent } from '@/ui/AiConsent';
import { Button, Card, ErrorText, Text } from '@/ui/components';
import { success } from '@/ui/haptics';
import { useTheme } from '@/ui/theme';
import { space } from '@/ui/tokens';

import { StationIcon } from './StationIcon';

const GROUP_LABEL: Record<Rating, TranslationKey> = {
  focus: 'hyrox.analysis.group.focus',
  strong: 'hyrox.analysis.group.strong',
  solid: 'hyrox.analysis.group.solid',
};

type Stage = 'idle' | 'loading' | 'consent' | 'error';

function Bullets({ lines }: { lines: readonly string[] }) {
  return (
    <View style={{ gap: space.xs }}>
      {lines.map((line) => (
        <Text key={line} variant="body">
          • {line}
        </Text>
      ))}
    </View>
  );
}

/** A station's name from its key (a tip names a station, never a run). */
const tipTitle = (key: string): string => STATIONS.find((s) => s.key === key)?.title ?? key;

function ReadMore({ open, onPress, id }: { open: boolean; onPress: () => void; id: string }) {
  const { t } = useTranslation();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${t(open ? 'hyrox.analysis.showLess' : 'hyrox.analysis.readMore')} (${id})`} onPress={onPress} style={{ minHeight: 36, justifyContent: 'center' }}>
      <Text variant="label">{t(open ? 'hyrox.analysis.showLess' : 'hyrox.analysis.readMore')}</Text>
    </Pressable>
  );
}

/** The overall read, short, with the fuller bullets the AI wrote for the purpose behind "Read more". */
function Overall({ overall, detail }: { overall: string; detail: readonly string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="body" testID="analysis-overall">
        {overall}
      </Text>
      {open && detail.length ? <Bullets lines={detail} /> : null}
      {detail.length ? <ReadMore open={open} onPress={() => setOpen((v) => !v)} id="overall" /> : null}
    </View>
  );
}

/** One rating's tips; "Read more" opens each tip's own bullets under it. */
function Group({ rating, tips }: { rating: Rating; tips: readonly Tip[] }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const tone: Record<Rating, string> = { focus: colors.amber.fill, strong: colors.green.fill, solid: colors.textSecondary };
  return (
    <View style={{ gap: space.sm }} testID={`group-${rating}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone[rating] }} />
        <Text variant="label">{t(GROUP_LABEL[rating])}</Text>
      </View>
      {tips.map((tip) => (
        <View key={tip.key} style={{ flexDirection: 'row', gap: space.sm }} testID={`tip-${tip.key}`}>
          <StationIcon name={tip.key} size={20} />
          <View style={{ flex: 1, gap: space.xs }}>
            <Text variant="rowTitle">{tipTitle(tip.key)}</Text>
            <Text variant="body">{tip.tip}</Text>
            {open && tip.detail.length ? <Bullets lines={tip.detail} /> : null}
          </View>
        </View>
      ))}
      {tips.some((tip) => tip.detail.length) ? <ReadMore open={open} onPress={() => setOpen((v) => !v)} id={rating} /> : null}
    </View>
  );
}

/**
 * The AI's coaching on a race: where to gain time, strengths and what is already solid, station by station. It is kept on the race once it
 * has been read, so reopening a race shows it with no wait. A race just finished is read at once (when the AI switch is on); an older one is
 * read on request. The consent question comes first when it has not been answered. `onAnalysed` is given the race with its analysis to keep.
 */
export function RaceAnalysisPanel({ race, autoRun, onAnalysed }: { race: Race; autoRun: boolean; onAnalysed: (race: Race) => void }) {
  const { t } = useTranslation();
  const { state, refreshProfile } = useAuth();
  const consented = state.status === 'ready' && state.profile.ai_consent;
  const analysis = analysisFromJson(race.analysis);
  const startsNow = autoRun && consented && canAnalyze(race) && !analysis;
  const [stage, setStage] = useState<Stage>(startsNow ? 'loading' : 'idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const finish = (answer: AnalysisAnswer) => {
    if (answer.limited) {
      setNotice(answer.analysis.overall);
      setStage('idle');
      return;
    }
    success();
    onAnalysed({ ...race, analysis: { overall: answer.analysis.overall, overallDetail: answer.analysis.overallDetail, tips: answer.analysis.tips } });
    setStage('idle');
  };

  const fail = (error: unknown) => {
    if (error instanceof ApiError && error.needsAiConsent) return setStage('consent');
    setMessage(error instanceof ApiError && error.status !== 0 && error.status < 500 ? error.message : null);
    setStage('error');
  };

  /** Asks the server; the caller has already shown "loading". */
  const read = () => getApi().analyzeHyroxRace(race).then(finish, fail);

  useEffect(() => {
    if (startsNow) void read();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when a freshly finished race arrives
  }, []);

  const ask = () => {
    setNotice(null);
    setMessage(null);
    setStage(consented ? 'loading' : 'consent');
    if (consented) void read();
  };

  const allow = async () => {
    setStage('loading');
    try {
      await getApi().setAiConsent(true);
      await refreshProfile();
    } catch {
      setMessage(null);
      return setStage('error');
    }
    void read();
  };

  if (race.flagged) {
    return (
      <Card>
        <Text variant="body" secondary testID="analysis-flagged">
          ✨ {t('hyrox.analysis.unavailableFlagged')}
        </Text>
      </Card>
    );
  }
  if (!canAnalyze(race)) return null;

  if (stage === 'loading') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md }} testID="analysis-loading">
        <ActivityIndicator />
        <Text variant="body" secondary>
          {t('hyrox.analysis.loading')}
        </Text>
      </View>
    );
  }
  if (stage === 'consent') return <AiConsent onAllow={() => void allow()} onDecline={() => setStage('idle')} />;

  if (!analysis) {
    return (
      <Card>
        {notice ? (
          <Text variant="body" testID="analysis-notice">
            {notice}
          </Text>
        ) : null}
        {stage === 'error' ? <ErrorText>{message ?? t('hyrox.analysis.error')}</ErrorText> : null}
        <Button tone="plain" title={stage === 'error' ? t('hyrox.analysis.error') : t('hyrox.analysis.cta')} onPress={ask} />
        {stage === 'idle' ? (
          <Text variant="caption" secondary>
            {t('hyrox.analysis.ctaSub')}
          </Text>
        ) : null}
      </Card>
    );
  }

  return (
    <Card>
      <Text variant="rowTitle" accessibilityRole="header">
        ✨ {t('hyrox.analysis.title')}
      </Text>
      {analysis.overall ? <Overall overall={analysis.overall} detail={analysis.overallDetail} /> : null}
      {tipGroups(analysis.tips).map((group) => (
        <Group key={group.rating} rating={group.rating} tips={group.tips} />
      ))}
    </Card>
  );
}
