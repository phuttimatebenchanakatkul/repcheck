import { useState } from 'react';

import { useActions } from '@/data/hooks';
import { useTranslation } from '@/i18n';
import { displayToKg, weightUnitLabel, type UnitPrefs } from '@/logic/units';
import { Button, ErrorText, Field } from '@/ui/components';
import { success } from '@/ui/haptics';

/** Logs (or replaces) the weight for `day`, typed in the person's unit and stored in kg. Anything the database would refuse is refused first. */
export function WeightForm({ day, units, onSaved }: { day: string; units: UnitPrefs; onSaved?: () => void }) {
  const { t } = useTranslation();
  const actions = useActions();
  const [weight, setWeight] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const kg = displayToKg(weight, units);
    setError(null);
    try {
      const saved = Number.isFinite(kg) && (await actions.saveWeight({ day, kg, loggedAt: Date.now() }));
      if (!saved) return setError(t('app.home.weightInvalid'));
      success();
      setWeight('');
      onSaved?.();
    } catch {
      setError(t('nutrition.log.saveError'));
    }
  };

  return (
    <>
      <Field label={t('app.home.weightLabel', { unit: weightUnitLabel(units) })} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" />
      <ErrorText>{error}</ErrorText>
      <Button title={t('common.save')} onPress={() => void save()} disabled={!weight.trim()} />
    </>
  );
}
