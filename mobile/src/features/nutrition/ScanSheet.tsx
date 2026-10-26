import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { ActivityIndicator, Image, TextInput, View } from 'react-native';

import { ApiError, getApi } from '@/api';
import type { PickedImage } from '@/api/scan';
import { useAuth } from '@/auth/AuthProvider';
import { useTranslation } from '@/i18n';
import { newId } from '@/logic/ids';
import { macroLine } from '@/logic/macros';
import { scanAmountIn, scanBaseGrams, scanEntry, scanGrams, scanTotals, type ScanResult, type ScanUnit } from '@/logic/scan';
import type { NutritionEntry } from '@/logic/types';
import { AiConsent } from '@/ui/AiConsent';
import { Button, Card, ErrorText, Text } from '@/ui/components';
import { success } from '@/ui/haptics';
import { choosePhoto, takePhoto, type PhotoResult } from '@/ui/photos';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Chip, Segmented, Sheet } from '@/ui/widgets';

type Stage =
  | { kind: 'pick' }
  | { kind: 'scanning' }
  | { kind: 'consent'; image: PickedImage }
  | { kind: 'working'; text: string; uri?: string }
  | { kind: 'result'; result: ScanResult; uri?: string }
  | { kind: 'notfound'; barcode: string }
  | { kind: 'error'; message: string };

const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'] as const;

function dataCredit(source: string | undefined): 'nutrition.creditOpenFoodFacts' | 'nutrition.creditFatSecret' | null {
  if (source === 'Open Food Facts') return 'nutrition.creditOpenFoodFacts';
  if (source === 'FatSecret') return 'nutrition.creditFatSecret';
  return null;
}

// -- the result: name, macros, amount --------------------------------------------------------------------------------------------

