"""Citations for the health and training information the AI chats give.

App Review rejected 0.12.10 (35) under Guideline 1.4.1 on 2026-10-06: the
AI coach gave health recommendations "without citations, such as links to
sources for this information", and the citations "should be easy for the
user to find". This module is the fix's single source of truth:

  - SOURCES is a fixed, hand-checked catalog. Every PubMed id below was
    looked up on NCBI (esummary) when it was added, and its title here is
    the title NCBI returned. The model never writes a URL -- it can only
    pick ids out of this list -- so a reply cannot cite a study that does
    not exist. Add to the catalog by checking the id the same way.
  - prompt_instruction() is appended to each chatbot's system prompt. It
    asks the model to end its reply with one machine-readable line naming
    the catalog ids that back what it said.
  - attach_sources() strips that line back off the reply and turns it into
    the source objects the client renders under the bubble. When the model
    leaves the line out or names nothing valid, a keyword match on the
    question + reply picks the sources instead, so a health answer is never
    shown bare just because the model forgot the format.

The /sources page (templates/sources.html) lists the whole catalog, so the
same citations are reachable from Settings and from the chat itself.
"""

import re


def _pubmed(pmid):
    return f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"


# Topic order is the order the /sources page shows them in.
TOPICS = [
    ("guidelines", "Physical activity guidelines"),
    ("strength", "Strength training and progression"),
    ("hypertrophy", "Building muscle"),
    ("rest", "Rest between sets"),
    ("protein", "Protein and nutrition"),
    ("fat_loss", "Losing fat without losing muscle"),
    ("recovery", "Recovery and sleep"),
    ("mobility", "Mobility and stretching"),
    ("technique", "Exercise technique"),
    ("supplements", "Supplements and hydration"),
    ("injury", "Pain and injury"),
]

