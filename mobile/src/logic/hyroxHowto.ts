/**
 * Plain-language "how to perform this station" content: static/hyrox.js (STATION_HOWTO, STATION_VIDEOS) is the original, and a test runs
 * the website's own copy against this one. English only, as on the website.
 */
export interface HowTo {
  summary: string;
  steps: readonly string[];
  tip: string;
}

export const STATION_HOWTO: Record<string, HowTo> = {
  skierg: {
    summary: '1000m on the SkiErg machine — resistance is just your own effort, no added weight.',
    steps: [
      'Reach tall: arms fully extended overhead, grab the handles high.',
      'Drive down by hinging at your hips and crunching your core — not just yanking with your arms.',
      'Finish with hands past your hips, let the handles pull you back up to a tall reach, and repeat.',
    ],
    tip: 'Long, powerful strokes at a steady rhythm beat short frantic pulls — smooth and relentless wins.',
  },
  sledPush: {
    summary: '50m pushing a heavy sled (four 12.5m lengths). The load is the hard part, not the distance.',
    steps: [
      'Set your hands low on the posts, arms straight, and get your body into a low forward angle.',
      'Drive through the balls of your feet with short, choppy, powerful steps — never let the sled stop.',
      "Push in a straight line and don't pause between lengths; momentum is everything.",
    ],
    tip: "It's a leg day, not an arm day — keep your arms locked and drive with your legs.",
  },
  sledPull: {
    summary: '50m pulling a heavy sled toward you with a rope (four 12.5m lengths).',
    steps: [
      'Sit back low, anchor your feet, keep your hips down and chest up.',
      'Pull the rope hand-over-hand using your bodyweight and legs, not just your arms.',
      'Reset your feet after each pull and stay low to keep the sled gliding.',
    ],
    tip: 'Lean back and let your bodyweight do the work — the more you hang off the rope, the less your arms fry.',
  },
  burpeeBroadJump: {
    summary: '80m of burpee broad jumps: a burpee, then a forward jump, over and over.',
    steps: [
      'Drop into a burpee — chest to the floor, then explode up.',
      'Instead of jumping straight up, leap forward as far as you comfortably can.',
      'Land soft, immediately drop into the next burpee, and keep a steady rhythm.',
    ],
    tip: "Don't max out every jump — a repeatable distance keeps your heart rate down for the runs after.",
  },
  row: {
    summary: '1000m on the rowing machine — resistance is your own effort, no added weight.',
    steps: [
      'Drive with your legs first, then swing your body back, then pull the handle to your ribs.',
      'Return in the reverse order: arms away, body forward, then bend your knees.',
      'Hold a strong, steady stroke rate rather than sprinting and blowing up.',
    ],
    tip: 'Legs, then body, then arms — most people over-use their arms and gas out early.',
  },
  farmersCarry: {
    summary: '200m carrying a heavy kettlebell in each hand.',
    steps: [
      'Grip both kettlebells firmly, stand tall with shoulders back and core braced.',
      "Walk with quick, controlled steps — don't shuffle or let the weights swing.",
      'Only set them down if you truly must; every drop costs you time.',
    ],
    tip: 'Grip is everything — chalk up if you can, and aim for zero drops from start to finish.',
  },
  lunges: {
    summary: '100m of walking lunges with a sandbag resting across your shoulders.',
    steps: [
      'Rest the sandbag across your upper back and hold it steady.',
      'Step forward into a lunge until your back knee gently touches the floor.',
      'Drive up and forward into the next rep, keeping your chest tall.',
    ],
    tip: 'Keep your steps consistent and your torso upright — leaning forward under the bag is what slows people down.',
  },
  wallBalls: {
    summary: 'Throwing a weighted ball up to a target for reps — the last station before the finish.',
    steps: [
      'Hold the ball at your chest and drop into a full squat.',
      'Explode up and use that momentum to throw the ball to the target.',
      'Catch it on the way down and flow straight into the next squat.',
    ],
    tip: 'Plan small sets from the very start (like 10s) — never go to failure, resting mid-set costs the most time.',
  },
};

/** A YouTube tutorial per station (the website embeds them; the app opens them in the in-app browser). */
export const STATION_VIDEOS: Record<string, string> = {
  skierg: '9RJiSvgaiJU',
  sledPush: '_gipeeBinKo',
  sledPull: 'K2FhsenkS3U',
  burpeeBroadJump: 'UTO-GzRXF-Q',
  row: 'uwxBKQQ8_ok',
  farmersCarry: 'Eve7EY5vwZQ',
  lunges: 'HUAY0bM1bUE',
  wallBalls: 'eVpVh2czEyI',
};

export const videoUrl = (id: string): string => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
