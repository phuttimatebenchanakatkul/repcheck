// The analyze page's "Analyzing" screen plays the clip back with a skeleton
// over it. Two complaints about that overlay, one root cause: it was drawn on
// the wrong clock.
//
// Detection is not instant -- grab the frame, ship it to the worker, run the
// model, post landmarks back -- so a result describes the body as it was
// 40-110ms ago. Painted the moment it arrived, the skeleton sat behind the
// body ("doesn't really align with the video"). And since it was only
// repainted when a result arrived, it held one pose for several video frames
// and then jumped ("wasn't smooth").
//
// The fix separates detection rate from render rate. Results are filed
// against the VIDEO time of the frame they came from, and every animation
// frame the renderer asks where the body is at previewVideo.currentTime.
// These two functions are that arithmetic; the tests below are about time,
// not about drawing.

import { describe, it, expect } from "vitest";
import { loadPoseInterp, poseInterpConstant } from "./support/loadPoseInterp.js";

const { poseAt, nextPoseSamples } = loadPoseInterp();

const MAX_LEAD = poseInterpConstant("POSE_MAX_LEAD");
const MAX_GAP = poseInterpConstant("POSE_SAMPLE_MAX_GAP_S");

// A one-landmark pose is enough for the arithmetic and keeps the expected
// values readable; the real thing carries 33 and treats them all alike.
const at = (t, x, y) => ({ at: t, pose: [{ x, y }] });

describe("poseAt: placing the skeleton at a moment in the clip", () => {
  it("returns the newest sample when asked for exactly its own moment", () => {
    const a = at(1.0, 0.2, 0.2);
    const b = at(1.1, 0.4, 0.5);

    expect(poseAt(a, b, 1.1, MAX_LEAD)).toEqual(b.pose);
  });

  it("interpolates halfway between the two samples", () => {
    // This is the smoothness half. Between detections the old code redrew
    // nothing at all, so the skeleton stood still and then jumped; here the
    // moment between two samples has its own answer.
    const a = at(1.0, 0.2, 0.2);
    const b = at(1.1, 0.4, 0.6);

    const mid = poseAt(a, b, 1.05, MAX_LEAD);

    expect(mid[0].x).toBeCloseTo(0.3, 10);
    expect(mid[0].y).toBeCloseTo(0.4, 10);
  });

  it("carries the motion forward past the newest sample", () => {
    // This is the alignment half. By the time a result lands the clip has
    // already moved on by about the pipeline's latency, so rendering the
    // newest sample verbatim draws the body where it WAS.
    const a = at(1.0, 0.2, 0.2);
    const b = at(1.1, 0.4, 0.6);

    const ahead = poseAt(a, b, 1.15, MAX_LEAD);

    expect(ahead[0].x).toBeCloseTo(0.5, 10);
    expect(ahead[0].y).toBeCloseTo(0.8, 10);
  });

  it("never leads further than POSE_MAX_LEAD sample intervals", () => {
    // A stalled pipeline must not fling limbs off the frame while it waits.
    const a = at(1.0, 0.0, 0.0);
    const b = at(1.1, 0.1, 0.1);

    const wayAhead = poseAt(a, b, 99, MAX_LEAD);
    const capped = poseAt(a, b, 1.1 + 0.1 * MAX_LEAD, MAX_LEAD);

    expect(wayAhead).toEqual(capped);
    expect(wayAhead[0].x).toBeCloseTo(0.1 + 0.1 * MAX_LEAD, 10);
  });

  it("does not run off the far side of the older sample either", () => {
    const a = at(1.0, 0.0, 0.0);
    const b = at(1.1, 0.1, 0.1);

    // -1 sample interval lands exactly on A; anything earlier clamps there.
    expect(poseAt(a, b, 1.0, MAX_LEAD)[0].x).toBeCloseTo(0.0, 10);
    expect(poseAt(a, b, -50, MAX_LEAD)[0].x).toBeCloseTo(0.0, 10);
  });

  it("draws the one sample it has when there is no pair yet", () => {
    // The first result of a clip, and the first after a loop wrap. Without
    // this the overlay would stay blank until the second detection.
    const b = at(1.1, 0.4, 0.6);

    expect(poseAt(null, b, 1.4, MAX_LEAD)).toEqual(b.pose);
  });

  it("has nothing to draw before the first result", () => {
    expect(poseAt(null, null, 1.0, MAX_LEAD)).toBe(null);
  });

  it("falls back to the newest sample rather than dividing by a zero span", () => {
    const a = at(1.1, 0.2, 0.2);
    const b = at(1.1, 0.4, 0.6);

    expect(poseAt(a, b, 1.2, MAX_LEAD)).toEqual(b.pose);
  });

  it("falls back to the newest sample when the landmark counts disagree", () => {
    // Pairing a full body against a partial one would subtract landmarks
    // that are not the same joint.
    const a = { at: 1.0, pose: [{ x: 0.1, y: 0.1 }] };
    const b = { at: 1.1, pose: [{ x: 0.4, y: 0.4 }, { x: 0.5, y: 0.5 }] };

    expect(poseAt(a, b, 1.15, MAX_LEAD)).toEqual(b.pose);
  });

  it("leaves the samples it was handed untouched", () => {
    // The renderer runs every animation frame off the same stored pair; a
    // function that wrote back into them would compound its own output.
    const a = at(1.0, 0.2, 0.2);
    const b = at(1.1, 0.4, 0.6);

    poseAt(a, b, 1.15, MAX_LEAD);

    expect(a.pose[0]).toEqual({ x: 0.2, y: 0.2 });
    expect(b.pose[0]).toEqual({ x: 0.4, y: 0.6 });
  });
});

