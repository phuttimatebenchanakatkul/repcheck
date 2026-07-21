/*
 * First-run guided tour of the whole app.
 *
 * Trigger: onboarding.js sets localStorage "repcheck_pending_tour" = "1"
 * just before sending a brand-new user to the home page. This script runs
 * on the home page, sees the flag, walks the user through each function
 * with a spotlight + plain-language card, then clears the flag so it never
 * repeats on its own. Settings offers a "Replay tutorial" that just sets
 * the same flag and returns home, so it's re-runnable on demand.
 *
 * Everything is data-driven from STEPS below; copy comes from i18n
 * (tour.* keys) so it translates. Each step optionally points at a nav
 * element — the mobile tabbar entry on phones, the sidebar entry on
 * desktop — picking whichever is actually visible; steps with no visible
 * target (or none at all, like the welcome/finish cards) just centre.
 */
(function () {
  var TRIGGER_KEY = "repcheck_pending_tour";
  if (localStorage.getItem(TRIGGER_KEY) !== "1") return;

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  // Stroke icons (viewBox 0 0 24 24) echoing each function's nav glyph.
  var ICONS = {
    welcome: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/></svg>',
    workouts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h2v4H4zM18 10h2v4h-2zM6 12h12"/><path d="M8 8h8v8H8z"/></svg>',
    nutrition: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4Z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>',
    analyze: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5 4 9l2.5 2.5"/><path d="M17.5 6.5 20 9l-2.5 2.5"/><path d="M8 4l3 16"/><path d="M2 9h4M18 9h4"/></svg>',
    hyrox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2"/><path d="M9 2h6M12 2v3"/></svg>',
    quickadd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>'
  };

  // key -> candidate target selectors (first visible one wins). null = centre.
  var STEPS = [
    { key: "welcome", targets: null },
    { key: "home", targets: ['.mt-item[aria-label="Home"]', '.sidebar .nav a[href="/"]'] },
    { key: "workouts", targets: ['.mt-item[aria-label="Workouts"]', '.sidebar .nav a[href$="/workouts"]'] },
    { key: "nutrition", targets: ['.mt-item[aria-label="Nutrition"]', '.sidebar .nav a[href$="/nutrition"]'] },
    { key: "analyze", targets: ['.mt-item[aria-label="Analyze"]', '.sidebar .nav a[href$="/analyze"]'] },
    { key: "hyrox", targets: ['.mt-item[aria-label="HYROX"]', '.sidebar .nav a[href$="/hyrox"]'] },
    { key: "quickadd", targets: ['#mt-fab-btn'] },
    { key: "more", targets: ['#mt-more-btn', '.sidebar .nav a[href$="/coach"]'] },
    { key: "done", targets: null }
  ];

  ready(function () {
    var t = (window.RepCheckI18n && RepCheckI18n.t)
      ? function (k) { return RepCheckI18n.t(k); }
      : function (k) { return k; };

    var idx = 0;
    var overlay, spotlight, card, iconEl, countEl, titleEl, bodyEl, dotsEl, backBtn, nextBtn;

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
        // First visible candidate wins -- the tabbar entry on phones, the
        // sidebar entry on desktop; the hidden one (per viewport) is skipped.
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
        '<div class="tour-card">' +
          '<button type="button" class="tour-skip"></button>' +
          '<div class="tour-icon"></div>' +
          '<div class="tour-step-count"></div>' +
          '<div class="tour-title"></div>' +
          '<div class="tour-body"></div>' +
          '<div class="tour-dots"></div>' +
          '<div class="tour-actions">' +
            '<button type="button" class="tour-back"></button>' +
            '<button type="button" class="tour-next"></button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);

      spotlight = overlay.querySelector(".tour-spotlight");
      card = overlay.querySelector(".tour-card");
      iconEl = overlay.querySelector(".tour-icon");
      countEl = overlay.querySelector(".tour-step-count");
      titleEl = overlay.querySelector(".tour-title");
      bodyEl = overlay.querySelector(".tour-body");
      dotsEl = overlay.querySelector(".tour-dots");
      backBtn = overlay.querySelector(".tour-back");
      nextBtn = overlay.querySelector(".tour-next");

      dotsEl.innerHTML = STEPS.map(function () { return '<span class="tour-dot"></span>'; }).join("");

      overlay.querySelector(".tour-skip").addEventListener("click", finish);
      backBtn.addEventListener("click", function () { if (idx > 0) render(idx - 1); });
      nextBtn.addEventListener("click", function () {
        if (idx < STEPS.length - 1) render(idx + 1); else finish();
      });
      // Tapping the dimmed area advances (feels natural), but never the card.
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay || e.target === spotlight) {
          if (idx < STEPS.length - 1) render(idx + 1); else finish();
        }
      });
      window.addEventListener("resize", reposition);
    }

    var currentTarget = null;

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
        // Collapse to screen centre so the whole screen just dims (no hole).
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
      var top, left;
      if (target) {
        var r = target.getBoundingClientRect();
        left = Math.min(Math.max(margin, r.left + r.width / 2 - cardW / 2), vw - cardW - margin);
        // Place above the target if there's room (bottom-nav case), else below.
        if (r.top > cardH + margin + 10) {
          top = r.top - cardH - margin;
        } else {
          top = Math.min(r.bottom + margin, vh - cardH - margin);
        }
      } else {
        left = (vw - cardW) / 2;
        top = (vh - cardH) / 2;
      }
      card.style.left = Math.max(margin, left) + "px";
      card.style.top = Math.max(margin, top) + "px";
    }

    function reposition() {
      positionSpotlight(currentTarget);
      positionCard(currentTarget);
    }

    function render(i) {
      idx = i;
      var step = STEPS[i];
      currentTarget = findTarget(step);

      iconEl.innerHTML = ICONS[step.key] || "";
      countEl.textContent = t("tour.stepCount").replace("{n}", i + 1).replace("{total}", STEPS.length);
      titleEl.textContent = t("tour." + step.key + ".title");
      bodyEl.textContent = t("tour." + step.key + ".body");
      overlay.querySelector(".tour-skip").textContent = t("tour.skip");
      backBtn.textContent = t("tour.back");
      backBtn.classList.toggle("is-hidden", i === 0);
      nextBtn.textContent = (i === STEPS.length - 1) ? t("tour.finish") : t("tour.next");

      var dots = dotsEl.children;
      for (var d = 0; d < dots.length; d++) dots[d].classList.toggle("is-active", d === i);

      // Position immediately, then again after a tick so the card is placed
      // against its final height (the icon/text swap changes it). setTimeout
      // rather than requestAnimationFrame so it still fires when the tab
      // isn't painting (rAF is throttled for backgrounded/preview tabs).
      reposition();
      setTimeout(reposition, 30);
    }

    function finish() {
      localStorage.removeItem(TRIGGER_KEY);
      window.removeEventListener("resize", reposition);
      overlay.classList.remove("is-visible");
      setTimeout(function () { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 220);
    }

    build();
    render(0);
    // Force a reflow so the opacity transition actually runs, then reveal.
    // (No rAF: it's throttled when the tab isn't painting.)
    void overlay.offsetWidth;
    overlay.classList.add("is-visible");
  });
})();
