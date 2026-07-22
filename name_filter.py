"""Blocks obviously inappropriate/offensive display names -- checked
wherever a user sets or changes the name shown to other people (signup,
and the account-settings rename), see auth.py's signup() and
database.py's update_account().

Not a claim of perfect/exhaustive coverage -- profanity filtering always
has false positives/negatives (e.g. the "Scunthorpe problem" of innocent
words containing a bad substring). This checks whole word-tokens against
a curated list after normalizing common obfuscation (leetspeak
substitutions, repeated-letter stretching, punctuation-as-spacer) rather
than doing a raw substring search, which avoids flagging things like
"classic" or "assassin" for containing "ass". It's meant to catch the
common, obvious cases, not to be airtight against a determined user.
"""

import re
import unicodedata

# Deliberately not exhaustive -- covers common English profanity, slurs
# (racial/ethnic/homophobic/ableist), and a few hate-group/violent terms
# that have no legitimate use as a display name. Lowercase, no spaces.
_BAD_WORDS = {
    # Profanity / sexual
    "fuck", "fucker", "fucking", "motherfucker", "shit", "bullshit", "bitch",
    "cunt", "dick", "dickhead", "dickface", "dickwad", "pussy", "cock",
    "asshole", "ass", "bastard", "whore", "slut", "slag", "twat", "wanker",
    "jackass", "dumbass", "fatass", "asswipe", "assface", "dipshit", "prick",
    "fuckface", "fuckboy", "fucktard", "fuckwit", "dumbfuck", "shithead",
    "shitbag", "shitface", "cockface", "twatface", "douchebag", "douche",
    "scumbag",
    "cum", "jizz", "boner", "handjob", "blowjob", "rimjob", "anal", "porn",
    "hentai", "milf", "nude", "nudes", "sex", "sexy", "horny", "orgasm",
    "masturbate", "penis", "vagina", "clit", "testicle", "scrotum", "semen",
    "rape", "rapist", "molest", "molester", "pedo", "pedophile", "incest",
    "bestiality", "zoophile",
    # Racial / ethnic slurs (and common variants)
    "nigger", "nigga", "nigg", "chink", "gook", "spic", "wetback", "beaner",
    "kike", "kyke", "paki", "raghead", "sandnigger", "coon", "jigaboo",
    "gypsy", "gyppo", "redskin", "injun", "cracker", "honky", "wop", "dago",
    "gringo", "towelhead",
    # Homophobic / transphobic / gender slurs
    "faggot", "fag", "dyke", "tranny", "shemale", "queer",
    # Ableist slurs
    "retard", "retarded", "spastic", "spaz", "mongoloid", "cripple",
    # Hate groups / extremist references
    "nazi", "hitler", "kkk", "isis", "alqaeda", "terrorist", "jihad",
    "whitepower", "sieg", "heil",
    # Violent / criminal
    "kill", "murder", "murderer", "suicide", "genocide", "lynch", "lynching",
}

# Common obfuscations that swap letters for lookalike characters -- applied
# before word matching so "fu(k", "5hit", "n1gger" etc. still get caught.
_LEET_MAP = str.maketrans({
    "0": "o", "1": "i", "!": "i", "3": "e", "4": "a", "@": "a",
    "5": "s", "$": "s", "7": "t", "+": "t", "8": "b", "9": "g",
})

_REPEAT_RUN = re.compile(r"(.)\1{2,}")  # 3+ of the same char in a row


def _normalize_token(token):
    # Collapse runs of 3+ identical characters down to one (e.g. "fuuuuck"
    # -> "fuck") -- most real English words never repeat a letter 3+ times.
    return _REPEAT_RUN.sub(r"\1", token)


def _tokens(name):
    # Strip accents (e.g. "fück" -> "fuck") first, so accented obfuscation
    # doesn't slip past a plain-ASCII wordlist.
    stripped = unicodedata.normalize("NFKD", name)
    stripped = "".join(ch for ch in stripped if not unicodedata.combining(ch))
    # Leet-map BEFORE splitting into tokens -- digits/symbols like the "1" in
    # "n1gger" need to become letters while still part of the same token;
    # splitting first would treat them as a token boundary and miss it.
    leeted = stripped.lower().translate(_LEET_MAP)
    raw_tokens = re.split(r"[^a-zA-Z]+", leeted)
    return [_normalize_token(t) for t in raw_tokens if t]


def contains_bad_word(name):
    """True if any word-token in `name` (after normalizing obfuscation)
    matches the blocklist, or if the fully-concatenated letters-only form
    of the name (spaces/punctuation removed) does -- catches spaced-out
    dodges like "f u c k" or "f.u.c.k" without doing a loose substring
    search that would false-positive on innocent words."""
    tokens = _tokens(name)
    if any(t in _BAD_WORDS for t in tokens):
        return True
    joined = "".join(tokens)
    return joined in _BAD_WORDS


def validate_display_name(name):
    """Returns an error string if `name` isn't acceptable as a display
    name shown to other users (empty, or contains a blocked word), else
    None."""
    name = (name or "").strip()
    if not name:
        return "Please enter your name."
    if contains_bad_word(name):
        return "That name isn't allowed. Please choose a different one."
    return None
