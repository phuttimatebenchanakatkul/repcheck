import { NativeTabs } from 'expo-router/native-tabs';

import { useTranslation } from '@/i18n';
import { useTheme } from '@/ui/theme';

/** The five tabs, as the system's own tab bar (a real UITabBar on iOS). Labels follow the language. */
export default function TabsLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();

  return (
    <NativeTabs backgroundColor={colors.card} tintColor={colors.ink.green} labelStyle={{ color: colors.textSecondary, selected: { color: colors.ink.green } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{t('nav.home')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="workouts">
        <NativeTabs.Trigger.Label>{t('nav.workouts')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="dumbbell.fill" md="fitness_center" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="analyze">
        <NativeTabs.Trigger.Label>{t('nav.analyze')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="video.fill" md="videocam" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="nutrition">
        <NativeTabs.Trigger.Label>{t('nav.nutrition')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="fork.knife" md="restaurant" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="coach">
        <NativeTabs.Trigger.Label>{t('nav.coach')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="bubble.left.fill" md="chat" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
