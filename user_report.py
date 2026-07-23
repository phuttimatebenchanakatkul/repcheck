#!/usr/bin/env python3
"""
user_report.py -- standalone RepCheck user-activity report.

This is a *separate* command-line tool, NOT part of the Flask website. It
reads the same SQLite database the app uses (repcheck.db by default) and
prints, for every user ever created:

  - who they are (name / email / provider / when they joined)
  - how many times they've visited each page  (from usage_events)
  - how many times they've used each feature   (from usage_events)
  - their recent logged food / exercises / weigh-ins (from the account-
    synced localStorage mirror in user_data)
  - their AI analyses, HYROX races, challenges, custom items, friends
    (row counts from the dedicated tables)

Nothing here writes to the database -- it's read-only.

--------------------------------------------------------------------------
USAGE (from a command prompt / PowerShell, in the project folder):

    python user_report.py                 # every user, full report
    python user_report.py --db repcheck.db
    python user_report.py --user 2         # just user id 2
    python user_report.py --email a@b.com  # just that email (case-insensitive)
    python user_report.py --recent 20      # show up to 20 recent log rows
    python user_report.py --summary        # one line per user, no detail
    python user_report.py --json           # machine-readable JSON dump

Note on Page visits / Feature usage: those counters only started
accumulating when activity tracking shipped (the /admin PR). Anything a
user did before that was never recorded and can't be shown here -- so a
long-time user can legitimately have low/zero visit counts. The logged
food / exercises / weigh-ins, by contrast, cover the user's full history.
--------------------------------------------------------------------------
"""

import argparse
import json
import os
import sqlite3
import sys

# Kept in sync with app.py's ADMIN_PAGE_LABELS / ADMIN_FEATURE_LABELS so the
# report shows friendly names instead of raw endpoint / event slugs.
PAGE_LABELS = {
    "home": "Home", "analyze_page": "Analyze", "analyze_latest": "Analyze (latest result)",
    "workouts": "Workouts", "nutrition": "Nutrition", "coach": "Coach", "hyrox": "HYROX",
    "friends": "Friends", "settings": "Settings", "weight_history": "Weight History",
    "logging_history": "Logging History", "streaks": "Streaks", "onboarding": "Onboarding",
    "admin_users": "Admin: Signups", "admin_user_detail": "Admin: User Detail",
    "auth.login_page": "Login page", "auth.signup_page": "Signup page",
    "analyze": "Analyze (upload)", "result_latest": "Analyze result",
}
FEATURE_LABELS = {
    "workout_analysis": "Workout analyses (AI)", "food_scan": "Food photo scans (AI)",
    "coach_chat_message": "Coach chat messages", "analyze_chat_message": "Analysis chat messages",
    "hyrox_ai_analysis": "HYROX race analyses (AI)", "challenge_submission": "Challenge submissions",
    "food_logged": "Foods logged", "weight_logged": "Weigh-ins logged", "barcode_scan": "Barcode scans",
}

# Synced-data keys (mirror of the browser localStorage the app syncs server-side).
NUTRITION_KEY = "repcheck_nutrition_log_v1"
WORKOUT_KEY = "repcheck_workout_log_v2"
WEIGHT_KEY = "repcheck_weight_log_v1"

THAI_OFFSET_HOURS = 7  # Thailand is UTC+7 with no DST; created_at is stored naive-UTC.


def to_ict(value):
    """Turn a stored naive-UTC 'YYYY-MM-DD HH:MM:SS' string into local Thailand time."""
    if not value:
        return "-"
    try:
        from datetime import datetime, timedelta
        dt = datetime.strptime(str(value)[:19], "%Y-%m-%d %H:%M:%S")
        dt = dt + timedelta(hours=THAI_OFFSET_HOURS)
        return dt.strftime("%Y-%m-%d %H:%M") + " ICT"
    except (ValueError, TypeError):
        return str(value)


def load_synced(conn, user_id, key):
    """Return the JSON-decoded value of one synced user_data key, or {} on miss/garbage."""
    row = conn.execute(
        "SELECT value FROM user_data WHERE user_id=? AND key=?", (user_id, key)
    ).fetchone()
    if not row:
        return {}
    try:
        val = json.loads(row["value"])
    except (json.JSONDecodeError, TypeError):
        return {}
    return val if isinstance(val, dict) else {}


