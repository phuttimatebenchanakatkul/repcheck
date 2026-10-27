import { useState } from 'react';

import { useActions } from '@/data/hooks';
import { useTranslation } from '@/i18n';
import { cleanLane, laneOrDefault } from '@/logic/hyrox';
import { Button, Card, ErrorText, Field, Text } from '@/ui/components';

/** How long the person's gym lane is, asked once: every station that is a distance shows its laps for it. Kept on the account. */
export function LaneCard({ laneM }: { laneM: number | null }) {
  const { t } = useTranslation();
  const actions = useActions();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (value: string) => {
    setError(null);
    try {
      await actions.saveHyroxPrefs({ laneM: cleanLane(value) });
    } catch {
      setError(t('nutrition.log.saveError'));
    }
    setText(null);
  };

  return (
    <Card>
      <Text variant="rowTitle" accessibilityRole="header">
        {t('hyrox.space.title')}
      </Text>
      <Text variant="body" secondary>
        {t('hyrox.space.intro')}
      </Text>
      <Text variant="caption" secondary>
        {t('hyrox.space.measureStep1Title')} {t('hyrox.space.measureStep1Body')} {t('hyrox.space.measureStep2Title')} {t('hyrox.space.measureStep2Body')}
      </Text>
      <Field
        label={`${t('hyrox.space.laneLabel')} (m)`}
        value={text ?? String(laneOrDefault(laneM))}
        onChangeText={setText}
        onEndEditing={(event) => void save(event.nativeEvent.text)}
        keyboardType="decimal-pad"
        selectTextOnFocus
      />
      {laneM !== null ? <Button tone="plain" title={t('hyrox.weightAdjust.reset')} onPress={() => void save('')} /> : null}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
