/* RepCheck's mascot -- the one character that shows up wherever a screen
 * has nothing to show yet.
 *
 * Covers exactly four screens: the Hyrox leaderboard, the food search
 * sheet, both exercise pickers, and challenges. Each of those was a bare
 * grey sentence before; they now share one body -- a drawing, a short
 * bold headline, and a quieter line under it.
 *
 * NOT converted, and still on their own treatment: race history's
 * stopwatch (.hx-history-empty-rich) and the workout log's sprout
 * (.wl-empty), both full-color emoji in a tinted circle. So the app
 * currently has two empty-state languages, not one. Converting those two
 * needs a pose each and is tracked as follow-up -- until then, don't read
 * this module as the finished consolidation.
 *
 * The character is deliberately a blob with no arms or legs. Every pose
 * here is the same silhouette squashed, tilted, or scaled, so adding a
 * screen means picking a tilt and a prop rather than re-drawing a
 * skeleton -- and the shape survives being shrunk, which a stick figure
 * with 3px limbs does not.
 *
 * Colors are CSS custom properties, never hex, so the mascot follows the
 * theme instead of needing a second drawing per theme:
 *
 *   --rc-mascot-body    the silhouette
 *   --rc-mascot-detail  props on and around it (sweatband, crumbs,
 *                       speed lines, the podium outline)
 *   var(--card-bg)      the eyes and mouth, which are cut-outs rather
 *                       than shapes -- they're painted in whatever
 *                       surface sits behind the blob
 *   var(--bg)           the podium block's fill, and only that. It reads
 *                       as an outline on light (--bg is a hair off
 *                       --card-bg) and as a recessed block on dark. That
 *                       is the intended "empty plinth" either way.
 *
 * The body has its own token rather than reusing --text because --text
 * is right on the dark theme (a near-white blob) and wrong on the light
 * one (a near-black blob, which lands like an inkblot on a white card).
 * See the token definitions in style.css.
 *
 * Painting the eyes with var(--card-bg) is why one drawing works on both
 * a .hx-card and inside a .log-sheet: both surfaces are var(--card-bg),
 * so the cut-outs land on the right color either way. Put the mascot on
 * a surface that ISN'T --card-bg and the eyes will be wrong -- that's the
 * one constraint on where this can go.
 *
 * Deliberately monochrome, which breaks the "color is an identifier"
 * rule in DESIGN.md. That rule is about actions -- each entry point
 * keeping its own accent across every screen it appears on. The mascot
 * is not an action, it's the narrator, and giving it an accent would
 * either claim a color no action can use again or make it change
 * identity per screen.
 */
