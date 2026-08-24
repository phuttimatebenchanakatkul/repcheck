"""Searchable exercise library, shared by the workout logger and the AI
form-analyzer's exercise picker.

A handful of these names exactly match entries in analyze_form_gemini.py's
EXERCISES dict, which carries hand-written, research-backed coaching notes
for that specific movement. Everything else in this list still works with
the analyzer, it just falls back to generic strength-training form
principles instead of exercise-specific notes (see
analyze_form_gemini.resolve_exercise).

Organized into EXERCISE_CATEGORIES (goal-oriented groups, not just muscle
groups) so both the split planner (split_planner.py) and the "plan your
own split" custom-day exercise picker in the UI can offer a real,
goal-appropriate set instead of only guessing from a day's typed name:
strength/muscle-building is broken out by muscle group, plus dedicated
Mobility & Flexibility, Athletic / Speed & Agility (for "I want to move
faster in my sport" type goals), Functional / Real-World Strength (for
everyday-life goals like being able to carry/lift things -- the "I want
to be able to lift my grandma" case), Balance & Stability, and Prenatal /
Low-Impact (pregnancy-safe: no supine heavy loading, no high-impact
jumping, joint-friendly). WORKOUT_EXERCISES is still a flat list of every
name, derived from this dict, so existing code that just wants "all valid
exercise names" doesn't need to change.

Existing exercise names are never renamed here, even the ambiguous-sounding
ones (e.g. "Bicep Curl", "Shoulder Press") -- exercise_details.py and
analyze_form_gemini.py's curated coaching notes, plus every user's already-
logged workout history, key off these exact strings, so a rename would
silently orphan all of that. Instead, ambiguity gets resolved by adding a
*new*, explicitly-equipment-named sibling entry alongside the original
(e.g. "Bicep Curl" stays as the implied-dumbbell version, and "Barbell
Bicep Curl" / "EZ-Bar Bicep Curl" / "Resistance Band Bicep Curl" are added
next to it) -- see EXERCISE_LOCATIONS below for how every entry, old and
new, is tagged by where it can actually be done.
"""

