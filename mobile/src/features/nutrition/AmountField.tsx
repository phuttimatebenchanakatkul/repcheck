import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { FOOD_UNITS, gramsToUnit, UNIT_LABELS, unitToGrams } from '@/logic/macros';
import type { FoodUnit } from '@/logic/types';
import { Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Segmented } from '@/ui/widgets';

/**
 * An amount the person types in g, oz or mL (or one fixed unit). Reports the amount in GRAMS, which is how it is stored, but only a
 * number above zero: a blank or zero field keeps the last good amount (the website's rule), so a half-typed value never zeroes a food.
 * The text is the field's own while editing ("1." and "" are fine mid-typing); remount it (change its `key`) to show a different amount.
 */
export function AmountField({
  label,
  grams,
  unit,
  onChange,
  onCommit,
  units = FOOD_UNITS,
  unitLabel,
}: {
  label: string;
  grams: number;
  unit: FoodUnit;
  onChange: (grams: number, unit: FoodUnit) => void;
  /** The person finished editing (left the field): the moment to save. */
  onCommit?: () => void;
  /** The units offered; a single one shows no switch. */
  units?: readonly FoodUnit[];
  unitLabel?: string;
}) {
  const { colors } = useTheme();
  const [chosen, setChosen] = useState<FoodUnit>(unit);
  const [text, setText] = useState(String(gramsToUnit(grams, unit)));
  /** The exact amount in grams: what was passed in until the text is edited (the text shows it rounded, so switching unit must not read it back). */
  const [exact, setExact] = useState(grams);

  const edit = (next: string) => {
    setText(next);
    const value = Number.parseFloat(next);
    if (value > 0) {
      const asGrams = unitToGrams(value, chosen);
      setExact(asGrams);
      onChange(asGrams, chosen);
    }
  };

  const switchUnit = (next: FoodUnit) => {
    const asGrams = exact;
    setChosen(next);
    setText(String(gramsToUnit(asGrams, next)));
    onChange(asGrams, next);
    onCommit?.();
  };

  return (
    <View style={{ gap: space.sm }}>
      <Text variant="eyebrow" secondary>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <TextInput
          accessibilityLabel={label}
          keyboardType="decimal-pad"
          selectTextOnFocus
          value={text}
          onChangeText={edit}
          onEndEditing={onCommit}
          style={{ flex: 1, minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, color: colors.text, paddingHorizontal: space.md, fontSize: 18, fontVariant: ['tabular-nums'] }}
        />
        {units.length > 1 ? (
          <View style={{ width: 168 }}>
            <Segmented options={units.map((u) => ({ value: u, label: UNIT_LABELS[u] }))} value={chosen} onChange={switchUnit} label={unitLabel} />
          </View>
        ) : (
          <Text variant="rowTitle">{UNIT_LABELS[units[0] ?? 'g']}</Text>
        )}
      </View>
    </View>
  );
}
