"""Per-exercise "how to perform it correctly" YouTube tutorial, shown at
the top of the Analyze results so the lifter can watch a proper-form demo
right after getting their own form graded.

Every id below is a real YouTube tutorial that was checked to actually
allow embedding (via the IFrame Player API — videos with embedding
disabled return error 101/150 and were rejected). If one is ever taken
down or made non-embeddable, swap the id in the group it belongs to.

The Analyze picker can choose any of the ~500 library exercises, which is
far more than it's worth curating a unique clip for. Instead each verified
clip is mapped to the whole family of library names that share its
movement pattern (every bench-press variant points at the bench-press
demo, every row variant at the row demo, and so on). Anything not covered
here falls back to a live YouTube search link in the UI, so there's always
a way to watch a demo — the curated set just gets a clean in-app embed.

get_exercise_video(label) returns the video id for an exact exercise
label (the string the analyzer reports back), or None to signal "use the
search-link fallback".
"""

# video id -> every exercise label that should use it. Keyed this way so
# the groups stay readable; flattened into NAME -> id below.
_VIDEO_GROUPS = {
    # ---- Chest: flat/barbell & machine presses ----
    "hWbUlkb5Ms4": [
        "Flat Bench Press", "Dumbbell Bench Press", "Decline Bench Press",
        "Decline Dumbbell Press", "Floor Press", "Smith Machine Bench Press",
        "Wide-Grip Bench Press", "Reverse-Grip Bench Press", "Spoto Press",
        "Board Press", "Pin Press", "Machine Chest Press",
        "Hammer Strength Chest Press", "Neutral-Grip Dumbbell Press",
        "Close-Grip Bench Press", "Guillotine Press", "Larsen Press",
        "Standing Cable Chest Press", "Single-Arm Machine Chest Press",
        "Resistance Band Chest Press", "Dumbbell Squeeze Press",
        "Plate Pinch Press", "Svend Press",
    ],
    # ---- Chest: incline presses ----
    "98HWfiRonkE": [
        "Incline Bench Press", "Incline Dumbbell Press",
        "Smith Machine Incline Press", "Incline Machine Chest Press",
        "Incline Cable Press", "Incline Dumbbell Squeeze Press",
    ],
    # ---- Chest: flyes / pec isolation ----
    "a9vQ_hwIksU": [
        "Chest Fly", "Cable Crossover", "Pec Deck", "Incline Dumbbell Fly",
        "Decline Dumbbell Fly", "Flat Dumbbell Fly", "Incline Cable Fly",
        "Low-to-High Cable Fly", "High-to-Low Cable Fly", "Single-Arm Cable Fly",
        "Resistance Band Fly", "Machine Fly", "Dumbbell Pullover",
        "Cable Pullover",
    ],
    # ---- Chest/upper body: push-ups ----
    "_YrJc-kTYA0": [
        "Push-Up", "Incline Push-Up", "Decline Push-Up", "Diamond Push-Up",
        "Wide-Grip Push-Up", "Close-Grip Push-Up", "Archer Push-Up",
        "Deficit Push-Up", "Weighted Push-Up", "Ring Push-Up", "Clap Push-Up",
        "Feet-Elevated Push-Up", "Banded Push-Up", "Staggered Push-Up",
        "Pike Push-Up", "Plyo Push-Up", "Wall Push-Up",
    ],
    # ---- Chest/triceps: dips ----
    "_HxxBada6Jw": [
        "Dips", "Weighted Chest Dip", "Ring Dip", "Machine-Assisted Dip",
        "Bench Dip", "Tricep Dip (Bench, Weighted)",
    ],
    # ---- Back: vertical pulls (pull-up / chin-up) ----
    "OEXosPwzFdc": [
        "Pull-Up", "Chin-Up", "Wide-Grip Pull-Up", "Neutral-Grip Pull-Up",
        "Commando Pull-Up", "Weighted Pull-Up", "Weighted Chin-Up",
        "Assisted Pull-Up (Machine)", "Band-Assisted Pull-Up",
    ],
    # ---- Back: lat pulldowns ----
    "HWGntttgJQw": [
        "Wide-Grip Lat Pulldown", "Close-Grip Lat Pulldown",
        "Straight-Arm Pulldown", "Neutral-Grip Lat Pulldown",
        "Reverse-Grip Lat Pulldown", "Single-Arm Lat Pulldown",
        "Machine Lat Pulldown", "Kneeling Cable Pulldown",
        "Resistance Band Lat Pulldown",
    ],
    # ---- Back: rows ----
    "Nqh7q3zDCoQ": [
        "Bent-Over Row", "Seated Cable Row", "Dumbbell Row",
        "Single-Arm Dumbbell Row", "T-Bar Row", "Inverted Row",
        "Resistance Band Row", "Renegade Row", "Pendlay Row", "Yates Row",
        "Reverse-Grip Barbell Row", "Chest-Supported Row",
        "Chest-Supported Dumbbell Row", "Incline Dumbbell Row", "Meadows Row",
        "Landmine Row", "Machine Row", "Hammer Strength Row",
        "Wide-Grip Seated Cable Row", "Single-Arm Cable Row", "Kroc Row",
        "Gorilla Row", "Kettlebell Row", "Seal Row",
        "Bench-Supported Dumbbell Row", "Inverted Row (Feet Elevated)",
        "Ring Row", "TRX Row", "Chest-Supported T-Bar Row",
    ],
    # ---- Posterior chain: deadlifts (from the floor) ----
    "ZaTM37cfiDs": [
        "Deadlift", "Sumo Deadlift", "Rack Pull", "Trap Bar Deadlift",
        "Deficit Deadlift", "Snatch-Grip Deadlift", "Block Pull",
        "Kettlebell Deadlift", "Kettlebell Sumo Deadlift",
    ],
    # ---- Posterior chain: RDL / hip hinge ----
    "5rIqP63yWFg": [
        "Romanian Deadlift (RDL)", "Dumbbell Romanian Deadlift",
        "Stiff-Leg Deadlift (SLDL)", "Good Morning", "Kettlebell Romanian Deadlift", "B-Stance Romanian Deadlift",
        "Single-Leg Romanian Deadlift", "Seated Good Morning",
        "Cable Pull-Through", "Single-Leg Deadlift Reach",
    ],
    # ---- Legs: squats ----
    "dW3zj79xfrc": [
        "Squat", "Dumbbell Squat", "Front Squat", "Sumo Squat", "Box Squat",
        "Hack Squat", "High-Bar Back Squat", "Low-Bar Back Squat",
        "Smith Machine Squat", "Pause Squat", "Tempo Squat", "Safety Bar Squat",
        "Belt Squat", "Landmine Squat", "Cyclist Squat", "Reverse Hack Squat",
        "Machine Squat", "Jefferson Squat", "Anderson Squat", "Pin Squat",
        "Sissy Squat", "Split Squat", "Bulgarian Split Squat",
        "Dumbbell Bulgarian Split Squat", "Front-Foot-Elevated Split Squat",
    ],
    # ---- Legs: goblet / beginner squats ----
    "lRYBbchqxtI": [
        "Goblet Squat", "Heels-Elevated Goblet Squat", "Kettlebell Goblet Squat",
        "Goblet Box Squat", "Sumo Goblet Squat", "Chair Squat",
        "Deep Squat Hold",
    ],
    # ---- Legs: leg press ----
    "nDh_BlnLCGc": [
        "Leg Press", "Single-Leg Leg Press",
    ],
    # ---- Legs: leg extension (quads) ----
    "uM86QE59Tgc": [
        "Leg Extension", "Seated Leg Extension (Light)",
    ],
    # ---- Legs: hamstring curls ----
    "yjWAuFOjhuY": [
        "Lying Leg Curl Machine", "Seated Leg Curl", "Standing Leg Curl",
        "Single-Leg Lying Leg Curl", "Swiss Ball Leg Curl", "Slider Leg Curl",
        "Banded Leg Curl", "Nordic Hamstring Curl", "Eccentric Nordic Curl",
        "Glute-Ham Raise", "Razor Curl", "Stability Ball Hamstring Curl",
    ],
    # ---- Glutes: hip thrust / bridge ----
    "_i6qpcI1Nw4": [
        "Hip Thrust", "Barbell Hip Thrust", "Glute Bridge", "Single-Leg Hip Thrust",
        "Dumbbell Hip Thrust", "Machine Hip Thrust", "Frog Pump",
        "Banded Glute Bridge", "B-Stance Hip Thrust", "Single-Leg Glute Bridge",
    ],
    # ---- Shoulders: overhead presses ----
    "zoN5EH50Dro": [
        "Shoulder Press", "Overhead Press", "Arnold Press",
        "Seated Dumbbell Shoulder Press", "Standing Dumbbell Shoulder Press",
        "Seated Barbell Shoulder Press", "Machine Shoulder Press",
        "Smith Machine Shoulder Press", "Push Press", "Z Press",
        "Behind-the-Neck Press", "Single-Arm Dumbbell Shoulder Press",
        "Single-Arm Landmine Press", "Bradford Press", "Landmine Press",
        "Cuban Press", "Handstand Push-Up",
    ],
    # ---- Shoulders: side/front raises & upright rows ----
    "Kl3LEzQ5Zqs": [
        "Lateral Raise", "Cable Lateral Raise", "Front Raise",
        "Dumbbell Lateral Raise", "Seated Lateral Raise",
        "Leaning Cable Lateral Raise", "Machine Lateral Raise", "Lu Raise",
        "Cable Front Raise", "Plate Front Raise", "Dumbbell Front Raise",
        "Landmine Lateral Raise", "3-Way Shoulder Raise", "Y-Raise",
        "Cable Y-Raise", "Upright Row", "Dumbbell Upright Row",
        "Cable Upright Row", "Wide-Grip Upright Row",
    ],
    # ---- Shoulders: rear delts / face pulls ----
    "IeOqdw9WI90": [
        "Face Pull", "Resistance Band Face Pull", "Rear Delt Fly",
        "Bent-Over Dumbbell Rear Delt Fly", "Seated Rear Delt Fly",
        "Cable Rear Delt Fly", "Reverse Pec Deck", "Rear Delt Row",
        "Cable Face Pull (Rope)", "Band Pull-Apart", "Prone Y-Raise", "W-Raise",
        "Shrug", "Dumbbell Shrug", "Barbell Shrug", "Cable Shrug",
        "Trap Bar Shrug", "Behind-the-Back Barbell Shrug",
    ],
    # ---- Arms: biceps curls ----
    "oLyP6sORFOc": [
        "Bicep Curl", "Barbell Bicep Curl", "EZ-Bar Bicep Curl",
        "Resistance Band Bicep Curl", "Preacher Curl", "Concentration Curl",
        "Cable Curl", "Spider Curl", "Zottman Curl", "Incline Dumbbell Curl",
        "Seated Dumbbell Curl", "Standing Dumbbell Curl",
        "Alternating Dumbbell Curl", "Dumbbell Preacher Curl",
        "Machine Preacher Curl", "Machine Bicep Curl", "Single-Arm Cable Curl",
        "High Cable Curl", "Bayesian Cable Curl", "Drag Curl", "Reverse Curl",
        "Reverse EZ-Bar Curl", "Cable Reverse Curl", "21s Bicep Curl",
        "Waiter Curl", "Cheat Curl", "Isometric Bicep Hold",
        "Standing Bicep Curl (Light Dumbbell)",
    ],
    # ---- Arms: hammer curls ----
    "lmIo_gVE8T4": [
        "Hammer Curl", "Cross-Body Hammer Curl", "Incline Hammer Curl",
        "Rope Hammer Curl", "Resistance Band Hammer Curl", "Spider Hammer Curl",
    ],
    # ---- Arms: triceps ----
    "NvZKjiZ8NYc": [
        "Tricep Pushdown", "Tricep Extension", "Overhead Tricep Extension",
        "Cable Kickback", "Barbell Skull Crusher", "Skull Crusher",
        "Rope Tricep Pushdown", "V-Bar Tricep Pushdown",
        "Single-Arm Tricep Pushdown", "Reverse-Grip Tricep Pushdown",
        "Cable Overhead Tricep Extension", "Dumbbell Overhead Tricep Extension",
        "Single-Arm Overhead Tricep Extension", "EZ-Bar Overhead Extension",
        "Lying Dumbbell Tricep Extension", "Cable Skull Crusher",
        "EZ-Bar Skull Crusher", "JM Press", "Tate Press", "Tricep Kickback",
        "Cable Tricep Kickback", "Dumbbell Tricep Kickback",
        "Katana Tricep Extension", "Resistance Band Tricep Pushdown",
        "Resistance Band Overhead Extension", "California Press",
    ],
    # ---- Core: planks ----
    "v25dawSzRTM": [
        "Plank", "Side Plank", "Weighted Plank", "Plank Shoulder Tap",
        "RKC Plank", "Long-Lever Plank", "Side Plank with Reach-Through",
        "Star Plank", "Copenhagen Plank", "Stability Ball Plank",
        "Modified Side Plank (Knee Down)", "Hollow Body Hold",
    ],
}

EXERCISE_VIDEOS = {}
for _vid, _names in _VIDEO_GROUPS.items():
    for _name in _names:
        EXERCISE_VIDEOS[_name] = _vid


def get_exercise_video(label):
    """Return the YouTube video id for an exact exercise label, or None if
    it isn't in the curated set (the UI then shows a search-link fallback)."""
    if not label:
        return None
    return EXERCISE_VIDEOS.get(label.strip())
