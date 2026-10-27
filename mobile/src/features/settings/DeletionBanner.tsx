import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { useTranslation } from '@/i18n';
import { formatDueDate } from '@/logic/account';
import { localeFor } from '@/logic/units';
import { Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';

/** Shown while an account is scheduled for deletion, so it cannot be forgotten: "Keep my account" opens the place to undo it. */
export function DeletionBanner() {
  const { t, language } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const { state } = useAuth();
  const due = state.status === 'ready' ? state.profile.due_at : null;
  if (!due) return null;
  return (
    <View testID="deletion-banner" accessibilityRole="alert" style={{ backgroundColor: colors.red.tint, borderRadius: radius.md, padding: space.md, gap: space.xs }}>
      <Text variant="body" style={{ color: colors.ink.red }}>
        {t('banner.deletion.text', { date: formatDueDate(due, localeFor(language)) })}
      </Text>
      <Pressable accessibilityRole="button" onPress={() => router.push('/settings')} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
        <Text variant="label" style={{ color: colors.link }}>
          {t('banner.deletion.action')}
        </Text>
      </Pressable>
    </View>
  );
}
