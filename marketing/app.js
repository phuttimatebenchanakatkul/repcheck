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
