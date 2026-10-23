import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  canReloadPlateFrame,
  capturePlayheadAnchor,
  joinFrameOwner,
  liveRecDiscontinuous,
  plateClipFor,
  playheadOnPlate,
  previewClockMs,
  restorePlayheadAnchor,
  shouldBlacklistPlateLoad,
  shouldParkPlayheadAtClipStart,
  soloJoinFocus,
  stagePointerOwner,
} from './plateSync';

const seq = [
  { id: 'c0', kind: 'plate', plateId: 'open', at: 0, dur: 5 },
  { id: 'c1', kind: 'live', at: 4.5, dur: 10 },
  { id: 'c2', kind: 'plate', plateId: 'close', at: 14, dur: 4 },
];

describe('plateClipFor', () => {
  it('finds a plate by id even when the playhead is on a live clip', () => {
    assert.equal(plateClipFor(seq, 'open', seq[1])?.plateId, 'open');
    assert.equal(plateClipFor(seq, 'close', seq[1])?.plateId, 'close');
  });

  it('falls back to the playhead plate when no id is given', () => {
    assert.equal(plateClipFor(seq, null, seq[0])?.plateId, 'open');
    assert.equal(plateClipFor(seq, null, seq[1]), null);
  });
});

describe('playheadOnPlate', () => {
  it('is true only when playhead clip matches the plate', () => {
    assert.equal(playheadOnPlate(seq[0], 'open'), true);
    assert.equal(playheadOnPlate(seq[1], 'open'), false);
    assert.equal(playheadOnPlate(seq[2], 'open'), false);
  });
});

describe('previewClockMs', () => {
  it('resets to zero when fromStart or when the playhead is elsewhere', () => {
    assert.equal(previewClockMs(seq[0], 2.5, { fromStart: true, onPlate: true }), 0);
    assert.equal(previewClockMs(seq[0], 2.5, { fromStart: false, onPlate: false }), 0);
  });

  it('keeps the playhead offset by default so live look/style edits do not jump', () => {
    assert.equal(previewClockMs(seq[0], 2.5, { onPlate: true }), 2500);
    assert.equal(previewClockMs(seq[0], 2.5, { fromStart: false, onPlate: true }), 2500);
    assert.equal(previewClockMs(seq[2], 15.2, { fromStart: false, onPlate: true }), 1200);
  });
});

describe('shouldParkPlayheadAtClipStart', () => {
  it('parks only when resetting the plate that is on stage', () => {
    assert.equal(shouldParkPlayheadAtClipStart(true, true), true);
    assert.equal(shouldParkPlayheadAtClipStart(true, false), false);
    assert.equal(shouldParkPlayheadAtClipStart(false, true), false);
  });
});

describe('canReloadPlateFrame', () => {
  it('never reloads over unsaved copy', () => {
    assert.equal(canReloadPlateFrame({ dirty: true, activePlateId: 'open', plateId: 'open', playheadPlateId: 'open' }), false);
  });

  it('reloads when the iframe holds the plate even if the playhead is elsewhere', () => {
    assert.equal(
      canReloadPlateFrame({ dirty: false, activePlateId: 'open', plateId: 'open', playheadPlateId: null }),
      true
    );
  });

  it('reloads when the playhead is on the plate', () => {
    assert.equal(
      canReloadPlateFrame({ dirty: false, activePlateId: 'close', plateId: 'open', playheadPlateId: 'open' }),
      true
    );
  });

  it('stales when neither iframe nor playhead hold the plate', () => {
    assert.equal(
      canReloadPlateFrame({ dirty: false, activePlateId: 'close', plateId: 'open', playheadPlateId: null }),
      false
    );
  });
});

describe('capturePlayheadAnchor / restorePlayheadAnchor', () => {
  it('keeps the same plate after a middle live clip is omitted', () => {
    const before = [
      { id: 'open', kind: 'plate', plateId: 'open', at: 0, dur: 6 },
      { id: 'live', kind: 'live', at: 6, dur: 14 },
      { id: 'meet', kind: 'plate', plateId: 'meet', at: 20, dur: 6 },
    ];
    const after = [
      { id: 'open', kind: 'plate', plateId: 'open', at: 0, dur: 6 },
      { id: 'meet', kind: 'plate', plateId: 'meet', at: 6, dur: 6 },
    ];
    const anchor = capturePlayheadAnchor(before, 22);
    assert.equal(anchor?.plateId, 'meet');
    assert.equal(restorePlayheadAnchor(after, 12, anchor, 22), 8);
  });

  it('parks near the shortened cut when the playhead clip was omitted', () => {
    const before = [
      { id: 'open', kind: 'plate', plateId: 'open', at: 0, dur: 6 },
      { id: 'live', kind: 'live', at: 6, dur: 14 },
      { id: 'meet', kind: 'plate', plateId: 'meet', at: 20, dur: 6 },
    ];
    const after = [
      { id: 'open', kind: 'plate', plateId: 'open', at: 0, dur: 6 },
      { id: 'meet', kind: 'plate', plateId: 'meet', at: 6, dur: 6 },
    ];
    const anchor = capturePlayheadAnchor(before, 10);
    assert.equal(anchor?.id, 'live');
    assert.equal(restorePlayheadAnchor(after, 12, anchor, 10), 10);
  });

  it('restores open by id after undo brings the live clip back', () => {
    const afterUndo = [
      { id: 'open', kind: 'plate', plateId: 'open', at: 0, dur: 6 },
      { id: 'live', kind: 'live', at: 6, dur: 14 },
      { id: 'meet', kind: 'plate', plateId: 'meet', at: 20, dur: 6 },
    ];
    const anchor = capturePlayheadAnchor(
      [
        { id: 'open', kind: 'plate', plateId: 'open', at: 0, dur: 6 },
        { id: 'meet', kind: 'plate', plateId: 'meet', at: 6, dur: 6 },
      ],
      2
    );
    assert.equal(restorePlayheadAnchor(afterUndo, 26, anchor, 2), 2);
  });
});

