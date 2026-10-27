import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { getApi } from '@/api';
import { useTranslation } from '@/i18n';
import { codeFromScan, friendLink, initialOf } from '@/logic/social';
import { Button, Card, ErrorText, Field, Screen, Text } from '@/ui/components';
import { success } from '@/ui/haptics';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';

import { SafetySheet, type SafetyTarget } from './SafetySheet';
import { shownMessage, useFriends, useSocialChanged } from './queries';

const COPIED_MS = 1500;

function QrScanner({ onCode }: { onCode: (code: string) => void }) {
  const { t } = useTranslation();
  const [permission, request] = useCameraPermissions();
  if (!permission) return <ActivityIndicator />;
  if (!permission.granted) {
    return (
      <View style={{ gap: space.sm }}>
        <ErrorText>{t('friends.cameraAccessDenied')}</ErrorText>
        {permission.canAskAgain ? <Button tone="plain" title={t('friends.scanQr')} onPress={() => void request()} /> : null}
      </View>
    );
  }
  return (
    <CameraView
      style={{ width: '100%', height: 280, borderRadius: radius.md, overflow: 'hidden' }}
      facing="back"
      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      onBarcodeScanned={(event) => {
        const code = codeFromScan(event.data);
        if (code) onCode(code);
      }}
    />
  );
}

function MyCode({ code }: { code: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(code);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  return (
    <Card>
      <Text variant="rowTitle">{t('friends.yourCode.title')}</Text>
      <Text variant="caption" secondary>
        {t('friends.yourCode.sub')}
      </Text>
      <View style={{ alignItems: 'center', gap: space.md }}>
        {/* A QR code needs a light ground and a quiet zone whatever the theme, or phones will not read it. */}
        <View style={{ backgroundColor: '#FFFFFF', padding: space.md, borderRadius: radius.md }} accessible accessibilityLabel={t('friends.yourCode.title')} accessibilityRole="image">
          <QRCode value={friendLink(code)} size={160} backgroundColor="#FFFFFF" color="#000000" />
        </View>
        <Text variant="title" selectable testID="my-code" style={{ letterSpacing: 1 }}>
          {code}
        </Text>
        <Button tone="plain" title={t(copied ? 'friends.copied' : 'friends.copyCode')} onPress={() => void copy()} />
      </View>
    </Card>
  );
}

/** Your code and QR, adding a friend by typing or scanning one, and your friends (each with report / block). */
export default function FriendsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const friends = useFriends();
  const changed = useSocialChanged();
  const [text, setText] = useState('');
  const [scanning, setScanning] = useState(false);
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [safety, setSafety] = useState<SafetyTarget | null>(null);
  /** A live camera reports the same code many times a second: only the first is sent. */
  const sending = useRef(false);

  const add = async (raw: string) => {
    const code = raw.trim();
    if (!code || sending.current) return;
    sending.current = true;
    setAdding(true);
    setStatus({ ok: true, text: t('friends.adding') });
    try {
      const friend = await getApi().addFriend(code);
      success();
      setText('');
      setStatus({ ok: true, text: t('friends.added', { name: friend.name }) });
      await changed();
    } catch (failure) {
      setStatus({ ok: false, text: shownMessage(failure, t('friends.couldntAdd')) });
    } finally {
      sending.current = false;
      setAdding(false);
    }
  };

  const scanned = (code: string) => {
    if (sending.current) return;
    setScanning(false);
    void add(code);
  };

  return (
    <Screen>
      <OfflineBanner />
      {friends.data ? <MyCode code={friends.data.code} /> : null}

      <Card>
        <Text variant="rowTitle">{t('friends.addFriend.title')}</Text>
        <Field label={t('friends.addFriend.sub')} placeholder={t('friends.codePlaceholder')} value={text} onChangeText={setText} autoCapitalize="characters" autoCorrect={false} />
        <Button title={t('friends.add')} loading={adding} disabled={!text.trim()} onPress={() => void add(text)} />
        <Button tone="plain" title={t(scanning ? 'friends.stopScanning' : 'friends.scanQr')} onPress={() => setScanning((on) => !on)} />
        {scanning ? <QrScanner onCode={scanned} /> : null}
        {status ? (
          status.ok ? (
            <Text variant="caption" secondary testID="add-status">
              {status.text}
            </Text>
          ) : (
            <ErrorText>{status.text}</ErrorText>
          )
        ) : null}
      </Card>

      <Card>
        <Text variant="rowTitle">{t('friends.yourFriends.title')}</Text>
        {friends.isPending ? (
          <Text variant="body" secondary>
            {t('common.loading')}
          </Text>
        ) : friends.isError ? (
          <View style={{ gap: space.sm }}>
            <ErrorText>{t('safety.genericError')}</ErrorText>
            <Button tone="plain" title={t('app.nutrition.retry')} onPress={() => void friends.refetch()} />
          </View>
        ) : friends.data.friends.length === 0 ? (
          <View style={{ alignItems: 'center', gap: space.xs, paddingVertical: space.lg }}>
            <Text style={{ fontSize: 36 }} accessibilityElementsHidden importantForAccessibility="no">
              👥
            </Text>
            <Text variant="rowTitle">{t('friends.empty')}</Text>
            <Text variant="body" secondary style={{ textAlign: 'center' }}>
              {t('friends.emptySub')}
            </Text>
          </View>
        ) : (
          friends.data.friends.map((friend) => (
            <View key={friend.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 }} testID={`friend-${friend.id}`}>
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.blue.fill, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="label" style={{ color: '#FFFFFF' }}>
                  {initialOf(friend.name)}
                </Text>
              </View>
              <Text variant="rowTitle" style={{ flex: 1 }} numberOfLines={1}>
                {friend.name}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`${t('safety.moreActions')}: ${friend.name}`} hitSlop={space.sm} onPress={() => setSafety(friend)} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="title" secondary>
                  ⋮
                </Text>
              </Pressable>
            </View>
          ))
        )}
      </Card>

      <SafetySheet target={safety} onClose={() => setSafety(null)} onChanged={() => void changed()} />
    </Screen>
  );
}
