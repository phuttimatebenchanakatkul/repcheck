// Consent to AI processing (RepCheckAIConsent) -- App Review Guideline 5.1.2(i).
//
// RepCheck's AI features send what the user submits (food and progress
// photos, lift and challenge videos, chat messages, workout logs, body stats)
// to Google's Gemini API. Apple requires that sharing personal data with a
// third-party AI be disclosed and EXPLICITLY consented to, and that consent
// be revocable. A line under the sign-up button is neither.
//
// So this file asks, once, at the moment it matters: the first time any AI
// request is about to leave the device. It wraps window.fetch rather than
// touching each feature's call site, because there are eight of them across
// five pages, and a wrapper is the one place a ninth cannot forget. The
// server enforces the same rule independently (_has_ai_consent in app.py),
// so this file is the explanation, not the lock.
//
// Withdrawal lives in Settings -> AI features, which calls set(false).

(function (window, document) {
  "use strict";

  if (window.RepCheckAIConsent) return;

  // [method, path pattern, optional body test]. A request matching one of
  // these is held until the user has answered.
  var AI_REQUESTS = [
    ["POST", /^\/api\/analyze-food$/],
    ["POST", /^\/analyze$/],
    ["POST", /^\/api\/challenges\/\d+\/submit$/],
    ["POST", /^\/api\/coach-chat$/],
    ["POST", /^\/api\/analyze-chat$/],
    ["POST", /^\/api\/workout-chat$/],
    ["POST", /^\/api\/hyrox\/analyze$/],
    ["POST", /^\/api\/generate-split$/, function (body) {
      return typeof body === "string" && body.indexOf("ai_suggest") !== -1;
    }],
  ];
  // The weekly check-in has a non-AI answer, so it asks but never blocks:
  // declining just means the server skips Gemini and uses the trend math.
  var SOFT_REQUESTS = [["POST", /^\/api\/coaching\/weekly-adjustment$/]];

  var granted = window.REPCHECK_AI_CONSENT === true;
  var pending = null; // the open dialog's promise, shared by concurrent callers
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;

  function t(key, fallback) {
    var i18n = window.RepCheckI18n;
    var value = i18n && typeof i18n.t === "function" ? i18n.t(key) : null;
    return value && value !== key ? value : fallback;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function matches(list, method, path, body) {
    for (var i = 0; i < list.length; i++) {
      var rule = list[i];
      if (rule[0] === method && rule[1].test(path) && (!rule[2] || rule[2](body))) return true;
    }
    return false;
  }

  function describe(input, init) {
    var url;
    var method = (init && init.method) || (input && input.method) || "GET";
    try {
      url = new URL(typeof input === "string" ? input : (input && input.url) || String(input), window.location.href);
    } catch (error) {
      return null;
    }
    if (url.origin !== window.location.origin) return null;
    return { method: String(method).toUpperCase(), path: url.pathname, body: init && init.body };
  }

  function post(grantedValue) {
    return (nativeFetch || window.fetch)("/api/ai-consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ granted: grantedValue }),
    }).then(function (res) { return res.json(); });
  }

  /** Record a choice on the server. Resolves to the stored value. */
  function set(value) {
    return post(Boolean(value)).then(function (data) {
      if (!data || !data.ok) throw new Error((data && data.error) || "Couldn't save that.");
      granted = Boolean(data.granted);
      document.dispatchEvent(new CustomEvent("repcheck:ai-consent-changed", { detail: { granted: granted } }));
      return granted;
    });
  }

  function showDialog() {
    var overlay = el("div", "aic-overlay");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "aic-title");

    var card = el("div", "aic-card");
    var title = el("h2", "aic-title", t("aiConsent.title", "Allow AI features?"));
    title.id = "aic-title";
    card.appendChild(title);
    card.appendChild(el("p", "aic-body", t("aiConsent.body",
      "RepCheck's AI features work by sending what you submit to Google's Gemini AI service, which processes it to produce your result.")));

    var list = el("ul", "aic-list");
    [
      t("aiConsent.item1", "Food photos and meal notes, for calorie estimates"),
      t("aiConsent.item2", "Lift and challenge videos, for form scores and rep counts"),
      t("aiConsent.item3", "Your chat messages, plus your logged workouts for the workout chat"),
      t("aiConsent.item4", "Progress photos, weight and goal, for weekly check-ins and AI workout plans"),
      t("aiConsent.item5", "HYROX race times, for race analysis"),
    ].forEach(function (text) { list.appendChild(el("li", "", text)); });
    card.appendChild(list);

    card.appendChild(el("p", "aic-fine", t("aiConsent.fine",
      "Only what a feature needs is sent, and only when you use it. We don't sell it or use it for advertising. You can turn this off any time in Settings → AI features.")));
    var privacy = el("a", "aic-link", t("aiConsent.privacy", "How we handle your data"));
    privacy.href = "/privacy#ai";
    card.appendChild(privacy);

    var error = el("p", "aic-error");
    error.hidden = true;
    card.appendChild(error);

    var actions = el("div", "aic-actions");
    var decline = el("button", "aic-btn aic-btn-secondary", t("aiConsent.decline", "Not now"));
    decline.type = "button";
    var allow = el("button", "aic-btn aic-btn-primary", t("aiConsent.allow", "Allow"));
    allow.type = "button";
    actions.appendChild(decline);
    actions.appendChild(allow);
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    allow.focus();

    return new Promise(function (resolve) {
      function close(result) {
        document.removeEventListener("repcheck:page-will-swap", onSwap);
        overlay.remove();
        resolve(result);
      }
      function onSwap() { close(false); }
      // The page can be swapped out from under the dialog (pagenav); treat
      // that as "not now" rather than leaving an orphaned overlay.
      document.addEventListener("repcheck:page-will-swap", onSwap);
      decline.addEventListener("click", function () { close(false); });
      allow.addEventListener("click", function () {
        allow.disabled = true;
        decline.disabled = true;
        set(true).then(function () { close(true); }).catch(function (err) {
          allow.disabled = false;
          decline.disabled = false;
          error.hidden = false;
          error.textContent = (err && err.message) || "Couldn't save that. Please try again.";
        });
      });
    });
  }

  /** Resolves true once the user has agreed (asking if needed), else false. */
  function ensure() {
    if (granted) return Promise.resolve(true);
    if (!window.REPCHECK_LOGGED_IN) return Promise.resolve(false);
    if (!pending) {
      pending = showDialog().then(function (result) {
        pending = null;
        return result;
      });
    }
    return pending;
  }

  function declinedResponse() {
    return new Response(JSON.stringify({
      ok: false,
      needs_ai_consent: true,
      error: t("aiConsent.declined", "This feature uses AI. Turn on AI features in Settings to use it."),
    }), { status: 403, headers: { "Content-Type": "application/json" } });
  }

  if (nativeFetch) {
    window.fetch = function (input, init) {
      var req = describe(input, init);
      if (!req || granted) return nativeFetch(input, init);
      if (matches(SOFT_REQUESTS, req.method, req.path, req.body)) {
        return ensure().then(function () { return nativeFetch(input, init); });
      }
      if (!matches(AI_REQUESTS, req.method, req.path, req.body)) return nativeFetch(input, init);
      return ensure().then(function (ok) {
        return ok ? nativeFetch(input, init) : declinedResponse();
      });
    };
  }

  window.RepCheckAIConsent = {
    isGranted: function () { return granted; },
    ensure: ensure,
    set: set,
    // Exposed for tests.
    _matches: function (method, path, body) { return matches(AI_REQUESTS, method, path, body); },
  };
})(window, document);
