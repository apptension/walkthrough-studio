/** What Program should show after each pipeline step, without waiting for the last one. */

export function marksForProgram({ chapters = [], captureMarks = [] } = {}) {
  if (chapters?.length) return chapters;
  return (captureMarks || []).map((mark) => ({
    start: Number(mark.start ?? mark.t) || 0,
    title: mark.title || mark.label || '',
  }));
}

export function programSourceForStep({ step, hasLive, liveUrl, hasDelivery, deliveryUrl } = {}) {
  if ((step === 'record' || step === 'adopt') && hasLive && liveUrl) return { src: liveUrl, play: true, preserveTime: false };
  if ((step === 'produce' || step === 'audio' || step === 'deliver') && hasDelivery && deliveryUrl) {
    return { src: deliveryUrl, play: false, preserveTime: step !== 'produce' };
  }
  return { keep: true };
}

export function pipelineOverlay({ running = false, failed = false, label = '', error = '', screenshot = '', log = '' } = {}) {
  if (failed) {
    return { show: true, tone: 'fail', title: error || 'This step failed', detail: label, screenshot, log };
  }
  if (running) return { show: true, tone: 'run', title: label || 'Working', detail: 'The last good preview stays on screen.', screenshot: '', log: '' };
  return { show: false, tone: '', title: '', detail: '', screenshot: '', log: '' };
}
