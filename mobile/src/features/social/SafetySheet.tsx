import { useState } from 'react';
import { View } from 'react-native';

import { getApi } from '@/api';
import { REPORT_REASONS, type ReportReason } from '@/api/social';
import { useTranslation, type TranslationKey } from '@/i18n';
import { Button, ErrorText, Text } from '@/ui/components';
import { success } from '@/ui/haptics';
import { space } from '@/ui/tokens';
import { Row, Sheet } from '@/ui/widgets';

import { shownMessage } from './queries';

export interface SafetyTarget {
  id: string;
  name: string;
}

type Stage = 'actions' | 'reasons' | 'done';

const REASON_LABEL: Record<ReportReason, TranslationKey> = {
  offensive_name: 'safety.reason.offensive',
  impersonation: 'safety.reason.impersonation',
  spam: 'safety.reason.spam',
  other: 'safety.reason.other',
};

/**
 * Report or block another account (App Store Guideline 1.2): static/safety.js is the original. Reporting blocks as well, so there is no
 * second step to stop seeing what was just objected to. `onChanged` runs once the server has taken either.
 */
export function SafetySheet({ target, onClose, onChanged }: { target: SafetyTarget | null; onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const [stage, setStage] = useState<Stage>('actions');
  const [doneText, setDoneText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setStage('actions');
    setError(null);
    onClose();
  };

  const run = async (action: () => Promise<void>, done: TranslationKey) => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      success();
      setDoneText(t(done));
      setStage('done');
      onChanged();
    } catch (failure) {
      setError(shownMessage(failure, t('safety.genericError')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={target !== null} title={target?.name ?? ''} closeLabel={t(stage === 'done' ? 'common.done' : 'common.cancel')} onClose={close}>
      {stage === 'actions' ? (
        <View style={{ gap: space.md }}>
          <Row onPress={() => setStage('reasons')} label={t('safety.reportName')}>
            <View style={{ flex: 1 }}>
              <Text variant="rowTitle">{t('safety.reportName')}</Text>
              <Text variant="caption" secondary>
                {t('safety.reportSub')}
              </Text>
            </View>
          </Row>
          <Row onPress={() => void run(() => getApi().blockAccount(target?.id ?? ''), 'safety.blockedDone')} label={t('safety.blockAccount')}>
            <View style={{ flex: 1 }}>
              <Text variant="rowTitle">{t('safety.blockAccount')}</Text>
              <Text variant="caption" secondary>
                {t('safety.blockSub')}
              </Text>
            </View>
          </Row>
        </View>
      ) : null}

      {stage === 'reasons' ? (
        <View style={{ gap: space.md }}>
          <Text variant="label">{t('safety.reasonTitle')}</Text>
          {REPORT_REASONS.map((reason) => (
            <Row key={reason} onPress={() => void run(() => getApi().reportAccount(target?.id ?? '', reason), 'safety.reportedDone')} label={t(REASON_LABEL[reason])}>
              <Text variant="rowTitle">{t(REASON_LABEL[reason])}</Text>
            </Row>
          ))}
          <Button tone="plain" title={t('common.back')} onPress={() => setStage('actions')} />
        </View>
      ) : null}

      {stage === 'done' ? (
        <Text variant="body" testID="safety-done">
          {doneText}
        </Text>
      ) : null}

      <ErrorText>{error}</ErrorText>
    </Sheet>
  );
}
