(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };

  var yearEl = $("#year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // ---------- loading screen ----------
  // The overlay's own CSS animation already retires it on a timer, so this
  // is purely an accelerator: once the page has actually loaded, end it
  // early rather than making a visitor watch out the full hold. Nothing
  // here is load-bearing -- with JS blocked, the CSS still clears it.
  var loader = $("#loader");
  if (loader) {
    var dismiss = function () {
      // A floor of ~700ms: a cached reload fires `load` almost immediately
      // and the screen would flash rather than read as an intro.
      var held = Date.now() - start;
      setTimeout(function () { loader.classList.add("is-done"); }, Math.max(0, 700 - held));
    };
    var start = Date.now();
    if (document.readyState === "complete") dismiss();
    else window.addEventListener("load", dismiss);
  }

  // ---------- waitlist ----------
  // Same contract as index.html's: fail closed with a readable message
  // rather than pretending a submission worked. Swap ENDPOINT for the real
  // form ID before this page goes anywhere near production.
  var ENDPOINT = "https://formspree.io/f/YOUR_FORM_ID";
  var form = $("#waitlist-form");
  var noteEl = $("[data-note]");
  var defaultNote = noteEl ? noteEl.textContent : "";

  if (form) {
    var input = $("#email", form);
    var button = $("button", form);

    form.addEventListener("submit", function (evt) {
      evt.preventDefault();
      var email = (input.value || "").trim();
      // Deliberately loose: the server does the real validation, and an
      // over-strict client regex rejects addresses that are perfectly valid.
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        input.setAttribute("aria-invalid", "true");
        if (noteEl) {
          noteEl.textContent = "That address doesn't look right — mind checking it?";
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
        body: JSON.stringify({ email: email, source: "repcheck-marketing-v2" })
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
