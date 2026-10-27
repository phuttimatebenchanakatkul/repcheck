import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

import { splitIconKey } from '@/logic/hyrox';
import { useTheme } from '@/ui/theme';

interface Drawing {
  paths: string[];
  circles?: [number, number, number][];
  rects?: [number, number, number, number][];
  /** The lunges' sandbag: an ellipse (cx, cy, rx, ry) turned 20 degrees about its centre. */
  ellipse?: [number, number, number, number];
  /** A dotted line (the burpees' jump). */
  dashed?: string;
}

/** The website's station pictograms (static/hyrox.js STATION_ICONS) on a 48 x 48 grid, drawn as outlines. */
const ICONS: Record<string, Drawing> = {
  run: { circles: [[32, 8, 3.5]], paths: ['M29 11L21 22', 'M21 22L29 24L32 33', 'M21 22L14 25L10 16', 'M29 11L22 15L18 10', 'M29 11L37 14L41 11'] },
  skierg: {
    circles: [[38, 4, 2.2], [16, 9, 3.5]],
    paths: ['M38 2V44', 'M38 4L26 25', 'M17 12L21 23', 'M18 15L26 25', 'M21 23L16 32L13 40', 'M21 23L25 32L28 40'],
  },
  sledPush: { circles: [[10, 14, 3.2]], rects: [[28, 18, 14, 10]], paths: ['M11 17l8 6', 'M19 23l-2 8', 'M19 23l6 6', 'M13 18l10 2', 'M23 20l5 1M23 24l5 2'] },
  sledPull: { circles: [[14, 12, 3.2]], rects: [[36, 12, 8, 8]], paths: ['M14 15l3 9', 'M17 24l-2 8', 'M17 24l6 4', 'M12 17l8-3', 'M20 14l14 2'] },
  burpeeBroadJump: { circles: [[24, 10, 3.2]], paths: ['M24 13l-2 6', 'M22 19l-6 4', 'M22 19l7 2', 'M22 19l-3 9', 'M22 19l6 8'], dashed: 'M6 40h36' },
  row: { circles: [[30, 14, 3.2]], paths: ['M4 38h40', 'M30 17l-2 8', 'M28 25l-10 4', 'M28 25l6 6', 'M28 33l-8 5', 'M28 33l6 5', 'M18 29l-10 2'] },
  farmersCarry: { circles: [[24, 8, 3.2], [15, 24, 3], [33, 24, 3]], paths: ['M24 11v14', 'M24 13l-8 2', 'M24 13l8 2', 'M24 25l-6 10', 'M24 25l6 10'] },
  lunges: { circles: [[20, 8, 3.2]], ellipse: [28, 12, 6, 4], paths: ['M20 11v10', 'M20 21l-8 6', 'M12 27l2 8', 'M20 21l6 4', 'M26 25v9'] },
  wallBalls: {
    circles: [[34, 8, 2.5], [18, 10, 3.2], [26, 9, 2.2]],
    paths: ['M40 2v40', 'M18 13v8', 'M18 15l-6-4', 'M18 15l8-6', 'M18 21l-6 8', 'M18 21l7 7'],
  },
};

/** One station's pictogram (a run's key, run1 to run8, draws the shared runner). */
export function StationIcon({ name, size = 32 }: { name: string; size?: number }) {
  const { colors } = useTheme();
  const drawing = ICONS[splitIconKey(name)] ?? ICONS.run;
  const line = { stroke: colors.text, strokeWidth: 2.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessibilityElementsHidden importantForAccessibility="no">
      {drawing.paths.map((d) => (
        <Path key={d} d={d} {...line} />
      ))}
      {drawing.dashed ? <Path d={drawing.dashed} {...line} strokeDasharray="2 4" /> : null}
      {drawing.circles?.map(([cx, cy, r]) => (
        <Circle key={`${cx},${cy}`} cx={cx} cy={cy} r={r} {...line} />
      ))}
      {drawing.rects?.map(([x, y, width, height]) => (
        <Rect key={`${x},${y}`} x={x} y={y} width={width} height={height} rx={1.5} {...line} />
      ))}
      {drawing.ellipse ? <Ellipse cx={drawing.ellipse[0]} cy={drawing.ellipse[1]} rx={drawing.ellipse[2]} ry={drawing.ellipse[3]} rotation={20} origin={`${drawing.ellipse[0]}, ${drawing.ellipse[1]}`} {...line} /> : null}
    </Svg>
  );
}
