import Svg, { Circle, Line, Path } from 'react-native-svg';

import type { ChallengeExercise } from '@/logic/challenges';
import { useTheme } from '@/ui/theme';

/** The three exercises, drawn as the website's hero icons (templates/challenges.html EXERCISE_HERO_ICONS), in the text colour. */
export function ExerciseIcon({ exercise, size = 66 }: { exercise: ChallengeExercise; size?: number }) {
  const { colors } = useTheme();
  const stroke = colors.text;
  const common = { stroke, strokeWidth: 5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 88 88" accessibilityElementsHidden importantForAccessibility="no">
      {exercise === 'pushups' ? (
        <>
          <Line x1={14} y1={60} x2={74} y2={60} stroke={stroke} strokeOpacity={0.35} strokeWidth={3} strokeLinecap="round" />
          <Line x1={31} y1={40} x2={59} y2={42} {...common} />
          <Path d="M31 40 L28 50 L31 60" {...common} />
          <Line x1={59} y1={42} x2={71} y2={60} {...common} />
          <Circle cx={24} cy={34} r={6} fill={stroke} />
        </>
      ) : null}
      {exercise === 'situps' ? (
        <>
          <Line x1={14} y1={62} x2={74} y2={62} stroke={stroke} strokeOpacity={0.35} strokeWidth={3} strokeLinecap="round" />
          <Path d="M24 60 L40 46 L54 60" {...common} />
          <Path d="M24 60 Q26 44 30 36" {...common} />
          <Line x1={30} y1={36} x2={35} y2={41} {...common} />
          <Circle cx={27} cy={30} r={6} fill={stroke} />
        </>
      ) : null}
      {exercise === 'pullups' ? (
        <>
          <Line x1={24} y1={16} x2={64} y2={16} stroke={stroke} strokeWidth={5} strokeLinecap="round" />
          <Path d="M31 16 L36 30" {...common} />
          <Path d="M57 16 L52 30" {...common} />
          <Line x1={44} y1={34} x2={44} y2={54} {...common} />
          <Path d="M44 54 L36 68" {...common} />
          <Path d="M44 54 L52 68" {...common} />
          <Circle cx={44} cy={26} r={6} fill={stroke} />
        </>
      ) : null}
    </Svg>
  );
}
