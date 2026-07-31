/*
 * First-run guided tour -- MyFitnessPal-style: one feature spotlighted at a
 * time (a dim over everything else, a bright cutout + ring around the one
 * control being described, a small card sitting right next to it with a
 * bold title and a one-line description). No "Next" button on feature
 * steps -- the highlighted control itself IS the call to action:
 *
 *   - The dim/card is purely visual (pointer-events: none), so every click
 *     always reaches whatever's really underneath it -- the highlighted
 *     button still opens/works normally, a nav link still navigates.
 *   - The FIRST click anywhere collapses the full card down to a small,
 *     low-key pill (see .tour-mini) so the tour is never in the way of
 *     actually using the app, while still quietly showing it's still
 *     going -- and advances the stored step, so this page's step is done.
 *   - The tour has no page of its own to render the next step until the
 *     user actually navigates there (a nav tap, or tapping the low-key
 *     pill itself) -- at which point that next page picks the tour back
 *     up automatically. Nothing here ever forces a redirect.
 *
 * Trigger: onboarding.js sets repcheck_pending_tour = "1" (and
 * repcheck_tour_step = "0"). Lives on every page (loaded from base.html)
 * and keeps its place in localStorage across the full page loads a
 * multi-page tour requires. Skippable at any point; Settings can replay it.
 */
