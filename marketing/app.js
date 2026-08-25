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

  // ---------- add-an-exercise walkthrough ----------
  // The step buttons ship disabled in the markup and are enabled here, so a
  // no-JS visitor gets four readable steps and the first screen instead of
  // four controls that do nothing.
  var axRoot = $("#ax");
  if (axRoot) {
    var axSteps = $$(".ax-step", axRoot);
    var axScreens = $$(".ax-screen", axRoot);
    // Must match --ax-dwell in styles.css, or the progress bar under the
    // active step finishes out of step with the actual advance.
    var AX_DWELL = 4200;
    var axIndex = 0;
    var axTimer = null;
    var axManual = false;

    var axShow = function (index) {
      axIndex = (index + axSteps.length) % axSteps.length;
      axSteps.forEach(function (step, i) {
        var on = i === axIndex;
        step.classList.toggle("is-active", on);
        step.setAttribute("aria-pressed", on ? "true" : "false");
      });
      axScreens.forEach(function (screen, i) {
        screen.classList.toggle("is-active", i === axIndex);
      });
    };

    var axStop = function () {
      if (axTimer) { clearInterval(axTimer); axTimer = null; }
    };
    var axStart = function () {
      if (axTimer || axManual) return;
      axRoot.classList.remove("is-paused");
      axTimer = setInterval(function () { axShow(axIndex + 1); }, AX_DWELL);
    };
    var axPause = function () {
      axStop();
      if (!axManual) axRoot.classList.add("is-paused");
    };

    axSteps.forEach(function (step, i) {
      step.disabled = false;
      step.addEventListener("click", function () {
        // Once someone drives it themselves, stop moving under them.
        axManual = true;
        axStop();
        axRoot.classList.add("is-manual");
        axRoot.classList.remove("is-paused");
        axShow(i);
      });
      step.addEventListener("keydown", function (evt) {
        var delta = 0;
        if (evt.key === "ArrowDown" || evt.key === "ArrowRight") delta = 1;
        else if (evt.key === "ArrowUp" || evt.key === "ArrowLeft") delta = -1;
        else return;
        evt.preventDefault();
        var next = (i + delta + axSteps.length) % axSteps.length;
        axSteps[next].focus();
        axSteps[next].click();
      });
    });

    var axMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    var axApplyMotion = function () {
      if (axMotion && axMotion.matches) {
        // Reduced motion: no self-advancing carousel. The steps stay
        // clickable, so the whole walkthrough is still reachable.
        axStop();
        axManual = true;
        axRoot.classList.add("is-manual");
        axRoot.classList.remove("is-paused");
      } else if (!axRoot.classList.contains("is-manual")) {
        axManual = false;
        axStart();
      }
    };

    if (window.IntersectionObserver) {
      // Only cycle while the section is actually on screen -- otherwise a
      // visitor arrives at step 3 of 4 with no idea what came before it.
      new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && !(axMotion && axMotion.matches)) axStart();
          else axPause();
        });
      }, { threshold: 0.4 }).observe(axRoot);
    }

    axApplyMotion();
    if (axMotion) {
      if (axMotion.addEventListener) axMotion.addEventListener("change", axApplyMotion);
      else if (axMotion.addListener) axMotion.addListener(axApplyMotion);
    }
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

  $$(".waitlist-form").forEach(wireForm);
})();