export function ScanResultView({ result, uri, onAdd, onRetake }: { result: ScanResult; uri?: string; onAdd: (name: string, grams: number) => void; onRetake: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [name, setName] = useState(result.food_name);
  const [servingGrams, setServingGrams] = useState(scanBaseGrams(result));
  const [unit, setUnit] = useState<ScanUnit>('serving');
  const [amount, setAmount] = useState('1');

  const typed = Number.parseFloat(amount);
  const grams = scanGrams(Number.isFinite(typed) && typed >= 0 ? typed : 0, unit, servingGrams);
  const totals = scanTotals(result, grams);
  const credit = dataCredit(result.data_source);
  const sure = result.confidence === 'high' || result.confidence === 'custom';

  const switchUnit = (next: ScanUnit) => {
    setAmount(String(scanAmountIn(grams, next, servingGrams)));
    setUnit(next);
  };

  return (
    <View style={{ gap: space.md }}>
      {uri ? <Image source={{ uri }} accessibilityIgnoresInvertColors style={{ width: '100%', height: 200, borderRadius: radius.md }} /> : null}
      <View style={{ alignSelf: 'flex-start', paddingHorizontal: space.md, minHeight: 28, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: sure ? colors.green.tint : colors.amber.tint }}>
        <Text variant="label" style={{ color: sure ? colors.ink.green : colors.ink.amber }}>
          {t(`app.scan.confidence.${result.confidence}`)}
        </Text>
      </View>
      <TextInput
        accessibilityLabel={t('app.nutrition.custom.name')}
        value={name}
        onChangeText={setName}
        maxLength={40}
        style={{ minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, color: colors.text, paddingHorizontal: space.md, fontSize: 18, fontWeight: '700' }}
      />
      {result.note ? (
        <Text variant="body" secondary>
          {result.note}
        </Text>
      ) : null}
      <Text variant="caption" secondary>
        {credit ? t(credit) : result.confidence === 'custom' ? '' : t('nutrition.aiEstimateNote')}
      </Text>

      <Card>
        <Text variant="title" style={{ fontSize: 28 }} testID="scan-kcal">
          {Math.round(totals.calories)} kcal
        </Text>
        <Text variant="label" secondary testID="scan-macros">
          {macroLine(totals)}
        </Text>
      </Card>

      {result.servings && result.servings.length > 1 ? (
        <View style={{ gap: space.sm }}>
          <Text variant="eyebrow" secondary>
            {t('app.nutrition.servings')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {result.servings.map((serving) => (
              <Chip
                key={`${serving.label}-${serving.grams}`}
                label={`${serving.label} (${serving.grams} g)`}
                selected={unit === 'serving' && Math.abs(serving.grams - servingGrams) < 0.05}
                onPress={() => {
                  setServingGrams(serving.grams); // one serving is now this size, and the amount starts again at one of them
                  setUnit('serving');
                  setAmount('1');
                }}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ gap: space.sm }}>
        <Text variant="eyebrow" secondary>
          {t('nutrition.amount.label')}
        </Text>
        <TextInput
          accessibilityLabel={t('nutrition.amount.label')}
          keyboardType="decimal-pad"
          selectTextOnFocus
          value={amount}
          onChangeText={setAmount}
          style={{ minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, color: colors.text, paddingHorizontal: space.md, fontSize: 18, fontVariant: ['tabular-nums'] }}
        />
        <Segmented
          value={unit}
          onChange={switchUnit}
          options={[
            { value: 'serving', label: t('app.scan.serving') },
            { value: 'g', label: 'g' },
            { value: 'oz', label: 'oz' },
          ]}
        />
        <Text variant="caption" secondary>
          {t('app.scan.servingHint', { grams: Math.round(servingGrams * 10) / 10 })}
        </Text>
      </View>

      <Button title={t('app.scan.addToLog')} onPress={() => onAdd(name, grams)} disabled={!(grams > 0)} />
      <Button tone="plain" title={t('app.scan.retake')} onPress={onRetake} />
    </View>
  );
}

// -- the live barcode camera ---------------------------------------------------------------------------------------------------------

function BarcodeCamera({ onScanned }: { onScanned: (code: string) => void }) {
  const { t } = useTranslation();
  const [permission, request] = useCameraPermissions();
  if (!permission) return <ActivityIndicator />;
  if (!permission.granted) {
    return (
      <View style={{ gap: space.md }}>
        <ErrorText>{t('app.scan.cameraDenied')}</ErrorText>
        {permission.canAskAgain ? <Button title={t('app.scan.take')} onPress={() => void request()} /> : null}
      </View>
    );
  }
  return (
    <View style={{ gap: space.md }}>
      <CameraView
        style={{ width: '100%', height: 320, borderRadius: radius.md, overflow: 'hidden' }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
        onBarcodeScanned={(event) => onScanned(event.data)}
      />
      <Text variant="body" secondary style={{ textAlign: 'center' }}>
        {t('app.scan.pointAtBarcode')}
      </Text>
    </View>
  );
}

// -- the flow ------------------------------------------------------------------------------------------------------------------------------

function ScanBody({ mode, day, onAdd, onCreateFood }: { mode: 'meal' | 'barcode'; day: string; onAdd: (entry: NutritionEntry) => void; onCreateFood: (barcode: string) => void }) {
  const { t } = useTranslation();
  const { state, refreshProfile } = useAuth();
  const consented = state.status === 'ready' && state.profile.ai_consent;
  const start: Stage = mode === 'meal' ? { kind: 'pick' } : { kind: 'scanning' };
  const [stage, setStage] = useState<Stage>(start);
  /** A live camera reports the same barcode many times a second: only the first is looked up. */
  const handled = useRef(false);

  const fail = (error: unknown) => setStage({ kind: 'error', message: error instanceof ApiError ? error.message : t('app.scan.failed') });

  const analyze = async (image: PickedImage) => {
    setStage({ kind: 'working', text: t('app.scan.analyzing'), uri: image.uri });
    try {
      const result = await getApi().analyzeFood(image);
      setStage({ kind: 'result', result, uri: image.uri });
    } catch (error) {
      if (error instanceof ApiError && error.needsAiConsent) setStage({ kind: 'consent', image });
      else fail(error);
    }
  };

  const photo = (picked: PhotoResult) => {
    if (picked.kind === 'denied') return setStage({ kind: 'error', message: t('app.scan.cameraDenied') });
    if (picked.kind === 'cancelled') return;
    if (consented) void analyze(picked.image);
    else setStage({ kind: 'consent', image: picked.image });
  };

  const allow = async (image: PickedImage) => {
    setStage({ kind: 'working', text: t('app.scan.analyzing'), uri: image.uri });
    try {
      await getApi().setAiConsent(true);
      await refreshProfile();
    } catch (error) {
      return fail(error);
    }
    await analyze(image);
  };

  const lookUp = async (code: string) => {
    if (handled.current) return;
    handled.current = true;
    setStage({ kind: 'working', text: t('app.scan.lookingUp') });
    try {
      const outcome = await getApi().lookupBarcode(code);
      if (outcome.kind === 'found') setStage({ kind: 'result', result: outcome.result });
      else if (outcome.kind === 'not-found') setStage({ kind: 'notfound', barcode: outcome.barcode });
      else setStage({ kind: 'error', message: outcome.message });
    } catch (error) {
      fail(error);
    }
  };

  const again = () => {
    handled.current = false;
    setStage(start);
  };

  switch (stage.kind) {
    case 'pick':
      return (
        <View style={{ gap: space.md }}>
          <Button title={t('app.scan.take')} onPress={() => void takePhoto().then(photo)} />
          <Button tone="plain" title={t('app.scan.choose')} onPress={() => void choosePhoto().then(photo)} />
        </View>
      );
    case 'scanning':
      return <BarcodeCamera onScanned={(code) => void lookUp(code)} />;
    case 'consent':
      return <AiConsent onAllow={() => void allow(stage.image)} onDecline={again} />;
    case 'working':
      return (
        <View style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xl }}>
          {stage.uri ? <Image source={{ uri: stage.uri }} accessibilityIgnoresInvertColors style={{ width: 160, height: 160, borderRadius: radius.md }} /> : null}
          <ActivityIndicator />
          <Text variant="body" secondary>
            {stage.text}
          </Text>
        </View>
      );
    case 'result':
      return (
        <ScanResultView
          result={stage.result}
          uri={stage.uri}
          onRetake={again}
          onAdd={(name, grams) => {
            success();
            onAdd(scanEntry(stage.result, { id: newId(), day, now: new Date(), name, grams }));
          }}
        />
      );
    case 'notfound':
      return (
        <View style={{ gap: space.md }}>
          <Text variant="rowTitle">{t('app.scan.notFound')}</Text>
          <Text variant="body" secondary>
            {t('app.scan.barcodeLabel', { code: stage.barcode })}
          </Text>
          <Button title={t('app.scan.createFromBarcode')} onPress={() => onCreateFood(stage.barcode)} />
          <Button tone="plain" title={t('app.scan.tryAgain')} onPress={again} />
        </View>
      );
    case 'error':
      return (
        <View style={{ gap: space.md }}>
          <ErrorText>{stage.message}</ErrorText>
          <Button title={t('app.scan.tryAgain')} onPress={again} />
        </View>
      );
  }
}

export function ScanSheet({
  visible,
  mode,
  day,
  onAdd,
  onCreateFood,
  onClose,
}: {
  visible: boolean;
  mode: 'meal' | 'barcode';
  day: string;
  onAdd: (entry: NutritionEntry) => void;
  /** No product matched the barcode: make a food of your own for it. */
  onCreateFood: (barcode: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet visible={visible} title={mode === 'meal' ? t('app.scan.mealTitle') : t('app.scan.barcodeTitle')} closeLabel={t('common.close')} onClose={onClose}>
      <ScanBody mode={mode} day={day} onAdd={onAdd} onCreateFood={onCreateFood} />
    </Sheet>
  );
}
