import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useTranslation, type TranslationKey } from '@/i18n';
import { CUSTOM_PICKER, customTitle, moveBlock, removeBlock, setBlockAmount, addBlock, type CustomBlock, type CustomKey } from '@/logic/hyrox';
import { newId } from '@/logic/ids';
import { Button, Card, Field, Text } from '@/ui/components';
import { space } from '@/ui/tokens';
import { Chip, Row, Sheet } from '@/ui/widgets';

import { StationIcon } from './StationIcon';

/** A small round control with its own spoken name (a glyph alone says nothing to a screen reader). */
function IconButton({ glyph, label, onPress, disabled }: { glyph: string; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} hitSlop={4} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1 }}>
      <Text variant="title">{glyph}</Text>
    </Pressable>
  );
}

const GROUP_LABEL: Record<(typeof CUSTOM_PICKER)[number]['key'], TranslationKey> = {
  cardio: 'app.hyrox.group.cardio',
  sled: 'app.hyrox.group.sled',
  carry: 'app.hyrox.group.carry',
  explosive: 'app.hyrox.group.explosive',
};

/** The station picker: the building blocks in four groups, one tap to add. */
function Picker({ visible, onPick, onClose }: { visible: boolean; onPick: (key: CustomKey) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [group, setGroup] = useState(CUSTOM_PICKER[0].key);
  const active = CUSTOM_PICKER.find((g) => g.key === group) ?? CUSTOM_PICKER[0];
  return (
    <Sheet visible={visible} title={t('hyrox.custom.addStation')} closeLabel={t('common.close')} onClose={onClose}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {CUSTOM_PICKER.map((g) => (
          <Chip key={g.key} label={t(GROUP_LABEL[g.key])} selected={g.key === active.key} onPress={() => setGroup(g.key)} />
        ))}
      </View>
      {active.keys.map((key) => (
        <Row key={key} onPress={() => onPick(key)} label={customTitle(key)}>
          <StationIcon name={key} size={28} />
          <Text variant="rowTitle">{customTitle(key)}</Text>
        </Row>
      ))}
    </Sheet>
  );
}

/**
 * Builds a race by hand: any station, any number of times, in any order, each with its own amount (metres, or reps for wall balls).
 * It starts as the whole standard race. The website reorders by press-and-hold dragging as well as arrows; here the arrows do it.
 */
export function CustomBuilder({ blocks, onChange, onReset }: { blocks: readonly CustomBlock[]; onChange: (next: CustomBlock[]) => void; onReset: () => void }) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const [typing, setTyping] = useState<Record<string, string>>({});

  return (
    <Card>
      <Text variant="rowTitle" accessibilityRole="header">
        {t('hyrox.custom.yourRace')}
      </Text>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button tone="plain" title={t('hyrox.custom.addStation')} onPress={() => setPicking(true)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button tone="plain" title={t('hyrox.custom.resetToStandard')} onPress={onReset} />
        </View>
      </View>
      {blocks.length === 0 ? (
        <Text variant="body" secondary testID="custom-empty">
          {t('hyrox.custom.empty')}
        </Text>
      ) : null}
      {blocks.map((block, i) => {
        const unit = block.key === 'wallBalls' ? t('hyrox.space.chip.reps') : 'm';
        const title = customTitle(block.key);
        const commit = (text: string) => {
          onChange(setBlockAmount(blocks, block.id, text));
          setTyping(({ [block.id]: _gone, ...rest }) => rest);
        };
        return (
          <View key={block.id} style={{ gap: space.xs }} testID={`block-${i}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Text variant="caption" secondary style={{ width: 20 }}>
                {i + 1}
              </Text>
              <StationIcon name={block.key} size={22} />
              <Text variant="rowTitle" style={{ flex: 1 }}>
                {title}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Field
                  label={`${title} ${block.key === 'wallBalls' ? t('hyrox.space.chip.reps') : t('hyrox.standards.chip.distance')} (${unit})`}
                  value={typing[block.id] ?? String(block.amount)}
                  onChangeText={(text) => setTyping((now) => ({ ...now, [block.id]: text }))}
                  onEndEditing={(event) => commit(event.nativeEvent.text)}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                />
              </View>
              <IconButton glyph="▲" label={`${t('hyrox.custom.moveUp')}: ${title}`} disabled={i === 0} onPress={() => onChange(moveBlock(blocks, block.id, -1))} />
              <IconButton glyph="▼" label={`${t('hyrox.custom.moveDown')}: ${title}`} disabled={i === blocks.length - 1} onPress={() => onChange(moveBlock(blocks, block.id, 1))} />
              <IconButton glyph="×" label={`${t('common.remove')}: ${title}`} onPress={() => onChange(removeBlock(blocks, block.id))} />
            </View>
          </View>
        );
      })}
      <Picker
        visible={picking}
        onClose={() => setPicking(false)}
        onPick={(key) => {
          onChange(addBlock(blocks, key, newId()));
          setPicking(false);
        }}
      />
    </Card>
  );
}
