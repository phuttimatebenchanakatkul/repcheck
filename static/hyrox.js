/**
 * Hyrox race tracker.
 *
 * Written deliberately differently from the rest of RepCheck's frontend:
 * every other page server-renders most of its markup and wires up
 * individual elements with scattered addEventListener calls. This page is
 * a single ES6 class (HyroxApp) that owns all state, re-renders its whole
 * subtree from that state on every change, and uses one delegated click
 * listener keyed off data-action attributes instead of many listeners.
 *
 * Data note: the station order and weight standards below are entered
 * from the official Hyrox rulebook as of this build, but Hyrox updates
 * specs by season — always confirm current numbers at hyrox.com before
 * relying on them for competition prep.
 */

(function () {
  "use strict";

  // Short alias for translations, resolved at render time so it always
  // reflects the current language (the app re-renders on language change).
  const t = (key, vars) => RepCheckI18n.t(key, vars);

  const HISTORY_KEY = "repcheck_hyrox_history_v1";
  const MAX_HISTORY = 200;
  // Which gender's leaderboard to show -- persisted separately from the
  // per-race setup gender (which resets every time via resetSetup()),
  // since "which of the 4 global leaderboards am I" is a standing
  // identity, not race-to-race state. See resolveLeaderboardGender().
  const LEADERBOARD_GENDER_KEY = "repcheck_hyrox_leaderboard_gender_v1";
  // Read (not synced/owned here) for a same-session fallback gender guess
  // -- coaching.js's onboarding wizard already asked "male"/"female",
  // mapped to this app's "men"/"women" vocabulary in resolveLeaderboardGender().
  const COACHING_PROFILE_KEY = "repcheck_coaching_profile_v1";
  // One-time flag: races finished before the global leaderboard existed
  // only ever got saved to local history (HISTORY_KEY), never to the
  // server's hyrox_results table -- finishRace()/submitHyroxResult() only
  // POSTs a *new* result the moment it's finished, so anyone with older
  // history never had a chance to be counted. See backfillHistoryToServer().
  const HISTORY_SYNCED_KEY = "repcheck_hyrox_history_synced_v1";

  // ---------- Race format ----------
  // A Hyrox race is 8x 1km runs alternating with 8 functional stations.
  const STATIONS = [
    { type: "run", key: "run1" },
    { type: "station", key: "skierg", title: "SkiErg" },
    { type: "run", key: "run2" },
    { type: "station", key: "sledPush", title: "Sled Push" },
    { type: "run", key: "run3" },
    { type: "station", key: "sledPull", title: "Sled Pull" },
    { type: "run", key: "run4" },
    { type: "station", key: "burpeeBroadJump", title: "Burpee Broad Jumps" },
    { type: "run", key: "run5" },
    { type: "station", key: "row", title: "Rowing" },
    { type: "run", key: "run6" },
    { type: "station", key: "farmersCarry", title: "Farmers Carry" },
    { type: "run", key: "run7" },
    { type: "station", key: "lunges", title: "Sandbag Lunges" },
    { type: "run", key: "run8" },
    { type: "station", key: "wallBalls", title: "Wall Balls" },
  ];

  // Reference standards, by station -> gender -> category, stored as raw
  // numbers (kg, meters — never pre-built strings) so both Doubles halving
  // and the user's weight/distance unit preference can be applied at
  // render time. Run/machine distances are never touched by Doubles
  // halving — only the carried/pushed/pulled loads are.
  const STATION_SPECS = {
    skierg: { distanceM: 1000, note: "machine resistance (bodyweight)" },
    sledPush: {
      distanceM: 50,
      splitM: 12.5,
      weightKg: { men: { open: 152, pro: 202 }, women: { open: 102, pro: 152 } },
    },
    sledPull: {
      distanceM: 50,
      splitM: 12.5,
      weightKg: { men: { open: 103, pro: 152 }, women: { open: 78, pro: 103 } },
    },
    burpeeBroadJump: { distanceM: 80, note: "bodyweight" },
    row: { distanceM: 1000, note: "machine resistance (bodyweight)" },
    farmersCarry: {
      distanceM: 200,
      perHandKg: { men: { open: 24, pro: 32 }, women: { open: 16, pro: 24 } },
    },
    lunges: {
      distanceM: 100,
      sandbagKg: { men: { open: 20, pro: 30 }, women: { open: 10, pro: 20 } },
    },
    wallBalls: {
      ballKg: { men: 6, women: 4 },
      reps: { men: 100, women: 75 },
      targetFt: { men: 9, women: 8 },
    },
  };

  const STATION_ORDER = STATIONS.filter((s) => s.type === "station").map((s) => s.key);

  // Only the 4 stations whose standard actually differs between Open and
  // Pro (see STATION_SPECS above) support the Pro practice-weight
  // adjustment. SkiErg/Row/Run are excluded because they're machine/bodyweight
  // (no external load at all); Burpee Broad Jumps is bodyweight too; Wall
  // Balls' ball weight is fixed by rule and identical for Open and Pro
  // (only gender changes it) — none of those have a "Pro standard" to
  // adjust away from.
  const PRO_ADJUSTABLE_STATIONS = ["sledPush", "sledPull", "farmersCarry", "lunges"];

  // Stations you physically travel across (as opposed to machine efforts
  // like SkiErg/Row or the stationary Wall Balls). A gym's lane for each of
  // these is almost never HYROX's exact distance, so the user can enter
  // their own lane length and the app works out how many laps hit the
  // HYROX total. See getFacilityLane/roundsFor and renderTrainingSpaceCard.
  const TRAVERSAL_STATIONS = ["sledPush", "sledPull", "farmersCarry", "lunges", "burpeeBroadJump"];
  const FACILITY_LANES_KEY = "repcheck_hyrox_facility_lanes_v1";

  // The default length of one lap (start line to end line) when the user
  // hasn't measured their gym: the HYROX sled lane (12.5m) for the sleds,
  // and the full station distance for the others (i.e. one continuous
  // length by default) -- which reproduces the app's prior behavior.
  function defaultLaneM(key) {
    const spec = STATION_SPECS[key];
    if (key === "sledPush" || key === "sledPull") return spec.splitM;
    return spec.distanceM;
  }

  // Same 4 stations double as the ones whose total rounds/distance can be
  // split between a Doubles pair (see getDoublesSplit/renderDoublesSplitStep
  // below) -- SkiErg/Row/Run/Burpee Broad Jumps/Wall Balls are continuous
  // efforts without a "how many did each partner do" breakdown that means
  // anything in this app.
  function totalRoundUnits(key) {
    const spec = STATION_SPECS[key];
    if (key === "sledPush" || key === "sledPull") return Math.round(spec.distanceM / spec.splitM);
    if (key === "farmersCarry" || key === "lunges") return spec.distanceM;
    return null;
  }
  // "rounds" for the sled stations (each unit = one 12.5m split), raw
  // meters for farmers carry/lunges (they have no natural discrete round).
  function roundUnitLabel(key) {
    return (key === "sledPush" || key === "sledPull") ? t("hyrox.doublesSplit.unit.rounds") : t("hyrox.doublesSplit.unit.meters");
  }

  function getDefaultStationWeightKg(key, gender, category) {
    const spec = STATION_SPECS[key];
    if (key === "sledPush" || key === "sledPull") return spec.weightKg[gender][category];
    if (key === "farmersCarry") return spec.perHandKg[gender][category];
    if (key === "lunges") return spec.sandbagKg[gender][category];
    return null;
  }

  // A lighter practice weight means less total load moved per rep/meter,
  // so the distance is scaled up in proportion to how much lighter it is
  // (half the weight -> roughly double the distance) to keep total work
  // in the same ballpark as the real standard — then rounded up to a
  // whole number of splits so it's still a clean distance to actually
  // walk out on a track/turf lane.
  function scaledDistanceM(defaultDistanceM, defaultWeightKg, currentWeightKg, roundToM) {
    if (!currentWeightKg || currentWeightKg >= defaultWeightKg) return defaultDistanceM;
    const scaled = defaultDistanceM * (defaultWeightKg / currentWeightKg);
    return Math.ceil(scaled / roundToM) * roundToM;
  }

  // Distance/weight formatting below all funnel through RepCheckUnits so
  // Settings > Units (distance km/m, weight kg/lb) actually changes what's
  // shown here, not just on the coaching/weight-log screens.
  function formatDistanceMeters(m) {
    return RepCheckUnits.formatDistanceKm(m / 1000);
  }
  function formatWeight(kg) {
    return RepCheckUnits.formatWeightKg(kg);
  }
  function runTitle() {
    return `${formatDistanceMeters(1000)} Run`;
  }
  function stationTitle(entry) {
    return entry.type === "run" ? runTitle() : entry.title;
  }

  // Doubles pairs move the exact same weight AND the exact same total
  // rounds/distance as Singles at every station -- nothing about the
  // station's own standard changes. What's different is that the total
  // is split between two people instead of done by one -- see
  // getDoublesSplit()/renderDoublesSplitStep() below for the adjustable
  // "who does how many rounds" breakdown. (An earlier version of this
  // file halved the displayed weight, then a later one halved the
  // displayed rounds -- neither matches the real rulebook, where the
  // per-station standard itself never changes with format; see
  // hyrox.com.)

  // Real HYROX station distances (50m sled push, 200m farmers carry, ...)
  // are always stated in meters by the sport itself, regardless of a
  // user's Settings > Units km/m preference (that toggle is really about
  // the 1km runs and everyday distance display elsewhere in the app) --
  // so the weight-standards reference below deliberately doesn't route
  // these through formatDistanceMeters/RepCheckUnits, to avoid the
  // km-preference setting turning "50m" into an unreadable "0.05km" (or
  // "12.5m" into "0.0125km").
  function formatStationMeters(m) {
    return `${m}m`;
  }

  function chipHtml(value, label) {
    return `<span class="hx-standard-chip"><span class="hx-standard-chip-value">${value}</span><span class="hx-standard-chip-label">${label}</span></span>`;
  }

  // Distills each station down to the handful of numbers someone
  // actually scans for (weight / rounds / distance) as chips, a short
  // "keyFact" that's worth knowing even without expanding the row (the
  // one thing that'd surprise someone who's never done this station),
  // and a fuller plain-language paragraph for the expandable detail
  // area -- see renderWeightsCard's collapsible rows below.
  function stationStandardsSummary(key, gender, category) {
    const spec = STATION_SPECS[key];
    if (key === "skierg" || key === "row") {
      return {
        chips: chipHtml(formatStationMeters(spec.distanceM), t("hyrox.standards.chip.distance")),
        keyFact: t("hyrox.standards.keyFact.machine"),
        detail: t(`hyrox.standards.detail.${key}`),
      };
    }
    if (key === "burpeeBroadJump") {
      return {
        chips: chipHtml(formatStationMeters(spec.distanceM), t("hyrox.standards.chip.distance")),
        keyFact: t("hyrox.standards.keyFact.burpeeBroadJump"),
        detail: t("hyrox.standards.detail.burpeeBroadJump"),
      };
    }
    if (key === "sledPush" || key === "sledPull") {
      const w = spec.weightKg[gender][category];
      const rounds = totalRoundUnits(key);
      return {
        chips: chipHtml(formatWeight(w), t("hyrox.standards.chip.weight"))
          + chipHtml(rounds, t("hyrox.standards.chip.rounds"))
          + chipHtml(formatStationMeters(spec.distanceM), t("hyrox.standards.chip.distance")),
        keyFact: t("hyrox.standards.keyFact.sled"),
        detail: t(`hyrox.standards.detail.${key}`, { rounds, split: formatStationMeters(spec.splitM) }),
      };
    }
    if (key === "farmersCarry") {
      const w = spec.perHandKg[gender][category];
      return {
        chips: chipHtml(formatWeight(w), t("hyrox.standards.chip.weightPerHand"))
          + chipHtml(formatStationMeters(spec.distanceM), t("hyrox.standards.chip.distance")),
        keyFact: t("hyrox.standards.keyFact.farmersCarry"),
        detail: t("hyrox.standards.detail.farmersCarry", { weight: formatWeight(w) }),
      };
    }
    if (key === "lunges") {
      const w = spec.sandbagKg[gender][category];
      return {
        chips: chipHtml(formatWeight(w), t("hyrox.standards.chip.weight"))
          + chipHtml(formatStationMeters(spec.distanceM), t("hyrox.standards.chip.distance")),
        keyFact: t("hyrox.standards.keyFact.lunges"),
        detail: t("hyrox.standards.detail.lunges", { weight: formatWeight(w) }),
      };
    }
    // Wall Balls
    return {
      chips: chipHtml(formatWeight(spec.ballKg[gender]), t("hyrox.standards.chip.ballWeight"))
        + chipHtml(spec.reps[gender], t("hyrox.standards.chip.reps")),
      keyFact: t("hyrox.standards.keyFact.wallBalls"),
      detail: t("hyrox.standards.detail.wallBalls", { target: spec.targetFt[gender] }),
    };
  }

  // Simple line-art pictograms so brand-new users can recognize each
  // station on sight, not just read its name. Same stroke-based style as
  // the rest of RepCheck's icons, just bigger and a bit more detailed.
  const ICON_VIEWBOX = "0 0 48 48";
  const STATION_ICONS = {
    // Mid-stride runner: knee-drive front leg, trailing back leg kicked up
    // behind, arms swinging opposite the legs — the classic athletics
    // pictogram silhouette, not just abstract limb lines.
    run: `<circle cx="32" cy="8" r="3.5"/><path d="M29 11L21 22"/><path d="M21 22L29 24L32 33"/><path d="M21 22L14 25L10 16"/><path d="M29 11L22 15L18 10"/><path d="M29 11L37 14L41 11"/>`,
    // Person leaning forward mid-pull, arm extended down to a taut cable
    // running up to the pulley at the top of the machine's tall post —
    // reads as "pulling cables down", not a generic jumping-jack pose.
    skierg: `<path d="M38 2V44"/><circle cx="38" cy="4" r="2.2"/><path d="M38 4L26 25"/><circle cx="16" cy="9" r="3.5"/><path d="M17 12L21 23"/><path d="M18 15L26 25"/><path d="M21 23L16 32L13 40"/><path d="M21 23L25 32L28 40"/>`,
    sledPush: `<circle cx="10" cy="14" r="3.2"/><path d="M11 17l8 6"/><path d="M19 23l-2 8"/><path d="M19 23l6 6"/><path d="M13 18l10 2"/><rect x="28" y="18" width="14" height="10" rx="1.5"/><path d="M23 20l5 1M23 24l5 2"/>`,
    sledPull: `<circle cx="14" cy="12" r="3.2"/><path d="M14 15l3 9"/><path d="M17 24l-2 8"/><path d="M17 24l6 4"/><path d="M12 17l8-3"/><path d="M20 14l14 2"/><rect x="36" y="12" width="8" height="8" rx="1.5"/>`,
    burpeeBroadJump: `<circle cx="24" cy="10" r="3.2"/><path d="M24 13l-2 6"/><path d="M22 19l-6 4"/><path d="M22 19l7 2"/><path d="M22 19l-3 9"/><path d="M22 19l6 8"/><path d="M6 40h36" stroke-dasharray="2 4"/>`,
    row: `<path d="M4 38h40"/><circle cx="30" cy="14" r="3.2"/><path d="M30 17l-2 8"/><path d="M28 25l-10 4"/><path d="M28 25l6 6"/><path d="M28 33l-8 5"/><path d="M28 33l6 5"/><path d="M18 29l-10 2"/>`,
    farmersCarry: `<circle cx="24" cy="8" r="3.2"/><path d="M24 11v14"/><path d="M24 13l-8 2"/><path d="M24 13l8 2"/><circle cx="15" cy="24" r="3"/><circle cx="33" cy="24" r="3"/><path d="M24 25l-6 10"/><path d="M24 25l6 10"/>`,
    lunges: `<circle cx="20" cy="8" r="3.2"/><ellipse cx="28" cy="12" rx="6" ry="4" transform="rotate(20 28 12)"/><path d="M20 11v10"/><path d="M20 21l-8 6"/><path d="M12 27l2 8"/><path d="M20 21l6 4"/><path d="M26 25v9"/>`,
    wallBalls: `<path d="M40 2v40"/><circle cx="34" cy="8" r="2.5"/><circle cx="18" cy="10" r="3.2"/><path d="M18 13v8"/><path d="M18 15l-6-4"/><path d="M18 15l8-6"/><circle cx="26" cy="9" r="2.2"/><path d="M18 21l-6 8"/><path d="M18 21l7 7"/>`,
  };

  function stationIconSvg(key, size) {
    const s = size || 32;
    return `<svg width="${s}" height="${s}" viewBox="${ICON_VIEWBOX}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${STATION_ICONS[key] || STATION_ICONS.run}</svg>`;
  }

  // Demonstration videos per station -- real YouTube tutorials (verified),
  // embedded via youtube-nocookie in the station-info popup. Swap an id
  // here if a video is ever taken down or made non-embeddable.
  const STATION_VIDEOS = {
    skierg: "9RJiSvgaiJU",
    sledPush: "_gipeeBinKo",
    sledPull: "K2FhsenkS3U",
    burpeeBroadJump: "UTO-GzRXF-Q",
    row: "uwxBKQQ8_ok",
    farmersCarry: "Eve7EY5vwZQ",
    lunges: "HUAY0bM1bUE",
    wallBalls: "eVpVh2czEyI",
  };

  // Plain-language "how to perform this station" content for the popup:
  // a one-line what-it-is, three technique steps anyone can follow, and a
  // single pro tip that most saves time. Deliberately jargon-free.
  const STATION_HOWTO = {
    skierg: {
      summary: "1000m on the SkiErg machine — resistance is just your own effort, no added weight.",
      steps: [
        "Reach tall: arms fully extended overhead, grab the handles high.",
        "Drive down by hinging at your hips and crunching your core — not just yanking with your arms.",
        "Finish with hands past your hips, let the handles pull you back up to a tall reach, and repeat.",
      ],
      tip: "Long, powerful strokes at a steady rhythm beat short frantic pulls — smooth and relentless wins.",
    },
    sledPush: {
      summary: "50m pushing a heavy sled (four 12.5m lengths). The load is the hard part, not the distance.",
      steps: [
        "Set your hands low on the posts, arms straight, and get your body into a low forward angle.",
        "Drive through the balls of your feet with short, choppy, powerful steps — never let the sled stop.",
        "Push in a straight line and don't pause between lengths; momentum is everything.",
      ],
      tip: "It's a leg day, not an arm day — keep your arms locked and drive with your legs.",
    },
    sledPull: {
      summary: "50m pulling a heavy sled toward you with a rope (four 12.5m lengths).",
      steps: [
        "Sit back low, anchor your feet, keep your hips down and chest up.",
        "Pull the rope hand-over-hand using your bodyweight and legs, not just your arms.",
        "Reset your feet after each pull and stay low to keep the sled gliding.",
      ],
      tip: "Lean back and let your bodyweight do the work — the more you hang off the rope, the less your arms fry.",
    },
    burpeeBroadJump: {
      summary: "80m of burpee broad jumps: a burpee, then a forward jump, over and over.",
      steps: [
        "Drop into a burpee — chest to the floor, then explode up.",
        "Instead of jumping straight up, leap forward as far as you comfortably can.",
        "Land soft, immediately drop into the next burpee, and keep a steady rhythm.",
      ],
      tip: "Don't max out every jump — a repeatable distance keeps your heart rate down for the runs after.",
    },
    row: {
      summary: "1000m on the rowing machine — resistance is your own effort, no added weight.",
      steps: [
        "Drive with your legs first, then swing your body back, then pull the handle to your ribs.",
        "Return in the reverse order: arms away, body forward, then bend your knees.",
        "Hold a strong, steady stroke rate rather than sprinting and blowing up.",
      ],
      tip: "Legs, then body, then arms — most people over-use their arms and gas out early.",
    },
    farmersCarry: {
      summary: "200m carrying a heavy kettlebell in each hand.",
      steps: [
        "Grip both kettlebells firmly, stand tall with shoulders back and core braced.",
        "Walk with quick, controlled steps — don't shuffle or let the weights swing.",
        "Only set them down if you truly must; every drop costs you time.",
      ],
      tip: "Grip is everything — chalk up if you can, and aim for zero drops from start to finish.",
    },
    lunges: {
      summary: "100m of walking lunges with a sandbag resting across your shoulders.",
      steps: [
        "Rest the sandbag across your upper back and hold it steady.",
        "Step forward into a lunge until your back knee gently touches the floor.",
        "Drive up and forward into the next rep, keeping your chest tall.",
      ],
      tip: "Keep your steps consistent and your torso upright — leaning forward under the bag is what slows people down.",
    },
    wallBalls: {
      summary: "Throwing a weighted ball up to a target for reps — the last station before the finish.",
      steps: [
        "Hold the ball at your chest and drop into a full squat.",
        "Explode up and use that momentum to throw the ball to the target.",
        "Catch it on the way down and flow straight into the next squat.",
      ],
      tip: "Plan small sets from the very start (like 10s) — never go to failure, resting mid-set costs the most time.",
    },
  };

  // A split's stored `key` is the raw STATIONS entry key -- "run1".."run8"
  // for the 8 runs (each occurrence needs its own unique key so splits
  // stay distinguishable), or the station's real key ("skierg", etc.)
  // otherwise. STATION_ICONS only has one shared "run" entry, so every
  // "runN" collapses to that single pictogram.
  function splitIconKey(key) {
    return key && key.indexOf("run") === 0 ? "run" : key;
  }

  // Small standalone glyphs for the running-race screen -- same
  // viewBox 0 0 24 24 / stroke-2 convention already used for the friends
  // and warning icons elsewhere in this file, kept separate from the
  // bigger 48x48 station pictograms above.
  const CLOCK_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`;
  const CHECK_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  const WARNING_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a1 1 0 0 0 .86 1.5h18.64a1 1 0 0 0 .86-1.5L13.71 3.86a1 1 0 0 0-1.72 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  const TROPHY_ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4.5a2.5 2.5 0 0 0 0 5H7"/><path d="M17 6h2.5a2.5 2.5 0 0 1 0 5H17"/></svg>`;
  // Filled sparkle -- the app's "AI" motif (same shape as the Analyze
  // chatbot avatar), used on the race-analysis coaching block.
  const SPARKLE_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M11.4 3.5a.6.6 0 0 1 1.2 0l1.1 3.2a3 3 0 0 0 1.9 1.9l3.2 1.1a.6.6 0 0 1 0 1.1l-3.2 1.1a3 3 0 0 0-1.9 1.9l-1.1 3.2a.6.6 0 0 1-1.2 0l-1.1-3.2a3 3 0 0 0-1.9-1.9L5.2 11.9a.6.6 0 0 1 0-1.1l3.2-1.1a3 3 0 0 0 1.9-1.9z"/><path d="M18.5 15.5a.4.4 0 0 1 .8 0l.5 1.4a1.5 1.5 0 0 0 1 1l1.4.5a.4.4 0 0 1 0 .8l-1.4.5a1.5 1.5 0 0 0-1 1l-.5 1.4a.4.4 0 0 1-.8 0l-.5-1.4a1.5 1.5 0 0 0-1-1l-1.4-.5a.4.4 0 0 1 0-.8l1.4-.5a1.5 1.5 0 0 0 1-1z"/></svg>`;

  // Times at/under these are flagged as unrealistic (far outside what's
  // physically been achieved even at elite pro level) and excluded from
  // history rather than recorded as a legitimate result.
  const FLAG_THRESHOLD_SECONDS = {
    "men|singles": 50 * 60,
    "women|singles": 53 * 60,
    "men|doubles": 47 * 60,
    "women|doubles": 51 * 60,
  };

  // Ids only — titles/subs come from i18n at render time (hyrox.<group>.*).
  const CATEGORY_IDS = ["open", "pro"];
  const FORMAT_IDS = ["singles", "doubles"];
  const GENDER_IDS = ["men", "women"];

  function categoryTitle(id) { return t(`hyrox.category.${id}.title`); }
  function formatTitle(id) { return t(`hyrox.format.${id}.title`); }
  function genderTitle(id) { return id ? t(`hyrox.gender.${id}`) : "Mixed"; }

  // "Men Open Singles"-style combo label used on results/history/PB rows.
  function comboLabel(gender, category, format) {
    const cat = CATEGORY_IDS.includes(category) ? categoryTitle(category) : category;
    const fmt = FORMAT_IDS.includes(format) ? formatTitle(format) : (format || "Mixed Relay");
    return t("hyrox.finishLabel", { gender: genderTitle(gender), category: cat, format: fmt });
  }

  // ---------- Helpers ----------
  function formatClock(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
    const ss = String(sec).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function formatClockPrecise(totalSeconds) {
    // Same as formatClock but always mm:ss, used for short split deltas.
    const s = Math.max(0, Math.floor(totalSeconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  function el(html) {
    const wrap = document.createElement("div");
    wrap.innerHTML = html.trim();
    return wrap.firstElementChild;
  }

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  // ---------- Main controller ----------
  class HyroxApp {
    constructor(root) {
      this.root = root;
      this.history = loadJson(HISTORY_KEY, []);
      // Which stations have their detail expanded in the weight-standards
      // reference list (renderWeightsCard) -- deliberately NOT reset by
      // resetSetup/setCategory/etc, since it's just a display preference,
      // not race data; no reason a "start over" should collapse it again.
      this.expandedStandards = {};
      // Persisted standing identity for the leaderboard (see
      // resolveLeaderboardGender()) -- separate from this.gender, which
      // resetSetup() clears every time since that's per-race setup state.
      this.leaderboardGender = localStorage.getItem(LEADERBOARD_GENDER_KEY) || null;
      this.leaderboardTab = { category: "open", format: "singles" };
      this.leaderboardCache = null; // { key, loading, data|error } -- see loadLeaderboard()
      // Transient modal state (not race data, so it lives outside
      // resetSetup): which station's how-to/video popup is open, and the
      // per-race AI analysis cache keyed by race id (see loadRaceAnalysis).
      this.stationInfo = null;
      this.detailRaceId = null; // which history race's detail modal is open
      // Per-station gym lane lengths (start->end distance the user measured
      // at their facility), keyed by station. A property of the user's gym,
      // NOT of any one race, so it persists across races and is never reset
      // by resetSetup(). Kept local (not account-synced) since it's tied to
      // wherever the user physically trains.
      this.facilityLanes = loadJson(FACILITY_LANES_KEY, {}) || {};
      this.analysisCache = {}; // raceId -> { loading, data|error }
      // Which analysis sections are expanded to their full bullet-point
      // detail, keyed "raceId:section" (section = "overall" or a rating
      // group name) -- collapsed (short only) by default for every race.
      this.analysisExpanded = new Set();
      this.resetSetup();

      this.root.addEventListener("click", (event) => this.handleClick(event));
      this.root.addEventListener("change", (event) => this.handleChange(event));
      // Re-render on language change so all dynamically-built text switches.
      // Skip while a race is actively running so the live timer isn't reset.
      document.addEventListener("repcheck:language-changed", () => {
        if (this.screen !== "running") this.render();
      });
      // Same idea for units (weight kg/lb, distance km/m) — station
      // specs and race titles re-render in whatever was just chosen.
      document.addEventListener("repcheck:units-changed", () => {
        if (this.screen !== "running") this.render();
      });
      this.render();
      this.backfillHistoryToServer();
    }

    // One-time: send each combo's best already-saved local race (from
    // before the leaderboard existed, or from a submission that failed at
    // the time) to the server so it actually counts. Only the fastest
    // per gender/category/format combo is sent -- get_hyrox_leaderboard()
    // takes each user's MIN(total_seconds) per combo anyway, so sending
    // every historical entry would just be redundant rows.
    //
    // The "already done" flag itself (HISTORY_SYNCED_KEY) is a synced key
    // (see SYNC_KEYS in account_sync.js) specifically so this can't
    // re-fire per browser origin -- this app is reachable at multiple
    // equivalent origins (localhost/127.0.0.1/a LAN IP, see
    // account_sync.js's own header comment), and a plain unsynced
    // localStorage flag would look "not yet backfilled" again on each one,
    // re-submitting the same race every time.
    async backfillHistoryToServer() {
      if (!window.REPCHECK_LOGGED_IN) return;
      if (localStorage.getItem(HISTORY_SYNCED_KEY)) return;
      if (!this.history.length) {
        localStorage.setItem(HISTORY_SYNCED_KEY, "1");
        return;
      }
      const bestByCombo = new Map();
      this.history.forEach((record) => {
        if (record.flagged) return; // never send unrealistic times to the leaderboard
        const key = this.pbKeyFor(record.category, record.format, record.gender);
        const existing = bestByCombo.get(key);
        if (!existing || record.totalSeconds < existing.totalSeconds) bestByCombo.set(key, record);
      });
      try {
        await Promise.all(Array.from(bestByCombo.values()).map((record) => fetch("/api/hyrox/results", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gender: record.gender,
            category: record.category,
            format: record.format,
            total_seconds: record.totalSeconds,
          }),
        })));
        localStorage.setItem(HISTORY_SYNCED_KEY, "1");
        // Whatever's currently cached/showing is now stale.
        this.leaderboardCache = null;
        this.render();
      } catch (err) {
        // Leave the flag unset so this retries on the next page load.
      }
    }

    resetSetup() {
      this.screen = "setup";
      this.category = null;
      this.format = null;
      this.gender = null;
      this.stationIndex = 0;
      this.splits = [];
      this.startTime = null;
      this.tickHandle = null;
      this.elapsedSeconds = 0;
      this.finishedResult = null;
      // Pro-only practice weight overrides, keyed by station -- see
      // PRO_ADJUSTABLE_STATIONS/getStationWeight. Cleared here and whenever
      // category/gender changes because the standard they're relative to
      // changes with them.
      this.stationWeights = {};
      // Doubles-only "how many rounds am I doing" overrides, keyed by
      // station -- see getDoublesSplit/renderDoublesSplitStep. Defaults to
      // an even split until touched, so nothing here needs to key off
      // gender/category (the totals don't vary with them).
      this.doublesSplit = {};
    }

    saveHistory() {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history.slice(-MAX_HISTORY)));
    }

    // ---------- Derived state ----------
    // Both remaining formats (Singles, Doubles) race a gendered standard,
    // so this just means "a format has been picked yet".
    needsGender() {
      return !!this.format;
    }

    canStart() {
      if (!this.category || !this.format) return false;
      if (this.needsGender() && !this.gender) return false;
      return true;
    }

    flagKeyFor(format, gender) {
      return `${gender}|${format}`;
    }

    // ---------- Personal bests ----------
    // A "personal best" is scoped to one exact category+format+gender
    // combo — a Pro Singles time isn't comparable to an Open Doubles
    // time, so mixing them into one overall PB would be meaningless.
    pbKeyFor(category, format, gender) {
      return `${category}|${format}|${gender}`;
    }

    getPersonalBest(category, format, gender) {
      const key = this.pbKeyFor(category, format, gender);
      let best = null;
      this.history.forEach((r) => {
        if (r.flagged) return; // flagged (unrealistic) times never count as a PB
        if (this.pbKeyFor(r.category, r.format, r.gender) !== key) return;
        if (!best || r.totalSeconds < best.totalSeconds) best = r;
      });
      return best;
    }

    // One row per combo the user has ever completed, fastest time (and
    // the day it happened) for each — used on the history screen. Flagged
    // (unrealistic) times are excluded, same as getPersonalBest above.
    getAllPersonalBests() {
      const bestByKey = new Map();
      this.history.forEach((r) => {
        if (r.flagged) return;
        const key = this.pbKeyFor(r.category, r.format, r.gender);
        const existing = bestByKey.get(key);
        if (!existing || r.totalSeconds < existing.totalSeconds) bestByKey.set(key, r);
      });
      return Array.from(bestByKey.values()).sort((a, b) => a.totalSeconds - b.totalSeconds);
    }

    // ---------- Event handling ----------
    handleClick(event) {
      const target = event.target.closest("[data-action]");
      if (!target) return;
      const action = target.dataset.action;

      if (action === "set-category") return this.setCategory(target.dataset.value);
      if (action === "set-format") return this.setFormat(target.dataset.value);
      if (action === "set-gender") return this.setGender(target.dataset.value);
      if (action === "start-race") return this.startRace();
      if (action === "complete-segment") return this.completeSegment();
      if (action === "cancel-race") return this.cancelRace();
      if (action === "new-race") return this.resetToSetup();
      if (action === "show-history") return this.showHistory();
      if (action === "back-to-setup") return this.resetToSetup();
      if (action === "remove-history") return this.removeHistory(target.dataset.id);
      if (action === "reset-station-weight") return this.resetStationWeight(target.dataset.station);
      if (action === "reset-doubles-split") return this.resetDoublesSplit(target.dataset.station);
      if (action === "toggle-standard-detail") return this.toggleStandardDetail(target.dataset.station);
      if (action === "show-leaderboard") return this.showLeaderboard();
      if (action === "set-leaderboard-gender") return this.setLeaderboardGender(target.dataset.value);
      if (action === "set-leaderboard-tab") return this.setLeaderboardTab(target.dataset.category, target.dataset.format);
      if (action === "show-station-info") return this.showStationInfo(target.dataset.station);
      if (action === "close-station-info") return this.closeStationInfo();
      if (action === "show-race-detail") return this.showRaceDetail(target.dataset.id);
      if (action === "close-race-detail") return this.closeRaceDetail();
      if (action === "analyze-race") return this.loadRaceAnalysis(target.dataset.id, true);
      if (action === "toggle-analysis-detail") return this.toggleAnalysisDetail(target.dataset.id, target.dataset.section);
      if (action === "reset-facility-lane") return this.resetFacilityLane(target.dataset.station);
    }

    // ---------- AI analysis: short/detail toggle ----------
    toggleAnalysisDetail(raceId, section) {
      const key = `${raceId}:${section}`;
      if (this.analysisExpanded.has(key)) this.analysisExpanded.delete(key);
      else this.analysisExpanded.add(key);
      this.render();
    }

    // ---------- Station info popup (how-to + demo video) ----------
    showStationInfo(key) {
      this.stationInfo = key;
      this.render();
    }

    closeStationInfo() {
      this.stationInfo = null;
      this.render();
    }

    handleChange(event) {
      const weightInput = event.target.closest("[data-station-weight-input]");
      if (weightInput) return this.setStationWeight(weightInput.dataset.station, weightInput.value);
      const splitInput = event.target.closest("[data-doubles-round-input]");
      if (splitInput) return this.setDoublesSplit(splitInput.dataset.station, splitInput.value);
      const splitPartnerInput = event.target.closest("[data-doubles-round-partner-input]");
      if (splitPartnerInput) return this.setDoublesSplitPartner(splitPartnerInput.dataset.station, splitPartnerInput.value);
      const laneInput = event.target.closest("[data-facility-lane-input]");
      if (laneInput) return this.setFacilityLane(laneInput.dataset.station, laneInput.value);
    }

    setCategory(value) {
      this.category = value;
      this.stationWeights = {};
      this.render();
    }

    setFormat(value) {
      this.format = value;
      this.doublesSplit = {}; // switching formats invalidates any "my rounds" split
      this.render();
    }

    setGender(value) {
      this.gender = value;
      this.stationWeights = {};
      this.render();
    }

    // ---------- Pro practice-weight adjustment ----------
    // Only meaningful in the Pro category (see PRO_ADJUSTABLE_STATIONS) --
    // Open racers, and non-adjustable stations, always just get the
    // official standard.
    getStationWeight(key) {
      const defaultW = getDefaultStationWeightKg(key, this.gender, this.category);
      if (defaultW === null) return null;
      // Guards against stale state, not just gates the UI: if a lighter
      // weight was set while in Pro Singles and the user then switches to
      // Doubles (Step 4 disappears, but this.stationWeights isn't
      // cleared), this makes sure that leftover custom weight still never
      // silently applies -- Doubles always gets the fixed standard.
      if (this.category !== "pro" || this.format !== "singles") return defaultW;
      const custom = this.stationWeights[key];
      return (typeof custom === "number" && custom > 0 && custom <= defaultW) ? custom : defaultW;
    }

    setStationWeight(key, rawValue) {
      const defaultW = getDefaultStationWeightKg(key, this.gender, this.category);
      if (defaultW === null || this.category !== "pro") return;
      let w = parseFloat(rawValue);
      if (!isFinite(w) || w <= 0) w = defaultW;
      // Race weight is only ever the standard or lighter here -- this tool
      // isn't for planning an overload standard heavier than Pro. Floor at
      // 10% of standard so the distance-scaling math never blows up.
      w = Math.min(w, defaultW);
      w = Math.max(w, Math.round(defaultW * 0.1 * 10) / 10);
      this.stationWeights[key] = Math.round(w * 10) / 10;
      this.render();
    }

    resetStationWeight(key) {
      delete this.stationWeights[key];
      this.render();
    }

    // ---------- Doubles round split ----------
    // Only meaningful in Doubles (see PRO_ADJUSTABLE_STATIONS, reused here
    // as the set of stations with a splittable total). Defaults to an even
    // split of the fixed total until the user overrides "my rounds" --
    // the partner's share is always just whatever's left.
    getDoublesSplit(key) {
      const total = totalRoundUnits(key);
      if (total === null) return null;
      const stored = this.doublesSplit[key];
      const mine = (typeof stored === "number" && stored >= 0 && stored <= total) ? stored : Math.round(total / 2);
      return { total, mine, partner: total - mine };
    }

    setDoublesSplit(key, rawValue) {
      const total = totalRoundUnits(key);
      if (total === null || this.format !== "doubles") return;
      let v = Math.round(parseFloat(rawValue));
      if (!isFinite(v) || v < 0) v = 0;
      v = Math.min(v, total);
      this.doublesSplit[key] = v;
      this.render();
    }

    // The partner's box is just as editable as "you" -- typing a partner
    // count sets "mine" to whatever's left of the fixed total, the same
    // relationship as the other direction in setDoublesSplit() above.
    setDoublesSplitPartner(key, rawValue) {
      const total = totalRoundUnits(key);
      if (total === null || this.format !== "doubles") return;
      let partner = Math.round(parseFloat(rawValue));
      if (!isFinite(partner) || partner < 0) partner = 0;
      partner = Math.min(partner, total);
      this.doublesSplit[key] = total - partner;
      this.render();
    }

    resetDoublesSplit(key) {
      delete this.doublesSplit[key];
      this.render();
    }

    // ---------- Facility lane distance (gym-specific) ----------
    getFacilityLane(key) {
      const v = this.facilityLanes[key];
      return (typeof v === "number" && v > 0) ? v : defaultLaneM(key);
    }

    setFacilityLane(key, rawValue) {
      const v = parseFloat(rawValue);
      if (!isFinite(v) || v <= 0) {
        delete this.facilityLanes[key];
      } else {
        // Clamp to something sane: no gym lane is longer than the full
        // station distance (that would just be one lap) or shorter than 1m.
        const capped = Math.min(v, STATION_SPECS[key].distanceM);
        this.facilityLanes[key] = Math.max(1, Math.round(capped * 100) / 100);
      }
      localStorage.setItem(FACILITY_LANES_KEY, JSON.stringify(this.facilityLanes));
      this.render();
    }

    resetFacilityLane(key) {
      delete this.facilityLanes[key];
      localStorage.setItem(FACILITY_LANES_KEY, JSON.stringify(this.facilityLanes));
      this.render();
    }

    // The distance actually to be covered at a station, in meters -- the
    // HYROX standard, scaled UP if a lighter Pro practice weight is set
    // (see scaledDistanceM). Guards against gender/category not being
    // chosen yet so it's safe to call from the setup card.
    effectiveDistanceM(key) {
      const spec = STATION_SPECS[key];
      if (!this.gender || !this.category) return spec.distanceM;
      const defaultW = getDefaultStationWeightKg(key, this.gender, this.category);
      if (defaultW === null) return spec.distanceM; // burpees etc. -- no weight to scale by
      const w = this.getStationWeight(key);
      const roundToM = (key === "sledPush" || key === "sledPull") ? spec.splitM : 10;
      return scaledDistanceM(spec.distanceM, defaultW, w, roundToM);
    }

    // How many laps of the user's gym lane it takes to cover the station's
    // distance -- "first line to last line and back counts as one lap."
    // e.g. an 80m station in a 10m lane => 8 laps.
    roundsFor(key) {
      return Math.max(1, Math.ceil(this.effectiveDistanceM(key) / this.getFacilityLane(key)));
    }

    // ---------- Weight-standards reference list (renderWeightsCard) ----------
    toggleStandardDetail(key) {
      this.expandedStandards[key] = !this.expandedStandards[key];
      this.render();
    }

    resetToSetup() {
      this.stopTicking();
      this.resetSetup();
      this.render();
    }

    showHistory() {
      this.stopTicking();
      this.screen = "history";
      this.render();
    }

    removeHistory(id) {
      this.history = this.history.filter((r) => r.id !== id);
      this.saveHistory();
      this.render();
    }

    // ---------- Leaderboard ----------
    // Which of the 4 (open/pro x singles/doubles) global leaderboards a
    // user sees is scoped to one gender only -- resolved in this order:
    // an explicit leaderboard-gender choice (persisted), else whatever
    // gender they most recently raced under this session, else the
    // gender from their coaching profile (onboarding already asked),
    // else null -- renderLeaderboard() asks once and persists the answer.
    resolveLeaderboardGender() {
      if (this.leaderboardGender) return this.leaderboardGender;
      if (this.gender) return this.gender;
      const profile = loadJson(COACHING_PROFILE_KEY, null);
      if (profile && profile.gender) {
        return profile.gender === "female" ? "women" : "men";
      }
      return null;
    }

    // render() triggers loadLeaderboard() itself whenever the setup or
    // leaderboard screen is showing (see render()), so none of these need
    // to call it directly -- just update state and re-render.
    setLeaderboardGender(value) {
      this.leaderboardGender = value;
      localStorage.setItem(LEADERBOARD_GENDER_KEY, value);
      this.leaderboardCache = null;
      this.render();
    }

    setLeaderboardTab(category, format) {
      this.leaderboardTab = { category, format };
      this.render();
    }

    showLeaderboard() {
      this.stopTicking();
      this.screen = "leaderboard";
      this.render();
    }

    async loadLeaderboard() {
      const gender = this.resolveLeaderboardGender();
      if (!gender) return; // renderLeaderboard() shows the one-time gender picker instead
      const { category, format } = this.leaderboardTab;
      const key = `${gender}|${category}|${format}`;
      if (this.leaderboardCache && this.leaderboardCache.key === key) return; // already loaded/loading

      this.leaderboardCache = { key, loading: true };
      this.render();
      try {
        const response = await fetch(`/api/hyrox/leaderboard?gender=${gender}&category=${category}&format=${format}`);
        const data = await response.json();
        if (!data.ok) throw new Error(data.error || "Failed to load leaderboard.");
        // The leaderboard is shown (and can be navigated away from) on
        // both the setup screen (embedded) and its own standalone screen
        // -- bail only if neither is showing anymore, or a newer request
        // for a different tab/gender has since superseded this one.
        const stillShowing = this.screen === "setup" || this.screen === "leaderboard";
        if (!stillShowing || (this.leaderboardCache && this.leaderboardCache.key !== key)) return;
        this.leaderboardCache = { key, loading: false, data };
      } catch (err) {
        this.leaderboardCache = { key, loading: false, error: true };
      }
      this.render();
    }

    // ---------- Race flow ----------
    startRace() {
      if (!this.canStart()) return;
      this.screen = "running";
      this.stationIndex = 0;
      this.splits = [];
      this.startTime = performance.now();
      this.elapsedSeconds = 0;
      this.startTicking();
      this.render();
    }

    startTicking() {
      this.stopTicking();
      this.tickHandle = setInterval(() => {
        this.elapsedSeconds = (performance.now() - this.startTime) / 1000;
        this.updateTimerDisplay();
      }, 200);
    }

    stopTicking() {
      if (this.tickHandle) {
        clearInterval(this.tickHandle);
        this.tickHandle = null;
      }
    }

    // Cheap DOM patch for the ticking clock so the whole page doesn't
    // re-render 5x/second.
    updateTimerDisplay() {
      const timerEl = this.root.querySelector("[data-timer-display]");
      if (timerEl) timerEl.textContent = formatClock(this.elapsedSeconds);
    }

    completeSegment() {
      if (this.screen !== "running") return;
      const segment = STATIONS[this.stationIndex];
      const now = (performance.now() - this.startTime) / 1000;
      this.splits.push({ key: segment.key, title: stationTitle(segment), atSeconds: now });

      if (this.stationIndex >= STATIONS.length - 1) {
        this.finishRace(now);
        return;
      }
      this.stationIndex += 1;
      this.render();
    }

    finishRace(totalSeconds) {
      this.stopTicking();
      const flagged = totalSeconds <= (FLAG_THRESHOLD_SECONDS[this.flagKeyFor(this.format, this.gender)] || Infinity);
      const priorPb = this.getPersonalBest(this.category, this.format, this.gender);
      const isNewPb = !flagged && (!priorPb || totalSeconds < priorPb.totalSeconds);

      const record = {
        id: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
        date: new Date().toISOString(),
        category: this.category,
        format: this.format,
        gender: this.gender,
        totalSeconds,
        splits: this.splits,
        flagged,
        isNewPb,
        analysis: null, // filled in by loadRaceAnalysis() and persisted
      };

      // EVERY finished race is now saved to history (with its total time and
      // per-station splits), including flagged ones -- flagged just stay out
      // of the leaderboard/PB and aren't AI-coached (their splits aren't a
      // real performance). getPersonalBest/getAllPersonalBests/backfill all
      // skip flagged, so junk times can't become a "best" or hit the board.
      this.history.push(record);
      this.saveHistory();
      if (!flagged) {
        this.submitHyroxResult(record);
      }

      this.finishedResult = record;
      this.screen = "finished";
      this.render();

      // Run the race analysis right away for realistic races so it's shown
      // on the finish screen without a tap and saved into history for later.
      if (!flagged) {
        this.loadRaceAnalysis(record.id, true);
      }
    }

    // Mirrors the record into the server-side hyrox_results table so it
    // can count on the global leaderboard -- this.history/localStorage
    // above is the source of truth for "my saved times" (unaffected if
    // this fails), this is purely the leaderboard's copy.
    async submitHyroxResult(record) {
      if (!window.REPCHECK_LOGGED_IN) return;
      // Whatever gender was just raced under becomes the standing
      // leaderboard identity too, same as picking it anywhere else.
      this.leaderboardGender = record.gender;
      localStorage.setItem(LEADERBOARD_GENDER_KEY, record.gender);
      try {
        await fetch("/api/hyrox/results", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gender: record.gender,
            category: record.category,
            format: record.format,
            total_seconds: record.totalSeconds,
          }),
        });
      } catch (err) {
        // Local history already has it -- a failed sync just means this
        // run won't count on the global leaderboard until the next one.
      }
    }

    cancelRace() {
      this.stopTicking();
      this.resetSetup();
      this.render();
    }

    // ---------- Rendering ----------
    render() {
      this.root.innerHTML = "";
      let view;
      if (this.screen === "setup") view = this.renderSetup();
      else if (this.screen === "running") view = this.renderRunning();
      else if (this.screen === "finished") view = this.renderFinished();
      else if (this.screen === "history") view = this.renderHistory();
      else if (this.screen === "leaderboard") view = this.renderLeaderboard();
      this.root.appendChild(view);
      // Transient overlays sit on top of whatever screen is showing.
      if (this.stationInfo) this.root.appendChild(this.renderStationInfoModal());
      if (this.detailRaceId) this.root.appendChild(this.renderRaceDetailModal());
      // The setup screen now shows the leaderboard inline (see
      // renderSetup()), so it needs the same data-load trigger the
      // standalone leaderboard screen gets -- loadLeaderboard() is a
      // no-op if the current gender/category/format combo is already
      // loaded or loading, so this is safe to call on every render.
      if (this.screen === "setup" || this.screen === "leaderboard") this.loadLeaderboard();
    }

    // ---------- Station info popup (how-to + demo video) ----------
    renderStationInfoModal() {
      const key = this.stationInfo;
      const howto = STATION_HOWTO[key];
      const title = (STATIONS.find((s) => s.key === key) || {}).title || key;
      const videoId = STATION_VIDEOS[key];
      const overlay = el(`
        <div class="hx-modal-overlay">
          <div class="hx-modal hx-station-modal">
            <div class="hx-modal-head">
              <div class="hx-modal-head-title">
                <span class="hx-modal-head-icon">${stationIconSvg(key, 26)}</span>
                <span>${title}</span>
              </div>
              <button type="button" class="hx-modal-close" data-action="close-station-info" aria-label="${t("common.close")}">&times;</button>
            </div>
            <div class="hx-modal-body">
              ${videoId ? `
                <div class="hx-video-wrap">
                  <iframe src="https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1" title="${title} demo" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>
                </div>
              ` : ""}
              ${howto ? `
                <div class="hx-howto-summary">${howto.summary}</div>
                <div class="hx-howto-label">${t("hyrox.howto.stepsLabel")}</div>
                <ol class="hx-howto-steps">
                  ${howto.steps.map((s) => `<li>${s}</li>`).join("")}
                </ol>
                <div class="hx-howto-tip">
                  <span class="hx-howto-tip-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2Z"/></svg></span>
                  <span><strong>${t("hyrox.howto.tipLabel")}</strong> ${howto.tip}</span>
                </div>
              ` : ""}
            </div>
          </div>
        </div>
      `);
      // Close only when the backdrop itself is clicked -- a blanket
      // stopPropagation on the card would swallow the delegated clicks of
      // action buttons inside it (Analyze, etc.).
      overlay.addEventListener("click", (e) => { if (e.target === overlay) this.closeStationInfo(); });
      return overlay;
    }

    // ---------- Race detail modal (history) ----------
    showRaceDetail(raceId) {
      this.detailRaceId = raceId;
      this.render();
    }

    closeRaceDetail() {
      this.detailRaceId = null;
      this.render();
    }

    renderRaceDetailModal() {
      const race = this.findRace(this.detailRaceId);
      if (!race) return el(`<div style="display:none;"></div>`);
      const combo = comboLabel(race.gender, race.category, race.format);
      const dateLabel = new Date(race.date).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

      const overlay = el(`
        <div class="hx-modal-overlay">
          <div class="hx-modal hx-detail-modal">
            <div class="hx-modal-head">
              <div class="hx-detail-head-main">
                <div class="hx-detail-head-time">${formatClock(race.totalSeconds)}</div>
                <div class="hx-detail-head-meta"><span class="hx-history-tag">${combo}</span> · ${dateLabel}</div>
              </div>
              <button type="button" class="hx-modal-close" data-action="close-race-detail" aria-label="${t("common.close")}">&times;</button>
            </div>
            <div class="hx-modal-body">
              <div id="hx-detail-breakdown"></div>
              <div id="hx-detail-analysis"></div>
            </div>
          </div>
        </div>
      `);
      overlay.addEventListener("click", (e) => { if (e.target === overlay) this.closeRaceDetail(); });
      overlay.querySelector("#hx-detail-breakdown").appendChild(this.renderRaceBreakdown(race));
      overlay.querySelector("#hx-detail-analysis").appendChild(this.renderRaceAnalysis(race));
      return overlay;
    }

    renderSetup() {
      const wrap = el(`<div></div>`);
      // Leaderboard first thing on the page -- no click needed to see
      // where you stand, same content as the standalone "Leaderboard"
      // screen (see renderLeaderboardCard) just without its own back
      // button since it's already sitting on the setup page.
      wrap.appendChild(this.renderLeaderboardCard(false));
      wrap.appendChild(this.renderStationGuide());
      wrap.appendChild(this.renderTrainingSpaceCard());

      const card = el(`
        <div class="hx-card">
          <div class="hx-step-label">${t("hyrox.step.category")}</div>
          <div class="hx-choice-grid" data-group="category"></div>
          <div class="hx-step-label">${t("hyrox.step.format")}</div>
          <div class="hx-choice-grid" data-group="format"></div>
          <div id="hx-gender-block"></div>
          <div id="hx-pro-adjust-block"></div>
          <div style="display:flex; align-items:center; flex-wrap:wrap; gap:12px; margin-top:6px;">
            <button type="button" class="hx-primary-btn" data-action="start-race" ${this.canStart() ? "" : "disabled"}>${t("hyrox.startRace")}</button>
            <button type="button" class="hx-secondary-btn" data-action="show-history">${t("hyrox.viewHistory")}</button>
          </div>
        </div>
      `);

      const categoryGrid = card.querySelector('[data-group="category"]');
      CATEGORY_IDS.forEach((id) => {
        categoryGrid.appendChild(el(`
          <button type="button" class="hx-choice-card ${this.category === id ? "is-selected" : ""}" data-action="set-category" data-value="${id}">
            <div class="hx-choice-title">${t(`hyrox.category.${id}.title`)}</div>
          </button>
        `));
      });

      const formatGrid = card.querySelector('[data-group="format"]');
      FORMAT_IDS.forEach((id) => {
        formatGrid.appendChild(el(`
          <button type="button" class="hx-choice-card ${this.format === id ? "is-selected" : ""}" data-action="set-format" data-value="${id}">
            <div class="hx-choice-title">${t(`hyrox.format.${id}.title`)}</div>
          </button>
        `));
      });

      const genderBlock = card.querySelector("#hx-gender-block");
      if (this.needsGender()) {
        genderBlock.appendChild(el(`<div class="hx-step-label">${t("hyrox.step.gender")}</div>`));
        const genderGrid = el(`<div class="hx-choice-grid" data-group="gender"></div>`);
        GENDER_IDS.forEach((id) => {
          genderGrid.appendChild(el(`
            <button type="button" class="hx-choice-card ${this.gender === id ? "is-selected" : ""}" data-action="set-gender" data-value="${id}">
              <div class="hx-choice-title">${t(`hyrox.gender.${id}`)}</div>
            </button>
          `));
        });
        genderBlock.appendChild(genderGrid);
      }

      // Weight practice-adjustment is Singles-only: in Doubles the weight
      // is never yours alone to lighten -- it's the shared, fixed
      // standard, and what a Doubles pair actually controls is how they
      // split the (also fixed) rounds between themselves, not the load.
      // That split gets its own step instead, for either category.
      const proAdjustBlock = card.querySelector("#hx-pro-adjust-block");
      if (this.gender && this.format === "singles" && this.category === "pro") {
        proAdjustBlock.appendChild(this.renderProAdjustStep());
      } else if (this.gender && this.format === "doubles") {
        proAdjustBlock.appendChild(this.renderDoublesSplitStep());
      } else if (this.gender && this.format === "singles" && this.category === "open") {
        proAdjustBlock.appendChild(this.renderOpenStandardsStep());
      }

      const startRow = card.querySelector('[data-action="start-race"]').parentElement;
      if (this.canStart()) {
        const pb = this.getPersonalBest(this.category, this.format, this.gender);
        if (pb) {
          const dateLabel = new Date(pb.date).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
          startRow.insertAdjacentElement("beforebegin", el(`
            <div class="hx-pb-banner">
              <div class="hx-pb-banner-label">${t("hyrox.pb.setupLabel", { combo: comboLabel(this.gender, this.category, this.format) })}</div>
              <div class="hx-pb-banner-time">${formatClock(pb.totalSeconds)}<span class="hx-pb-banner-date">${t("hyrox.pb.setDate", { date: dateLabel })}</span></div>
            </div>
          `));
        }
      }

      wrap.appendChild(card);
      if (this.category && this.gender) {
        wrap.appendChild(this.renderWeightsCard());
      }
      return wrap;
    }

    // Step 4, Pro-only: a focused view of just the 4 stations whose weight
    // can be practiced lighter (see PRO_ADJUSTABLE_STATIONS), leading with
    // the number that actually matters day-to-day -- how many rounds that
    // buys you -- instead of burying it in the full 8-station reference
    // table below.
    renderProAdjustStep() {
      const wrap = el(`<div></div>`);
      wrap.appendChild(el(`<div class="hx-step-label">${t("hyrox.step.proWeights")}</div>`));
      wrap.appendChild(el(`
        <div class="hx-race-fixed-banner">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a1 1 0 0 0 .86 1.5h18.64a1 1 0 0 0 .86-1.5L13.71 3.86a1 1 0 0 0-1.72 0z"/></svg>
          <div>${t("hyrox.weightAdjust.raceFixedWarning")}</div>
        </div>
      `));

      const grid = el(`<div class="hx-pro-weight-grid"></div>`);
      PRO_ADJUSTABLE_STATIONS.forEach((key) => {
        const spec = STATION_SPECS[key];
        const title = STATIONS.find((s) => s.key === key).title;
        const defaultW = getDefaultStationWeightKg(key, this.gender, this.category);
        const currentW = this.getStationWeight(key);
        const minW = Math.round(defaultW * 0.1 * 10) / 10;
        // Only the sled stations have a real "rounds" count -- Farmers
        // Carry and Sandbag Lunges are one continuous carry, so what a
        // lighter practice weight buys you there is less *distance*, not
        // fewer "rounds" (see renderOpenStandardsStep()'s comment for the
        // same distinction on the read-only Open version of this screen).
        const isSledStation = key === "sledPush" || key === "sledPull";
        const roundToM = isSledStation ? spec.splitM : 10;
        const baseAmount = isSledStation ? Math.round(spec.distanceM / roundToM) : spec.distanceM;
        const dist = scaledDistanceM(spec.distanceM, defaultW, currentW, roundToM);
        const amount = isSledStation ? Math.round(dist / roundToM) : Math.round(dist);
        const amountLabel = isSledStation ? t("hyrox.weightAdjust.roundsLabel") : t("hyrox.weightAdjust.distanceLabel");
        const amountValue = isSledStation ? amount : `${amount}m`;
        const baseAmountLabel = isSledStation
          ? t("hyrox.weightAdjust.roundsBase", { n: baseAmount })
          : t("hyrox.weightAdjust.distanceBase", { n: baseAmount });
        const isScaled = currentW < defaultW;

        grid.appendChild(el(`
          <div class="hx-pro-weight-row">
            <div class="hx-pro-weight-icon">${stationIconSvg(key, 32)}</div>
            <div class="hx-pro-weight-info">
              <div class="hx-pro-weight-title">${title}</div>
            </div>
            <div class="hx-pro-weight-stat hx-pro-weight-stat-editable ${isScaled ? "is-scaled" : ""}">
              <input type="number" inputmode="decimal" step="0.5" min="${minW}" max="${defaultW}" value="${currentW}" data-station-weight-input data-station="${key}" class="hx-pro-weight-stat-input">
              <div class="hx-pro-weight-stat-label">${t("hyrox.weightAdjust.weightLabel")} (kg)</div>
              ${isScaled ? `<button type="button" class="hx-weight-reset" data-action="reset-station-weight" data-station="${key}">${t("hyrox.weightAdjust.reset")}</button>` : ""}
            </div>
            <div class="hx-pro-weight-stat ${isScaled ? "is-scaled" : ""}">
              <div class="hx-pro-weight-stat-value">${amountValue}</div>
              <div class="hx-pro-weight-stat-label">${amountLabel}</div>
              ${isScaled ? `<div class="hx-pro-weight-stat-base">${baseAmountLabel}</div>` : ""}
            </div>
          </div>
        `));
      });
      wrap.appendChild(grid);
      return wrap;
    }

    // Doubles-only, either category: same layout as renderProAdjustStep
    // above (icon, title, standard reference line, an input) but the
    // number being adjusted is "how many rounds am I doing" instead of
    // weight -- the weight is fixed (shown as its own prominent, but
    // unadjustable, stat box) and what's actually editable is how the
    // rounds split between the two of you. Leads with three large,
    // side-by-side stat boxes (weight / you / your partner) so the full
    // commitment -- how much load, how many rounds each -- is impossible
    // to miss, not just clauses in a sentence.
    renderDoublesSplitStep() {
      const wrap = el(`<div></div>`);
      wrap.appendChild(el(`<div class="hx-step-label">${t("hyrox.step.doublesSplit")}</div>`));
      wrap.appendChild(el(`
        <div class="hx-race-fixed-banner hx-doubles-banner">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <div>${t("hyrox.doublesSplit.intro")}</div>
        </div>
      `));

      const grid = el(`<div class="hx-pro-weight-grid"></div>`);
      PRO_ADJUSTABLE_STATIONS.forEach((key) => {
        const title = STATIONS.find((s) => s.key === key).title;
        const standardW = getDefaultStationWeightKg(key, this.gender, this.category);
        const split = this.getDoublesSplit(key);
        const unit = roundUnitLabel(key);
        const isUneven = split.mine !== split.total - split.mine;

        grid.appendChild(el(`
          <div class="hx-pro-weight-row">
            <div class="hx-pro-weight-icon">${stationIconSvg(key, 32)}</div>
            <div class="hx-pro-weight-info">
              <div class="hx-pro-weight-title">${title}</div>
            </div>
            <div class="hx-pro-weight-stat">
              <div class="hx-pro-weight-stat-value">${formatWeight(standardW)}</div>
              <div class="hx-pro-weight-stat-label">${t("hyrox.weightAdjust.weightLabel")}</div>
            </div>
            <div class="hx-pro-weight-stat hx-pro-weight-stat-editable ${isUneven ? "is-scaled" : ""}">
              <input type="number" inputmode="numeric" step="1" min="0" max="${split.total}" value="${split.mine}" data-doubles-round-input data-station="${key}" class="hx-pro-weight-stat-input">
              <div class="hx-pro-weight-stat-label">${t("hyrox.doublesSplit.you")} (${unit})</div>
            </div>
            <div class="hx-pro-weight-stat hx-pro-weight-stat-editable">
              <input type="number" inputmode="numeric" step="1" min="0" max="${split.total}" value="${split.partner}" data-doubles-round-partner-input data-station="${key}" class="hx-pro-weight-stat-input">
              <div class="hx-pro-weight-stat-label">${t("hyrox.doublesSplit.partner")} (${unit})</div>
              ${isUneven ? `<button type="button" class="hx-weight-reset" data-action="reset-doubles-split" data-station="${key}">${t("hyrox.weightAdjust.reset")}</button>` : ""}
            </div>
          </div>
        `));
      });
      wrap.appendChild(grid);
      return wrap;
    }

    // Open Singles: same at-a-glance layout as renderProAdjustStep (icon,
    // title, standard line, big weight + rounds numbers) but read-only
    // end to end -- Open has no practice-lighter-weight option, so
    // there's nothing to input, just the fixed weight and fixed rounds
    // for each of the 4 weighted stations, shown with the same
    // prominence Pro Singles gets instead of only being buried in the
    // reference table below.
    renderOpenStandardsStep() {
      const wrap = el(`<div></div>`);
      wrap.appendChild(el(`<div class="hx-step-label">${t("hyrox.step.openStandards")}</div>`));

      const grid = el(`<div class="hx-pro-weight-grid"></div>`);
      PRO_ADJUSTABLE_STATIONS.forEach((key) => {
        const spec = STATION_SPECS[key];
        const title = STATIONS.find((s) => s.key === key).title;
        const defaultW = getDefaultStationWeightKg(key, this.gender, this.category);
        // Only the sled stations actually have a "rounds" count (50m
        // covered as fixed-length reps) -- Farmers Carry and Sandbag
        // Lunges are a single continuous carry, so totalRoundUnits() just
        // returns their raw meters, which read as a bogus 200/100
        // "rounds to do" if labeled the same way. Show those as distance
        // instead, matching how the Weight Standards reference list
        // below already tells them apart (stationStandardsSummary()).
        const isSledStation = key === "sledPush" || key === "sledPull";
        const amount = isSledStation ? totalRoundUnits(key) : spec.distanceM;
        const amountLabel = isSledStation ? t("hyrox.weightAdjust.roundsLabel") : t("hyrox.weightAdjust.distanceLabel");
        const amountValue = isSledStation ? amount : `${amount}m`;

        grid.appendChild(el(`
          <div class="hx-pro-weight-row">
            <div class="hx-pro-weight-icon">${stationIconSvg(key, 32)}</div>
            <div class="hx-pro-weight-info">
              <div class="hx-pro-weight-title">${title}</div>
            </div>
            <div class="hx-pro-weight-stat">
              <div class="hx-pro-weight-stat-value">${formatWeight(defaultW)}</div>
              <div class="hx-pro-weight-stat-label">${t("hyrox.weightAdjust.weightLabel")}</div>
            </div>
            <div class="hx-pro-weight-stat">
              <div class="hx-pro-weight-stat-value">${amountValue}</div>
              <div class="hx-pro-weight-stat-label">${amountLabel}</div>
            </div>
          </div>
        `));
      });
      wrap.appendChild(grid);
      return wrap;
    }

    renderStationGuide() {
      // A first-look reference for anyone new to Hyrox: what the race
      // actually consists of, before they've even picked a category.
      const card = el(`
        <div class="hx-card">
          <div class="hx-step-label">${t("hyrox.stationGuide.title")}</div>
          <div class="hx-guide-intro">
            ${t("hyrox.stationGuide.intro")}
          </div>
          <div class="hx-guide-grid" data-guide-grid></div>
        </div>
      `);

      const grid = card.querySelector("[data-guide-grid]");
      STATION_ORDER.forEach((key, i) => {
        const title = STATIONS.find((s) => s.key === key).title;
        grid.appendChild(el(`
          <button type="button" class="hx-guide-item" data-action="show-station-info" data-station="${key}">
            <div class="hx-guide-icon">${stationIconSvg(key, 40)}</div>
            <div class="hx-guide-index">${i + 1}</div>
            <div class="hx-guide-title">${title}</div>
            <div class="hx-guide-play">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </div>
          </button>
        `));
      });

      return card;
    }

    // "Your training space": let the user tell the app how long each
    // travelling station's lane is at their own gym, and show how many
    // laps that means to cover the HYROX distance. Distances shown in
    // meters (HYROX's own unit), not the km/mi Settings preference.
    renderTrainingSpaceCard() {
      const card = el(`
        <div class="hx-card">
          <div class="hx-step-label">${t("hyrox.space.title")}</div>
          <div class="hx-guide-intro">${t("hyrox.space.intro")}</div>
          <div class="hx-space-tip">
            <span class="hx-space-tip-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2Z"/></svg></span>
            <span>${t("hyrox.space.tip")}</span>
          </div>
          <div class="hx-space-list" data-space-list></div>
        </div>
      `);

      const listEl = card.querySelector("[data-space-list]");
      TRAVERSAL_STATIONS.forEach((key) => {
        const title = STATIONS.find((s) => s.key === key).title;
        const lane = this.getFacilityLane(key);
        const totalM = Math.round(this.effectiveDistanceM(key));
        const rounds = this.roundsFor(key);
        const isCustom = typeof this.facilityLanes[key] === "number" && this.facilityLanes[key] > 0;

        listEl.appendChild(el(`
          <div class="hx-space-row">
            <div class="hx-space-row-head">
              <span class="hx-space-icon">${stationIconSvg(key, 26)}</span>
              <span class="hx-space-name">${title}</span>
              ${isCustom ? `<button type="button" class="hx-weight-reset hx-space-reset" data-action="reset-facility-lane" data-station="${key}">${t("hyrox.weightAdjust.reset")}</button>` : ""}
            </div>
            <div class="hx-space-row-body">
              <label class="hx-space-field">
                <span class="hx-space-field-label">${t("hyrox.space.laneLabel")}</span>
                <span class="hx-space-input-wrap">
                  <input type="number" inputmode="decimal" step="0.5" min="1" max="${STATION_SPECS[key].distanceM}" value="${lane}" data-facility-lane-input data-station="${key}" class="hx-space-input">
                  <span class="hx-space-input-unit">m</span>
                </span>
              </label>
              <div class="hx-space-result">
                <div class="hx-space-result-item">
                  <span class="hx-space-result-value">${totalM}m</span>
                  <span class="hx-space-result-label">${t("hyrox.space.total")}</span>
                </div>
                <span class="hx-space-times">×</span>
                <div class="hx-space-result-item is-rounds">
                  <span class="hx-space-result-value">${rounds}</span>
                  <span class="hx-space-result-label">${t("hyrox.space.laps", { n: rounds })}</span>
                </div>
              </div>
            </div>
          </div>
        `));
      });

      return card;
    }

    // Read-only reference for the *official* standard (deliberately not
    // getStationWeight() -- a Pro practice adjustment or a Doubles round
    // split are personal-to-this-session choices with their own loud
    // display in Step 4 above; this card answers "what's normal" instead,
    // so it always shows the plain standard regardless of anything
    // adjusted up there). Rows are collapsible: weight/rounds/distance
    // chips plus one short "keyFact" (the one thing worth knowing even
    // without opening the row) always show up front, and the fuller
    // paragraph (splits, kettlebell count, target height, ...) only
    // appears once expanded, so the list reads as a scannable set of
    // numbers first, not a wall of prose, while still surfacing the
    // single most useful fact before anyone taps anything.
    renderWeightsCard() {
      const rows = STATION_ORDER.map((key) => {
        const title = STATIONS.find((s) => s.key === key).title;
        const summary = stationStandardsSummary(key, this.gender, this.category);
        const isOpen = !!this.expandedStandards[key];
        return `
          <div class="hx-standard-row">
            <button type="button" class="hx-standard-row-head" data-action="toggle-standard-detail" data-station="${key}" aria-expanded="${isOpen}">
              <span class="hx-standard-row-top">
                <span class="hx-standard-icon">${stationIconSvg(key, 26)}</span>
                <span class="hx-standard-title">${title}</span>
                <span class="hx-standard-chevron ${isOpen ? "is-open" : ""}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                </span>
              </span>
              <span class="hx-standard-chips">${summary.chips}</span>
              ${summary.keyFact ? `<span class="hx-standard-key-fact">${summary.keyFact}</span>` : ""}
            </button>
            <div class="hx-standard-detail" ${isOpen ? "" : 'style="display:none;"'}>${summary.detail}</div>
          </div>
        `;
      }).join("");

      return el(`
        <div class="hx-card">
          <div class="hx-step-label">${t("hyrox.weightsTitle", { category: categoryTitle(this.category), gender: genderTitle(this.gender) })}</div>
          <div class="hx-standards-list">${rows}</div>
          <div class="hx-weights-note">${t("hyrox.weightsNote.default")}</div>
        </div>
      `);
    }

    // Structured "what to do right now" for the running screen: clear
    // stat chips (total distance in meters, how many laps of the user's
    // gym lane, and the load) instead of one run-on sentence.
    stationNowChipsHtml(key) {
      const spec = STATION_SPECS[key];
      const chip = (value, label, cls) => `<div class="hx-now-chip ${cls || ""}"><span class="hx-now-chip-value">${value}</span><span class="hx-now-chip-label">${label}</span></div>`;

      if (key === "wallBalls") {
        return `<div class="hx-now-chips">
          ${chip(spec.reps[this.gender], t("hyrox.space.chip.reps"))}
          ${chip(formatWeight(spec.ballKg[this.gender]), t("hyrox.space.chip.ball"))}
          ${chip(`${spec.targetFt[this.gender]}ft`, t("hyrox.space.chip.target"))}
        </div>`;
      }
      if (key === "skierg" || key === "row") {
        return `<div class="hx-now-chips">
          ${chip(formatStationMeters(spec.distanceM), t("hyrox.space.chip.distance"))}
          ${chip(t("hyrox.space.chip.machineVal"), t("hyrox.space.chip.resistance"))}
        </div>`;
      }

      // Travelling stations: total distance + laps of the gym lane + load.
      const totalM = Math.round(this.effectiveDistanceM(key));
      const lane = this.getFacilityLane(key);
      const rounds = this.roundsFor(key);
      const chips = [
        chip(formatStationMeters(totalM), t("hyrox.space.chip.distance")),
        chip(`${rounds}×`, t("hyrox.space.chip.lapsOf", { lane: formatStationMeters(lane) }), "is-rounds"),
      ];
      const w = this.getStationWeight(key);
      if (w) {
        let label = t("hyrox.space.chip.load");
        if (key === "sledPush" || key === "sledPull") label = t("hyrox.space.chip.sled");
        else if (key === "farmersCarry") label = t("hyrox.space.chip.perHand");
        else if (key === "lunges") label = t("hyrox.space.chip.sandbag");
        chips.push(chip(formatWeight(w), label));
      }
      const note = rounds > 1 ? `<div class="hx-now-note">${t("hyrox.space.lapNote")}</div>` : "";
      return `<div class="hx-now-chips">${chips.join("")}</div>${note}`;
    }

    renderRunning() {
      const segment = STATIONS[this.stationIndex];
      const isLast = this.stationIndex >= STATIONS.length - 1;
      const detailHtml = segment.type === "station"
        ? this.stationNowChipsHtml(segment.key)
        : `<div class="hx-now-detail">${t("hyrox.running.runDetail")}</div>`;
      const iconKey = segment.type === "station" ? segment.key : "run";
      const progressPct = Math.round((this.stationIndex / STATIONS.length) * 100);

      const card = el(`
        <div class="hx-card hx-run-card">
          <div class="hx-run-head">
            <div class="hx-run-stat">
              <span class="hx-run-stat-value" data-timer-display>${formatClock(this.elapsedSeconds)}</span>
              <span class="hx-run-stat-label">${t("hyrox.running.elapsed")}</span>
            </div>
            <div class="hx-run-stat">
              <span class="hx-run-stat-value hx-run-count">${this.stationIndex + 1}<span class="hx-run-count-total">/${STATIONS.length}</span></span>
              <span class="hx-run-stat-label">${t("hyrox.running.segmentLabel")}</span>
            </div>
          </div>

          <div class="hx-now">
            <div class="hx-now-kicker">${t("hyrox.running.upNow")}</div>
            <div class="hx-now-badge">${stationIconSvg(iconKey, 48)}</div>
            <div class="hx-now-title">${stationTitle(segment)}</div>
            ${detailHtml}
            ${segment.type === "station" ? `
              <button type="button" class="hx-now-info" data-action="show-station-info" data-station="${segment.key}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                ${t("hyrox.running.howTo")}
              </button>
            ` : ""}
          </div>

          <div class="hx-run-progress"><div class="hx-run-progress-fill" style="width:${progressPct}%"></div></div>
          <div class="hx-progress-dots" data-dots></div>

          <button type="button" class="hx-complete-btn" data-action="complete-segment">
            <span class="hx-complete-btn-icon">${CHECK_ICON}</span>
            <span>${isLast ? t("hyrox.finishRace") : (segment.type === "run" ? t("hyrox.complete.run") : t("hyrox.complete.station"))}</span>
          </button>

          <button type="button" class="hx-danger-link hx-run-cancel" data-action="cancel-race">${t("hyrox.cancelThisRace")}</button>

          <div class="hx-splits-list" data-splits></div>
        </div>
      `);

      const dotsEl = card.querySelector("[data-dots]");
      STATIONS.forEach((s, i) => {
        const cls = i < this.stationIndex ? "is-done" : i === this.stationIndex ? "is-current" : "";
        dotsEl.appendChild(el(`<div class="hx-progress-dot ${cls}" title="${stationTitle(s)}"></div>`));
      });

      const splitsEl = card.querySelector("[data-splits]");
      this.splits.slice().reverse().forEach((s, i) => {
        const idx = this.splits.length - i;
        const prev = this.splits[idx - 2];
        const delta = prev ? s.atSeconds - prev.atSeconds : s.atSeconds;
        splitsEl.appendChild(el(`
          <div class="hx-split-row">
            <span class="hx-split-row-name"><span class="hx-split-row-check">${CHECK_ICON}</span>${s.title}</span>
            <span>+${formatClockPrecise(delta)} · ${formatClock(s.atSeconds)}</span>
          </div>
        `));
      });

      return card;
    }

    // ---------- Shared race breakdown + AI analysis ----------
    // Splits store cumulative "seconds into the race"; the time actually
    // spent ON a given segment is the gap from the previous split.
    segmentDurations(result) {
      const splits = (result && result.splits) || [];
      return splits.map((s, i) => {
        const prev = splits[i - 1];
        const seconds = prev ? s.atSeconds - prev.atSeconds : s.atSeconds;
        const isRun = String(s.key).indexOf("run") === 0;
        return { key: s.key, title: s.title, type: isRun ? "run" : "station", seconds };
      });
    }

    findRace(raceId) {
      if (this.finishedResult && this.finishedResult.id === raceId) return this.finishedResult;
      return this.history.find((r) => r.id === raceId) || null;
    }

    // Fetches Gemini's per-station coaching for one race, cached by race id
    // so re-opening a race (or re-rendering) never re-hits the API. `force`
    // is the explicit "Analyze"/"try again" tap.
    // Seeds the in-memory analysis cache from an analysis already saved on
    // the race record (see loadRaceAnalysis's persistence below), so
    // reopening a past race from history shows its coaching instantly with
    // no re-fetch. Also lets the breakdown bars tint by rating right away.
    hydrateAnalysisFromRecord(race) {
      if (!race || this.analysisCache[race.id] || !race.analysis) return;
      const tipsByKey = {};
      (race.analysis.tips || []).forEach((tip) => { if (tip && tip.key) tipsByKey[tip.key] = tip; });
      this.analysisCache[race.id] = {
        data: {
          overall: race.analysis.overall,
          overallDetail: race.analysis.overallDetail || [],
          tips: race.analysis.tips || [],
          tipsByKey,
        },
      };
    }

    loadRaceAnalysis(raceId, force) {
      const race = this.findRace(raceId);
      // Flagged races (total below the physically-realistic threshold)
      // never get analyzed -- coaching on made-up splits is noise, and
      // renderRaceAnalysis shows a disabled note instead of the CTA.
      if (!race || race.flagged) return;
      this.hydrateAnalysisFromRecord(race);
      const existing = this.analysisCache[raceId];
      if (existing && existing.data && !force) return;
      if (existing && existing.loading) return;

      this.analysisCache[raceId] = { loading: true };
      this.render();

      fetch("/api/hyrox/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          race: {
            category: race.category,
            format: race.format,
            gender: race.gender,
            total_seconds: race.totalSeconds,
            segments: this.segmentDurations(race),
          },
        }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (!data.ok) throw new Error("failed");
          const tipsByKey = {};
          (data.tips || []).forEach((tip) => { if (tip && tip.key) tipsByKey[tip.key] = tip; });
          const analysis = {
            overall: data.overall,
            overallDetail: data.overall_detail || [],
            tips: data.tips || [],
          };
          this.analysisCache[raceId] = { data: { ...analysis, tipsByKey } };
          // Persist the coaching onto the saved race so it survives page
          // reloads and shows up when the race is reopened from history,
          // instead of being re-fetched every time.
          const saved = this.findRace(raceId);
          if (saved) { saved.analysis = analysis; this.saveHistory(); }
          this.render();
        })
        .catch(() => {
          this.analysisCache[raceId] = { error: true };
          this.render();
        });
    }

    // Horizontal time bars, one per segment in race order, so the shape of
    // where the time went is visible at a glance -- runs muted, stations
    // bold, and once the AI has run each station tints by its rating
    // (green = strong, amber = focus). Returns an element.
    renderRaceBreakdown(result) {
      this.hydrateAnalysisFromRecord(result);
      const segs = this.segmentDurations(result);
      const maxSeconds = Math.max(1, ...segs.map((s) => s.seconds));
      const runTotal = segs.filter((s) => s.type === "run").reduce((a, b) => a + b.seconds, 0);
      const stationTotal = segs.filter((s) => s.type === "station").reduce((a, b) => a + b.seconds, 0);
      const cache = this.analysisCache[result.id];
      const tipsByKey = (cache && cache.data && cache.data.tipsByKey) || {};

      const rowsHtml = segs.map((s) => {
        const rating = s.type === "station" && tipsByKey[s.key] ? tipsByKey[s.key].rating : "";
        const pct = Math.max(4, Math.round((s.seconds / maxSeconds) * 100));
        return `
          <div class="hx-bd-row hx-bd-${s.type} ${rating ? "hx-bd-rate-" + rating : ""}">
            <span class="hx-bd-icon">${stationIconSvg(splitIconKey(s.key), 15)}</span>
            <span class="hx-bd-name">${s.title}</span>
            <span class="hx-bd-track"><span class="hx-bd-fill" style="width:${pct}%"></span></span>
            <span class="hx-bd-time">${formatClockPrecise(s.seconds)}</span>
          </div>
        `;
      }).join("");

      return el(`
        <div class="hx-breakdown">
          <div class="hx-bd-title">${t("hyrox.breakdown.title")}</div>
          <div class="hx-bd-totals">
            <div class="hx-bd-total hx-bd-total-run">
              <span class="hx-bd-total-value">${formatClock(runTotal)}</span>
              <span class="hx-bd-total-label">${t("hyrox.breakdown.running")}</span>
            </div>
            <div class="hx-bd-total hx-bd-total-station">
              <span class="hx-bd-total-value">${formatClock(stationTotal)}</span>
              <span class="hx-bd-total-label">${t("hyrox.breakdown.stations")}</span>
            </div>
          </div>
          <div class="hx-bd-rows">${rowsHtml}</div>
        </div>
      `);
    }

    // The AI coaching block: a CTA until analyzed, a spinner while loading,
    // then the overall read + tips grouped by rating (biggest time-gains
    // first, then strengths, then the already-solid rest) so the list
    // reads as a priority order, not 8 identical boxes. Returns an element.
    renderRaceAnalysis(result) {
      // A flagged race's splits aren't a real performance, so there's
      // nothing honest to coach -- the whole feature is disabled for it.
      if (result.flagged) {
        return el(`
          <div class="hx-analyze-disabled">
            <span class="hx-analyze-disabled-icon">${SPARKLE_ICON}</span>
            <span>${t("hyrox.analysis.unavailableFlagged")}</span>
          </div>
        `);
      }

      this.hydrateAnalysisFromRecord(result);
      const cache = this.analysisCache[result.id];

      // No analysis yet (e.g. an older saved race from before auto-analysis,
      // or the finish-screen request hasn't kicked off): start it now so
      // every real race ends up with coaching, no tap required. Deferred to
      // a microtask so it doesn't re-enter render() while we're mid-render.
      if (!cache) {
        Promise.resolve().then(() => this.loadRaceAnalysis(result.id, true));
        return el(`<div class="hx-analyze-loading"><span class="hx-analyze-spinner"></span>${t("hyrox.analysis.loading")}</div>`);
      }
      if (cache.loading) {
        return el(`<div class="hx-analyze-loading"><span class="hx-analyze-spinner"></span>${t("hyrox.analysis.loading")}</div>`);
      }
      if (cache.error) {
        return el(`
          <button type="button" class="hx-analyze-cta is-error" data-action="analyze-race" data-id="${result.id}">
            <span class="hx-analyze-cta-icon">${SPARKLE_ICON}</span>
            <span class="hx-analyze-cta-text"><span class="hx-analyze-cta-title">${t("hyrox.analysis.error")}</span></span>
          </button>
        `);
      }

      const data = cache.data;
      const tips = (data.tips || []).filter((tip) => tip && tip.tip);
      const groups = [
        { rating: "focus", tips: tips.filter((x) => x.rating === "focus") },
        { rating: "strong", tips: tips.filter((x) => x.rating === "strong") },
        { rating: "solid", tips: tips.filter((x) => x.rating !== "focus" && x.rating !== "strong") },
      ].filter((g) => g.tips.length);

      const expandKey = (section) => `${result.id}:${section}`;
      const isExpanded = (section) => this.analysisExpanded.has(expandKey(section));

      // Every section (overall + each rating group) is short-by-default
      // with its own expand toggle; expanding reveals the fuller
      // bullet-point detail Gemini wrote specifically for that purpose
      // (overallDetail / each tip's detail), not a re-formatting of the
      // short text.
      const toggleBtnHtml = (section, hasDetail) => {
        if (!hasDetail) return "";
        const open = isExpanded(section);
        return `
          <button type="button" class="hx-detail-toggle" data-action="toggle-analysis-detail" data-id="${result.id}" data-section="${section}" aria-expanded="${open}">
            <span>${t(open ? "hyrox.analysis.showLess" : "hyrox.analysis.readMore")}</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="hx-detail-toggle-chevron ${open ? "is-open" : ""}"><path d="M6 9l6 6 6-6"/></svg>
          </button>
        `;
      };
      const bulletsHtml = (bullets) => `<ul class="hx-bullet-list">${bullets.map((b) => `<li>${b}</li>`).join("")}</ul>`;

      const overallHtml = data.overall ? `
        <div class="hx-analysis-overall-block">
          <div class="hx-analysis-overall">${data.overall}</div>
          ${isExpanded("overall") && data.overallDetail.length ? bulletsHtml(data.overallDetail) : ""}
          ${toggleBtnHtml("overall", data.overallDetail.length > 0)}
        </div>
      ` : "";

      const groupsHtml = groups.map((g) => {
        const groupOpen = isExpanded(g.rating);
        return `
        <div class="hx-tip-group hx-tip-group-${g.rating}">
          <div class="hx-tip-group-label"><span class="hx-tip-group-dot"></span>${t("hyrox.analysis.group." + g.rating)}</div>
          ${g.tips.map((tip) => {
            const title = (STATIONS.find((s) => s.key === tip.key) || {}).title || tip.key;
            return `
              <div class="hx-tip-row">
                <span class="hx-tip-icon">${stationIconSvg(tip.key, 16)}</span>
                <div class="hx-tip-body">
                  <div class="hx-tip-name">${title}</div>
                  <div class="hx-tip-text">${tip.tip}</div>
                  ${groupOpen && tip.detail && tip.detail.length ? bulletsHtml(tip.detail) : ""}
                </div>
              </div>
            `;
          }).join("")}
          ${toggleBtnHtml(g.rating, g.tips.some((tip) => tip.detail && tip.detail.length))}
        </div>
      `;
      }).join("");

      return el(`
        <div class="hx-analysis">
          <div class="hx-analysis-head">
            <span class="hx-analysis-head-icon">${SPARKLE_ICON}</span>
            <span>${t("hyrox.analysis.title")}</span>
          </div>
          ${overallHtml}
          ${groupsHtml}
        </div>
      `);
    }

    renderFinished() {
      const result = this.finishedResult;
      const combo = comboLabel(result.gender, result.category, result.format);
      // Hero badge/icon match whichever banner is about to show below it --
      // same "unrealistic time -> red warning", "new best -> gold trophy",
      // "normal result -> green check" story told twice, once at a glance
      // and once in the actual text.
      const heroState = result.flagged ? "flagged" : result.isNewPb ? "pb" : "saved";
      const heroIcon = result.flagged ? WARNING_ICON : result.isNewPb ? TROPHY_ICON : CHECK_ICON;

      const card = el(`
        <div class="hx-card">
          <div class="hx-finish-hero">
            <div class="hx-finish-hero-icon is-${heroState}">${heroIcon}</div>
            <div class="hx-finish-time">${formatClock(result.totalSeconds)}</div>
            <div class="hx-finish-label">${combo}</div>
          </div>
          <div id="hx-flag-slot"></div>
          <div id="hx-breakdown-slot"></div>
          <div id="hx-analysis-slot"></div>
          <div class="hx-finish-actions">
            <button type="button" class="hx-finish-primary-btn" data-action="new-race">${t("hyrox.logAnother")}</button>
            <div class="hx-finish-actions-row">
              <button type="button" class="hx-secondary-btn" data-action="show-history">${t("hyrox.viewHistory")}</button>
              <button type="button" class="hx-secondary-btn" data-action="show-leaderboard">${t("hyrox.leaderboard.button")}</button>
            </div>
          </div>
        </div>
      `);

      const flagSlot = card.querySelector("#hx-flag-slot");
      if (result.flagged) {
        flagSlot.appendChild(el(`
          <div class="hx-flag-banner"><span class="hx-banner-icon">${WARNING_ICON}</span><span>${t("hyrox.flagged", { combo })}</span></div>
        `));
      } else if (result.isNewPb) {
        flagSlot.appendChild(el(`
          <div class="hx-pb-new-banner"><span class="hx-banner-icon">${TROPHY_ICON}</span><span>${t("hyrox.pb.new", { combo })}</span></div>
        `));
      } else {
        flagSlot.appendChild(el(`<div class="hx-saved-banner"><span class="hx-banner-icon">${CHECK_ICON}</span><span>${t("hyrox.saved")}</span></div>`));
      }

      card.querySelector("#hx-breakdown-slot").appendChild(this.renderRaceBreakdown(result));
      card.querySelector("#hx-analysis-slot").appendChild(this.renderRaceAnalysis(result));

      return card;
    }

    renderPersonalBests() {
      const bests = this.getAllPersonalBests();
      if (!bests.length) return null;

      const card = el(`
        <div class="hx-card">
          <div class="hx-step-label">${t("hyrox.pb.sectionTitle")}</div>
          <div data-pb-list></div>
        </div>
      `);
      const listEl = card.querySelector("[data-pb-list]");
      bests.forEach((r) => {
        const dateLabel = new Date(r.date).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
        listEl.appendChild(el(`
          <div class="hx-pb-row">
            <div class="hx-pb-row-time">${formatClock(r.totalSeconds)}</div>
            <div class="hx-history-meta">
              <span class="hx-history-tag">${comboLabel(r.gender, r.category, r.format)}</span>
              <div style="margin-top:4px;">${t("hyrox.pb.setPrefix", { date: dateLabel })}</div>
            </div>
          </div>
        `));
      });
      return card;
    }

    // Four separate global leaderboards -- open/pro x singles/doubles --
    // all scoped to one gender (see resolveLeaderboardGender()), never
    // mixed together, same reasoning as pbKeyFor(): a Pro Singles time
    // isn't comparable to an Open Doubles one. Shared by the standalone
    // "Leaderboard" screen (showBackButton=true, reachable from the
    // finished screen) and the setup screen's embedded copy at the very
    // top of the page (showBackButton=false) -- same content either way.
    renderLeaderboardCard(showBackButton) {
      const gender = this.resolveLeaderboardGender();
      const backBtnHtml = showBackButton
        ? `<button type="button" class="hx-secondary-btn" data-action="back-to-setup" style="margin-top:14px;">${t("hyrox.backToSetup")}</button>`
        : "";

      if (!gender) {
        const card = el(`
          <div class="hx-card">
            <div class="hx-step-label">${t("hyrox.leaderboard.pickGenderTitle")}</div>
            <div class="hx-choice-grid" data-group="leaderboard-gender"></div>
            ${backBtnHtml}
          </div>
        `);
        const genderGrid = card.querySelector('[data-group="leaderboard-gender"]');
        GENDER_IDS.forEach((id) => {
          genderGrid.appendChild(el(`
            <button type="button" class="hx-choice-card" data-action="set-leaderboard-gender" data-value="${id}">
              <div class="hx-choice-title">${genderTitle(id)}</div>
            </button>
          `));
        });
        return card;
      }

      const tabs = [
        { category: "open", format: "singles" },
        { category: "pro", format: "singles" },
        { category: "open", format: "doubles" },
        { category: "pro", format: "doubles" },
      ];
      const activeTab = this.leaderboardTab;

      const card = el(`
        <div class="hx-card">
          <div class="hx-lb-header">
            <div class="hx-lb-caption">${t("hyrox.leaderboard.headerCaption", { gender: genderTitle(gender) })}</div>
            <div class="hx-lb-gender-toggle" data-lb-gender-toggle></div>
          </div>
          <div class="hx-lb-tabs" data-lb-tabs></div>
          <div data-lb-list></div>
          <div data-lb-me></div>
          ${backBtnHtml}
        </div>
      `);

      const genderToggleEl = card.querySelector("[data-lb-gender-toggle]");
      GENDER_IDS.forEach((id) => {
        genderToggleEl.appendChild(el(`
          <button type="button" class="hx-lb-gender-btn ${id === gender ? "is-active" : ""}" data-action="set-leaderboard-gender" data-value="${id}" aria-label="${t("hyrox.leaderboard.switchTo", { gender: genderTitle(id) })}">${genderTitle(id)}</button>
        `));
      });

      const tabsEl = card.querySelector("[data-lb-tabs]");
      tabs.forEach((tab) => {
        const isActive = tab.category === activeTab.category && tab.format === activeTab.format;
        tabsEl.appendChild(el(`
          <button type="button" class="hx-lb-tab ${isActive ? "is-active" : ""}" data-action="set-leaderboard-tab" data-category="${tab.category}" data-format="${tab.format}">
            ${formatTitle(tab.format)} · ${categoryTitle(tab.category)}
          </button>
        `));
      });

      const listEl = card.querySelector("[data-lb-list]");
      const meEl = card.querySelector("[data-lb-me]");
      const cache = this.leaderboardCache;
      const key = `${gender}|${activeTab.category}|${activeTab.format}`;

      if (!cache || cache.key !== key || cache.loading) {
        listEl.appendChild(el(`<div class="hx-history-empty">${t("common.loading")}</div>`));
      } else if (cache.error) {
        listEl.appendChild(el(`<div class="hx-history-empty">${t("hyrox.leaderboard.loadError")}</div>`));
      } else {
        const rows = cache.data.leaderboard;
        const totalEntries = cache.data.totalEntries;
        if (!rows.length) {
          listEl.appendChild(el(`<div class="hx-history-empty">${t("hyrox.leaderboard.empty")}</div>`));
        } else {
          const myRank = cache.data.me ? cache.data.me.rank : null;
          rows.forEach((r, i) => {
            const rank = i + 1;
            listEl.appendChild(el(`
              <div class="hx-lb-entry-row ${rank === myRank ? "is-me" : ""}">
                <div class="hx-lb-entry-left">
                  <div class="hx-lb-entry-time">${formatClock(r.best_seconds)}</div>
                  <div class="hx-lb-entry-name">${r.name}</div>
                </div>
                <div class="hx-lb-entry-right">
                  <div class="hx-lb-entry-rank">#${rank}</div>
                  <div class="hx-lb-entry-total">${t("hyrox.leaderboard.of", { n: totalEntries })}</div>
                </div>
              </div>
            `));
          });
        }

        if (cache.data.me && !rows.some((r, i) => i + 1 === cache.data.me.rank)) {
          // Only needed as a fallback for when "you" aren't in the visible
          // rows above (outside the top 50) -- otherwise your own row
          // already appears in the list itself, styled identically via
          // .is-me, so this stays a plain, no-decoration row, not a
          // separate "special" card design.
          const me = cache.data.me;
          meEl.appendChild(el(`
            <div class="hx-lb-entry-row is-me">
              <div class="hx-lb-entry-left">
                <div class="hx-lb-entry-time">${formatClock(me.best_seconds)}</div>
                <div class="hx-lb-entry-name">${me.name}</div>
              </div>
              <div class="hx-lb-entry-right">
                <div class="hx-lb-entry-rank">#${me.rank}</div>
                <div class="hx-lb-entry-total">${t("hyrox.leaderboard.of", { n: totalEntries })}</div>
              </div>
            </div>
          `));
        } else if (!cache.data.me) {
          meEl.appendChild(el(`<div class="hx-lb-me-banner is-empty">${t("hyrox.leaderboard.notCompeted")}</div>`));
        }
      }

      return card;
    }

    renderLeaderboard() {
      return this.renderLeaderboardCard(true);
    }

    renderHistory() {
      // Every finished race is saved here now, including flagged
      // (unrealistically fast) ones -- those get a subtle marker below and
      // are already kept out of the PBs/leaderboard by getPersonalBest etc.
      const wrap = el(`<div></div>`);
      const pbCard = this.renderPersonalBests();
      if (pbCard) wrap.appendChild(pbCard);

      const card = el(`
        <div class="hx-card">
          <div class="hx-step-label">${t("hyrox.savedTimes")}</div>
          <div data-history-list></div>
          <button type="button" class="hx-secondary-btn" data-action="back-to-setup" style="margin-top:14px;">${t("hyrox.backToSetup")}</button>
        </div>
      `);

      const listEl = card.querySelector("[data-history-list]");
      const rows = this.history.slice().sort((a, b) => new Date(b.date) - new Date(a.date));

      if (!rows.length) {
        listEl.appendChild(el(`<div class="hx-history-empty">${t("hyrox.nothingYet")}</div>`));
      } else {
        rows.forEach((r) => {
          const dateLabel = new Date(r.date).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
          // The whole row opens the per-station breakdown + AI detail; the
          // nested × still removes (closest [data-action] resolves to it
          // first). role/tabindex so it's a real, keyboard-reachable button.
          listEl.appendChild(el(`
            <div class="hx-history-row is-clickable ${r.flagged ? "is-flagged" : ""}" data-action="show-race-detail" data-id="${r.id}" role="button" tabindex="0">
              <div class="hx-history-time">${formatClock(r.totalSeconds)}</div>
              <div class="hx-history-meta">
                <span class="hx-history-tag">${comboLabel(r.gender, r.category, r.format)}</span>
                <div style="margin-top:4px;">${dateLabel}${r.flagged ? ` · <span class="hx-history-flagged">${t("hyrox.history.flagged")}</span>` : ""}</div>
              </div>
              <span class="hx-history-chevron"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span>
              <button type="button" class="hx-history-remove" data-action="remove-history" data-id="${r.id}" aria-label="Remove">&times;</button>
            </div>
          `));
        });
      }

      wrap.appendChild(card);
      return wrap;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const root = document.getElementById("hyrox-root");
    if (root) new HyroxApp(root);
  });
})();
