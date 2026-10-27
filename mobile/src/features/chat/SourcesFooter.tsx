import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { getApi } from '@/api';
import { useTranslation } from '@/i18n';
import { REPORT_REASONS, safeUrl, type ChatSource, type ReportFeature, type ReportReason } from '@/logic/chat';
import { Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';

/** The website's public list of every source and health note: open to anyone, so a reviewer can read it without an account. */
export const SOURCES_PAGE_URL = 'https://repcheck-q0m4.onrender.com/sources';

type Report = { kind: 'idle' } | { kind: 'choosing' } | { kind: 'sending' } | { kind: 'done' } | { kind: 'failed' };

/**
 * Report this reply (Guideline 4.7.1: a hosted chatbot needs a way to report its output). Four fixed reasons, then the reply's own text
 * goes to /api/ai-report, where it lands on the review queue. The same words as the website.
 */
export function ReportControl({ feature, reply }: { feature: ReportFeature; reply: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [state, setState] = useState<Report>({ kind: 'idle' });

  const send = async (reason: ReportReason) => {
    setState({ kind: 'sending' });
    try {
      await getApi().reportReply(feature, reason, reply);
      setState({ kind: 'done' });
    } catch {
      setState({ kind: 'failed' });
    }
  };

  if (state.kind === 'sending') return <Text variant="caption" secondary>{t('aiReport.sending')}</Text>;
  if (state.kind === 'done') return <Text variant="caption" secondary>{t('aiReport.thanks')}</Text>;
  if (state.kind === 'choosing') {
    return (
      <View style={{ gap: space.xs }}>
        <Text variant="caption" secondary>
          {t('aiReport.prompt')}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {REPORT_REASONS.map((reason) => (
            <Pressable
              key={reason}
              accessibilityRole="button"
              onPress={() => void send(reason)}
              style={{ minHeight: 36, paddingHorizontal: space.md, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
              <Text variant="label">{t(`aiReport.reason.${reason}`)}</Text>
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" onPress={() => setState({ kind: 'idle' })} style={{ minHeight: 36, paddingHorizontal: space.md, justifyContent: 'center' }}>
            <Text variant="label" style={{ color: colors.link }}>
              {t('aiReport.cancel')}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }
  return (
    <View style={{ gap: space.xs }}>
      {state.kind === 'failed' ? (
        <Text variant="caption" accessibilityRole="alert" style={{ color: colors.ink.red }}>
          {t('aiReport.failed')}
        </Text>
      ) : null}
      <Pressable accessibilityRole="button" onPress={() => setState({ kind: 'choosing' })} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
        <Text variant="label" style={{ color: colors.link }}>
          {t('aiReport.button')}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * What sits under an AI reply: the citations behind it (picked by the server from a fixed catalog), a link to every source, the
 * "AI-generated, not medical advice" line, and the Report control. Each of these closed an App Review rejection (1.4.1 and 4.7.1).
 * Only plain https links open, in the in-app browser.
 */
export function ReplyFooter({ sources, feature, reply }: { sources: readonly ChatSource[]; feature: ReportFeature; reply: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const open = (url: string) => void WebBrowser.openBrowserAsync(url);
  return (
    <View style={{ gap: space.sm, marginTop: space.sm }}>
      {sources.length > 0 ? (
        <View testID="sources" style={{ gap: space.xs }}>
          <Text variant="eyebrow" secondary accessibilityRole="header">
            {t('aiSources.label')}
          </Text>
          {sources.map((source, i) => {
            const url = safeUrl(source.url);
            if (!url) return null;
            return (
              <Pressable key={`${i}-${url}`} accessibilityRole="link" accessibilityLabel={t('app.chat.sourceOpen', { title: source.title })} onPress={() => open(url)} style={{ minHeight: 36, justifyContent: 'center' }}>
                <Text variant="body" style={{ color: colors.link }}>
                  {i + 1}. {source.title}
                  {source.publisher ? (
                    <Text variant="caption" secondary>
                      {'  '}
                      {source.publisher}
                    </Text>
                  ) : null}
                </Text>
              </Pressable>
            );
          })}
          <Pressable accessibilityRole="link" onPress={() => open(SOURCES_PAGE_URL)} style={{ minHeight: 36, justifyContent: 'center' }}>
            <Text variant="label" style={{ color: colors.link }}>
              {t('aiSources.all')}
            </Text>
          </Pressable>
        </View>
      ) : null}
      <Text variant="caption" secondary testID="ai-disclaimer">
        {t('aiSources.disclaimer')}
      </Text>
      <ReportControl feature={feature} reply={reply} />
    </View>
  );
}