(function () {
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

  // Each step: the page it lives on and the control to highlight there
  // (first visible selector wins; null = a centred welcome card with its
  // own "Get started" button, since there's no one control to point at).
  var STEPS = [
    { key: "welcome", path: "/", targets: null },
    { key: "workouts", path: "/workouts", targets: ["#wl-log-btn"] },
    { key: "nutrition", path: "/nutrition", targets: ["#nl-log-btn"] },
    { key: "analyze", path: "/analyze", targets: ["#file-drop"] }
  ];

  ready(function () {
    var t = (window.RepCheckI18n && RepCheckI18n.t)
      ? function (k, vars) { return RepCheckI18n.t(k, vars); }
      : function (k) { return k; };

    var idx = parseInt(localStorage.getItem(STEP_KEY) || "0", 10);
    if (isNaN(idx) || idx < 0) idx = 0;
    if (idx >= STEPS.length) { finishStorage(); return; }

    function finishStorage() {
      localStorage.removeItem(ACTIVE_KEY);
      localStorage.removeItem(STEP_KEY);
    }

    var overlay, spotlight, card, stepCountEl, titleEl, bodyEl, welcomeBtn;
    var miniEl = null;
    var currentTarget = null;
    var pollTimer = null;
    var fullyEnded = false;

    function isVisible(el) {
      if (!el) return false;
      var cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }

    function findTarget(step) {
      if (!step.targets) return null;
      for (var i = 0; i < step.targets.length; i++) {
        var el = document.querySelector(step.targets[i]);
        if (isVisible(el)) return el;
      }
      return null;
    }

    // ---------- Full step overlay (spotlight + card) ----------
    function buildOverlay() {
      overlay = document.createElement("div");
      overlay.className = "tour-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.innerHTML =
        '<div class="tour-spotlight"></div>' +
        '<div class="tour-card">' +
          '<div class="tour-top">' +
            '<span class="tour-step-count"></span>' +
            '<button type="button" class="tour-skip"></button>' +
          '</div>' +
          '<div class="tour-title"></div>' +
          '<div class="tour-body"></div>' +
          '<div class="tour-welcome-foot" style="display:none;">' +
            '<button type="button" class="tour-next"></button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);

      spotlight = overlay.querySelector(".tour-spotlight");
      card = overlay.querySelector(".tour-card");
      stepCountEl = overlay.querySelector(".tour-step-count");
      titleEl = overlay.querySelector(".tour-title");
      bodyEl = overlay.querySelector(".tour-body");
      welcomeBtn = overlay.querySelector(".tour-next");

      overlay.querySelector(".tour-skip").addEventListener("click", endTourCompletely);
      // The welcome step's own button needs no listener of its own -- like
      // every other click while a step is showing, the document-level
      // onAnyClick below already advances it (see the .tour-skip/
      // .tour-mini-skip exclusion there for why Skip doesn't also do that).

      window.addEventListener("resize", reposition);
      window.addEventListener("scroll", reposition, true);
      // Capturing (not bubbling) so this always sees the click first, and
      // never calls preventDefault/stopPropagation -- whatever the click
      // actually landed on (the highlighted button, a nav link, anything)
      // still runs completely normally.
      document.addEventListener("click", onAnyClick, true);
    }

    function onAnyClick(e) {
      // Only meaningful while the full step overlay is actually showing --
      // once collapsed to the low-key pill there's nothing left to
      // acknowledge on this page, so further clicks must do nothing here
      // (the pill has its own separate click handling for that state).
      if (fullyEnded || !overlay || !overlay.classList.contains("is-visible")) return;
      // Skip already runs its own (different) action -- let it, instead
      // of also collapsing to the low-key pill for a click that's ending
      // the tour entirely.
      if (e.target.closest(".tour-skip")) return;
      acknowledgeAndCollapse();
    }

    function placeCard(target) {
      if (!target) {
        // No-target (welcome) step: a calm, centred card.
        card.classList.add("is-centered");
        card.style.top = "";
        card.style.bottom = "";
        card.style.left = "";
        return;
      }
      card.classList.remove("is-centered");
      var r = target.getBoundingClientRect();
      var cardH = card.offsetHeight;
      var vh = window.innerHeight;
      var margin = 14;
      // Sit right next to the highlighted control -- below it if there's
      // room, above it otherwise -- rather than pinned to a screen edge,
      // so the card always reads as "about that thing right there".
      if (r.bottom + margin + cardH <= vh - 12) {
        card.style.top = (r.bottom + margin) + "px";
        card.style.bottom = "auto";
      } else {
        card.style.bottom = (vh - r.top + margin) + "px";
        card.style.top = "auto";
      }
      var left = r.left + r.width / 2 - card.offsetWidth / 2;
      left = Math.max(12, Math.min(left, window.innerWidth - card.offsetWidth - 12));
      card.style.left = left + "px";
    }

    function reposition() {
      if (currentTarget) {
        var r = currentTarget.getBoundingClientRect();
        var pad = 6;
        spotlight.classList.add("has-target");
        spotlight.style.top = (r.top - pad) + "px";
        spotlight.style.left = (r.left - pad) + "px";
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
    // low-key pill instead of leaving a broken zero-size spotlight up.
    function settle(step) {
      clearPoll();
      var tries = 0;
      pollTimer = setInterval(function () {
        tries++;
        var tgt = findTarget(step);
        if (tgt && tgt !== currentTarget) {
          currentTarget = tgt;
          scrollTargetIntoView();
          reposition();
        }
        if (tries > 24) {
          clearPoll();
          if (!currentTarget) showMini(idx);
        }
      }, 100);
    }

    function renderFull(i) {
      idx = i;
      var step = STEPS[i];
      hideMini();

      if (!overlay) buildOverlay();
      overlay.style.display = "";
      var isWelcome = !step.targets;
      overlay.querySelector(".tour-welcome-foot").style.display = isWelcome ? "" : "none";

      stepCountEl.textContent = t("tour.stepCount", { n: i + 1, total: STEPS.length });
      titleEl.textContent = t("tour." + step.key + ".title");
      bodyEl.textContent = t("tour." + step.key + ".body");
      overlay.querySelector(".tour-skip").textContent = t("tour.skip");
      if (isWelcome) welcomeBtn.textContent = t("tour.next");

      currentTarget = findTarget(step);
      scrollTargetIntoView();
      reposition();
      if (step.targets) settle(step); else clearPoll();

      void overlay.offsetWidth;
      overlay.classList.add("is-visible");
    }

    function hideFull() {
      if (!overlay) return;
      clearPoll();
      overlay.classList.remove("is-visible");
      overlay.style.display = "none";
    }

    // ---------- Low-key "still going" indicator ----------
    // Shown instead of the full overlay whenever the current step's own
    // page doesn't match where the user actually is right now (including
    // right after they've just acknowledged this page's step) -- a small
    // pill, out of the way, tap to jump straight to wherever the tour
    // wants to show next.
    function showMini(i) {
      hideFull();
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
          if (STEPS[idx] && STEPS[idx].path !== pathOf()) window.location.href = STEPS[idx].path;
        });
      }
      miniEl.querySelector(".tour-mini-text").textContent = t("tour.mini", { title: t("tour." + step.key + ".title") });
      miniEl.style.display = "";
      requestAnimationFrame(function () { miniEl.classList.add("is-visible"); });
    }

    function hideMini() {
      if (miniEl) { miniEl.classList.remove("is-visible"); miniEl.style.display = "none"; }
    }

    // ---------- Step transitions ----------
    // The click that satisfies a step (or the welcome card's own button)
    // -- advance the stored step immediately and drop to the low-key
    // pill for the rest of THIS page view. The next full step only
    // appears once the user actually lands on its page.
    function acknowledgeAndCollapse() {
      var next = idx + 1;
      if (next >= STEPS.length) { endTourCompletely(); return; }
      localStorage.setItem(STEP_KEY, String(next));
      idx = next;
      showMini(idx);
    }

    function endTourCompletely() {
      fullyEnded = true;
      finishStorage();
      clearPoll();
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
    if (pathOf() === STEPS[idx].path) {
      renderFull(idx);
    } else {
      showMini(idx);
    }
  });
})();