EXERCISE_CATEGORIES = {
    "Chest": [
        "Flat Bench Press",
        "Incline Bench Press",
        "Decline Bench Press",
        "Dumbbell Bench Press",
        "Incline Dumbbell Press",
        "Decline Dumbbell Press",
        "Floor Press",
        "Chest Fly",
        "Cable Crossover",
        "Pec Deck",
        "Push-Up",
        "Incline Push-Up",
        "Decline Push-Up",
        "Dips",
        "Landmine Press",
        "Resistance Band Chest Press",
    ],
    "Back": [
        "Wide-Grip Lat Pulldown",
        "Close-Grip Lat Pulldown",
        "Straight-Arm Pulldown",
        "Pull-Up",
        "Chin-Up",
        "Bent-Over Row",
        "Seated Cable Row",
        "Dumbbell Row",
        "Single-Arm Dumbbell Row",
        "T-Bar Row",
        "Inverted Row",
        "Resistance Band Row",
        "Renegade Row",
        "Deadlift",
        "Sumo Deadlift",
        "Rack Pull",
        "Romanian Deadlift (RDL)",
        "Dumbbell Romanian Deadlift",
        "Stiff-Leg Deadlift (SLDL)",
        "Good Morning",
    ],
    "Shoulders": [
        "Shoulder Press",
        "Overhead Press",
        "Arnold Press",
        "Lateral Raise",
        "Cable Lateral Raise",
        "Front Raise",
        "Rear Delt Fly",
        "Face Pull",
        "Resistance Band Face Pull",
        "Upright Row",
        "Shrug",
        "Pike Push-Up",
    ],
    "Arms": [
        "Bicep Curl",
        "Barbell Bicep Curl",
        "EZ-Bar Bicep Curl",
        "Resistance Band Bicep Curl",
        "Hammer Curl",
        "Preacher Curl",
        "Concentration Curl",
        "Cable Curl",
        "Spider Curl",
        "Zottman Curl",
        "Tricep Pushdown",
        "Tricep Extension",
        "Overhead Tricep Extension",
        "Barbell Skull Crusher",
        "Skull Crusher",
        "Close-Grip Bench Press",
        "Diamond Push-Up",
        "Bench Dip",
        "Cable Kickback",
    ],
    "Legs": [
        "Squat",
        "Dumbbell Squat",
        "Front Squat",
        "Goblet Squat",
        "Sumo Squat",
        "Box Squat",
        "Pistol Squat",
        "Leg Press",
        "Hack Squat",
        "Leg Extension",
        "Lying Leg Curl Machine",
        "Seated Leg Curl",
        "Nordic Hamstring Curl",
        "Walking Lunge",
        "Reverse Lunge",
        "Bulgarian Split Squat",
        "Step-Up",
        "Hip Thrust",
        "Barbell Hip Thrust",
        "Glute Bridge",
        "Hip Abduction Machine",
        "Hip Adduction Machine",
        "Calf Raise",
        "Seated Calf Raise",
        "Sissy Squat",
    ],
    "Core": [
        "Plank",
        "Side Plank",
        "Crunch",
        "Bicycle Crunch",
        "Cable Crunch",
        "Sit-Up",
        "V-Up",
        "Hanging Leg Raise",
        "Ab Wheel Rollout",
        "Cable Woodchopper",
        "Russian Twist",
        "Dead Bug",
        "Mountain Climber",
    ],
    "Full Body / Conditioning": [
        "Kettlebell Swing",
        "Farmer's Carry",
        "Thruster",
        "Burpee",
        "Devil Press",
        "Clean and Jerk",
        "Snatch",
        "Wall Ball Shot",
        "Sled Push",
        "Sled Pull",
        "Box Jump Over",
        "Rowing Machine Intervals",
        "Assault Bike Intervals",
    ],
    "Mobility & Flexibility": [
        "World's Greatest Stretch",
        "Cat-Cow Stretch",
        "Thoracic Spine Rotation",
        "90/90 Hip Stretch",
        "Deep Squat Hold",
        "Cossack Squat",
        "Hip Flexor Stretch",
        "Pigeon Pose",
        "Downward Dog",
        "Shoulder Dislocates",
        "Arm Circles",
        "Band Pull-Apart",
        "Wall Slides",
        "Leg Swings",
        "Walking Knee Hug",
        "Spiderman Lunge with Reach",
        "Standing Quad Stretch",
        "Ankle Mobility Drill",
        "Scorpion Stretch",
        "Foam Rolling",
    ],
    # For goals like "I want to move faster / be more explosive in my
    # sport" -- sprint mechanics, jumps, and change-of-direction drills.
    "Athletic / Speed & Agility": [
        "Sprint Starts",
        "Flying Sprints",
        "Hill Sprints",
        "Resisted Sprint (Sled Push)",
        "Sled Drag",
        "Box Jump",
        "Depth Jump",
        "Broad Jump",
        "Lateral Bound",
        "Single-Leg Bound",
        "Agility Ladder Drills",
        "Cone Shuttle Run",
        "5-10-5 Pro Agility Drill",
        "T-Drill",
        "Reactive Ball Drop Drill",
        "Medicine Ball Rotational Throw",
        "Medicine Ball Chest Pass",
        "Medicine Ball Slam",
        "Jump Rope",
        "High Knees",
        "Butt Kicks",
        "A-Skip",
        "B-Skip",
        "Bounding",
        "Plyo Push-Up",
        "Squat Jump",
        "Tuck Jump",
        "Lateral Skater Jump",
    ],
    # For everyday/real-world strength goals -- e.g. "I want to be able
    # to lift and carry my grandmother" -- carrying, ground-to-standing,
    # and loaded-transport movements rather than machine isolation work.
    "Functional / Real-World Strength": [
        "Suitcase Carry",
        "Overhead Carry",
        "Sandbag Carry",
        "Sandbag Clean",
        "Sandbag Shouldering",
        "Zercher Carry",
        "Yoke Walk",
        "Turkish Get-Up",
        "Bear Crawl",
        "Crawling Drill",
        "Sit-to-Stand",
        "Floor-to-Stand Get-Up",
        "Loaded Stair Climb",
        "Tire Flip",
        "Deadlift to Shoulder (Sandbag)",
        "Zercher Squat",
        "Suitcase Deadlift",
        "Single-Arm Farmer's Carry",
        "Wheelbarrow Carry",
        "Log Press",
        "Atlas Stone Lift",
        "Keg Carry",
    ],
    "Balance & Stability": [
        "Single-Leg Balance Hold",
        "Single-Leg Romanian Deadlift",
        "Bosu Ball Squat",
        "Bosu Ball Balance Hold",
        "Single-Leg Box Step-Down",
        "Tandem Stance Hold",
        "Heel-to-Toe Walk",
        "Single-Leg Deadlift Reach",
        "Stability Ball Plank",
        "Stability Ball Hamstring Curl",
        "Single-Leg Glute Bridge",
        "Balance Beam Walk",
        "Slackline Balance",
        "Single-Leg Hop and Stick",
        "Wobble Board Balance",
        "Pallof Press",
        "Standing Y-Balance Reach",
    ],
    # Pregnancy-safe, low-impact, joint-friendly -- no supine (lying on
    # back) heavy loading, no high-impact jumping, nothing maximal-effort.
    # Anyone pregnant should still confirm any exercise with their doctor
    # or midwife; this is a general starting pool, not medical advice.
    "Prenatal / Low-Impact": [
        "Prenatal Cat-Cow Stretch",
        "Pelvic Tilt",
        "Kegel Exercise",
        "Bird Dog",
        "Wall Push-Up",
        "Seated Row (Band)",
        "Standing Band Row",
        "Side-Lying Leg Lift",
        "Side-Lying Clam Shell",
        "Prenatal Squat (Supported)",
        "Chair Squat",
        "Wall Sit (Light)",
        "Standing Bicep Curl (Light Dumbbell)",
        "Seated Shoulder Press (Light)",
        "Prenatal Walking",
        "Stationary Cycling (Light)",
        "Water Aerobics",
        "Prenatal Yoga Flow",
        "Standing Pelvic Circles",
        "Modified Side Plank (Knee Down)",
        "Seated Leg Extension (Light)",
        "Ankle Pumps",
    ],
}

