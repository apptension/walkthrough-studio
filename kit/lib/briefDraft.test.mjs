import assert from 'node:assert/strict';
import { test } from 'node:test';
import { briefDraftPrompt, normalizeBriefDraft, parseBriefDraft } from './briefDraft.mjs';

const brands = [
  { id: 'acme', name: 'Acme', url: 'https://acme.com', ready: true, placeholder: false },
  { id: 'pending', name: 'Pending Co', url: null, ready: false, placeholder: true },
];

test('the prompt carries the description, the start URL, the language, the packs and the output file', () => {
  const prompt = briefDraftPrompt({
    description: 'Wiktor [12:53]\nshow how the agent drafts the script\nthen approve and record',
    startUrl: 'http://localhost:4747',
    language: 'pl',
    brands,
    workspace: '/repo',
    outFile: '/repo/tmp/videos/brief-drafts/job-1.brief.json',
  });
  assert.match(prompt, /show how the agent drafts the script/);
  assert.match(prompt, /Start URL \(where the recording opens\): http:\/\/localhost:4747/);
  assert.match(prompt, /Video language: Polish \(pl\)/);
  assert.match(prompt, /id "acme" · Acme · https:\/\/acme\.com/);
  assert.match(prompt, /id "pending" · Pending Co · \(not ready — do not pick\)/);
  assert.match(prompt, /\/repo\/tmp\/videos\/brief-drafts\/job-1\.brief\.json/);
  assert.match(prompt, /localhost or 127\.0\.0\.1.*sourcePath/s);
  assert.match(prompt, /Never output a password/);
  assert.match(prompt, /Do not run the recorder/);
});

test('parseBriefDraft reads fenced, prefixed and bare JSON, and rejects prose', () => {
  assert.deepEqual(parseBriefDraft('Here it is:\n```json\n{"title":"A"}\n```\nDone.'), { title: 'A' });
  assert.deepEqual(parseBriefDraft('Sure. {"title":"B","story":{"mustShow":["x"]}} ok'), { title: 'B', story: { mustShow: ['x'] } });
  assert.deepEqual(parseBriefDraft('{"title":"C"}'), { title: 'C' });
  assert.equal(parseBriefDraft('I could not find a product.'), null);
  assert.equal(parseBriefDraft('[1,2]'), null);
  assert.equal(parseBriefDraft(''), null);
});

test('normalizeBriefDraft fills every wizard field and coerces enums, URLs and lists', () => {
  const brief = normalizeBriefDraft(
    {
      title: '  Draft the video with the agent  ',
      slug: 'Draft The Video!',
      product: 'Walkthrough Studio',
      audience: 'Teammates who make product videos',
      outcome: 'Turn one description into a reviewed script',
      purpose: 'feature',
      brand: { mode: 'existing', id: 'acme' },
      app: {
        startUrl: 'http://localhost:4747/',
        appUrl: 'not a url',
        marketingUrl: 'https://apptension.com/',
        loginRequired: true,
        email: 'demo@acme.com',
        sourcePath: './kit/studio/',
        notes: 'Cookie banner on first load',
      },
      story: {
        lengthSec: '90',
        tone: 'confident, warm',
        mustShow: ['Open New video', '', 'Paste the description', 'Click Draft the video'],
        keyMessages: 'One line\nTwo line',
        mustSay: [],
        avoid: ['pricing'],
      },
      proof: { plates: ['Features', 'journey', 'bogus', 'features'], stats: [], quotes: [], logos: ['Cursor', 'Claude Code'] },
      confidence: 'HIGH',
      assumptions: ['The brand is Apptension'],
      questions: [],
    },
    { brands, startUrl: 'http://localhost:4747', language: 'en' }
  );
  assert.equal(brief.title, 'Draft the video with the agent');
  assert.equal(brief.slug, 'draft-the-video');
  assert.equal(brief.language, 'en');
  assert.equal(brief.purpose, 'feature');
  assert.deepEqual(brief.brand, { mode: 'existing', id: 'acme' });
  assert.equal(brief.app.startUrl, 'http://localhost:4747');
  assert.equal(brief.app.appUrl, '');
  assert.equal(brief.app.marketingUrl, 'https://apptension.com');
  assert.equal(brief.app.loginRequired, true);
  assert.equal(brief.app.email, 'demo@acme.com');
  assert.equal(brief.app.sourcePath, 'kit/studio');
  assert.equal(brief.story.lengthSec, 90);
  assert.deepEqual(brief.story.mustShow, ['Open New video', 'Paste the description', 'Click Draft the video']);
  assert.deepEqual(brief.story.keyMessages, ['One line', 'Two line']);
  assert.deepEqual(brief.proof.plates, ['features', 'journey']);
  assert.deepEqual(brief.proof.logos, ['Cursor', 'Claude Code']);
  assert.equal(brief.confidence, 'high');
  assert.deepEqual(brief.assumptions, ['The brand is Apptension']);
});

test('an unknown or unready brand becomes a new brand with the marketing site; bad values fall back', () => {
  const brief = normalizeBriefDraft(
    {
      title: 'X',
      purpose: 'nonsense',
      brand: { mode: 'existing', id: 'pending', name: 'Pending Co' },
      app: { marketingUrl: 'https://pending.co', loginRequired: false, email: 'leak@x.com' },
      story: { lengthSec: 75 },
    },
    { brands, startUrl: 'https://app.pending.co', language: 'xx-not-a-language' }
  );
  assert.equal(brief.purpose, 'overview');
  assert.deepEqual(brief.brand, { mode: 'new', name: 'Pending Co', url: 'https://pending.co' });
  assert.equal(brief.app.startUrl, 'https://app.pending.co');
  assert.equal(brief.app.email, '', 'email is dropped when no login is required');
  assert.equal(brief.story.lengthSec, 120);
  assert.equal(brief.language, 'en');
  assert.deepEqual(brief.proof.plates, []);
});

test('a ready pack is matched by name when the agent did not know its id', () => {
  const brief = normalizeBriefDraft({ title: 'X', brand: { mode: 'new', name: 'acme' } }, { brands, startUrl: 'https://acme.com' });
  assert.deepEqual(brief.brand, { mode: 'existing', id: 'acme' });
});

test('an empty object still yields a complete, form-ready shape', () => {
  const brief = normalizeBriefDraft({}, { brands: [], startUrl: 'https://x.io', language: 'de' });
  assert.equal(brief.title, '');
  assert.equal(brief.language, 'de');
  assert.deepEqual(brief.brand, { mode: 'new', name: '', url: '' });
  assert.equal(brief.app.startUrl, 'https://x.io');
  assert.deepEqual(brief.story.mustShow, []);
  assert.deepEqual(Object.keys(brief.proof), ['plates', 'stats', 'quotes', 'logos']);
});