def gather_user(conn, user, recent_limit):
    """Build the full report dict for one user row."""
    uid = user["id"]

    # --- page visits / feature usage (from usage_events) ---
    page_views, feature_uses = [], []
    for ev in conn.execute(
        "SELECT event, count, last_at FROM usage_events WHERE user_id=? ORDER BY count DESC",
        (uid,),
    ):
        kind, _, name = ev["event"].partition(":")
        entry = {
            "label": (PAGE_LABELS if kind == "page" else FEATURE_LABELS).get(name, name),
            "count": ev["count"],
            "last_at": to_ict(ev["last_at"]),
        }
        (page_views if kind == "page" else feature_uses).append(entry)

    # --- logged food (full history from synced mirror) ---
    foods, total_foods = [], 0
    nutrition_log = load_synced(conn, uid, NUTRITION_KEY)
    for date_iso in sorted(nutrition_log, reverse=True):
        entries = nutrition_log.get(date_iso) or []
        if not isinstance(entries, list):
            continue
        total_foods += len(entries)
        for e in entries:
            if len(foods) < recent_limit and isinstance(e, dict):
                foods.append({
                    "date": date_iso,
                    "name": e.get("food") or e.get("name") or "?",
                    "grams": e.get("grams"),
                })

    # --- logged exercises (full history from synced mirror) ---
    workouts, total_exercises = [], 0
    workout_log = load_synced(conn, uid, WORKOUT_KEY)
    for date_iso in sorted(workout_log, reverse=True):
        entries = workout_log.get(date_iso) or []
        if not isinstance(entries, list):
            continue
        total_exercises += len(entries)
        for e in entries:
            if len(workouts) < recent_limit and isinstance(e, dict):
                workouts.append({
                    "date": date_iso,
                    "name": e.get("exercise") or "?",
                    "sets": len(e.get("sets") or []),
                })

    # --- weigh-ins (full history from synced mirror) ---
    weight_log = load_synced(conn, uid, WEIGHT_KEY)
    latest_weight = None
    if weight_log:
        latest_day = max(weight_log)
        entry = weight_log.get(latest_day) or {}
        if isinstance(entry, dict) and entry.get("kg"):
            latest_weight = {"date": latest_day, "kg": entry["kg"]}

    # --- row counts from dedicated tables ---
    def count(sql):
        return conn.execute(sql, (uid,)).fetchone()[0]

    counts = {
        "ai_analyses": count("SELECT COUNT(*) FROM analyze_results WHERE user_id=?"),
        "hyrox_races": count("SELECT COUNT(*) FROM hyrox_results WHERE user_id=?"),
        "challenges": count("SELECT COUNT(*) FROM challenge_submissions WHERE user_id=?"),
        "custom_foods": count("SELECT COUNT(*) FROM custom_foods WHERE user_id=?"),
        "custom_exercises": count("SELECT COUNT(*) FROM custom_exercises WHERE user_id=?"),
        "progress_photos": count("SELECT COUNT(*) FROM progress_photos WHERE user_id=?"),
        "friends": count("SELECT COUNT(*) FROM friends WHERE user_id=?"),
    }

    # --- recent AI analyses ---
    analyses = []
    for a in conn.execute(
        "SELECT exercise_label, overall_score, reps, created_at "
        "FROM analyze_results WHERE user_id=? ORDER BY created_at DESC LIMIT ?",
        (uid, recent_limit),
    ):
        analyses.append({
            "exercise": a["exercise_label"],
            "score": a["overall_score"],
            "reps": a["reps"],
            "at": to_ict(a["created_at"]),
        })

    return {
        "id": uid,
        "name": user["name"],
        "email": user["email"],
        "provider": user["auth_provider"],
        "joined": to_ict(user["created_at"]),
        "page_views": page_views,
        "feature_uses": feature_uses,
        "foods": foods,
        "total_foods": total_foods,
        "workouts": workouts,
        "total_exercises": total_exercises,
        "weigh_ins": len(weight_log),
        "latest_weight": latest_weight,
        "counts": counts,
        "analyses": analyses,
    }


