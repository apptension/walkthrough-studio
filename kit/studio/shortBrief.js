/** One description becomes an editable draft. Nothing here records. */

function httpUrl(value) {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) {
    const error = new Error('Start URL must be a full http(s) URL.');
    error.field = 'shortStartUrl';
    throw error;
  }
  return raw;
}

export function draftFromDescription({ description, startUrl } = {}) {
  const text = String(description || '').trim();
  if (!text) {
    const error = new Error('Describe what to show, for whom, and about how long');
    error.field = 'description';
    throw error;
  }
  const chapters = text
    .split(/\n+|\s+then\s+|\s*;\s*/i)
    .map((part) => part.replace(/[,\s]+$/g, '').trim())
    .filter(Boolean)
    .slice(0, 6);
  const audience = /for ([^.]+)/i.exec(text)?.[1]?.trim() || '';
  let purpose = 'overview';
  if (/onboard|how to|admin/i.test(text)) purpose = 'onboarding';
  else if (/launch|release/i.test(text)) purpose = 'launch';
  else if (/sales|buyer/i.test(text)) purpose = 'sales';
  else if (/feature/i.test(text)) purpose = 'feature';
  let lengthSec = 120;
  if (/a minute|1 min|60 ?s(?:ec)?/i.test(text)) lengthSec = 60;
  else if (/90|minute and a half/i.test(text)) lengthSec = 90;
  else if (/3 min|three min/i.test(text)) lengthSec = 180;
  const proof = /stat|percent|%/i.test(text) ? ['stats'] : /quote|customer said/i.test(text) ? ['quote'] : ['features'];
  return {
    title: chapters[0].split(/\s+/).slice(0, 8).join(' '),
    audience,
    purpose,
    lengthSec,
    chapters,
    proof,
    startUrl: httpUrl(startUrl),
    records: false,
  };
}
