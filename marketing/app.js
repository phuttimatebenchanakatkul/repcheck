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
  var featureBtns = $$(".feature");
  var screens = $$(".screen");
  var tabs = $$(".tab");

  // Screen 0 (feature "It watches you lift") is the real screen recording
  // instead of a mocked score -- play it only while that screen is the one
  // showing, pause and rewind it otherwise so it doesn't keep running
  // silently behind the other five screens.
  var demo = document.getElementById("analyze-demo");

  function showFeature(i) {
    featureBtns.forEach(function (b, n) { b.classList.toggle("is-active", n === i); });
    screens.forEach(function (s, n) { s.classList.toggle("is-active", n === i); });
    tabs.forEach(function (t, n) { t.classList.toggle("is-active", n === TAB_FOR_FEATURE[i]); });
    if (demo) {
      if (i === 0) {
        var playing = demo.play();
        if (playing && playing.catch) playing.catch(function () {});
      } else {
        demo.pause();
        demo.currentTime = 0;
      }
    }
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
