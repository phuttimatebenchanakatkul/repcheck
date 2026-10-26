import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { View } from 'react-native';

import { useTranslation } from '@/i18n';

import { Text } from './components';
import { useTheme } from './theme';
import { radius, space } from './tokens';

export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (notify) => onlineManager.subscribe(notify),
    () => onlineManager.isOnline(),
    () => true,
  );
}

/** Shown while there is no signal: what is on screen is the saved copy, and changes are queued (src/store/outbox.ts). */
export function OfflineBanner() {
  const online = useIsOnline();
  const { t } = useTranslation();
  const { colors } = useTheme();
  if (online) return null;
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: colors.amber.tint, borderRadius: radius.md, padding: space.md }}>
      <Text variant="label" style={{ color: colors.ink.amber }}>
        {t('app.offline.banner')}
      </Text>
    </View>
  );
}
