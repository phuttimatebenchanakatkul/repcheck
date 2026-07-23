/*
 * First-run guided tour -- deliberately short and simple: four steps, one
 * sentence each, advanced with a single Next button. A light dim, a ring
 * around the one control being described, and a small card at the bottom.
 * (It used to be a 7-step affair with a tap-to-try mechanic, per-step
 * colour themes and confetti; that proved overwhelming for new users, so
 * it was cut down to just the three core pages.)
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

  // Each step: the page it lives on and the control to highlight there
  // (first visible selector wins; null = a centred info card).
  var STEPS = [
    { key: "welcome", path: "/", targets: null },
    { key: "workouts", path: "/workouts", targets: ["#wl-log-btn"] },
    { key: "nutrition", path: "/nutrition", targets: ["#nl-log-btn"] },
    { key: "analyze", path: "/analyze", targets: ["#file-drop"] }
  ];

  ready(function () {
    var t = (window.RepCheckI18n && RepCheckI18n.t)
      ? function (k) { return RepCheckI18n.t(k); }
      : function (k) { return k; };

    var idx = parseInt(localStorage.getItem(STEP_KEY) || "0", 10);
    if (isNaN(idx) || idx < 0) idx = 0;
    if (idx >= STEPS.length) { localStorage.removeItem(ACTIVE_KEY); localStorage.removeItem(STEP_KEY); return; }

    // Resume on the right page if the tour was interrupted elsewhere.
    if (pathOf() !== STEPS[idx].path) { location.replace(STEPS[idx].path); return; }

    var overlay, spotlight, card, stepCountEl, titleEl, bodyEl, nextBtn;
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
        '<div class="tour-card">' +
          '<div class="tour-top">' +
            '<span class="tour-step-count"></span>' +
            '<button type="button" class="tour-skip"></button>' +
          '</div>' +
          '<div class="tour-title"></div>' +
          '<div class="tour-body"></div>' +
          '<div class="tour-foot">' +
            '<button type="button" class="tour-next"></button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);

      spotlight = overlay.querySelector(".tour-spotlight");
      card = overlay.querySelector(".tour-card");
      stepCountEl = overlay.querySelector(".tour-step-count");
      titleEl = overlay.querySelector(".tour-title");
      bodyEl = overlay.querySelector(".tour-body");
      nextBtn = overlay.querySelector(".tour-next");

      overlay.querySelector(".tour-skip").addEventListener("click", finish);
      nextBtn.addEventListener("click", function () { goToStep(idx + 1); });
      window.addEventListener("resize", reposition);
      // Keep the highlight glued to the control as the page scrolls/reflows.
      window.addEventListener("scroll", reposition, true);
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
          scrollTargetIntoView();
        }
        reposition();
        if (tries > 24) clearPoll(); // ~2.4s of settling
      }, 100);
    }

    function render(i) {
      idx = i;
      var step = STEPS[i];

      stepCountEl.textContent = t("tour.stepCount").replace("{n}", i + 1).replace("{total}", STEPS.length);
      titleEl.textContent = t("tour." + step.key + ".title");
      bodyEl.textContent = t("tour." + step.key + ".body");
      overlay.querySelector(".tour-skip").textContent = t("tour.skip");
      nextBtn.textContent = (i === STEPS.length - 1) ? t("tour.finish") : t("tour.next");

      currentTarget = findTarget(step);
      scrollTargetIntoView();
      reposition();
      if (step.targets) settle(step); else clearPoll();
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
