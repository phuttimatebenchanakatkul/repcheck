/**
 * Design tokens, from DESIGN.md (the website's tokens, which the native app keeps so the two look like one product).
 * `tests`: src/ui/__tests__/tokens.test.ts computes the real contrast ratios from these values, so a repalette that
 * breaks legibility fails there.
 *
 * Type is the SYSTEM font on purpose: on iOS that is SF Pro (and the system Thai face for Thai), which is what a native
 * app looks like. The website self-hosted Inter only because a browser has no system face to rely on.
 */

export type Scheme = 'light' | 'dark';

export interface Accent {
  /** A fill: sits under white text or behind an icon. NEVER used as text (it misses 4.5:1). */
  fill: string;
  /** The tinted background for chips and list badges. */
  tint: string;
}

export interface Palette {
  bg: string;
  card: string;
  text: string;
  textSecondary: string;
  border: string;
  /** Links and the focus ring: --link, not --blue (--blue is 3.39:1 on the dark card). */
  link: string;
  green: Accent;
  red: Accent;
  amber: Accent;
  blue: Accent;
  purple: Accent;
  pink: Accent;
  /** Text-only variants of the accents that are ever set as text. */
  ink: { green: string; amber: string; blue: string; red: string };
  /** Fill for a primary button with a white label: the green accent itself is only 3.0:1 under white, this clears 4.5:1. */
  buttonFill: string;
}

export const palette: Record<Scheme, Palette> = {
  light: {
    bg: '#f5f6f8',
    card: '#ffffff',
    text: '#101114',
    textSecondary: '#6b6d78',
    border: '#edeff2',
    link: '#2f66e8',
    green: { fill: '#1fa971', tint: '#e7f6ee' },
    red: { fill: '#d1453b', tint: '#fdeceb' },
    amber: { fill: '#b9832a', tint: '#fbf1e2' },
    blue: { fill: '#2f66e8', tint: '#eaf0fd' },
    purple: { fill: '#7c4fe0', tint: '#f3edfd' },
    pink: { fill: '#c0398c', tint: '#fbeaf4' },
    ink: { green: '#177e54', amber: '#916721', blue: '#2b63e8', red: '#c4382e' },
    buttonFill: '#177e54',
  },
  dark: {
    bg: '#0b0b0c',
    card: '#1c1c1e',
    text: '#f5f5f7',
    textSecondary: '#8e8e93',
    border: '#2c2c2e',
    link: '#6d9bf5',
    green: { fill: '#1fa971', tint: '#12321f' },
    red: { fill: '#d1453b', tint: '#3a1f1e' },
    amber: { fill: '#b9832a', tint: '#3a2f14' },
    blue: { fill: '#2f66e8', tint: '#14213f' },
    purple: { fill: '#7c4fe0', tint: '#2a1f45' },
    pink: { fill: '#c0398c', tint: '#3a1830' },
    ink: { green: '#1fa971', amber: '#c68c2d', blue: '#5884ed', red: '#db6c64' },
    buttonFill: '#177e54',
  },
};

export const radius = { sm: 11, md: 14, lg: 20, sheet: 34, pill: 999 } as const;

/** 4-pt grid. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** (size, weight) pairs from DESIGN.md's observed scale. Weights are strings, as React Native wants. */
export const type = {
  title: { fontSize: 17, fontWeight: '800' },
  rowTitle: { fontSize: 17, fontWeight: '700' },
  label: { fontSize: 13.5, fontWeight: '700' },
  body: { fontSize: 13, fontWeight: '500' },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 0.9, textTransform: 'uppercase' },
  caption: { fontSize: 11.5, fontWeight: '400' },
  /** Numbers that line up in columns (calories, weights, times). */
  numeric: { fontVariant: ['tabular-nums'] },
} as const;

/** The widest a content column gets on a tablet (the app is Universal; see IOS_APP_STORE.md). */
export const MAX_CONTENT_WIDTH = 720;
