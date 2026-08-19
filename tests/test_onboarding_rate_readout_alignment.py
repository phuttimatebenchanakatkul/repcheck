"""Guards the alignment of the rate readout's four value boxes.

The "per week" / "per month" rows in the goal-weight step each hold two
boxes -- the weight change and the same figure as a % of bodyweight. The
two carry different type sizes (16px against 14px), so left to themselves
they size to different heights, and the row's original align-items: center
left the smaller box's edges short of the larger one at both top and
bottom. Measured on a 429px-wide viewport: 45px beside 43px.

Narrower screens made it worse rather than better. The row spends 98px on
chrome before the boxes get anything (a 10px sign, a 64px frequency
column, three 8px gaps), so under roughly a 380px viewport "% BW" wraps to
two lines and the mismatch grows to 58px beside 45px.

The fix is align-items: stretch, verified across 320/345/375/390/430px
viewports: every box in a row lands on the same height whether the unit
wraps (58px) or not (45px), and widths were already equal via flex: 1.
"""

import re

import pytest


@pytest.fixture(scope="module")
def onboarding_html():
    with open("templates/onboarding.html", encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def readout_css(onboarding_html):
    start = onboarding_html.index(".ob-rate-readout-row {")
    return onboarding_html[start:onboarding_html.index(".ob-eta-card")]


def test_row_stretches_its_boxes_to_a_common_height(readout_css):
    """align-items: center sizes each box to its own content, so the 14px
    "% BW" box sits inset from the 16px weight box on both edges. Stretch
    is what makes the four boxes read as one grid."""
    row = readout_css[: readout_css.index("}")]
    assert "align-items: stretch;" in row
    assert "align-items: center;" not in row


def test_boxes_stay_equal_width(readout_css):
    """flex: 1 (not flex-basis on content) is what keeps the two boxes in a
    row the same width -- and, since both rows have identical chrome, keeps
    the columns aligned between the week and month rows too."""
    box = readout_css[readout_css.index(".ob-rate-readout-box {"):]
    assert re.search(r"flex: 1; min-width: 0;", box[: box.index("}")])


def test_sign_and_frequency_labels_opt_out_of_the_stretch(readout_css):
    """They're labels sharing the row, not boxes: without align-self they'd
    inherit the stretch, grow to the full row height and pull their text to
    the top edge instead of staying centered against it."""
    for cls in (".ob-rate-readout-sign", ".ob-rate-readout-freq"):
        rule = readout_css[readout_css.index(cls + " {"):]
        assert "align-self: center;" in rule[: rule.index("}")], cls


def test_boxes_keep_baseline_alignment_inside(readout_css):
    """Within a stretched box the content must stay pinned to the top
    (baseline), not recentre -- otherwise the single line in the weight box
    would drift to the vertical middle of a wrapped neighbour instead of
    sitting level with its first line."""
    box = readout_css[readout_css.index(".ob-rate-readout-box {"):]
    assert "align-items: baseline;" in box[: box.index("}")]
