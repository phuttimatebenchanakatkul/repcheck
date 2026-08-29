/*
  Bottom tab bar: an active "bubble" that glides.

  Every tab is a plain <a> doing a real page load, so until now the only
  feedback a tap got was the whole document going away and coming back
  with the highlight already on the new tab -- which reads as a refresh,
  not as a menu moving. Two things fix that, and this file is the first:

  1. The highlight is no longer the active <a>'s own background. It's a
     separate absolutely-positioned element inside the pill, moved with
     translateX. A background can only appear and disappear; a transform
     can slide, and slides on the compositor at 60fps.

  2. It moves on pointerdown -- before the navigation is even requested.
     The bar answers the thumb immediately and the page catches up
     underneath, instead of the bar waiting for the network. This is the
     whole difference between "it reloaded" and "it moved".

  Deliberately not built on the View Transitions API: cross-document
  transitions need iOS 18.2+, and the App Store build is a WKWebView
  pointed at the live site, so a good chunk of real users would get
  nothing. A transform transition works everywhere. The view transition
  still runs on top where it exists (style.css hands mt-active-bubble to
  this element), so those users get the morph as well.

  Progressive enhancement: without this file the active tab keeps its own
  background exactly as before -- .mt-pill only drops it once this script
  has added .has-indicator and put a real bubble behind it.
*/
(function () {
  var pill = document.querySelector(".mt-pill");
  if (!pill) return;

  var items = Array.prototype.slice.call(pill.querySelectorAll(".mt-item"));
  if (!items.length) return;

  var indicator = document.createElement("span");
  indicator.className = "mt-indicator";
  indicator.setAttribute("aria-hidden", "true");
  // First child so it paints under the icons (which are given their own
  // stacking context in style.css rather than relying on source order).
  pill.insertBefore(indicator, pill.firstChild);

  function activeItem() {
    return pill.querySelector(".mt-item.is-active") || null;
  }

  // Measured with offsetLeft/offsetWidth rather than getBoundingClientRect,
  // even though the rect is the more precise of the two (the offsets are
  // integers, so on a width where flex hands the tabs fractional sizes the
  // bubble can sit up to half a pixel off). The rect reflects transforms,
  // and .mt-item:active scales the pressed tab to 0.9 -- which is exactly
  // the element being measured at exactly the moment it is pressed, so the
  // bubble would shrink to 90% on every tap. A sub-pixel seam is the
  // cheaper of the two.
  //
  // `animate: false` is used for the initial placement and for resizes --
  // the bubble must simply BE somewhere at those moments, not travel there
  // from wherever it happened to sit.
  function place(el, animate) {
    if (!el) {
      pill.classList.remove("has-indicator");
      return;
    }
    if (!animate) indicator.style.transition = "none";
    indicator.style.width = el.offsetWidth + "px";
    indicator.style.height = el.offsetHeight + "px";
    indicator.style.transform =
      "translate(" + el.offsetLeft + "px, " + el.offsetTop + "px)";
    if (!animate) {
      // Force the untransitioned values to be committed before the
      // transition is handed back, or the browser coalesces both styles
      // into one change and animates the "instant" move anyway.
      void indicator.offsetWidth;
      indicator.style.transition = "";
    }
    pill.classList.add("has-indicator");
  }

  place(activeItem(), false);

  // ---- Instant response to the thumb -------------------------------------
  // The bubble is moved on pointerdown, which is a *preview*: the pointer
  // can still be dragged off the tab, or the gesture cancelled, and then
  // no navigation happens and the bubble has to go back. `pending` is the
  // tab being previewed; it is cleared once the move is either committed
  // (a click landed, so we're navigating) or reverted.
  var pending = null;

  function revert() {
    if (!pending) return;
    pending = null;
    place(activeItem(), true);
  }

  function closestItem(node) {
    while (node && node !== pill) {
      if (node.classList && node.classList.contains("mt-item")) return node;
      node = node.parentNode;
    }
    return null;
  }

  // ---- Warm the next page while the thumb is still down -------------------
  // Between two documents there is nothing on screen: not the page, not this
  // bar. Measured on a phone, every tab switch blacked the screen out for
  // 83-215ms, and a network round trip for the next page's HTML sits inside
  // that gap. pointerdown lands ~100ms before the click that navigates, so
  // fetching here means the response is usually already in the cache by the
  // time the navigation asks for it (app.py gives pages a five-second
  // freshness window, which exists for exactly this hand-off).
  //
  // Same URL, same credentials, so this is the request the navigation was
  // going to make anyway rather than an extra one -- as long as it is not
  // wasted. Fired on pointerdown, which is a real press on a real tab, and
  // remembered per URL so a repeated press does not refetch. Skipped
  // entirely on Data Saver, where the user has said not to spend bytes on
  // maybes.
  var warmed = Object.create(null);

  function warm(item) {
    if (typeof window.fetch !== "function") return;
    var href = item.getAttribute("href");
    if (!href || warmed[href]) return;
    var conn = window.navigator && window.navigator.connection;
    if (conn && conn.saveData) return;
    warmed[href] = true;
    try {
      window.fetch(href, { credentials: "same-origin" }).catch(function () {});
    } catch (err) {
      /* A refused fetch must never cost the tap its navigation. */
    }
  }

  pill.addEventListener(
    "pointerdown",
    function (event) {
      var item = closestItem(event.target);
      if (!item || item === activeItem()) return;
      pending = item;
      place(item, true);
      warm(item);
    },
    { passive: true }
  );

  // Lifted somewhere other than the tab that was pressed -> no click is
  // coming, so put the bubble back. Listened for on the window (a drag can
  // easily end outside the bar) and decided by hit-testing the coordinates
  // rather than by event.target, because the target of a pointerup that
  // began on a tab is not reliably that tab. Crucially this is synchronous:
  // an earlier version deferred the revert with setTimeout to "let the
  // click go first", which raced -- lose the race and the bubble snapped
  // back to the old tab and then slid forward again on the click.
  window.addEventListener(
    "pointerup",
    function (event) {
      if (!pending) return;
      var r = pending.getBoundingClientRect();
      var inside =
        event.clientX >= r.left && event.clientX <= r.right &&
        event.clientY >= r.top && event.clientY <= r.bottom;
      // Inside: a click is on its way and will commit the move. Outside:
      // the gesture was dragged off, so nothing is going to happen.
      if (!inside) revert();
    },
    { passive: true }
  );
  window.addEventListener("pointercancel", revert, { passive: true });

  // The navigation is committed. Keep the bubble where the thumb put it
  // and hand the class over too, so this document's markup agrees with
  // what's on screen -- the view transition snapshots this state, and a
  // browser back to a bfcached copy of this page restores it.
  pill.addEventListener("click", function (event) {
    var item = closestItem(event.target);
    if (!item) return;
    pending = null;
    items.forEach(function (el) {
      el.classList.toggle("is-active", el === item);
    });
    place(item, true);
  });

  // ---- Keep it correct when the page didn't change ------------------------
  // Rotation, the iOS keyboard resizing the viewport, and the safe-area
  // inset changing all move the tabs without any navigation, so the bubble
  // has to be re-measured rather than left at a stale pixel offset.
  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      place(activeItem(), false);
    }, 60);
  });

  // Restoring from the back/forward cache does not re-run this script, and
  // the restored DOM may hold a preview that was never committed.
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) place(activeItem(), false);
  });
})();