describe("nextPoseSamples: which two results may be paired", () => {
  const pose = [{ x: 0.5, y: 0.5 }];

  it("files the first result as the newest sample, with no pair", () => {
    const next = nextPoseSamples(null, null, pose, 0.4, MAX_GAP);

    expect(next.a).toBe(null);
    expect(next.b).toEqual({ at: 0.4, pose });
  });

  it("shifts the previous newest into the older slot", () => {
    const first = nextPoseSamples(null, null, pose, 0.4, MAX_GAP);
    const second = nextPoseSamples(first.a, first.b, pose, 0.45, MAX_GAP);

    expect(second.a).toBe(first.b);
    expect(second.b).toEqual({ at: 0.45, pose });
  });

  it("starts a fresh pair when the clip loops back to the start", () => {
    // The preview <video> carries `loop`, so every lap wraps currentTime to
    // 0. Pairing the last frame of one lap with the first of the next
    // describes a movement that never happened, across the whole clip.
    const before = nextPoseSamples(null, null, pose, 9.8, MAX_GAP);
    const after = nextPoseSamples(before.a, before.b, pose, 0.02, MAX_GAP);

    expect(after.a).toBe(null);
    expect(after.b).toEqual({ at: 0.02, pose });
  });

  it("starts a fresh pair after a gap longer than POSE_SAMPLE_MAX_GAP_S", () => {
    // A decode stall or a backgrounded tab. The body could be anywhere by
    // now, so there is no direction worth carrying forward.
    const before = nextPoseSamples(null, null, pose, 1.0, MAX_GAP);
    const after = nextPoseSamples(before.a, before.b, pose, 1.0 + MAX_GAP + 0.01, MAX_GAP);

    expect(after.a).toBe(null);
    expect(after.b).toEqual({ at: 1.0 + MAX_GAP + 0.01, pose });
  });

  it("keeps the pair across a gap of exactly POSE_SAMPLE_MAX_GAP_S", () => {
    const before = nextPoseSamples(null, null, pose, 1.0, MAX_GAP);
    const after = nextPoseSamples(before.a, before.b, pose, 1.0 + MAX_GAP, MAX_GAP);

    expect(after.a).toBe(before.b);
  });

  it("drops both samples when the frame has no body in it", () => {
    // Keeping them would leave the last skeleton hanging over footage it no
    // longer describes -- and the renderer would go on extrapolating it.
    const first = nextPoseSamples(null, null, pose, 0.4, MAX_GAP);
    const second = nextPoseSamples(first.a, first.b, pose, 0.45, MAX_GAP);

    const empty = nextPoseSamples(second.a, second.b, [], 0.5, MAX_GAP);

    expect(empty.a).toBe(null);
    expect(empty.b).toBe(null);
  });

  it("treats a missing pose the same as an empty one", () => {
    const first = nextPoseSamples(null, null, pose, 0.4, MAX_GAP);

    expect(nextPoseSamples(first.a, first.b, null, 0.45, MAX_GAP)).toEqual({ a: null, b: null });
  });
});

describe("the constants the renderer is tuned by", () => {
  it("allows a lead, or the alignment half of the fix does nothing", () => {
    // At 0 this whole renderer reduces to the old behaviour: draw the newest
    // result and accept its lag.
    expect(MAX_LEAD).toBeGreaterThan(0);
  });

  it("caps the lead at one sample interval", () => {
    // Linear extrapolation scales the model's own jitter along with the
    // motion, so reaching further trades a smaller average error for a worse
    // worst case. Measured on a real clip (the table in templates/index.html
    // above POSE_MAX_LEAD), mean and p90 flatten around 0.75 while the worst
    // case climbs in a straight line past it -- so a value above 1 is buying
    // nothing and paying for it in flung limbs.
    expect(MAX_LEAD).toBeLessThanOrEqual(1);
  });

  it("tolerates a gap several detections wide before giving up on the pair", () => {
    // Short enough that a wrap on a very short clip still breaks the pair,
    // long enough that an ordinary slow frame does not throw the pair away
    // and restart the overlay from a single sample.
    expect(MAX_GAP).toBeGreaterThan(0.1);
    expect(MAX_GAP).toBeLessThan(1);
  });
});
