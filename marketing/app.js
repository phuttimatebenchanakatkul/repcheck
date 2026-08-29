(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var yearEl = $("#year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // ---------- hero dot field: a grid of dots that pushes away from the cursor ----------
  var canvas = $("#dotfield");
  var hero = $(".hero");
  if (canvas && hero && !reduced) {
    var ctx = canvas.getContext("2d");
    var mouse = { x: -9999, y: -9999 };
    var pos = { x: -9999, y: -9999 };
    var dpr = 1, cw = 0, ch = 0;

    function size() {
      var r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cw = r.width; ch = r.height;
      canvas.width = Math.max(1, Math.round(cw * dpr));
      canvas.height = Math.max(1, Math.round(ch * dpr));
    }

    function frame() {
      requestAnimationFrame(frame);
      pos.x += (mouse.x - pos.x) * 0.16;
      pos.y += (mouse.y - pos.y) * 0.16;
      var hr = hero.getBoundingClientRect();
      var lx = pos.x - hr.left, ly = pos.y - hr.top;
      var inside = mouse.x > -1000 && pos.y > hr.top - 40 && pos.y < hr.bottom + 40;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      var gap = 30, R = 190;
      for (var x = gap / 2; x < cw; x += gap) {
        for (var y = gap / 2; y < ch; y += gap) {
          var dx = x - lx, dy = y - ly;
          var d = Math.sqrt(dx * dx + dy * dy);
          var f = inside && d < R ? 1 - d / R : 0;
          f = f * f;
          var push = f * 26;
          var px = d > 0.01 ? x + (dx / d) * push : x;
          var py = d > 0.01 ? y + (dy / d) * push : y;
          var g = Math.round(226 - f * 200);
          ctx.fillStyle = "rgb(" + g + "," + g + "," + g + ")";
          ctx.beginPath();
          ctx.arc(px, py, 1.1 + f * 2.1, 0, 6.2832);
          ctx.fill();
        }
      }
    }

    window.addEventListener("mousemove", function (e) { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
    window.addEventListener("resize", size);
    size();
    frame();
  }

  // ---------- magnetic buttons ----------
  $$("[data-magnet]").forEach(function (el) {
    el.addEventListener("mousemove", function (e) {
      var r = el.getBoundingClientRect();
      var dx = (e.clientX - (r.left + r.width / 2)) * 0.28;
      var dy = (e.clientY - (r.top + r.height / 2)) * 0.34;
      el.style.transition = "transform 0.08s linear";
      el.style.transform = "translate(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px)";
    });
    el.addEventListener("mouseleave", function () {
      el.style.transition = "transform 0.4s cubic-bezier(.2,.8,.2,1)";
      el.style.transform = "translate(0,0)";
    });
  });

  // ---------- feature switcher: each feature plays its real app screen ----------
  // Feature index -> which app tab that screen lives under (see base.html's tab bar).
  var TAB_FOR_FEATURE = [4, 2, 0, 1, 3, -1];
  // Scoped to section 01. These used to be document-wide, which meant the
  // race walkthrough's phone further down the page (its own screen, its own
  // tab bar) got swept into the same lists -- showFeature(0) then stripped
  // is-active off it on load and left that handset blank.
  var whatSection = $(".what");
  var featureBtns = $$(".feature", whatSection);
  var screens = $$(".screen", whatSection);
  var tabs = $$(".tab", whatSection);

  // Some screens are real screen recordings rather than mocked-up cards. Play
  // whichever one is showing, and pause + rewind the rest so they don't keep
  // running silently behind the screens you can't see.
  function showFeature(i) {
    featureBtns.forEach(function (b, n) { b.classList.toggle("is-active", n === i); });
    screens.forEach(function (s, n) { s.classList.toggle("is-active", n === i); });
    tabs.forEach(function (t, n) { t.classList.toggle("is-active", n === TAB_FOR_FEATURE[i]); });
    screens.forEach(function (s, n) {
      var video = s.querySelector("video");
      if (!video) return;
      if (n === i) {
        // play() rejects if the browser declines autoplay -- ignore it and
        // leave the poster up rather than throwing an unhandled rejection.
        var playing = video.play();
        if (playing && playing.catch) playing.catch(function () {});
      } else {
        video.pause();
        video.currentTime = 0;
      }
    });
    // Same rule for the workout log's scripted screen: it only runs while it
    // is the one showing, so it isn't looping behind screens you can't see.
    if (wlScreen) {
      if (screens.indexOf(wlScreen) === i) wlPlay();
      else wlStop();
    }
  }

  // ---------- workout log: act out the add-exercise flow ----------
  // Feature 04 is about logging a set, so its screen does exactly that on a
  // loop: empty day, tap "+ Log an exercise", the exercise lands, then the
  // weight and the reps count up into it. Beats are data-wl on the screen
  // (styles.css does the revealing); the numbers are the only text written
  // here, and only into elements that already exist.
  var wlScreen = $('.screen[data-wl]', whatSection);
  var wlTimers = [];
  var WL_WEIGHT = 30;
  var WL_REPS = 10;

  function wlClear() {
    wlTimers.forEach(clearTimeout);
    wlTimers = [];
  }
  function wlAt(ms, fn) { wlTimers.push(setTimeout(fn, ms)); }
  function wlSet(beat, weight, reps) {
    if (!wlScreen) return;
    wlScreen.setAttribute("data-wl", String(beat));
    wlScreen.querySelector(".wl-weight").textContent = String(weight);
    wlScreen.querySelector(".wl-reps").textContent = String(reps);
  }

  function wlStop() {
    wlClear();
    // Park on the finished set rather than the empty day: a paused screen
    // should still show what the feature does, not a blank one.
    wlSet(3, WL_WEIGHT, WL_REPS);
  }

  function wlPlay() {
    if (!wlScreen) return;
    wlClear();
    // Reduced motion gets the end state, held. No loop, no counting.
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      wlSet(3, WL_WEIGHT, WL_REPS);
      return;
    }
    wlSet(0, 0, 0);
    wlAt(900, function () { wlScreen.setAttribute("data-wl", "1"); });
    // The exercise picker: sheet slides up, a row gets tapped, sheet slides
    // back down as the exercise lands -- see it before it just appears.
    wlAt(1350, function () { wlScreen.setAttribute("data-wl", "picker"); });
    wlAt(2000, function () { wlScreen.setAttribute("data-wl", "picked"); });
    wlAt(2350, function () { wlSet(2, 0, 0); });
    // Weight first, then reps -- the order you actually type them in.
    for (var w = 1; w <= WL_WEIGHT; w++) {
      (function (v) { wlAt(2350 + v * 20, function () { wlSet(3, v, 0); }); })(w);
    }
    for (var r = 1; r <= WL_REPS; r++) {
      (function (v) { wlAt(3100 + v * 55, function () { wlSet(3, WL_WEIGHT, v); }); })(r);
    }
    wlAt(6650, wlPlay);
  }

  featureBtns.forEach(function (b, i) {
    b.addEventListener("click", function () { showFeature(i); });
    b.addEventListener("mouseenter", function () { showFeature(i); });
  });
  showFeature(0);

  // ---------- rep-by-rep chart ----------
  var NOTES = [
    "Rep 1 — clean setup, brace held through the descent.",
    "Rep 2 — best rep of the set. Bar path dead vertical.",
    "Rep 3 — depth to parallel, knees tracking over toes.",
    "Rep 4 — slight forward lean out of the hole.",
    "Rep 5 — depth shallow by ~4°, tempo slowing.",
    "Rep 6 — knees start caving. Cue: drive the knees out.",
    "Rep 7 — same fault, deeper. Bar drifting forward.",
    "Rep 8 — fatigue set in. Cut the set here, or drop 5 kg."
  ];
  var DEFAULT_NOTE = "Every rep scored against the movement's real standards — hover a bar to read the call.";
  var note = $("#rep-note");
  $$(".bar").forEach(function (bar, i) {
    bar.addEventListener("mouseenter", function () {
      $$(".bar").forEach(function (b) { b.classList.remove("is-on"); });
      bar.classList.add("is-on");
      if (note) note.textContent = NOTES[i];
    });
    bar.addEventListener("mouseleave", function () {
      bar.classList.remove("is-on");
      if (note) note.textContent = DEFAULT_NOTE;
    });
  });

  // ---------- race walkthrough: the app's four HYROX screens, playable ----------
  // Section 04 replays one athlete's 1:24:06 Men's Open Singles race through
  // the same four screens the app renders -- simulator, race setup, running
  // clock, finish. Everything factual is lifted from the shipping app rather
  // than written for this page:
  //   * the 8+8 segment order and the run/station titles  (static/hyrox.js STATIONS)
  //   * Open/Pro loads, wall-ball reps and target height  (STATION_SPECS)
  //   * lap counts off a 12.5m lane                       (DEFAULT_LANE_M, roundsFor)
  //   * the "how it's done" copy behind every station      (static/i18n.js hyrox.standards.*)
  //   * the finish breakdown and the coach's focus/strong/solid grouping
  //                                                       (hyrox_coach.py)
  var raceRoot = $("#race");
  if (raceRoot) {
    var rcScreen = $("#rc-screen");
    var rcWatch = $("#rc-watch");
    var rcSteps = $("#rc-steps");

    // The app's own station pictograms (static/hyrox.js STATION_ICONS),
    // copied verbatim so a station looks the same here as in the product.
    var RC_ICONS = {
      run: '<circle cx="32" cy="8" r="3.5"/><path d="M29 11L21 22"/><path d="M21 22L29 24L32 33"/><path d="M21 22L14 25L10 16"/><path d="M29 11L22 15L18 10"/><path d="M29 11L37 14L41 11"/>',
      skierg: '<path d="M38 2V44"/><circle cx="38" cy="4" r="2.2"/><path d="M38 4L26 25"/><circle cx="16" cy="9" r="3.5"/><path d="M17 12L21 23"/><path d="M18 15L26 25"/><path d="M21 23L16 32L13 40"/><path d="M21 23L25 32L28 40"/>',
      sledPush: '<circle cx="10" cy="14" r="3.2"/><path d="M11 17l8 6"/><path d="M19 23l-2 8"/><path d="M19 23l6 6"/><path d="M13 18l10 2"/><rect x="28" y="18" width="14" height="10" rx="1.5"/><path d="M23 20l5 1M23 24l5 2"/>',
      sledPull: '<circle cx="14" cy="12" r="3.2"/><path d="M14 15l3 9"/><path d="M17 24l-2 8"/><path d="M17 24l6 4"/><path d="M12 17l8-3"/><path d="M20 14l14 2"/><rect x="36" y="12" width="8" height="8" rx="1.5"/>',
      burpeeBroadJump: '<circle cx="24" cy="10" r="3.2"/><path d="M24 13l-2 6"/><path d="M22 19l-6 4"/><path d="M22 19l7 2"/><path d="M22 19l-3 9"/><path d="M22 19l6 8"/><path d="M6 40h36" stroke-dasharray="2 4"/>',
      row: '<path d="M4 38h40"/><circle cx="30" cy="14" r="3.2"/><path d="M30 17l-2 8"/><path d="M28 25l-10 4"/><path d="M28 25l6 6"/><path d="M28 33l-8 5"/><path d="M28 33l6 5"/><path d="M18 29l-10 2"/>',
      farmersCarry: '<circle cx="24" cy="8" r="3.2"/><path d="M24 11v14"/><path d="M24 13l-8 2"/><path d="M24 13l8 2"/><circle cx="15" cy="24" r="3"/><circle cx="33" cy="24" r="3"/><path d="M24 25l-6 10"/><path d="M24 25l6 10"/>',
      lunges: '<circle cx="20" cy="8" r="3.2"/><ellipse cx="28" cy="12" rx="6" ry="4" transform="rotate(20 28 12)"/><path d="M20 11v10"/><path d="M20 21l-8 6"/><path d="M12 27l2 8"/><path d="M20 21l6 4"/><path d="M26 25v9"/>',
      wallBalls: '<path d="M40 2v40"/><circle cx="34" cy="8" r="2.5"/><circle cx="18" cy="10" r="3.2"/><path d="M18 13v8"/><path d="M18 15l-6-4"/><path d="M18 15l8-6"/><circle cx="26" cy="9" r="2.2"/><path d="M18 21l-6 8"/><path d="M18 21l7 7"/>'
    };
    function rcIcon(key, size) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 48 48" fill="none" stroke="currentColor" ' +
        'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' + (RC_ICONS[key] || RC_ICONS.run) + '</svg>';
    }

    // Men's standards, straight out of STATION_SPECS. Gender is fixed to Men
    // here (the app reads it off your coaching profile instead of asking);
    // category is switchable below and really does swap every load.
    var RC_SPECS = {
      skierg:          { distanceM: 1000 },
      sledPush:        { distanceM: 50,  weightKg:  { open: 152, pro: 202 } },
      sledPull:        { distanceM: 50,  weightKg:  { open: 103, pro: 152 } },
      burpeeBroadJump: { distanceM: 80 },
      row:             { distanceM: 1000 },
      farmersCarry:    { distanceM: 200, perHandKg: { open: 24,  pro: 32 } },
      lunges:          { distanceM: 100, sandbagKg: { open: 20,  pro: 30 } },
      wallBalls:       { reps: 100, ballKg: 6, targetFt: 9 }
    };
    var RC_LANE_M = 12.5;   // hyrox.js DEFAULT_LANE_M
    var RC_RATE = 60;       // 1 real second = 1 race minute

    // 8 x 1km runs alternating with the 8 stations, with this athlete's
    // splits in seconds. Runs 49:02, stations 35:04, race 1:24:06.
    var RC_SEQ = [
      { type: "run",     key: "run1",                                         seconds: 342 },
      { type: "station", key: "skierg",          title: "SkiErg",             seconds: 264 },
      { type: "run",     key: "run2",                                         seconds: 360 },
      { type: "station", key: "sledPush",        title: "Sled Push",          seconds: 198 },
      { type: "run",     key: "run3",                                         seconds: 366 },
      { type: "station", key: "sledPull",        title: "Sled Pull",          seconds: 282 },
      { type: "run",     key: "run4",                                         seconds: 378 },
      { type: "station", key: "burpeeBroadJump", title: "Burpee Broad Jumps", seconds: 294 },
      { type: "run",     key: "run5",                                         seconds: 372 },
      { type: "station", key: "row",             title: "Rowing",             seconds: 258 },
      { type: "run",     key: "run6",                                         seconds: 370 },
      { type: "station", key: "farmersCarry",    title: "Farmers Carry",      seconds: 132 },
      { type: "run",     key: "run7",                                         seconds: 374 },
      { type: "station", key: "lunges",          title: "Sandbag Lunges",     seconds: 276 },
      { type: "run",     key: "run8",                                         seconds: 380 },
      { type: "station", key: "wallBalls",       title: "Wall Balls",         seconds: 400 }
    ];
    var RC_CUM = (function () {
      var out = [], total = 0;
      RC_SEQ.forEach(function (s) { total += s.seconds; out.push(total); });
      return out;
    })();
    var RC_TOTAL = RC_CUM[RC_CUM.length - 1];
    var RC_KEYS = ["skierg", "sledPush", "sledPull", "burpeeBroadJump", "row", "farmersCarry", "lunges", "wallBalls"];
    var RC_TITLES = {
      skierg: "SkiErg", sledPush: "Sled Push", sledPull: "Sled Pull",
      burpeeBroadJump: "Burpee Broad Jumps", row: "Rowing",
      farmersCarry: "Farmers Carry", lunges: "Sandbag Lunges", wallBalls: "Wall Balls"
    };
    // Short labels for the 4x2 chip grid, matching the app's own HYROX screen.
    var RC_SHORT = {
      skierg: "SkiErg", sledPush: "Sled Push", sledPull: "Sled Pull",
      burpeeBroadJump: "Burpees", row: "Row", farmersCarry: "Carry",
      lunges: "Lunges", wallBalls: "Wall Balls"
    };

    // hyrox_coach.py asks Gemini for exactly this shape -- one short overall
    // line plus detail bullets, then one rated tip per station -- so this is
    // the format an athlete really gets back, written against those splits.
    var RC_COACH = {
      overall: "Wall balls and the sled pull are where this race went — not the running.",
      detail: [
        "Running was 49:02 of the 1:24:06, held at roughly 6:07/km. Steady, and not the problem.",
        "Wall balls took 6:40 — the longest single segment of the whole race.",
        "The sled pull at 4:42 was your slowest station after that, and run 4 came out 15 seconds slower for it.",
        "Fix wall balls first, sled pull second. Leave the running alone."
      ],
      tips: {
        wallBalls:       { rating: "focus",  tip: "Break the 100 into sets of 10 from the first rep instead of going to failure at 25." },
        sledPull:        { rating: "focus",  tip: "Sit back and hang your body weight on the rope instead of pulling with your arms." },
        farmersCarry:    { rating: "strong", tip: "2:12 with 24 kg per hand is a real strength — walk it straight into run 7 without setting down." },
        sledPush:        { rating: "strong", tip: "3:18 without a single stop; keep the low arm angle you already have." },
        row:             { rating: "solid",  tip: "4:18 is well judged — hold that pace rather than chasing a faster 1000m." },
        skierg:          { rating: "solid",  tip: "4:24 to open the race is sensible; don't spend the extra 10 seconds here." },
        burpeeBroadJump: { rating: "solid",  tip: "4:54 is fine — a smaller jump with no pause beats a big jump and a rest." },
        lunges:          { rating: "solid",  tip: "4:36 held together; keep the sandbag high on the traps for the last 25m." }
      }
    };

    // Verbatim from static/i18n.js (hyrox.standards.*) -- what the app shows
    // when you tap a station on its HYROX screen.
    var RC_HOWTO = {
      skierg:          { fact: "No added weight — just your own effort.", detail: "1000m on the ski erg, powered entirely by your own effort — there's no weight or resistance setting to worry about." },
      row:             { fact: "No added weight — just your own effort.", detail: "1000m on the rowing machine, powered entirely by your own effort — same idea as the ski erg, just a different machine." },
      burpeeBroadJump: { fact: "Bodyweight only, no equipment.", detail: "Drop down, push back up, then jump forward as far as you can — repeated over and over until you've covered 80m. No equipment, just your body weight." },
      sledPush:        { fact: "Fixed weight — can't be made lighter on race day.", detail: "The loaded sled is pushed away from you for 4 rounds of 12.5m each, covering the full 50m." },
      sledPull:        { fact: "Fixed weight — can't be made lighter on race day.", detail: "The loaded sled is pulled toward you using a rope for 4 rounds of 12.5m each, covering the full 50m." },
      farmersCarry:    { fact: "No putting the weights down along the way.", detail: "Carried as 2 x {w} kettlebells, one in each hand, walking the full distance without putting them down." },
      lunges:          { fact: "The sandbag stays on your shoulders the whole way.", detail: "A {w} sandbag carried across the shoulders for the full distance." },
      wallBalls:       { fact: "Every rep needs a full squat before the throw.", detail: "A ball is squatted down and thrown up to a target 9 ft up the wall, for 100 reps total." }
    };

    var rc = { screen: "hero", category: "open", format: "singles", scale: "full",
               index: 0, elapsed: 0, splits: [], info: null, timer: null };

    function rcClock(total) {
      var s = Math.max(0, Math.floor(total));
      var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      return (h > 0 ? h + ":" : "") + (h > 0 ? ("0" + m).slice(-2) : String(m)) + ":" + ("0" + sec).slice(-2);
    }
    function rcMmSs(total) {
      var s = Math.max(0, Math.floor(total));
      return ("0" + Math.floor(s / 60)).slice(-2) + ":" + ("0" + (s % 60)).slice(-2);
    }
    function rcScaled(m) { return rc.scale === "half" ? m / 2 : m; }
    function rcRounds(key) {
      var spec = RC_SPECS[key];
      if (!spec || typeof spec.distanceM !== "number") return null;
      return Math.max(1, Math.ceil(rcScaled(spec.distanceM) / RC_LANE_M));
    }
    function rcWeight(key) {
      var spec = RC_SPECS[key];
      if (spec.weightKg) return spec.weightKg[rc.category];
      if (spec.perHandKg) return spec.perHandKg[rc.category];
      if (spec.sandbagKg) return spec.sandbagKg[rc.category];
      return null;
    }
    function rcSegTitle(seg) { return seg.type === "run" ? (rc.scale === "half" ? "500m Run" : "1km Run") : seg.title; }
    function rcCombo() {
      return "Men's " + (rc.category === "pro" ? "Pro" : "Open") + " " +
        (rc.format === "doubles" ? "Doubles" : "Singles") + (rc.scale === "half" ? " · Half" : "");
    }
    // Every station's one-line summary, in the units the app reports it in:
    // machines and runs in meters, everything travelled in lane laps.
    function rcStationMeta(key) {
      if (key === "wallBalls") return (rc.scale === "half" ? 50 : 100) + " reps · 6 kg";
      if (key === "skierg" || key === "row") return rcScaled(RC_SPECS[key].distanceM) + "m";
      var w = rcWeight(key);
      return rcRounds(key) + " rounds" + (w ? " · " + w + " kg" : "");
    }

    // ----- screens -----
    function rcHeroHtml() {
      var chips = RC_KEYS.map(function (key, i) {
        return '<button type="button" class="stchip" data-rc="info" data-key="' + key + '">' +
          '<span>' + (i + 1) + '</span><b>' + RC_SHORT[key] + '</b></button>';
      }).join("");
      return '<div class="scr-head"><b>HYROX</b><span class="avatar">J</span></div>' +
        '<div class="card">' +
          '<div class="row"><span class="date">YOUR PERSONAL BEST</span><span class="pill">4 races</span></div>' +
          '<b class="clock">1:24:06</b>' +
          '<span class="sub">Men\'s Open Singles</span>' +
          '<div class="stchips">' + chips + '</div>' +
          '<span class="centered sub">Tap a station to see how it\'s done</span>' +
          '<button type="button" class="cta-blue" data-rc="to-setup">Start race</button>' +
          '<span class="centered link">View history</span>' +
        '</div>';
    }

    function rcChoice(group, value, title, sub, selected) {
      return '<button type="button" class="rc-choice' + (selected ? " is-on" : "") + '" data-rc="set" data-group="' + group + '" data-value="' + value + '">' +
        '<b>' + title + '</b>' + (sub ? '<span>' + sub + '</span>' : "") + '</button>';
    }

    function rcSetupHtml() {
      var each = rc.scale === "half" ? "500m" : "1km";
      var total = rc.scale === "half" ? "4km" : "8km";
      var rows = RC_KEYS.map(function (key) {
        return '<div class="rc-ag-row"><span class="rc-ag-icon">' + rcIcon(key, 15) + '</span>' +
          '<span class="rc-ag-name">' + RC_TITLES[key] + '</span>' +
          '<span class="rc-ag-meta">' + rcStationMeta(key) + '</span></div>';
      }).join("");

      return '<div class="scr-head"><b>Race setup</b><span class="avatar">J</span></div>' +
        '<div class="card">' +
          '<span class="date">RACE TYPE</span>' +
          '<div class="rc-choices">' +
            rcChoice("raceType", "standard", "Standard", "The official race", true) +
            rcChoice("raceType", "custom", "Custom", "Your own stations", false) +
          '</div>' +
          '<span class="date">STEP 1 · CATEGORY</span>' +
          '<div class="rc-choices">' +
            rcChoice("category", "open", "Open", "", rc.category === "open") +
            rcChoice("category", "pro", "Pro", "", rc.category === "pro") +
          '</div>' +
          '<span class="date">STEP 2 · FORMAT</span>' +
          '<div class="rc-choices">' +
            rcChoice("format", "singles", "Singles", "", rc.format === "singles") +
            rcChoice("format", "doubles", "Doubles", "", rc.format === "doubles") +
          '</div>' +
          '<span class="date">RACE LENGTH</span>' +
          '<div class="rc-choices">' +
            rcChoice("scale", "full", "Full", "8 runs · 8 stations", rc.scale === "full") +
            rcChoice("scale", "half", "Half", "Everything halved", rc.scale === "half") +
          '</div>' +
        '</div>' +
        '<div class="card">' +
          '<span class="date">YOUR RACE, IN ORDER</span>' +
          '<div class="rc-ag-row is-runs"><span class="rc-ag-icon">' + rcIcon("run", 15) + '</span>' +
            '<span class="rc-ag-name">' + total + ' of running</span>' +
            '<span class="rc-ag-meta">8 × ' + each + '</span></div>' +
          rows +
          '<span class="sub">Lap counts assume a 12.5m lane. Tell the app how long yours is and every station recounts itself.</span>' +
        '</div>' +
        // A personal best is scoped to one exact category+format+length combo
        // (hyrox.js pbKeyFor), so it only belongs on the combo it was set in.
        (rc.category === "open" && rc.format === "singles" && rc.scale === "full"
          ? '<div class="card rc-pb"><span class="date">YOUR PERSONAL BEST · ' + rcCombo().toUpperCase() + '</span>' +
            '<b class="clock rc-pb-clock">1:24:06</b><span class="sub">set 3 Aug 2026</span></div>'
          : "") +
        '<button type="button" class="cta-blue" data-rc="start">Start race</button>';
    }

    function rcNowDetail(seg) {
      if (seg.type === "run") {
        return '<div class="rc-now-figure"><b>' + (rc.scale === "half" ? 500 : 1000) + 'm</b><span>DISTANCE</span></div>';
      }
      var key = seg.key;
      if (key === "wallBalls") {
        return '<div class="rc-now-chips">' +
          '<div class="rc-now-chip"><b>' + (rc.scale === "half" ? 50 : 100) + '</b><span>REPS</span></div>' +
          '<div class="rc-now-chip"><b>6 kg</b><span>BALL</span></div>' +
          '<div class="rc-now-chip"><b>9ft</b><span>TARGET</span></div></div>';
      }
      if (key === "skierg" || key === "row") {
        return '<div class="rc-now-figure"><b>' + rcScaled(RC_SPECS[key].distanceM) + 'm</b><span>DISTANCE</span></div>';
      }
      // Travelling / loaded stations: the app leads with the lap count and
      // captions it with the load. No meters on this screen at all.
      var rounds = rcRounds(key);
      var share = rc.format === "doubles" ? Math.max(1, Math.round(rounds / 2)) : null;
      var w = rcWeight(key);
      var label = (key === "sledPush" || key === "sledPull") ? "sled"
        : key === "farmersCarry" ? "each hand" : key === "lunges" ? "sandbag" : "load";
      return '<div class="rc-now-figure' + (share ? " is-share" : "") + '"><b>' + (share || rounds) + '</b>' +
        '<span>' + (share ? "YOUR SHARE" : "ROUNDS") + '</span></div>' +
        (w ? '<span class="sub centered">' + w + ' kg ' + label + '</span>' : "");
    }

    function rcRunningHtml() {
      var seg = RC_SEQ[rc.index];
      var isLast = rc.index >= RC_SEQ.length - 1;
      var dots = RC_SEQ.map(function (s, i) {
        return '<span class="rc-dot' + (i < rc.index ? " is-done" : i === rc.index ? " is-now" : "") + '"></span>';
      }).join("");
      var splits = rc.splits.slice().reverse().map(function (s, i) {
        var idx = rc.splits.length - i;
        var prev = rc.splits[idx - 2];
        return '<div class="rc-split"><span class="rc-split-icon">' + rcIcon(s.key.indexOf("run") === 0 ? "run" : s.key, 14) + '</span>' +
          '<span class="rc-split-name">' + s.title + '</span>' +
          '<b>' + rcMmSs(prev ? s.at - prev.at : s.at) + '</b><i>' + rcClock(s.at) + '</i></div>';
      }).join("");

      return '<div class="rc-run-head">' +
          '<div><b class="clock" data-rc-clock>' + rcClock(rc.elapsed) + '</b><span class="date">ELAPSED</span></div>' +
          '<div class="rc-run-seg"><b>' + (rc.index + 1) + '<i>/' + RC_SEQ.length + '</i></b>' +
          '<span class="date">SEGMENT' + (rc.format === "doubles" ? ' · DOUBLES' : "") + '</span></div>' +
        '</div>' +
        '<div class="card rc-now">' +
          '<span class="date centered">UP NOW</span>' +
          '<span class="rc-now-badge">' + rcIcon(seg.type === "run" ? "run" : seg.key, 34) + '</span>' +
          '<b class="rc-now-title">' + rcSegTitle(seg) + '</b>' +
          rcNowDetail(seg) +
          (seg.type === "station"
            ? '<button type="button" class="rc-how" data-rc="info" data-key="' + seg.key + '">How to do it</button>'
            : "") +
        '</div>' +
        '<div class="rc-dots">' + dots + '</div>' +
        '<button type="button" class="rc-complete" data-rc="complete">' + (isLast ? "Finish race" : "Complete") + '</button>' +
        '<button type="button" class="rc-cancel" data-rc="to-hero">Cancel this race</button>' +
        (rc.splits.length ? '<span class="date">COMPLETED · ' + rc.splits.length + '</span><div class="rc-splits">' + splits + '</div>' : "");
    }

    function rcFinishedHtml() {
      var runTotal = 0, stationTotal = 0, max = 1;
      var segs = rc.splits.map(function (s, i) {
        var prev = rc.splits[i - 1];
        var secs = prev ? s.at - prev.at : s.at;
        if (secs > max) max = secs;
        if (s.key.indexOf("run") === 0) runTotal += secs; else stationTotal += secs;
        return { key: s.key, title: s.title, secs: secs };
      });
      var rows = segs.map(function (s) {
        var isRun = s.key.indexOf("run") === 0;
        var rating = !isRun && RC_COACH.tips[s.key] ? RC_COACH.tips[s.key].rating : "";
        return '<div class="rc-bd-row' + (isRun ? " is-run" : "") + (rating ? " is-" + rating : "") + '">' +
          '<span class="rc-bd-name">' + s.title + '</span>' +
          '<span class="rc-bd-track"><span style="width:' + Math.max(4, Math.round((s.secs / max) * 100)) + '%"></span></span>' +
          '<b>' + rcMmSs(s.secs) + '</b></div>';
      }).join("");

      var groups = [
        { rating: "focus",  label: "WHERE TO GAIN TIME" },
        { rating: "strong", label: "YOUR STRENGTHS" },
        { rating: "solid",  label: "ALREADY SOLID" }
      ].map(function (g) {
        var keys = RC_KEYS.filter(function (k) { return RC_COACH.tips[k].rating === g.rating; });
        if (!keys.length) return "";
        return '<div class="rc-tips is-' + g.rating + '"><span class="date">' + g.label + '</span>' +
          keys.map(function (k) {
            return '<div class="rc-tip"><span class="rc-tip-icon">' + rcIcon(k, 15) + '</span>' +
              '<div><b>' + RC_TITLES[k] + '</b><span>' + RC_COACH.tips[k].tip + '</span></div></div>';
          }).join("") + '</div>';
      }).join("");

      return '<div class="rc-finish"><span class="date">FINISHED · ' + rcCombo().toUpperCase() + '</span>' +
          '<b class="clock rc-finish-clock">' + rcClock(RC_TOTAL) + '</b></div>' +
        '<div class="banner">🏆 New personal best — saved to your history<span>›</span></div>' +
        '<div class="card">' +
          '<span class="date">WHERE YOUR TIME WENT</span>' +
          '<div class="rc-bd-totals">' +
            '<div class="rc-bd-total is-run"><b>' + rcClock(runTotal) + '</b><span>RUNNING</span></div>' +
            '<div class="rc-bd-total is-station"><b>' + rcClock(stationTotal) + '</b><span>STATIONS</span></div>' +
          '</div>' + rows +
        '</div>' +
        '<div class="card rc-coach">' +
          '<span class="date">YOUR RACE COACH</span>' +
          '<b class="rc-coach-overall">' + RC_COACH.overall + '</b>' +
          '<ul class="rc-coach-bullets">' + RC_COACH.detail.map(function (b) { return "<li>" + b + "</li>"; }).join("") + '</ul>' +
          groups +
        '</div>' +
        '<button type="button" class="cta-blue" data-rc="to-hero">Log another race</button>';
    }

    function rcInfoHtml() {
      if (!rc.info) return "";
      var key = rc.info, spec = RC_SPECS[key], how = RC_HOWTO[key], w = rcWeight(key);
      var chips = [];
      if (key === "wallBalls") chips = [["6 kg", "BALL"], [rc.scale === "half" ? 50 : 100, "REPS"], ["9ft", "TARGET"]];
      else {
        if (w) chips.push([w + " kg", key === "farmersCarry" ? "PER HAND" : "WEIGHT"]);
        if (key === "sledPush" || key === "sledPull") chips.push([rcRounds(key), "ROUNDS"]);
        chips.push([rcScaled(spec.distanceM) + "m", "DISTANCE"]);
      }
      return '<div class="rc-sheet" data-rc="close-info"><div class="rc-sheet-card">' +
        '<span class="grab"></span>' +
        '<div class="row"><b class="rc-sheet-title">' + rcIcon(key, 18) + RC_TITLES[key] + '</b>' +
        '<button type="button" class="rc-sheet-close" data-rc="close-info" aria-label="Close">&times;</button></div>' +
        '<div class="rc-now-chips">' + chips.map(function (c) {
          return '<div class="rc-now-chip"><b>' + c[0] + '</b><span>' + c[1] + '</span></div>';
        }).join("") + '</div>' +
        '<p class="rc-sheet-detail">' + how.detail.replace("{w}", w + " kg") + '</p>' +
        '<p class="tip">' + how.fact + '</p>' +
        '</div></div>';
    }

    // ----- Apple Watch companion -----
    // Not shipped: RepCheck has no watchOS app today. This is the design for
    // one, revealed beside the phone the moment the race starts and labelled
    // as a concept directly underneath.
    function rcWatchHtml() {
      if (rc.screen === "finished") {
        return '<div class="watch"><div class="watch-screen is-finish">' +
          '<span class="watch-label">FINISHED</span>' +
          '<b class="watch-clock">' + rcClock(RC_TOTAL) + '</b>' +
          '<span class="watch-meta">' + rcCombo() + '</span>' +
          '<span class="watch-saved">Saved · new PB</span></div></div>';
      }
      var seg = RC_SEQ[rc.index];
      var next = RC_SEQ[rc.index + 1];
      var isLast = rc.index >= RC_SEQ.length - 1;
      var pct = Math.round((rc.index / RC_SEQ.length) * 100);
      var meta;
      if (seg.type === "run") meta = (rc.scale === "half" ? 500 : 1000) + "m";
      else if (rc.format === "doubles" && rcRounds(seg.key) && seg.key !== "wallBalls" && seg.key !== "skierg" && seg.key !== "row") {
        // Match the phone: in Doubles the number on screen is your share.
        meta = Math.max(1, Math.round(rcRounds(seg.key) / 2)) + " your rounds" +
          (rcWeight(seg.key) ? " · " + rcWeight(seg.key) + " kg" : "");
      } else meta = rcStationMeta(seg.key);

      return '<div class="watch"><div class="watch-screen">' +
        '<div class="watch-top"><span>15:29</span><span class="watch-seg">' + (rc.index + 1) + '/' + RC_SEQ.length + '</span></div>' +
        '<b class="watch-clock" data-rc-watch-clock>' + rcClock(rc.elapsed) + '</b>' +
        '<span class="watch-label">ELAPSED</span>' +
        '<div class="watch-now">' + rcIcon(seg.type === "run" ? "run" : seg.key, 14) + rcSegTitle(seg) + '</div>' +
        '<span class="watch-meta">' + meta + '</span>' +
        '<div class="watch-bar"><span style="width:' + pct + '%"></span></div>' +
        '<button type="button" class="watch-btn" data-rc="complete">' + (isLast ? "Finish" : "Done") + '</button>' +
        '<span class="watch-next">' + (next ? "Next · " + rcSegTitle(next) : "Last one") + '</span>' +
        '</div></div>';
    }

    // ----- render + wiring -----
    function rcRender(keepScroll) {
      var top = keepScroll ? rcScreen.scrollTop : 0;
      rcScreen.innerHTML = (rc.screen === "hero" ? rcHeroHtml()
        : rc.screen === "setup" ? rcSetupHtml()
        : rc.screen === "running" ? rcRunningHtml()
        : rcFinishedHtml()) + rcInfoHtml();
      rcScreen.scrollTop = top;

      var showWatch = rc.screen === "running" || rc.screen === "finished";
      rcWatch.hidden = !showWatch;
      rcWatch.innerHTML = showWatch
        ? rcWatchHtml() + '<p class="watch-note"><b>Apple Watch companion</b>In design, not shipped — the same race on your wrist, so logging a split is one tap instead of a pocket dive.</p>'
        : "";

      $$(".race-step", rcSteps).forEach(function (step) {
        step.classList.toggle("is-active", step.getAttribute("data-screen") === rc.screen);
      });
    }

    function rcStop() { if (rc.timer) { clearInterval(rc.timer); rc.timer = null; } }
    function rcStart() {
      rcStop();
      // Reduced motion gets no self-advancing clock (WCAG 2.2.2) -- Complete
      // and the watch's Done button still walk the race by hand.
      if (reduced) return;
      rc.timer = setInterval(function () {
        rc.elapsed += 0.1 * RC_RATE;
        if (rc.elapsed >= RC_CUM[rc.index]) { rcComplete(); return; }
        var c = $("[data-rc-clock]", rcScreen);
        if (c) c.textContent = rcClock(rc.elapsed);
        var w = $("[data-rc-watch-clock]", rcWatch);
        if (w) w.textContent = rcClock(rc.elapsed);
      }, 100);
    }

    function rcComplete() {
      if (rc.screen !== "running") return;
      var seg = RC_SEQ[rc.index];
      // Tapping early still records this athlete's real split -- the demo is a
      // replay of one race, not a stopwatch you can beat.
      rc.elapsed = RC_CUM[rc.index];
      rc.splits.push({ key: seg.key, title: rcSegTitle(seg), at: rc.elapsed });
      if (rc.index >= RC_SEQ.length - 1) { rcStop(); rc.screen = "finished"; }
      else rc.index += 1;
      rcRender();
    }

    // Jumping straight to a stage from the steps on the left: the clock and
    // the splits have to be consistent with the stage you land on, so each
    // one rebuilds the race state it implies.
    function rcGoto(screen) {
      rcStop();
      rc.info = null;
      rc.screen = screen;
      if (screen === "hero" || screen === "setup") {
        rc.index = 0; rc.elapsed = 0; rc.splits = [];
      } else if (screen === "running") {
        rc.index = 0; rc.elapsed = 0; rc.splits = [];
        rcRender();
        rcStart();
        return;
      } else if (screen === "finished") {
        rc.splits = RC_SEQ.map(function (seg, i) {
          return { key: seg.key, title: rcSegTitle(seg), at: RC_CUM[i] };
        });
        rc.index = RC_SEQ.length - 1;
        rc.elapsed = RC_TOTAL;
      }
      rcRender();
    }

    raceRoot.addEventListener("click", function (evt) {
      var el = evt.target.closest ? evt.target.closest("[data-rc]") : null;
      if (!el) return;
      var action = el.getAttribute("data-rc");
      if (action === "info") { rc.info = el.getAttribute("data-key"); rcRender(true); return; }
      if (action === "close-info") {
        // Only a click on the backdrop itself closes -- not one bubbling out
        // of the card sitting on top of it.
        if (el.classList.contains("rc-sheet") && evt.target !== el) return;
        rc.info = null; rcRender(true); return;
      }
      if (action === "set") { rc[el.getAttribute("data-group")] = el.getAttribute("data-value"); rcRender(true); return; }
      if (action === "goto") { rcGoto(el.getAttribute("data-screen")); return; }
      if (action === "to-setup") { rcGoto("setup"); return; }
      if (action === "to-hero") { rcGoto("hero"); return; }
      if (action === "start") { rcGoto("running"); return; }
      if (action === "complete") { rcComplete(); }
    });

    // The clock only runs while the section is on screen -- a race shouldn't
    // tick itself away in a section nobody is looking at.
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (rc.screen !== "running") return;
          if (entry.isIntersecting) rcStart(); else rcStop();
        });
      }, { threshold: 0.2 }).observe(raceRoot);
    }

    rcRender();
  }

  // ---------- waitlist ----------
  // Swap ENDPOINT for the real form ID before going live -- until then
  // submissions fail closed with a clear error rather than pretending to work.
  var ENDPOINT = "https://formspree.io/f/YOUR_FORM_ID";

  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

  var form = $("#waitlist-form");
  if (form) {
    var input = form.querySelector('input[type="email"]');
    var button = form.querySelector("button");
    var noteEl = $("[data-note]");
    var defaultNote = noteEl ? noteEl.textContent : "";

    form.addEventListener("submit", function (evt) {
      evt.preventDefault();
      var email = (input.value || "").trim();

      if (!validEmail(email)) {
        input.setAttribute("aria-invalid", "true");
        if (noteEl) {
          noteEl.textContent = "That doesn't look like a valid email — mind double-checking it?";
          noteEl.classList.add("is-error");
          noteEl.classList.remove("is-ok");
        }
        input.focus();
        return;
      }

      input.removeAttribute("aria-invalid");
      button.disabled = true;
      var label = button.textContent;
      button.textContent = "Joining…";

      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: email, source: "repcheck-marketing" })
      })
        .then(function (res) {
          if (!res.ok) throw new Error("bad-status");
          form.reset();
          if (noteEl) {
            noteEl.textContent = "You're on the list — we'll email " + email + " when your slot opens.";
            noteEl.classList.add("is-ok");
            noteEl.classList.remove("is-error");
          }
          button.textContent = "You're in";
        })
        .catch(function () {
          if (noteEl) {
            noteEl.textContent = "Something went wrong on our end — mind trying again in a moment?";
            noteEl.classList.add("is-error");
            noteEl.classList.remove("is-ok");
          }
          button.disabled = false;
          button.textContent = label;
        });
    });

    input.addEventListener("input", function () {
      input.removeAttribute("aria-invalid");
      if (noteEl) {
        noteEl.textContent = defaultNote;
        noteEl.classList.remove("is-error", "is-ok");
      }
    });
  }
})();
