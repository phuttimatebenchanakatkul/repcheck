import { useState } from 'react';
import { View } from 'react-native';

import type { NewCustomFood } from '@/api/endpoints';
import { useTranslation } from '@/i18n';
import { caloriesFromMacros, normaliseGoals } from '@/logic/macros';
import type { Goals, NutritionEntry } from '@/logic/types';
import { newId } from '@/logic/ids';
import { stampOnDay } from '@/logic/dates';
import { Button, ErrorText, Field, Text } from '@/ui/components';
import { success } from '@/ui/haptics';
import { space } from '@/ui/tokens';
import { Sheet } from '@/ui/widgets';

/** A typed macro: a finite number from 0 up (anything else reads as 0), whole-gram precision not required. */
export function parseMacro(text: string): number {
  const n = Number.parseFloat(text);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : 0;
}

const numberField = { keyboardType: 'decimal-pad', selectTextOnFocus: true } as const;

// -- daily goals -------------------------------------------------------------------------------------------------------------------

function GoalsForm({ goals, onSave }: { goals: Goals; onSave: (goals: Pick<Goals, 'protein' | 'fat' | 'carbs'>) => void }) {
  const { t } = useTranslation();
  const [protein, setProtein] = useState(String(goals.protein));
  const [fat, setFat] = useState(String(goals.fat));
  const [carbs, setCarbs] = useState(String(goals.carbs));
  // What would be saved: out-of-range or unreadable values are corrected the way the website does, and calories follow from them.
  const clean = normaliseGoals({ protein, fat, carbs });

  return (
    <View style={{ gap: space.md }}>
      <Field label={t('nutrition.goals.protein')} value={protein} onChangeText={setProtein} {...numberField} />
      <Field label={t('nutrition.goals.fat')} value={fat} onChangeText={setFat} {...numberField} />
      <Field label={t('nutrition.goals.carbs')} value={carbs} onChangeText={setCarbs} {...numberField} />
      <View style={{ gap: space.xs }}>
        <Text variant="eyebrow" secondary>
          {t('nutrition.goals.calories')}
        </Text>
        <Text variant="title" style={{ fontSize: 24 }} testID="goals-calories">
          {clean.calories}
        </Text>
      </View>
      <Text variant="caption" secondary>
        {t('nutrition.goals.hint')}
      </Text>
      <Button title={t('nutrition.goals.save')} onPress={() => onSave({ protein: clean.protein, fat: clean.fat, carbs: clean.carbs })} />
    </View>
  );
}

export function GoalsSheet({ visible, goals, onSave, onClose }: { visible: boolean; goals: Goals; onSave: (goals: Pick<Goals, 'protein' | 'fat' | 'carbs'>) => void; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Sheet visible={visible} title={t('app.nutrition.goals.title')} closeLabel={t('common.close')} onClose={onClose}>
      <GoalsForm goals={goals} onSave={onSave} />
    </Sheet>
  );
}

// -- quick add: name + macros for an amount ----------------------------------------------------------------------------------------

/** A food the person typed in themselves: per-100 g values worked out from the macros for the amount they ate. */
export function quickEntry(input: { name: string; grams: number; protein: number; fat: number; carbs: number }, options: { day: string; now: Date; hour?: number; id?: string }): NutritionEntry {
  const grams = input.grams > 0 ? input.grams : 100;
  const per100 = (value: number) => (value * 100) / grams;
  return {
    id: options.id ?? newId(),
    food: input.name.trim(),
    addedAt: stampOnDay(options.day, options.now, options.hour),
    source: 'quick',
    grams,
    unit: 'g',
    baseCalories: per100(caloriesFromMacros(input)),
    baseCarbs: per100(input.carbs),
    baseFat: per100(input.fat),
    baseProtein: per100(input.protein),
  };
}

