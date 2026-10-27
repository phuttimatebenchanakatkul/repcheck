import { useEffect, useRef, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View, type ScrollViewInstance } from 'react-native';

import { useTranslation } from '@/i18n';
import { MAX_MESSAGE_CHARS, chatBlocks, formatCountdown, type ChatTurn, type ReportFeature } from '@/logic/chat';
import { AiConsent } from '@/ui/AiConsent';
import { Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';

import { RichBlocks } from '../analyze/RichText';
import { ReplyFooter } from './SourcesFooter';
import type { ChatSession } from './useChatSession';

function Bubble({ turn, feature }: { turn: ChatTurn; feature: ReportFeature }) {
  const { colors } = useTheme();
  const mine = turn.role === 'user';
  return (
    <View
      testID={mine ? 'bubble-user' : 'bubble-assistant'}
      style={{
        alignSelf: mine ? 'flex-end' : 'flex-start',
        maxWidth: '92%',
        backgroundColor: mine ? colors.green.tint : colors.card,
        borderWidth: mine ? 0 : 1,
        borderColor: colors.border,
        borderRadius: radius.lg,
        padding: space.md,
        gap: space.xs,
      }}>
      <RichBlocks blocks={chatBlocks(turn.text)} />
      {/* Only a real AI answer carries the footer: a person's own turn, and anything the app said itself, has none. */}
      {!mine && turn.sources !== null ? <ReplyFooter sources={turn.sources} feature={feature} reply={turn.text} /> : null}
    </View>
  );
}

/**
 * A chat: the thread, the starter questions when it is empty, a text box and a send button. One component for all three chats; what
 * differs (where turns are kept, what is asked, when it closes) is outside it. The consent question replaces the thread while it is
 * waiting, so nothing is sent before it is answered.
 */
export function ChatView({
  turns,
  session,
  feature,
  placeholder,
  empty,
  suggestions,
  limitText,
  limitPlaceholder,
  closedText,
  closedPlaceholder,
  header,
}: {
  turns: readonly ChatTurn[];
  session: ChatSession;
  feature: ReportFeature;
  placeholder: string;
  /** Shown above the starter questions while the thread is empty. */
  empty?: ReactNode;
  suggestions: readonly string[];
  /** "Limit reached — resets in {time}" */
  limitText: (time: string) => string;
  limitPlaceholder: string;
  /** A chat that no longer takes questions (an analysis more than a day old) shows this and a disabled box. */
  closedText?: string;
  closedPlaceholder?: string;
  header?: ReactNode;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const scroll = useRef<ScrollViewInstance>(null);
  const locked = session.lockSeconds !== null;
  const closed = closedText !== undefined;
  const disabled = locked || closed || session.sending;
  const shown = session.pending ? [...turns, session.pending] : turns;
  const hasThread = shown.length > 0;

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: true });
  }, [shown.length, session.notice, session.sending]);

  if (session.askingConsent) {
    return (
      <View style={{ flex: 1, padding: space.lg }}>
        <AiConsent onAllow={() => void session.allow()} onDecline={session.declineConsent} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        {header}
        {!hasThread ? (
          <View style={{ gap: space.md }}>
            {empty}
            {!closed
              ? suggestions.map((question) => (
                  <Pressable
                    key={question}
                    accessibilityRole="button"
                    disabled={disabled}
                    onPress={() => void session.send(question)}
                    style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: space.lg, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, opacity: disabled ? 0.5 : 1 }}>
                    <Text variant="body">{question}</Text>
                  </Pressable>
                ))
              : null}
          </View>
        ) : null}
        {shown.map((turn) => (
          <Bubble key={turn.id} turn={turn} feature={feature} />
        ))}
        {session.sending ? (
          <View accessibilityLabel={t('app.chat.thinking')} style={{ alignSelf: 'flex-start', padding: space.md }}>
            <ActivityIndicator />
          </View>
        ) : null}
        {session.notice ? (
          <View testID="notice" accessibilityRole="alert" style={{ alignSelf: 'flex-start', maxWidth: '92%', backgroundColor: colors.amber.tint, borderRadius: radius.lg, padding: space.md }}>
            <Text variant="body" style={{ color: colors.ink.amber }}>
              {session.notice}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {locked ? (
        <Text variant="label" testID="limit-text" style={{ textAlign: 'center', color: colors.ink.amber, paddingHorizontal: space.lg, paddingBottom: space.xs }}>
          {limitText(formatCountdown(session.lockSeconds ?? 0))}
        </Text>
      ) : null}
      {closed ? (
        <Text variant="label" testID="closed-text" secondary style={{ textAlign: 'center', paddingHorizontal: space.lg, paddingBottom: space.xs }}>
          {closedText}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm }}>
        <TextInput
          accessibilityLabel={placeholder}
          placeholder={locked ? limitPlaceholder : closed ? (closedPlaceholder ?? placeholder) : placeholder}
          placeholderTextColor={colors.textSecondary}
          value={session.draft}
          onChangeText={session.setDraft}
          editable={!disabled}
          maxLength={MAX_MESSAGE_CHARS}
          multiline
          returnKeyType="send"
          blurOnSubmit
          onSubmitEditing={() => void session.send()}
          style={{ flex: 1, minHeight: 48, maxHeight: 120, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, color: colors.text, paddingHorizontal: space.md, paddingTop: 13, paddingBottom: 13, fontSize: 16 }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('app.chat.send')}
          disabled={disabled || !session.draft.trim()}
          onPress={() => void session.send()}
          style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.buttonFill, opacity: disabled || !session.draft.trim() ? 0.4 : 1 }}>
          <Text style={{ color: '#ffffff', fontSize: 22, fontWeight: '700' }} accessibilityElementsHidden importantForAccessibility="no">
            ↑
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
