/*
 * First-run guided tour -- MyFitnessPal-style: one thing spotlighted at a
 * time (a dim over everything else, a bright cutout + ring around the one
 * control being described, a small card next to it with a bold title and
 * a one-line description).
 *
 * Each feature is taught in TWO phases, because a first-time user has to
 * solve two separate problems -- "which icon even gets me there?" and
 * "what do I press once I'm there?":
 *
 *   1. NAV phase   -- spotlights the nav icon that opens that section
 *                     (sidebar on desktop, bottom tab bar on mobile), so
 *                     the user actually learns which glyph is Nutrition.
 *                     Tapping it navigates; the step does not advance,
 *                     because landing on the page IS the progress.
 *   2. ACTION phase -- once on that page, spotlights the control to press.
 *                     Pressing it advances to the next feature.
 *
 * While either phase is showing the tour is MODAL: a capture-phase click
 * handler swallows every click that isn't the spotlighted target (or
 * Skip), so the user can't wander off mid-tour and lose the thread. A
 * blocked click shakes the card and shows a short hint rather than doing
 * nothing, so the UI never feels broken. Skip is always live, and the
 * whole tour is skippable in one tap.
 *
 * Blocking is deliberately conditional (see shouldBlock): if the target
 * can't be found, nothing is ever blocked -- a tour that can't point at
 * anything must never be able to brick the page.
 *
 * After an ACTION is pressed the tour collapses to a small pill
 * (.tour-mini) so the user can actually play with the thing they just
 * opened; tapping the pill resumes at the next feature's NAV phase, so
 * the icon lesson still happens rather than being skipped by a jump.
 *
 * Trigger: onboarding.js sets repcheck_pending_tour = "1" (and
 * repcheck_tour_step = "0"). Lives on every page (loaded from base.html)
 * and keeps its place in localStorage across the full page loads a
 * multi-page tour requires. Settings can replay it.
 */