describe('soloJoinFocus', () => {
  const open = { kind: 'plate', plateId: 'open' };
  const meet = { kind: 'plate', plateId: 'meet' };
  const live = { kind: 'live' };
  const liveA = { kind: 'live', id: 'live-1', recFrom: 0, recTo: 10 };
  const liveC = { kind: 'live', id: 'live-3', recFrom: 20, recTo: 30 };

  it('picks outgoing then incoming across a plate→plate join', () => {
    assert.equal(soloJoinFocus(open, meet, 0.2), open);
    assert.equal(soloJoinFocus(open, meet, 0.5), meet);
    assert.equal(soloJoinFocus(open, meet, 0.9), meet);
  });

  it('picks outgoing then incoming across a live→live join (omit middle)', () => {
    assert.equal(soloJoinFocus(liveA, liveC, 0.2), liveA);
    assert.equal(soloJoinFocus(liveA, liveC, 0.5), liveC);
    assert.equal(soloJoinFocus(liveA, liveC, 0.9), liveC);
  });

  it('returns null for plate↔live so dual layers can run', () => {
    assert.equal(soloJoinFocus(open, live, 0.3), null);
    assert.equal(soloJoinFocus(live, meet, 0.3), null);
  });
});

describe('joinFrameOwner', () => {
  const open = { kind: 'plate', plateId: 'open' };
  const meet = { kind: 'live', id: 'live-2.37' };

  it('gives the iframe to the outgoing plate, then the incoming card', () => {
    assert.equal(joinFrameOwner(open, meet, 0, { curNeedsCard: true }), 'plate');
    assert.equal(joinFrameOwner(open, meet, 0.49, { curNeedsCard: true }), 'plate');
    assert.equal(joinFrameOwner(open, meet, 0.5, { curNeedsCard: true }), 'card');
  });

  it('is stable for a parked playhead (same input, same owner)', () => {
    const a = joinFrameOwner(open, meet, 0.2, { curNeedsCard: true });
    const b = joinFrameOwner(open, meet, 0.2, { curNeedsCard: true });
    assert.equal(a, b);
  });

  it('returns null when there is no card or no plate→live conflict', () => {
    assert.equal(joinFrameOwner(open, meet, 0.2, { curNeedsCard: false }), null);
    assert.equal(joinFrameOwner(meet, open, 0.2, { curNeedsCard: true }), null);
  });

  it('keeps the card while its copy is being edited, whatever the progress', () => {
    assert.equal(joinFrameOwner(open, meet, 0, { curNeedsCard: true, lockCard: true }), 'card');
    assert.equal(joinFrameOwner(open, meet, 0.3, { curNeedsCard: true, lockCard: true }), 'card');
    assert.equal(joinFrameOwner(open, meet, 0.3, { curNeedsCard: false, lockCard: true }), null);
  });
});

describe('stagePointerOwner', () => {
  it('gives an aim box the pointer even under a composited card', () => {
    assert.equal(stagePointerOwner({ aimBoxUp: true }), 'take');
    assert.equal(stagePointerOwner({ aimBoxUp: true, playing: true }), 'take');
  });
  it('text mode always owns the stage', () => {
    assert.equal(stagePointerOwner({ textMode: true, aimBoxUp: true }), 'card');
    assert.equal(stagePointerOwner({ textMode: true, playing: true }), 'card');
  });
  it('idle card keeps click-to-edit; playback never routes into the iframe', () => {
    assert.equal(stagePointerOwner({}), 'card');
    assert.equal(stagePointerOwner({ playing: true }), 'take');
  });
});

describe('liveRecDiscontinuous', () => {
  it('detects a hole left by omitting a middle live slice', () => {
    assert.equal(
      liveRecDiscontinuous(
        { kind: 'live', recFrom: 0, recTo: 10 },
        { kind: 'live', recFrom: 20, recTo: 30 }
      ),
      true
    );
  });

  it('treats abutting slices as continuous', () => {
    assert.equal(
      liveRecDiscontinuous(
        { kind: 'live', recFrom: 0, recTo: 10 },
        { kind: 'live', recFrom: 10, recTo: 20 }
      ),
      false
    );
  });
});

describe('shouldBlacklistPlateLoad', () => {
  it('never blacklists a successful or cancelled load', () => {
    assert.equal(shouldBlacklistPlateLoad(true, { activePlateId: 'open', requestedId: 'open' }), false);
    assert.equal(shouldBlacklistPlateLoad('cancelled', { activePlateId: 'meet', requestedId: 'open' }), false);
  });

  it('does not blacklist when a newer plate stole the iframe', () => {
    assert.equal(shouldBlacklistPlateLoad(false, { activePlateId: 'meet', requestedId: 'open' }), false);
  });

  it('blacklists a hard failure for the plate still on stage', () => {
    assert.equal(shouldBlacklistPlateLoad(false, { activePlateId: 'open', requestedId: 'open' }), true);
  });
});
