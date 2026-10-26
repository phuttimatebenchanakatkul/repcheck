/**
 * Where the app finds its backends. Values come from EXPO_PUBLIC_* variables, which Expo inlines into the JavaScript
 * bundle at build time: anything here is readable by anyone who has the app. So the Supabase key must be the PUBLISHABLE
 * one (safe to ship; row-level security is what protects the data), and this refuses the secret key outright.
 */
export interface Config {
  supabaseUrl: string;
  supabaseKey: string;
  apiUrl: string;
}

export class ConfigError extends Error {}

export interface RawEnv {
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_KEY?: string;
  EXPO_PUBLIC_API_URL?: string;
}

function isLocal(url: URL): boolean {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname.endsWith('.localhost');
}

/** A JWT's `role` claim, or null if the text is not a JWT with a readable payload (never throws). */
function jwtRole(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    const role = (JSON.parse(json) as { role?: unknown }).role;
    return typeof role === 'string' ? role : null;
  } catch {
    return null;
  }
}

function parseUrl(name: string, value: string, allowLocal: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`${name} is not a URL`);
  }
  if (url.protocol !== 'https:' && !(allowLocal && url.protocol === 'http:' && isLocal(url))) {
    throw new ConfigError(`${name} must be an https:// address`);
  }
  return value.replace(/\/+$/, '');
}

export function readConfig(env: RawEnv): Config {
  const missing = (['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_KEY', 'EXPO_PUBLIC_API_URL'] as const).filter((name) => !env[name]?.trim());
  if (missing.length) throw new ConfigError(`missing ${missing.join(', ')} (see .env.example)`);

  const supabaseKey = env.EXPO_PUBLIC_SUPABASE_KEY!.trim();
  if (supabaseKey.startsWith('sb_secret_') || jwtRole(supabaseKey) === 'service_role') {
    throw new ConfigError('EXPO_PUBLIC_SUPABASE_KEY is a SECRET key: it would ship inside the app. Use the publishable key.');
  }
  return {
    supabaseUrl: parseUrl('EXPO_PUBLIC_SUPABASE_URL', env.EXPO_PUBLIC_SUPABASE_URL!.trim(), false),
    supabaseKey,
    apiUrl: parseUrl('EXPO_PUBLIC_API_URL', env.EXPO_PUBLIC_API_URL!.trim(), true),
  };
}

let cached: Config | null = null;

/** The app's configuration, read once. Static `process.env.EXPO_PUBLIC_X` accesses are what Expo inlines. */
export function getConfig(): Config {
  if (!cached) {
    cached = readConfig({
      EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
      EXPO_PUBLIC_SUPABASE_KEY: process.env.EXPO_PUBLIC_SUPABASE_KEY,
      EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    });
  }
  return cached;
}