# Fold in the ~300 additional muscle-building exercises kept in
# extra_exercises.py (their own module so this file's literals stay
# readable). Each extra names an existing EXERCISE_CATEGORIES key, so it
# slots into the right group; done before WORKOUT_EXERCISES is derived so
# the flat list, the location check, and exercise_details.py all see them.
# exercise_variations.py is a second catalog in the same shape, adding the
# extra named variations that make a picker search for a common movement
# ("dip", "step-up", "hip thrust") come back with a full list instead of
# two or three names. Concatenated here so every merge below -- categories,
# unilateral, locations, and exercise_details.py -- covers both files.
from extra_exercises import EXTRA_EXERCISES as _BASE_EXTRA_EXERCISES
from exercise_variations import VARIATION_EXERCISES as _VARIATION_EXERCISES

_EXTRA_EXERCISES = _BASE_EXTRA_EXERCISES + _VARIATION_EXERCISES

for _extra in _EXTRA_EXERCISES:
    EXERCISE_CATEGORIES.setdefault(_extra["category"], []).append(_extra["name"])

WORKOUT_EXERCISES = [name for names in EXERCISE_CATEGORIES.values() for name in names]

# Exercises that are commonly performed one side at a time, so a lifter may
# want to log an independent weight AND rep count per side (e.g. one-arm
# cable lateral raise, single-leg press). The workout log shows a "Both
# sides / Each side" toggle only for these; everything else stays a single
# weight+reps entry. Criterion: worked with a dumbbell / cable / kettlebell
# / band / single limb where the two sides can carry different loads --
# NOT barbell or fixed-bar movements (both hands/feet locked to one
# implement), both-limb machines (leg press pad, pec deck, lat pulldown
# bar), or bodyweight moves that load both sides together.
UNILATERAL_EXERCISES = {
    # Chest
    "Cable Crossover", "Landmine Press",
    # Back
    "Dumbbell Row", "Single-Arm Dumbbell Row", "Seated Cable Row",
    "Resistance Band Row", "Renegade Row",
    # Shoulders
    "Lateral Raise", "Cable Lateral Raise", "Front Raise",
    # Arms
    "Bicep Curl", "Resistance Band Bicep Curl", "Hammer Curl",
    "Concentration Curl", "Cable Curl", "Tricep Extension",
    "Overhead Tricep Extension", "Cable Kickback",
    # Legs (single-leg variations are standard for these)
    "Pistol Squat", "Leg Press", "Leg Extension", "Lying Leg Curl Machine",
    "Seated Leg Curl", "Walking Lunge", "Reverse Lunge",
    "Bulgarian Split Squat", "Step-Up", "Calf Raise", "Seated Calf Raise",
    # Full body / conditioning
    "Kettlebell Swing",
    # Athletic / speed & agility
    "Single-Leg Bound",
    # Functional / real-world strength
    "Suitcase Carry", "Overhead Carry", "Turkish Get-Up",
    "Suitcase Deadlift", "Single-Arm Farmer's Carry",
    # Balance & stability
    "Single-Leg Balance Hold", "Single-Leg Romanian Deadlift",
    "Single-Leg Box Step-Down", "Single-Leg Deadlift Reach",
    "Single-Leg Glute Bridge", "Single-Leg Hop and Stick",
    "Standing Y-Balance Reach",
    # Prenatal / low-impact
    "Side-Lying Leg Lift", "Side-Lying Clam Shell",
    "Standing Bicep Curl (Light Dumbbell)",
}