SOURCES = [
    {
        "id": "who_2020",
        "topic": "guidelines",
        "title": "WHO guidelines on physical activity and sedentary behaviour",
        "publisher": "World Health Organization, 2020",
        "url": "https://www.who.int/publications/i/item/9789240015128",
    },
    {
        "id": "pag_2018",
        "topic": "guidelines",
        "title": "Physical Activity Guidelines for Americans, 2nd edition",
        "publisher": "U.S. Department of Health and Human Services, 2018",
        "url": "https://odphp.health.gov/our-work/nutrition-physical-activity/physical-activity-guidelines/current-guidelines",
    },
    {
        "id": "acsm_2011",
        "topic": "guidelines",
        "title": "ACSM position stand: Quantity and quality of exercise for developing and maintaining cardiorespiratory, musculoskeletal, and neuromotor fitness in apparently healthy adults",
        "publisher": "Medicine & Science in Sports & Exercise, 2011",
        "url": _pubmed(21694556),
    },
    {
        "id": "acsm_2009",
        "topic": "strength",
        "title": "ACSM position stand: Progression models in resistance training for healthy adults",
        "publisher": "Medicine & Science in Sports & Exercise, 2009",
        "url": _pubmed(19204579),
    },
    {
        "id": "schoenfeld_loading_2021",
        "topic": "strength",
        "title": "Loading recommendations for muscle strength, hypertrophy, and local endurance: a re-examination of the repetition continuum",
        "publisher": "Sports, 2021",
        "url": _pubmed(33671664),
    },
    {
        "id": "schoenfeld_volume_2017",
        "topic": "hypertrophy",
        "title": "Dose-response relationship between weekly resistance training volume and increases in muscle mass: a systematic review and meta-analysis",
        "publisher": "Journal of Sports Sciences, 2017",
        "url": _pubmed(27433992),
    },
    {
        "id": "schoenfeld_frequency_2016",
        "topic": "hypertrophy",
        "title": "Effects of resistance training frequency on measures of muscle hypertrophy: a systematic review and meta-analysis",
        "publisher": "Sports Medicine, 2016",
        "url": _pubmed(27102172),
    },
    {
        "id": "schoenfeld_rest_2016",
        "topic": "rest",
        "title": "Longer interset rest periods enhance muscle strength and hypertrophy in resistance-trained men",
        "publisher": "Journal of Strength and Conditioning Research, 2016",
        "url": _pubmed(26605807),
    },
    {
        "id": "grgic_rest_2017",
        "topic": "rest",
        "title": "The effects of short versus long inter-set rest intervals in resistance training on measures of muscle hypertrophy: a systematic review",
        "publisher": "European Journal of Sport Science, 2017",
        "url": _pubmed(28641044),
    },
    {
        "id": "issn_protein_2017",
        "topic": "protein",
        "title": "International Society of Sports Nutrition position stand: protein and exercise",
        "publisher": "Journal of the International Society of Sports Nutrition, 2017",
        "url": _pubmed(28642676),
    },
    {
        "id": "morton_protein_2018",
        "topic": "protein",
        "title": "A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults",
        "publisher": "British Journal of Sports Medicine, 2018",
        "url": _pubmed(28698222),
    },
    {
        "id": "helms_2014",
        "topic": "fat_loss",
        "title": "Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation",
        "publisher": "Journal of the International Society of Sports Nutrition, 2014",
        "url": _pubmed(24864135),
    },
    {
        "id": "longland_2016",
        "topic": "fat_loss",
        "title": "Higher compared with lower dietary protein during an energy deficit combined with intense exercise promotes greater lean mass gain and fat mass loss: a randomized trial",
        "publisher": "American Journal of Clinical Nutrition, 2016",
        "url": _pubmed(26817506),
    },
    {
        "id": "garthe_2011",
        "topic": "fat_loss",
        "title": "Effect of two different weight-loss rates on body composition and strength and power-related performance in elite athletes",
        "publisher": "International Journal of Sport Nutrition and Exercise Metabolism, 2011",
        "url": _pubmed(21558571),
    },
    {
        "id": "murphy_deficit_2022",
        "topic": "fat_loss",
        "title": "Energy deficiency impairs resistance training gains in lean mass but not strength: a meta-analysis and meta-regression",
        "publisher": "Scandinavian Journal of Medicine & Science in Sports, 2022",
        "url": _pubmed(34623696),
    },
    {
        "id": "dupuy_recovery_2018",
        "topic": "recovery",
        "title": "An evidence-based approach for choosing post-exercise recovery techniques to reduce markers of muscle damage, soreness, fatigue, and inflammation: a systematic review with meta-analysis",
        "publisher": "Frontiers in Physiology, 2018",
        "url": _pubmed(29755363),
    },
    {
        "id": "aasm_sleep_2015",
        "topic": "recovery",
        "title": "Recommended amount of sleep for a healthy adult: a joint consensus statement of the American Academy of Sleep Medicine and Sleep Research Society",
        "publisher": "Sleep, 2015",
        "url": _pubmed(26039963),
    },
    {
        "id": "behm_stretching_2016",
        "topic": "mobility",
        "title": "Acute effects of muscle stretching on physical performance, range of motion, and injury incidence in healthy active individuals: a systematic review",
        "publisher": "Applied Physiology, Nutrition, and Metabolism, 2016",
        "url": _pubmed(26642915),
    },
    {
        "id": "alizadeh_rom_2023",
        "topic": "mobility",
        "title": "Resistance training induces improvements in range of motion: a systematic review and meta-analysis",
        "publisher": "Sports Medicine, 2023",
        "url": _pubmed(36622555),
    },
    {
        "id": "schoenfeld_squat_2010",
        "topic": "technique",
        "title": "Squatting kinematics and kinetics and their application to exercise performance",
        "publisher": "Journal of Strength and Conditioning Research, 2010",
        "url": _pubmed(20182386),
    },
    {
        "id": "issn_creatine_2017",
        "topic": "supplements",
        "title": "International Society of Sports Nutrition position stand: safety and efficacy of creatine supplementation in exercise, sport, and medicine",
        "publisher": "Journal of the International Society of Sports Nutrition, 2017",
        "url": _pubmed(28615996),
    },
    {
        "id": "issn_caffeine_2021",
        "topic": "supplements",
        "title": "International Society of Sports Nutrition position stand: caffeine and exercise performance",
        "publisher": "Journal of the International Society of Sports Nutrition, 2021",
        "url": _pubmed(33388079),
    },
    {
        "id": "acsm_fluid_2007",
        "topic": "supplements",
        "title": "ACSM position stand: Exercise and fluid replacement",
        "publisher": "Medicine & Science in Sports & Exercise, 2007",
        "url": _pubmed(17277604),
    },
    {
        "id": "nhs_sports_injuries",
        "topic": "injury",
        "title": "Sports injuries: symptoms, treatment and when to get medical help",
        "publisher": "NHS (UK National Health Service)",
        "url": "https://www.nhs.uk/conditions/sports-injuries/",
    },
]