window.RepCheckMascot = (function () {
  "use strict";

  // The silhouette every pose is built from. Drawn once at viewBox
  // 190x150 so poses can be swapped without the surrounding layout
  // reflowing by a pixel.
  var BODY =
    "M85 14 C112 14 131 36 131 68 C131 94 129 110 125 118 " +
    "C121 126 113 118 107 123 C101 128 95 120 89 125 " +
    "C83 130 77 121 71 125 C65 129 59 120 53 123 " +
    "C47 126 41 126 37 118 C33 110 31 94 31 68 C31 36 58 14 85 14 Z";

  function escapeHtml(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Poses that need a <clipPath> get a fresh id per drawing. A fixed id
  // would be a duplicate the moment two empty states are in the DOM at
  // once -- and since a clip-path="url(#id)" resolves to the FIRST match
  // in the document, the second mascot would silently borrow the first
  // one's clip rather than its own.
  var uid = 0;
  function nextId(prefix) {
    uid += 1;
    return prefix + uid;
  }

  // Poses. Each returns the inner markup of the <svg>; the wrapper adds
  // the viewBox and the accessible label. Ordering inside a pose matters
  // -- props drawn before the body sit behind it, props after sit in
  // front.
  var POSES = {
    // Food search came up empty: mid-chew, crumbs still falling, the
    // wide oval mouth doing the "oh" of a search that found nothing.
    eat: function () {
      return (
        '<path d="' + BODY + '" fill="var(--rc-mascot-body)"/>' +
        '<circle cx="68" cy="62" r="6.5" fill="var(--card-bg)"/>' +
        '<circle cx="102" cy="62" r="6.5" fill="var(--card-bg)"/>' +
        '<ellipse cx="85" cy="90" rx="11" ry="13.5" fill="var(--card-bg)"/>' +
        '<circle cx="146" cy="78" r="3.2" fill="var(--rc-mascot-body)"/>' +
        '<circle cx="156" cy="93" r="2.2" fill="var(--rc-mascot-detail)"/>' +
        '<circle cx="141" cy="99" r="2.6" fill="var(--rc-mascot-detail)"/>'
      );
    },

    // Exercise search came up empty. The blob has no arms, so the
    // dumbbell sits on the floor next to it rather than in its hands --
    // the sweatband is what carries "gym" here.
    lift: function () {
      var bandId = nextId("rcMascotBand");
      return (
        '<defs><clipPath id="' + bandId + '"><path d="' + BODY + '"/></clipPath></defs>' +
        '<path d="' + BODY + '" fill="var(--rc-mascot-body)"/>' +
        '<rect x="24" y="38" width="140" height="11" fill="var(--rc-mascot-detail)" clip-path="url(#' + bandId + ')"/>' +
        '<circle cx="68" cy="66" r="6.5" fill="var(--card-bg)"/>' +
        '<circle cx="102" cy="66" r="6.5" fill="var(--card-bg)"/>' +
        '<path d="M74 96 C79 88 91 88 96 96" stroke="var(--card-bg)" stroke-width="4.5" stroke-linecap="round" fill="none"/>' +
        '<path d="M141 60 C141 60 147 70 147 74 A 6 6 0 0 1 135 74 C135 70 141 60 141 60 Z" fill="var(--rc-mascot-detail)"/>' +
        '<line x1="140" y1="126" x2="170" y2="126" stroke="var(--rc-mascot-body)" stroke-width="4" stroke-linecap="round"/>' +
        '<rect x="136" y="116" width="8" height="20" rx="3" fill="var(--rc-mascot-body)"/>' +
        '<rect x="166" y="116" width="8" height="20" rx="3" fill="var(--rc-mascot-body)"/>'
      );
    },

    // Leaderboard with no times on it. This one is an invitation, not a
    // failure, so the brows are set and the mouth is an open grin --
    // the same body leaning into speed lines instead of slumping.
    sprint: function () {
      return (
        '<g stroke="var(--rc-mascot-detail)" stroke-width="4.5" stroke-linecap="round">' +
        '<line x1="8" y1="52" x2="40" y2="52"/>' +
        '<line x1="4" y1="76" x2="32" y2="76"/>' +
        '<line x1="12" y1="100" x2="38" y2="100"/>' +
        "</g>" +
        '<g transform="translate(30 4) rotate(13 85 70)">' +
        '<path d="' + BODY + '" fill="var(--rc-mascot-body)"/>' +
        '<circle cx="70" cy="64" r="6" fill="var(--card-bg)"/>' +
        '<circle cx="103" cy="64" r="6" fill="var(--card-bg)"/>' +
        '<g stroke="var(--card-bg)" stroke-width="4.5" stroke-linecap="round">' +
        '<line x1="61" y1="50" x2="79" y2="55"/>' +
        '<line x1="112" y1="50" x2="94" y2="55"/>' +
        "</g>" +
        '<path d="M74 84 Q86 100 98 84 Z" fill="var(--card-bg)"/>' +
        "</g>"
      );
    },

    // Challenges with no attempts logged. The empty first-place block is
    // the point: it says "nobody has done this yet" in a way the
    // headline alone doesn't, which no amount of blob expression can.
    podium: function () {
      return (
        '<rect x="48" y="100" width="94" height="36" rx="5" fill="var(--bg)" stroke="var(--rc-mascot-detail)" stroke-width="2.5"/>' +
        '<text x="95" y="126" text-anchor="middle" fill="var(--rc-mascot-detail)" font-family="inherit" font-size="19" font-weight="700">1</text>' +
        '<g transform="translate(42 22) scale(0.62)">' +
        '<path d="' + BODY + '" fill="var(--rc-mascot-body)"/>' +
        '<circle cx="68" cy="60" r="7" fill="var(--card-bg)"/>' +
        '<circle cx="102" cy="60" r="7" fill="var(--card-bg)"/>' +
        '<path d="M72 86 C79 100 91 100 98 86 Z" fill="var(--card-bg)"/>' +
        "</g>"
      );
    },
  };

  // The drawing on its own, for callers that want to place it in their
  // own layout.
  //
  // The drawing is marked aria-hidden and NOT given a role or label. It is
  // decorative: the headline and sub-line beside it always render and
  // always carry the actual message, so an accessible name here just makes
  // a screen reader say the same sentence twice before the sighted user
  // sees it once.
  function art(pose) {
    var draw = POSES[pose];
    if (!draw) return "";
    return (
      '<svg class="rc-empty-art" viewBox="0 0 190 150" xmlns="http://www.w3.org/2000/svg" ' +
      'aria-hidden="true" focusable="false">' +
      draw() +
      "</svg>"
    );
  }

  // The whole block: drawing, headline, sub-line. `query` is optional and
  // gets escaped then wrapped so the searched-for term reads heavier than
  // the rest of the sentence -- it's the part the user is scanning for.
  //
  // Escaping matters here because these headlines interpolate whatever
  // was typed into a search box and the call sites assign via innerHTML.
  //
  // CONTRACT: `query` is the ONLY parameter treated as untrusted. `title`
  // and `sub` are interpolated raw so the <span> wrapper below survives,
  // which means they must be i18n constants -- never t() with a vars
  // object carrying user input, because t() does not escape its vars.
  function emptyState(opts) {
    var o = opts || {};
    var title = o.title || "";
    if (o.query != null) {
      // split/join, NOT replace(). A string replacement is scanned for
      // $&, $`, $' and $$, and escapeHtml puts a literal & into the
      // replacement -- so a typed "$" landing before one of those turned
      // into a substitution pattern and echoed the surrounding sentence
      // back into the results. This also substitutes EVERY {query}, which
      // matches how i18n.js's t() does it, so a translation that needs the
      // term twice works instead of rendering a bare "{query}".
      title = title.split("{query}").join(
        '<span class="rc-empty-q">' + escapeHtml(o.query) + "</span>"
      );
    }
    // role="status" because these blocks are injected AFTER the screen is
    // already open -- on a keystroke in a search sheet, or when a fetch
    // comes back empty. Without a live region a screen-reader user gets no
    // signal at all that the search missed: the drawing is aria-hidden and
    // the headline is a plain div nobody moves focus to. status (polite)
    // rather than alert so it waits its turn instead of cutting off what
    // is being read.
    return (
      '<div class="rc-empty" role="status">' +
      art(o.pose) +
      '<div class="rc-empty-title">' + title + "</div>" +
      (o.sub ? '<div class="rc-empty-sub">' + o.sub + "</div>" : "") +
      "</div>"
    );
  }

  return { art: art, emptyState: emptyState, poses: Object.keys(POSES) };
})();