(function () {
  // Guards against this script's whole body ever running more than once
  // for the same document -- some environments (prerendering, a stray
  // duplicate <script> tag, etc.) can end up evaluating a deferred script
  // twice, which without this would attach two independent click
  // listeners and double- (or triple-) advance the step on a single tap.
  if (window.__repcheckTourInit) return;
  window.__repcheckTourInit = true;

  var ACTIVE_KEY = "repcheck_pending_tour";
  var STEP_KEY = "repcheck_tour_step";
  if (localStorage.getItem(ACTIVE_KEY) !== "1") return;

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  function pathOf() {
    var p = location.pathname.replace(/\/+$/, "");
    return p === "" ? "/" : p;
  }

  // Each step: the page it lives on, the nav control that opens that page,
  // and the control to highlight once there. `nav` lists the mobile tab
  // bar entry first and the desktop sidebar link second -- findTarget
  // takes the first *visible* one, which is what makes the same list work
  // on both layouts without a media query here. `targets: null` marks the
  // one welcome step, which has no single control to point at and so gets
  // a centred card with its own button.
  var STEPS = [
    { key: "welcome", path: "/", nav: null, targets: null },
    {
      key: "workouts",
      path: "/workouts",
      nav: [".mt-item[href='/workouts']", ".nav a[href='/workouts']"],
      targets: ["#wl-log-btn"]
    },
    {
      key: "nutrition",
      path: "/nutrition",
      nav: [".mt-item[href='/nutrition']", ".nav a[href='/nutrition']"],
      targets: ["#nl-log-btn"]
    },
    {
      key: "analyze",
      path: "/analyze",
      nav: [".mt-item[href='/analyze']", ".nav a[href='/analyze']"],
      targets: ["#file-drop"]
    }
  ];

  ready(function () {
    var t = (window.RepCheckI18n && RepCheckI18n.t)
      ? function (k, vars) { return RepCheckI18n.t(k, vars); }
      : function (k) { return k; };

    var idx = parseInt(localStorage.getItem(STEP_KEY) || "0", 10);
    if (isNaN(idx) || idx < 0) idx = 0;

    function finishStorage() {
      localStorage.removeItem(ACTIVE_KEY);
      localStorage.removeItem(STEP_KEY);
    }

    if (idx >= STEPS.length) { finishStorage(); return; }

    // "nav" = teaching which icon opens the section; "action" = teaching
    // the control on that page; "mini" = the tour has nothing it can point
    // at, so it blocks nothing (safety fallback only, never the happy path).
    var PHASE_NAV = "nav", PHASE_ACTION = "action", PHASE_MINI = "mini";
    var phase = PHASE_MINI;

    // Set while a NAV step is being shown right after the user completed an
    // ACTION on this same page. That click usually opened something (a log
    // sheet, a picker), and dimming it out the instant it appears would show
    // the user a feature and then forbid touching it. So a "soft" NAV step
    // drops the dim and lets ordinary clicks through -- but still blocks
    // anything that would navigate AWAY, because the previous behaviour here
    // (a passive pill that blocked nothing) meant doing exactly what the tour
    // asked silently switched the guidance off, and the user could wander off
    // mid-tour. Soft means "use what you just opened"; it never means "the
    // tour has let go".
    var softNav = false;

    var overlay, spotlight, arrowEl, card, stepCountEl, titleEl, bodyEl, hintEl, welcomeBtn;
    var miniEl = null;
    var currentTarget = null;
    var pollTimer = null;
    var hintTimer = null;
    var fullyEnded = false;

    function isVisible(el) {
      if (!el) return false;
      var cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }

    // First *visible* selector wins, so one list can cover the mobile tab
    // bar and the desktop sidebar (only one of the two is ever laid out).
    function selectorsFor(step, ph) {
      if (ph === PHASE_NAV) return step.nav;
      return step.targets;
    }

    function findTarget(step, ph) {
      var sels = selectorsFor(step, ph);
      if (!sels) return null;
      for (var i = 0; i < sels.length; i++) {
        var el = document.querySelector(sels[i]);
        if (isVisible(el)) return el;
      }
      return null;
    }

    // ---------- Modality ----------
    // Only ever block while a phase is actually showing AND we have
    // something concrete to point at. If the target never resolved, the
    // page must stay fully usable -- a tour that can't point at anything
    // is not allowed to trap the user behind a dead overlay.
    // A target that's been torn out of the DOM (or hidden) by the page
    // re-rendering underneath us must stop counting as something to point
    // at -- otherwise the stale node keeps modality switched on while the
    // spotlight sits on coordinates that no longer mean anything, and the
    // only way out is Skip.
    function targetIsLive() {
      return !!currentTarget && currentTarget.isConnected && isVisible(currentTarget);
    }

    function shouldBlock() {
      if (fullyEnded) return false;
      if (phase === PHASE_MINI) return false;
      if (!overlay || !overlay.classList.contains("is-visible")) return false;
      if (isWelcomeStep()) return true;
      return targetIsLive();
    }

    // Would this click leave the page the tour is currently standing on?
    // Covers real links whose path differs from ours, plus everything inside
    // the two nav surfaces and the quick-actions sheet (some of those are
    // buttons that navigate via JS, so an <a href> test alone would miss
    // them). Used to keep a soft NAV step from becoming an escape hatch.
    function isNavigationEscape(target) {
      if (!target || !target.closest) return false;
      if (target.closest(".mobile-tabbar, .sidebar .nav, .mt-sheet, .qa-sheet")) return true;
      var a = target.closest("a[href]");
      if (!a) return false;
      var href = a.getAttribute("href") || "";
      if (!href || href.charAt(0) === "#") return false;
      try {
        return new URL(a.href, location.href).pathname !== location.pathname;
      } catch (err) {
        return false;
      }
    }

    function isWelcomeStep() {
      return !STEPS[idx].targets && phase !== PHASE_NAV;
    }

    function onAnyClick(e) {
      // The target went away while this step was up: recover to the
      // non-modal pill rather than leaving a dim overlay pinned to a
      // control that no longer exists, and let this click through.
      if (!fullyEnded && phase !== PHASE_MINI && !isWelcomeStep() && currentTarget && !targetIsLive()) {
        showMini(idx);
        return;
      }
      if (!shouldBlock()) return;

      // Skip runs its own action and must always win -- it's the single
      // guaranteed way out of a modal tour.
      if (e.target.closest(".tour-skip")) return;

      // The welcome card's own button is the target for that step.
      if (isWelcomeStep()) {
        if (e.target.closest(".tour-next")) { advanceStep(false); return; }
        nudge();
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // The one sanctioned click: the spotlighted control itself. Let it
      // through completely untouched (no preventDefault) so the nav link
      // still navigates and the button still opens its sheet.
      if (currentTarget && (e.target === currentTarget || currentTarget.contains(e.target))) {
        // NAV phase: navigating to the page is itself the progress, so
        // the step index stays put -- the ACTION phase picks it up on the
        // next page load. ACTION phase: this is the step completed.
        if (phase === PHASE_ACTION) advanceStep(true);
        return;
      }

      // Soft NAV step: the user is meant to be able to use (and close) the
      // thing they just opened, so ordinary clicks pass. Only an attempt to
      // leave the page is refused -- that's the wandering-off this phase
      // exists to prevent.
      if (softNav && !isNavigationEscape(e.target)) return;

      // Everything else: swallowed, with visible feedback so a blocked
      // tap reads as "not that one" rather than as a broken page.
      nudge();
      e.preventDefault();
      e.stopPropagation();
    }

    // Middle-click and right-click-to-open fire auxclick, not click, so a
    // click-only guard let the user open any nav link in a new tab and walk
    // straight out of the tour. Same gate, same sanctioned exception.
    function onAnyAuxClick(e) {
      if (!shouldBlock()) return;
      if (e.target.closest(".tour-skip")) return;
      if (currentTarget && (e.target === currentTarget || currentTarget.contains(e.target))) return;
      if (softNav && !isNavigationEscape(e.target)) return;
      nudge();
      e.preventDefault();
      e.stopPropagation();
    }

    // A blocked click shakes the card and swaps in a one-line hint.
    function nudge() {
      if (!card) return;
      card.classList.remove("is-nudging");
      void card.offsetWidth;
      card.classList.add("is-nudging");
      if (spotlight) {
        spotlight.classList.remove("is-nudging");
        void spotlight.offsetWidth;
        spotlight.classList.add("is-nudging");
      }
      if (hintEl) {
        hintEl.textContent = t("tour.blocked");
        hintEl.classList.add("is-visible");
        if (hintTimer) clearTimeout(hintTimer);
        hintTimer = setTimeout(function () {
          if (hintEl) hintEl.classList.remove("is-visible");
        }, 2600);
      }
    }

    // ---------- Full step overlay (spotlight + card) ----------
    function buildOverlay() {
      overlay = document.createElement("div");
      overlay.className = "tour-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.innerHTML =
        '<div class="tour-spotlight"></div>' +
        '<div class="tour-arrow"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16M5 13l7 7 7-7"/></svg></div>' +
        '<div class="tour-card">' +
          '<div class="tour-top">' +
            '<span class="tour-step-count"></span>' +
            '<button type="button" class="tour-skip"></button>' +
          '</div>' +
          '<div class="tour-title"></div>' +
          '<div class="tour-body"></div>' +
          '<div class="tour-hint"></div>' +
          '<div class="tour-welcome-foot" style="display:none;">' +
            '<button type="button" class="tour-next"></button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);

      spotlight = overlay.querySelector(".tour-spotlight");
      arrowEl = overlay.querySelector(".tour-arrow");
      card = overlay.querySelector(".tour-card");
      stepCountEl = overlay.querySelector(".tour-step-count");
      titleEl = overlay.querySelector(".tour-title");
      bodyEl = overlay.querySelector(".tour-body");
      hintEl = overlay.querySelector(".tour-hint");
      welcomeBtn = overlay.querySelector(".tour-next");

      overlay.querySelector(".tour-skip").addEventListener("click", endTourCompletely);

      window.addEventListener("resize", reposition);
      window.addEventListener("scroll", reposition, true);
      // Capturing, so this sees every click before the page does and can
      // decide whether to let it through (see onAnyClick).
      document.addEventListener("click", onAnyClick, true);
      document.addEventListener("auxclick", onAnyAuxClick, true);
    }

    // Targets are measured in viewport coordinates, but the spotlight,
    // card and arrow are positioned inside .tour-overlay. Those two only
    // coincide when the overlay actually starts at the viewport origin --
    // which it doesn't on desktop, where the app frames itself as a 390px
    // "device" using a transform on <body>. A transformed ancestor
    // becomes the containing block for position:fixed, so the overlay
    // (and everything in it) is anchored to that frame instead. Measuring
    // the overlay once per placement and subtracting its origin makes the
    // maths correct in both layouts, with no media query to keep in sync.
    function overlayOrigin() {
      var o = overlay.getBoundingClientRect();
      return { left: o.left, top: o.top, width: o.width, height: o.height };
    }

    function placeCard(target) {
      if (!target) {
        // No-target (welcome) step: a calm, centred card, no pointing arrow.
        card.classList.add("is-centered");
        card.style.top = "";
        card.style.bottom = "";
        card.style.left = "";
        arrowEl.classList.remove("is-visible");
        return;
      }
      card.classList.remove("is-centered");
      var o = overlayOrigin();
      var r = target.getBoundingClientRect();
      // Target box expressed inside the overlay's own coordinate space.
      var tTop = r.top - o.top, tBottom = r.bottom - o.top, tLeft = r.left - o.left;
      var cardH = card.offsetHeight;
      var margin = 26; // leaves room for the arrow between card and target
      var cardBelow = tBottom + margin + cardH <= o.height - 12;
      // Sit right next to the highlighted control -- below it if there's
      // room, above it otherwise -- rather than pinned to a screen edge,
      // so the card always reads as "about that thing right there".
      if (cardBelow) {
        card.style.top = (tBottom + margin) + "px";
        card.style.bottom = "auto";
      } else {
        card.style.bottom = (o.height - tTop + margin) + "px";
        card.style.top = "auto";
      }
      var left = tLeft + r.width / 2 - card.offsetWidth / 2;
      left = Math.max(12, Math.min(left, o.width - card.offsetWidth - 12));
      card.style.left = left + "px";

      // A real arrow sitting in the gap, pointing straight at the
      // highlighted control -- explicit, not just implied by proximity,
      // so a brand-new user has no doubt what "tap here" refers to.
      arrowEl.classList.add("is-visible");
      arrowEl.classList.toggle("is-up", !cardBelow);
      var arrowCenter = Math.max(24, Math.min(tLeft + r.width / 2, o.width - 24));
      arrowEl.style.left = (arrowCenter - 13) + "px";
      if (cardBelow) {
        arrowEl.style.top = (tBottom + 2) + "px";
        arrowEl.style.bottom = "auto";
      } else {
        arrowEl.style.bottom = (o.height - tTop + 2) + "px";
        arrowEl.style.top = "auto";
      }
    }

    function reposition() {
      if (currentTarget) {
        var o = overlayOrigin();
        var r = currentTarget.getBoundingClientRect();
        var pad = 6;
        spotlight.classList.add("has-target");
        spotlight.style.top = (r.top - o.top - pad) + "px";
        spotlight.style.left = (r.left - o.left - pad) + "px";
        spotlight.style.width = (r.width + pad * 2) + "px";
        spotlight.style.height = (r.height + pad * 2) + "px";
      } else {
        spotlight.classList.remove("has-target");
        spotlight.style.top = "50%";
        spotlight.style.left = "50%";
        spotlight.style.width = "0px";
        spotlight.style.height = "0px";
      }
      placeCard(currentTarget);
    }

    function scrollTargetIntoView() {
      if (!currentTarget) return;
      try { currentTarget.scrollIntoView({ block: "center", inline: "nearest" }); } catch (e) {}
    }

    function clearPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

    // Controls on JS-rendered pages appear after load and the page keeps
    // reflowing for a moment, so re-find + re-place the highlight a few
    // times. If a required target never turns up, fall back to the
    // low-key pill instead of leaving a broken zero-size spotlight up --
    // and, critically, that also drops modality (see shouldBlock), so a
    // missing target can never leave the page unclickable.
    function settle(step, ph) {
      clearPoll();
      var tries = 0;
      pollTimer = setInterval(function () {
        tries++;
        var tgt = findTarget(step, ph);
        if (tgt && tgt !== currentTarget) {
          currentTarget = tgt;
          scrollTargetIntoView();
        }
        // Reposition every tick, not just when the element changes: these
        // pages keep reflowing after load (async content, late fonts,
        // images), which moves an already-found target out from under a
        // spotlight that would otherwise keep its first-measured box.
        if (currentTarget) reposition();
        if (tries > 24) {
          clearPoll();
          if (!currentTarget) showMini(idx);
        }
      }, 100);
    }

    // Copy differs per phase: the NAV phase is teaching the icon ("this
    // is where Nutrition lives"), the ACTION phase is teaching the button.
    function copyKeyFor(step, ph) {
      return ph === PHASE_NAV ? "tour." + step.key + ".nav" : "tour." + step.key;
    }

    function renderFull(i, ph, soft) {
      idx = i;
      phase = ph;
      softNav = !!soft && ph === PHASE_NAV;
      var step = STEPS[i];
      hideMini();

      if (!overlay) buildOverlay();
      overlay.style.display = "";
      // Soft steps keep the page readable and usable underneath (no dim),
      // because the user is meant to finish with whatever they just opened.
      overlay.classList.toggle("is-soft", softNav);
      var welcome = !step.targets && ph !== PHASE_NAV;
      overlay.querySelector(".tour-welcome-foot").style.display = welcome ? "" : "none";

      var base = copyKeyFor(step, ph);
      stepCountEl.textContent = t("tour.stepCount", { n: i + 1, total: STEPS.length });
      titleEl.textContent = t(base + ".title");
      bodyEl.textContent = t(base + ".body");
      overlay.querySelector(".tour-skip").textContent = t("tour.skip");
      hintEl.textContent = "";
      hintEl.classList.remove("is-visible");
      if (welcome) welcomeBtn.textContent = t("tour.next");

      currentTarget = findTarget(step, ph);
      scrollTargetIntoView();
      reposition();
      if (selectorsFor(step, ph)) settle(step, ph); else clearPoll();

      void overlay.offsetWidth;
      overlay.classList.add("is-visible");
    }

    function hideFull() {
      if (!overlay) return;
      clearPoll();
      overlay.classList.remove("is-visible");
      overlay.style.display = "none";
    }

    // ---------- Low-key "still going" pill ----------
    // Shown after a step's action has been taken, so the user can
    // actually use the thing they just opened without the tour sitting on
    // top of it. Tapping it resumes at the NAV phase for the current step
    // -- deliberately not a direct jump to the page, so the "which icon
    // is this?" lesson still happens.
    function showMini(i) {
      hideFull();
      phase = PHASE_MINI;
      var step = STEPS[i];
      if (!miniEl) {
        miniEl = document.createElement("div");
        miniEl.className = "tour-mini";
        miniEl.innerHTML =
          '<span class="tour-mini-dot"></span>' +
          '<span class="tour-mini-text"></span>' +
          '<button type="button" class="tour-mini-skip" aria-label="' + t("tour.skip") + '">&times;</button>';
        document.body.appendChild(miniEl);
        miniEl.addEventListener("click", function (e) {
          if (e.target.closest(".tour-mini-skip")) { e.stopPropagation(); endTourCompletely(); return; }
          resumeFromMini();
        });
      }
      miniEl.querySelector(".tour-mini-text").textContent = t("tour.mini", { title: t("tour." + step.key + ".title") });
      miniEl.style.display = "";
      requestAnimationFrame(function () { miniEl.classList.add("is-visible"); });
    }

    function hideMini() {
      if (miniEl) { miniEl.classList.remove("is-visible"); miniEl.style.display = "none"; }
    }

    function resumeFromMini() {
      renderFull(idx, phaseForHere(STEPS[idx]));
    }

    // ---------- Step transitions ----------
    // `soft` distinguishes the two ways a step ends. Pressing a real ACTION
    // control opens something (a sheet, a file picker), so the next step
    // renders without the dim and lets the user finish with it. The welcome
    // card's own button opens nothing, so the next step goes up at full
    // strength immediately.
    //
    // Either way the tour keeps pointing somewhere and keeps refusing to let
    // the user leave the page by any route other than the one it's showing.
    // It deliberately does NOT fall back to a passive pill here: that made
    // completing a step -- following the instructions exactly -- the one
    // reliable way to switch the guidance off.
    function advanceStep(soft) {
      var next = idx + 1;
      if (next >= STEPS.length) { endTourCompletely(); return; }
      localStorage.setItem(STEP_KEY, String(next));
      idx = next;
      renderFull(idx, phaseForHere(STEPS[idx]), soft);
    }

    function endTourCompletely() {
      fullyEnded = true;
      phase = PHASE_MINI;
      finishStorage();
      clearPoll();
      if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
      hideMini();
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      document.removeEventListener("click", onAnyClick, true);
      if (overlay) {
        overlay.classList.remove("is-visible");
        var toRemove = overlay;
        overlay = null;
        setTimeout(function () { if (toRemove && toRemove.parentNode) toRemove.parentNode.removeChild(toRemove); }, 220);
      }
    }

    // ---------- Entry point ----------
    // On the step's own page there's a control to point at, so teach the
    // action; anywhere else, teach the icon that gets you there. The
    // welcome step has no nav icon of its own, so it always renders as
    // its centred card -- otherwise landing on the tour from some other
    // page would ask for a "tour.welcome.nav.*" string that doesn't exist.
    function phaseForHere(step) {
      if (!step.nav) return PHASE_ACTION;
      return pathOf() === step.path ? PHASE_ACTION : PHASE_NAV;
    }

    renderFull(idx, phaseForHere(STEPS[idx]));
  });
})();
