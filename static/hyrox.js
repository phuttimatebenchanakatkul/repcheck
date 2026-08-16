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
  // Read (not synced/owned here). coaching.js's onboarding wizard already
  // asked "male"/"female" -- profileGender() maps that to this app's
  // "men"/"women" vocabulary, both for race setup's own gender (no longer
  // asked here at all, see resetSetup()) and as a leaderboard fallback.
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

  // ---------- Custom race builder ----------
  // A user-assembled race: any of these building blocks, any number of
  // times, in any order, each with its own editable amount (meters, or
  // reps for Wall Balls -- the one station HYROX itself never measures in
  // distance). "run" isn't in STATIONS as its own station entry (runs are
  // the run1..run8 filler between stations there), so it's listed here
  // explicitly as its own insertable block.
  const CUSTOM_STATION_KEYS = ["run", "skierg", "sledPush", "sledPull", "burpeeBroadJump", "row", "farmersCarry", "lunges", "wallBalls"];

  // The stations whose amount is a lane-traversed distance rather than a
  // fixed course (as opposed to Run/SkiErg/Row, which cover their meters
  // continuously on a track or machine, or Wall Balls, which has no
  // distance at all) -- same set the standard race already treats this way
  // (see PRO_ADJUSTABLE_STATIONS/roundsFor below), reused here so a custom
  // race's running screen can convert their configured meters into "how
  // many lengths of your lane" once the race actually starts.
  const CUSTOM_ROUND_BASED_KEYS = ["sledPush", "sledPull", "burpeeBroadJump", "farmersCarry", "lunges"];

  // Display name per key, reused as-is (not translated) for both the
  // standard agenda and the custom builder -- same convention STATIONS'
  // own .title strings already follow (station names are the sport's own
  // vocabulary, kept in English regardless of app language, same as
  // "SkiErg"/"Wall Balls" elsewhere in this file).
  const STATION_TITLES = { run: "Run" };
  STATIONS.forEach((s) => { if (s.type === "station") STATION_TITLES[s.key] = s.title; });

  // What a freshly-added block starts at -- the real HYROX standard for
  // every station except Wall Balls (reps, not meters -- see
  // CUSTOM_STATION_KEYS above), and the standard 1km for Run. Gender-
  // specific numbers (weight, Wall Balls' own rep count) don't apply here:
  // the custom builder never asks for gender, so 75 (roughly the
  // women's/lighter-category rep standard) is used as one flat, edit-
  // anytime starting point rather than guessing which standard the user
  // meant.
  const CUSTOM_DEFAULT_WALL_BALL_REPS = 75;
  function customStationDefaultAmount(key) {
    if (key === "run") return RUN_DISTANCE_M;
    if (key === "wallBalls") return CUSTOM_DEFAULT_WALL_BALL_REPS;
    return STATION_SPECS[key].distanceM;
  }
  function customStationUnitLabel(key) {
    return key === "wallBalls" ? t("hyrox.space.chip.reps") : t("hyrox.standards.chip.distance");
  }
  function formatCustomAmount(key, amount) {
    return key === "wallBalls" ? String(amount) : formatStationMeters(amount);
  }

  // The builder's starting point: the whole standard race, one block per
  // STATIONS entry, every amount at its default -- "every station set to
  // the default" from the moment Custom is picked, so the user is editing
  // a real race instead of building one up from nothing. Each block gets
  // its own instance id (separate from `key`) so the same station can be
  // added more than once -- two Runs, two Sled Pushes, whatever -- without
  // colliding in the ordered list.
  function newCustomStationId() {
    return crypto.randomUUID ? crypto.randomUUID() : `cs-${Date.now()}-${Math.random()}`;
  }
  function buildDefaultCustomStations() {
    return STATIONS.map((s) => {
      const key = s.type === "run" ? "run" : s.key;
      return { id: newCustomStationId(), key, amount: customStationDefaultAmount(key) };
    });
  }

  // Only the 4 stations whose standard actually differs between Open and
  // Pro (see STATION_SPECS above) support the Pro practice-weight
  // adjustment. SkiErg/Row/Run are excluded because they're machine/bodyweight
  // (no external load at all); Burpee Broad Jumps is bodyweight too; Wall
  // Balls' ball weight is fixed by rule and identical for Open and Pro
  // (only gender changes it) — none of those have a "Pro standard" to
  // adjust away from.
  const PRO_ADJUSTABLE_STATIONS = ["sledPush", "sledPull", "farmersCarry", "lunges"];

  // A gym's lane for a travelling station (sleds, carries, burpee broad
  // jumps -- as opposed to machine efforts like SkiErg/Row or the
  // stationary Wall Balls) is almost never HYROX's exact distance, so the
  // user enters their own lane length once and the app works out how many
  // laps hit the HYROX total. See getFacilityLane/roundsFor.
  // One shared lane length for every travelling station -- asked once
  // instead of per-station, since a home/garage gym almost always has one
  // usable stretch of floor, not a different one for each movement. New key
  // (not a version bump of the old one) since the stored shape changed from
  // a per-station object to a single number.
  const FACILITY_LANE_KEY = "repcheck_hyrox_facility_lane_v1";
  // Matches the official HYROX sled-marker spacing -- a reasonable default
  // for a small home/garage space until the user answers the one question.
  const DEFAULT_LANE_M = 12.5;

  // Same 4 stations double as the ones whose total rounds/distance can be
  // split between a Doubles pair (see getDoublesSplit/renderDoublesSplitStep
  // below) -- SkiErg/Row/Run/Burpee Broad Jumps/Wall Balls are continuous
  // efforts without a "how many did each partner do" breakdown that means
  // anything in this app.
  // The full race's 1km runs, halved in a Half race. Single source of
  // truth -- runTitle()/the agenda/the race screen all read it via
  // runDistanceM(scale) rather than hardcoding 1000 in several places.
  const RUN_DISTANCE_M = 1000;
  function runDistanceM(scale) {
    return scale === "half" ? RUN_DISTANCE_M / 2 : RUN_DISTANCE_M;
  }
  // Station distances and Wall Balls reps halve too; weights never do (a
  // Half race is half the VOLUME at the same standard load).
  function scaledStationDistanceM(key, scale) {
    const spec = STATION_SPECS[key];
    if (!spec || typeof spec.distanceM !== "number") return null;
    return scale === "half" ? spec.distanceM / 2 : spec.distanceM;
  }
  function scaledWallBallReps(gender, scale) {
    const reps = STATION_SPECS.wallBalls.reps[gender];
    return scale === "half" ? Math.round(reps / 2) : reps;
  }

  // Every station is expressed in ROUNDS -- the sleds in their own 12.5m
  // segments, farmers carry/lunges as laps of the user's lane. They used
  // to be reported in raw meters, which read as a nonsensical "200 rounds
  // to split" next to the sleds' "4", and gave a Doubles pair a number
  // they couldn't act on. laneM is required for the carry stations since
  // "one round" there only means something relative to the lane walked.
  function totalRoundUnits(key, laneM, scale) {
    if (!PRO_ADJUSTABLE_STATIONS.includes(key)) return null;
    const dist = scaledStationDistanceM(key, scale);
    if (dist == null) return null;
    // Lane laps for EVERY splittable station, sleds included. The sleds
    // used to count in HYROX's own 12.5m marker segments, which meant one
    // Doubles screen showed "rounds" measured two different ways -- 12.5m
    // segments for the sleds, lane laps for the carries -- and neither
    // matched the lap count Singles shows for the same station. One
    // definition: a round is one length of YOUR lane.
    return Math.max(1, Math.ceil(dist / (laneM || DEFAULT_LANE_M)));
  }
  // Every splittable station now counts in rounds -- see totalRoundUnits.
  function roundUnitLabel() {
    return t("hyrox.doublesSplit.unit.rounds");
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
  // roundToM quantises the result to a whole number of segments (the sleds,
  // where a "round" IS a 12.5m segment). Pass null to leave the scaled
  // distance exact -- for the carry stations, whose round count is decided
  // later against the user's own lane, quantising here as well meant
  // rounding twice and reporting lap counts that didn't match the weight.
  function scaledDistanceM(defaultDistanceM, defaultWeightKg, currentWeightKg, roundToM) {
    if (!currentWeightKg || currentWeightKg >= defaultWeightKg) return defaultDistanceM;
    const scaled = defaultDistanceM * (defaultWeightKg / currentWeightKg);
    if (!roundToM) return scaled;
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
  function runTitle(scale) {
    return `${formatDistanceMeters(runDistanceM(scale))} Run`;
  }
  function stationTitle(entry, scale) {
    return entry.type === "run" ? runTitle(scale) : entry.title;
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
  // Custom race builder's reorder arrows -- no drag-and-drop anywhere else
  // in this app, so plain tap-to-move buttons match the rest of the UI.
  const CHEVRON_UP_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`;
  const CHEVRON_DOWN_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

  // Custom race builder's press-and-hold drag reorder. HOLD_MS is the
  // pause before a press turns into a drag -- long enough that an ordinary
  // tap/scroll-swipe never gets mistaken for drag-intent, short enough to
  // still feel immediate. MOVE_CANCEL_PX cancels the pending hold if the
  // finger/cursor moves noticeably before it fires (that's a scroll, not a
  // hold). See handleCustomRowPointerDown() below.
  const CUSTOM_DRAG_HOLD_MS = 160;
  const CUSTOM_DRAG_MOVE_CANCEL_PX = 8;
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
  // "Half" halves the whole race -- every run, every station distance, and
  // the Wall Balls rep count -- for a shorter session that keeps the full
  // race's shape and every weight standard untouched (the loads are the
  // standard; only the volume changes). Singles only: a Doubles pair is
  // already dividing the work between two people, so halving on top of
  // that stops resembling the race at all. See raceScale().
  const SCALE_IDS = ["full", "half"];

  function categoryTitle(id) { return t(`hyrox.category.${id}.title`); }
  function formatTitle(id) { return t(`hyrox.format.${id}.title`); }
  function genderTitle(id) { return id ? t(`hyrox.gender.${id}`) : "Mixed"; }

  // The coaching profile's onboarding "male"/"female" answer, mapped to
  // this app's "men"/"women" vocabulary -- race setup no longer asks for
  // gender itself, it just reads the one the user already gave (onboarding's
  // gender question, coaching.wizard.stepGender, is a required, validated
  // field, so any user with a saved profile at all necessarily has one).
  // Shared with resolveLeaderboardGender(), which used to duplicate this
  // exact mapping inline.
  function profileGender() {
    const profile = loadJson(COACHING_PROFILE_KEY, null);
    if (!profile || !profile.gender) return null;
    return profile.gender === "female" ? "women" : "men";
  }

  // "Men Open Singles"-style combo label used on results/history/PB rows.
  // Custom races have no gender/format (the builder never asks), so they
  // get their own short label instead of composing one from empty parts.
  function comboLabel(gender, category, format) {
    if (category === "custom") return t("hyrox.category.custom.title");
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

  // Both toast variants share the same fixed bottom-center slot, so only
  // one can be legible at a time -- clear any toast of EITHER class, not
  // just this one's own, before inserting (a delayed save-error toast
  // landing on top of a freshly-tapped info toast would otherwise stack
  // both, unreadable).
  function clearExistingToasts() {
    document.querySelectorAll(".hx-save-error-toast, .hx-info-toast").forEach((t) => t.remove());
  }

  function showHistorySaveError(message) {
    clearExistingToasts();
    const toast = el(`<div class="hx-save-error-toast">${message}</div>`);
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  }

  // Same toast shell as showHistorySaveError(), but neutral-styled -- for
  // states that are expected/benign (e.g. "no detail available"), not
  // failures. Reusing the red error toast for those would tell the user
  // something went wrong when nothing did.
  function showInfoToast(message) {
    clearExistingToasts();
    const toast = el(`<div class="hx-info-toast">${message}</div>`);
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  }

  // Confirms a finished race is durably saved server-side (see POST
  // /api/hyrox/history-entry in app.py). The generic account_sync.js blob
  // sync (which saveHistory() also triggers via the wrapped localStorage
  // .setItem) is fire-and-forget and re-sends the *whole* history on
  // every write -- until now that was the ONLY path a finished race ever
  // went through, which could silently lose it if that write raced with
  // another save (e.g. closing the tab right after the finish screen).
  // Not awaited by finishRace() -- the finish screen should feel instant;
  // a failure here just surfaces a toast instead of blocking it.
  async function persistHistoryEntry(entry) {
    if (!window.REPCHECK_LOGGED_IN) return;
    try {
      const response = await fetch("/api/hyrox/history-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "Save failed");
    } catch (err) {
      showHistorySaveError(t("hyrox.history.saveError"));
    }
  }

  // Authoritative counterpart to persistHistoryEntry() above -- confirms a
  // removed race is actually gone server-side too. Needed now that the
  // generic sync route merges the HYROX history instead of overwriting it
  // (see database.py's MERGE_LOG_KEYS, added so a stale full-blob push can
  // never silently erase races the server already had) -- a merge can
  // only ever bring entries back, never remove one.
  async function persistRemoveHistoryEntry(entryId) {
    if (!window.REPCHECK_LOGGED_IN) return;
    try {
      const response = await fetch("/api/hyrox/history-entry", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry_id: entryId }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "Delete failed");
    } catch (err) {
      showHistorySaveError(t("hyrox.history.deleteError"));
    }
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
      // Always an array. A sync bug once wrote "{}" here (an empty object
      // instead of []); guard so a bad-shaped stored value can never crash
      // the whole page render on this.history.forEach/.slice.
      this.history = loadJson(HISTORY_KEY, []);
      if (!Array.isArray(this.history)) this.history = [];
      // Which stations have their detail expanded in the weight-standards
      // reference list (renderWeightsCard) -- deliberately NOT reset by
      // resetSetup/setCategory/etc, since it's just a display preference,
      // not race data; no reason a "start over" should collapse it again.
      this.expandedStandards = {};
      // Persisted standing identity for the leaderboard (see
      // resolveLeaderboardGender()) -- deliberately separate from
      // this.gender, which resetSetup() re-derives from the coaching
      // profile every time (see profileGender()) since that's per-race
      // setup state, not a standing choice of its own.
      this.leaderboardGender = localStorage.getItem(LEADERBOARD_GENDER_KEY) || null;
      this.leaderboardTab = { category: "open", format: "singles" };
      this.leaderboardCache = null; // { key, loading, data|error } -- see loadLeaderboard()
      this.myBestsCache = null; // { gender, loading, entries } -- see loadMyBests()
      // Transient modal state (not race data, so it lives outside
      // resetSetup): which station's how-to/video popup is open, and the
      // per-race AI analysis cache keyed by race id (see loadRaceAnalysis).
      this.stationInfo = null;
      this.detailRaceId = null; // which history race's detail modal is open
      // Whether the add-station picker (a bottom sheet opened from the
      // custom builder's "+" button) is currently open -- see
      // openStationPickerSheet()/closeStationPickerSheet(). Not race data,
      // so (like the modals above) it's not touched by resetSetup()
      // itself... except resetSetup() DOES explicitly close it (see
      // there), since "start over" should never leave a stale sheet open
      // over a screen that's no longer "raceSetup".
      this.stationPickerSheetOpen = false;
      // One shared gym lane length (start->end distance the user measured
      // at their facility), used by every travelling station. A property of
      // the user's gym, NOT of any one race, so it persists across races and
      // is never reset by resetSetup(). Kept local (not account-synced)
      // since it's tied to wherever the user physically trains.
      this.facilityLane = loadJson(FACILITY_LANE_KEY, null);
      // The user's custom-race-in-progress -- built once here (not in
      // resetSetup(), which runs on every "New race") so switching to
      // Standard and back to Custom, or finishing a custom race and
      // starting another, doesn't discard what was built. Not persisted
      // to localStorage (matches stationWeights/doublesSplit below, which
      // are also in-session-only); see buildDefaultCustomStations() for
      // what it starts as.
      this.customStations = buildDefaultCustomStations();
      // Active press-and-hold reorder session for the custom builder, or
      // null when nothing's being dragged -- see handleCustomRowPointerDown()
      // and the _customDrag* methods below. Not race data, so (like
      // stationInfo/stationPickerSheetOpen above) it's never touched by
      // resetSetup().
      this.customDrag = null;
      this.analysisCache = {}; // raceId -> { loading, data|error }
      // Which analysis sections are expanded to their full bullet-point
      // detail, keyed "raceId:section" (section = "overall" or a rating
      // group name) -- collapsed (short only) by default for every race.
      this.analysisExpanded = new Set();
      // Which formats' "Your personal bests" section (renderMyBestsCard())
      // are expanded past their single hero time to show every tier
      // raced -- keyed by format id ("singles"/"doubles"), collapsed by
      // default same as analysisExpanded above.
      this.pbExpandedFormats = new Set();
      this.resetSetup();

      this.root.addEventListener("click", (event) => this.handleClick(event));
      // renderMyBestsCard()'s format-section trigger is a div[role=button],
      // not a real <button>, because it wraps its own nested <button> (the
      // hero time) -- real buttons can't nest inside each other (invalid
      // HTML; the browser silently closes the outer one, corrupting
      // everything rendered after it). Keyboard activation isn't free on a
      // div the way it is on a button, so this replays Enter/Space as a
      // synthetic click through the same delegated handler above.
      this.root.addEventListener("keydown", (event) => this.handleKeydown(event));
      this.root.addEventListener("change", (event) => this.handleChange(event));
      this.root.addEventListener("focusin", (event) => this.handleFocusIn(event));
      this.root.addEventListener("focusout", (event) => this.handleFocusOut(event));
      // Press-and-hold drag reorder for the custom builder's station list
      // -- see handleCustomRowPointerDown(). Now lives directly on the
      // race-setup page (part of #hyrox-root), not a bottom sheet, so it's
      // bound here alongside the other delegated listeners above instead
      // of on a sheet overlay.
      this.root.addEventListener("pointerdown", (event) => this.handleCustomRowPointerDown(event));
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
        // The board ranks full races only -- it has no scale dimension,
        // so a half-distance time would sit there looking superhuman.
        if (record.scale === "half") return;
        const key = this.pbKeyFor(record.category, record.format, record.gender, record.scale);
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
        this.myBestsCache = null;
        this.render();
      } catch (err) {
        // Leave the flag unset so this retries on the next page load.
      }
    }

    resetSetup() {
      this.screen = "setup";
      // "standard" | "custom" -- see setRaceType()/renderCustomBuilder().
      // Always resets to standard so "start over" never quietly reopens
      // the custom builder instead of the usual category/format steps.
      // this.customStations itself is NOT reset here (see constructor) --
      // it's "the race I'm building," not per-attempt setup state, so
      // switching back to Custom later doesn't lose it.
      this.raceType = "standard";
      this.category = null;
      this.format = null;
      // No longer asked -- read fresh from the profile every reset (so a
      // gender change in Settings takes effect on the very next race, not
      // just the next full page load). Custom races never read this.gender
      // at all, so deriving it unconditionally here is harmless there too.
      this.gender = profileGender();
      // "full" | "half" -- see SCALE_IDS. Always reset to full so a Half
      // session never silently carries into the next race.
      this.scale = "full";
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
      this.closeStationPickerSheet();
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
      if (this.raceType === "custom") return this.customStations.length > 0;
      if (!this.category || !this.format) return false;
      if (this.needsGender() && !this.gender) return false;
      return true;
    }

    // The race actually about to run, in order -- STATIONS unchanged for
    // Standard, or the user's own built list for Custom, reshaped into the
    // exact same {type, key, title} entries STATIONS uses so every runtime
    // method (completeSegment/renderRunning/the progress dots) can stay
    // written against one shape regardless of which race type is active.
    // `key` deliberately reuses the real station type ("run"/"sledPush"/...)
    // rather than each block's own unique builder id -- completeSegment()
    // stores it straight onto the split, and splitIconKey()/the station-
    // info popup/STATION_HOWTO all already key off exactly that vocabulary,
    // so a repeated station (two Runs, two Sled Pushes) keeps working with
    // zero extra plumbing, same as the standard race's own run1..run8
    // already collapsing to one shared "run" icon.
    raceSequence() {
      if (this.raceType === "custom") {
        return this.customStations.map((s) => ({
          type: s.key === "run" ? "run" : "station",
          key: s.key,
          title: STATION_TITLES[s.key] || s.key,
          amount: s.amount,
        }));
      }
      return STATIONS;
    }

    flagKeyFor(format, gender) {
      return `${gender}|${format}`;
    }

    // ---------- Personal bests ----------
    // A "personal best" is scoped to one exact category+format+gender
    // combo — a Pro Singles time isn't comparable to an Open Doubles
    // time, so mixing them into one overall PB would be meaningless.
    // Scale is part of the identity: a Half race covers half the distance,
    // so ranking it against Full times would make every Half look like a
    // massive PB. Records written before Half existed have no `scale` and
    // are all Full races, hence the default.
    pbKeyFor(category, format, gender, scale) {
      return `${category}|${format}|${gender}|${scale || "full"}`;
    }

    getPersonalBest(category, format, gender, scale) {
      if (category === "custom") return null; // no two custom races share a standard to compare against
      const key = this.pbKeyFor(category, format, gender, scale);
      let best = null;
      this.history.forEach((r) => {
        if (r.flagged || r.category === "custom") return; // flagged (unrealistic) times never count as a PB
        if (this.pbKeyFor(r.category, r.format, r.gender, r.scale) !== key) return;
        if (!best || r.totalSeconds < best.totalSeconds) best = r;
      });
      return best;
    }

    // One row per combo the user has ever completed, fastest time (and
    // the day it happened) for each — used on the history screen. Flagged
    // (unrealistic) times are excluded, same as getPersonalBest above.
    // Custom races are excluded too: every custom race is its own
    // one-off station mix, so there's no shared "combo" for two of them
    // to be personal-bests of each other against.
    getAllPersonalBests() {
      const bestByKey = new Map();
      this.history.forEach((r) => {
        if (r.flagged || r.category === "custom") return;
        const key = this.pbKeyFor(r.category, r.format, r.gender, r.scale);
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
      if (action === "set-scale") return this.setScale(target.dataset.value);
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
      if (action === "reset-facility-lane") return this.resetFacilityLane();
      if (action === "hero-start") return this.openRaceSetupPage();
      if (action === "close-race-setup-page") return this.closeRaceSetupPage();
      if (action === "close-station-picker-sheet") return this.closeStationPickerSheet();
      if (action === "set-race-type") return this.setRaceType(target.dataset.value);
      if (action === "add-custom-station") return this.addCustomStation(target.dataset.value);
      if (action === "remove-custom-station") return this.removeCustomStation(target.dataset.id);
      if (action === "move-custom-station") return this.moveCustomStation(target.dataset.id, parseInt(target.dataset.direction, 10));
      if (action === "reset-custom-stations") return this.resetCustomStations();
      if (action === "open-station-picker") return this.openStationPickerSheet();
      if (action === "toggle-pb-format") return this.togglePbFormat(target.dataset.format);
      if (action === "pb-no-detail") return showInfoToast(t("hyrox.pb.noDetailAvailable"));
    }

    // Enter/Space activation for div[role=button] triggers (see the
    // pb-section-trigger comment in the constructor for why those aren't
    // real <button> elements). Ignored for any element that IS a real
    // button/input/etc. -- those already get free keyboard activation from
    // the browser, and replaying a synthetic click on top would double-fire.
    handleKeydown(event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target.closest('[data-action][role="button"]');
      if (!target || event.target !== target) return;
      event.preventDefault();
      target.click();
    }

    // ---------- AI analysis: short/detail toggle ----------
    toggleAnalysisDetail(raceId, section) {
      const key = `${raceId}:${section}`;
      if (this.analysisExpanded.has(key)) this.analysisExpanded.delete(key);
      else this.analysisExpanded.add(key);
      this.render();
    }

    // ---------- Your personal bests: per-format expand ----------
    togglePbFormat(formatId) {
      if (this.pbExpandedFormats.has(formatId)) this.pbExpandedFormats.delete(formatId);
      else this.pbExpandedFormats.add(formatId);
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

    // Tapping a number field should let you just type the new value, not
    // make you clear 3 digits first -- so it blanks on focus. The old
    // value is stashed on the element and put back on blur if nothing was
    // typed, so tapping in and back out never silently changes anything.
    // Bound via focusin/focusout (which bubble, unlike focus/blur) so this
    // survives the sheet's innerHTML being rebuilt on every render.
    handleFocusIn(event) {
      const input = event.target.closest("[data-clear-on-focus]");
      if (!input) return;
      input.dataset.prevValue = input.value;
      input.value = "";
    }

    handleFocusOut(event) {
      const input = event.target.closest("[data-clear-on-focus]");
      if (!input) return;
      if (input.value.trim() === "" && input.dataset.prevValue != null) {
        input.value = input.dataset.prevValue;
        // Nothing changed, so no setter runs and no re-render is needed --
        // restoring the text is the whole job.
      }
      delete input.dataset.prevValue;
    }

    handleChange(event) {
      const weightInput = event.target.closest("[data-station-weight-input]");
      if (weightInput) return this.setStationWeight(weightInput.dataset.station, weightInput.value);
      const splitInput = event.target.closest("[data-doubles-round-input]");
      if (splitInput) return this.setDoublesSplit(splitInput.dataset.station, splitInput.value);
      const splitPartnerInput = event.target.closest("[data-doubles-round-partner-input]");
      if (splitPartnerInput) return this.setDoublesSplitPartner(splitPartnerInput.dataset.station, splitPartnerInput.value);
      const laneInput = event.target.closest("[data-facility-lane-input]");
      if (laneInput) return this.setFacilityLane(laneInput.value);
      const customAmountInput = event.target.closest("[data-custom-amount-input]");
      if (customAmountInput) return this.setCustomStationAmount(customAmountInput.dataset.id, customAmountInput.value);
    }

    setCategory(value) {
      this.category = value;
      this.stationWeights = {};
      this.render();
    }

    setFormat(value) {
      this.format = value;
      this.doublesSplit = {}; // switching formats invalidates any "my rounds" split
      // Half is Singles-only, so switching to Doubles must drop it rather
      // than silently racing a half-length Doubles nobody selected.
      if (value !== "singles") this.scale = "full";
      this.render();
    }

    // Half vs full race. Singles-only (see SCALE_IDS); guarded here too so
    // it can't be set from a stale button after a format switch.
    setScale(value) {
      if (!SCALE_IDS.includes(value)) return;
      if (value === "half" && this.format !== "singles") return;
      this.scale = value;
      // Round totals change with the scale, so any "my rounds" split
      // measured against the old totals is no longer meaningful.
      this.doublesSplit = {};
      this.render();
    }

    // True once the user has actually moved something away from the
    // standard -- drives the practice-mode caveat, which is noise until
    // there's an adjustment for it to caveat.
    hasAdjustments() {
      return Object.keys(this.stationWeights).length > 0
        || Object.keys(this.doublesSplit).length > 0;
    }

    // ---------- Custom race builder ----------
    // Switching race type sets/clears category the same way the standard
    // pickers do, so canStart()/renderSetup()'s "gender picked yet" checks
    // and the rest of the app all see one consistent story instead of a
    // leftover this.category from whichever mode was active before.
    setRaceType(value) {
      if (value !== "standard" && value !== "custom") return;
      this.raceType = value;
      this.category = value === "custom" ? "custom" : null;
      this.format = null;
      // Re-derive rather than null out -- switching back to Standard from
      // Custom must not leave canStart() blocked on a gender that's actually
      // sitting right there in the profile (see profileGender()).
      this.gender = profileGender();
      // Switching to Standard hides the custom builder (and the picker
      // with it) entirely -- without this, tapping back to Custom later
      // in the same page visit resurrected the picker already open from
      // before, even though it had been fully out of view in between.
      this.closeStationPickerSheet();
      this.render();
    }

    addCustomStation(key) {
      if (!CUSTOM_STATION_KEYS.includes(key)) return;
      this.customStations.push({ id: newCustomStationId(), key, amount: customStationDefaultAmount(key) });
      // Picking a station is the whole point of opening the picker -- close
      // it again immediately rather than leaving it hanging open waiting
      // for a second dismiss tap.
      this.closeStationPickerSheet();
      this.render();
    }

    removeCustomStation(id) {
      this.customStations = this.customStations.filter((s) => s.id !== id);
      this.render();
    }

    // direction: -1 moves the row up (earlier in the race), +1 moves it
    // down. Out-of-range moves (top row up, bottom row down) are just
    // no-ops rather than wrapping -- reordering should never surprise you
    // by teleporting a row to the other end of the list.
    moveCustomStation(id, direction) {
      const idx = this.customStations.findIndex((s) => s.id === id);
      if (idx === -1) return;
      const targetIdx = idx + direction;
      if (targetIdx < 0 || targetIdx >= this.customStations.length) return;
      const [entry] = this.customStations.splice(idx, 1);
      this.customStations.splice(targetIdx, 0, entry);
      this.render();
    }

    setCustomStationAmount(id, rawValue) {
      const entry = this.customStations.find((s) => s.id === id);
      if (!entry) return;
      let v = parseFloat(rawValue);
      // A cleared/invalid field falls back to the station's own default
      // rather than 0 -- an empty distance would silently turn that block
      // into a 0-effort no-op instead of visibly asking to be filled in.
      if (!isFinite(v) || v <= 0) v = customStationDefaultAmount(entry.key);
      // Reps are always whole numbers; distances keep one decimal (matches
      // the station-weight input's own precision elsewhere in this file).
      entry.amount = entry.key === "wallBalls" ? Math.round(v) : Math.round(v * 10) / 10;
      this.render();
    }

    resetCustomStations() {
      this.customStations = buildDefaultCustomStations();
      this.render();
    }

    // ---------- Custom race builder: press-and-hold drag reorder ----------
    // No drag-and-drop exists anywhere else in this app (the move up/down
    // arrows are the only other reorder path, kept as-is for anyone who'd
    // rather tap than hold-and-drag), so this is a small self-contained
    // implementation rather than reaching for a library. Overview:
    //   1. Pointerdown on a row starts a short hold timer (not an instant
    //      drag) so an ordinary tap or scroll-swipe is never mistaken for
    //      drag-intent -- see CUSTOM_DRAG_HOLD_MS/MOVE_CANCEL_PX above.
    //   2. Once the hold fires, the row follows the pointer 1:1 via an
    //      un-transitioned transform (this.customDrag holds the session).
    //      this.customStations is reordered live as the drag crosses each
    //      neighbor's midpoint, and every *other* row gets a transform
    //      recomputed from "where it used to sit" vs "where it sits in the
    //      reordered array" -- with a CSS transition already on those rows
    //      (see .hx-custom-row.is-reorder-shifting in hyrox.css), the
    //      browser animates each shift smoothly on its own; no manual FLIP
    //      invert/play bookkeeping needed, just "set the correct target
    //      transform and let the transition interpolate."
    //   3. On release, the dragged row snaps (animated) from wherever the
    //      pointer left it to its exact resting slot, then render() rebuilds
    //      the sheet from the now-authoritative this.customStations order --
    //      by the time that swap happens the row is already visually
    //      sitting exactly where the fresh DOM will place it, so there's no
    //      jump.
    handleCustomRowPointerDown(event) {
      // Only the primary pointer, only the primary mouse button (ignore
      // right/middle-click drags) -- and never for the amount input or the
      // move/remove buttons, which keep their own untouched click/change
      // behavior. closest() also naturally no-ops everywhere outside the
      // custom builder, since [data-custom-row-id] only exists there.
      if (!event.isPrimary) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (event.target.closest("[data-custom-amount-input], [data-action='move-custom-station'], [data-action='remove-custom-station']")) return;
      const rowEl = event.target.closest("[data-custom-row-id]");
      if (!rowEl) return;
      // Only one row can be mid-hold or mid-drag at a time.
      if (this.customDrag) return;

      const id = rowEl.dataset.customRowId;
      const pointerId = event.pointerId;
      const startClientX = event.clientX;
      const startClientY = event.clientY;

      const cleanupPending = () => {
        clearTimeout(holdTimer);
        document.removeEventListener("pointermove", onPendingMove);
        document.removeEventListener("pointerup", onPendingRelease);
        document.removeEventListener("pointercancel", onPendingRelease);
      };
      const onPendingMove = (moveEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        const movedPx = Math.max(Math.abs(moveEvent.clientX - startClientX), Math.abs(moveEvent.clientY - startClientY));
        if (movedPx > CUSTOM_DRAG_MOVE_CANCEL_PX) cleanupPending();
      };
      const onPendingRelease = (upEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        cleanupPending();
      };
      const holdTimer = setTimeout(() => {
        cleanupPending();
        this._armCustomDrag(rowEl, id, pointerId, startClientY);
      }, CUSTOM_DRAG_HOLD_MS);
      document.addEventListener("pointermove", onPendingMove);
      document.addEventListener("pointerup", onPendingRelease);
      document.addEventListener("pointercancel", onPendingRelease);
    }

    _armCustomDrag(rowEl, id, pointerId, startClientY) {
      const fromIndex = this.customStations.findIndex((s) => s.id === id);
      const listEl = document.querySelector("[data-custom-list]");
      if (fromIndex === -1 || !listEl) return;

      const rowRect = rowEl.getBoundingClientRect();
      const rowGap = parseFloat(getComputedStyle(listEl).rowGap) || 4;

      try { rowEl.setPointerCapture(pointerId); } catch (err) { /* not critical if unsupported */ }
      rowEl.classList.add("is-dragging");
      rowEl.style.touchAction = "none";

      this.customDrag = {
        id,
        pointerId,
        rowEl,
        listEl,
        startClientY,
        rowH: rowRect.height,
        rowGap,
        fromIndex,
        currentIndex: fromIndex,
        // Sibling ids in their DOM order at drag start, captured once --
        // every reorder step compares this against this.customStations'
        // live order (minus the dragged id) to know each sibling's shift.
        originalSiblingOrder: this.customStations.map((s) => s.id).filter((sid) => sid !== id),
      };

      const onMove = (moveEvent) => this._onCustomDragMove(moveEvent);
      const onEnd = (endEvent) => this._endCustomDrag(endEvent);
      this._customDragMoveHandler = onMove;
      this._customDragEndHandler = onEnd;
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onEnd);
      document.addEventListener("pointercancel", onEnd);
    }

    _onCustomDragMove(event) {
      const drag = this.customDrag;
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault();

      const deltaY = event.clientY - drag.startClientY;
      drag.rowEl.style.transform = `translateY(${deltaY}px)`;

      const unit = drag.rowH + drag.rowGap;
      const slotsMoved = Math.round(deltaY / unit);
      const newIndex = Math.max(0, Math.min(this.customStations.length - 1, drag.fromIndex + slotsMoved));
      if (newIndex !== drag.currentIndex) {
        const [entry] = this.customStations.splice(drag.currentIndex, 1);
        this.customStations.splice(newIndex, 0, entry);
        drag.currentIndex = newIndex;
        this._applyCustomDragSiblingShifts(drag);
      }
    }

    // Recomputes, for every OTHER row, "how many slots away from its
    // original DOM position is it now" and sets that as a translateY --
    // the CSS transition on .hx-custom-row.is-reorder-shifting (added once
    // below, never removed until the drag ends) does the actual smooth
    // animating, including reversing direction cleanly if the drag moves
    // back the way it came.
    _applyCustomDragSiblingShifts(drag) {
      const currentSiblingOrder = this.customStations.map((s) => s.id).filter((sid) => sid !== drag.id);
      drag.originalSiblingOrder.forEach((siblingId, originalIndex) => {
        const currentIndex = currentSiblingOrder.indexOf(siblingId);
        const siblingEl = drag.listEl.querySelector(`[data-custom-row-id="${siblingId}"]`);
        if (!siblingEl) return;
        siblingEl.classList.add("is-reorder-shifting");
        const shiftSlots = currentIndex - originalIndex;
        siblingEl.style.transform = shiftSlots === 0 ? "" : `translateY(${shiftSlots * (drag.rowH + drag.rowGap)}px)`;
      });
    }

    _endCustomDrag(event) {
      const drag = this.customDrag;
      if (!drag || event.pointerId !== drag.pointerId) return;
      document.removeEventListener("pointermove", this._customDragMoveHandler);
      document.removeEventListener("pointerup", this._customDragEndHandler);
      document.removeEventListener("pointercancel", this._customDragEndHandler);

      const finalizedRender = () => {
        // Guards against both the transitionend listener and the fallback
        // timeout firing (whichever wins clears this.customDrag first, so
        // the other one below is a no-op).
        if (!this.customDrag) return;
        this.customDrag = null;
        this.render();
      };

      const totalShiftPx = (drag.currentIndex - drag.fromIndex) * (drag.rowH + drag.rowGap);
      drag.rowEl.classList.remove("is-dragging");
      drag.rowEl.style.transition = "transform 180ms cubic-bezier(0.2, 0.7, 0.3, 1)";
      drag.rowEl.style.transform = totalShiftPx === 0 ? "" : `translateY(${totalShiftPx}px)`;
      drag.rowEl.addEventListener("transitionend", finalizedRender, { once: true });
      // Fallback: if the dragged row never actually moved (a hold-then-
      // release with zero drag distance), the transform never changes and
      // transitionend never fires, so this closes out the session anyway.
      setTimeout(finalizedRender, 220);
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
      const total = totalRoundUnits(key, this.getFacilityLane(), this.scale);
      if (total === null) return null;
      const stored = this.doublesSplit[key];
      const mine = (typeof stored === "number" && stored >= 0 && stored <= total) ? stored : Math.round(total / 2);
      return { total, mine, partner: total - mine };
    }

    setDoublesSplit(key, rawValue) {
      const total = totalRoundUnits(key, this.getFacilityLane(), this.scale);
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
      const total = totalRoundUnits(key, this.getFacilityLane(), this.scale);
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
    // One shared "how long is your available space" answer used by every
    // travelling station (see TRAVERSAL_STATIONS) -- asked once instead of
    // per-station, since a home/garage gym almost always has one usable
    // stretch of floor, not a different one for each movement.
    getFacilityLane() {
      return (typeof this.facilityLane === "number" && this.facilityLane > 0) ? this.facilityLane : DEFAULT_LANE_M;
    }

    setFacilityLane(rawValue) {
      const v = parseFloat(rawValue);
      if (!isFinite(v) || v <= 0) {
        this.facilityLane = null;
      } else {
        // Clamp to something sane: 1m minimum, 500m ceiling (well past any
        // single station's own full distance).
        this.facilityLane = Math.max(1, Math.min(500, Math.round(v * 100) / 100));
      }
      localStorage.setItem(FACILITY_LANE_KEY, JSON.stringify(this.facilityLane));
      this.render();
    }

    resetFacilityLane() {
      this.facilityLane = null;
      localStorage.setItem(FACILITY_LANE_KEY, JSON.stringify(this.facilityLane));
      this.render();
    }

    // The distance actually to be covered at a station, in meters -- the
    // HYROX standard, scaled UP if a lighter Pro practice weight is set
    // (see scaledDistanceM). Guards against gender/category not being
    // chosen yet so it's safe to call from the setup card.
    effectiveDistanceM(key) {
      // Half-scale first, so a lighter practice weight scales the HALVED
      // distance rather than the full one.
      const baseM = scaledStationDistanceM(key, this.scale);
      if (baseM == null) return null;
      if (!this.gender || !this.category) return baseM;
      const defaultW = getDefaultStationWeightKg(key, this.gender, this.category);
      if (defaultW === null) return baseM; // burpees etc. -- no weight to scale by
      const w = this.getStationWeight(key);
      // Sleds keep the 12.5m-segment quantisation because a sled round IS
      // a segment. The carry stations don't: they used to be forced to a
      // 10m grid here and THEN divided by the lane and rounded up again,
      // and that double-rounding is what made adjusted weights produce
      // visibly wrong lap counts. Now the scaled distance stays exact and
      // rounding happens once, in roundsFor(), against the real lane.
      const isSled = key === "sledPush" || key === "sledPull";
      return scaledDistanceM(baseM, defaultW, w, isSled ? STATION_SPECS[key].splitM : null);
    }

    // How many laps of the user's gym lane it takes to cover the station's
    // distance -- "first line to last line and back counts as one lap."
    // e.g. an 80m station in a 10m lane => 8 laps. Rounds up exactly once,
    // against the real lane, from an unquantised distance (see
    // effectiveDistanceM) so an adjusted weight yields an honest count.
    roundsFor(key) {
      const dist = this.effectiveDistanceM(key);
      if (dist == null) return null;
      return Math.max(1, Math.ceil(dist / this.getFacilityLane()));
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

    // ---------- Race setup page ----------
    // Category/format/training-space/pro-weight/doubles-split (or,
    // for a custom race, the station builder) -- a real page (its own
    // `screen`, same as history/leaderboard below) reached from the hero's
    // "Start race" CTA, not an overlay on top of it. Only the add-station
    // picker inside the custom builder still uses a bottom sheet -- see
    // openStationPickerSheet() below.
    openRaceSetupPage() {
      this.screen = "raceSetup";
      this.render();
    }

    // Leaves whatever category/format/custom-station choices were
    // made in place (unlike resetToSetup()/"back-to-setup", which is the
    // "I'm done, start completely fresh" action used elsewhere) -- tapping
    // back here should feel like dismissing a sheet used to, not
    // discarding progress.
    closeRaceSetupPage() {
      this.screen = "setup";
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
      persistRemoveHistoryEntry(id);
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
      return profileGender();
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

    // The "Your personal bests" card (renderMyBestsCard()) used to read
    // straight from local `history` -- but that's this browser's local
    // race log, not the account's actual record. A result recorded on
    // another device, or synced before this card existed, or simply
    // missing after a cache clear, is still very much a real PB the
    // leaderboard itself already knows about (it's in `hyrox_results`
    // server-side) -- the card would just silently fail to show it,
    // looking like the user has no bests at all despite ranking #1 on
    // their own leaderboard. Sourcing from the same /api/hyrox/leaderboard
    // endpoint the leaderboard card already uses (its `me` field is
    // exactly "this user's best in this exact gender/category/format")
    // makes the two cards agree by construction, regardless of which
    // device recorded the race.
    async loadMyBests() {
      const gender = this.resolveLeaderboardGender();
      if (!gender) return;
      if (this.myBestsCache && this.myBestsCache.gender === gender) return; // already loaded/loading

      this.myBestsCache = { gender, loading: true };
      try {
        const combos = [
          { category: "open", format: "singles" },
          { category: "pro", format: "singles" },
          { category: "open", format: "doubles" },
          { category: "pro", format: "doubles" },
        ];
        const results = await Promise.all(
          combos.map(async ({ category, format }) => {
            const response = await fetch(`/api/hyrox/leaderboard?gender=${gender}&category=${category}&format=${format}`);
            const data = await response.json();
            if (!data.ok || !data.me) return null; // hasn't raced this combo
            return { gender, category, format, totalSeconds: data.me.best_seconds };
          })
        );
        if (this.myBestsCache && this.myBestsCache.gender !== gender) return; // superseded by a newer gender switch
        const entries = results.filter(Boolean).sort((a, b) => a.totalSeconds - b.totalSeconds);
        this.myBestsCache = { gender, loading: false, entries };
      } catch (err) {
        this.myBestsCache = { gender, loading: false, entries: [] };
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
      const isCustom = this.raceType === "custom";
      const sequence = this.raceSequence();
      const segment = sequence[this.stationIndex];
      const now = (performance.now() - this.startTime) / 1000;
      // Custom entries already carry their own final title (built by
      // raceSequence() from the entry's own key -- no scale to apply,
      // there's no Half/Full concept in a custom race).
      const title = isCustom ? segment.title : stationTitle(segment, this.scale);
      this.splits.push({ key: segment.key, title, atSeconds: now });

      if (this.stationIndex >= sequence.length - 1) {
        this.finishRace(now);
        return;
      }
      this.stationIndex += 1;
      this.render();
    }

    finishRace(totalSeconds) {
      this.stopTicking();
      const isCustom = this.raceType === "custom";
      // The realistic-time floor and PB tracking are both built around the
      // fixed standard race -- a custom race can legitimately be much
      // shorter (or longer) than any real Hyrox category/format, and has
      // no shared standard for a second custom race to be a "PB" against
      // (see getPersonalBest's own category==="custom" guard). Neither
      // concept applies here, so both are simply off for custom races
      // rather than producing a false "unrealistic time" flag or a
      // meaningless "New PB!" on literally every custom finish.
      const flagged = isCustom ? false : totalSeconds <= (FLAG_THRESHOLD_SECONDS[this.flagKeyFor(this.format, this.gender)] || Infinity);
      const priorPb = isCustom ? null : this.getPersonalBest(this.category, this.format, this.gender, this.scale);
      const isNewPb = !isCustom && !flagged && (!priorPb || totalSeconds < priorPb.totalSeconds);

      const record = {
        id: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
        date: new Date().toISOString(),
        category: this.category,
        format: this.format,
        gender: this.gender,
        scale: this.scale,
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
      persistHistoryEntry(record);
      // Custom races never hit the global leaderboard -- it only ranks the
      // fixed standard categories/formats (see HYROX_CATEGORIES/HYROX_FORMATS
      // server-side), and a one-off custom mix isn't comparable to those
      // anyway.
      if (!flagged && !isCustom) {
        this.submitHyroxResult(record);
      }

      this.finishedResult = record;
      this.screen = "finished";
      this.render();

      // Run the race analysis right away for realistic races so it's shown
      // on the finish screen without a tap and saved into history for later.
      // Skipped for custom races -- see renderRaceAnalysis()'s own guard,
      // which is the actual source of truth for this; skipped here too so
      // a custom finish doesn't fire a wasted API call for a screen that
      // won't show the result anyway.
      if (!flagged && !isCustom) {
        this.loadRaceAnalysis(record.id, true);
      }
    }

    // Mirrors the record into the server-side hyrox_results table so it
    // can count on the global leaderboard -- this.history/localStorage
    // above is the source of truth for "my saved times" (unaffected if
    // this fails), this is purely the leaderboard's copy.
    async submitHyroxResult(record) {
      if (!window.REPCHECK_LOGGED_IN) return;
      // Half races cover half the distance and the leaderboard has no
      // scale dimension to separate them, so submitting one would rank a
      // fundamentally different effort against full races.
      if (record.scale === "half") return;
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
      // Skipped entirely while a custom-builder row is being dragged --
      // its row now lives directly in #hyrox-root (the race-setup page,
      // not a separate sheet), so rebuilding innerHTML mid-drag would rip
      // out the exact DOM node the pointer has captured. The drag's own
      // end handler calls render() itself once the gesture is over.
      if (this.customDrag) return;
      this.root.innerHTML = "";
      let view;
      if (this.screen === "setup") view = this.renderSetup();
      else if (this.screen === "raceSetup") view = this.renderRaceSetupPage();
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
      // Keep the add-station picker sheet's own content in sync with
      // whatever just triggered this render (adding/removing a station,
      // switching race type, etc.) -- same reasoning as the picker's own
      // open/close, just re-synced on every render rather than needing
      // every setter to remember to touch the sheet too.
      if (this.stationPickerSheetOpen) this.syncStationPickerSheetContent();
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
      const dateLabel = new Date(race.date).toLocaleDateString(RepCheckI18n.locale(), { month: "short", day: "numeric", year: "numeric" });

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
      const detailAnalysis = this.renderRaceAnalysis(race);
      if (detailAnalysis) overlay.querySelector("#hx-detail-analysis").appendChild(detailAnalysis);
      return overlay;
    }

    renderSetup() {
      const wrap = el(`<div></div>`);
      // The hero opens the page (same design language as the home page's
      // dark gradient hero): your fastest time, the 8 stations as tappable
      // icon chips, one CTA that navigates to the dedicated race-setup
      // page (see openRaceSetupPage()) instead of the steps living inline
      // here. The leaderboard follows -- same content as the standalone
      // "Leaderboard" screen (see renderLeaderboardCard) minus its back
      // button.
      wrap.appendChild(this.renderHeroCard());
      wrap.appendChild(this.renderLeaderboardCard(false));

      const myBestsCard = this.renderMyBestsCard();
      if (myBestsCard) wrap.appendChild(myBestsCard);

      // Weight standards sits right under the intro -- it's the "what the
      // race asks of you" reference. Needs category + gender to show the
      // correct weights, so it only appears once those are picked on the
      // race-setup page.
      if (this.category && this.gender) {
        wrap.appendChild(this.renderWeightsCard());
      }

      return wrap;
    }

    // ---------- Race setup page ----------
    // Category/format/gender/training-space/pro-weight/doubles-split (or,
    // for a custom race, the station builder) -- a real page, reached via
    // openRaceSetupPage()/closeRaceSetupPage() above, rendered the same
    // way as every other screen (see render()). Only the add-station
    // picker inside the custom builder still pops up as a bottom sheet --
    // see openStationPickerSheet() further down.
    renderRaceSetupPage() {
      const wrap = el(`
        <div class="hx-card">
          <div class="hx-setup-page-head">
            <button type="button" class="hx-modal-close" data-action="close-race-setup-page" aria-label="${t("common.back")}">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <div class="hx-setup-sheet-title">${t("hyrox.setupSheet.title")}</div>
          </div>
        </div>
      `);
      wrap.appendChild(this.buildSetupSteps());
      return wrap;
    }

    // ---------- Add-station picker (bottom sheet) ----------
    // The one part of race setup that's still a popup: tapping "+" in the
    // custom builder (see renderCustomBuilder()) opens a bottom sheet
    // listing every station, via the SAME shared sheet system every other
    // sheet in the app uses (base.html's window.openBottomSheet/
    // closeBottomSheet/bindSheetDrag + style.css's .log-sheet-* classes)
    // -- not a bespoke reimplementation of hyrox.js's own .hx-modal-overlay
    // (that one has no slide-up/drag-to-dismiss at all; see the station-info
    // and race-detail popups below for that pattern instead).
    //
    // The sheet lives on document.body (openBottomSheet reparents it there
    // automatically), NOT inside #hyrox-root, since #hyrox-root's own
    // content gets fully replaced on every render() (see render()) -- a
    // sheet living there would vanish/rebuild on every keystroke instead of
    // animating in once. That also means clicks inside it don't bubble up
    // to this.root's delegated listener, so it needs its own, forwarding
    // to the exact same handleClick().
    openStationPickerSheet() {
      let overlay = document.getElementById("hx-station-picker-sheet-root");
      if (!overlay) {
        overlay = el(`
          <div class="log-sheet-overlay" id="hx-station-picker-sheet-root">
            <div class="log-sheet">
              <div class="log-sheet-handle"></div>
              <div class="log-sheet-head">
                <div class="hx-setup-sheet-title">${t("hyrox.custom.addStation")}</div>
                <button type="button" class="log-sheet-close" data-action="close-station-picker-sheet" aria-label="${t("common.close")}">&times;</button>
              </div>
              <div class="log-sheet-body" id="hx-station-picker-sheet-body"></div>
            </div>
          </div>
        `);
        document.body.appendChild(overlay);
        overlay.addEventListener("click", (event) => {
          if (event.target === overlay) return this.closeStationPickerSheet();
          this.handleClick(event);
        });
        window.bindSheetDrag(overlay, ".log-sheet", ".log-sheet-handle", () => this.closeStationPickerSheet());
      }
      this.stationPickerSheetOpen = true;
      window.openBottomSheet(overlay, ".log-sheet");
      this.syncStationPickerSheetContent();
    }

    closeStationPickerSheet() {
      this.stationPickerSheetOpen = false;
      const overlay = document.getElementById("hx-station-picker-sheet-root");
      if (overlay) window.closeBottomSheet(overlay, ".log-sheet");
    }

    // Rebuilds just the sheet's inner content -- called on open, and again
    // from render()'s trailing sync (see there) whenever the race list
    // changes underneath it (e.g. switching race type away from custom),
    // so the sheet never shows stale content.
    syncStationPickerSheetContent() {
      const overlay = document.getElementById("hx-station-picker-sheet-root");
      if (!overlay) return;
      const body = overlay.querySelector("#hx-station-picker-sheet-body");
      body.innerHTML = "";
      body.appendChild(this.buildStationPickerSheetContent());
    }

    buildStationPickerSheetContent() {
      const list = el(`<div class="hx-station-picker-list"></div>`);
      CUSTOM_STATION_KEYS.forEach((key) => {
        list.appendChild(el(`
          <button type="button" class="hx-custom-palette-row" data-action="add-custom-station" data-value="${key}">
            <span class="hx-custom-palette-row-icon">${stationIconSvg(key, 22)}</span>
            <span class="hx-custom-palette-row-name">${STATION_TITLES[key]}</span>
          </button>
        `));
      });
      return list;
    }

    buildSetupSteps() {
      const isCustom = this.raceType === "custom";
      const wrap = el(`
        <div>
          <div class="hx-step-label">${t("hyrox.step.raceType")}</div>
          <div class="hx-choice-grid" data-group="race-type"></div>
          <div id="hx-standard-steps"></div>
          <div id="hx-custom-builder-block"></div>
          <div class="hx-start-race-row">
            <button type="button" class="hx-primary-btn" data-action="start-race" style="width:100%;" ${this.canStart() ? "" : "disabled"}>${t("hyrox.startRace")}</button>
          </div>
        </div>
      `);

      const raceTypeGrid = wrap.querySelector('[data-group="race-type"]');
      [["standard", "hyrox.raceType.standard"], ["custom", "hyrox.raceType.custom"]].forEach(([id, i18nKey]) => {
        raceTypeGrid.appendChild(el(`
          <button type="button" class="hx-choice-card ${this.raceType === id ? "is-selected" : ""}" data-action="set-race-type" data-value="${id}">
            <div class="hx-choice-title">${t(`${i18nKey}.title`)}</div>
            <div class="hx-choice-sub">${t(`${i18nKey}.sub`)}</div>
          </button>
        `));
      });

      // Custom skips every standard step (category/format/scale/
      // doubles-split) entirely -- none of them mean anything once the
      // station list itself isn't fixed -- and shows its own builder
      // instead. See renderCustomBuilder() below. Training space is the
      // one exception: it still applies here (any lane-traversed station --
      // see CUSTOM_ROUND_BASED_KEYS -- needs it to convert its configured
      // meters into laps once the race starts), so it's appended right
      // after the builder using the SAME shared lane value the standard
      // flow answers (see getFacilityLane()/renderTrainingSpaceCard()).
      if (isCustom) {
        wrap.querySelector("#hx-custom-builder-block").appendChild(this.renderCustomBuilder());
        wrap.querySelector("#hx-custom-builder-block").appendChild(this.renderTrainingSpaceCard());
        return wrap;
      }

      const standardSteps = wrap.querySelector("#hx-standard-steps");
      standardSteps.appendChild(el(`
        <div>
          <div class="hx-step-label">${t("hyrox.step.category")}</div>
          <div class="hx-choice-grid" data-group="category"></div>
          <div class="hx-step-label">${t("hyrox.step.format")}</div>
          <div class="hx-choice-grid" data-group="format"></div>
          <div id="hx-scale-block"></div>
          <div id="hx-training-space-block"></div>
          <div id="hx-pro-adjust-block"></div>
          <div id="hx-agenda-block"></div>
        </div>
      `));

      const categoryGrid = standardSteps.querySelector('[data-group="category"]');
      CATEGORY_IDS.forEach((id) => {
        categoryGrid.appendChild(el(`
          <button type="button" class="hx-choice-card ${this.category === id ? "is-selected" : ""}" data-action="set-category" data-value="${id}">
            <div class="hx-choice-title">${t(`hyrox.category.${id}.title`)}</div>
          </button>
        `));
      });

      const formatGrid = standardSteps.querySelector('[data-group="format"]');
      FORMAT_IDS.forEach((id) => {
        formatGrid.appendChild(el(`
          <button type="button" class="hx-choice-card ${this.format === id ? "is-selected" : ""}" data-action="set-format" data-value="${id}">
            <div class="hx-choice-title">${t(`hyrox.format.${id}.title`)}</div>
          </button>
        `));
      });

      // Half/full race length. Singles only (see SCALE_IDS) -- a Doubles
      // pair already halves the work between two people.
      const scaleBlock = standardSteps.querySelector("#hx-scale-block");
      if (this.format === "singles" && this.gender) {
        scaleBlock.appendChild(el(`<div class="hx-step-label">${t("hyrox.step.scale")}</div>`));
        const scaleGrid = el(`<div class="hx-choice-grid" data-group="scale"></div>`);
        SCALE_IDS.forEach((id) => {
          scaleGrid.appendChild(el(`
            <button type="button" class="hx-choice-card ${this.scale === id ? "is-selected" : ""}" data-action="set-scale" data-value="${id}">
              <div class="hx-choice-title">${t(`hyrox.scale.${id}.title`)}</div>
              <div class="hx-choice-sub">${t(`hyrox.scale.${id}.sub`)}</div>
            </button>
          `));
        });
        scaleBlock.appendChild(scaleGrid);
      }

      // "Your training space" sits right after the format/gender steps.
      // Doubles deliberately skips the per-station list: its own split
      // step below covers the same stations, and showing both duplicated
      // every station twice on one screen. The lane question itself still
      // matters in Doubles (the split totals are lane-derived), so that
      // part is kept -- see renderTrainingSpaceCard's own `showStations`.
      const trainingSpaceBlock = standardSteps.querySelector("#hx-training-space-block");
      if (this.category && this.gender) {
        trainingSpaceBlock.appendChild(this.renderTrainingSpaceCard());
      }

      // Singles has no separate step any more -- weight (editable in Pro)
      // and the lane-aware lap count both live in the training-space list
      // above, so there's exactly one place showing each station's numbers
      // instead of two that disagreed with each other.
      const proAdjustBlock = standardSteps.querySelector("#hx-pro-adjust-block");
      if (this.gender && this.format === "doubles") {
        proAdjustBlock.appendChild(this.renderDoublesSplitStep());
      }

      // The whole race, in order, once there's enough context to state it.
      const agendaBlock = standardSteps.querySelector("#hx-agenda-block");
      if (this.category && this.format && this.gender) {
        agendaBlock.appendChild(this.renderRaceAgenda());
      }

      const startRow = wrap.querySelector('[data-action="start-race"]').parentElement;
      if (this.canStart()) {
        const pb = this.getPersonalBest(this.category, this.format, this.gender, this.scale);
        if (pb) {
          const dateLabel = new Date(pb.date).toLocaleDateString(RepCheckI18n.locale(), { month: "short", day: "numeric", year: "numeric" });
          startRow.insertAdjacentElement("beforebegin", el(`
            <div class="hx-pb-banner">
              <div class="hx-pb-banner-label">${t("hyrox.pb.setupLabel", { combo: comboLabel(this.gender, this.category, this.format) })}</div>
              <div class="hx-pb-banner-time">${formatClock(pb.totalSeconds)}<span class="hx-pb-banner-date">${t("hyrox.pb.setDate", { date: dateLabel })}</span></div>
            </div>
          `));
        }
      }

      return wrap;
    }

    // The Custom race builder: an "add a station" palette, then the
    // race-so-far as a reorderable numbered list (up/down arrows -- no
    // drag-and-drop anywhere else in this app to match, so arrows keep the
    // interaction consistent with everything around it), each row's own
    // editable amount, and a remove button. Starts pre-seeded with the
    // full standard race (see buildDefaultCustomStations()) so there's
    // always a real race to trim/reorder instead of an empty list.
    renderCustomBuilder() {
      const wrap = el(`
        <div class="hx-custom-builder">
          <div class="hx-custom-agenda-head">
            <div class="hx-step-label" style="margin-bottom:0;">${t("hyrox.custom.yourRace")}</div>
            <div class="hx-custom-agenda-head-actions">
              <button type="button" class="hx-weight-reset" data-action="reset-custom-stations">${t("hyrox.custom.resetToStandard")}</button>
              <button type="button" class="hx-custom-add-btn ${this.stationPickerSheetOpen ? "is-open" : ""}" data-action="open-station-picker" aria-label="${t("hyrox.custom.addStation")}" aria-expanded="${this.stationPickerSheetOpen ? "true" : "false"}">+</button>
            </div>
          </div>
          <ol class="hx-agenda-list hx-custom-list" data-custom-list></ol>
        </div>
      `);

      const list = wrap.querySelector("[data-custom-list]");
      if (!this.customStations.length) {
        list.appendChild(el(`<li class="hx-custom-empty">${t("hyrox.custom.empty")}</li>`));
      }
      this.customStations.forEach((s, i) => {
        const isRun = s.key === "run";
        const unit = customStationUnitLabel(s.key);
        list.appendChild(el(`
          <li class="hx-agenda-row hx-custom-row ${isRun ? "is-run" : "is-station"}" data-custom-row-id="${s.id}">
            <div class="hx-agenda-row-main">
              <span class="hx-agenda-num">${i + 1}</span>
              <span class="hx-agenda-icon">${stationIconSvg(s.key, 20)}</span>
              <span class="hx-agenda-name">${STATION_TITLES[s.key]}</span>
              <div class="hx-agenda-stats">
                <div class="hx-space-weight is-editable">
                  <input type="number" inputmode="decimal" step="${s.key === "wallBalls" ? "1" : "0.5"}" min="0"
                         value="${s.amount}" data-custom-amount-input data-clear-on-focus data-id="${s.id}"
                         class="hx-space-weight-input" aria-label="${STATION_TITLES[s.key]} ${unit}">
                  <span class="hx-space-weight-label">${s.key === "wallBalls" ? t("hyrox.space.chip.reps") : "m"}</span>
                </div>
              </div>
              <div class="hx-custom-row-controls">
                <button type="button" class="hx-custom-move-btn" data-action="move-custom-station" data-id="${s.id}" data-direction="-1" ${i === 0 ? "disabled" : ""} aria-label="${t("hyrox.custom.moveUp")}">${CHEVRON_UP_ICON}</button>
                <button type="button" class="hx-custom-move-btn" data-action="move-custom-station" data-id="${s.id}" data-direction="1" ${i === this.customStations.length - 1 ? "disabled" : ""} aria-label="${t("hyrox.custom.moveDown")}">${CHEVRON_DOWN_ICON}</button>
                <button type="button" class="hx-custom-remove-btn" data-action="remove-custom-station" data-id="${s.id}" aria-label="${t("common.remove")}">&times;</button>
              </div>
            </div>
          </li>
        `));
      });

      return wrap;
    }

    // Doubles-only, either category. The weight is fixed (shown as its own
    // prominent, but unadjustable, stat box) and what's actually editable
    // is how the rounds split between the two of you. Three large,
    // side-by-side stat boxes (weight / you / your partner) so the full
    // commitment -- how much load, how many rounds each -- is impossible
    // to miss. Singles gets no step of its own: its weight and lane-aware
    // lap count both live in the training-space list above instead.
    renderDoublesSplitStep() {
      const wrap = el(`<div></div>`);
      wrap.appendChild(el(`<div class="hx-step-label">${t("hyrox.step.doublesSplit")}</div>`));

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
              <input type="number" inputmode="numeric" step="1" min="0" max="${split.total}" value="${split.mine}" data-doubles-round-input data-clear-on-focus data-station="${key}" class="hx-pro-weight-stat-input">
              <div class="hx-pro-weight-stat-label">${t("hyrox.doublesSplit.you")} (${unit})</div>
            </div>
            <div class="hx-pro-weight-stat hx-pro-weight-stat-editable">
              <input type="number" inputmode="numeric" step="1" min="0" max="${split.total}" value="${split.partner}" data-doubles-round-partner-input data-clear-on-focus data-station="${key}" class="hx-pro-weight-stat-input">
              <div class="hx-pro-weight-stat-label">${t("hyrox.doublesSplit.partner")} (${unit})</div>
              ${isUneven ? `<button type="button" class="hx-weight-reset" data-action="reset-doubles-split" data-station="${key}">${t("hyrox.weightAdjust.reset")}</button>` : ""}
            </div>
          </div>
        `));
      });
      wrap.appendChild(grid);
      return wrap;
    }

    // The same stat-box design the training-space list used to show on its
    // own (weight box immediately left of a lap-count box, same
    // .hx-space-weight/.hx-space-laps classes) but now built once and
    // reused inside the full race agenda, for every station type, in every
    // category/format/gender -- one consistent way of stating "how heavy,
    // how many" instead of a different treatment per screen. Weight is
    // editable only for Pro Singles (the one case with a real practice-
    // weight choice); everywhere else it's the fixed standard, same rule
    // the old per-format lists already followed.
    stationStatsHtml(key) {
      const spec = STATION_SPECS[key];
      const title = STATIONS.find((s) => s.key === key).title;

      if (key === "wallBalls") {
        const reps = scaledWallBallReps(this.gender, this.scale);
        return {
          stats: `
            <div class="hx-space-laps">
              <span class="hx-space-laps-value">${reps}</span>
              <span class="hx-space-laps-label">${t("hyrox.space.chip.reps")}</span>
            </div>
          `,
          caption: `${formatWeight(spec.ballKg[this.gender])} · ${spec.targetFt[this.gender]}ft ${t("hyrox.space.chip.target")}`,
        };
      }
      if (key === "skierg" || key === "row") {
        return {
          stats: `
            <div class="hx-space-weight">
              <span class="hx-space-weight-value">${formatStationMeters(scaledStationDistanceM(key, this.scale))}</span>
              <span class="hx-space-weight-label">${t("hyrox.space.chip.distance")}</span>
            </div>
          `,
          caption: "",
        };
      }

      const rounds = this.roundsFor(key);
      const defaultW = getDefaultStationWeightKg(key, this.gender, this.category);
      let weightBox = "";
      if (defaultW) {
        const currentW = this.getStationWeight(key);
        const isScaled = currentW < defaultW;
        const editable = this.format === "singles" && this.category === "pro";
        weightBox = editable ? `
          <div class="hx-space-weight is-editable ${isScaled ? "is-scaled" : ""}">
            <input type="number" inputmode="decimal" step="0.5" min="${Math.round(defaultW * 0.1 * 10) / 10}" max="${defaultW}"
                   value="${currentW}" data-station-weight-input data-clear-on-focus data-station="${key}"
                   class="hx-space-weight-input" aria-label="${title} ${t("hyrox.weightAdjust.weightLabel")}">
            <span class="hx-space-weight-label">kg</span>
          </div>
        ` : `
          <div class="hx-space-weight">
            <span class="hx-space-weight-value">${formatWeight(defaultW)}</span>
            <span class="hx-space-weight-label">${t("hyrox.weightAdjust.weightLabel")}</span>
          </div>
        `;
      }
      return {
        stats: `
          ${weightBox}
          <div class="hx-space-laps">
            <span class="hx-space-laps-value">${rounds}</span>
            <span class="hx-space-laps-label">${t("hyrox.space.laps")}</span>
          </div>
        `,
        caption: "",
      };
    }

    // The whole race in order, start to finish, so the commitment is
    // legible BEFORE the clock starts rather than revealed one segment at
    // a time. Runs and stations alternate exactly as STATIONS declares, so
    // this stays correct automatically if that order ever changes.
    renderRaceAgenda() {
      const runM = runDistanceM(this.scale);
      const runCount = STATIONS.filter((s) => s.type === "run").length;
      const totalRunM = runM * runCount;

      const wrap = el(`
        <div class="hx-agenda">
          <div class="hx-step-label">${t("hyrox.step.agenda")}</div>
          <div class="hx-agenda-summary">
            <div class="hx-agenda-summary-item">
              <span class="hx-agenda-summary-value">${formatDistanceMeters(totalRunM)}</span>
              <span class="hx-agenda-summary-label">${t("hyrox.agenda.totalRunning", { n: runCount, each: formatDistanceMeters(runM) })}</span>
            </div>
            <div class="hx-agenda-summary-item">
              <span class="hx-agenda-summary-value">${STATION_ORDER.length}</span>
              <span class="hx-agenda-summary-label">${t("hyrox.agenda.stations")}</span>
            </div>
          </div>
          <ol class="hx-agenda-list" data-agenda-list></ol>
        </div>
      `);

      // Runs need nothing beyond their own title (runTitle() already bakes
      // the distance in, e.g. "1km Run"). Stations get the same box design
      // the old per-format lists used -- weight box, then a rounds/reps/
      // distance box -- so this one numbered list is the single place every
      // combo states "how heavy, how many," instead of a different
      // treatment depending on category/format.
      const listEl = wrap.querySelector("[data-agenda-list]");
      STATIONS.forEach((entry, i) => {
        const isRun = entry.type === "run";
        const { stats, caption } = isRun ? { stats: "", caption: "" } : this.stationStatsHtml(entry.key);
        listEl.appendChild(el(`
          <li class="hx-agenda-row ${isRun ? "is-run" : "is-station"}">
            <div class="hx-agenda-row-main">
              <span class="hx-agenda-num">${i + 1}</span>
              <span class="hx-agenda-icon">${stationIconSvg(isRun ? "run" : entry.key, 20)}</span>
              <span class="hx-agenda-name">${stationTitle(entry, this.scale)}</span>
              ${stats ? `<div class="hx-agenda-stats">${stats}</div>` : ""}
            </div>
            ${caption ? `<div class="hx-agenda-caption">${caption}</div>` : ""}
          </li>
        `));
      });

      return wrap;
    }

    // The page opener, in the home page's hero language: a dark gradient
    // card leading with the user's fastest time (or a warm first-race
    // invite), the 8 stations as tappable icon chips in race order (each
    // opens the existing how-to popup, so the old "New to Hyrox?" guide
    // card's job lives on here), and one clear CTA down to the steps.
    renderHeroCard() {
      const bests = this.getAllPersonalBests();
      const best = bests[0] || null;
      const raceCount = this.history.length;

      const card = el(`
        <div class="hx-hero">
          <div class="hx-hero-top">
            <div class="hx-hero-kicker">${t("hyrox.hero.kicker")}</div>
            ${raceCount ? `<div class="hx-hero-chip">\u{1F3C1} ${t("hyrox.hero.races", { n: raceCount, s: raceCount === 1 ? "" : "s" })}</div>` : ""}
          </div>
          ${best ? `
            <div class="hx-hero-title">${formatClock(best.totalSeconds)}</div>
            <div class="hx-hero-sub">${t("hyrox.hero.pbSub", { combo: comboLabel(best.gender, best.category, best.format) })}</div>
          ` : `
            <div class="hx-hero-title">${t("hyrox.hero.emptyTitle")}</div>
            <div class="hx-hero-sub">${t("hyrox.hero.emptySub")}</div>
          `}
          <div class="hx-hero-stations" data-hero-stations></div>
          <div class="hx-hero-hint">${t("hyrox.hero.tapHint")}</div>
          <button type="button" class="hx-hero-cta" data-action="hero-start">${t("hyrox.startRace")}</button>
          <button type="button" class="hx-hero-history-link" data-action="show-history">${t("hyrox.viewHistory")}</button>
        </div>
      `);

      const stationsEl = card.querySelector("[data-hero-stations]");
      STATION_ORDER.forEach((key, i) => {
        const title = STATIONS.find((s) => s.key === key).title;
        stationsEl.appendChild(el(`
          <button type="button" class="hx-hero-station" data-action="show-station-info" data-station="${key}" title="${title}" aria-label="${title}">
            <span class="hx-hero-station-num">${i + 1}</span>
            <span class="hx-hero-station-icon">${stationIconSvg(key, 20)}</span>
          </button>
        `));
      });

      return card;
    }

    // "Your training space": ask ONE question -- how long is your usable
    // floor space -- rather than the same question per station, since a
    // home/garage gym almost always has just one stretch of open floor
    // shared by every travelling movement. Below the single input, show
    // each station's resulting round count (read-only, derived) so the
    // user can see what that one answer means for every station at a
    // glance. Distances shown in meters (HYROX's own unit), not the km/mi
    // Settings preference.
    renderTrainingSpaceCard() {
      // Rendered inside the setup card (right after Step 3), so this is a
      // plain section -- not its own .hx-card box.
      // Photo credit: Unsplash (https://unsplash.com/license) -- free for
      // commercial use, no permission needed. Hotlinking their CDN is
      // supported; the card degrades gracefully (steps still readable) if
      // the image ever fails to load. A subtle credit sits bottom-right.
      const MEASURE_PHOTO = "https://images.unsplash.com/photo-1646656130703-8f95eed6a79b?w=1000&h=280&fit=crop&q=75&auto=format";
      const lane = this.getFacilityLane();
      const isCustom = typeof this.facilityLane === "number" && this.facilityLane > 0;
      const card = el(`
        <div class="hx-space-section">
          <div class="hx-step-label">${t("hyrox.space.title")}</div>
          <div class="hx-space-lead">${t("hyrox.space.intro")}</div>

          <div class="hx-measure-card">
            <div class="hx-measure-photo">
              <img class="hx-measure-img" src="${MEASURE_PHOTO}" alt="" loading="lazy">
              <div class="hx-measure-overlay">
                <span class="hx-measure-badge">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/></svg>
                  ${t("hyrox.space.measureTitle")}
                </span>
              </div>
              <a class="hx-measure-credit" href="https://unsplash.com/license" target="_blank" rel="noopener noreferrer">${t("hyrox.space.photoCredit")}</a>
            </div>
            <div class="hx-measure-steps">
              <div class="hx-measure-step">
                <span class="hx-measure-step-num">1</span>
                <span class="hx-measure-step-text"><strong>${t("hyrox.space.measureStep1Title")}</strong> ${t("hyrox.space.measureStep1Body")}</span>
              </div>
              <div class="hx-measure-step">
                <span class="hx-measure-step-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a1 1 0 0 1-1-1v-5a9 9 0 0 1 18 0v5a1 1 0 0 1-1 1h-2a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/><path d="M21 16v2a4 4 0 0 1-4 4h-5"/></svg>
                </span>
                <span class="hx-measure-step-text"><strong>${t("hyrox.space.measureStep2Title")}</strong> ${t("hyrox.space.measureStep2Body")}</span>
              </div>
            </div>
          </div>

          <div class="hx-space-lane-question">
            <label class="hx-space-field">
              <span class="hx-space-field-label">${t("hyrox.space.laneLabel")}</span>
              <span class="hx-space-input-wrap">
                <input type="number" inputmode="decimal" step="0.5" min="1" max="500" value="${lane}" data-facility-lane-input class="hx-space-input">
                <span class="hx-space-input-unit">m</span>
              </span>
            </label>
            ${isCustom ? `<button type="button" class="hx-weight-reset hx-space-reset" data-action="reset-facility-lane">${t("hyrox.weightAdjust.reset")}</button>` : ""}
          </div>

          <div data-race-fixed-note></div>
        </div>
      `);

      // The "practice mode, race day is fixed" caveat only earns its space
      // once the user has ACTUALLY moved something off the standard -- until
      // then it's a warning about something they haven't done, sitting on
      // top of every setup. hasAdjustments() gates it.
      if (this.format === "singles" && this.category === "pro" && this.hasAdjustments()) {
        card.querySelector("[data-race-fixed-note]").appendChild(el(`
          <div class="hx-race-fixed-banner">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a1 1 0 0 0 .86 1.5h18.64a1 1 0 0 0 .86-1.5L13.71 3.86a1 1 0 0 0-1.72 0z"/></svg>
            <div>${t("hyrox.weightAdjust.raceFixedWarning")}</div>
          </div>
        `));
      }

      // The per-station weight+laps list used to live here on its own.
      // It's now folded into the race agenda below (same box design,
      // stationStatsHtml()), shown in full race order instead of just the
      // 5 traveling stations -- one place stating "how heavy, how many"
      // for every combo, not a version that varies by format.
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
    // The at-a-glance numbers for one station on the standards card:
    // rounds (how many laps of the user's gym lane), total distance, and
    // the weight -- or reps/ball/target for Wall Balls, distance/machine
    // for SkiErg & Row. Always visible, no tapping needed.
    stationStandardChipsHtml(key) {
      const spec = STATION_SPECS[key];
      const chip = (value, label, cls) => `<div class="hx-std-chip ${cls || ""}"><span class="hx-std-chip-value">${value}</span><span class="hx-std-chip-label">${label}</span></div>`;

      if (key === "wallBalls") {
        return chip(spec.reps[this.gender], t("hyrox.space.chip.reps"))
          + chip(formatWeight(spec.ballKg[this.gender]), t("hyrox.space.chip.ball"))
          + chip(`${spec.targetFt[this.gender]}ft`, t("hyrox.space.chip.target"));
      }
      if (key === "skierg" || key === "row") {
        return chip(formatStationMeters(spec.distanceM), t("hyrox.space.chip.distance"))
          + chip(t("hyrox.space.chip.machineVal"), t("hyrox.space.chip.resistance"));
      }
      // Travelling stations: rounds (laps of the gym lane) + distance + weight.
      const rounds = Math.max(1, Math.ceil(spec.distanceM / this.getFacilityLane()));
      const parts = [
        chip(`${rounds}×`, t("hyrox.space.chip.rounds"), "is-rounds"),
        chip(formatStationMeters(spec.distanceM), t("hyrox.space.chip.distance")),
      ];
      const w = getDefaultStationWeightKg(key, this.gender, this.category);
      if (w) {
        let label = t("hyrox.space.chip.load");
        if (key === "sledPush" || key === "sledPull") label = t("hyrox.space.chip.sled");
        else if (key === "farmersCarry") label = t("hyrox.space.chip.perHand");
        else if (key === "lunges") label = t("hyrox.space.chip.sandbag");
        parts.push(chip(formatWeight(w), label));
      }
      return parts.join("");
    }

    renderWeightsCard() {
      const rows = STATION_ORDER.map((key) => {
        const title = STATIONS.find((s) => s.key === key).title;
        return `
          <div class="hx-std-row">
            <div class="hx-std-row-head">
              <span class="hx-std-icon">${stationIconSvg(key, 24)}</span>
              <span class="hx-std-name">${title}</span>
            </div>
            <div class="hx-std-chips">${this.stationStandardChipsHtml(key)}</div>
          </div>
        `;
      }).join("");

      return el(`
        <div class="hx-card">
          <div class="hx-step-label">${t("hyrox.weightsTitle", { category: categoryTitle(this.category), gender: genderTitle(this.gender) })}</div>
          <div class="hx-std-list">${rows}</div>
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
          ${chip(scaledWallBallReps(this.gender, this.scale), t("hyrox.space.chip.reps"))}
          ${chip(formatWeight(spec.ballKg[this.gender]), t("hyrox.space.chip.ball"))}
          ${chip(`${spec.targetFt[this.gender]}ft`, t("hyrox.space.chip.target"))}
        </div>`;
      }
      if (key === "skierg" || key === "row") {
        // Just the distance -- the old second chip ("Resistance: Bodyweight")
        // was machine-damper jargon that didn't tell the lifter anything
        // actionable.
        return `<div class="hx-now-chips">
          ${chip(formatStationMeters(scaledStationDistanceM(key, this.scale)), t("hyrox.space.chip.distance"))}
        </div>`;
      }

      // Travelling/loaded stations (sled push/pull, farmers carry, sandbag
      // lunges). No meters anywhere here -- reported as confusing/jargony.
      // What actually matters to a lifter standing in their gym is (1) how
      // many times do I go, and (2) how heavy. So the hero is a plain round
      // count (their own share of it in Doubles, the full count in Singles)
      // and the only supporting line is the weight to carry/push/pull.
      const rounds = this.roundsFor(key);
      const isSled = key === "sledPush" || key === "sledPull";

      // In Doubles, split the round count proportionally to the share the
      // lifter configured at setup (getDoublesSplit's mine/total, tracked
      // in the sport's own units -- 12.5m sled segments, or raw meters for
      // farmers carry/lunges) rather than a second, separate share number.
      // One consistent "rounds" figure everywhere beats reconciling two.
      const split = this.format === "doubles" ? this.getDoublesSplit(key) : null;
      const heroValue = split
        ? Math.max(1, Math.round(rounds * (split.mine / split.total)))
        : rounds;
      const heroLabel = split ? t("hyrox.running.yourShare") : t("hyrox.running.roundsLabel");

      const w = this.getStationWeight(key);
      let caption = "";
      if (w) {
        let label = t("hyrox.space.chip.load");
        if (isSled) label = t("hyrox.space.chip.sled");
        else if (key === "farmersCarry") label = t("hyrox.space.chip.perHand");
        else if (key === "lunges") label = t("hyrox.space.chip.sandbag");
        caption = `<div class="hx-now-caption">${formatWeight(w)} ${label.toLowerCase()}</div>`;
      }

      return `
        <div class="hx-now-hero${split ? " is-share" : ""}">
          <div class="hx-now-hero-value">${heroValue}</div>
          <div class="hx-now-hero-label">${heroLabel}</div>
        </div>
        ${caption}
      `;
    }

    // Custom races have no weight system to report (see stationNowChipsHtml,
    // which is entirely about Pro-adjustable weight) -- just the entry's own
    // configured amount. Lane-traversed stations (see CUSTOM_ROUND_BASED_KEYS)
    // get the same hero-number treatment the standard race's rounds get
    // (stationNowChipsHtml) -- the round count as the headline number, with
    // the meters the user actually configured underneath it as a caption,
    // so both "how many times do I go" and "how far did I say this was"
    // stay visible. Everything else (runs, machine efforts, Wall Balls)
    // keeps the plain single amount chip, unchanged.
    customAmountChipHtml(segment) {
      if (CUSTOM_ROUND_BASED_KEYS.includes(segment.key)) {
        const rounds = Math.max(1, Math.ceil(segment.amount / this.getFacilityLane()));
        return `
          <div class="hx-now-hero">
            <div class="hx-now-hero-value">${rounds}</div>
            <div class="hx-now-hero-label">${t("hyrox.running.roundsLabel")}</div>
          </div>
          <div class="hx-now-caption">${formatCustomAmount(segment.key, segment.amount)}</div>
        `;
      }
      const label = segment.key === "wallBalls" ? t("hyrox.space.chip.reps") : t("hyrox.standards.chip.distance");
      return `
        <div class="hx-space-weight">
          <span class="hx-space-weight-value">${formatCustomAmount(segment.key, segment.amount)}</span>
          <span class="hx-space-weight-label">${label}</span>
        </div>
      `;
    }

    renderRunning() {
      const isCustom = this.raceType === "custom";
      const sequence = this.raceSequence();
      const segment = sequence[this.stationIndex];
      const isLast = this.stationIndex >= sequence.length - 1;
      // No subtitle text under the title -- the icon + "1km Run"/station
      // name already says what it is; the chips/hero above carry whatever
      // actionable detail there is (weight, rounds, distance). Custom races
      // show their own amount chip for every segment (including runs --
      // see renderCustomBuilder(), a custom race's runs can be any length),
      // not just stations.
      const detailHtml = isCustom
        ? this.customAmountChipHtml(segment)
        : (segment.type === "station" ? this.stationNowChipsHtml(segment.key) : "");
      const iconKey = segment.type === "station" ? segment.key : "run";
      const progressPct = Math.round((this.stationIndex / sequence.length) * 100);
      const segmentTitle = isCustom ? segment.title : stationTitle(segment, this.scale);
      // A persistent badge so the chosen format is visible on every segment,
      // not just at setup -- the reported bug was that a Doubles race looked
      // exactly like a Singles one once started.
      const formatBadge = this.format === "doubles"
        ? `<span class="hx-run-format-badge">${t("hyrox.running.doublesBadge")}</span>`
        : "";

      const card = el(`
        <div class="hx-card hx-run-card">
          <div class="hx-run-head">
            <div class="hx-run-stat">
              <span class="hx-run-stat-value" data-timer-display>${formatClock(this.elapsedSeconds)}</span>
              <span class="hx-run-stat-label">${t("hyrox.running.elapsed")}</span>
            </div>
            <div class="hx-run-stat">
              <span class="hx-run-stat-value hx-run-count">${this.stationIndex + 1}<span class="hx-run-count-total">/${sequence.length}</span></span>
              <span class="hx-run-stat-label">${t("hyrox.running.segmentLabel")}${formatBadge}</span>
            </div>
          </div>

          <div class="hx-now">
            <div class="hx-now-kicker">${t("hyrox.running.upNow")}</div>
            <div class="hx-now-badge">${stationIconSvg(iconKey, 48)}</div>
            <div class="hx-now-title">${segmentTitle}</div>
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
            <span>${isLast ? t("hyrox.finishRace") : t("hyrox.complete.generic")}</span>
          </button>

          <button type="button" class="hx-danger-link hx-run-cancel" data-action="cancel-race">${t("hyrox.cancelThisRace")}</button>

          <div class="hx-splits-head" data-splits-head hidden></div>
          <div class="hx-splits-list" data-splits></div>
        </div>
      `);

      const dotsEl = card.querySelector("[data-dots]");
      sequence.forEach((s, i) => {
        const cls = i < this.stationIndex ? "is-done" : i === this.stationIndex ? "is-current" : "";
        const dotTitle = isCustom ? s.title : stationTitle(s, this.scale);
        dotsEl.appendChild(el(`<div class="hx-progress-dot ${cls}" title="${dotTitle}"></div>`));
      });

      const headEl = card.querySelector("[data-splits-head]");
      if (this.splits.length) {
        headEl.hidden = false;
        headEl.textContent = t("hyrox.running.doneLabel", { count: this.splits.length });
      }

      const splitsEl = card.querySelector("[data-splits]");
      this.splits.slice().reverse().forEach((s, i) => {
        const idx = this.splits.length - i;
        const prev = this.splits[idx - 2];
        const delta = prev ? s.atSeconds - prev.atSeconds : s.atSeconds;
        splitsEl.appendChild(el(`
          <div class="hx-split-row">
            <span class="hx-split-row-icon">${stationIconSvg(splitIconKey(s.key), 18)}</span>
            <span class="hx-split-row-name">${s.title}</span>
            <span class="hx-split-row-times">
              <span class="hx-split-row-delta">${formatClockPrecise(delta)}</span>
              <span class="hx-split-row-total">${formatClock(s.atSeconds)}</span>
            </span>
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
    // reads as a priority order, not 8 identical boxes. Returns an element,
    // or null when there's nothing to show at all (custom races) -- callers
    // must skip appending in that case.
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
      // The coaching prompt is built around the fixed standard stations --
      // a custom race's station mix (and count) is open-ended, so there's
      // no standard to coach against. We render nothing at all rather than a
      // placeholder note. This is still the actual gate (finishRace()
      // also skips the auto-analysis call for custom races, but this is
      // what stops the lazy "!cache" fallback below from firing one anyway
      // the first time this ever renders for a custom result).
      if (result.category === "custom") {
        return null;
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
      const analysisNode = this.renderRaceAnalysis(result);
      if (analysisNode) card.querySelector("#hx-analysis-slot").appendChild(analysisNode);

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
        const dateLabel = new Date(r.date).toLocaleDateString(RepCheckI18n.locale(), { month: "short", day: "numeric", year: "numeric" });
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

    // Your own PBs, scoped to your own gender and split into a Singles
    // section and a Doubles section -- shown on the setup screen right
    // under the leaderboard. Different from renderPersonalBests() above
    // (the history screen's card): that one reads local `history` and
    // shows every combo you've ever raced, including a different gender
    // if you ever switched your leaderboard preference mid-history. This
    // one is sourced from the server (loadMyBests(), same endpoint the
    // leaderboard card itself uses) so it always agrees with what your own
    // leaderboard shows -- a result recorded on another device, or before
    // this card existed, is still correctly shown here, not silently
    // dropped because this particular browser's local history doesn't
    // have it. No gender resolved yet (first visit, no race finished, no
    // coaching profile) -> nothing to scope to, so the card doesn't render
    // at all rather than guessing.
    renderMyBestsCard() {
      const gender = this.resolveLeaderboardGender();
      if (!gender) return null;
      if (!this.myBestsCache || this.myBestsCache.gender !== gender) {
        this.loadMyBests(); // async; re-renders itself once the 4 combos resolve
        return null;
      }
      if (this.myBestsCache.loading) return null;
      const bests = this.myBestsCache.entries;
      if (!bests.length) return null;

      const card = el(`
        <div class="hx-card">
          <div class="pb-header">
            <div class="pb-trophy">${TROPHY_ICON}</div>
            <div class="hx-step-label">${t("hyrox.pb.myBestsTitle")}</div>
          </div>
          <div data-my-pb-sections></div>
        </div>
      `);
      const sectionsEl = card.querySelector("[data-my-pb-sections]");
      // FORMAT_IDS order (singles, doubles) fixes the section order; within
      // each section, entries are already fastest-to-slowest because
      // loadMyBests() sorts ascending by time and filtering by format
      // preserves relative order, so rows[0] is always the fastest tier --
      // that's the one shown collapsed. A format with only one tier raced
      // gets no chevron and no expand affordance: there's nothing to
      // expand into, so pretending otherwise would be a dead tap target.
      FORMAT_IDS.forEach((formatId) => {
        const rows = bests.filter((r) => r.format === formatId);
        if (!rows.length) return; // no Doubles PB yet -- skip the section, don't show it empty
        const isOpen = this.pbExpandedFormats.has(formatId);
        const hasMultiple = rows.length > 1;
        const hero = this.pbTimeButtonHtml(rows[0], "pb-time-btn pb-hero-time");

        // pb-section-trigger is a div[role=button], not a real <button>,
        // because it wraps its own nested <button> (the hero time) -- see
        // the constructor comment for why real buttons can't nest.
        const triggerAttrs = hasMultiple
          ? `data-action="toggle-pb-format" data-format="${formatId}" role="button" tabindex="0" aria-expanded="${isOpen}"`
          : "";
        const section = el(`
          <div class="pb-section ${isOpen ? "is-open" : ""}">
            <div class="pb-section-trigger" ${triggerAttrs}>
              <div class="pb-trigger-main">
                <div class="pb-format-title">${formatTitle(formatId)}</div>
                <div class="pb-hero-row">
                  ${hero.html}
                  <span class="pb-hero-tag">${categoryTitle(rows[0].category)}</span>
                </div>
              </div>
              ${hasMultiple ? `<span class="pb-chevron">${CHEVRON_DOWN_ICON}</span>` : ""}
            </div>
          </div>
        `);

        if (hasMultiple) {
          const detail = el(`<div class="pb-detail"><div class="pb-detail-inner" data-pb-detail-rows></div></div>`);
          const detailRows = detail.querySelector("[data-pb-detail-rows]");
          rows.forEach((r) => {
            const btn = this.pbTimeButtonHtml(r, "pb-time-btn pb-detail-time");
            const localMatch = btn.localMatch;
            // The server's leaderboard `me` field is just {rank,
            // best_seconds, name} -- no date. Best-effort only: shown when
            // this exact time also matches something in local history
            // (see pbTimeButtonHtml), an em dash otherwise rather than
            // fabricating one.
            const dateHtml = localMatch
              ? t("hyrox.pb.setPrefix", {
                  date: new Date(localMatch.date).toLocaleDateString(RepCheckI18n.locale(), { month: "short", day: "numeric", year: "numeric" }),
                })
              : "&mdash;";
            detailRows.appendChild(el(`
              <div class="pb-detail-row">
                ${btn.html}
                <div class="pb-detail-meta">
                  <div class="pb-detail-tag">${categoryTitle(r.category)}</div>
                  <div class="pb-detail-date">${dateHtml}</div>
                </div>
              </div>
            `));
          });
          section.appendChild(detail);
        }
        sectionsEl.appendChild(section);
      });
      return card;
    }

    // One PB time as a clickable button: opens the full race report
    // (renderRaceDetailModal -- the same breakdown + AI analysis History
    // already shows) when this result matches something in local history,
    // since that's the only place a race id/splits exist to open. The
    // leaderboard endpoint this card sources from only ever returns
    // {rank, best_seconds, name} -- never an id -- so a result set on
    // another device (or before local history existed) has nothing to
    // open; the button still exists, but taps it show a toast instead of
    // silently doing nothing or opening a fake report.
    pbTimeButtonHtml(r, cls) {
      // Closest match wins, not first match: two attempts at the same
      // combo within 0.5s of each other would otherwise let array order
      // pick the wrong race's report to open behind the PB's own time.
      const candidates = this.history.filter(
        (h) => !h.flagged && h.gender === r.gender && h.category === r.category && h.format === r.format && Math.abs(h.totalSeconds - r.totalSeconds) < 0.5
      );
      const localMatch = candidates.length
        ? candidates.reduce((closest, h) => (Math.abs(h.totalSeconds - r.totalSeconds) < Math.abs(closest.totalSeconds - r.totalSeconds) ? h : closest))
        : undefined;
      const attrs = localMatch ? `data-action="show-race-detail" data-id="${localMatch.id}"` : `data-action="pb-no-detail"`;
      return { html: `<button type="button" class="${cls}" ${attrs}>${formatClock(r.totalSeconds)}</button>`, localMatch };
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
            <div class="hx-lb-title-group">
              <div class="hx-lb-trophy">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
              </div>
              <div class="hx-lb-title">${t("hyrox.leaderboard.button")}</div>
            </div>
            <div class="hx-lb-gender-toggle" data-lb-gender-toggle></div>
          </div>
          <div class="hx-lb-tabs" data-lb-tabs></div>
          <div class="hx-lb-list" data-lb-list></div>
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
        // One row per athlete: rank badge (gold/silver/bronze tint for the
        // podium), name -- with a quiet "You" tag on your own row -- and
        // the time on the right. Much less to read than the old
        // time-vs-rank double stack.
        const rowHtml = (rank, name, seconds, isMe) => `
          <div class="hx-lb-row ${isMe ? "is-me" : ""}">
            <span class="hx-lb-rank ${rank <= 3 ? `is-top is-top-${rank}` : ""}">${rank}</span>
            <span class="hx-lb-name">${name}${isMe ? `<span class="hx-lb-you">${t("hyrox.leaderboard.you")}</span>` : ""}</span>
            <span class="hx-lb-time">${formatClock(seconds)}</span>
          </div>
        `;
        if (!rows.length) {
          listEl.appendChild(el(`<div class="hx-history-empty">${t("hyrox.leaderboard.empty")}</div>`));
        } else {
          const myRank = cache.data.me ? cache.data.me.rank : null;
          rows.forEach((r, i) => {
            listEl.appendChild(el(rowHtml(i + 1, r.name, r.best_seconds, i + 1 === myRank)));
          });
          listEl.appendChild(el(`<div class="hx-lb-total">${t("hyrox.leaderboard.totalAthletes", { n: totalEntries, s: totalEntries === 1 ? "" : "s" })}</div>`));
        }

        if (cache.data.me && !rows.some((r, i) => i + 1 === cache.data.me.rank)) {
          // Fallback for when "you" are outside the visible top rows --
          // same row shape, just appended below the list.
          const me = cache.data.me;
          meEl.appendChild(el(rowHtml(me.rank, me.name, me.best_seconds, true)));
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
        listEl.appendChild(el(`
          <div class="hx-history-empty-rich">
            <div class="hx-history-empty-icon">\u{23F1}\u{FE0F}</div>
            <div class="hx-history-empty-title">${t("hyrox.nothingYet")}</div>
            <div class="hx-history-empty-sub">${t("hyrox.nothingYetSub")}</div>
          </div>
        `));
      } else {
        rows.forEach((r) => {
          const dateLabel = new Date(r.date).toLocaleDateString(RepCheckI18n.locale(), { month: "short", day: "numeric", year: "numeric" });
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
