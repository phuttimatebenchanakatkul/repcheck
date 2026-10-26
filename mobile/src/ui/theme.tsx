import { useColorScheme } from 'react-native';

import { palette, type Palette, type Scheme } from './tokens';

/** The colors for the device's appearance. (A per-account theme setting arrives with settings sync in phase 5.) */
export function useTheme(): { scheme: Scheme; colors: Palette } {
  const scheme: Scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { scheme, colors: palette[scheme] };
}
