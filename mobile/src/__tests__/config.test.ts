import { ConfigError, readConfig, type RawEnv } from '../config';

// A JWT-shaped value with a given role, built here so no key-shaped literal sits in the source.
function jwt(role: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'ES256' })}.${b64({ role })}.signature`;
}

const GOOD: RawEnv = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
  EXPO_PUBLIC_SUPABASE_KEY: 'sb_publishable_' + 'x'.repeat(20),
  EXPO_PUBLIC_API_URL: 'https://api.example.com',
};

describe('readConfig', () => {
  it('reads a good environment, trimming and dropping trailing slashes', () => {
    expect(readConfig({ ...GOOD, EXPO_PUBLIC_SUPABASE_URL: ' https://abc.supabase.co/ ', EXPO_PUBLIC_API_URL: 'https://api.example.com///' })).toEqual({
      supabaseUrl: 'https://abc.supabase.co',
      supabaseKey: GOOD.EXPO_PUBLIC_SUPABASE_KEY,
      apiUrl: 'https://api.example.com',
    });
  });

  it.each(['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_KEY', 'EXPO_PUBLIC_API_URL'] as const)('names %s when it is missing or blank', (name) => {
    expect(() => readConfig({ ...GOOD, [name]: undefined })).toThrow(new RegExp(name));
    expect(() => readConfig({ ...GOOD, [name]: '   ' })).toThrow(new RegExp(name));
  });

  it('lists every missing name at once', () => {
    expect(() => readConfig({})).toThrow(/EXPO_PUBLIC_SUPABASE_URL.*EXPO_PUBLIC_SUPABASE_KEY.*EXPO_PUBLIC_API_URL/);
  });

  it('refuses a secret key, in either of its forms: it would ship inside the app', () => {
    expect(() => readConfig({ ...GOOD, EXPO_PUBLIC_SUPABASE_KEY: 'sb_secret_' + 'x'.repeat(20) })).toThrow(/SECRET/);
    expect(() => readConfig({ ...GOOD, EXPO_PUBLIC_SUPABASE_KEY: jwt('service_role') })).toThrow(/SECRET/);
  });

  it('accepts a legacy anon key', () => {
    expect(readConfig({ ...GOOD, EXPO_PUBLIC_SUPABASE_KEY: jwt('anon') }).supabaseKey).toBe(jwt('anon'));
  });

  it('does not choke on a key that only looks like a JWT', () => {
    for (const key of ['a.b.c', 'a.b', '....', 'x.%%%.y']) expect(readConfig({ ...GOOD, EXPO_PUBLIC_SUPABASE_KEY: key }).supabaseKey).toBe(key);
  });

  it('requires https for Supabase, and for the API except on localhost', () => {
    expect(() => readConfig({ ...GOOD, EXPO_PUBLIC_SUPABASE_URL: 'http://abc.supabase.co' })).toThrow(/https/);
    expect(() => readConfig({ ...GOOD, EXPO_PUBLIC_SUPABASE_URL: 'http://localhost:54321' })).toThrow(/https/);
    expect(() => readConfig({ ...GOOD, EXPO_PUBLIC_API_URL: 'http://api.example.com' })).toThrow(/https/);
    expect(readConfig({ ...GOOD, EXPO_PUBLIC_API_URL: 'http://localhost:5000' }).apiUrl).toBe('http://localhost:5000');
    expect(readConfig({ ...GOOD, EXPO_PUBLIC_API_URL: 'http://127.0.0.1:5000' }).apiUrl).toBe('http://127.0.0.1:5000');
    expect(readConfig({ ...GOOD, EXPO_PUBLIC_API_URL: 'http://dev.localhost:5000' }).apiUrl).toBe('http://dev.localhost:5000');
    expect(() => readConfig({ ...GOOD, EXPO_PUBLIC_API_URL: 'http://localhost.evil.com' })).toThrow(/https/);
  });

  it('refuses a value that is not a URL', () => {
    expect(() => readConfig({ ...GOOD, EXPO_PUBLIC_API_URL: 'not a url' })).toThrow(ConfigError);
  });
});
