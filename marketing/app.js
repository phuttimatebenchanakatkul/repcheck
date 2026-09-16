(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The site is a fixed canvas (--rc-frame-w x --rc-frame-h in styles.css),
  // so a "screen" of the scroll story is the frame's height and NOT the
  // viewport's. Read it from the stylesheet rather than repeating the number:
  // the CSS sizes the pinned panel and the story's total height from the same
  // variable, and if this disagreed with it by even a pixel the stage the
  // reader is on and the panel they are looking at would drift apart over six
  // features. Falls back to the viewport if the variable is ever removed.
  //
  // IS THIS THE CANVAS HOST? assets/canvas-frame.js decides that from the
  // hostname before the first paint and says so with a class; everything
  // below only needs to know which shape it woke up in.
  //   canvas  -- body IS a fixed 1080x566 box and scrolls inside itself
  //   plain   -- the ordinary page, the window scrolls
  // The two differ in what scrolls, so every scroll read and write in this
  // file goes through scroller()/toTop() rather than naming one of them.
  function onCanvas() {
    return document.documentElement.classList.contains("rc-canvas");
  }
  // The element ScrollTrigger and this file scroll. undefined means the
  // window, which is ScrollTrigger's own default.
  function scroller() {
    return onCanvas() ? document.body : undefined;
  }
  function toTop() {
    if (onCanvas()) document.body.scrollTop = 0;
    else window.scrollTo(0, 0);
  }

  // THE WHITE MARGIN HAS TO SCROLL THE CANVAS TOO.
  // On the canvas host html clips and body is the scroller, and body is only
  // 1080x565 of a much bigger window -- so the white around it belongs to
  // <html>, which has overflow: hidden and nothing to scroll. Point at it and
  // the wheel did nothing; click it and Page Down did nothing either. Most of
  // a 1440x900 window is that margin, so most of the window was dead.
  //
  // Both are forwarded to body rather than made scrollable, because the
  // margin must not move: it is the blank border of the picture.
  if (onCanvas()) {
    // The margin is the only place where <html> itself is the target -- over
    // the canvas the target is whatever is under the pointer inside body.
    window.addEventListener("wheel", function (evt) {
      if (evt.target !== document.documentElement) return;
      // deltaMode is not always pixels: Firefox reports lines, and a few
      // setups report pages. Untranslated, a 3-line notch scrolls 3px.
      var step = evt.deltaY;
      if (evt.deltaMode === 1) step *= 16;
      else if (evt.deltaMode === 2) step *= document.body.clientHeight;
      document.body.scrollTop += step;
      evt.preventDefault();
    }, { passive: false });

    var PAGE_KEYS = {
      PageDown: 1, PageUp: -1, " ": 1, Spacebar: 1,
      ArrowDown: 0.12, ArrowUp: -0.12, Down: 0.12, Up: -0.12
    };
    document.addEventListener("keydown", function (evt) {
      // Only when nothing is focused -- clicking the margin leaves the body
      // active. A key pressed in the waitlist field is the reader typing.
      var at = document.activeElement;
      if (at && at !== document.body && at !== document.documentElement) return;
      if (evt.ctrlKey || evt.metaKey || evt.altKey) return;

      var page = document.body.clientHeight;
      if (evt.key === "Home") document.body.scrollTop = 0;
      else if (evt.key === "End") document.body.scrollTop = document.body.scrollHeight;
      else if (PAGE_KEYS.hasOwnProperty(evt.key)) {
        var dir = PAGE_KEYS[evt.key];
        // Shift+Space is Page Up, the same as it is in every browser.
        if ((evt.key === " " || evt.key === "Spacebar") && evt.shiftKey) dir = -1;
        document.body.scrollTop += dir * page;
      } else return;
      evt.preventDefault();
    });
  }

  function frameH() {
    // MEASURED, not computed, and measured off whatever the frame actually
    // is: body on the canvas host, the viewport everywhere else. Reading
    // --rc-frame-h instead cannot work -- it is a calc(), and
    // getComputedStyle hands a custom property back as the tokens it was
    // written with, which parseFloat turns into NaN, and the fallback would
    // then quietly swap a different height in and drift the stages out of
    // step with the panel over six features.
    if (!onCanvas()) return window.innerHeight;
    var h = document.body.offsetHeight;
    return h > 0 ? h : window.innerHeight;
  }

  var yearEl = $("#year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // ---------- a refresh starts at the top ----------
  // Browsers put you back where you were when you reload, which is normally a
  // kindness and here is not one. This page is a pinned, scroll-driven story:
  // halfway down it, the hero is a fixed sheet faded to nothing, the panel is
  // held in place by a pin whose measurements are taken at load, and a title
  // is part-way through a fade. Restoring into the middle of that drops a
  // reader into a frame of an animation with no way to tell what they are
  // looking at -- and the loading screen plays over the top of it first.
  //
  // scrollRestoration is the supported way to decline it, and setting it here
  // -- before the pin exists -- is deliberate: it has to be in place before
  // the browser's own restore would run. The belt-and-braces scrollTo covers
  // the browsers that ignore the property, and the `load` one covers the
  // restore landing after this line does.
  //
  // A hash is the exception and must stay one: #waitlist from the nav, or
  // #top from the panel's wordmark, is a reader asking for somewhere
  // specific, and sending them to the top instead would break every in-page
  // link on the site.
  if ("scrollRestoration" in window.history) {
    window.history.scrollRestoration = "manual";
  }
  if (!window.location.hash) {
    toTop();
    window.addEventListener("load", toTop);
  }

  // ---------- loading screen ----------
  // The screen has a CSS animation that takes it away on its own, which is
  // what guarantees nobody is ever stuck behind it. This decides when it
  // leaves in the normal case, between two bounds:
  //
  //   * it waits for the page to finish loading, and
  //   * it stays at least LOADER_MIN_MS whatever happens.
  //
  // The floor is the point. Dismissing the moment `load` fired meant that on
  // anything quick -- which is most visits, the page is static and the fonts
  // are local -- the screen was gone in a couple of hundred milliseconds and
  // read as a flash of white rather than an arrival.
  //
  // Measured from performance.now(), which counts from navigation start
  // rather than from whenever this script happened to run, so the floor is
  // 1.5s of the visitor's time and not 1.5s of ours.
  var LOADER_MIN_MS = 1500;
  var loader = $("#rc-loader");
  if (loader) {
    var dismissLoader = function () {
      var since = window.performance && window.performance.now
        ? window.performance.now()
        : LOADER_MIN_MS;
      window.setTimeout(function () {
        loader.classList.add("is-done");
      }, Math.max(0, LOADER_MIN_MS - since));
    };
    if (document.readyState === "complete") dismissLoader();
    else window.addEventListener("load", dismissLoader);
  }

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

  // ---------- a mock control never KEEPS focus ----------
  // tabindex="-1" takes the handset out of the tab order. It does not stop a
  // mouse click focusing what it hits: Chrome, Edge and Firefox-on-Windows
  // all focus a <button> on mousedown whatever its tabindex. And the "+ Log a
  // food" button is static markup that nothing re-renders, so one click left
  // it as document.activeElement indefinitely -- which on the canvas host
  // means the page-key handler at the top of this file stands down for good
  // and Page Down, Home and End stop working until the reader clicks the
  // white margin. One click, permanent.
  //
  // So a button in here hands focus straight back. The two text fields do
  // NOT: a visitor who clicks into the search or the amount is typing, and
  // the keys are theirs while they do, exactly as in the waitlist field.
  // They give focus up when their sheet closes (nlClose).
  var phoneStage = $(".phone-stage", whatSection);
  if (phoneStage) {
    phoneStage.addEventListener("click", function (evt) {
      var at = document.activeElement;
      if (!at || !phoneStage.contains(at)) return;
      var tag = at.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (at.blur) at.blur();
    });
  }
  var tabs = $$(".tab", whatSection);
  // Which feature is currently in the handset -- read by the hover guard
  // below and by the race's rcShowing().
  var activeFeature = 0;
  // Screens that need to know when they stop (or start) being the one on
  // show: the race parks its clock, the food log drops any open sheet.
  var featureListeners = [];
  function onFeature(fn) { featureListeners.push(fn); }
  // Screens that can be mid-interaction register here so a stray hover
  // doesn't switch them away from under a visitor. An array, like the
  // listeners above it -- a second screen adding its own hold must not
  // silently clobber the first one's.
  var featureHolds = [];
  function onHold(fn) { featureHolds.push(fn); }

  // One screen (feature 01) is a real screen recording. Play it while it is
  // showing and pause + rewind it otherwise, so it isn't running silently
  // behind a screen you can't see.
  function showFeature(i) {
    // aria-pressed alongside the class: is-active is a colour change, which a
    // screen reader cannot see, so without this the switcher gives no clue
    // which of the six features is currently in the handset.
    featureBtns.forEach(function (b, n) {
      b.classList.toggle("is-active", n === i);
      b.setAttribute("aria-pressed", n === i ? "true" : "false");
    });
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
    activeFeature = i;
    featureListeners.forEach(function (fn) { fn(i); });
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
    b.addEventListener("mouseenter", function () {
      // Hover is a convenience, not a command. Once a screen holds something
      // the visitor put there themselves -- a sheet open in the food log, a
      // half-typed amount -- drifting the cursor across the list on the way
      // to the handset must not swap it out from under them. A click still
      // switches, because that one is deliberate. holdsFeature is set by the
      // screens that can be mid-interaction; nothing sets it, nothing holds.
      if (featureHolds.some(function (fn) { return fn(activeFeature); })) return;
      showFeature(i);
    });
  });
  showFeature(0);

  // ---------- scroll story: the same six features, driven by GSAP ----------
  // This block decides WHEN to call showFeature, and nothing else. The
  // switcher above still owns what a swap does -- which screen shows, which
  // video plays, what is announced -- so click and hover keep working exactly
  // as they did and there is only one code path for a feature change.
  //
  // Guarded on window.gsap and window.ScrollTrigger, which is the same
  // contract the IntersectionObserver version had: jsdom loads this file
  // without them, so the suites that run app.js over the shipped markup skip
  // the whole thing, and a browser that fails to fetch the two vendored
  // scripts gets the plain two-column list rather than a broken page.
  // .rc-story-on is set from here for that reason -- the class IS the
  // statement that the animation is alive, and every style hangs off it.
  var story = $(".rc-story");
  if (story && window.gsap && window.ScrollTrigger && featureBtns.length) {
    var gsap = window.gsap;
    var ScrollTrigger = window.ScrollTrigger;
    gsap.registerPlugin(ScrollTrigger);

    // ON THE CANVAS THE SCROLLER IS BODY, NOT THE WINDOW. The canvas is a
    // fixed-size box that scrolls internally (see the html.rc-canvas rules in
    // styles.css), so every trigger has to measure against it -- left on the
    // window, which never moves there, the whole story sits on its first
    // frame for good. Off the canvas host the window is the scroller and
    // ScrollTrigger's own default is already right, so this sets nothing.
    if (scroller()) ScrollTrigger.defaults({ scroller: scroller() });

    // THE HANDSET IS SIZED FROM THE FRAME, from here rather than from CSS.
    // The scale wants (frame height - the chrome around it) / 662, and CSS
    // calc cannot divide a length by a length to get the unitless number
    // scale() needs -- written that way it produces a LENGTH, scale() refuses
    // it, and the handset renders unscaled and runs out of the bottom of the
    // canvas. Which is exactly what it did.
    //
    // 662 is the handset: a 640px screen in 11px of bezel top and bottom.
    // The subtrahend is what the panel spends around it -- the strip and the
    // stage's padding in two columns, and the title and description as well
    // when they stack above it in one.
    var phoneEl = $(".phone", whatSection);
    function sizePhone() {
      if (!phoneEl) return;
      // 720 is the one-column breakpoint AND the point below which the
      // canvas stops being a fixed frame -- the same line in both, so this
      // reads the viewport rather than the canvas deliberately.
      var narrow = window.innerWidth <= 720;
      // What the panel spends AROUND the handset, measured rather than
      // derived: the strip, the stage's padding, and in one column the title
      // and description stacked above it.
      // The two-column figure differs by shape. In the 1.91:1 frame the panel
      // is 565px and the scroll cue sits high in it, and 150 leaves the
      // handset clear of it. On the full-bleed site the panel is the whole
      // window, the cue sits lower, and 150 put the handset 12px over it at a
      // 800px-tall window -- the one piece of copy on this panel that may not
      // be covered. 190 clears it, and above 900px the scale clamps to 1
      // either way so nothing visible changes there.
      var spare = narrow ? 290 : (onCanvas() ? 150 : 190);
      // The watch takes its own room out of the column beneath the handset.
      if (narrow && document.documentElement.classList.contains("rc-watch-on")) {
        spare = 420;
      }
      var scale = (frameH() - spare) / 662;
      scale = Math.max(0.25, Math.min(1, scale));
      phoneEl.style.setProperty("--rc-phone-scale", String(Math.round(scale * 1000) / 1000));
    }
    sizePhone();
    window.addEventListener("resize", sizePhone);
    // The watch coming and going changes what is left for the handset, and it
    // is app.js that knows when that happens.
    onFeature(sizePhone);

    // ScrollTrigger keeps its OWN record of where you were scrolled and puts
    // you back there on a refresh -- which is a sensible default for a pinned
    // layout and is the thing actually beating the scrollRestoration handling
    // at the top of this file. Setting history.scrollRestoration alone looked
    // like it did nothing: the page still came back at 3000px, because this
    // restore runs later and wins.
    //
    // clearScrollMemory takes the value to hand to history.scrollRestoration,
    // so this both throws away the saved position and re-states the decline.
    // Before any trigger is created, so there is nothing recorded to restore.
    if (ScrollTrigger.clearScrollMemory) ScrollTrigger.clearScrollMemory("manual");
    if (!window.location.hash) toTop();

    story.style.setProperty("--rc-stages", String(featureBtns.length));
    document.documentElement.classList.add("rc-story-on");

    // The wordmark in the panel's header row points at #top, which is the
    // hero -- and .rc-hero-pin makes the hero position:fixed. A fixed element
    // is always already at the top of the viewport, so the browser's own
    // anchor jump looks at it, decides there is nothing to scroll to, and
    // does nothing at all: the hash changes and the page stays put. Send it
    // to the top by hand instead. Only wired up in here on purpose -- with
    // the story off the hero is in flow and the plain anchor works.
    //
    // A plain jump, not a smooth one: nothing else on this site sets
    // scroll-behavior, so every other in-page link here lands instantly and a
    // smooth one would be the odd control out -- and running four thousand
    // pixels of a scroll-driven story backwards would play all six features
    // in reverse on the way past.
    var stripBrand = $(".strip-brand", whatSection);
    if (stripBrand) {
      stripBrand.addEventListener("click", function (evt) {
        evt.preventDefault();
        toTop();
      });
    }

    // The waitlist first, and deliberately: .rc-story-on has just hidden it,
    // so anything that threw between there and here would leave the one form
    // on the page invisible.
    var cta = $(".cta");
    if (cta) {
      ScrollTrigger.create({
        trigger: cta,
        start: "top 85%",
        once: true,
        onEnter: function () { cta.classList.add("is-in"); }
      });
    }

    // One trigger for the whole section rather than a marker per stage.
    // The section is (features + 2) screens tall and the panel is pinned by
    // CSS for all but the last, so progress runs across (features + 1)
    // screens of scrolling: screen 0 is the hero zoom, screen n+1 belongs to
    // feature n. Clamped at both ends, so the top of the page always resolves
    // to feature 01 however the reader arrived there -- scrolling from the
    // bottom back to the top used to leave whatever was last showing.
    // One trigger per stage, each naming the feature it is responsible for,
    // rather than one trigger deriving an index from overall progress. The
    // derived version was wrong in a way that was not obvious from reading
    // it: it would climb but never come back down past the second feature,
    // and calling its own callback by hand at a known progress refused to
    // move it, so the fault was the arithmetic and not how often it ran.
    // A start and an end per stage is the shape ScrollTrigger is built
    // around, and each one says out loud which feature it means.
    //
    // Stage n runs from n+1 screens into the section to n+2, because the
    // first screen belongs to the hero zoom. The hero's own screen maps to
    // feature 01 too, so the top of the page always resolves to 01 however
    // the reader arrived there.
    var screenPx = function (n) {
      return function () { return "top top-=" + (n * frameH()); };
    };
    var stageAt = function (from, to, feature) {
      ScrollTrigger.create({
        trigger: story,
        start: screenPx(from),
        end: screenPx(to),
        onEnter: function () { showFeature(feature); },
        onEnterBack: function () { showFeature(feature); }
      });
    };
    stageAt(0, 1, 0);
    for (var f = 0; f < featureBtns.length; f++) {
      stageAt(f + 1, f + 2, f);
    }

    // The zoom. The hero is a fixed sheet over the whole viewport, so scaling
    // it up while it fades reads as the reader being pushed through it rather
    // than it being taken away, and the panel coming up from slightly under
    // size reads as arriving at something rather than it sliding in. Scrubbed,
    // so it is the scroll doing it and not a timer.
    //
    // Only transform and opacity, which is what keeps it on the compositor.
    //
    // gsap.matchMedia, not an `if`: reduced motion gets no zoom AND no pin,
    // which matters because .rc-hero-pin is what makes the hero fixed -- a
    // fixed hero with nothing fading it would cover the page for good.
    var hero = $(".hero");
    var panel = $(".rc-story-view");
    if (hero && panel) {
      gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", function () {
        document.documentElement.classList.add("rc-hero-pin");

        var zoom = gsap.timeline({
          scrollTrigger: {
            trigger: story,
            start: "top top",
            end: function () { return "+=" + frameH(); },
            scrub: 0.4,
            onUpdate: function (self) {
              // An invisible sheet is still a sheet: without this the hero
              // keeps swallowing every click meant for the panel behind it.
              hero.style.pointerEvents = self.progress > 0.72 ? "none" : "";
            }
          }
        });

        // Scale and opacity are separate tweens on purpose, and the opacity
        // is the shorter of the two. Run as one, the hero was still legible
        // at a tenth of its strength while the panel came up, so the headline
        // ghosted straight through the handset -- two pages of text over each
        // other, which is the thing this section keeps being asked not to do.
        // The hero is out of sight by 0.55 while its scale keeps climbing to
        // the end, so the movement carries on under the arrival instead of
        // stopping dead the moment it goes.
        zoom
          .fromTo(hero, { scale: 1 }, { scale: 1.5, ease: "power1.in", duration: 0.9 }, 0)
          .fromTo(hero, { opacity: 1 }, { opacity: 0, ease: "power2.in", duration: 0.55 }, 0)
          .fromTo(panel,
            { scale: 0.88, opacity: 0 },
            { scale: 1, opacity: 1, ease: "power2.out", duration: 0.42 }, 0.55);

        // Everything this branch touched, undone if the preference flips.
        return function () {
          document.documentElement.classList.remove("rc-hero-pin");
          zoom.scrollTrigger && zoom.scrollTrigger.kill();
          zoom.kill();
          gsap.set([hero, panel], { clearProps: "all" });
          hero.style.pointerEvents = "";
        };
      });
    }

    // ---------- the handset settles into each feature ----------
    // Scroll position was only ever an on/off switch in here: cross a stage
    // line and the title swaps. Between the lines nothing moved, so a screen
    // of scrolling bought a reader nothing -- which is the opposite of what a
    // pinned section is for.
    //
    // So each stage now scrubs the handset through an arc: it comes up from
    // slightly under size and dimmed, settles, holds for the middle of the
    // stage, and recedes again as the stage runs out. The arc is symmetric ON
    // PURPOSE -- it ends where the next one begins, so the boundary is
    // continuous rather than a snap back to the start of the next arc, and
    // the trough lands exactly where showFeature() swaps the screen, so the
    // swap happens at the handset's dimmest and smallest rather than in front
    // of the reader.
    //
    // The TITLE is deliberately left out. It cross-fades and does not travel,
    // which is a decision this section has already made twice (see the
    // .rc-story-on .feature comment in styles.css): a title that slides reads
    // as the page scrolling under a window, and the panel is meant to hold
    // still while its contents change. Moving the handset is the one thing
    // here that cannot be mistaken for the page moving, because it has the
    // pinned panel around it as a fixed reference.
    //
    // Transform and opacity only, and the transform goes through the two
    // custom properties styles.css composes -- never `transform` itself,
    // which would clobber the height-driven layout scale beside it.
    var phone = $(".phone", whatSection);
    if (phone) {
      gsap.matchMedia().add({
        motion: "(prefers-reduced-motion: no-preference)",
        narrow: "(max-width: 720px)"
      }, function (ctx) {
        // Reduced motion keeps the plain cross-fade it already had. No pin is
        // added or removed here -- this branch only ever animates -- so
        // unlike the zoom above there is nothing to leave broken.
        if (!ctx.conditions.motion) return;

        // Smaller travel in one column: the handset is already scaled down
        // there and the title sits right on top of it, so the same distance
        // read as the two colliding rather than as depth.
        //
        // All three were deeper -- 0.94, 22px, half strength -- and between
        // them the handset dropped noticeably out of the page at every
        // boundary. It was doing two jobs: moving, and covering for a title
        // that changed on a timer it had nothing to do with. The title is on
        // the same clock as this now, so the dip only has to be a dip.
        var narrow = ctx.conditions.narrow;
        var SETTLE = narrow ? 0.98 : 0.97;
        var LIFT = (narrow ? 6 : 10) + "px";
        var DIM = narrow ? 0.82 : 0.75;

        // Built fresh per call rather than shared: fromTo() keeps a reference
        // to the vars it is handed, and three timelines editing one object is
        // the kind of thing that works until it doesn't.
        var away = function (extra) {
          return {
            "--rc-phone-settle": SETTLE,
            "--rc-phone-lift": LIFT,
            opacity: DIM,
            ease: extra && extra.ease,
            duration: extra && extra.duration
          };
        };
        var rest = function (extra) {
          return {
            "--rc-phone-settle": 1,
            "--rc-phone-lift": "0px",
            opacity: 1,
            ease: extra && extra.ease,
            duration: extra && extra.duration
          };
        };

        // The title's fade, moved off CSS and onto this timeline. It was a
        // transition -- 0.2s out, then 0.3s in after a 0.2s delay -- and a
        // half-second timer is the one thing in this section that was not
        // answering to the scroll. Stop half way through a change and the
        // timer finished the job without you; scroll quickly and the handset
        // was already a feature ahead of the words beside it. Scrubbed, the
        // words and the handset cannot come apart, because they are the same
        // tween.
        //
        // Short windows at the two edges rather than a long dissolve. The six
        // titles share one grid cell, so anything that has them both up at
        // once draws them over each other -- at this size that reads as
        // doubled letterforms, which is why the CSS had the delay. Out by the
        // stage line and in from the stage line keeps one legible at a time,
        // and because it is scroll-linked the gap between them is a boundary
        // rather than a beat: it has no duration to sit through.
        // HOW LONG A FADE IS, AS A FRACTION OF ITS STAGE, AND WHY IT IS THIS
        // BIG. A stage is one screen of scrolling. At a fifth of that -- which
        // is what this was -- a fade spanned about 180px at a laptop's height,
        // and a mouse wheel moves 100px a notch. So the whole of a fade was
        // under two notches: two samples of it, and the reader saw a title at
        // full strength, then at something like half, then gone. That is not a
        // fade, it is a three-frame flick-book, and no amount of easing fixes
        // a curve you are only sampling twice.
        //
        // At 0.38 the same fade is ~340px, three or four notches, and the
        // smoothing below carries the frames in between. The hold shrinks to a
        // quarter of the stage, which is the trade and it is worth it: a title
        // that is legible for a quarter of a screen and arrives gently beats
        // one legible for three fifths that snaps in.
        var IN_AT = 0.38;
        // sine, not power: it is the shallowest of the standard curves at
        // both ends, so a title neither jumps off zero nor hangs at full
        // strength before it goes. On a fade with nothing else to look at,
        // that difference is the whole of how smooth it reads.
        var EASE_IN = "sine.out";
        var EASE_OUT = "sine.in";

        // ONE timeline for the whole pinned run, not one per stage.
        //
        // Six separate scrubbed timelines cannot be relied on to hand over
        // cleanly, and measuring caught them not doing it: each carries its
        // own 0.35s of smoothing, so on a quick scroll the outgoing stage was
        // still catching up while the incoming one had already arrived, and
        // for a moment the cell held two titles at once -- 0.72 and 1.00 over
        // each other, which at this size is the doubled letterforms the old
        // CSS delay existed to prevent. On one timeline there is one playhead
        // and one lag, so a title's fade-out ENDS where the next one's
        // fade-in begins, by construction, at any scroll speed.
        //
        // Six units long, one per stage, so `s` is both the feature index and
        // the position on the timeline.
        var master = gsap.timeline({
          scrollTrigger: {
            trigger: story,
            start: screenPx(1),
            end: screenPx(1 + featureBtns.length),
            // THE SMOOTHING, and this number is doing most of the work.
            //
            // A scrub is not a per-frame read of the scroll position: GSAP
            // tweens the playhead TOWARDS where the scroll says it should be,
            // over this many seconds, on its own rAF. So the number is how
            // much of the animation the browser draws that the scroll never
            // asked for -- the in-between frames a wheel does not produce,
            // because a wheel does not produce any: it jumps 100px at a time
            // and then nothing.
            //
            // At 0.45 one notch resolved in a handful of frames, which is why
            // the fade looked like it was stepping through the scroll rather
            // than running under it. At 1.1 a single notch is most of a
            // second of drawn animation, and a run of them reads as one
            // continuous movement instead of a stack of jumps.
            //
            // The cost is that the panel keeps moving for about a second
            // after the wheel stops. That is the intended feel -- weight, a
            // heavy thing coming to rest -- and it is NOT the delay this
            // section used to have: that one was a fixed half-second of
            // nothing happening, regardless of whether you were moving.
            scrub: 1.1
          }
        });

        for (var s = 0; s < featureBtns.length; s++) {
          master
            // The handset: 0 -> 0.3 arriving, 0.3 -> 0.7 held, 0.7 -> 1
            // leaving. The hold is the point -- the middle of a stage is
            // where a reader is actually reading the thing, and a handset
            // still drifting under them there is a distraction, not depth.
            // The handset, on the same windows as the title beside it. They
            // were 0.3 while the title was 0.2; leaving them there while the
            // title stretched to 0.38 would have had the phone settled and
            // waiting through the second half of every arrival.
            .fromTo(phone, away(), rest({ ease: "power2.out", duration: IN_AT }), s)
            .to(phone, away({ ease: "power2.in", duration: IN_AT }), s + 1 - IN_AT)
            // The title, on the same clock. autoAlpha, not opacity: it writes
            // visibility alongside, which is what keeps five invisible titles
            // out of the tab order -- the same pair the CSS was setting by
            // hand.
            .fromTo(featureBtns[s], { autoAlpha: 0 },
              { autoAlpha: 1, ease: EASE_IN, duration: IN_AT }, s)
            .to(featureBtns[s],
              { autoAlpha: 0, ease: EASE_OUT, duration: IN_AT }, s + 1 - IN_AT);
        }
      });
    }
  }

  // ---------- race walkthrough: the app's four HYROX screens, playable ----------
  // Feature 05's screen replays one athlete's 1:24:06 Men's Open Singles race
  // through the same four screens the app renders -- simulator, race setup,
  // running clock, finish -- driven entirely from inside the handset: Start
  // race, the setup toggles, Complete on every split, Log another race.
  // Everything factual is lifted from the shipping app rather
  // than written for this page:
  //   * the 8+8 segment order and the run/station titles  (static/hyrox.js STATIONS)
  //   * Open/Pro loads, wall-ball reps and target height  (STATION_SPECS)
  //   * lap counts off a 12.5m lane                       (DEFAULT_LANE_M, roundsFor)
  //   * the "how it's done" copy behind every station      (static/i18n.js hyrox.standards.*)
  //   * the finish breakdown and the coach's focus/strong/solid grouping
  //                                                       (hyrox_coach.py)
  var rcScreen = $("#rc-screen", whatSection);
  if (rcScreen) {
    var rcWatch = $("#rc-watch", whatSection);
    var rcIndex = screens.indexOf(rcScreen);
    var rcShowing = function () { return activeFeature === rcIndex; };

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
    // Was 60 -- one real second per race minute, which walked the whole
    // 1:24:06 in 84 seconds. Nobody watched 84 seconds of it. The race is a
    // fast-forward now: the clock is the athlete's real one and every split
    // it records is real, it just arrives in about five seconds. Read with
    // RC_AUTO below -- the two together are the ten seconds this screen gets.
    var RC_RATE = 1050;     // 5046 race-seconds in ~5 real seconds

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
        return '<button type="button" tabindex="-1" class="stchip" data-rc="info" data-key="' + key + '">' +
          '<span>' + (i + 1) + '</span><b>' + RC_SHORT[key] + '</b></button>';
      }).join("");
      return '<div class="scr-head"><b>HYROX</b><span class="avatar">J</span></div>' +
        '<div class="card">' +
          '<div class="row"><span class="date">YOUR PERSONAL BEST</span><span class="pill">4 races</span></div>' +
          '<b class="clock">1:24:06</b>' +
          '<span class="sub">Men\'s Open Singles</span>' +
          '<div class="stchips">' + chips + '</div>' +
          '<span class="centered sub">Tap a station to see how it\'s done</span>' +
          '<button type="button" tabindex="-1" class="cta-blue" data-rc="to-setup">Start race</button>' +
          '<span class="centered link">View history</span>' +
        '</div>';
    }

    function rcChoice(group, value, title, sub, selected) {
      return '<button type="button" tabindex="-1" class="rc-choice' + (selected ? " is-on" : "") + '" data-rc="set" data-group="' + group + '" data-value="' + value + '">' +
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
        '<button type="button" tabindex="-1" class="cta-blue" data-rc="start">Start race</button>';
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
            ? '<button type="button" tabindex="-1" class="rc-how" data-rc="info" data-key="' + seg.key + '">How to do it</button>'
            : "") +
        '</div>' +
        '<div class="rc-dots">' + dots + '</div>' +
        '<button type="button" tabindex="-1" class="rc-complete" data-rc="complete">' + (isLast ? "Finish race" : "Complete") + '</button>' +
        '<button type="button" tabindex="-1" class="rc-cancel" data-rc="to-hero">Cancel this race</button>' +
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
        '<button type="button" tabindex="-1" class="cta-blue" data-rc="to-hero">Log another race</button>';
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
        '<button type="button" tabindex="-1" class="rc-sheet-close" data-rc="close-info" aria-label="Close">&times;</button></div>' +
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
        '<button type="button" tabindex="-1" class="watch-btn" data-rc="complete">' + (isLast ? "Finish" : "Done") + '</button>' +
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
      rcWatch.innerHTML = showWatch
        ? rcWatchHtml() + '<p class="watch-note"><b>Apple Watch companion</b>In design, not shipped — the same race on your wrist, so logging a split is one tap instead of a pocket dive.</p>'
        : "";
      rcSyncWatch();
    }

    // The watch is a second device standing BESIDE the handset, not a screen
    // inside it, so nothing in the feature switcher hides it -- and the race
    // leaves its finished screen up when you scroll on, which left an Apple
    // Watch reading 1:24:06 parked next to the nutrition log. Its own race
    // state is only half the question; the other half is whether the race is
    // the feature on show at all.
    function rcSyncWatch() {
      var racing = rc.screen === "running" || rc.screen === "finished";
      var on = racing && rcShowing();
      rcWatch.hidden = !on;
      // A class on the root as well, because ONE COLUMN CANNOT HOLD BOTH
      // DEVICES AT FULL SIZE and the stylesheet has no other way to know the
      // watch is out. At 375px the phone is 194px wide with a 90px gutter
      // each side -- too narrow for a legible watch, so the watch has to
      // overlap the handset, and its note ("In design, not shipped") is grey
      // body copy that becomes unreadable the moment it crosses onto a black
      // screen. That note is a disclosure, not decoration: it is the only
      // thing on the page saying the watch app does not exist yet, so it
      // cannot be the thing that gets dropped to make room.
      //
      // So on a narrow screen the handset gives up some size while the watch
      // is out, and the two stack. Nothing changes on a wide one, where they
      // have always sat side by side. See the .rc-watch-on rules.
      document.documentElement.classList.toggle("rc-watch-on", on);
    }

    function rcStop() { if (rc.timer) { clearInterval(rc.timer); rc.timer = null; } }
    function rcStart() {
      rcStop();
      // Reduced motion gets no self-advancing clock (WCAG 2.2.2) -- Complete
      // and the watch's Done button still walk the race by hand.
      if (reduced) return;
      // Nor while some other feature's screen is the one on show.
      if (!rcShowing()) return;
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
      if (rc.index >= RC_SEQ.length - 1) {
        rcStop();
        rc.screen = "finished";
        // The finish is the payoff, so it holds before the run starts over.
        rcAutoAfter(RC_AUTO.finished, rcAutoRun);
      }
      else rc.index += 1;
      rcRender();
    }

    // Jumping straight to a stage: the clock and the splits have to be
    // consistent with the stage you land on, so each one rebuilds the race
    // state it implies.
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
      }
      rcRender();
    }

    // ----- the race plays itself -----
    // Every other screen in this section arrives already running: 01 is a
    // recording, 02 fills its own food log, 04 acts out a set. This one sat
    // on a start button and waited, then wanted sixteen more taps -- which
    // is a fair ask of somebody who has installed the app and none at all of
    // somebody deciding whether to. So it walks itself, in about ten seconds,
    // and loops: 1s on the hero, 1.2s on the setup, ~5.4s of race (RC_RATE),
    // 2.4s on the finish, then again.
    //
    // Every screen it lands on is the one a reader would have reached by
    // hand, and rcGoto is the same function the buttons call -- the demo is
    // pressing them, not taking a shortcut past them.
    var RC_AUTO = { hero: 1000, setup: 1200, finished: 2400 };
    var rcAutoTimer = null;
    // A reader who touches a control has taken over, and an autoplay that
    // carried on would fight them -- so the first [data-rc] click ends it for
    // good, and nothing restarts it.
    var rcAutoOff = reduced;

    function rcAutoStop() {
      if (rcAutoTimer) { window.clearTimeout(rcAutoTimer); rcAutoTimer = null; }
    }
    function rcAutoAfter(ms, fn) {
      rcAutoStop();
      if (rcAutoOff) return;
      rcAutoTimer = window.setTimeout(fn, ms);
    }
    // Deliberately NOT also gated on rcOnScreen, the way rcStart() is. That
    // flag is only ever written by the IntersectionObserver below, so until
    // the observer has had its first callback the gate is whatever the
    // initialiser happened to say -- and a feature can become the active one
    // before that lands, in which case the walkthrough would silently never
    // start and the screen would sit on its hero for good. Being off screen
    // is handled where it is actually known instead: the observer calls
    // rcAutoStop() on the way out and rcAutoRun() on the way back.
    function rcAutoCan() { return !rcAutoOff && rcShowing(); }

    function rcAutoRun() {
      if (!rcAutoCan()) return;
      rcGoto("hero");
      rcAutoAfter(RC_AUTO.hero, function () {
        if (!rcAutoCan()) return;
        rcGoto("setup");
        rcAutoAfter(RC_AUTO.setup, function () {
          if (!rcAutoCan()) return;
          // rcGoto("running") starts the clock, and the clock walks the
          // sixteen segments through rcComplete() on its own from there.
          rcGoto("running");
        });
      });
    }

    // Delegated on the whole section: every [data-rc] lives either in the
    // handset or in the watch rig beside it, and both sit inside it.
    whatSection.addEventListener("click", function (evt) {
      var el = evt.target.closest ? evt.target.closest("[data-rc]") : null;
      if (!el) return;
      rcAutoOff = true;
      rcAutoStop();
      var action = el.getAttribute("data-rc");
      if (action === "info") { rc.info = el.getAttribute("data-key"); rcRender(true); return; }
      if (action === "close-info") {
        // Only a click on the backdrop itself closes -- not one bubbling out
        // of the card sitting on top of it.
        if (el.classList.contains("rc-sheet") && evt.target !== el) return;
        rc.info = null; rcRender(true); return;
      }
      if (action === "set") { rc[el.getAttribute("data-group")] = el.getAttribute("data-value"); rcRender(true); return; }
      if (action === "to-setup") { rcGoto("setup"); return; }
      if (action === "to-hero") { rcGoto("hero"); return; }
      if (action === "start") { rcGoto("running"); return; }
      if (action === "complete") { rcComplete(); }
    });

    // The clock only runs while the section is on screen -- a race shouldn't
    // tick itself away in a section nobody is looking at.
    var rcOnScreen = true;
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          rcOnScreen = entry.isIntersecting;
          if (!rcOnScreen) rcAutoStop();
          else if (rcAutoCan() && rc.screen === "hero") rcAutoRun();
          if (rc.screen !== "running") return;
          if (rcOnScreen && rcShowing()) rcStart(); else rcStop();
        });
      }, { threshold: 0.2 }).observe(whatSection);
    }

    // Same rule for the switcher: hovering another feature parks the race
    // where it got to rather than running it out behind a screen you can't
    // see, and coming back picks it up again.
    onFeature(function () {
      // Unconditional, and ahead of the clock: the watch has to leave on a
      // FINISHED race too, which the running-only guard below would skip.
      rcSyncWatch();
      if (rcShowing()) {
        // Arriving at the feature: start the walkthrough from the top, so a
        // reader who reaches it always sees the race from its hero rather
        // than joining whatever the last visit left behind.
        if (rcAutoCan()) rcAutoRun();
      } else {
        rcAutoStop();
      }
      if (rc.screen !== "running") return;
      if (rcOnScreen && rcShowing()) rcStart(); else rcStop();
    });

    rcRender();
  }

  // ---------- nutrition log: a food log you can actually add to ----------
  // Feature 02 used to be a screen recording of someone logging jasmine rice.
  // It is the real thing now: search the library, pick a food, set the amount
  // in servings / grams / ounces, add it, and the day's ring, macro bars and
  // entry list move -- the same three steps the app asks for, with the same
  // arithmetic behind them.
  //
  // Everything factual is lifted from the app rather than written for this
  // page:
  //   * every food's per-100g calories/protein/fat/carbs  (food_library.py)
  //   * a dish's "1 serving" = its recipe's total grams; a raw ingredient has
  //     no inherent serving, so it falls back to the 100g its macros are
  //     anchored to                                        (openLogAmountModal)
  //   * unit switching converts the amount rather than resetting it, so
  //     "2 servings" becomes "60 g", not "1"               (lq-unit-seg)
  //   * the ring plots the macro SPLIT by calories, not by grams
  //                                                        (donutChartHtml)
  var nlScreen = $("#nl-screen", whatSection);
  if (nlScreen) {
    var NL_OZ = 28.3495;
    // James's day, matching the weekly check-in screen next door: 1,802 kcal,
    // and macro targets that add up to it (135*4 + 60*9 + 180*4 = 1,800).
    var NL_GOAL = { kcal: 1802, protein: 135, fat: 60, carbs: 180 };
    // per 100 g, exactly as food_library.py has them. serving is what "1
    // serving" means in the amount editor: a dish's recipe total, or 100g
    // for a raw ingredient.
    var NL_FOODS = [
      { name: "Jasmine Rice, cooked", calories: 129, protein: 2.7, fat: 0.3, carbs: 28, serving: 100 },
      { name: "Chicken Breast, cooked", calories: 165, protein: 31, fat: 3.6, carbs: 0, serving: 100 },
      { name: "Egg, whole", calories: 155, protein: 13, fat: 11, carbs: 1.1, serving: 100 },
      { name: "Greek Yogurt, plain nonfat", calories: 59, protein: 10, fat: 0.4, carbs: 4, serving: 100 },
      { name: "Oats, dry", calories: 389, protein: 17, fat: 7, carbs: 66, serving: 100 },
      { name: "Banana", calories: 89, protein: 1.1, fat: 0.3, carbs: 23, serving: 100 },
      { name: "Salmon, cooked", calories: 208, protein: 20, fat: 13, carbs: 0, serving: 100 },
      { name: "Whey Protein Powder", calories: 400, protein: 80, fat: 5, carbs: 8, serving: 100 },
      { name: "Sweet Potato, baked", calories: 90, protein: 2, fat: 0.2, carbs: 21, serving: 100 },
      { name: "Avocado", calories: 160, protein: 2, fat: 15, carbs: 8.5, serving: 100 },
      { name: "Almonds", calories: 579, protein: 21, fat: 50, carbs: 22, serving: 100 },
      { name: "Tofu", calories: 76, protein: 8, fat: 4.8, carbs: 1.9, serving: 100 },
      { name: "Pad Thai", calories: 126, protein: 9.3, fat: 3.9, carbs: 13.8, serving: 360 },
      { name: "Green Curry, Chicken", calories: 171, protein: 12.4, fat: 12.3, carbs: 3, serving: 340 },
      { name: "Som Tam, Papaya Salad", calories: 93, protein: 2.6, fat: 3.7, carbs: 14.2, serving: 203 },
      { name: "Tom Yum Soup, Shrimp", calories: 76, protein: 15.8, fat: 0.3, carbs: 3.2, serving: 163 },
      // The one name in this table with a character nlEsc() has to handle --
      // every other entry is plain enough that an escaping bug would ship
      // invisibly.
      { name: "General Tso's Chicken", calories: 241, protein: 22.1, fat: 9.4, carbs: 15.5, serving: 225 }
    ];

    var nl = { sheet: null, food: null, serving: 100, unit: "serving", amount: 1, log: [] };

    var nlQuery = $("#nl-query", nlScreen);
    var nlResults = $("#nl-results", nlScreen);
    var nlAmountInput = $("#nl-amount", nlScreen);
    var nlToast = $("#nl-toast", nlScreen);
    var nlSheets = { search: $("#nl-search-sheet", nlScreen), amount: $("#nl-amount-sheet", nlScreen) };
    var nlToastTimer = null;

    function nlEsc(s) {
      return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    function nlNum(n) { return Math.round(n).toLocaleString("en-US"); }
    function nlText(id, value) { var el = $("#" + id, nlScreen); if (el) el.textContent = value; }

    // ---- amount editor ----
    function nlGramsPerUnit(unit) {
      if (unit === "g") return 1;
      if (unit === "oz") return NL_OZ;
      return nl.serving;
    }
    // 20kg of one food is already absurd, but it is a real number the ring
    // and macro bars can still plot -- 999999999 is not: the label would
    // read in the billions of kcal while the ring and bars, correctly
    // clamped at a full circle / 100%, stayed put a few pixels wide. Capping
    // the grams keeps every number on screen honest about what it is
    // actually showing.
    var NL_MAX_GRAMS = 20000;
    function nlGrams() { return Math.min(NL_MAX_GRAMS, Math.max(0, nl.amount * nlGramsPerUnit(nl.unit))); }
    // A food's numbers are per 100g whether it is a raw ingredient or a
    // composite dish (food_library.py derives a dish's per-100g values from
    // its recipe), so one scale-by-grams covers both.
    function nlMacros(food, grams) {
      var scale = grams / 100;
      return {
        calories: food.calories * scale,
        protein: food.protein * scale,
        fat: food.fat * scale,
        carbs: food.carbs * scale
      };
    }

    var NL_DONUT_R = 46;
    var NL_DONUT_C = 2 * Math.PI * NL_DONUT_R;

    function nlRenderAmount() {
      if (!nl.food) return;
      var m = nlMacros(nl.food, nlGrams());
      var pKcal = Math.max(0, m.protein) * 4;
      var fKcal = Math.max(0, m.fat) * 9;
      var cKcal = Math.max(0, m.carbs) * 4;
      var total = pKcal + fKcal + cKcal;
      var parts = [
        { key: "p", frac: total > 0 ? pKcal / total : 0, grams: m.protein },
        { key: "f", frac: total > 0 ? fKcal / total : 0, grams: m.fat },
        { key: "c", frac: total > 0 ? cKcal / total : 0, grams: m.carbs }
      ];
      var offset = 0;
      parts.forEach(function (part) {
        var len = NL_DONUT_C * part.frac;
        var seg = $("#nl-seg-" + part.key, nlScreen);
        if (seg) {
          seg.setAttribute("stroke-dasharray", len + " " + NL_DONUT_C);
          seg.setAttribute("stroke-dashoffset", String(-offset));
          seg.style.strokeLinecap = len > 0 ? "round" : "butt";
        }
        nlText("nl-pct-" + part.key, Math.round(part.frac * 100) + "%");
        nlText("nl-g-" + part.key, Math.round(part.grams) + "g");
        offset += len;
      });
      nlText("nl-donut-kcal", String(Math.round(m.calories)));
      nlText("nl-food-name", nl.food.name);
      nlText("nl-serving-hint", "1 serving = " + nl.serving + "g");
      $$(".nl-unit-seg button", nlScreen).forEach(function (b) {
        var on = b.getAttribute("data-unit") === nl.unit;
        b.classList.toggle("is-active", on);
        // The segment reads as colour alone otherwise: aria-pressed is what
        // says "grams, selected" to a screen reader.
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }

    function nlPick(food) {
      nl.food = food;
      // A dish's recipe default total is its natural "1 serving"; a raw
      // ingredient has none, so it falls back to the 100g reference its
      // macros are already anchored to.
      nl.serving = food.serving || 100;
      nl.unit = "serving";
      nl.amount = 1;
      if (nlAmountInput) nlAmountInput.value = "1";
      nlRenderAmount();
      nlOpen("amount");
    }

    // ---- the day ----
    function nlTotals() {
      return nl.log.reduce(function (sum, e) {
        sum.calories += e.calories; sum.protein += e.protein;
        sum.fat += e.fat; sum.carbs += e.carbs;
        return sum;
      }, { calories: 0, protein: 0, fat: 0, carbs: 0 });
    }

    var NL_RING_R = 52; // matches .nl-ring-track/.nl-ring-fill's r="52" in index.html
    var NL_RING_C = 2 * Math.PI * NL_RING_R;

    function nlRenderDay() {
      var t = nlTotals();
      var left = NL_GOAL.kcal - t.calories;
      nlText("nl-left", nlNum(Math.abs(left)));
      nlText("nl-eaten", nlNum(t.calories) + " of " + nlNum(NL_GOAL.kcal));
      var leftLabel = $(".nl-ring-center .ring-label", nlScreen);
      if (leftLabel) leftLabel.textContent = left < 0 ? "KCAL OVER" : "KCAL LEFT";
      var fill = $("#nl-ring-fill", nlScreen);
      if (fill) {
        var frac = Math.min(1, NL_GOAL.kcal > 0 ? t.calories / NL_GOAL.kcal : 0);
        fill.setAttribute("stroke-dasharray", (NL_RING_C * frac) + " " + NL_RING_C);
        // A round cap on a zero-length dash still paints a dot at 12 o'clock,
        // so an untouched day looked like it already had something in it.
        // Inline, not a presentation attribute: the stylesheet's own
        // stroke-linecap would win over the attribute and keep the dot.
        fill.style.strokeLinecap = frac > 0 ? "round" : "butt";
        fill.classList.toggle("is-over", left < 0);
      }
      [["p", "protein"], ["f", "fat"], ["c", "carbs"]].forEach(function (pair) {
        var got = t[pair[1]];
        var goal = NL_GOAL[pair[1]];
        nlText("nl-mac-" + pair[0], Math.round(got) + " / " + goal + "g");
        var bar = $("#nl-bar-" + pair[0], nlScreen);
        var pct = Math.min(100, goal > 0 ? (got / goal) * 100 : 0);
        if (bar) bar.style.width = (Math.round(pct * 10) / 10) + "%";
      });

      nlText("nl-count", nl.log.length
        ? nl.log.length + (nl.log.length === 1 ? " food · " : " foods · ") + nlNum(t.calories) + " kcal"
        : "Nothing logged");

      var list = $("#nl-entries", nlScreen);
      if (!list) return;
      if (!nl.log.length) {
        list.innerHTML = '<div class="empty"><span class="blob"></span><b>Nothing logged yet</b>' +
          '<span class="sub">Search a food, set the amount — the ring moves with it.</span></div>';
        return;
      }
      list.innerHTML = nl.log.map(function (e, i) {
        return '<div class="nl-entry">' +
          '<span class="nl-entry-id"><b>' + nlEsc(e.name) + '</b>' +
          '<span class="sub">' + e.label + ' · ' + Math.round(e.protein) + 'P / ' + Math.round(e.fat) + 'F / ' + Math.round(e.carbs) + 'C</span></span>' +
          '<b class="nl-entry-kcal">' + nlNum(e.calories) + '</b>' +
          '<button type="button" tabindex="-1" class="nl-x" data-nl="remove" data-i="' + i + '" aria-label="Remove ' + nlEsc(e.name) + '">&times;</button>' +
          '</div>';
      }).join("");
    }

    function nlAdd() {
      var grams = nlGrams();
      if (!nl.food || grams <= 0) {
        // Tapping Add on a blank/zero amount used to do nothing at all --
        // no toast, no shake, nothing -- which reads as a broken button
        // rather than a rejected amount. Nudge the field that needs fixing,
        // the same feedback shape the app's own onboarding tour uses for a
        // blocked action.
        var amountCard = $(".nl-amount", nlScreen);
        if (amountCard) {
          amountCard.classList.remove("is-nudging");
          // Reflow forces the animation to restart on a second tap in a row,
          // where merely re-adding the class would be a no-op.
          void amountCard.offsetWidth;
          amountCard.classList.add("is-nudging");
        }
        nlFakeFocus(nlAmountInput);
        // The shake and the caret are both pictures. Moving focus to the
        // field used to be the one part of this a screen reader could
        // follow, and dropping the .focus() took it away -- so say it, into
        // the toast that is already role="status" aria-live="polite".
        nlSay("Set an amount first");
        return;
      }
      var m = nlMacros(nl.food, grams);
      // The amount as it was typed, not re-derived: "1 serving" of pad thai
      // should read back as a serving, with the grams it worked out to.
      var label = nl.unit === "serving"
        ? nl.amount + (nl.amount === 1 ? " serving" : " servings") + " · " + Math.round(grams) + " g"
        : Math.round(grams) + " g";
      nl.log.push({
        name: nl.food.name, label: label,
        calories: m.calories, protein: m.protein, fat: m.fat, carbs: m.carbs
      });
      nlRenderDay();
      nlClose();
      nlSay(nl.food.name + " added · " + nlNum(m.calories) + " kcal");
    }

    function nlSay(message) {
      if (!nlToast) return;
      nlToast.textContent = message;
      nlToast.classList.add("is-on");
      clearTimeout(nlToastTimer);
      nlToastTimer = setTimeout(function () { nlToast.classList.remove("is-on"); }, 2200);
    }

    // ---- search ----
    function nlRenderResults() {
      if (!nlResults) return;
      var q = (nlQuery ? nlQuery.value : "").trim().toLowerCase();
      var matches = q
        ? NL_FOODS.filter(function (f) { return f.name.toLowerCase().indexOf(q) !== -1; })
        : NL_FOODS;
      if (!matches.length) {
        nlResults.innerHTML = '<p class="nl-none">No match here — the app itself searches the whole library.</p>';
        return;
      }
      nlResults.innerHTML = matches.map(function (f) {
        return '<button type="button" tabindex="-1" class="nl-result" data-nl="pick" data-food="' + nlEsc(f.name) + '">' +
          '<span class="nl-result-id"><b>' + nlEsc(f.name) + '</b>' +
          '<span class="sub">' + Math.round(f.calories) + ' kcal · ' + Math.round(f.protein) + 'P / ' +
          Math.round(f.fat) + 'F / ' + Math.round(f.carbs) + 'C <em>per 100 g</em></span></span>' +
          '<span class="nl-plus">+</span></button>';
      }).join("");
    }

    // ---- sheets ----
    // NOTHING IN HERE MOVES FOCUS. This used to call el.focus() so the
    // keyboard followed the open sheet, which read fine on paper and was
    // wrong in practice: the walkthrough below opens and closes those same
    // sheets by itself, on a nine-second loop, so a reader merely scrolling
    // past the handset watched document.activeElement travel from BODY to
    // the "+ Log a food" button to the search field with nothing in their
    // hands touching it. Two separate faults, and the second is the one that
    // bites hardest:
    //   * focus lands somewhere the reader did not put it and cannot
    //     predict, which is the whole thing focus is for; and
    //   * a focused text input changes what Page Down, Page Up, Home and End
    //     do. On the canvas host they are ours -- the keydown handler at the
    //     top of this file forwards them to the body scroller, and it stands
    //     down the moment anything is focused -- so the loop was quietly
    //     taking the page keys away mid-scroll.
    // The controls are all tabindex="-1" now (see index.html), so the
    // "focused" field is a look, not a state: one class, on at most one
    // element, cleared by the same call that sets the next one.
    function nlFakeFocus(el) {
      $$(".is-faux-focus", nlScreen).forEach(function (n) {
        n.classList.remove("is-faux-focus");
      });
      // No "a real caret wins" guard here, deliberately, though two
      // blue-bordered fields with only one really focused would be exactly
      // the lie this class exists to avoid. Two things already prevent it:
      // focusin stands the walkthrough down, and nlReleaseHiddenFocus blurs
      // real focus out of whichever sheet is being hidden -- which is the
      // same moment the other field would get the look. A guard on
      // "activeElement is inside nlScreen" is not only unreachable, it
      // MISFIRES: clicking "+ Log a food" focuses that button in Chrome, the
      // click handler opens the sheet before the blur listener on
      // .phone-stage sees the event, and the search field would open with no
      // caret at all. (jsdom's .click() does not focus, so no test here
      // could have caught that -- the mutation check did.)
      if (el) el.classList.add("is-faux-focus");
    }

    // Both sheets are visibility:hidden while closed, so real focus left
    // inside one that is on its way out is focus on nothing. tabindex="-1"
    // does not prevent this -- it keeps these controls out of the TAB order,
    // while a mouse click still focuses what it hits. Called by nlOpen as
    // well as nlClose: opening the amount sheet hides the search sheet, and
    // the "back to search" x hides the amount sheet out from under the very
    // button the click just focused.
    //
    // Reads activeElement BEFORE the class comes off, and never fires for
    // the walkthrough, which focuses nothing.
    function nlReleaseHiddenFocus(keep) {
      var at = document.activeElement;
      if (!at || !at.blur) return;
      var inDoomedSheet = Object.keys(nlSheets).some(function (key) {
        return key !== keep && nlSheets[key] && nlSheets[key].contains(at);
      });
      if (inDoomedSheet) at.blur();
    }

    function nlOpen(which) {
      nl.sheet = which;
      nlReleaseHiddenFocus(which);
      Object.keys(nlSheets).forEach(function (key) {
        if (nlSheets[key]) nlSheets[key].classList.toggle("is-open", key === which);
      });
      if (which === "search" && nlQuery) {
        // Each visit starts clean. Carrying the last query over meant the
        // second food you logged opened onto one stale result -- the search
        // for the food you just added.
        nlQuery.value = "";
        nlRenderResults();
        nlFakeFocus(nlQuery);
      }
      // The caret follows the sheet, because that is what the app looks like
      // at this step -- a look, drawn by a class, not real focus.
      if (which === "amount") nlFakeFocus(nlAmountInput);
    }
    function nlClose() {
      nl.sheet = null;
      nlReleaseHiddenFocus(null);
      Object.keys(nlSheets).forEach(function (key) {
        if (nlSheets[key]) nlSheets[key].classList.remove("is-open");
      });
      nlFakeFocus(null);
    }

    // FOCUS ARRIVING IN HERE IS A VISITOR, AND THE SCREEN IS THEIRS.
    // The click handler below only stands the walkthrough down for a click
    // that resolves to a [data-nl] element, and neither text field has one --
    // so clicking into the search or the amount and typing left the loop
    // running. Nine seconds later it closed the sheet under them: it took the
    // caret out of the field mid-keystroke, logged whatever amount they had
    // typed as if they had pressed Add, and wiped it again on the next cycle.
    // The amount field made it worse by having no `input` stand-down of its
    // own, unlike the query field.
    //
    // focusin rather than click because it is the general statement -- the
    // loop focuses nothing any more, so focus landing in this screen at all
    // means a person put it there. It also closes Escape (reachable only with
    // focus in here) and stops the walkthrough painting a second caret beside
    // a real one.
    nlScreen.addEventListener("focusin", function () {
      nlDemoOff = true;
      nlDemoStop();
    });

    nlScreen.addEventListener("click", function (evt) {
      var el = evt.target.closest ? evt.target.closest("[data-nl]") : null;
      if (!el) return;
      // A real click -- the walkthrough calls these functions directly and
      // never dispatches one, so reaching here means a visitor did it. The
      // screen is theirs from now on.
      nlDemoOff = true;
      nlDemoStop();
      var action = el.getAttribute("data-nl");
      if (action === "open-search") { nlOpen("search"); return; }
      if (action === "close") { nlClose(); return; }
      if (action === "back") { nlOpen("search"); return; }
      if (action === "pick") {
        var name = el.getAttribute("data-food");
        var food = NL_FOODS.filter(function (f) { return f.name === name; })[0];
        if (food) nlPick(food);
        return;
      }
      if (action === "unit") {
        // Convert the current amount into the newly-picked unit, so switching
        // units doesn't silently change how much is being logged.
        var grams = nlGrams();
        nl.unit = el.getAttribute("data-unit");
        nl.amount = Math.round((grams / nlGramsPerUnit(nl.unit)) * 100) / 100;
        if (nlAmountInput) nlAmountInput.value = String(nl.amount);
        nlRenderAmount();
        return;
      }
      if (action === "add") { nlAdd(); return; }
      if (action === "remove") {
        nl.log.splice(parseInt(el.getAttribute("data-i"), 10), 1);
        nlRenderDay();
      }
    });

    if (nlQuery) {
      nlQuery.addEventListener("input", function () {
        // Same rule as the click handler: the walkthrough writes .value and
        // calls nlRenderResults() itself, so an input event is a person.
        nlDemoOff = true;
        nlDemoStop();
        nlRenderResults();
      });
      nlQuery.addEventListener("keydown", function (evt) {
        if (evt.key !== "Enter") return;
        // Enter takes the top match, the way the app's search does.
        evt.preventDefault();
        var first = $(".nl-result", nlResults);
        if (first) first.click();
      });
    }
    if (nlAmountInput) {
      nlAmountInput.addEventListener("input", function () {
        var parsed = parseFloat(nlAmountInput.value);
        nl.amount = isFinite(parsed) && parsed >= 0 ? parsed : 0;
        // Snap the field itself when it implies more than NL_MAX_GRAMS --
        // otherwise the box would keep showing the huge typed number while
        // every macro below it is quietly computed off the capped grams.
        if (nl.amount * nlGramsPerUnit(nl.unit) > NL_MAX_GRAMS) {
          nl.amount = Math.round((NL_MAX_GRAMS / nlGramsPerUnit(nl.unit)) * 100) / 100;
          nlAmountInput.value = String(nl.amount);
        }
        nlRenderAmount();
      });
    }
    nlScreen.addEventListener("keydown", function (evt) {
      if (evt.key === "Escape" && nl.sheet) { nlClose(); }
    });

    // ---- the screen logs a food by itself ----
    // This screen really works -- search the library, pick, set an amount,
    // add -- which is the whole point of it, and was also the whole problem:
    // a working control nobody touches is an empty form. It opened on a day
    // with nothing in it and stayed there, so the one feature whose screen
    // could SHOW what the app does was the one showing least.
    //
    // So it does the four steps on a loop, through the same functions the
    // buttons call: tap "+ Log a food", type into the search, pick the top
    // result, confirm the amount. Nothing is faked -- the macros, the ring
    // and the day's total are computed from the real per-100g figures the
    // rest of this block uses, because it IS the rest of this block doing
    // the work.
    //
    // Pad Thai rather than a raw ingredient: a dish carries a real recipe
    // serving (360g), so the amount step has something to say -- "1 serving
    // = 360 g" -- where 100g of chicken would just read 1.
    var NL_DEMO_FOOD = "Pad Thai";
    var NL_DEMO_QUERY = "pad";
    var nlDemoTimers = [];
    // The moment a visitor touches this screen it is theirs. Their search,
    // their amount, their day's log -- a demo that carried on typing over
    // the top of it would be taking the page back off them, so the first
    // real click or keystroke ends the loop for good.
    var nlDemoOff = false;

    function nlDemoClear() {
      nlDemoTimers.forEach(clearTimeout);
      nlDemoTimers = [];
    }
    function nlDemoAt(ms, fn) { nlDemoTimers.push(setTimeout(fn, ms)); }
    function nlDemoFood() {
      return NL_FOODS.filter(function (f) { return f.name === NL_DEMO_FOOD; })[0];
    }
    function nlDemoStop() { nlDemoClear(); }

    function nlDemoPlay() {
      if (nlDemoOff || !nlDemoFood()) return;
      nlDemoClear();
      // Reduced motion gets the end state, held: the food logged, the ring
      // round, the day's total on it. No typing, no loop.
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        if (!nl.log.length) { nlPick(nlDemoFood()); nlAdd(); }
        return;
      }

      // An empty day to start from, so the ring filling is something the
      // reader watches happen rather than something already true.
      nl.log = [];
      nlClose();
      nlRenderDay();

      nlDemoAt(700, function () { nlOpen("search"); });
      // Typed a letter at a time, because the results narrowing under the
      // query is half of what "search the library" means.
      for (var c = 1; c <= NL_DEMO_QUERY.length; c++) {
        (function (n) {
          nlDemoAt(1150 + n * 170, function () {
            if (!nlQuery) return;
            nlQuery.value = NL_DEMO_QUERY.slice(0, n);
            // Called, not dispatched: an input event here would look like a
            // visitor typing and switch the loop off on its own first letter.
            nlRenderResults();
          });
        })(c);
      }
      nlDemoAt(2200, function () { nlPick(nlDemoFood()); });
      nlDemoAt(3500, function () { nlAdd(); });
      // Long enough on the finished day to read the ring, the macro bars and
      // the entry that arrived in the list.
      nlDemoAt(9200, nlDemoPlay);
    }

    // An open sheet is an interaction in flight -- a half-typed search, an
    // amount being set. Hold the screen against a cursor merely drifting
    // over the feature list on its way to the handset.
    //
    // nlDemoOff is half the condition, and has to be: the loop opens sheets
    // too, and a hold that counted those would pin the handset for the two
    // seconds of every nine that the demo has one open. The hold protects a
    // VISITOR'S interaction, and there is only a visitor's interaction once
    // the loop has stood down.
    onHold(function (current) {
      return nlDemoOff && current === screens.indexOf(nlScreen) && !!nl.sheet;
    });
    // A click is deliberate, so it switches anyway -- and takes the sheet
    // down with it, so the hold can never outlive the interaction that
    // earned it. The day's log stays: that part is the visitor's own work.
    onFeature(function (i) {
      if (i !== screens.indexOf(nlScreen)) { nlClose(); nlDemoStop(); return; }
      // Arriving: start the walkthrough from the top, so a reader always
      // sees it from the empty day rather than joining it half way.
      nlDemoPlay();
    });

    nlRenderResults();
    nlRenderDay();
    // Not started here. showFeature(0) has already run by this point and the
    // food log is feature 02, so the loop is started by the listener above
    // when the reader actually reaches it.
  }

  // ---------- waitlist ----------
  // RepCheck's own API, not a form relay. This was a Formspree placeholder
  // ("YOUR_FORM_ID") that had never been filled in, so every signup posted to
  // a URL that does not exist and failed silently into the catch below: the
  // visitor saw "something went wrong", and nobody's address was ever stored
  // anywhere.
  //
  // Posting here instead of to a relay means the address reaches us directly
  // and no third company is involved, which is what marketing/privacy.html
  // now says. The app is a paid Render service, so there is no cold start to
  // stall the first submission of the day.
  //
  // Cross-origin on purpose: this page is a separate static deploy. The two
  // marketing hostnames are allowlisted by name in app.py (WAITLIST_ORIGINS)
  // and the Render CSP for this site allows exactly this origin in
  // connect-src -- change one and the other has to change with it.
  var ENDPOINT = "https://repcheck-q0m4.onrender.com/api/waitlist";

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
