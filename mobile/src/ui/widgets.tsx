/** Small building blocks shared by the daily-loop screens: a bottom sheet, a progress bar and ring, a segmented control, chips. */
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Text } from './components';
import { useTheme } from './theme';
import { radius, space } from './tokens';

/** A page sheet (the iOS card that slides up over the screen). Its own Done button closes it; content scrolls. */
export function Sheet({ visible, title, closeLabel, onClose, children }: { visible: boolean; title: string; closeLabel: string; onClose: () => void; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.lg, gap: space.md }}>
          <Text variant="title" accessibilityRole="header" style={{ flex: 1 }} numberOfLines={1}>
            {title}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} onPress={onClose} hitSlop={space.md} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text variant="rowTitle" style={{ color: colors.link }}>
              {closeLabel}
            </Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 0, gap: space.md }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** A horizontal bar filled `percent` (0..100) of its width. */
export function Bar({ percent, color, label }: { percent: number; color: string; label?: string }) {
  const { colors } = useTheme();
  const now = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now }}
      style={{ height: 8, borderRadius: radius.pill, backgroundColor: colors.border, overflow: 'hidden' }}>
      <View style={{ width: `${now}%`, height: '100%', borderRadius: radius.pill, backgroundColor: color }} />
    </View>
  );
}

/** A ring filled `fill` (0..1) clockwise from the top, with `children` in the middle. */
export function Ring({ fill, size = 132, stroke = 12, color, children, label }: { fill: number; size?: number; stroke?: number; color: string; children?: ReactNode; label?: string }) {
  const { colors } = useTheme();
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fill) ? fill : 0));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.border} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - clamped)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: readonly { value: T; label: string }[]; value: T; onChange: (value: T) => void; label?: string }) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', backgroundColor: colors.border, borderRadius: radius.pill, padding: 3 }}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={{ flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: selected ? colors.card : 'transparent' }}>
            <Text variant="label" style={{ color: selected ? colors.text : colors.textSecondary }}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, onPress, selected, style }: { label: string; onPress: () => void; selected?: boolean; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={[{ minHeight: 36, paddingHorizontal: space.md, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: selected ? colors.green.tint : colors.card, borderWidth: 1, borderColor: selected ? colors.green.fill : colors.border }, style]}>
      <Text variant="label" style={{ color: selected ? colors.ink.green : colors.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A pressable row that reads as one control to a screen reader. */
export function Row({ children, onPress, label, style }: { children: ReactNode; onPress?: () => void; label?: string; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const base: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, padding: space.md, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [base, { opacity: pressed ? 0.8 : 1 }, style]}>
      {children}
    </Pressable>
  );
}
