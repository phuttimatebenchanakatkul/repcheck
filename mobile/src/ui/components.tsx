import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text as RNText,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MAX_CONTENT_WIDTH, radius, space, type } from './tokens';
import { useTheme } from './theme';

type Variant = keyof Pick<typeof type, 'title' | 'rowTitle' | 'label' | 'body' | 'caption' | 'eyebrow'>;

export function Text({ variant = 'body', secondary, style, ...props }: TextProps & { variant?: Variant; secondary?: boolean }) {
  const { colors } = useTheme();
  return <RNText {...props} style={[type[variant] as TextStyle, { color: secondary ? colors.textSecondary : colors.text }, style]} />;
}

/** A full screen: themed background, safe-area insets, and a centred column that stops growing on a tablet. */
export function Screen({ children, scroll = true, style }: { children: ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const column: ViewStyle = { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', padding: space.lg, gap: space.md };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView contentContainerStyle={[column, style]} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, column, style]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[{ backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.lg, gap: space.sm }, style]}>
      {children}
    </View>
  );
}

export function Button({
  title,
  onPress,
  loading,
  disabled,
  tone = 'primary',
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  tone?: 'primary' | 'plain';
}) {
  const { colors } = useTheme();
  const off = disabled || loading;
  const primary = tone === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48, // Apple's 44 pt minimum touch target, with room
        borderRadius: radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: space.xl,
        backgroundColor: primary ? colors.buttonFill : 'transparent',
        opacity: off ? 0.5 : pressed ? 0.8 : 1,
      })}>
      {loading ? (
        <ActivityIndicator color={primary ? '#ffffff' : colors.text} />
      ) : (
        <RNText style={[type.rowTitle as TextStyle, { color: primary ? '#ffffff' : colors.link }]}>{title}</RNText>
      )}
    </Pressable>
  );
}

export function Field({ label, style, ...props }: TextInputProps & { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="eyebrow" secondary>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textSecondary}
        {...props}
        style={[
          { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, color: colors.text, paddingHorizontal: space.md, fontSize: 16 },
          style,
        ]}
      />
    </View>
  );
}

/** An inline error line, announced to screen readers. */
export function ErrorText({ children }: { children?: ReactNode }) {
  const { colors } = useTheme();
  if (!children) return null;
  return (
    <RNText accessibilityRole="alert" style={[type.body as TextStyle, { color: colors.ink.red }]}>
      {children}
    </RNText>
  );
}
