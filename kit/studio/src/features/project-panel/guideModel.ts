/**
 * The pure parts of `kit/studio/guideCard.js`: the copy for each session state,
 * the journey checklist and the action buttons. `GuideCard.tsx` renders the card.
 */

export type GuideState = 'connecting' | 'ready' | 'signin' | 'countdown' | 'capturing' | 'paused' | 'finishing' | 'done';

export interface GuideStatus {
  state?: string;
  steps?: number;
  marks?: number;
  cuts?: number;
  last?: string;
  needsSignIn?: boolean;
  recording?: boolean;
  recSec?: number;
  countdownMs?: number;
  updatedAt?: string;
}

export const STATE_COPY: Record<string, readonly [string, string]> = {
  connecting: ['Opening the browser…', 'A browser window and a Recorder window open in a moment.'],
  ready: ['Get ready — not recording yet', 'Look around freely. Nothing is filmed until you press Start recording.'],
  signin: ['Sign in first — not recording', 'Your sign-in never reaches the video. Press Start recording once you are in.'],
  countdown: ['Recording starts…', 'Take your hand off the mouse — the first screen holds while the opening card plays.'],
  capturing: ['Recording', 'Everything in the browser window is filmed. Show the tour the way you would present it.'],
  paused: ['Paused — not recording', 'Set up the next screen. This stretch is cut from the video and left out of the steps.'],
  finishing: ['Saving your recording…', 'Your recording, steps and screenshots are being written.'],
  done: ['Saved', 'Choose how to use it below.'],
};

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
export const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export function guideStatusLine(status: GuideStatus | null | undefined): string {
  if (!status) return '';
  const parts = [plural(status.steps || 0, 'step')];
  if (status.marks) parts.push(plural(status.marks, 'chapter'));
  if (status.cuts) parts.push(`${plural(status.cuts, 'pause')} cut`);
  return parts.join(' · ');
}

export interface JourneyStep {
  id: string;
  html: string;
  state: 'done' | 'now' | 'next';
}

/** The reviewer's journey, with where they are now. */
export function guideJourney(status: GuideStatus | null | undefined): JourneyStep[] {
  const state = status?.state || 'connecting';
  const steps: Array<[string, string]> = [
    ...(status?.needsSignIn ? [['signin', 'Sign in in the browser window'] as [string, string]] : []),
    ['screen', 'Go to the screen your video opens on'],
    ['start', 'Press <b>Start recording</b> — a 3-second countdown follows'],
    ['show', 'Show the tour. <b>Mark chapter</b> for each part; <b>Pause</b> to set something up off camera'],
    ['finish', 'Press <b>Finish recording</b>'],
    ['choose', 'Choose: use your recording, or let the bot re-record'],
  ];
  const at =
    state === 'connecting' || state === 'ready'
      ? steps[0]?.[0]
      : state === 'countdown'
        ? 'start'
        : state === 'capturing' || state === 'paused'
          ? 'show'
          : 'choose';
  const i = steps.findIndex(([id]) => id === at);
  return steps.map(([id, html], n) => ({ id, html, state: n < i ? 'done' : n === i ? 'now' : 'next' }));
}

export const ACTIONS: Partial<Record<string, ReadonlyArray<readonly [action: string, label: string, cls: string]>>> = {
  ready: [
    ['start', 'Start recording', 'btn guide-rec-btn'],
    ['cancel', 'Cancel', 'btn ghost'],
  ],
  countdown: [['stop-countdown', 'Not yet', 'btn ghost']],
  capturing: [
    ['mark', 'Mark chapter', 'btn'],
    ['pause', 'Pause', 'btn'],
    ['finish', 'Finish recording', 'btn primary'],
  ],
  paused: [
    ['resume', 'Resume recording', 'btn guide-rec-btn'],
    ['finish', 'Finish recording', 'btn'],
  ],
};

/** The raw session state and the one the card shows (`ready` + sign-in reads as `signin`). */
export function guideStates(status: GuideStatus | null, pending: string): { raw: string; state: string } {
  const raw = pending === 'finish' && !['finishing', 'done'].includes(status?.state ?? '') ? 'finishing' : status?.state || 'connecting';
  const state = raw === 'ready' && status?.needsSignIn ? 'signin' : raw;
  return { raw, state };
}

/** REC seconds and the countdown digit, extrapolated from the last status write. */
export function guideLive(status: GuideStatus | null, now = Date.now()): { rec: number; count: number } {
  if (!status) return { rec: 0, count: 0 };
  const since = status.updatedAt ? Math.max(0, (now - Date.parse(status.updatedAt)) / 1000) : 0;
  return {
    rec: (status.recSec || 0) + (status.state === 'capturing' ? since : 0),
    count: Math.max(1, Math.ceil((status.countdownMs || 0) / 1000 - since)),
  };
}
