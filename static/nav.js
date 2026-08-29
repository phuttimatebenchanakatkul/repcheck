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

  3. Holding a tab used to also do something nobody asked for: since the
     tabs are real links, iOS read a touch-and-hold as "peek this link"
     and popped up its own preview of the destination page. style.css now
     turns that callout off (-webkit-touch-callout: none on .mt-item), so
     holding a tab does nothing by itself. The only thing a held finger
     does now is drag -- see the pointermove/pointerup handling below,
     which follows the finger across the bar and, if it's lifted over a
     different tab than it landed on, navigates there directly (a touch
     that moved that much never gets a native click to do it for us).
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

  // ---- Drag-to-switch: slide a held finger along the bar ----------------
  // The tabs are real <a href> elements, so a plain tap already navigates
  // on its own via the browser's native click. This layer only handles the
  // case a click can't: pressing down on one tab and *dragging* to another
  // before lifting. `trackingId` is the pointer being followed (null when
  // no drag is in progress) so window-level move/up listeners stay no-ops
  // for any touch that didn't start on the pill -- a swipe-to-delete row
  // or a sheet drag elsewhere on the page must never be pulled in here.
  var trackingId = null;
  var startItem = null;
  var currentItem = null;

  // Hit-tests a point against the tabs rather than trusting event.target,
  // since a dragging touch's target stays pinned to wherever it started.
  // Bounds come from the tabs themselves (not the pill) -- its padding is
  // a couple of pixels, well inside `slop`. `slop` forgives a thumb
  // straying slightly above/below the bar, and the x-clamp means dragging
  // past the first/last tab still resolves to it instead of falling off
  // the edge; only straying far vertically (up into the page) counts as
  // abandoning the gesture, returning null.
  function itemAt(clientX, clientY) {
    var top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
    var rects = items.map(function (item) { return item.getBoundingClientRect(); });
    rects.forEach(function (r) {
      if (r.top < top) top = r.top;
      if (r.bottom > bottom) bottom = r.bottom;
      if (r.left < left) left = r.left;
      if (r.right > right) right = r.right;
    });
    var slop = 28;
    if (clientY < top - slop || clientY > bottom + slop) return null;
    var x = clientX;
    if (x < left) x = left;
    if (x > right) x = right;
    for (var i = 0; i < items.length; i++) {
      if (x >= rects[i].left && x <= rects[i].right) return items[i];
    }
    return x <= (left + right) / 2 ? items[0] : items[items.length - 1];
  }

  pill.addEventListener(
    "pointerdown",
    function (event) {
      var item = closestItem(event.target);
      if (!item) return;
      trackingId = event.pointerId;
      startItem = item;
      currentItem = item;
      // Starting the press already on the active tab needs no visual
      // change yet -- the bubble is already there. It only needs to move
      // once the finger actually drags onto a different tab (below).
      if (item !== activeItem()) {
        pending = item;
        place(item, true);
      }
    },
    { passive: true }
  );

  // Follows the finger for the lifetime of the drag it started with,
  // sliding the bubble to whichever tab the finger is currently over --
  // including back to the active tab if the finger returns to it.
  window.addEventListener(
    "pointermove",
    function (event) {
      if (trackingId === null || event.pointerId !== trackingId) return;
      var item = itemAt(event.clientX, event.clientY);
      if (item === currentItem) return;
      currentItem = item;
      if (item) {
        pending = item === activeItem() ? null : item;
        place(item, true);
      } else {
        pending = null;
        place(activeItem(), true);
      }
    },
    { passive: true }
  );

  // Decided by hit-testing the release coordinates, same as the move
  // handler above, rather than by event.target -- the target of a
  // pointerup that began on a tab is not reliably that tab. Crucially this
  // is synchronous: an earlier version deferred the decision with
  // setTimeout to "let the click go first", which raced -- lose the race
  // and the bubble snapped back to the old tab and then slid forward again
  // on the click.
  window.addEventListener(
    "pointerup",
    function (event) {
      if (trackingId === null || event.pointerId !== trackingId) return;
      trackingId = null;
      var finalItem = itemAt(event.clientX, event.clientY);
      var pressedItem = startItem;
      startItem = null;
      currentItem = null;
      if (!finalItem) {
        // Dragged off the bar entirely -- nothing to commit.
        revert();
        return;
      }
      if (finalItem === pressedItem) {
        // No drag across tabs happened: either a plain tap (a browser
        // click is on its way and will commit it, same as always) or a
        // press-and-release on the already-active tab (nothing to do).
        return;
      }
      // Released over a different tab than the one pressed. A touch that
      // has moved this far is one browsers treat as a pan, not a tap, so
      // no click event is coming for it -- commit the navigation here.
      pending = null;
      items.forEach(function (el) {
        el.classList.toggle("is-active", el === finalItem);
      });
      place(finalItem, true);
      var href = finalItem.getAttribute("href");
      if (href) window.location.href = href;
    },
    { passive: true }
  );
  window.addEventListener(
    "pointercancel",
    function (event) {
      if (trackingId === null || event.pointerId !== trackingId) return;
      trackingId = null;
      startItem = null;
      currentItem = null;
      revert();
    },
    { passive: true }
  );

  // The navigation is committed. Keep the bubble where the thumb put it
  // and hand the class over too, so this document's markup agrees with
  // what's on screen -- the view transition snapshots this state, and a
  // browser back to a bfcached copy of this page restores it.
  pill.addEventListener("click", function (event) {
    var item = closestItem(event.target);
    if (!item) return;
    pending = null;
    // A click is the drag machinery's signal that this gesture is over --
    // clearing trackingId here (not just on pointerup) matters because a
    // browser can still deliver a stray pointerup after the click has
    // already committed the move; without this it would be mistaken for
    // still belonging to this gesture and re-processed.
    trackingId = null;
    startItem = null;
    currentItem = null;
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
