import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useRef } from 'react';
import { Platform, ScrollView, Text as RNText, View, type ScrollViewInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { MAX_CONTENT_WIDTH, space } from '@/ui/tokens';

import { LEGAL_PAGES, plainText, routeParams, type LegalLink, type LegalPageKey, type LegalRun } from './pages';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** One policy page, drawn natively. `section` (a heading's or entry's id) scrolls the page to it when it opens. */
export function LegalPage({ page, section }: { page: LegalPageKey; section?: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const scroll = useRef<ScrollViewInstance>(null);

  const follow = (link: LegalLink) => {
    if (link.page) router.push(routeParams(link.page, link.section));
    else if (link.href?.startsWith('mailto:')) void Linking.openURL(link.href);
    else if (link.href) void WebBrowser.openBrowserAsync(link.href);
  };

  const runs = (list: readonly LegalRun[], base?: object) => (
    <RNText>
      {list.map((run, i) => {
        const link = run.link;
        return (
          <Text
            key={i}
            variant="body"
            {...(link ? { accessibilityRole: 'link' as const, onPress: () => follow(link) } : {})}
            style={[
              { fontSize: 15, lineHeight: 22 },
              base,
              run.b ? { fontWeight: '700' } : null,
              run.i ? { fontStyle: 'italic' } : null,
              run.c ? { fontFamily: MONO } : null,
              link ? { color: colors.link, textDecorationLine: 'underline' } : null,
            ]}
          >
            {run.t}
          </Text>
        );
      })}
    </RNText>
  );

  /** Scroll to the entry the page was opened at, once its position is known. */
  const anchor = (id: string | undefined, offset = 0) =>
    id && id === section ? { onLayout: (e: { nativeEvent: { layout: { y: number } } }) => scroll.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y + offset - space.md), animated: false }) } : {};

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['left', 'right']}>
      <ScrollView ref={scroll} contentContainerStyle={{ width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', padding: space.lg, gap: space.md }}>
        {LEGAL_PAGES[page].blocks.map((block, index) => {
          if (block.type === 'ul') {
            return (
              <View key={index} style={{ gap: space.sm }}>
                {block.items.map((item, j) => (
                  <View key={j} style={{ flexDirection: 'row', gap: space.sm }} {...anchor(item.id)}>
                    <Text variant="body" accessibilityElementsHidden importantForAccessibility="no" style={{ fontSize: 15, lineHeight: 22 }}>
                      •
                    </Text>
                    <View style={{ flex: 1 }}>
                      {runs(item.runs)}
                      {item.note ? (
                        <Text variant="caption" secondary style={{ marginTop: 2 }}>
                          {item.note}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            );
          }
          if (block.type === 'h') {
            return (
              <View key={index} {...anchor(block.id)}>
                <Text variant="title" accessibilityRole="header" style={{ marginTop: space.md }}>
                  {plainText(block.runs)}
                </Text>
              </View>
            );
          }
          if (block.type === 'updated') {
            return (
              <Text key={index} variant="caption" secondary>
                {plainText(block.runs)}
              </Text>
            );
          }
          return (
            <View key={index} {...anchor(block.id)}>
              {runs(block.runs)}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