# Add the one-side-at-a-time exercises from the extra catalog to the same set.
UNILATERAL_EXERCISES.update(
    _extra["name"] for _extra in _EXTRA_EXERCISES if _extra["unilateral"]
)

# Exercises performed with just your body -- no external load to record --
# so the workout log hides the weight field for them and asks for reps only.
# Criterion: nothing measurable in kg/lb is involved (bodyweight, a wall, a
# bar you hang from, a slider/stability ball, plain ground). Deliberately
# NOT in this set: anything with a band / plate / dumbbell / machine stack /
# assist stack (band tension and assist weight are worth recording), and
# movements that are commonly loaded (lunges, step-ups, back extensions,
# carries) -- their explicitly-loaded siblings like "Weighted Pull-Up" or
# "Weighted Plank" exist as separate entries precisely so the base version
# here can stay bodyweight-only.
BODYWEIGHT_EXERCISES = {
    # Chest / pressing
    "Push-Up", "Incline Push-Up", "Decline Push-Up", "Wide-Grip Push-Up",
    "Close-Grip Push-Up", "Archer Push-Up", "Deficit Push-Up", "Ring Push-Up",
    "Clap Push-Up", "Feet-Elevated Push-Up", "Diamond Push-Up", "Plyo Push-Up",
    "Wall Push-Up", "Dips", "Ring Dip", "Bench Dip",
    # Back / pulling
    "Pull-Up", "Chin-Up", "Wide-Grip Pull-Up", "Neutral-Grip Pull-Up",
    "Commando Pull-Up", "Inverted Row", "Inverted Row (Feet Elevated)",
    "Ring Row", "TRX Row", "Superman", "Superman Hold", "Dead Hang",
    "Towel Pull-Up Hold",
    # Shoulders
    "Pike Push-Up", "Handstand Push-Up", "Wall Handstand Hold",
    "Pike Press (Deficit)",
    # Legs / glutes
    "Pistol Squat", "Sissy Squat", "Wall Sit", "Glute Bridge",
    "Single-Leg Glute Bridge", "Frog Pump", "Nordic Hamstring Curl",
    "Eccentric Nordic Curl", "Reverse Nordic Curl", "Slider Leg Curl",
    "Swiss Ball Leg Curl", "Copenhagen Plank",
    # Core
    "Plank", "Side Plank", "Crunch", "Bicycle Crunch", "Sit-Up",
    "Decline Sit-Up", "V-Up", "Russian Twist", "Dead Bug", "Mountain Climber",
    "Hanging Leg Raise", "Hanging Knee Raise", "Hanging Windshield Wiper",
    "Toes-to-Bar", "Captain's Chair Leg Raise", "Lying Leg Raise",
    "Reverse Crunch", "Plank Shoulder Tap", "RKC Plank", "Long-Lever Plank",
    "Side Plank with Reach-Through", "Star Plank", "Hollow Body Hold",
    "Hollow Body Rock", "Flutter Kick", "Scissor Kick", "Toe Touch Crunch",
    "Heel Tap", "L-Sit Hold", "Dragon Flag", "Hanging Oblique Raise",
    "Ab Wheel Rollout", "Standing Ab Wheel Rollout", "Stir-the-Pot",
    # Full body / conditioning
    "Burpee", "Wall Walk", "Box Jump Over",
    # Mobility & flexibility
    "World's Greatest Stretch", "Cat-Cow Stretch", "Thoracic Spine Rotation",
    "90/90 Hip Stretch", "Deep Squat Hold", "Cossack Squat",
    "Hip Flexor Stretch", "Pigeon Pose", "Downward Dog", "Shoulder Dislocates",
    "Arm Circles", "Wall Slides", "Leg Swings", "Walking Knee Hug",
    "Spiderman Lunge with Reach", "Standing Quad Stretch",
    "Ankle Mobility Drill", "Scorpion Stretch", "Foam Rolling",
    # Athletic / speed & agility
    "Sprint Starts", "Flying Sprints", "Hill Sprints", "Box Jump",
    "Depth Jump", "Broad Jump", "Lateral Bound", "Single-Leg Bound",
    "Agility Ladder Drills", "Cone Shuttle Run", "5-10-5 Pro Agility Drill",
    "T-Drill", "Reactive Ball Drop Drill", "Jump Rope", "High Knees",
    "Butt Kicks", "A-Skip", "B-Skip", "Bounding", "Squat Jump", "Tuck Jump",
    "Lateral Skater Jump",
    # Functional / real-world
    "Bear Crawl", "Crawling Drill", "Sit-to-Stand", "Floor-to-Stand Get-Up",
    # Balance & stability
    "Single-Leg Balance Hold", "Bosu Ball Squat", "Bosu Ball Balance Hold",
    "Single-Leg Box Step-Down", "Tandem Stance Hold", "Heel-to-Toe Walk",
    "Single-Leg Deadlift Reach", "Stability Ball Plank",
    "Stability Ball Hamstring Curl", "Balance Beam Walk", "Slackline Balance",
    "Single-Leg Hop and Stick", "Wobble Board Balance",
    "Standing Y-Balance Reach",
    # Prenatal / low-impact
    "Prenatal Cat-Cow Stretch", "Pelvic Tilt", "Kegel Exercise", "Bird Dog",
    "Side-Lying Leg Lift", "Side-Lying Clam Shell",
    "Prenatal Squat (Supported)", "Chair Squat", "Wall Sit (Light)",
    "Prenatal Walking", "Water Aerobics", "Prenatal Yoga Flow",
    "Standing Pelvic Circles", "Modified Side Plank (Knee Down)",
    "Ankle Pumps",
}

