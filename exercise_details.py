"""Per-exercise emoji + how-to-perform-it description, shown when a user
taps an exercise chip anywhere it appears from a generated split (the
split wizard's "Assign your week" review, and the Workouts page's
"Today's plan" card).

Emoji note: these are combinations of standard Unicode emoji chosen to
visually suggest each movement (e.g. a barbell + down arrow for a press),
not custom-drawn artwork — this file can't operate a design tool like
Canva, so it leans on emoji that are close, quick visual shorthand rather
than a literal illustration of the movement.

Video note: rather than hardcoding a specific YouTube video id per
exercise (which risks pointing at a deleted, wrong, or low-quality video
with no way to verify it), the frontend embeds a live YouTube search
result for "<exercise name> proper form tutorial" — always a real,
current, relevant video instead of a guess.

Every name in workout_library.WORKOUT_EXERCISES has an entry here so any
exercise the split-planner can generate has a description available.
"""

EXERCISE_DETAILS = {
    # ---------- Chest ----------
    "Flat Bench Press": {
        "emoji": "🏋️",
        "description": [
            "Lie flat on the bench.",
            "Grip just wider than shoulder width.",
            "Lower the bar under control to your mid-chest.",
            "Press up in a straight line without flaring your elbows to 90°+.",
            "Keep your shoulder blades pinned back and feet flat on the floor the whole rep.",
        ],
    },
    "Incline Bench Press": {
        "emoji": "🏋️",
        "description": [
            "Same bar path as a flat press but on a 30–45° incline bench.",
            "Lower to your upper chest/collarbone, not your neck, and avoid arching your lower back to make up the range of motion.",
        ],
    },
    "Decline Bench Press": {
        "emoji": "🏋️",
        "description": [
            "On a decline bench with your feet locked.",
            "Lower the bar to your lower chest and press straight up.",
            "Keep the motion controlled since the decline angle makes it easy to bounce the bar off your chest.",
        ],
    },
    "Dumbbell Bench Press": {
        "emoji": "🏋️",
        "description": [
            "Press two dumbbells from chest level to lockout.",
            "Letting your wrists stay stacked over your elbows.",
            "The extra stabilization demand means going lighter than your barbell press is normal and safer.",
        ],
    },
    "Incline Dumbbell Press": {
        "emoji": "🏋️",
        "description": [
            "Dumbbell press on an incline bench.",
            "Pressing up and slightly inward.",
            "Control the lowering phase, since dumbbells let your shoulders drift into a riskier position if you rush the eccentric.",
        ],
    },
    "Decline Dumbbell Press": {
        "emoji": "🏋️",
        "description": [
            "Dumbbell press on a decline bench.",
            "Targets the lower chest more than a flat or incline press; press up and slightly in rather than straight up, and control the dumbbells down to full stretch each rep.",
        ],
    },
    "Floor Press": {
        "emoji": "🏋️",
        "description": [
            "Dumbbell press lying flat on the floor instead of a bench.",
            "Your upper arms stop against the floor at the bottom of each rep, which naturally caps the range of motion and keeps your shoulders out of the deepest, riskiest position.",
        ],
    },
    "Chest Fly": {
        "emoji": "🦋",
        "description": [
            "With a slight bend in your elbows held constant.",
            "Lower the dumbbells out to the sides in a wide arc until you feel a stretch across your chest.",
            "Squeeze them back together.",
            "This is a stretch/isolation move, not a pressing move, so keep the load moderate.",
        ],
    },
    "Cable Crossover": {
        "emoji": "🦋",
        "description": [
            "Standing between two cable stacks.",
            "Pull both handles down and across your body in an arc, finishing with your hands crossing in front of your hips.",
            "Keep a slight forward lean and soft elbows throughout.",
        ],
    },
    "Pec Deck": {
        "emoji": "🦋",
        "description": [
            "Seated on the machine with your back flat against the pad.",
            "Bring the arms together in front of your chest without letting your shoulders roll forward.",
            "A controlled, machine-guided version of a chest fly.",
        ],
    },
    "Push-Up": {
        "emoji": "🤸",
        "description": [
            "Hands slightly wider than shoulders, body in a straight line from head to heels.",
            "Lower your chest to just above the floor, elbows at roughly 45° from your torso.",
            "Push back up without letting your hips sag.",
        ],
    },
    "Dips": {
        "emoji": "🤾",
        "description": [
            "On parallel bars.",
            "Lower your body until your shoulders drop just below your elbows, leaning forward slightly to bias the chest.",
            "Going deeper than that adds shoulder strain without adding much benefit.",
        ],
    },
    "Landmine Press": {
        "emoji": "🏋️",
        "description": [
            "With one end of a barbell anchored in a landmine sleeve.",
            "Press the other end up and slightly forward from shoulder height.",
            "The fixed arc is easier on the shoulder joint than a straight overhead press.",
        ],
    },
    "Incline Push-Up": {
        "emoji": "🤸",
        "description": [
            "Hands on a bench, box, or step, body straight from head to heels.",
            "The elevated hand position makes this an easier push-up variation, biased slightly toward the lower chest, good for building up to a standard push-up.",
        ],
    },
    "Decline Push-Up": {
        "emoji": "🤸",
        "description": [
            "Feet elevated on a bench or step, hands on the floor, body straight from head to heels.",
            "The elevated foot position makes this a harder push-up variation, biased slightly toward the upper chest and shoulders.",
        ],
    },
    "Resistance Band Chest Press": {
        "emoji": "🏋️",
        "description": [
            "Anchor a band behind you at chest height and press both handles forward until your arms are extended.",
            "Control the return.",
            "Keep tension on the band the whole rep instead of letting it go slack at the back.",
        ],
    },
    # ---------- Back ----------
    "Wide-Grip Lat Pulldown": {
        "emoji": "🧗",
        "description": [
            "Grip the bar wider than shoulder width.",
            "Lean back slightly.",
            "Pull it down to your upper chest by driving your elbows down and back.",
            "Avoid using body momentum to yank the weight down.",
        ],
    },
    "Close-Grip Lat Pulldown": {
        "emoji": "🧗",
        "description": [
            "Same pulldown motion with a narrow, often V-handle grip.",
            "Pull to your upper chest.",
            "Squeezing your shoulder blades together at the bottom before controlling the weight back up.",
        ],
    },
    "Straight-Arm Pulldown": {
        "emoji": "🧗",
        "description": [
            "Keeping your arms almost fully straight.",
            "Pull the bar down from overhead to your thighs using your lats, not your arms.",
            "Think of hinging at the shoulder only, like closing a stiff door.",
        ],
    },
    "Pull-Up": {
        "emoji": "🧗",
        "description": [
            "From a dead hang with an overhand grip.",
            "Pull your chin above the bar by driving your elbows down toward your hips.",
            "Avoid kipping/swinging if the goal is strict back strength.",
        ],
    },
    "Chin-Up": {
        "emoji": "🧗",
        "description": [
            "Same movement as a pull-up but with an underhand grip, which shifts more work onto your biceps.",
            "Pull your chest toward the bar rather than just your chin.",
        ],
    },
    "Bent-Over Row": {
        "emoji": "🚣",
        "description": [
            "Hinge forward from the hips with a flat back until your torso is roughly 45°.",
            "Row the bar to your lower ribs.",
            "Driving your elbows straight back.",
            "Avoid standing up mid-rep to cheat the weight.",
        ],
    },
    "Seated Cable Row": {
        "emoji": "🚣",
        "description": [
            "Sit with a slight forward lean.",
            "Pull the handle to your abdomen while driving your chest up and squeezing your shoulder blades together.",
            "Keep your torso still rather than rocking to add momentum.",
        ],
    },
    "Dumbbell Row": {
        "emoji": "🚣",
        "description": [
            "With one knee and hand on a bench for support.",
            "Row the dumbbell straight up toward your hip.",
            "Keeping your torso parallel to the floor and avoiding any twisting at the top.",
        ],
    },
    "Single-Arm Dumbbell Row": {
        "emoji": "🚣",
        "description": [
            "Same setup as a dumbbell row.",
            "Focusing on one side at a time so you can feel and correct any imbalance between your left and right back strength.",
        ],
    },
    "T-Bar Row": {
        "emoji": "🚣",
        "description": [
            "Straddling the bar with a chest-supported or free-standing hinge.",
            "Row the handle up to your torso.",
            "Keep your lower back braced and avoid jerking the weight up with momentum.",
        ],
    },
    "Inverted Row": {
        "emoji": "🚣",
        "description": [
            "Lying under a bar set at hip height.",
            "Pull your chest to the bar while keeping your body in a straight plank line.",
            "Adjust difficulty by raising or lowering the bar height.",
        ],
    },
    "Resistance Band Row": {
        "emoji": "🚣",
        "description": [
            "Anchor a band in front of you at chest height.",
            "Row the handles to your ribs by driving your elbows straight back.",
            "Squeeze your shoulder blades together at the end instead of just bending your elbows.",
        ],
    },
    "Renegade Row": {
        "emoji": "🚣",
        "description": [
            "From a push-up plank position with a dumbbell in each hand.",
            "Row one dumbbell up to your hip while bracing hard through your core to keep your hips from rotating.",
            "Alternate sides each rep.",
        ],
    },
    "Deadlift": {
        "emoji": "🏋️",
        "description": [
            "Feet hip-width, bar over mid-foot, flat back.",
            "Push the floor away with your legs while keeping the bar close to your shins as it rises, locking out with your hips, not your lower back.",
        ],
    },
    "Sumo Deadlift": {
        "emoji": "🏋️",
        "description": [
            "A wide stance with toes turned out.",
            "Gripping inside your knees.",
            "The more upright torso reduces lower-back strain compared to a conventional deadlift.",
            "Keep your knees tracking over your toes throughout.",
        ],
    },
    "Rack Pull": {
        "emoji": "🏋️",
        "description": [
            "A partial deadlift starting from pins set around knee height.",
            "Focuses on the lockout portion of the pull, so keep the same braced, flat-back technique even though the range of motion is shorter.",
        ],
    },
    "Romanian Deadlift (RDL)": {
        "emoji": "🏋️",
        "description": [
            "Starting from standing.",
            "Push your hips straight back while keeping a slight knee bend and the bar close to your legs.",
            "Lowering until you feel a deep hamstring stretch.",
            "Drive your hips forward to stand back up.",
        ],
    },
    "Dumbbell Romanian Deadlift": {
        "emoji": "🏋️",
        "description": [
            "Same hip-hinge pattern as a barbell RDL but with a dumbbell in each hand.",
            "Push your hips back until you feel a stretch in your hamstrings.",
            "Keeping the dumbbells close to your legs the whole way down.",
        ],
    },
    "Stiff-Leg Deadlift (SLDL)": {
        "emoji": "🏋️",
        "description": [
            "Similar to an RDL but with straighter (not locked) knees.",
            "Isolating the hamstrings more directly.",
            "Stop lowering the bar once your lower back starts to round.",
        ],
    },
    "Good Morning": {
        "emoji": "🙇",
        "description": [
            "With a bar across your upper back.",
            "Hinge forward from the hips like a bow.",
            "Keeping your back flat, until your torso is near-parallel to the floor.",
            "Reverse the motion.",
            "Use light weight until your hip-hinge is dialed in.",
        ],
    },
    # ---------- Shoulders ----------
    "Shoulder Press": {
        "emoji": "🏋️",
        "description": [
            "Press the weight straight overhead from shoulder height until your arms lock out.",
            "Keeping your core braced so your lower back doesn't arch to help push the weight up.",
        ],
    },
    "Overhead Press": {
        "emoji": "🏋️",
        "description": [
            "The standing barbell version of a shoulder press.",
            "Brace your glutes and abs hard.",
            "Press the bar in a straight line, and move your head slightly back then forward as the bar clears your face.",
        ],
    },
    "Arnold Press": {
        "emoji": "🏋️",
        "description": [
            "Start with dumbbells in front of your shoulders, palms facing you.",
            "Rotate your palms outward as you press overhead.",
            "The rotation adds extra shoulder engagement, so keep the weight moderate.",
        ],
    },
    "Lateral Raise": {
        "emoji": "🤸",
        "description": [
            "With a soft bend in your elbows.",
            "Raise the dumbbells out to your sides until they're roughly shoulder height.",
            "Leading with your elbows rather than your hands.",
            "Avoid swinging the weight up with momentum.",
        ],
    },
    "Cable Lateral Raise": {
        "emoji": "🤸",
        "description": [
            "Same raising motion as a dumbbell lateral raise but using a low cable pulley, which keeps constant tension on the side delt through the whole range of motion.",
        ],
    },
    "Front Raise": {
        "emoji": "🤸",
        "description": [
            "Raise the weight straight in front of you to about shoulder height with a slight elbow bend.",
            "Avoid using your legs or lower back to heave the weight upward.",
        ],
    },
    "Rear Delt Fly": {
        "emoji": "🦋",
        "description": [
            "Hinged forward at the hips.",
            "Raise the dumbbells out to the sides focusing on squeezing your rear shoulders and upper back together.",
            "Keeping the movement slow and controlled rather than swinging.",
        ],
    },
    "Face Pull": {
        "emoji": "😤",
        "description": [
            "Pull a rope attachment toward your face at eye level, flaring your elbows out wide and rotating your hands so your knuckles finish pointing behind you.",
            "Great for shoulder health, so prioritize control over heavy weight.",
        ],
    },
    "Resistance Band Face Pull": {
        "emoji": "😤",
        "description": [
            "Same motion as a cable face pull.",
            "Using a band anchored at eye level instead.",
            "Pull toward your face while flaring your elbows wide, finishing with your knuckles pointing behind you.",
        ],
    },
    "Upright Row": {
        "emoji": "🚣",
        "description": [
            "Pull the bar or handle straight up along your torso to roughly chest height.",
            "Leading with your elbows.",
            "Stop before your elbows go above shoulder height to protect your shoulder joints.",
        ],
    },
    "Shrug": {
        "emoji": "🤷",
        "description": [
            "Holding weight at your sides.",
            "Lift your shoulders straight up toward your ears without rolling them forward or back.",
            "Pause briefly at the top.",
            "Lower under control.",
        ],
    },
    "Pike Push-Up": {
        "emoji": "🤸",
        "description": [
            "Hips piked up so your body forms an inverted V, hands on the floor under your shoulders.",
            "Lower the crown of your head toward the floor by bending your elbows.",
            "Press back up; a bodyweight-only shoulder press substitute.",
        ],
    },
    # ---------- Arms ----------
    "Bicep Curl": {
        "emoji": "💪",
        "description": [
            "Keeping your elbows pinned to your sides.",
            "Curl the weight up by bending your elbow only.",
            "Avoid swinging your torso or letting your upper arm drift forward to cheat the weight up.",
        ],
    },
    "Barbell Bicep Curl": {
        "emoji": "💪",
        "description": [
            "Same curl motion as a dumbbell curl.",
            "Gripping a straight barbell with both hands.",
            "Lets you load more total weight than dumbbells.",
            "Keep your elbows pinned and don't lean back to heave it up.",
        ],
    },
    "EZ-Bar Bicep Curl": {
        "emoji": "💪",
        "description": [
            "A barbell curl using a zigzag-shaped EZ-bar instead of a straight one.",
            "The angled grip is easier on the wrists, especially at heavier loads, while training the same strict elbow-only curling motion.",
        ],
    },
    "Resistance Band Bicep Curl": {
        "emoji": "💪",
        "description": [
            "Stand on the middle of a resistance band.",
            "Holding a handle in each hand.",
            "Curl up against the band's tension.",
            "The resistance gets harder the higher you curl, unlike a dumbbell where gravity does the opposite.",
        ],
    },
    "Hammer Curl": {
        "emoji": "🔨",
        "description": [
            "Same curling motion as a bicep curl but with palms facing each other the whole time (like holding a hammer).",
            "This shifts more emphasis onto the forearm and outer arm muscle.",
        ],
    },
    "Preacher Curl": {
        "emoji": "💪",
        "description": [
            "With your upper arms braced against an angled pad.",
            "Curl the weight up.",
            "The pad prevents cheating with momentum, so use a weight you can control through the full stretch at the bottom.",
        ],
    },
    "Concentration Curl": {
        "emoji": "🎯",
        "description": [
            "Seated.",
            "Brace your elbow against your inner thigh and curl the dumbbell up in a strict, isolated arc.",
            "A slow, controlled tempo matters more than the weight used here.",
        ],
    },
    "Cable Curl": {
        "emoji": "💪",
        "description": [
            "Curl a bar or handle attached to a low pulley.",
            "The cable keeps tension on your biceps even at the bottom of the rep, unlike a dumbbell or barbell curl.",
        ],
    },
    "Spider Curl": {
        "emoji": "🕷️",
        "description": [
            "Lying chest-down on an incline bench with your arms hanging straight down.",
            "Curl the weight up.",
            "This position removes any ability to swing your body.",
            "Isolating the biceps hard.",
        ],
    },
    "Zottman Curl": {
        "emoji": "💪",
        "description": [
            "Curl the dumbbells up with palms facing up like a normal curl.",
            "Rotate your wrists to face down before lowering.",
            "The reversed lowering phase works your forearms extra.",
        ],
    },
    "Tricep Pushdown": {
        "emoji": "💪",
        "description": [
            "Keeping your elbows pinned to your sides.",
            "Push a bar or rope attachment straight down until your arms are fully extended.",
            "Control it back up without letting your elbows flare out.",
        ],
    },
    "Tricep Extension": {
        "emoji": "💪",
        "description": [
            "With a dumbbell held overhead in both hands.",
            "Lower it behind your head by bending only at the elbow.",
            "Extend back up.",
            "Keep your upper arms still and close to your ears.",
        ],
    },
    "Overhead Tricep Extension": {
        "emoji": "💪",
        "description": [
            "Same movement as a tricep extension, performed strictly overhead.",
            "Brace your core to avoid arching your lower back as the weight moves behind your head.",
        ],
    },
    "Barbell Skull Crusher": {
        "emoji": "💀",
        "description": [
            "Same lying-tricep-extension motion as a skull crusher.",
            "Using a straight or EZ-bar instead of a dumbbell.",
            "Lets you load more weight.",
            "Keep the lowering phase slow and controlled since a bar over your face has zero margin for error.",
        ],
    },
    "Skull Crusher": {
        "emoji": "💀",
        "description": [
            "Lying on a bench with the weight held straight above your chest.",
            "Lower it toward your forehead by bending only your elbows.",
            "Press back up.",
            "Despite the name, this should stay slow and controlled, not crash toward your head.",
        ],
    },
    "Close-Grip Bench Press": {
        "emoji": "🏋️",
        "description": [
            "A bench press with your hands just inside shoulder width.",
            "Keeping your elbows tucked close to your body as you lower the bar to your lower chest.",
            "This shifts more of the work onto your triceps.",
        ],
    },
    "Diamond Push-Up": {
        "emoji": "💎",
        "description": [
            "A push-up with your hands close together under your chest, forming a diamond shape with your thumbs and index fingers.",
            "A harder, more tricep-focused variation of a standard push-up.",
        ],
    },
    "Bench Dip": {
        "emoji": "🤾",
        "description": [
            "Hands on the edge of a bench behind you, legs extended out in front.",
            "Lower your hips toward the floor by bending your elbows.",
            "Press back up.",
            "A bodyweight tricep move that needs nothing but a bench or sturdy chair.",
        ],
    },
    "Cable Kickback": {
        "emoji": "💪",
        "description": [
            "Hinged forward with your upper arm held still and parallel to the floor.",
            "Extend your forearm straight back against cable resistance.",
            "Squeezing your tricep at full extension.",
        ],
    },
    # ---------- Legs ----------
    "Squat": {
        "emoji": "🦵",
        "description": [
            "Feet shoulder-width, bar on your upper back.",
            "Sit your hips down and back while keeping your chest up and knees tracking over your toes.",
            "Go as deep as your mobility allows without your lower back rounding.",
        ],
    },
    "Dumbbell Squat": {
        "emoji": "🦵",
        "description": [
            "Same squat pattern as a barbell squat.",
            "Holding a dumbbell in each hand at your sides (or one at your chest) instead of a bar on your back.",
            "A no-rack way to load a squat at home, at the cost of less total weight than a barbell allows.",
        ],
    },
    "Front Squat": {
        "emoji": "🦵",
        "description": [
            "Same squat pattern with the bar racked across the front of your shoulders instead of your back.",
            "This demands a more upright torso and shifts more emphasis onto your quads.",
        ],
    },
    "Goblet Squat": {
        "emoji": "🍷",
        "description": [
            "Hold a single dumbbell or kettlebell vertically against your chest and squat down between your knees.",
            "A beginner-friendly squat pattern since the front-loaded weight naturally keeps your torso upright.",
        ],
    },
    "Sumo Squat": {
        "emoji": "🦵",
        "description": [
            "A wide stance with toes turned out, squatting straight down between your legs.",
            "Targets your inner thighs and glutes more than a standard-stance squat.",
        ],
    },
    "Box Squat": {
        "emoji": "📦",
        "description": [
            "Squat down until you lightly touch a box or bench behind you.",
            "Pause briefly without relaxing.",
            "Drive back up.",
            "Great for learning to sit your hips back properly and controlling depth.",
        ],
    },
    "Leg Press": {
        "emoji": "🦵",
        "description": [
            "Feet shoulder-width on the platform.",
            "Lower the weight until your knees reach about 90°.",
            "Press back up without locking your knees out hard or letting your lower back round off the pad.",
        ],
    },
    "Hack Squat": {
        "emoji": "🦵",
        "description": [
            "On the angled hack squat machine with your back against the pad.",
            "Lower under control until your knees reach roughly 90°.",
            "Press back up.",
            "Keep your heels flat throughout.",
        ],
    },
    "Leg Extension": {
        "emoji": "🦵",
        "description": [
            "Seated on the machine.",
            "Extend your legs to straighten your knees against the pad resistance.",
            "Lower under control.",
            "An isolation move for the quads, not a pressing movement.",
        ],
    },
    "Lying Leg Curl Machine": {
        "emoji": "🦵",
        "description": [
            "Lying face-down on the machine.",
            "Curl your heels toward your glutes against the pad resistance.",
            "Lower slowly.",
            "Avoid lifting your hips off the bench to cheat the weight up.",
        ],
    },
    "Seated Leg Curl": {
        "emoji": "🦵",
        "description": [
            "Seated on the machine with the pad against your lower shins.",
            "Curl your heels down and back underneath the seat.",
            "Focusing on squeezing your hamstrings at the bottom.",
        ],
    },
    "Nordic Hamstring Curl": {
        "emoji": "🦵",
        "description": [
            "Kneeling with your ankles anchored.",
            "Lower your torso forward as slowly as possible using only your hamstrings to control the descent.",
            "A very advanced, injury-prevention-focused hamstring exercise, so build up gradually.",
        ],
    },
    "Walking Lunge": {
        "emoji": "🚶",
        "description": [
            "Step forward into a lunge.",
            "Lowering your back knee toward the floor.",
            "Push off your front foot into the next step.",
            "Keep your torso upright and your front knee tracking over your ankle, not caving inward.",
        ],
    },
    "Reverse Lunge": {
        "emoji": "🚶",
        "description": [
            "Step backward into a lunge instead of forward.",
            "Generally easier on the knees than a walking or forward lunge since there's less forward momentum to control.",
        ],
    },
    "Bulgarian Split Squat": {
        "emoji": "🦵",
        "description": [
            "With your rear foot elevated on a bench behind you.",
            "Lower straight down on your front leg until your back knee nearly touches the floor.",
            "Drive back up.",
            "Most of the work should be felt in your front leg, not your back foot.",
        ],
    },
    "Step-Up": {
        "emoji": "📦",
        "description": [
            "Step fully onto a box or bench with one foot.",
            "Driving through your heel to stand up on top rather than pushing off your trailing leg.",
            "Control the step back down instead of just dropping.",
        ],
    },
    "Hip Thrust": {
        "emoji": "🍑",
        "description": [
            "With your upper back braced on a bench and a bar across your hips.",
            "Drive your hips up until your body forms a straight line from shoulders to knees.",
            "Squeezing your glutes hard at the top.",
        ],
    },
    "Barbell Hip Thrust": {
        "emoji": "🍑",
        "description": [
            "The full-weight-room hip thrust: upper back braced on a bench, a padded barbell across your hips.",
            "Driving your hips up to a straight line from shoulders to knees.",
            "Lets you load far more weight than a dumbbell or bodyweight version.",
        ],
    },
    "Glute Bridge": {
        "emoji": "🍑",
        "description": [
            "Lying on the floor with your knees bent.",
            "Drive your hips up by squeezing your glutes until your body forms a straight line from shoulders to knees.",
            "The floor-based, bodyweight-friendly version of a hip thrust.",
        ],
    },
    "Hip Abduction Machine": {
        "emoji": "🍑",
        "description": [
            "Seated on the machine.",
            "Push your knees outward against the pad resistance.",
            "Focusing on your outer glutes rather than jerking the weight with momentum.",
        ],
    },
    "Hip Adduction Machine": {
        "emoji": "🍑",
        "description": [
            "Seated on the machine.",
            "Squeeze your knees inward against the pad resistance.",
            "Targeting your inner thighs with a slow, controlled motion.",
        ],
    },
    "Calf Raise": {
        "emoji": "🦶",
        "description": [
            "Standing with the balls of your feet on a raised edge, rise as high onto your toes as possible.",
            "Pause.",
            "Lower your heels below the step for a full stretch.",
            "Avoid bouncing at the bottom.",
        ],
    },
    "Seated Calf Raise": {
        "emoji": "🦶",
        "description": [
            "Seated with weight across your knees.",
            "Raise your heels by pressing through the balls of your feet.",
            "The seated position emphasizes a different part of the calf than a standing raise.",
        ],
    },
    "Sissy Squat": {
        "emoji": "🦵",
        "description": [
            "Rising onto your toes.",
            "Lean back and bend your knees while keeping your hips extended and body in a straight line.",
            "Lowering as far as balance and strength allow.",
            "An advanced, quad-isolation squat variation.",
        ],
    },
    "Pistol Squat": {
        "emoji": "🦵",
        "description": [
            "A single-leg squat with your other leg extended straight out in front.",
            "Lower under control until your hips are near your heel.",
            "Drive back up; an advanced bodyweight move that needs real ankle mobility and balance before loading it further.",
        ],
    },
    # ---------- Core ----------
    "Plank": {
        "emoji": "🧘",
        "description": [
            "Hold a straight line from your head to your heels, supported on your forearms and toes.",
            "Keeping your hips level.",
            "Squeeze your glutes and abs so your lower back doesn't sag.",
        ],
    },
    "Side Plank": {
        "emoji": "🧘",
        "description": [
            "Balanced on one forearm and the side of one foot.",
            "Keep your body in a straight line from head to feet without letting your hips drop toward the floor.",
        ],
    },
    "Crunch": {
        "emoji": "🌀",
        "description": [
            "Lying on your back with knees bent.",
            "Curl your shoulders up off the floor using your abs.",
            "Keeping your lower back pressed down.",
            "Avoid pulling on your neck with your hands.",
        ],
    },
    "Bicycle Crunch": {
        "emoji": "🌀",
        "description": [
            "Lying on your back, hands behind your head.",
            "Bring one elbow toward the opposite knee while extending the other leg out.",
            "Switch sides in a smooth pedaling motion.",
            "Twist from your ribs, not by yanking on your neck.",
        ],
    },
    "Cable Crunch": {
        "emoji": "🌀",
        "description": [
            "Kneeling below a high cable.",
            "Curl your torso down by rounding your spine and bringing your elbows toward your knees.",
            "Using your abs rather than pulling with your arms.",
        ],
    },
    "Sit-Up": {
        "emoji": "🌀",
        "description": [
            "Lying on your back with knees bent and feet anchored.",
            "Curl your entire torso up until you're sitting upright.",
            "Lower back down under control.",
        ],
    },
    "V-Up": {
        "emoji": "🌀",
        "description": [
            "Lying flat, simultaneously raise your straight legs and straight arms to meet in a V-shape above your hips.",
            "Lower back down under control.",
            "A harder, full-range alternative to a standard sit-up.",
        ],
    },
    "Hanging Leg Raise": {
        "emoji": "🦵",
        "description": [
            "Hanging from a bar.",
            "Raise your legs (bent or straight) up toward your chest using your abs, avoiding swinging your body to generate momentum.",
            "Lower back down slowly rather than dropping your legs.",
        ],
    },
    "Ab Wheel Rollout": {
        "emoji": "🎡",
        "description": [
            "Kneeling and gripping the wheel, roll it forward as far as you can while keeping your core braced and back flat.",
            "Pull back to the start using your abs.",
            "Stop before your lower back starts to sag.",
        ],
    },
    "Cable Woodchopper": {
        "emoji": "🪓",
        "description": [
            "Pull a cable diagonally across your body, from high to low or low to high.",
            "Rotating through your torso while keeping your hips relatively stable.",
            "Mimics a chopping motion.",
            "Targeting your obliques.",
        ],
    },
    "Russian Twist": {
        "emoji": "🌀",
        "description": [
            "Seated with your torso leaned back and feet either on the floor or lifted.",
            "Rotate a weight from side to side, touching it near the floor on each side.",
            "Control the rotation rather than using momentum to fling it.",
        ],
    },
    "Dead Bug": {
        "emoji": "🐞",
        "description": [
            "Lying on your back with arms and legs in the air, slowly extend one arm and the opposite leg toward the floor while keeping your lower back pressed flat.",
            "Return and switch sides.",
        ],
    },
    "Mountain Climber": {
        "emoji": "⛰️",
        "description": [
            "In a push-up position.",
            "Drive your knees toward your chest one at a time in a running motion.",
            "Keeping your hips low and core braced rather than bouncing your hips up and down.",
        ],
    },
    # ---------- Full body / conditioning ----------
    "Kettlebell Swing": {
        "emoji": "🔔",
        "description": [
            "Hinge at your hips to swing the kettlebell back between your legs.",
            "Snap your hips forward explosively to drive it up to chest height.",
            "This is a hip-hinge power move, not a shoulder-lifting move.",
        ],
    },
    "Farmer's Carry": {
        "emoji": "🧳",
        "description": [
            "Hold a heavy weight in each hand and walk for distance or time.",
            "Keeping your shoulders back and core braced.",
            "Simple in concept, but a great full-body grip and stability builder.",
        ],
    },
    "Thruster": {
        "emoji": "🏋️",
        "description": [
            "Combine a front squat with an overhead press.",
            "Squat down.",
            "Use the upward momentum from standing back up to drive the weight straight overhead in one fluid motion.",
        ],
    },
    "Burpee": {
        "emoji": "🤸",
        "description": [
            "Drop into a squat, kick your feet back into a plank, perform a push-up (optional), jump your feet back to your hands.",
            "Explode upward into a jump.",
            "A full-body conditioning move, so prioritize form over speed as fatigue builds.",
        ],
    },
    "Devil Press": {
        "emoji": "🤸",
        "description": [
            "A burpee with a dumbbell in each hand: burpee down.",
            "As you stand back up swing both dumbbells from the floor to overhead in one motion (like a two-arm kettlebell swing to snatch).",
            "A brutal full-body HYROX/hybrid conditioning staple.",
        ],
    },
    "Clean and Jerk": {
        "emoji": "🏋️",
        "description": [
            "An advanced Olympic lift: explosively pull the bar from the floor to your shoulders (the clean).",
            "Drive it overhead with a leg-drive dip (the jerk).",
            "This technical lift is best learned from a coach in person before loading it heavily.",
        ],
    },
    "Snatch": {
        "emoji": "🏋️",
        "description": [
            "An advanced Olympic lift that pulls the bar from the floor straight overhead in one continuous motion.",
            "Catching it in a deep squat.",
            "Like the clean and jerk, this is a highly technical movement best learned under direct coaching first.",
        ],
    },
    "Wall Ball Shot": {
        "emoji": "🏐",
        "description": [
            "Holding a medicine ball at your chest, squat down.",
            "Stand up explosively and throw the ball to a target on the wall above you.",
            "Catching it on the way back down into the next squat.",
            "A HYROX staple that blends leg power with shoulder endurance.",
        ],
    },
    "Sled Push": {
        "emoji": "🛷",
        "description": [
            "Load a weighted sled and drive it forward across the floor with both hands.",
            "Staying low with your shins angled forward.",
            "Push through your whole foot, not just your toes.",
            "Keep your arms mostly locked out.",
        ],
    },
    "Sled Pull": {
        "emoji": "🛷",
        "description": [
            "Attach a rope or straps to a loaded sled and pull it toward you hand-over-hand (or walk backward dragging it).",
            "Keep your core braced and your pulls steady rather than jerky.",
        ],
    },
    "Box Jump Over": {
        "emoji": "📦",
        "description": [
            "Jump onto a box.",
            "Step or jump down the other side (rather than jumping back off the way you came).",
            "A continuous-conditioning variation of a box jump used in HYROX-style workouts; land soft and reset your balance before the next rep.",
        ],
    },
    "Rowing Machine Intervals": {
        "emoji": "🚣",
        "description": [
            "Alternate hard, fast rowing efforts with easier recovery pacing on a rowing machine.",
            "Drive with your legs first.",
            "Lean back and pull with your arms, reversing the order on the way back up the slide.",
        ],
    },
    "Assault Bike Intervals": {
        "emoji": "🚴",
        "description": [
            "Alternate hard, fast sprints with easier recovery pacing on an air/fan bike, pushing and pulling with your arms as well as pedaling.",
            "The fan resistance scales with your effort, so pacing is entirely up to you.",
        ],
    },
    # ---------- Mobility / flexibility ----------
    "World's Greatest Stretch": {
        "emoji": "🧘",
        "description": [
            "From a deep lunge, plant both hands inside your front foot.",
            "Rotate your torso and reach that same-side arm toward the ceiling while keeping your back leg straight.",
            "Flows through hip, hamstring, and thoracic mobility in one move.",
        ],
    },
    "Cat-Cow Stretch": {
        "emoji": "🐈",
        "description": [
            "On hands and knees, alternate between arching your back and dropping your belly (cow) and rounding your spine toward the ceiling while tucking your chin (cat).",
            "Move slowly with your breath to mobilize the whole spine.",
        ],
    },
    "Thoracic Spine Rotation": {
        "emoji": "🔄",
        "description": [
            "On hands and knees or in a side-lying position, place one hand behind your head and rotate that elbow up toward the ceiling, following it with your eyes.",
            "Isolate the rotation in your upper back rather than your hips.",
        ],
    },
    "90/90 Hip Stretch": {
        "emoji": "🧘",
        "description": [
            "Sit with your front leg bent 90° in front of you and your back leg bent 90° to the side, both knees on the ground.",
            "Lean your torso forward over the front shin.",
            "Switch sides to work internal and external hip rotation.",
        ],
    },
    "Deep Squat Hold": {
        "emoji": "🏋️",
        "description": [
            "Lower into the bottom of a bodyweight squat with your heels flat and chest up.",
            "Hold the position for time.",
            "Using your elbows to gently press your knees outward.",
            "Builds ankle, hip, and lower-back mobility over time.",
        ],
    },
    "Cossack Squat": {
        "emoji": "🤸",
        "description": [
            "From a wide stance.",
            "Shift your weight into one bent leg while keeping the other leg straight with its foot flat, sinking as low as comfortable.",
            "Push back to center and repeat on the other side.",
            "A lateral squat that opens the hips and inner thighs.",
        ],
    },
    "Hip Flexor Stretch": {
        "emoji": "🧘",
        "description": [
            "From a half-kneeling lunge position, tuck your pelvis under and gently shift your weight forward until you feel a stretch in the front of the rear hip.",
            "Keep your torso upright rather than leaning forward to increase the range.",
        ],
    },
    "Pigeon Pose": {
        "emoji": "🕊️",
        "description": [
            "From a plank or tabletop position.",
            "Bring one knee forward and place it behind your wrist with that shin angled across your body.",
            "Extend the back leg straight behind you and fold forward over the front leg.",
            "A deep hip and glute stretch.",
        ],
    },
    "Downward Dog": {
        "emoji": "🐕",
        "description": [
            "From hands and knees.",
            "Lift your hips up and back to form an inverted V.",
            "Pressing your heels toward the floor and your chest toward your thighs.",
            "Stretches the hamstrings, calves, and shoulders together.",
        ],
    },
    "Shoulder Dislocates": {
        "emoji": "🔄",
        "description": [
            "Holding a light band or stick with a wide overhand grip.",
            "Raise it overhead and rotate it behind your back until it reaches your glutes.",
            "Reverse.",
            "Keep your arms straight throughout and only go as wide as your shoulders allow without pain.",
        ],
    },
    "Arm Circles": {
        "emoji": "🔄",
        "description": [
            "Extend your arms straight out to the sides and make small, controlled circles, gradually increasing the size.",
            "Reverse direction.",
            "A simple warm-up move to loosen the shoulder joint before pressing or overhead work.",
        ],
    },
    "Band Pull-Apart": {
        "emoji": "🎗️",
        "description": [
            "Hold a resistance band at chest height with arms extended.",
            "Pull it apart by squeezing your shoulder blades together.",
            "Keeping your arms straight the whole time.",
            "Targets the rear delts and upper back for better shoulder posture.",
        ],
    },
    "Wall Slides": {
        "emoji": "🧱",
        "description": [
            "Stand with your back, head, and arms pressed against a wall in a goalpost position.",
            "Slide your arms up overhead and back down while keeping every point of contact on the wall.",
            "Improves overhead shoulder mobility and scapular control.",
        ],
    },
    "Leg Swings": {
        "emoji": "🦵",
        "description": [
            "Holding onto something for balance.",
            "Swing one leg forward and back in a controlled arc.",
            "Switch to side-to-side swings.",
            "A dynamic hip mobility warm-up, best done before squats or running rather than as a static hold.",
        ],
    },
    "Walking Knee Hug": {
        "emoji": "🦵",
        "description": [
            "Step forward.",
            "Pull one knee up toward your chest with both hands and hold briefly.",
            "Step through into the next stride and repeat on the other leg.",
            "A dynamic hip and glute stretch that doubles as a warm-up walk.",
        ],
    },
    "Spiderman Lunge with Reach": {
        "emoji": "🧘",
        "description": [
            "Step into a deep lunge with your hand on the ground inside your front foot.",
            "Rotate and reach the opposite arm toward the ceiling, following it with your eyes.",
            "Combines a hip flexor stretch with thoracic rotation.",
        ],
    },
    "Standing Quad Stretch": {
        "emoji": "🦵",
        "description": [
            "Balancing on one leg, grab your other ankle behind you and pull your heel toward your glutes while keeping your knees close together and hips pushed slightly forward.",
            "Hold and switch sides.",
        ],
    },
    "Ankle Mobility Drill": {
        "emoji": "🦶",
        "description": [
            "In a half-kneeling position.",
            "Drive your front knee forward over your toes while keeping your heel flat on the ground, repeating for reps.",
            "Builds the ankle range of motion needed for a deeper, safer squat.",
        ],
    },
    "Scorpion Stretch": {
        "emoji": "🦂",
        "description": [
            "Lie face down with arms out to the sides.",
            "Lift one leg and rotate your hips to bring that foot toward the opposite hand.",
            "Keeping your chest on the floor.",
            "A dynamic stretch for the hips and lower back.",
        ],
    },
    "Foam Rolling": {
        "emoji": "🧻",
        "description": [
            "Slowly roll the target muscle group over a foam roller.",
            "Pausing on tender spots for 20-30 seconds rather than rushing across them.",
            "Used as a warm-up or recovery tool to reduce muscle tightness before or after training.",
        ],
    },
    # ---------- Athletic / Speed & Agility ----------
    "Sprint Starts": {
        "emoji": "🏃",
        "description": [
            "From a standing or three-point start, explode into a 10-20m sprint at maximum effort.",
            "Focusing on a strong first-step drive and gradual rise out of your low body position.",
            "Rest fully between reps since this trains raw acceleration, not endurance.",
        ],
    },
    "Flying Sprints": {
        "emoji": "🏃",
        "description": [
            "Build up speed over 20-30m before hitting a marked \"fly zone,\" then sprint that zone at top speed.",
            "Trains maximum velocity mechanics rather than the acceleration phase, since you're already at speed when the timed section starts.",
        ],
    },
    "Hill Sprints": {
        "emoji": "⛰️",
        "description": [
            "Sprint uphill at maximum effort for 10-20 seconds.",
            "Walk back down to recover fully before the next rep.",
            "The incline forces powerful hip and knee drive while naturally limiting impact stress compared to flat-ground sprinting.",
        ],
    },
    "Resisted Sprint (Sled Push)": {
        "emoji": "🛷",
        "description": [
            "Load a sled with a moderate weight and push it forward in short, explosive sprint bursts.",
            "Staying low with strong leg drive.",
            "Builds sprint-specific power without the technical demands of loaded barbell lifts.",
        ],
    },
    "Sled Drag": {
        "emoji": "🛷",
        "description": [
            "Attach a sled to a harness or rope and drag it forward or backward for distance at a steady pace.",
            "A joint-friendly way to build work capacity and leg drive strength with minimal eccentric muscle damage.",
        ],
    },
    "Box Jump": {
        "emoji": "📦",
        "description": [
            "From a quarter-squat position.",
            "Swing your arms and jump onto a box.",
            "Landing softly with bent knees.",
            "Step back down (don't jump down).",
            "Focus on landing quietly and under control rather than jumping the highest box available.",
        ],
    },
    "Depth Jump": {
        "emoji": "📦",
        "description": [
            "Step off a low box, land on both feet, and immediately explode into a maximal vertical jump the instant you touch the ground.",
            "An advanced reactive-power drill; keep the ground contact time as short as possible.",
        ],
    },
    "Broad Jump": {
        "emoji": "🤸",
        "description": [
            "From a two-foot stance.",
            "Swing your arms back then forward and jump as far horizontally as you can.",
            "Landing softly in a controlled squat.",
            "Measure your distance to track progress in horizontal power output.",
        ],
    },
    "Lateral Bound": {
        "emoji": "🤸",
        "description": [
            "Push off one leg explosively to jump sideways.",
            "Landing softly on the opposite leg and holding the landing for a moment before repeating back the other way.",
            "Builds the single-leg lateral power used in cutting and direction changes.",
        ],
    },
    "Single-Leg Bound": {
        "emoji": "🤸",
        "description": [
            "Hop forward repeatedly on one leg.",
            "Driving your opposite knee up for momentum and absorbing each landing before immediately springing into the next bound.",
            "A demanding single-leg power and stability drill.",
        ],
    },
    "Agility Ladder Drills": {
        "emoji": "🪜",
        "description": [
            "Run through footwork patterns (e.g. two-feet-in-each-box, lateral shuffles, in-and-outs) through a flat agility ladder on the ground.",
            "Prioritize quick, precise foot placement over raw speed at first.",
            "Build up pace.",
        ],
    },
    "Cone Shuttle Run": {
        "emoji": "🚩",
        "description": [
            "Sprint between two or more cones set a fixed distance apart, decelerating and changing direction sharply at each one.",
            "Trains the deceleration and re-acceleration mechanics that matter more in sport than straight-line speed alone.",
        ],
    },
    "5-10-5 Pro Agility Drill": {
        "emoji": "🚩",
        "description": [
            "Starting at a middle cone, sprint 5 yards to one side, touch the line, sprint 10 yards to the far cone, touch that line.",
            "Sprint 5 yards back through the start.",
            "A standard test/drill for change-of-direction speed.",
        ],
    },
    "T-Drill": {
        "emoji": "🚩",
        "description": [
            "Sprint forward to a cone, shuffle laterally to a second cone, shuffle across to a third, shuffle back to the second.",
            "Backpedal to the start.",
            "A classic drill combining forward sprinting, lateral shuffling, and backpedaling.",
        ],
    },
    "Reactive Ball Drop Drill": {
        "emoji": "🎾",
        "description": [
            "Have a partner drop a ball (or reaction ball) from shoulder height without warning while you stand ready a few feet away, and react to catch it before its second bounce.",
            "Trains reaction time and first-step quickness.",
        ],
    },
    "Medicine Ball Rotational Throw": {
        "emoji": "🏐",
        "description": [
            "Stand side-on to a wall, load your hips by rotating away from it.",
            "Explosively rotate through your core and throw the medicine ball into the wall.",
            "A rotational power move that carries over well to throwing and striking sports.",
        ],
    },
    "Medicine Ball Chest Pass": {
        "emoji": "🏐",
        "description": [
            "Hold the medicine ball at chest height and explosively push/throw it forward into a wall or to a partner.",
            "Catching the rebound and resetting.",
            "Trains upper-body explosive power in a pushing pattern.",
        ],
    },
    "Medicine Ball Slam": {
        "emoji": "🏐",
        "description": [
            "Raise the medicine ball overhead.",
            "Explosively slam it into the ground as hard as possible by driving through your hips and core.",
            "Catching the bounce or picking it back up to reset.",
            "A full-body power and conditioning move.",
        ],
    },
    "Jump Rope": {
        "emoji": "🪢",
        "description": [
            "Jump rope with small, quick hops off the balls of your feet and minimal knee bend.",
            "Keeping the rope turn coming from your wrists rather than your whole arm.",
            "Builds calf/ankle stiffness and rhythm useful for sprinting and change of direction.",
        ],
    },
    "High Knees": {
        "emoji": "🏃",
        "description": [
            "Run in place (or move forward slowly) driving your knees up to hip height as quickly as possible.",
            "Staying on the balls of your feet.",
            "A sprint-mechanics drill for quick ground contact and knee drive.",
        ],
    },
    "Butt Kicks": {
        "emoji": "🏃",
        "description": [
            "Jog in place or forward, kicking your heels up to touch your glutes on each stride.",
            "A running-mechanics drill that emphasizes fast hamstring recoil, complementary to High Knees.",
        ],
    },
    "A-Skip": {
        "emoji": "🏃",
        "description": [
            "Skip forward driving one knee up to hip height with a quick, punchy ground contact on the opposite foot, alternating sides.",
            "A foundational sprint-drill teaching proper knee drive and posture at low speed.",
        ],
    },
    "B-Skip": {
        "emoji": "🏃",
        "description": [
            "Same knee-drive skip as an A-Skip.",
            "Extend the raised leg out and \"claw\" it back down and under your body before it lands.",
            "Teaches the active ground-strike mechanics used in top-speed sprinting.",
        ],
    },
    "Bounding": {
        "emoji": "🤸",
        "description": [
            "Run with exaggerated, powerful strides.",
            "Driving off each leg to cover as much ground as possible per step and hang in the air momentarily.",
            "A running-specific power drill that bridges jump training and sprinting.",
        ],
    },
    "Plyo Push-Up": {
        "emoji": "🤸",
        "description": [
            "Perform a push-up explosively enough that your hands leave the ground at the top.",
            "Landing softly with bent elbows to absorb the impact before the next rep.",
            "Builds upper-body explosive pushing power.",
        ],
    },
    "Squat Jump": {
        "emoji": "🤸",
        "description": [
            "From a quarter or half squat, jump straight up as high as possible and land softly back into the squat position, resetting before the next rep.",
            "A foundational lower-body power exercise with no eccentric \"catch\" of a box.",
        ],
    },
    "Tuck Jump": {
        "emoji": "🤸",
        "description": [
            "Jump straight up and pull both knees up toward your chest at the peak of the jump.",
            "Land softly and immediately reset.",
            "Emphasizes rapid hip flexion and reactive power in a short ground-contact time.",
        ],
    },
    "Lateral Skater Jump": {
        "emoji": "🤸",
        "description": [
            "Push off one leg to leap sideways like a speed skater.",
            "Landing softly on the opposite leg while the trailing leg swings behind for balance.",
            "Immediately bound back the other way.",
            "Builds lateral power and single-leg control together.",
        ],
    },
    # ---------- Functional / Real-World Strength ----------
    "Suitcase Carry": {
        "emoji": "🧳",
        "description": [
            "Carry a single heavy weight in one hand at your side, like a suitcase, walking tall without letting your torso lean toward the loaded side.",
            "Trains anti-lateral-flexion core strength and real-world one-handed carrying capacity.",
        ],
    },
    "Overhead Carry": {
        "emoji": "🧳",
        "description": [
            "Press a weight overhead and walk with it locked out above your shoulder.",
            "Keeping your ribs down and core braced so your lower back doesn't arch.",
            "Builds shoulder stability and overhead strength endurance together.",
        ],
    },
    "Sandbag Carry": {
        "emoji": "🎒",
        "description": [
            "Hug or shoulder a loaded sandbag and walk for distance or time, resetting your grip/position as needed since the sand shifts unlike a fixed weight.",
            "The shifting load adds a real-world stabilization demand machines don't replicate.",
        ],
    },
    "Sandbag Clean": {
        "emoji": "🎒",
        "description": [
            "Hinge down to grip the sandbag.",
            "Explosively extend your hips and pull it up to your chest/shoulder in one motion.",
            "Using your legs and hips rather than your lower back.",
            "Mirrors the real-world motion of picking something heavy up off the floor.",
        ],
    },
    "Sandbag Shouldering": {
        "emoji": "🎒",
        "description": [
            "Deadlift the sandbag up to your thighs.",
            "Use hip drive and momentum to heave it up and over onto one shoulder.",
            "Catching it with bent knees.",
            "A practical strength-and-power move for lifting awkward, heavy objects.",
        ],
    },
    "Zercher Carry": {
        "emoji": "🎒",
        "description": [
            "Cradle a weight in the crooks of your elbows against your torso and walk with it.",
            "Keeping your chest up and core tight against the front-loaded position.",
            "Builds the upper-back and core strength needed to hold something bulky close to your body.",
        ],
    },
    "Yoke Walk": {
        "emoji": "🚶",
        "description": [
            "Step under a loaded yoke frame resting across your upper back (like a heavy squat position).",
            "Lift it off the rack, and walk it forward for distance.",
            "Trains total-body loaded carrying strength under a heavier axial load than hand carries.",
        ],
    },
    "Turkish Get-Up": {
        "emoji": "🧎",
        "description": [
            "Starting lying on your back holding a weight locked out overhead, move through a series of controlled steps.",
            "Roll to an elbow, to a hand, bridge the hips.",
            "Sweep the leg through.",
            "Stand up.",
            "All while keeping the weight overhead; go slow and light while learning the sequence.",
        ],
    },
    "Bear Crawl": {
        "emoji": "🐻",
        "description": [
            "On hands and feet with knees hovering just off the ground, crawl forward moving opposite hand and foot together.",
            "Keeping your hips low and back flat.",
            "Builds full-body coordination, shoulder stability, and core control.",
        ],
    },
    "Crawling Drill": {
        "emoji": "🐻",
        "description": [
            "Move slowly across the floor on hands and knees or hands and feet in varied patterns (forward, backward, lateral).",
            "Keeping your core braced and movements controlled.",
            "Used as a warm-up or restorative full-body coordination drill.",
        ],
    },
    "Sit-to-Stand": {
        "emoji": "🪑",
        "description": [
            "From a seated position on a chair or bench.",
            "Stand up fully without using your hands for assistance if possible.",
            "Sit back down under control.",
            "A direct, functional test and builder of the leg strength needed for everyday standing/sitting.",
        ],
    },
    "Floor-to-Stand Get-Up": {
        "emoji": "🧎",
        "description": [
            "Practice getting up from lying on the floor to standing using different strategies (rolling to a kneel, half-kneeling to stand) without always using the same hand/leg.",
            "Builds the practical strength and coordination to get up off the ground unassisted.",
        ],
    },
    "Loaded Stair Climb": {
        "emoji": "🪜",
        "description": [
            "Carry a weighted backpack, sandbag, or dumbbells while walking up and down a flight of stairs for time or reps.",
            "A practical way to train the leg strength and cardiovascular capacity needed for carrying loads up real stairs.",
        ],
    },
    "Tire Flip": {
        "emoji": "🛞",
        "description": [
            "Squat down to get your hands under a large tire.",
            "Drive through your legs and hips to flip it up and over.",
            "Reset and repeat.",
            "A full-body power move that mimics lifting and repositioning heavy, awkward objects.",
        ],
    },
    "Deadlift to Shoulder (Sandbag)": {
        "emoji": "🎒",
        "description": [
            "Deadlift a sandbag off the floor.",
            "In one continuous motion use hip drive to bring it up and rest it on one shoulder.",
            "Combines a hip-hinge pull with a loaded carry setup, directly useful for lifting and repositioning heavy bags or people.",
        ],
    },
    "Zercher Squat": {
        "emoji": "🏋️",
        "description": [
            "Cradle the bar or weight in the crooks of your elbows in front of your chest.",
            "Squat down and back up keeping your torso as upright as possible.",
            "The front-loaded position builds serious core and upper-back strength alongside your legs.",
        ],
    },
    "Suitcase Deadlift": {
        "emoji": "🧳",
        "description": [
            "Deadlift a single weight positioned at your side (like a suitcase) rather than centered.",
            "Keeping your torso from tipping toward the load.",
            "Trains unilateral pulling strength and anti-lateral-flexion core stability at once.",
        ],
    },
    "Single-Arm Farmer's Carry": {
        "emoji": "🧳",
        "description": [
            "Carry a heavy weight in just one hand while walking tall and resisting the pull to lean or shrug toward that side.",
            "A more demanding core and grip challenge than carrying weight in both hands.",
        ],
    },
    "Wheelbarrow Carry": {
        "emoji": "🧑‍🤝‍🧑",
        "description": [
            "One partner holds another's ankles while the second walks forward on their hands.",
            "A classic partner drill for shoulder stability, core control, and upper-body carrying strength; go slow on an even surface.",
        ],
    },
    "Log Press": {
        "emoji": "🪵",
        "description": [
            "Clean a thick log implement to your chest.",
            "Press it overhead using leg drive to help initiate the movement.",
            "The thick, neutral grip and shifting weight distribution make this a more real-world pressing pattern than a barbell.",
        ],
    },
    "Atlas Stone Lift": {
        "emoji": "🪨",
        "description": [
            "Hug a heavy, round stone against your body.",
            "Lift it off the ground using your legs and hips, and load it onto a platform.",
            "An advanced strongman movement that trains raw lifting strength for oddly-shaped, heavy objects.",
        ],
    },
    "Keg Carry": {
        "emoji": "🛢️",
        "description": [
            "Hug a loaded keg (or similarly bulky, shifting-weight object) against your chest and walk for distance.",
            "Keeping your core braced against the awkward load.",
            "Builds the bear-hug carrying strength useful for moving bulky household items.",
        ],
    },
    # ---------- Balance & Stability ----------
    "Single-Leg Balance Hold": {
        "emoji": "🧘",
        "description": [
            "Stand on one leg and hold your balance for time.",
            "Keeping your standing knee soft and core engaged.",
            "Progress by closing your eyes or standing on an unstable surface once flat-ground holds feel easy.",
        ],
    },
    "Single-Leg Romanian Deadlift": {
        "emoji": "🦵",
        "description": [
            "Standing on one leg.",
            "Hinge at the hips and lower a weight toward the floor while your free leg extends straight behind you for counterbalance.",
            "Return to standing.",
            "Trains hamstring/glute strength and balance together.",
        ],
    },
    "Bosu Ball Squat": {
        "emoji": "🌀",
        "description": [
            "Stand on the flat or dome side of a Bosu ball and perform a bodyweight squat.",
            "Using the instability to challenge your ankle and knee stabilizers.",
            "Go light on load and focus on control rather than depth or speed.",
        ],
    },
    "Bosu Ball Balance Hold": {
        "emoji": "🌀",
        "description": [
            "Stand on top of a Bosu ball (dome side down) and hold your balance, making small constant adjustments through your ankles and hips.",
            "A foundational stability drill before adding movement on an unstable surface.",
        ],
    },
    "Single-Leg Box Step-Down": {
        "emoji": "🦵",
        "description": [
            "Stand on a low box on one leg.",
            "Slowly lower your other foot to lightly tap the ground before returning to standing, without letting your standing knee cave inward.",
            "Trains eccentric single-leg control, a key piece of injury-resistant knees.",
        ],
    },
    "Tandem Stance Hold": {
        "emoji": "🧘",
        "description": [
            "Stand with one foot directly in front of the other, heel-to-toe, and hold the position for time.",
            "A simple, low-equipment balance drill that gets harder with eyes closed or on a softer surface.",
        ],
    },
    "Heel-to-Toe Walk": {
        "emoji": "🚶",
        "description": [
            "Walk forward in a straight line placing the heel of one foot directly against the toes of the other with each step.",
            "A dynamic balance drill that also doubles as a basic coordination/sobriety-style test.",
        ],
    },
    "Single-Leg Deadlift Reach": {
        "emoji": "🦵",
        "description": [
            "Standing on one leg.",
            "Hinge forward and reach one or both hands toward the floor while your free leg lifts straight behind you.",
            "Return to standing.",
            "A bodyweight balance-and-hamstring drill, a lighter regression of the loaded single-leg RDL.",
        ],
    },
    "Stability Ball Plank": {
        "emoji": "🏐",
        "description": [
            "Hold a forearm plank with your forearms resting on a stability ball instead of the floor, bracing your core to keep the ball from rolling.",
            "The unstable base demands more core control than a standard plank.",
        ],
    },
    "Stability Ball Hamstring Curl": {
        "emoji": "🏐",
        "description": [
            "Lying on your back with heels on a stability ball.",
            "Lift your hips up.",
            "Bend your knees to roll the ball toward your glutes and back out.",
            "Trains hamstrings and core stability against the ball's instability.",
        ],
    },
    "Single-Leg Glute Bridge": {
        "emoji": "🦵",
        "description": [
            "Lying on your back with one foot planted and the other leg extended straight.",
            "Drive through the planted heel to lift your hips up.",
            "Squeezing your glute at the top.",
            "Isolates one side at a time and exposes side-to-side strength differences.",
        ],
    },
    "Balance Beam Walk": {
        "emoji": "🤸",
        "description": [
            "Walk heel-to-toe along a low balance beam (or a taped line on the floor as a regression).",
            "Keeping your eyes forward rather than looking down at your feet.",
            "Trains dynamic balance and postural control while moving.",
        ],
    },
    "Slackline Balance": {
        "emoji": "🎪",
        "description": [
            "Stand and balance on a slackline anchored low to the ground between two points.",
            "Using small ankle and hip adjustments to stay centered.",
            "An advanced, highly engaging balance challenge; start near a wall or support to catch yourself.",
        ],
    },
    "Single-Leg Hop and Stick": {
        "emoji": "🤸",
        "description": [
            "Hop forward on one leg and land softly.",
            "Holding the landing completely still (\"sticking\" it) for a couple seconds before the next hop.",
            "Trains the deceleration and landing control that protects knees during sport.",
        ],
    },
    "Wobble Board Balance": {
        "emoji": "🌀",
        "description": [
            "Stand on a wobble board and work to keep it level and stable, making constant small corrections through your ankles.",
            "Commonly used in ankle-injury rehab and general proprioception training.",
        ],
    },
    "Pallof Press": {
        "emoji": "🎗️",
        "description": [
            "Holding a cable or band at chest height, anchored to your side.",
            "Press it straight out in front of you and hold.",
            "The cable pulls you to rotate, and resisting that pull (not creating movement) is the entire point of the exercise, training anti-rotation core strength.",
        ],
    },
    "Standing Y-Balance Reach": {
        "emoji": "🧘",
        "description": [
            "Standing on one leg.",
            "Reach your free leg out in front, then to the side, then behind you in a Y-shaped pattern, while keeping your standing leg stable.",
            "Switch sides.",
            "A common screening and training drill for single-leg balance and control.",
        ],
    },
    # ---------- Prenatal / Low-Impact ----------
    "Prenatal Cat-Cow Stretch": {
        "emoji": "🐈",
        "description": [
            "On hands and knees, gently arch and round your back with your breath.",
            "Keeping the movement small and pain-free.",
            "Relieves lower-back tension and is considered safe throughout pregnancy; stop if you feel any pulling discomfort.",
        ],
    },
    "Pelvic Tilt": {
        "emoji": "🧘",
        "description": [
            "Standing or on hands and knees, gently tuck your pelvis under and flatten your lower back.",
            "Release back to neutral.",
            "Builds core awareness and can ease pregnancy-related lower-back pain; keep the motion slow and controlled.",
        ],
    },
    "Kegel Exercise": {
        "emoji": "🧘",
        "description": [
            "Contract the pelvic floor muscles (as if stopping the flow of urine) and hold briefly before releasing, repeating for reps.",
            "Supports pelvic floor strength during and after pregnancy; can be done seated, standing, or lying down.",
        ],
    },
    "Bird Dog": {
        "emoji": "🐕",
        "description": [
            "On hands and knees.",
            "Extend one arm and the opposite leg straight out while keeping your hips and shoulders level and core braced.",
            "Return and switch sides.",
            "Builds core stability without any spinal loading, making it a safe option through pregnancy.",
        ],
    },
    "Wall Push-Up": {
        "emoji": "🧱",
        "description": [
            "Stand facing a wall with hands shoulder-width apart on it.",
            "Bend your elbows to bring your chest toward the wall and press back out.",
            "A lower-intensity, upright pushing exercise that avoids lying face-down.",
        ],
    },
    "Seated Row (Band)": {
        "emoji": "🎗️",
        "description": [
            "Sitting with legs extended and a band looped around your feet.",
            "Pull the handles toward your torso while squeezing your shoulder blades together.",
            "Extend back out with control.",
            "A joint-friendly way to train the back and posture.",
        ],
    },
    "Standing Band Row": {
        "emoji": "🎗️",
        "description": [
            "Anchor a band at chest height.",
            "Step back to create tension.",
            "Pull the band toward your torso squeezing your shoulder blades together.",
            "A low-impact, standing alternative to seated cable or barbell rows.",
        ],
    },
    "Side-Lying Leg Lift": {
        "emoji": "🦵",
        "description": [
            "Lying on your side with your body in a straight line.",
            "Lift your top leg up toward the ceiling with control.",
            "Lower it back down without letting it rest.",
            "Targets the hip and outer glute with no spinal loading, comfortable in most trimesters.",
        ],
    },
    "Side-Lying Clam Shell": {
        "emoji": "🦵",
        "description": [
            "Lying on your side with knees bent and stacked.",
            "Keep your feet together and lift your top knee open like a clamshell.",
            "Lower with control.",
            "A gentle, targeted hip-stability exercise commonly used in prenatal and postpartum programs.",
        ],
    },
    "Prenatal Squat (Supported)": {
        "emoji": "🪑",
        "description": [
            "Holding onto a sturdy support (chair back, countertop, or wall) for balance, perform a shallow, controlled squat within a comfortable range.",
            "The support reduces balance demands as your center of gravity shifts through pregnancy.",
        ],
    },
    "Chair Squat": {
        "emoji": "🪑",
        "description": [
            "Stand in front of a sturdy chair and lower yourself down to lightly tap it before standing back up.",
            "Using it as a depth guide and safety net.",
            "A beginner-friendly, low-impact way to build leg strength.",
        ],
    },
    "Wall Sit (Light)": {
        "emoji": "🧱",
        "description": [
            "Lean your back against a wall and slide down to a shallow, comfortable knee bend.",
            "Holding the position for a short time.",
            "A static, low-impact way to build leg endurance; keep the angle shallow and stop if you feel strain.",
        ],
    },
    "Standing Bicep Curl (Light Dumbbell)": {
        "emoji": "🏋️",
        "description": [
            "Standing with a light dumbbell in each hand.",
            "Curl the weight up toward your shoulders keeping your elbows pinned to your sides.",
            "Lower with control.",
            "Light-load arm work that's safe and comfortable throughout pregnancy.",
        ],
    },
    "Seated Shoulder Press (Light)": {
        "emoji": "🏋️",
        "description": [
            "Seated with light dumbbells at shoulder height.",
            "Press them straight overhead without arching your lower back.",
            "Lower with control.",
            "The seated position and light load make this a stable, joint-friendly shoulder exercise.",
        ],
    },
    "Prenatal Walking": {
        "emoji": "🚶",
        "description": [
            "Walk at a comfortable, conversational pace for 15-30 minutes, adjusting duration and pace to how you feel that day.",
            "One of the most recommended forms of cardio throughout pregnancy: low-impact, easy to scale, and no special equipment needed.",
        ],
    },
    "Stationary Cycling (Light)": {
        "emoji": "🚴",
        "description": [
            "Ride a stationary bike at a light, comfortable resistance and pace.",
            "Staying well within a conversational effort level.",
            "The fixed, supported position makes this a stable low-impact cardio option, especially as balance shifts later in pregnancy.",
        ],
    },
    "Water Aerobics": {
        "emoji": "🏊",
        "description": [
            "Perform gentle aerobic movements (marching, arm circles, leg swings) while standing in chest-deep water.",
            "The water's buoyancy supports your joints and changing center of gravity while still providing resistance, making it a popular and comfortable prenatal option.",
        ],
    },
    "Prenatal Yoga Flow": {
        "emoji": "🧘",
        "description": [
            "Move through a gentle, pregnancy-modified yoga sequence focused on breath, hip openers, and posture.",
            "Avoids deep twists, prone (face-down) poses, and lying flat on your back for extended periods; a class or instructor-led video is recommended for proper modifications.",
        ],
    },
    "Standing Pelvic Circles": {
        "emoji": "🧘",
        "description": [
            "Standing with feet hip-width apart and hands on your hips, slowly circle your hips in one direction and then the other.",
            "Eases lower-back and pelvic tension and is commonly used to encourage comfortable positioning later in pregnancy.",
        ],
    },
    "Modified Side Plank (Knee Down)": {
        "emoji": "🏐",
        "description": [
            "Lying on your side, prop up on your forearm with your bottom knee bent on the ground for support.",
            "Lift your hips into a shortened side plank.",
            "Trains core and hip stability with a much lower core-pressure demand than a full plank.",
        ],
    },
    "Seated Leg Extension (Light)": {
        "emoji": "🦵",
        "description": [
            "Seated in a chair.",
            "Extend one leg straight out in front of you and hold briefly.",
            "Lower with control and repeat.",
            "Adding a light ankle weight only if comfortable.",
            "A simple, joint-friendly way to maintain quad strength.",
        ],
    },
    "Ankle Pumps": {
        "emoji": "🦶",
        "description": [
            "Seated or lying down.",
            "Flex your feet up and point them down in a slow, controlled pumping motion.",
            "A gentle circulation-boosting movement often recommended during pregnancy (and after long periods of sitting) to help reduce swelling.",
        ],
    },
}

# Fold in the emoji + how-to for the ~300 extra muscle-building exercises
# (extra_exercises.py). Each reuses an emoji already in the palette above,
# or an empty string where nothing genuinely fits, keeping the invariant
# that every WORKOUT_EXERCISES name has an entry here.
from extra_exercises import EXTRA_EXERCISES as _EXTRA_EXERCISES

for _extra in _EXTRA_EXERCISES:
    EXERCISE_DETAILS.setdefault(_extra["name"], {
        "emoji": _extra["emoji"],
        "description": _extra["description"],
    })


def get_exercise_detail(name):
    """Returns {emoji, description} for a known exercise, or a sensible
    generic fallback for anything not in the curated list (e.g. a custom
    day-type exercise a user typed in themselves)."""
    return EXERCISE_DETAILS.get(name, {
        "emoji": "🏋️",
        "description": [
            "Move through a full, controlled range of motion with a steady tempo.",
            "Avoid using momentum or swinging your body to move the weight, and stop a rep or two before your form breaks down.",
        ],
    })
