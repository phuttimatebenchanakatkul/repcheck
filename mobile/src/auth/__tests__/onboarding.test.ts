import type { Supabase } from '@/supabase/client';

import { markOnboardingDone } from '../onboarding';

function client(result: { error: unknown } | Error) {
  const calls: { table?: string; update?: unknown; eq?: unknown[] } = {};
  const supabase = {
    from: (table: string) => {
      calls.table = table;
      return {
        update: (values: unknown) => {
          calls.update = values;
          return {
            eq: async (...args: unknown[]) => {
              calls.eq = args;
              if (result instanceof Error) throw result;
              return result;
            },
          };
        },
      };
    },
  } as unknown as Supabase;
  return { supabase, calls };
}

describe('markOnboardingDone', () => {
  it('sets the one column the app may write, on that person’s own row', async () => {
    const { supabase, calls } = client({ error: null });
    expect(await markOnboardingDone(supabase, 'user-1')).toBe(true);
    expect(calls).toEqual({ table: 'profiles', update: { onboarding_completed: true }, eq: ['id', 'user-1'] });
  });

  it('a refusal or a thrown failure is false, never an exception', async () => {
    expect(await markOnboardingDone(client({ error: { message: 'no' } }).supabase, 'u')).toBe(false);
    expect(await markOnboardingDone(client(new Error('offline')).supabase, 'u')).toBe(false);
  });
});
