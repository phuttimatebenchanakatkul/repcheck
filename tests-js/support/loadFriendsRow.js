// Loads the REAL renderFriendList()/el()/escapeHtml() out of templates/friends.html
// and runs it in jsdom, rather than asserting on the file as text.
//
// This exists because of a specific failure the text-level tests could not
// see. An explanatory HTML comment was added INSIDE the row's template
// literal, and it contained a backtick -- which ends a template literal.
// Every row then rendered as the truncated comment and nothing else: no
// avatar, no name, and no report/block button, which is the one control
// App Store Guideline 1.2 requires. Every source-level test still passed,
// because the button's markup is still there in the file. Only executing it
// shows the row it actually produces.
//
// Same extraction-by-source-markers tradeoff as loadChallengesLeaderboard.js:
// the function is inline in a server-rendered Jinja template with no module
// boundary. If the markers stop matching, extraction throws loudly rather
// than silently testing stale code.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "..", "templates", "friends.html");

const START_MARKER = "function renderFriendList() {";
const END_MARKER = "async function addFriendByCode(code) {";

export function extractSource() {
  const html = readFileSync(TEMPLATE_PATH, "utf-8");
  const start = html.indexOf(START_MARKER);
  const end = html.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      "loadFriendsRow: could not find renderFriendList()..addFriendByCode() in " +
        "templates/friends.html -- the extraction markers moved or the code was " +
        "renamed. Update START/END markers."
    );
  }
  return html.slice(start, end);
}

/**
 * Evaluates the real friend-list render against fresh mocks.
 *
 * `friends` is the array the page calls myFriends; the extracted source
 * closes over it, exactly as the page does.
 */
export function loadFriendsRow(friends) {
  document.body.innerHTML = '<div id="fr-friend-list"></div>';

  const I18N = {
    "friends.empty": "No friends added yet.",
    "friends.emptySub": "Add a friend code above.",
    "safety.moreActions": "More options",
  };
  function t(key, vars) {
    let s = I18N[key] || key;
    if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, vars[k]);
    return s;
  }

  // The page binds its click handler to `document`. Binding to the real one
  // would leak across tests -- every load adds another listener, and the
  // stale ones still fire, holding their own closed-over friends array. So
  // hand the source a document that delegates everything except
  // addEventListener, and capture the handlers per load instead.
  const listeners = [];
  const documentProxy = new Proxy(document, {
    get(target, prop) {
      if (prop === "addEventListener") {
        return (type, handler, options) => listeners.push({ type, handler, options });
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  // loadFriends() is defined ABOVE the extracted slice (it fetches
  // /api/friends), so it arrives as a parameter. Counting its calls is how
  // the safety-changed handler gets checked: without the reload, blocking
  // from this screen leaves the blocked name sitting under the sheet.
  const reloads = [];
  const loadFriends = () => reloads.push(true);

  const source = extractSource();
  const factory = new Function(
    "t",
    "myFriends",
    "document",
    "loadFriends",
    `${source}\nreturn { renderFriendList, el, escapeHtml };`
  );
  const api = factory(t, friends, documentProxy, loadFriends);

  api.renderFriendList();

  /** Fire the captured listeners of one type, the way the page's own would. */
  function dispatch(type, event) {
    const matching = listeners.filter((l) => l.type === type);
    if (!matching.length) {
      throw new Error(`loadFriendsRow: nothing is listening for "${type}"`);
    }
    matching.forEach((l) => l.handler(event));
    return matching.length;
  }

  return {
    ...api,
    listeners,
    dispatch,
    reloads,
    listEl: document.getElementById("fr-friend-list"),
  };
}