SOURCES_BY_ID = {source["id"]: source for source in SOURCES}

# A reply cites at most this many -- enough to back an answer, few enough
# that the list under a small chat bubble stays readable.
MAX_SOURCES_PER_REPLY = 3

# Keyword fallback: (pattern, source ids). Checked in order against the
# question and the reply together; the first matches win, up to the cap.
# Specific topics come before broad ones so "how long should I rest
# between squat sets" cites the rest-interval studies, not the general
# strength position stand.
_KEYWORD_RULES = [
    (r"\b(pain|hurt|hurts|injur|sprain|strain|tendon|swollen|swelling|doctor|physio)", ["nhs_sports_injuries"]),
    (r"\brest(ing)?\b.*\b(set|sets|between)\b|\bbetween sets\b|\brest (time|period|interval)", ["schoenfeld_rest_2016", "grgic_rest_2017"]),
    (r"\bcreatine\b", ["issn_creatine_2017"]),
    (r"\b(caffeine|pre-?workout|coffee)\b", ["issn_caffeine_2021"]),
    (r"\b(hydrat|water intake|dehydrat|electrolyte|sweat)", ["acsm_fluid_2007"]),
    (r"\b(fat loss|lose fat|losing fat|lose weight|losing weight|weight loss|cut|cutting|deficit|lean out)\b", ["helms_2014", "garthe_2011", "longland_2016"]),
    (r"\b(protein|macro|macros|calorie|calories|diet|nutrition|eat|eating)\b", ["issn_protein_2017", "morton_protein_2018"]),
    (r"\b(sleep|recover|recovery|sore|soreness|doms|deload|fatigue)\b", ["dupuy_recovery_2018", "aasm_sleep_2015"]),
    (r"\b(mobility|stretch|stretching|flexib|range of motion|warm[- ]?up)\b", ["behm_stretching_2016", "alizadeh_rom_2023"]),
    (r"\bsquat", ["schoenfeld_squat_2010"]),
    (r"\b(volume|how many sets|sets per|frequency|times a week|per week|split)\b", ["schoenfeld_volume_2017", "schoenfeld_frequency_2016"]),
    (r"\b(muscle growth|build muscle|building muscle|hypertroph|bulk|gain muscle|grow)\b", ["schoenfeld_volume_2017", "schoenfeld_loading_2021"]),
    (r"\b(progressive overload|overload|progress|strength|stronger|reps?|one[- ]rep max|1rm|weight to use|form|technique)\b", ["acsm_2009", "schoenfeld_loading_2021"]),
    (r"\b(cardio|walk|walking|running|steps|aerobic|activity|active)\b", ["who_2020", "pag_2018"]),
]
_KEYWORD_RULES = [(re.compile(pattern, re.IGNORECASE), ids) for pattern, ids in _KEYWORD_RULES]