# Where each exercise can actually be done, used by the split planner
# wizard's "Where do you usually train?" question (gym / home / hybrid --
# see split_planner.py) to only offer exercises the user can realistically
# perform:
#   "gym"  -- needs equipment only a gym/commercial facility realistically
#             has (barbell + rack, cable machine, pin-loaded machines,
#             strongman implements, a pool, ...).
#   "home" -- needs nothing beyond bodyweight or very common, cheap,
#             already-in-most-homes items (a towel, stairs, a chair, a
#             wheelbarrow, ...) -- deliberately not tagged "both" so it
#             doesn't get offered to someone who said "gym" as if a
#             wheelbarrow were standard gym equipment.
#   "both" -- doable with the kind of gear a lot of home-gym users
#             actually own (dumbbells, a kettlebell, resistance bands, a
#             pull-up bar, a sandbag, a jump rope, ...) as well as at a
#             commercial gym.
# Every name in WORKOUT_EXERCISES must have an entry here -- this is
# checked at import time below so a newly added exercise can never
# silently fall through the location filter unclassified.
EXERCISE_LOCATIONS = {
    # ---------- Chest ----------
    "Flat Bench Press": "gym",
    "Incline Bench Press": "gym",
    "Decline Bench Press": "gym",
    "Dumbbell Bench Press": "both",
    "Incline Dumbbell Press": "both",
    "Decline Dumbbell Press": "both",
    "Floor Press": "both",
    "Chest Fly": "both",
    "Cable Crossover": "gym",
    "Pec Deck": "gym",
    "Push-Up": "home",
    "Incline Push-Up": "home",
    "Decline Push-Up": "home",
    "Dips": "both",
    "Landmine Press": "gym",
    "Resistance Band Chest Press": "home",

    # ---------- Back ----------
    "Wide-Grip Lat Pulldown": "gym",
    "Close-Grip Lat Pulldown": "gym",
    "Straight-Arm Pulldown": "gym",
    "Pull-Up": "both",
    "Chin-Up": "both",
    "Bent-Over Row": "gym",
    "Seated Cable Row": "gym",
    "Dumbbell Row": "both",
    "Single-Arm Dumbbell Row": "both",
    "T-Bar Row": "gym",
    "Inverted Row": "both",
    "Resistance Band Row": "home",
    "Renegade Row": "both",
    "Deadlift": "gym",
    "Sumo Deadlift": "gym",
    "Rack Pull": "gym",
    "Romanian Deadlift (RDL)": "gym",
    "Dumbbell Romanian Deadlift": "both",
    "Stiff-Leg Deadlift (SLDL)": "gym",
    "Good Morning": "gym",

    # ---------- Shoulders ----------
    "Shoulder Press": "both",
    "Overhead Press": "gym",
    "Arnold Press": "both",
    "Lateral Raise": "both",
    "Cable Lateral Raise": "gym",
    "Front Raise": "both",
    "Rear Delt Fly": "both",
    "Face Pull": "gym",
    "Resistance Band Face Pull": "home",
    "Upright Row": "both",
    "Shrug": "both",
    "Pike Push-Up": "home",

    # ---------- Arms ----------
    "Bicep Curl": "both",
    "Barbell Bicep Curl": "gym",
    "EZ-Bar Bicep Curl": "gym",
    "Resistance Band Bicep Curl": "home",
    "Hammer Curl": "both",
    "Preacher Curl": "gym",
    "Concentration Curl": "both",
    "Cable Curl": "gym",
    "Spider Curl": "gym",
    "Zottman Curl": "both",
    "Tricep Pushdown": "gym",
    "Tricep Extension": "both",
    "Overhead Tricep Extension": "both",
    "Barbell Skull Crusher": "gym",
    "Skull Crusher": "both",
    "Close-Grip Bench Press": "gym",
    "Diamond Push-Up": "home",
    "Bench Dip": "home",
    "Cable Kickback": "gym",

    # ---------- Legs ----------
    "Squat": "gym",
    "Dumbbell Squat": "both",
    "Front Squat": "gym",
    "Goblet Squat": "both",
    "Sumo Squat": "both",
    "Box Squat": "gym",
    "Pistol Squat": "home",
    "Leg Press": "gym",
    "Hack Squat": "gym",
    "Leg Extension": "gym",
    "Lying Leg Curl Machine": "gym",
    "Seated Leg Curl": "gym",
    "Nordic Hamstring Curl": "both",
    "Walking Lunge": "both",
    "Reverse Lunge": "both",
    "Bulgarian Split Squat": "both",
    "Step-Up": "both",
    "Hip Thrust": "both",
    "Barbell Hip Thrust": "gym",
    "Glute Bridge": "home",
    "Hip Abduction Machine": "gym",
    "Hip Adduction Machine": "gym",
    "Calf Raise": "both",
    "Seated Calf Raise": "gym",
    "Sissy Squat": "home",

    # ---------- Core ----------
    "Plank": "home",
    "Side Plank": "home",
    "Crunch": "home",
    "Bicycle Crunch": "home",
    "Cable Crunch": "gym",
    "Sit-Up": "home",
    "V-Up": "home",
    "Hanging Leg Raise": "both",
    "Ab Wheel Rollout": "both",
    "Cable Woodchopper": "gym",
    "Russian Twist": "home",
    "Dead Bug": "home",
    "Mountain Climber": "home",

    # ---------- Full Body / Conditioning ----------
    "Kettlebell Swing": "both",
    "Farmer's Carry": "both",
    "Thruster": "both",
    "Burpee": "home",
    "Devil Press": "both",
    "Clean and Jerk": "gym",
    "Snatch": "gym",
    "Wall Ball Shot": "gym",
    "Sled Push": "gym",
    "Sled Pull": "gym",
    "Box Jump Over": "gym",
    "Rowing Machine Intervals": "gym",
    "Assault Bike Intervals": "gym",

    # ---------- Mobility & Flexibility (all bodyweight/cheap-prop, home-friendly) ----------
    "World's Greatest Stretch": "home",
    "Cat-Cow Stretch": "home",
    "Thoracic Spine Rotation": "home",
    "90/90 Hip Stretch": "home",
    "Deep Squat Hold": "home",
    "Cossack Squat": "home",
    "Hip Flexor Stretch": "home",
    "Pigeon Pose": "home",
    "Downward Dog": "home",
    "Shoulder Dislocates": "home",
    "Arm Circles": "home",
    "Band Pull-Apart": "home",
    "Wall Slides": "home",
    "Leg Swings": "home",
    "Walking Knee Hug": "home",
    "Spiderman Lunge with Reach": "home",
    "Standing Quad Stretch": "home",
    "Ankle Mobility Drill": "home",
    "Scorpion Stretch": "home",
    "Foam Rolling": "home",

    # ---------- Athletic / Speed & Agility ----------
    "Sprint Starts": "home",
    "Flying Sprints": "home",
    "Hill Sprints": "home",
    "Resisted Sprint (Sled Push)": "gym",
    "Sled Drag": "gym",
    "Box Jump": "gym",
    "Depth Jump": "gym",
    "Broad Jump": "home",
    "Lateral Bound": "home",
    "Single-Leg Bound": "home",
    "Agility Ladder Drills": "both",
    "Cone Shuttle Run": "home",
    "5-10-5 Pro Agility Drill": "home",
    "T-Drill": "home",
    "Reactive Ball Drop Drill": "both",
    "Medicine Ball Rotational Throw": "both",
    "Medicine Ball Chest Pass": "both",
    "Medicine Ball Slam": "both",
    "Jump Rope": "home",
    "High Knees": "home",
    "Butt Kicks": "home",
    "A-Skip": "home",
    "B-Skip": "home",
    "Bounding": "home",
    "Plyo Push-Up": "home",
    "Squat Jump": "home",
    "Tuck Jump": "home",
    "Lateral Skater Jump": "home",

    # ---------- Functional / Real-World Strength ----------
    "Suitcase Carry": "both",
    "Overhead Carry": "both",
    "Sandbag Carry": "both",
    "Sandbag Clean": "both",
    "Sandbag Shouldering": "both",
    "Zercher Carry": "gym",
    "Yoke Walk": "gym",
    "Turkish Get-Up": "both",
    "Bear Crawl": "home",
    "Crawling Drill": "home",
    "Sit-to-Stand": "home",
    "Floor-to-Stand Get-Up": "home",
    "Loaded Stair Climb": "both",
    "Tire Flip": "gym",
    "Deadlift to Shoulder (Sandbag)": "both",
    "Zercher Squat": "gym",
    "Suitcase Deadlift": "both",
    "Single-Arm Farmer's Carry": "both",
    "Wheelbarrow Carry": "home",
    "Log Press": "gym",
    "Atlas Stone Lift": "gym",
    "Keg Carry": "gym",

    # ---------- Balance & Stability ----------
    "Single-Leg Balance Hold": "home",
    "Single-Leg Romanian Deadlift": "both",
    "Bosu Ball Squat": "both",
    "Bosu Ball Balance Hold": "both",
    "Single-Leg Box Step-Down": "both",
    "Tandem Stance Hold": "home",
    "Heel-to-Toe Walk": "home",
    "Single-Leg Deadlift Reach": "home",
    "Stability Ball Plank": "both",
    "Stability Ball Hamstring Curl": "both",
    "Single-Leg Glute Bridge": "home",
    "Balance Beam Walk": "gym",
    "Slackline Balance": "home",
    "Single-Leg Hop and Stick": "home",
    "Wobble Board Balance": "both",
    "Pallof Press": "gym",
    "Standing Y-Balance Reach": "home",

    # ---------- Prenatal / Low-Impact ----------
    "Prenatal Cat-Cow Stretch": "home",
    "Pelvic Tilt": "home",
    "Kegel Exercise": "home",
    "Bird Dog": "home",
    "Wall Push-Up": "home",
    "Seated Row (Band)": "home",
    "Standing Band Row": "home",
    "Side-Lying Leg Lift": "home",
    "Side-Lying Clam Shell": "home",
    "Prenatal Squat (Supported)": "home",
    "Chair Squat": "home",
    "Wall Sit (Light)": "home",
    "Standing Bicep Curl (Light Dumbbell)": "both",
    "Seated Shoulder Press (Light)": "both",
    "Prenatal Walking": "home",
    "Stationary Cycling (Light)": "both",
    "Water Aerobics": "gym",
    "Prenatal Yoga Flow": "home",
    "Standing Pelvic Circles": "home",
    "Modified Side Plank (Knee Down)": "home",
    "Seated Leg Extension (Light)": "home",
    "Ankle Pumps": "home",
}

# Location tags for the extra catalog, from the same module.
for _extra in _EXTRA_EXERCISES:
    EXERCISE_LOCATIONS.setdefault(_extra["name"], _extra["location"])

# Same idea as the locations check below: a typo'd name in the bodyweight
# set would silently leave a weight field on (or fall off a real exercise),
# so catch it at import time.
_unknown_bodyweight = [name for name in BODYWEIGHT_EXERCISES if name not in WORKOUT_EXERCISES]
if _unknown_bodyweight:
    raise AssertionError(f"BODYWEIGHT_EXERCISES has names not in WORKOUT_EXERCISES: {_unknown_bodyweight}")

_missing_locations = [name for name in WORKOUT_EXERCISES if name not in EXERCISE_LOCATIONS]
if _missing_locations:
    raise AssertionError(f"EXERCISE_LOCATIONS is missing entries for: {_missing_locations}")
