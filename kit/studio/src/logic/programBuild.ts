/** What Program should show after each pipeline step, without waiting for the last one. */

export interface ProgramMark {
  start: number;
  title: string;
}

export interface CaptureMarkInput {
  start?: number | string | null;
  t?: number | string | null;
  title?: string;
  label?: string;
}

export function marksForProgram({
  chapters = [],
  captureMarks = [],
}: { chapters?: ProgramMark[] | null; captureMarks?: CaptureMarkInput[] | null } = {}): ProgramMark[] {
  if (chapters?.length) return chapters;
  return (captureMarks || []).map((mark) => ({
    start: Number(mark.start ?? mark.t) || 0,
    title: mark.title || mark.label || '',
  }));
}

export interface ProgramSourceInput {
  step?: string;
  hasLive?: boolean;
  liveUrl?: string | null;
  hasDelivery?: boolean;
  deliveryUrl?: string | null;
}

export type ProgramSource =
  | { src: string; play: boolean; preserveTime: boolean; keep?: undefined }
  | { keep: true; src?: undefined; play?: undefined; preserveTime?: undefined };

export function programSourceForStep({
  step,
  hasLive,
  liveUrl,
  hasDelivery,
  deliveryUrl,
}: ProgramSourceInput = {}): ProgramSource {
  if ((step === 'record' || step === 'adopt') && hasLive && liveUrl) return { src: liveUrl, play: true, preserveTime: false };
  if ((step === 'produce' || step === 'audio' || step === 'deliver') && hasDelivery && deliveryUrl) {
    return { src: deliveryUrl, play: false, preserveTime: step !== 'produce' };
  }
  return { keep: true };
}

export interface PipelineOverlayInput {
  running?: boolean;
  failed?: boolean;
  label?: string;
  error?: string;
  screenshot?: string;
  log?: string;
}

export interface PipelineOverlay {
  show: boolean;
  tone: '' | 'run' | 'fail';
  title: string;
  detail: string;
  screenshot: string;
  log: string;
}

export function pipelineOverlay({
  running = false,
  failed = false,
  label = '',
  error = '',
  screenshot = '',
  log = '',
}: PipelineOverlayInput = {}): PipelineOverlay {
  if (failed) {
    return { show: true, tone: 'fail', title: error || 'This step failed', detail: label, screenshot, log };
  }
  if (running) return { show: true, tone: 'run', title: label || 'Working', detail: 'The last good preview stays on screen.', screenshot: '', log: '' };
  return { show: false, tone: '', title: '', detail: '', screenshot: '', log: '' };
}
