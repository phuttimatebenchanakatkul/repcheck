/*
 * First-run guided tour of the whole app -- a real walkthrough that clicks
 * INTO each page and briefly explains it, rather than just pointing at nav
 * icons from the home screen.
 *
 * Trigger: onboarding.js sets repcheck_pending_tour = "1" (and
 * repcheck_tour_step = "0") just before sending a brand-new user to home.
 * Because the tour spans several full page loads, it lives on every page
 * (loaded from base.html) and keeps its place in localStorage: each "Next"
 * saves the new step and navigates to that step's page, where this script
 * picks the step back up, waits for the page's key control to render, and
 * spotlights it under a short how-to card. Fully skippable; Settings can
 * replay it.
 *
 * Everything is data-driven from STEPS below; copy comes from i18n
 * (tour.* keys). Each step names the page it lives on and the element to
 * highlight there.
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

  // Stroke icons (viewBox 0 0 24 24) echoing each function's nav glyph.
  var ICONS = {
    welcome: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/></svg>',
    workouts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h2v4H4zM18 10h2v4h-2zM6 12h12"/><path d="M8 8h8v8H8z"/></svg>',
    nutrition: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4Z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>',
    analyze: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5 4 9l2.5 2.5"/><path d="M17.5 6.5 20 9l-2.5 2.5"/><path d="M8 4l3 16"/><path d="M2 9h4M18 9h4"/></svg>',
    hyrox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2"/><path d="M9 2h6M12 2v3"/></svg>',
    coach: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>'
  };

  // Each step: the page it lives on, the element to spotlight there (first
  // visible wins; null = a centred card), and a two-colour accent.
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

  ready(function () {
    var t = (window.RepCheckI18n && RepCheckI18n.t)
      ? function (k) { return RepCheckI18n.t(k); }
      : function (k) { return k; };

    var idx = parseInt(localStorage.getItem(STEP_KEY) || "0", 10);
    if (isNaN(idx) || idx < 0) idx = 0;
    if (idx >= STEPS.length) { localStorage.removeItem(ACTIVE_KEY); localStorage.removeItem(STEP_KEY); return; }

    // If a tour is mid-flight but this page isn't the current step's page
    // (e.g. it was interrupted and resumed on a different page), jump to the
    // right page and let its load render the step. Paths are exact, so this
    // can't loop.
    if (pathOf() !== STEPS[idx].path) {
      location.replace(STEPS[idx].path);
      return;
    }

    var overlay, spotlight, caret, card, progressFill, iconEl, countEl, titleEl, bodyEl, dotsEl, backBtn, nextBtn;
    var currentTarget = null;
    var pollTimer = null;

    function isVisible(el) {
      if (!el) return false;
      var cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0; // robust for position:fixed nav too
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
        '<div class="tour-caret"></div>' +
        '<div class="tour-card">' +
          '<div class="tour-progress"><div class="tour-progress-fill"></div></div>' +
          '<button type="button" class="tour-skip"></button>' +
          '<div class="tour-inner">' +
            '<div class="tour-icon"></div>' +
            '<div class="tour-step-count"></div>' +
            '<div class="tour-title"></div>' +
            '<div class="tour-body"></div>' +
            '<div class="tour-dots"></div>' +
            '<div class="tour-actions">' +
              '<button type="button" class="tour-back"></button>' +
              '<button type="button" class="tour-next"></button>' +
            '</div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);

      spotlight = overlay.querySelector(".tour-spotlight");
      caret = overlay.querySelector(".tour-caret");
      card = overlay.querySelector(".tour-card");
      progressFill = overlay.querySelector(".tour-progress-fill");
      iconEl = overlay.querySelector(".tour-icon");
      countEl = overlay.querySelector(".tour-step-count");
      titleEl = overlay.querySelector(".tour-title");
      bodyEl = overlay.querySelector(".tour-body");
      dotsEl = overlay.querySelector(".tour-dots");
      backBtn = overlay.querySelector(".tour-back");
      nextBtn = overlay.querySelector(".tour-next");

      dotsEl.innerHTML = STEPS.map(function () { return '<span class="tour-dot"></span>'; }).join("");

      overlay.querySelector(".tour-skip").addEventListener("click", finish);
      backBtn.addEventListener("click", function () { goToStep(idx - 1); });
      nextBtn.addEventListener("click", function () { goToStep(idx + 1); });
      window.addEventListener("resize", reposition);
    }

    function positionSpotlight(target) {
      if (target) {
        var r = target.getBoundingClientRect();
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
    }

    function positionCard(target) {
      var vw = window.innerWidth, vh = window.innerHeight;
      var cardH = card.offsetHeight, cardW = card.offsetWidth;
      var margin = 14;
      var top, left, above = true;
      if (target) {
        var r = target.getBoundingClientRect();
        left = Math.min(Math.max(margin, r.left + r.width / 2 - cardW / 2), vw - cardW - margin);
        if (r.top > cardH + margin + 10) { top = r.top - cardH - margin; above = true; }
        else { top = Math.min(r.bottom + margin, vh - cardH - margin); above = false; }
      } else {
        left = (vw - cardW) / 2;
        top = (vh - cardH) / 2;
      }
      left = Math.max(margin, left);
      top = Math.max(margin, top);
      card.style.left = left + "px";
      card.style.top = top + "px";

      if (target) {
        var tr = target.getBoundingClientRect();
        var tcx = tr.left + tr.width / 2;
        var caretX = Math.min(Math.max(left + 22, tcx), left + cardW - 22) - 9;
        var caretY = above ? (top + cardH - 9) : (top - 9);
        caret.style.left = caretX + "px";
        caret.style.top = caretY + "px";
        caret.classList.add("is-shown");
      } else {
        caret.classList.remove("is-shown");
      }
    }

    function reposition() {
      positionSpotlight(currentTarget);
      positionCard(currentTarget);
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
      for (var i = 0; i < 44; i++) {
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

    // Key controls on Workouts/Nutrition/HYROX/Coach are rendered by their
    // own JS after load, so the target may not exist the instant we render.
    // Show the card immediately, then poll briefly and snap the spotlight on
    // as soon as the element appears.
    function waitForTarget(step) {
      clearPoll();
      if (!step.targets || currentTarget) return;
      var tries = 0;
      pollTimer = setInterval(function () {
        tries++;
        var tgt = findTarget(step);
        if (tgt) { currentTarget = tgt; reposition(); clearPoll(); }
        else if (tries > 50) { clearPoll(); } // ~3s, then just leave it centred
      }, 60);
    }

    function render(i) {
      idx = i;
      var step = STEPS[i];
      currentTarget = findTarget(step);

      overlay.style.setProperty("--tour-accent", step.accent[0]);
      overlay.style.setProperty("--tour-accent-2", step.accent[1]);

      iconEl.innerHTML = ICONS[step.key] || "";
      iconEl.style.animation = "none";
      void iconEl.offsetWidth;
      iconEl.style.animation = "";

      countEl.textContent = t("tour.stepCount").replace("{n}", i + 1).replace("{total}", STEPS.length);
      titleEl.textContent = t("tour." + step.key + ".title");
      bodyEl.textContent = t("tour." + step.key + ".body");
      overlay.querySelector(".tour-skip").textContent = t("tour.skip");
      backBtn.textContent = t("tour.back");
      backBtn.classList.toggle("is-hidden", i === 0);
      nextBtn.textContent = (i === STEPS.length - 1) ? t("tour.finish") : t("tour.next");

      progressFill.style.width = ((i + 1) / STEPS.length * 100) + "%";

      var dots = dotsEl.children;
      for (var d = 0; d < dots.length; d++) dots[d].classList.toggle("is-active", d === i);

      if (step.key === "done") spawnConfetti(); else clearConfetti();

      reposition();
      setTimeout(reposition, 30);
      waitForTarget(step);
    }

    // Advance/retreat -- saves the step, then either navigates to that step's
    // page (the new page's tour.js resumes there) or re-renders in place.
    function goToStep(i) {
      if (i < 0) return;
      if (i >= STEPS.length) { finish(); return; }
      localStorage.setItem(STEP_KEY, String(i));
      if (STEPS[i].path !== pathOf()) {
        window.location.href = STEPS[i].path;
      } else {
        render(i);
      }
    }

    function finish() {
      localStorage.removeItem(ACTIVE_KEY);
      localStorage.removeItem(STEP_KEY);
      clearPoll();
      window.removeEventListener("resize", reposition);
      overlay.classList.remove("is-visible");
      setTimeout(function () { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 220);
    }

    build();
    render(idx);
    void overlay.offsetWidth;
    overlay.classList.add("is-visible");
  });
})();
