(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // ---------- year ----------
  var yearEl = $("#year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // ---------- theme toggle ----------
  var root = document.documentElement;
  var toggle = $("#theme-toggle");
  function currentTheme() {
    var stored = root.getAttribute("data-theme");
    if (stored) return stored;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  if (toggle) {
    toggle.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("rc-theme", next); } catch (e) {}
    });
  }

  // ---------- sticky nav shadow/border ----------
  var nav = $("#nav");
  if (nav) {
    var onScroll = function () {
      nav.classList.toggle("is-stuck", window.scrollY > 4);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // ---------- phone demo videos ----------
  // No video carries a markup autoplay attribute, on purpose: playback is
  // JS-initiated so the guard fails safe. No JS (or a crash above) leaves
  // every phone on its static poster, never an unstoppable loop that
  // prefers-reduced-motion can't switch off (WCAG 2.2.2).
  var videos = $$(".phone-video");
  if (videos.length && window.matchMedia) {
    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    var playVideo = function (video) {
      var playing = video.play();
      if (playing && playing.catch) {
        playing.catch(function () {
          // Autoplay denied (Low Power Mode, data saver): surface controls
          // so the demo stays reachable instead of a dead poster.
          video.controls = true;
        });
      }
    };

    var observer = null;
    var startWatching = function () {
      if (observer || !window.IntersectionObserver) {
        videos.forEach(playVideo);
        return;
      }
      // Only play a phone's video while it's actually on screen -- keeps a
      // scrolled-past clip from decoding in the background for no reason.
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) playVideo(entry.target);
          else entry.target.pause();
        });
      }, { threshold: 0.25 });
      videos.forEach(function (video) { observer.observe(video); });
    };
    var stopWatching = function () {
      if (observer) { observer.disconnect(); observer = null; }
      videos.forEach(function (video) { video.pause(); });
    };

    var applyMotionPref = function () {
      if (reduceMotion.matches) stopWatching();
      else startWatching();
    };
    applyMotionPref();
    if (reduceMotion.addEventListener) reduceMotion.addEventListener("change", applyMotionPref);
    else if (reduceMotion.addListener) reduceMotion.addListener(applyMotionPref);
  }

  // ---------- waitlist forms ----------
  // Wired to a Formspree-style endpoint: POST JSON, expect 200 on success.
  // Swap ENDPOINT for the real form ID before going live -- until then
  // submissions fail closed with a clear error rather than pretending to work.
  var ENDPOINT = "https://formspree.io/f/YOUR_FORM_ID";

  function validEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  function wireForm(formEl) {
    if (!formEl) return;
    var input = formEl.querySelector('input[type="email"]');
    var button = formEl.querySelector("button");
    // Both are required. Without this guard a .waitlist-form missing either
    // one throws while wiring, which aborts the forEach below -- so a markup
    // slip in the hero form would leave the closing CTA form unwired and
    // silently falling through to a real page navigation on submit. The
    // [data-note] line is genuinely optional and stays null-checked inline.
    if (!input || !button) return;
    var note = formEl.querySelector("[data-note]");
    var defaultNote = note ? note.textContent : "";

    formEl.addEventListener("submit", function (evt) {
      evt.preventDefault();
      var email = (input.value || "").trim();

      if (!validEmail(email)) {
        input.setAttribute("aria-invalid", "true");
        if (note) {
          note.textContent = "That doesn't look like a valid email — mind double-checking it?";
          note.classList.add("is-error");
          note.classList.remove("is-ok");
        }
        input.focus();
        return;
      }

      input.removeAttribute("aria-invalid");
      button.disabled = true;
      var originalLabel = button.textContent;
      button.textContent = "Joining…";

      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: email, source: "repcheck-marketing" })
      })
        .then(function (res) {
          if (!res.ok) throw new Error("bad-status");
          formEl.reset();
          if (note) {
            note.textContent = "You're on the list — we'll email " + email + " when your slot opens.";
            note.classList.add("is-ok");
            note.classList.remove("is-error");
          }
          button.textContent = "You're in";
        })
        .catch(function () {
          if (note) {
            note.textContent = "Something went wrong on our end — mind trying again in a moment?";
            note.classList.add("is-error");
            note.classList.remove("is-ok");
          }
          button.disabled = false;
          button.textContent = originalLabel;
        });
    });

    input.addEventListener("input", function () {
      input.removeAttribute("aria-invalid");
      if (note) {
        note.textContent = defaultNote;
        note.classList.remove("is-error", "is-ok");
      }
    });
  }

  // ---------- HYROX race walkthrough ----------
  // A playable copy of the app's own race flow -- hero -> race setup ->
  // running -> finished, the same four screens static/hyrox.js renders, in
  // the same order. Everything factual here is lifted from the app rather
  // than invented for the landing page:
  //   * the 8+8 segment order and the run/station titles  (STATIONS)
  //   * Open/Pro loads, reps and target height            (STATION_SPECS)
  //   * lap counts derived from a 12.5m lane              (DEFAULT_LANE_M,
  //     roundsFor(): ceil(distance / lane))
  //   * the "how it's done" copy behind each station chip (static/i18n.js,
  //     hyrox.standards.*)
  //   * the finish screen's split breakdown and the coach's
  //     focus/strong/solid grouping                       (hyrox_coach.py)
  // The splits are one athlete's 1:24:06 Men's Open Singles race, replayed
  // at 60x so the whole race fits in about a minute of watching.
  var rdRoot = $("#race-demo");
  if (rdRoot) {
    var rdScreen = $("#rd-screen");
    var rdWatchRig = $("#rd-watch");
    var rdStepsEl = $("#rd-steps");

    // The same line-art pictograms the app uses (static/hyrox.js
    // STATION_ICONS), copied verbatim so a station looks identical here and
    // in the product.
    var RD_ICONS = {
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
    function rdIcon(key, size) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 48 48" fill="none" stroke="currentColor" ' +
        'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' + (RD_ICONS[key] || RD_ICONS.run) + '</svg>';
    }
    var RD_CHECK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
    var RD_TROPHY = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>';
    var RD_SPARKLE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.9 5.6L19.5 9l-5.6 1.9L12 16.5l-1.9-5.6L4.5 9l5.6-1.4z"/><path d="M18.5 14l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z"/></svg>';

    // Men's standards, straight out of STATION_SPECS. The demo fixes gender
    // to Men (the app reads it off your coaching profile rather than asking
    // again); category is switchable below and really does swap the loads.
    var RD_SPECS = {
      skierg:          { distanceM: 1000 },
      sledPush:        { distanceM: 50,  weightKg:  { open: 152, pro: 202 } },
      sledPull:        { distanceM: 50,  weightKg:  { open: 103, pro: 152 } },
      burpeeBroadJump: { distanceM: 80 },
      row:             { distanceM: 1000 },
      farmersCarry:    { distanceM: 200, perHandKg: { open: 24,  pro: 32 } },
      lunges:          { distanceM: 100, sandbagKg: { open: 20,  pro: 30 } },
      wallBalls:       { reps: 100, ballKg: 6, targetFt: 9 }
    };
    var RD_LANE_M = 12.5;   // hyrox.js DEFAULT_LANE_M
    var RD_RATE = 60;       // demo clock speed: 1 real second = 1 race minute

    // 8 x 1km runs alternating with the 8 stations, and this athlete's
    // splits in seconds. Runs total 49:02, stations 35:04, race 1:24:06.
    var RD_SEQ = [
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
    var RD_CUM = (function () {
      var out = [], running = 0;
      RD_SEQ.forEach(function (s) { running += s.seconds; out.push(running); });
      return out;
    })();
    var RD_TOTAL = RD_CUM[RD_CUM.length - 1];
    var RD_STATION_KEYS = ["skierg", "sledPush", "sledPull", "burpeeBroadJump", "row", "farmersCarry", "lunges", "wallBalls"];
    var RD_TITLES = {
      skierg: "SkiErg", sledPush: "Sled Push", sledPull: "Sled Pull",
      burpeeBroadJump: "Burpee Broad Jumps", row: "Rowing",
      farmersCarry: "Farmers Carry", lunges: "Sandbag Lunges", wallBalls: "Wall Balls"
    };

    // The coach block on the finish screen. hyrox_coach.py asks Gemini for
    // exactly this shape -- one short overall line plus its detail bullets,
    // then one rated tip per station -- so this is the format an athlete
    // really gets back, written against the splits above.
    var RD_COACH = {
      overall: "Wall balls and the sled pull are where this race went — not the running.",
      overallDetail: [
        "Running was 49:02 of the 1:24:06, held at roughly 6:07/km. Steady, and not the problem.",
        "Wall balls took 6:40 — the longest single segment of the whole race.",
        "The sled pull at 4:42 was your slowest station after that, and run 4 came out 15 seconds slower because of it.",
        "Fix wall balls first, sled pull second. Leave the running alone."
      ],
      tips: {
        wallBalls:       { rating: "focus",  tip: "Break the 100 into sets of 10 from the first rep instead of going to failure at 25.", detail: ["Rest 5 seconds standing, not 20 seconds bent over the ball.", "Hit depth every rep — a no-rep costs more than a pause.", "Train 5 x 20 with 30s rest until 100 stops scaring you."] },
        sledPull:        { rating: "focus",  tip: "Sit back and hang your body weight on the rope instead of pulling with your arms.", detail: ["Long hand-over-hand pulls — fewer, bigger bites of rope.", "Reset your feet at the start of each 12.5m round.", "One heavy rope-pull session a week, 4 rounds, is enough."] },
        farmersCarry:    { rating: "strong", tip: "2:12 with 24 kg per hand is a real strength — walk it straight into run 7 without setting down.", detail: ["Your grip held for the full 200m; keep training it at that distance.", "Start the next run before your heart rate drops — you have the margin."] },
        sledPush:        { rating: "strong", tip: "3:18 without a single stop; keep the low arm angle you already have.", detail: ["Short choppy steps, hips low, arms locked — nothing to change here."] },
        row:             { rating: "solid",  tip: "4:18 is well judged — hold that pace rather than chasing a faster 1000m." },
        skierg:          { rating: "solid",  tip: "4:24 to open the race is sensible; don't spend the extra 10 seconds here." },
        burpeeBroadJump: { rating: "solid",  tip: "4:54 is fine — a smaller jump with no pause beats a big jump and a rest." },
        lunges:          { rating: "solid",  tip: "4:36 held together; keep the sandbag high on the traps for the last 25m." }
      }
    };

    // Verbatim from static/i18n.js (hyrox.standards.*) -- what the app shows
    // when you tap a station on the hero card.
    var RD_HOWTO = {
      skierg:          { keyFact: "No added weight — just your own effort.", detail: "1000m on the ski erg, powered entirely by your own effort — there's no weight or resistance setting to worry about." },
      row:             { keyFact: "No added weight — just your own effort.", detail: "1000m on the rowing machine, powered entirely by your own effort — same idea as the ski erg, just a different machine." },
      burpeeBroadJump: { keyFact: "Bodyweight only, no equipment.", detail: "Drop down, push back up, then jump forward as far as you can — repeated over and over until you've covered 80m. No equipment, just your body weight." },
      sledPush:        { keyFact: "Fixed weight — can't be made lighter on race day.", detail: "The loaded sled is pushed away from you for 4 rounds of 12.5m each, covering the full 50m." },
      sledPull:        { keyFact: "Fixed weight — can't be made lighter on race day.", detail: "The loaded sled is pulled toward you using a rope for 4 rounds of 12.5m each, covering the full 50m." },
      farmersCarry:    { keyFact: "No putting the weights down along the way.", detail: "Carried as 2 x {w} kettlebells, one in each hand, walking the full distance without putting them down." },
      lunges:          { keyFact: "The sandbag stays on your shoulders the whole way.", detail: "A {w} sandbag carried across the shoulders for the full distance." },
      wallBalls:       { keyFact: "Every rep needs a full squat before the throw.", detail: "A ball is squatted down and thrown up to a target 9 ft up the wall, for 100 reps total." }
    };

    var rd = {
      screen: "hero",
      category: "open",
      format: "singles",
      scale: "full",
      index: 0,
      elapsed: 0,
      splits: [],
      info: null,
      timer: null
    };

    function rdReduceMotion() {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }
    function rdClock(total) {
      var s = Math.max(0, Math.floor(total));
      var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      var mm = h > 0 ? ("0" + m).slice(-2) : String(m);
      return (h > 0 ? h + ":" : "") + mm + ":" + ("0" + sec).slice(-2);
    }
    function rdClockPrecise(total) {
      var s = Math.max(0, Math.floor(total));
      return ("0" + Math.floor(s / 60)).slice(-2) + ":" + ("0" + (s % 60)).slice(-2);
    }
    function rdScaled(m) { return rd.scale === "half" ? m / 2 : m; }
    function rdRounds(key) {
      var spec = RD_SPECS[key];
      if (!spec || typeof spec.distanceM !== "number") return null;
      return Math.max(1, Math.ceil(rdScaled(spec.distanceM) / RD_LANE_M));
    }
    function rdWeight(key) {
      var spec = RD_SPECS[key];
      if (spec.weightKg) return spec.weightKg[rd.category];
      if (spec.perHandKg) return spec.perHandKg[rd.category];
      if (spec.sandbagKg) return spec.sandbagKg[rd.category];
      return null;
    }
    function rdRunTitle() { return rd.scale === "half" ? "500m Run" : "1km Run"; }
    function rdSegTitle(seg) { return seg.type === "run" ? rdRunTitle() : seg.title; }
    function rdCombo() {
      return "Men's " + (rd.category === "pro" ? "Pro" : "Open") + " " +
        (rd.format === "doubles" ? "Doubles" : "Singles") + (rd.scale === "half" ? " · Half" : "");
    }

    // ----- screens -----
    function rdHeroHtml() {
      var chips = RD_STATION_KEYS.map(function (key, i) {
        return '<button type="button" class="rd-hero-station" data-rd="info" data-key="' + key + '" title="' + RD_TITLES[key] + '">' +
          '<span class="rd-hero-station-num">' + (i + 1) + '</span>' +
          '<span class="rd-hero-station-icon">' + rdIcon(key, 20) + '</span></button>';
      }).join("");
      return '<div class="rd-card rd-hero">' +
        '<div class="rd-hero-top"><span class="rd-hero-kicker">Race simulator</span><span class="rd-hero-chip">🏁 4 races</span></div>' +
        '<div class="rd-hero-title">1:24:06</div>' +
        '<div class="rd-hero-sub">Your fastest race · Men\'s Open Singles</div>' +
        '<div class="rd-hero-stations">' + chips + '</div>' +
        '<div class="rd-hero-hint">Tap a station to see how it\'s done</div>' +
        '<button type="button" class="rd-hero-cta" data-rd="to-setup">Start race</button>' +
        '<span class="rd-hero-link">Personal bests</span>' +
        '</div>';
    }

    function rdChoice(group, value, title, sub, selected) {
      return '<button type="button" class="rd-choice' + (selected ? " is-selected" : "") + '" data-rd="set" data-group="' + group + '" data-value="' + value + '">' +
        '<span class="rd-choice-title">' + title + '</span>' +
        (sub ? '<span class="rd-choice-sub">' + sub + '</span>' : "") + '</button>';
    }

    function rdSetupHtml() {
      var runEach = rd.scale === "half" ? "500m" : "1km";
      var runTotal = rd.scale === "half" ? "4km" : "8km";
      var stationRows = RD_STATION_KEYS.map(function (key) {
        var w = rdWeight(key);
        var meta = key === "wallBalls" ? (rd.scale === "half" ? 50 : 100) + " reps · 6 kg"
          // SkiErg and Rowing are covered continuously on a machine -- they
          // report a distance, never a lane lap count. Same split the app
          // makes in stationNowChipsHtml().
          : (key === "skierg" || key === "row") ? rdScaled(RD_SPECS[key].distanceM) + "m"
          : rdRounds(key) + " rounds" + (w ? " · " + w + " kg" : "");
        return '<div class="rd-agenda-row"><span class="rd-agenda-icon">' + rdIcon(key, 15) + '</span>' +
          '<span class="rd-agenda-name">' + RD_TITLES[key] + '</span>' +
          '<span class="rd-agenda-meta">' + meta + '</span></div>';
      }).join("");

      return '<div class="rd-card">' +
        '<div class="rd-setup-head"><button type="button" class="rd-back" data-rd="to-hero" aria-label="Back">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>' +
        '</button><span class="rd-setup-title">Race setup</span></div>' +

        '<div class="rd-step-label">Race type</div>' +
        '<div class="rd-choice-grid">' +
          rdChoice("raceType", "standard", "Standard", "The official HYROX race.", true) +
          rdChoice("raceType", "custom", "Custom", "Your own stations, order and distances.", false) +
        '</div>' +

        '<div class="rd-step-label">Step 1 · Category</div>' +
        '<div class="rd-choice-grid">' +
          rdChoice("category", "open", "Open", "", rd.category === "open") +
          rdChoice("category", "pro", "Pro", "", rd.category === "pro") +
        '</div>' +

        '<div class="rd-step-label">Step 2 · Format</div>' +
        '<div class="rd-choice-grid">' +
          rdChoice("format", "singles", "Singles", "", rd.format === "singles") +
          rdChoice("format", "doubles", "Doubles", "", rd.format === "doubles") +
        '</div>' +

        '<div class="rd-step-label">Race length</div>' +
        '<div class="rd-choice-grid">' +
          rdChoice("scale", "full", "Full", "8 runs · all 8 stations", rd.scale === "full") +
          rdChoice("scale", "half", "Half", "Everything halved", rd.scale === "half") +
        '</div>' +

        '<div class="rd-step-label">Your race, in order</div>' +
        '<div class="rd-agenda">' +
          '<div class="rd-agenda-runs"><span class="rd-agenda-icon">' + rdIcon("run", 15) + '</span>' +
          '<b>' + runTotal + '</b> total running · 8 × ' + runEach + '</div>' +
          stationRows +
        '</div>' +
        '<p class="rd-agenda-note">Lap counts assume a 12.5m lane. Tell the app how long yours is and every station recounts itself.</p>' +

        (rd.category === "open" && rd.format === "singles" && rd.scale === "full"
          ? '<div class="rd-pb-banner"><span class="rd-pb-banner-label">Your personal best — ' + rdCombo() + '</span>' +
            '<span class="rd-pb-banner-time">1:24:06<i>set 3 Aug 2026</i></span></div>'
          : "") +

        '<button type="button" class="rd-primary" data-rd="start">Start race</button>' +
        '</div>';
    }

    function rdNowDetailHtml(seg) {
      if (seg.type === "run") return "";
      var key = seg.key, spec = RD_SPECS[key];
      var chip = function (v, l) {
        return '<div class="rd-now-chip"><span class="rd-now-chip-value">' + v + '</span><span class="rd-now-chip-label">' + l + '</span></div>';
      };
      if (key === "wallBalls") {
        return '<div class="rd-now-chips">' + chip(rd.scale === "half" ? 50 : 100, "Reps") + chip("6 kg", "Ball") + chip("9ft", "Target") + '</div>';
      }
      if (key === "skierg" || key === "row") {
        return '<div class="rd-now-chips">' + chip(rdScaled(spec.distanceM) + "m", "Distance") + '</div>';
      }
      // Travelling / loaded stations: the app leads with the lap count and
      // captions it with the load -- meters never appear on this screen.
      var rounds = rdRounds(key);
      var share = rd.format === "doubles" ? Math.max(1, Math.round(rounds / 2)) : null;
      var w = rdWeight(key);
      var label = key === "sledPush" || key === "sledPull" ? "sled"
        : key === "farmersCarry" ? "each hand"
        : key === "lunges" ? "sandbag" : "load";
      return '<div class="rd-now-hero' + (share ? " is-share" : "") + '">' +
        '<div class="rd-now-hero-value">' + (share || rounds) + '</div>' +
        '<div class="rd-now-hero-label">' + (share ? "Your share" : "Rounds") + '</div></div>' +
        (w ? '<div class="rd-now-caption">' + w + ' kg ' + label + '</div>' : "");
    }

    function rdRunningHtml() {
      var seg = RD_SEQ[rd.index];
      var isLast = rd.index >= RD_SEQ.length - 1;
      var pct = Math.round((rd.index / RD_SEQ.length) * 100);
      var dots = RD_SEQ.map(function (s, i) {
        return '<span class="rd-dot' + (i < rd.index ? " is-done" : i === rd.index ? " is-current" : "") + '"></span>';
      }).join("");
      var splits = rd.splits.slice().reverse().map(function (s, i) {
        var idx = rd.splits.length - i;
        var prev = rd.splits[idx - 2];
        var delta = prev ? s.at - prev.at : s.at;
        return '<div class="rd-split-row"><span class="rd-split-icon">' + rdIcon(s.key.indexOf("run") === 0 ? "run" : s.key, 15) + '</span>' +
          '<span class="rd-split-name">' + s.title + '</span>' +
          '<span class="rd-split-times"><b>' + rdClockPrecise(delta) + '</b><i>' + rdClock(s.at) + '</i></span></div>';
      }).join("");

      return '<div class="rd-card">' +
        '<div class="rd-run-head">' +
          '<div class="rd-run-stat"><span class="rd-run-value" data-rd-clock>' + rdClock(rd.elapsed) + '</span><span class="rd-run-label">Elapsed time</span></div>' +
          '<div class="rd-run-stat"><span class="rd-run-value rd-run-count">' + (rd.index + 1) + '<i>/' + RD_SEQ.length + '</i></span>' +
          '<span class="rd-run-label">Segment' + (rd.format === "doubles" ? '<span class="rd-badge">Doubles</span>' : "") + '</span></div>' +
        '</div>' +
        '<div class="rd-now">' +
          '<div class="rd-now-kicker">Up now</div>' +
          '<div class="rd-now-badge">' + rdIcon(seg.type === "run" ? "run" : seg.key, 40) + '</div>' +
          '<div class="rd-now-title">' + rdSegTitle(seg) + '</div>' +
          rdNowDetailHtml(seg) +
          (seg.type === "station" ? '<button type="button" class="rd-now-info" data-rd="info" data-key="' + seg.key + '">▶ How to do it</button>' : "") +
        '</div>' +
        '<div class="rd-progress"><span style="width:' + pct + '%"></span></div>' +
        '<div class="rd-dots">' + dots + '</div>' +
        '<button type="button" class="rd-complete" data-rd="complete"><span class="rd-complete-icon">' + RD_CHECK + '</span>' +
          '<span>' + (isLast ? "Finish race" : "Complete") + '</span></button>' +
        '<button type="button" class="rd-cancel" data-rd="to-hero">Cancel this race</button>' +
        (rd.splits.length ? '<div class="rd-splits-head">Completed · ' + rd.splits.length + '</div>' : "") +
        '<div class="rd-splits">' + splits + '</div>' +
        '</div>';
    }

    function rdFinishedHtml() {
      var runTotal = 0, stationTotal = 0, max = 1;
      var segs = rd.splits.map(function (s, i) {
        var prev = rd.splits[i - 1];
        var secs = prev ? s.at - prev.at : s.at;
        if (secs > max) max = secs;
        if (s.key.indexOf("run") === 0) runTotal += secs; else stationTotal += secs;
        return { key: s.key, title: s.title, secs: secs };
      });
      var rows = segs.map(function (s) {
        var isRun = s.key.indexOf("run") === 0;
        var rating = !isRun && RD_COACH.tips[s.key] ? RD_COACH.tips[s.key].rating : "";
        return '<div class="rd-bd-row' + (isRun ? " is-run" : "") + (rating ? " is-" + rating : "") + '">' +
          '<span class="rd-bd-icon">' + rdIcon(isRun ? "run" : s.key, 14) + '</span>' +
          '<span class="rd-bd-name">' + s.title + '</span>' +
          '<span class="rd-bd-track"><span style="width:' + Math.max(4, Math.round((s.secs / max) * 100)) + '%"></span></span>' +
          '<span class="rd-bd-time">' + rdClockPrecise(s.secs) + '</span></div>';
      }).join("");

      var groups = [
        { rating: "focus",  label: "Where to gain time" },
        { rating: "strong", label: "Your strengths" },
        { rating: "solid",  label: "Already solid" }
      ].map(function (g) {
        var keys = RD_STATION_KEYS.filter(function (k) { return RD_COACH.tips[k].rating === g.rating; });
        if (!keys.length) return "";
        return '<div class="rd-tip-group is-' + g.rating + '">' +
          '<div class="rd-tip-group-label"><span class="rd-tip-dot"></span>' + g.label + '</div>' +
          keys.map(function (k) {
            var tip = RD_COACH.tips[k];
            return '<div class="rd-tip-row"><span class="rd-tip-icon">' + rdIcon(k, 16) + '</span>' +
              '<div><div class="rd-tip-name">' + RD_TITLES[k] + '</div>' +
              '<div class="rd-tip-text">' + tip.tip + '</div>' +
              (tip.detail ? '<ul class="rd-tip-bullets">' + tip.detail.map(function (b) { return "<li>" + b + "</li>"; }).join("") + '</ul>' : "") +
              '</div></div>';
          }).join("") + '</div>';
      }).join("");

      return '<div class="rd-card">' +
        '<div class="rd-finish-hero"><div class="rd-finish-icon">' + RD_TROPHY + '</div>' +
          '<div class="rd-finish-time">' + rdClock(RD_TOTAL) + '</div>' +
          '<div class="rd-finish-label">' + rdCombo() + '</div></div>' +
        '<div class="rd-pb-new">🏆 New personal best for ' + rdCombo() + ' — saved to your history.</div>' +
        '<div class="rd-breakdown">' +
          '<div class="rd-bd-title">Where your time went</div>' +
          '<div class="rd-bd-totals">' +
            '<div class="rd-bd-total is-run"><b>' + rdClock(runTotal) + '</b><span>Running</span></div>' +
            '<div class="rd-bd-total is-station"><b>' + rdClock(stationTotal) + '</b><span>Stations</span></div>' +
          '</div><div class="rd-bd-rows">' + rows + '</div></div>' +
        '<div class="rd-analysis">' +
          '<div class="rd-analysis-head">' + RD_SPARKLE + '<span>Your race coach</span></div>' +
          '<div class="rd-analysis-overall">' + RD_COACH.overall + '</div>' +
          '<ul class="rd-tip-bullets is-overall">' + RD_COACH.overallDetail.map(function (b) { return "<li>" + b + "</li>"; }).join("") + '</ul>' +
          groups +
        '</div>' +
        '<button type="button" class="rd-primary" data-rd="to-hero">Log another race</button>' +
        '</div>';
    }

    function rdInfoHtml() {
      if (!rd.info) return "";
      var key = rd.info, spec = RD_SPECS[key], how = RD_HOWTO[key];
      var w = rdWeight(key);
      var chips = [];
      if (key === "wallBalls") {
        chips.push(["6 kg", "ball"], [rd.scale === "half" ? 50 : 100, "reps"], ["9ft", "target"]);
      } else {
        if (w) chips.push([w + " kg", key === "farmersCarry" ? "per hand" : "weight"]);
        if (key === "sledPush" || key === "sledPull") chips.push([rdRounds(key), "rounds"]);
        chips.push([rdScaled(spec.distanceM) + "m", "distance"]);
      }
      return '<div class="rd-sheet" data-rd="close-info">' +
        '<div class="rd-sheet-card">' +
          '<div class="rd-sheet-head"><span class="rd-sheet-icon">' + rdIcon(key, 20) + '</span>' +
          '<span>' + RD_TITLES[key] + '</span>' +
          '<button type="button" class="rd-sheet-close" data-rd="close-info" aria-label="Close">&times;</button></div>' +
          '<div class="rd-sheet-chips">' + chips.map(function (c) {
            return '<span class="rd-sheet-chip"><b>' + c[0] + '</b><i>' + c[1] + '</i></span>';
          }).join("") + '</div>' +
          '<p class="rd-sheet-detail">' + how.detail.replace("{w}", w + " kg") + '</p>' +
          '<p class="rd-sheet-fact">' + how.keyFact + '</p>' +
        '</div></div>';
    }

    // ----- Apple Watch companion -----
    // Not shipped: RepCheck has no watchOS app today. This is the design for
    // one, shown beside the phone from the moment the race starts, and
    // labelled as a concept underneath so nobody reads it as available.
    function rdWatchHtml() {
      if (rd.screen === "finished") {
        return '<div class="rd-watch"><div class="rd-watch-screen is-finish">' +
          '<div class="rd-watch-trophy">' + RD_TROPHY + '</div>' +
          '<div class="rd-watch-time">' + rdClock(RD_TOTAL) + '</div>' +
          '<div class="rd-watch-label">Finished</div>' +
          '<div class="rd-watch-meta">' + rdCombo() + '</div>' +
          '<div class="rd-watch-saved">Saved · new PB</div>' +
          '</div></div>';
      }
      var seg = RD_SEQ[rd.index];
      var next = RD_SEQ[rd.index + 1];
      var isLast = rd.index >= RD_SEQ.length - 1;
      var pct = Math.round((rd.index / RD_SEQ.length) * 100);
      var meta;
      if (seg.type === "run") meta = (rd.scale === "half" ? 500 : 1000) + "m";
      else if (seg.key === "wallBalls") meta = (rd.scale === "half" ? 50 : 100) + " reps · 6 kg";
      else if (seg.key === "skierg" || seg.key === "row") meta = rdScaled(RD_SPECS[seg.key].distanceM) + "m";
      else {
        var wRounds = rdRounds(seg.key);
        if (rd.format === "doubles") wRounds = Math.max(1, Math.round(wRounds / 2));
        meta = wRounds + (rd.format === "doubles" ? " your rounds" : " rounds") +
          (rdWeight(seg.key) ? " · " + rdWeight(seg.key) + " kg" : "");
      }

      return '<div class="rd-watch"><div class="rd-watch-screen">' +
        '<div class="rd-watch-top"><span>15:29</span><span class="rd-watch-seg">' + (rd.index + 1) + '/' + RD_SEQ.length + '</span></div>' +
        '<div class="rd-watch-time" data-rd-watch-clock>' + rdClock(rd.elapsed) + '</div>' +
        '<div class="rd-watch-label">Elapsed</div>' +
        '<div class="rd-watch-now"><span class="rd-watch-icon">' + rdIcon(seg.type === "run" ? "run" : seg.key, 14) + '</span>' + rdSegTitle(seg) + '</div>' +
        '<div class="rd-watch-meta">' + meta + '</div>' +
        '<div class="rd-watch-bar"><span style="width:' + pct + '%"></span></div>' +
        '<button type="button" class="rd-watch-btn" data-rd="complete">' + (isLast ? "Finish" : "Done") + '</button>' +
        '<div class="rd-watch-next">' + (next ? "Next · " + rdSegTitle(next) : "Last one") + '</div>' +
        '</div></div>';
    }

    // ----- render + wiring -----
    function rdRender(keepScroll) {
      var top = keepScroll ? rdScreen.scrollTop : 0;
      rdScreen.innerHTML = (rd.screen === "hero" ? rdHeroHtml()
        : rd.screen === "setup" ? rdSetupHtml()
        : rd.screen === "running" ? rdRunningHtml()
        : rdFinishedHtml()) + rdInfoHtml();
      rdScreen.scrollTop = top;

      var showWatch = rd.screen === "running" || rd.screen === "finished";
      rdWatchRig.hidden = !showWatch;
      rdWatchRig.innerHTML = showWatch
        ? rdWatchHtml() + '<p class="rd-watch-note"><b>Apple Watch companion</b>In design, not shipped — the same race on your wrist, so a split is one tap instead of a pocket dive.</p>'
        : "";

      $$("li", rdStepsEl).forEach(function (li) {
        li.classList.toggle("is-active", li.getAttribute("data-step") === rd.screen);
      });
    }

    function rdStopTimer() {
      if (rd.timer) { clearInterval(rd.timer); rd.timer = null; }
    }
    function rdStartTimer() {
      rdStopTimer();
      // Reduced motion gets no self-advancing clock (WCAG 2.2.2) -- Complete
      // and the watch's Done button still walk the race manually.
      if (rdReduceMotion()) return;
      rd.timer = setInterval(function () {
        rd.elapsed += 0.1 * RD_RATE;
        if (rd.elapsed >= RD_CUM[rd.index]) { rdComplete(); return; }
        var clockEl = $("[data-rd-clock]", rdScreen);
        if (clockEl) clockEl.textContent = rdClock(rd.elapsed);
        var watchClock = $("[data-rd-watch-clock]", rdWatchRig);
        if (watchClock) watchClock.textContent = rdClock(rd.elapsed);
      }, 100);
    }

    function rdComplete() {
      if (rd.screen !== "running") return;
      var seg = RD_SEQ[rd.index];
      // Tapping early still records this athlete's real split -- the demo is
      // a replay of one race, not a stopwatch you can beat.
      rd.elapsed = RD_CUM[rd.index];
      rd.splits.push({ key: seg.key, title: rdSegTitle(seg), at: rd.elapsed });
      if (rd.index >= RD_SEQ.length - 1) {
        rdStopTimer();
        rd.screen = "finished";
      } else {
        rd.index += 1;
      }
      rdRender();
    }

    rdRoot.addEventListener("click", function (evt) {
      var target = evt.target.closest ? evt.target.closest("[data-rd]") : null;
      if (!target) return;
      var action = target.getAttribute("data-rd");
      if (action === "info") { rd.info = target.getAttribute("data-key"); rdRender(true); return; }
      if (action === "close-info") {
        // On the backdrop itself, only a click on the backdrop closes --
        // clicks bubbling up from inside the card must not.
        if (target.classList.contains("rd-sheet") && evt.target !== target) return;
        rd.info = null; rdRender(true); return;
      }
      if (action === "set") {
        rd[target.getAttribute("data-group")] = target.getAttribute("data-value");
        rdRender(true);
        return;
      }
      if (action === "to-setup") { rd.screen = "setup"; rdRender(); return; }
      if (action === "to-hero") {
        rdStopTimer();
        rd.screen = "hero"; rd.index = 0; rd.elapsed = 0; rd.splits = []; rd.info = null;
        rdRender();
        return;
      }
      if (action === "start") {
        rd.screen = "running"; rd.index = 0; rd.elapsed = 0; rd.splits = []; rd.info = null;
        rdRender();
        rdStartTimer();
        return;
      }
      if (action === "complete") { rdComplete(); }
    });

    // The clock only runs while the demo is actually on screen -- a race
    // shouldn't tick itself away in a section nobody is looking at.
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (rd.screen !== "running") return;
          if (entry.isIntersecting) rdStartTimer();
          else rdStopTimer();
        });
      }, { threshold: 0.2 }).observe(rdRoot);
    }

    rdRender();
  }

  $$(".waitlist-form").forEach(wireForm);
})();