# The line the model is asked to end with. Tolerates the markdown a model
# tends to dress it in anyway: "**Sources:** a, b", "SOURCES: [a, b]",
# "Sources - a; b".
_SOURCES_LINE = re.compile(
    r"^[ \t>*_-]*\**sources?\**[ \t]*\**[ \t]*[:\-][ \t]*\**[ \t]*(?P<ids>[^\n]*)$",
    re.IGNORECASE | re.MULTILINE,
)
_ID_TOKEN = re.compile(r"[a-z0-9_]+")
_ID_FORMAT = re.compile(r"[a-z0-9]+(?:_[a-z0-9]+)+")


def prompt_instruction():
    """The rule appended to every chatbot's system prompt."""
    catalog = "\n".join(f"- {s['id']}: {s['title']}" for s in SOURCES)
    return (
        "\n\nCiting sources (required): end EVERY reply with one final line, "
        "on its own, in exactly this form:\n"
        "SOURCES: id1, id2\n"
        f"listing 1 to {MAX_SOURCES_PER_REPLY} ids from the catalog below "
        "whose findings back the health, training or nutrition advice in "
        "your reply. Use ONLY ids from this catalog -- never invent one, and "
        "never write a URL, study title or author yourself anywhere in the "
        "reply; the app turns the ids into links for the user. If the reply "
        "gives no health, training or nutrition information at all (a "
        "greeting, or declining an off-topic question), write SOURCES: none.\n"
        "Do not mention this line or the catalog in the rest of your reply.\n"
        f"Catalog:\n{catalog}"
    )


def _public(source):
    return {
        "id": source["id"],
        "title": source["title"],
        "publisher": source["publisher"],
        "url": source["url"],
    }


def _keyword_ids(text):
    ids = []
    for pattern, rule_ids in _KEYWORD_RULES:
        if pattern.search(text):
            for source_id in rule_ids:
                if source_id not in ids:
                    ids.append(source_id)
        if len(ids) >= MAX_SOURCES_PER_REPLY:
            break
    return ids[:MAX_SOURCES_PER_REPLY]


def attach_sources(reply, question=""):
    """Split the model's SOURCES line off `reply` and resolve it.

    Returns (clean_reply, sources) where sources is a list of
    {id, title, publisher, url} dicts, at most MAX_SOURCES_PER_REPLY long.
    """
    reply = str(reply or "")
    model_ids = []
    said_none = False
    matches = list(_SOURCES_LINE.finditer(reply))
    # Only a line that ENDS the reply is the citation line. Anywhere else,
    # "Sources: eggs, chicken, Greek yogurt" is the answer itself and has
    # to stay in it.
    if matches and not reply[matches[-1].end():].strip():
        last = matches[-1]
        raw = last.group("ids").strip().strip("*[]()`. ").lower()
        said_none = raw.startswith("none") or raw == "n/a"
        model_ids = [t for t in _ID_TOKEN.findall(raw) if t in SOURCES_BY_ID]
        # ...and even a final line is only ours if it is written in ids (or
        # says none). An answer can end on "Sources: eggs, chicken", but a
        # made-up "fake_study_2020" is still our format and still goes.
        parts = [p.strip() for p in re.split(r"[,;]", raw) if p.strip()]
        in_id_format = bool(parts) and all(_ID_FORMAT.fullmatch(p) for p in parts)
        if model_ids or said_none or in_id_format:
            reply = reply[:last.start()].rstrip()

    ids = []
    for source_id in model_ids:
        if source_id not in ids:
            ids.append(source_id)
    ids = ids[:MAX_SOURCES_PER_REPLY]

    if not ids:
        ids = _keyword_ids(f"{question}\n{reply}")
    if not ids and not said_none:
        # The model gave advice but neither it nor the keywords named a
        # topic: fall back to the general guidelines rather than nothing.
        ids = ["acsm_2009", "who_2020"]

    return reply, [_public(SOURCES_BY_ID[i]) for i in ids]


def grouped_catalog():
    """[(topic label, [source, ...]), ...] for the /sources page."""
    groups = []
    for topic_id, label in TOPICS:
        items = [s for s in SOURCES if s["topic"] == topic_id]
        if items:
            groups.append((label, items))
    return groups
