/*
 * First-run guided tour of the whole app -- a walkthrough that clicks INTO
 * each page and briefly explains it. Deliberately low-key: a light dim, a
 * bright pulsing ring on the ONE control being described, and a small card
 * pinned to the bottom. The user advances by tapping the highlighted
 * control itself (no Next button on those steps).
 *
 * Trigger: onboarding.js sets repcheck_pending_tour = "1" (and
 * repcheck_tour_step = "0"). The tour spans several full page loads, so it
 * lives on every page and keeps its place in localStorage: each advance
 * saves the step and navigates to that step's page, where this script
 * resumes, scrolls the page's key control into view, and highlights it.
 * Skippable; Settings can replay it.
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

  // Each step: the page it lives on, the control to highlight there (first
  // visible wins; null = a centred info card), and a two-colour accent.
  var STEPS = [
    { key: "welcome", path: "/", targets: null, accent: ["#2f66e8", "#4d7ff5"] },
    { key: "workouts", path: "/workouts", targets: ["#wl-log-btn"], accent: ["#6366f1", "#8b5cf6"] },
    { key: "nutrition", path: "/nutrition", targets: ["#nl-log-btn"], accent: ["#16a34a", "#22c55e"] },
    { key: "analyze", path: "/analyze", targets: ["#file-drop"], accent: ["#f59e0b", "#fb923c"] },
    { key: "hyrox", path: "/hyrox", targets: ['[data-action="start-race"]', ".hx-hero-cta", ".hx-primary-btn"], accent: ["#ef4444", "#f87171"] },
    { key: "coach", path: "/coach", targets: ["#cc-input", ".cc-input-pill"], accent: ["#8b5cf6", "#a78bfa"] },
    { key: "done", path: "/", targets: null, accent: ["#16a34a", "#22c55e"] }
  ];

  var CONFETTI_COLORS = ["#2f66e8", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#0ea5e9", "#fb923c"];
  var TAP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="8.5" opacity="0.5"/></svg>';

  ready(function () {
    var t = (window.RepCheckI18n && RepCheckI18n.t)
      ? function (k) { return RepCheckI18n.t(k); }
      : function (k) { return k; };

    var idx = parseInt(localStorage.getItem(STEP_KEY) || "0", 10);
    if (isNaN(idx) || idx < 0) idx = 0;
    if (idx >= STEPS.length) { localStorage.removeItem(ACTIVE_KEY); localStorage.removeItem(STEP_KEY); return; }

    // Resume on the right page if the tour was interrupted elsewhere.
    if (pathOf() !== STEPS[idx].path) { location.replace(STEPS[idx].path); return; }

    var overlay, spotlight, hotspot, card, stepCountEl, titleEl, bodyEl, tapHint, backBtn, nextBtn, resumeBtn;
    var currentTarget = null;
    var pollTimer = null;

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

    function build() {
      overlay = document.createElement("div");
      overlay.className = "tour-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.innerHTML =
        '<div class="tour-spotlight"></div>' +
        '<div class="tour-hotspot" role="button" tabindex="0" aria-label="Try it"></div>' +
        '<div class="tour-card">' +
          '<div class="tour-top">' +
            '<span class="tour-step-count"></span>' +
            '<button type="button" class="tour-skip"></button>' +
          '</div>' +
          '<div class="tour-title"></div>' +
          '<div class="tour-body"></div>' +
          '<div class="tour-foot">' +
            '<button type="button" class="tour-back"></button>' +
            '<div class="tour-foot-spacer"></div>' +
            '<div class="tour-tap-hint">' + TAP_ICON + '<span></span></div>' +
            '<button type="button" class="tour-next"></button>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="tour-resume"></button>';
      document.body.appendChild(overlay);

      spotlight = overlay.querySelector(".tour-spotlight");
      hotspot = overlay.querySelector(".tour-hotspot");
      card = overlay.querySelector(".tour-card");
      stepCountEl = overlay.querySelector(".tour-step-count");
      titleEl = overlay.querySelector(".tour-title");
      bodyEl = overlay.querySelector(".tour-body");
      tapHint = overlay.querySelector(".tour-tap-hint");
      backBtn = overlay.querySelector(".tour-back");
      nextBtn = overlay.querySelector(".tour-next");
      resumeBtn = overlay.querySelector(".tour-resume");

      overlay.querySelector(".tour-skip").addEventListener("click", finish);
      backBtn.addEventListener("click", function () { goToStep(idx - 1); });
      nextBtn.addEventListener("click", function () { goToStep(idx + 1); });
      // Tapping the highlighted control TRIES IT for real: the tour steps
      // aside (dim + card hidden, a small "Continue tour" pill stays) and
      // the actual control is clicked, so the user sees the real feature
      // instead of being whisked to the next page.
      hotspot.addEventListener("click", tryIt);
      hotspot.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tryIt(); }
      });
      resumeBtn.addEventListener("click", function () { goToStep(idx + 1); });
      window.addEventListener("resize", reposition);
      // Keep the highlight glued to the control as the page scrolls/reflows.
      window.addEventListener("scroll", reposition, true);
    }

    // Let the user use the real feature: hide the tour chrome, then click
    // the actual control so its modal/picker/input opens. A floating
    // "Continue tour" pill remains for moving on when they're done looking.
    function tryIt() {
      if (!currentTarget) { goToStep(idx + 1); return; }
      var tgt = currentTarget;
      overlay.classList.add("is-minimized");
      clearPoll();
      setTimeout(function () {
        try { tgt.click(); if (tgt.focus) tgt.focus(); } catch (e) {}
      }, 30);
    }

    function placeCard(target) {
      // Default: bottom sheet. If the highlighted control would sit under it,
      // move the card to the top instead so it never hides the control.
      card.style.top = "auto";
      card.style.bottom = "16px";
      if (!target) return;
      var r = target.getBoundingClientRect();
      var cardH = card.offsetHeight;
      var vh = window.innerHeight;
      if (r.bottom > vh - 16 - cardH - 14) {
        card.style.bottom = "auto";
        card.style.top = "16px";
      }
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
        hotspot.style.top = (r.top - pad) + "px";
        hotspot.style.left = (r.left - pad) + "px";
        hotspot.style.width = (r.width + pad * 2) + "px";
        hotspot.style.height = (r.height + pad * 2) + "px";
        hotspot.classList.add("is-active");
      } else {
        spotlight.classList.remove("has-target");
        spotlight.style.top = "50%";
        spotlight.style.left = "50%";
        spotlight.style.width = "0px";
        spotlight.style.height = "0px";
        hotspot.classList.remove("is-active");
      }
      placeCard(currentTarget);
    }

    function scrollTargetIntoView() {
      if (!currentTarget) return;
      try { currentTarget.scrollIntoView({ block: "center", inline: "nearest" }); } catch (e) {}
    }

    function clearConfetti() {
      var c = overlay.querySelector(".tour-confetti");
      if (c) c.parentNode.removeChild(c);
    }
    function spawnConfetti() {
      clearConfetti();
      var wrap = document.createElement("div");
      wrap.className = "tour-confetti";
      var html = "";
      for (var i = 0; i < 40; i++) {
        var x = Math.round(Math.random() * 100);
        var col = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
        var dur = (1.9 + Math.random() * 1.8).toFixed(2);
        var delay = (Math.random() * 0.5).toFixed(2);
        var w = 5 + Math.round(Math.random() * 5);
        html += '<i style="--x:' + x + '%;--c:' + col + ';--d:' + dur + 's;--delay:' + delay + 's;width:' + w + 'px;"></i>';
      }
      wrap.innerHTML = html;
      overlay.appendChild(wrap);
    }

    function clearPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

    // "tap" -> the highlighted control can be tried for real; Next stays
    // available too so moving on never depends on trying it.
    // "button" -> just a Next/Start button (welcome, finish, or a fallback
    // when a control never renders so the user is never stranded).
    function setControls(mode, i) {
      nextBtn.style.display = "";
      nextBtn.textContent = (i === STEPS.length - 1) ? t("tour.finish")
        : (i === 0 ? t("tour.begin") : t("tour.next"));
      if (mode === "tap") {
        tapHint.classList.add("is-shown");
        tapHint.querySelector("span").textContent = t("tour.tapHint");
      } else {
        tapHint.classList.remove("is-shown");
      }
    }

    // Controls on the JS-rendered pages appear after load and the page keeps
    // reflowing for a moment, so re-find + re-place the highlight a few times.
    function settle(step) {
      clearPoll();
      var tries = 0;
      pollTimer = setInterval(function () {
        tries++;
        var tgt = findTarget(step);
        if (tgt && tgt !== currentTarget) {
          currentTarget = tgt;
          setControls("tap", idx);
          scrollTargetIntoView();
        }
        reposition();
        if (tries > 24) { // ~2.4s of settling
          clearPoll();
          if (step.targets && !currentTarget) setControls("button", idx); // never stranded
        }
      }, 100);
    }

    function render(i) {
      idx = i;
      var step = STEPS[i];

      // Coming back from a "try it" detour restores the full tour chrome.
      overlay.classList.remove("is-minimized");

      overlay.style.setProperty("--tour-accent", step.accent[0]);
      overlay.style.setProperty("--tour-accent-2", step.accent[1]);

      stepCountEl.textContent = t("tour.stepCount").replace("{n}", i + 1).replace("{total}", STEPS.length);
      titleEl.textContent = t("tour." + step.key + ".title");
      bodyEl.textContent = t("tour." + step.key + ".body");
      overlay.querySelector(".tour-skip").textContent = t("tour.skip");
      resumeBtn.textContent = t("tour.resume") + " ▸";
      backBtn.textContent = t("tour.back");
      backBtn.classList.toggle("is-hidden", i === 0);

      currentTarget = findTarget(step);
      setControls(step.targets ? "tap" : "button", i);
      if (step.key === "done") spawnConfetti(); else clearConfetti();

      scrollTargetIntoView();
      reposition();
      if (step.targets) settle(step); else { clearPoll(); }
    }

    function goToStep(i) {
      if (i < 0) return;
      if (i >= STEPS.length) { finish(); return; }
      localStorage.setItem(STEP_KEY, String(i));
      if (STEPS[i].path !== pathOf()) window.location.href = STEPS[i].path;
      else render(i);
    }

    function finish() {
      localStorage.removeItem(ACTIVE_KEY);
      localStorage.removeItem(STEP_KEY);
      clearPoll();
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      overlay.classList.remove("is-visible");
      setTimeout(function () { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 220);
    }

    build();
    render(idx);
    void overlay.offsetWidth;
    overlay.classList.add("is-visible");
  });
})();