def print_user(r):
    line = "=" * 72
    print(line)
    print(f"#{r['id']}  {r['name'] or '(no name)'}   <{r['email'] or 'no email'}>")
    print(f"     provider: {r['provider']}    joined: {r['joined']}")
    print(line)

    c = r["counts"]
    print("  Totals:")
    print(f"     foods logged: {r['total_foods']}   exercises logged: {r['total_exercises']}"
          f"   weigh-ins: {r['weigh_ins']}")
    if r["latest_weight"]:
        print(f"     latest weight: {r['latest_weight']['kg']}kg ({r['latest_weight']['date']})")
    print(f"     AI analyses: {c['ai_analyses']}   HYROX races: {c['hyrox_races']}"
          f"   challenges: {c['challenges']}")
    print(f"     custom foods: {c['custom_foods']}   custom exercises: {c['custom_exercises']}"
          f"   progress photos: {c['progress_photos']}   friends: {c['friends']}")

    print("\n  Page visits (most visited first):")
    if r["page_views"]:
        for p in r["page_views"]:
            print(f"     {p['count']:>5}x  {p['label']:<28}  last {p['last_at']}")
    else:
        print("     (none recorded since tracking was added)")

    print("\n  Feature usage:")
    if r["feature_uses"]:
        for f in r["feature_uses"]:
            print(f"     {f['count']:>5}x  {f['label']:<28}  last {f['last_at']}")
    else:
        print("     (none recorded since tracking was added)")

    print(f"\n  Recent foods logged ({r['total_foods']} total):")
    if r["foods"]:
        for fd in r["foods"]:
            grams = f"{fd['grams']}g" if fd["grams"] else ""
            print(f"     {fd['date']}   {fd['name']}  {grams}")
    else:
        print("     (none)")

    print(f"\n  Recent exercises logged ({r['total_exercises']} total):")
    if r["workouts"]:
        for w in r["workouts"]:
            s = "set" if w["sets"] == 1 else "sets"
            print(f"     {w['date']}   {w['name']}  ({w['sets']} {s})")
    else:
        print("     (none)")

    print("\n  Recent AI analyses:")
    if r["analyses"]:
        for a in r["analyses"]:
            print(f"     {a['at']}   {a['exercise']}  {a['reps']} reps  {a['score']}/100")
    else:
        print("     (none)")
    print()


def print_summary(rows):
    print(f"{'ID':>4}  {'Name':<22} {'Email':<30} {'Joined':<18} "
          f"{'Foods':>5} {'Exers':>5} {'Wts':>4} {'AI':>3} {'Views':>6}")
    print("-" * 108)
    for r in rows:
        views = sum(p["count"] for p in r["page_views"])
        print(f"{r['id']:>4}  {(r['name'] or '')[:22]:<22} {(r['email'] or '')[:30]:<30} "
              f"{r['joined']:<18} {r['total_foods']:>5} {r['total_exercises']:>5} "
              f"{r['weigh_ins']:>4} {r['counts']['ai_analyses']:>3} {views:>6}")
    print(f"\n{len(rows)} user(s) total.")


def main():
    ap = argparse.ArgumentParser(
        description="Standalone RepCheck user-activity report (read-only).")
    ap.add_argument("--db", default="repcheck.db", help="path to the SQLite database")
    ap.add_argument("--user", type=int, help="only this user id")
    ap.add_argument("--email", help="only this email (case-insensitive)")
    ap.add_argument("--recent", type=int, default=15,
                    help="max recent log rows to show per section (default 15)")
    ap.add_argument("--summary", action="store_true",
                    help="one line per user instead of the full report")
    ap.add_argument("--json", action="store_true", help="dump JSON instead of text")
    args = ap.parse_args()

    if not os.path.exists(args.db):
        sys.exit(f"Database not found: {args.db}\n"
                 f"Run this from the project folder, or pass --db <path>.")

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row

    where, params = "", []
    if args.user is not None:
        where, params = "WHERE id = ?", [args.user]
    elif args.email:
        where, params = "WHERE LOWER(email) = LOWER(?)", [args.email]

    users = conn.execute(
        f"SELECT id, name, email, auth_provider, created_at FROM users {where} ORDER BY id",
        params,
    ).fetchall()

    if not users:
        sys.exit("No matching users.")

    rows = [gather_user(conn, u, args.recent) for u in users]
    conn.close()

    if args.json:
        print(json.dumps(rows, indent=2, ensure_ascii=False))
    elif args.summary:
        print_summary(rows)
    else:
        print(f"\nRepCheck user report  --  {len(rows)} user(s)  --  db: {args.db}\n")
        for r in rows:
            print_user(r)


if __name__ == "__main__":
    main()