function QuickAddForm({ day, hour, onAdd }: { day: string; hour?: number; onAdd: (entry: NutritionEntry) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('100');
  const [protein, setProtein] = useState('');
  const [fat, setFat] = useState('');
  const [carbs, setCarbs] = useState('');
  const [error, setError] = useState<string | null>(null);
  const macros = { protein: parseMacro(protein), fat: parseMacro(fat), carbs: parseMacro(carbs) };

  const submit = () => {
    if (!name.trim()) return setError(t('app.nutrition.custom.nameRequired'));
    success();
    onAdd(quickEntry({ name, grams: parseMacro(amount), ...macros }, { day, now: new Date(), hour }));
  };

  return (
    <View style={{ gap: space.md }}>
      <Text variant="body" secondary>
        {t('nutrition.manualMacro.sub')}
      </Text>
      <Field label={t('app.nutrition.custom.name')} value={name} onChangeText={setName} autoCapitalize="sentences" />
      <Field label={`${t('nutrition.amount.label')} (g)`} value={amount} onChangeText={setAmount} {...numberField} />
      <Field label={t('nutrition.goals.protein')} value={protein} onChangeText={setProtein} {...numberField} />
      <Field label={t('nutrition.goals.fat')} value={fat} onChangeText={setFat} {...numberField} />
      <Field label={t('nutrition.goals.carbs')} value={carbs} onChangeText={setCarbs} {...numberField} />
      <View style={{ gap: space.xs }}>
        <Text variant="eyebrow" secondary>
          {t('nutrition.goals.calories')}
        </Text>
        <Text variant="title" style={{ fontSize: 24 }} testID="quick-calories">
          {caloriesFromMacros(macros)} kcal
        </Text>
        <Text variant="caption" secondary>
          {t('app.nutrition.quick.amountHint')}
        </Text>
      </View>
      <ErrorText>{error}</ErrorText>
      <Button title={t('app.nutrition.add')} onPress={submit} />
    </View>
  );
}

export function QuickAddSheet({ visible, day, hour, onAdd, onClose }: { visible: boolean; day: string; hour?: number; onAdd: (entry: NutritionEntry) => void; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Sheet visible={visible} title={t('nutrition.manualMacro.button')} closeLabel={t('common.close')} onClose={onClose}>
      <QuickAddForm day={day} hour={hour} onAdd={onAdd} />
    </Sheet>
  );
}

// -- a food of their own ---------------------------------------------------------------------------------------------------------------

function CustomFoodForm({ barcode, onCreate }: { barcode?: string; onCreate: (food: NewCustomFood) => Promise<void> }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [serving, setServing] = useState('');
  const [servingGrams, setServingGrams] = useState('100');
  const [protein, setProtein] = useState('');
  const [fat, setFat] = useState('');
  const [carbs, setCarbs] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const macros = { protein: parseMacro(protein), fat: parseMacro(fat), carbs: parseMacro(carbs) };

  const submit = async () => {
    if (!name.trim()) return setError(t('app.nutrition.custom.nameRequired'));
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        name: name.trim(),
        ...macros,
        servingLabel: serving.trim() || undefined,
        servingGrams: parseMacro(servingGrams) || undefined,
        barcode,
      });
    } catch (e) {
      // The server's own message is the useful one (a barcode already saved, the ceiling reached); anything else is generic.
      const message = e instanceof Error && (e as { status?: number }).status ? e.message : t('app.nutrition.custom.failed');
      setError(message);
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.md }}>
      {barcode ? (
        <Text variant="body" secondary>
          {t('app.scan.barcodeLabel', { code: barcode })}
        </Text>
      ) : null}
      <Field label={t('app.nutrition.custom.name')} value={name} onChangeText={setName} autoCapitalize="sentences" />
      <Field label={t('app.nutrition.custom.serving')} value={serving} onChangeText={setServing} placeholder={t('app.nutrition.custom.servingHint')} />
      <Field label={t('app.nutrition.custom.servingGrams')} value={servingGrams} onChangeText={setServingGrams} {...numberField} />
      <Text variant="eyebrow" secondary>
        {t('app.nutrition.custom.perServing')}
      </Text>
      <Field label={t('nutrition.goals.protein')} value={protein} onChangeText={setProtein} {...numberField} />
      <Field label={t('nutrition.goals.fat')} value={fat} onChangeText={setFat} {...numberField} />
      <Field label={t('nutrition.goals.carbs')} value={carbs} onChangeText={setCarbs} {...numberField} />
      <Text variant="title" style={{ fontSize: 24 }} testID="custom-calories">
        {caloriesFromMacros(macros)} kcal
      </Text>
      <ErrorText>{error}</ErrorText>
      <Button title={t('app.nutrition.custom.save')} onPress={() => void submit()} loading={busy} />
    </View>
  );
}

export function CustomFoodSheet({ visible, barcode, onCreate, onClose }: { visible: boolean; /** Make the food for this scanned barcode. */ barcode?: string; onCreate: (food: NewCustomFood) => Promise<void>; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Sheet visible={visible} title={t('nutrition.custom.create')} closeLabel={t('common.close')} onClose={onClose}>
      <CustomFoodForm barcode={barcode} onCreate={onCreate} />
    </Sheet>
  );
}
