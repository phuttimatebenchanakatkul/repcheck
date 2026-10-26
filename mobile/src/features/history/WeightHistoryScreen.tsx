import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Defs, LinearGradient, Polygon, Polyline, Stop } from 'react-native-svg';

import { useSettings, useWeights } from '@/data/hooks';
import { useTranslation } from '@/i18n';
import { parseIso, toIsoDate } from '@/logic/dates';
import {
  CHART,
  calendarSummary,
  chartPoints,
  entriesForMonth,
  entriesForYear,
  monthDays,
  monthOf,
  shiftMonth,
  weightRows,
  weightStats,
  yearRows,
  type Direction,
  type Month,
} from '@/logic/history';
import { formatWeightKg, localeFor } from '@/logic/units';
import { Button, Card, Screen, Text } from '@/ui/components';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { useTheme } from '@/ui/theme';
import { space } from '@/ui/tokens';
import { Segmented, Sheet } from '@/ui/widgets';

import { MonthCalendar, MonthNav, useMonthLabel } from './MonthCalendar';
import { WeightForm } from './WeightForm';

type Mode = 'month' | 'year';

function WeightChart({ entries }: { entries: { day: string; kg: number }[] }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const points = chartPoints(entries);
  if (points.length === 0) {
    return (
      <Text variant="body" secondary style={{ textAlign: 'center', paddingVertical: space.lg }}>
        {t('weight.logTwoEntries')}
      </Text>
    );
  }
  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const { width, height, pad } = CHART;
  const area = `${pad.toFixed(1)},${height.toFixed(1)} ${line} ${(width - pad).toFixed(1)},${height.toFixed(1)}`;
  return (
    <Svg width="100%" height={140} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" accessibilityLabel={t('weight.change')}>
      <Defs>
        <LinearGradient id="weightArea" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.blue.fill} stopOpacity={0.35} />
          <Stop offset="1" stopColor={colors.blue.fill} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Polygon points={area} fill="url(#weightArea)" />
      <Polyline points={line} fill="none" stroke={colors.blue.fill} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

/** Weight over time: a month or a year at a time with its stats, chart and list, and a calendar of the days weight was logged. */
export default function WeightHistoryScreen() {
  const { t, language } = useTranslation();
  const { colors } = useTheme();
  const locale = localeFor(language);
  const monthLabel = useMonthLabel();
  const now = new Date();
  const today = toIsoDate(now);
  const settings = useSettings();
  const units = settings.data.units;
  const all = useWeights('1900-01-01', today);
  const entries = all.data;

  const latestEntry = entries[entries.length - 1];
  const start = latestEntry ? (parseIso(latestEntry.day) as Date) : now;
  const [mode, setMode] = useState<Mode>('month');
  // Until the person moves, both open on the month of the latest weigh-in (once it has loaded), as the website does.
  const [viewChosen, setView] = useState<Month | null>(null);
  const [calendarChosen, setCalendar] = useState<Month | null>(null);
  const view = viewChosen ?? monthOf(start);
  const calendar = calendarChosen ?? monthOf(start);
  const [popup, setPopup] = useState<string | null>(null);

  const fmt = (kg: number) => formatWeightKg(kg, units);
  const shown = mode === 'month' ? entriesForMonth(entries, view) : entriesForYear(entries, view.year);
  const stats = weightStats(shown);
  const logged = new Set(entries.map((e) => e.day));
  const summary = calendarSummary(monthDays(calendar), today, (day) => logged.has(day));
  const colorFor = (direction: Direction | null) => (direction === 'up' ? colors.ink.red : direction === 'down' ? colors.ink.green : colors.textSecondary);
  const signed = (kg: number) => `${kg > 0 ? '+' : ''}${fmt(kg)}`;
  const dayLabel = (day: string) => (parseIso(day) as Date).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });

  const popupEntry = popup ? entries.find((e) => e.day === popup) : undefined;

  return (
    <Screen>
      <OfflineBanner />
      {all.isLoading ? (
        <Text variant="body" secondary>
          {t('common.loading')}
        </Text>
      ) : entries.length === 0 ? (
        <Card>
          <Text style={{ fontSize: 40, textAlign: 'center' }} accessibilityElementsHidden importantForAccessibility="no">
            ⚖️
          </Text>
          <Text variant="rowTitle" style={{ textAlign: 'center' }}>
            {t('weight.emptyTitle')}
          </Text>
          <Text variant="body" secondary style={{ textAlign: 'center' }}>
            {t('weight.notLoggedYet')}
          </Text>
          <Button title={t('weight.emptyCta')} onPress={() => setPopup(today)} />
        </Card>
      ) : (
        <Card>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'month', label: t('weight.month') },
              { value: 'year', label: t('weight.year') },
            ]}
          />
          {mode === 'month' ? (
            <MonthNav month={view} latest={monthOf(now)} onChange={setView} />
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md }}>
              <Pressable accessibilityRole="button" accessibilityLabel={t('app.history.prevMonth')} onPress={() => setView({ ...view, year: view.year - 1 })} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="title">‹</Text>
              </Pressable>
              <Text variant="rowTitle" accessibilityRole="header" style={{ minWidth: 150, textAlign: 'center' }}>
                {view.year}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel={t('app.history.nextMonth')} onPress={() => setView({ ...view, year: view.year + 1 })} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="title">›</Text>
              </Pressable>
            </View>
          )}

          {stats ? (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {[
                { key: 'latest', label: t('weight.latest'), value: fmt(stats.latest), color: colors.text },
                { key: 'average', label: t('weight.average'), value: fmt(stats.average), color: colors.text },
                { key: 'change', label: t('weight.change'), value: signed(stats.change), color: colorFor(stats.direction) },
              ].map((stat) => (
                <View key={stat.key} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                  <Text variant="caption" secondary>
                    {stat.label}
                  </Text>
                  <Text variant="rowTitle" style={{ color: stat.color }} testID={`stat-${stat.key}`}>
                    {stat.value}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text variant="body" secondary style={{ textAlign: 'center' }}>
              {t('weight.noEntries')}
            </Text>
          )}

          <WeightChart entries={shown} />

          {mode === 'month' ? (
            shown.length === 0 ? (
              <Text variant="body" secondary style={{ textAlign: 'center' }}>
                {t('weight.noWeightInMonth', { month: t(`common.month.${view.month}` as 'common.month.0'), year: view.year })}
              </Text>
            ) : (
              weightRows(shown).map((row) => {
                const date = parseIso(row.day) as Date;
                return (
                  <View key={row.day} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
                    <Text variant="body">{`${date.getDate()} ${date.toLocaleDateString(locale, { weekday: 'short' })}`}</Text>
                    <View style={{ flexDirection: 'row', gap: space.md }}>
                      <Text variant="body" style={{ color: colorFor(row.direction) }}>
                        {row.delta === null ? '—' : signed(row.delta)}
                      </Text>
                      <Text variant="rowTitle">{fmt(row.kg)}</Text>
                    </View>
                  </View>
                );
              })
            )
          ) : (
            yearRows(entries, view.year).map((row) => (
              <Pressable
                key={row.month}
                accessibilityRole="button"
                accessibilityLabel={`${t(`common.month.${row.month}` as 'common.month.0')}${row.latest === null ? `, ${t('weight.noData')}` : `, ${fmt(row.latest)}`}`}
                disabled={row.latest === null}
                onPress={() => {
                  setView({ year: view.year, month: row.month });
                  setMode('month');
                }}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
                <Text variant="body">{t(`common.month.${row.month}` as 'common.month.0')}</Text>
                {row.latest === null || row.average === null ? (
                  <Text variant="body" secondary>
                    {t('weight.noData')}
                  </Text>
                ) : (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text variant="rowTitle">{fmt(row.latest)}</Text>
                    <Text variant="caption" secondary>
                      {t('weight.avgPrefix', { value: fmt(row.average) })}
                    </Text>
                  </View>
                )}
              </Pressable>
            ))
          )}
        </Card>
      )}

      {entries.length > 0 && (
        <>
          <Text variant="rowTitle" accessibilityRole="header">
            {t('weight.loggingHistoryTitle')}
          </Text>
          <Card>
            <MonthNav month={calendar} latest={monthOf(now)} onChange={setCalendar} />
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.lg }}>
              <Text variant="body" secondary testID="logged-count">
                {summary.active} {t('loggingHistory.summary.logged')}
              </Text>
              <Text variant="body" secondary testID="not-logged-count">
                {summary.inactive} {t('loggingHistory.summary.notLogged')}
              </Text>
            </View>
            <MonthCalendar
              month={calendar}
              today={today}
              has={(day) => logged.has(day)}
              activeColor={colors.green.fill}
              describe={(day, on) => `${dayLabel(day)}, ${on ? t('coaching.legend.logged') : t('coaching.legend.notLogged')}`}
              onPressDay={setPopup}
            />
          </Card>
        </>
      )}

      <Sheet visible={popup !== null} title={popup ? dayLabel(popup) : ''} closeLabel={t('common.close')} onClose={() => setPopup(null)}>
        {popup && (
          <View style={{ gap: space.md }}>
            {popupEntry ? (
              <Text variant="title" style={{ fontSize: 28 }} testID="popup-weight">
                {fmt(popupEntry.kg)}
              </Text>
            ) : (
              <Text variant="body" secondary testID="popup-empty">
                {t('loggingHistory.summary.notLogged')}
              </Text>
            )}
            {popup === today && <WeightForm day={today} units={units} onSaved={() => setPopup(null)} />}
          </View>
        )}
      </Sheet>
    </Screen>
  );
}
