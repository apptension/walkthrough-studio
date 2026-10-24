import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COPY_STYLE_GUIDE,
  cardCopyFixes,
  copyContext,
  copyCorpus,
  explainCopy,
  harmonizeList,
  learnCodeWords,
  learnProperNouns,
  normalizeCopy,
  normalizePlateCopy,
  normalizeTitle,
  plateCopyFixes,
} from './copyCase.mjs';

const ctx = copyContext({ brand: { name: 'Teamdeck' } });
const n = (s, role = 'title', c = ctx) => normalizeCopy(s, role, c);

test('ALL CAPS becomes sentence case and keeps acronyms', () => {
  assert.equal(n('GET STARTED IN MINUTES'), 'Get started in minutes');
  assert.equal(n('SYNC YOUR CRM WITH SSO'), 'Sync your CRM with SSO');
  assert.equal(n('API KEYS IN ONE PLACE'), 'API keys in one place');
  assert.equal(n('SHOW HN'), 'Show HN');
  assert.equal(n('CONNECT GITHUB AND SLACK'), 'Connect GitHub and Slack');
  assert.equal(n('BOOK 40 HOURS IN Q3'), 'Book 40 hours in Q3');
});

test('a single ALL CAPS word may be an acronym and stays', () => {
  assert.equal(n('FAQ'), 'FAQ');
  assert.equal(n('NASA'), 'NASA');
  assert.equal(n('KPIs'), 'KPIs');
});

test('Title Case Headlines become sentence case', () => {
  assert.equal(n('Plan Your Week In Minutes'), 'Plan your week in minutes');
  assert.equal(n('How the Recording Works'), 'How the recording works');
  assert.equal(n('Meet The Team'), 'Meet the team');
  assert.equal(n('Real-Time Sync Across Teams'), 'Real-time sync across teams');
  assert.equal(n('Track KPIs Across Every Team'), 'Track KPIs across every team');
  assert.equal(n('Ship Faster With GitHub Actions'), 'Ship faster with GitHub actions');
});

test('two-word names and mixed casing are left alone', () => {
  assert.equal(n('Revenue Forecast'), 'Revenue Forecast');
  assert.equal(n('Before you hit Record'), 'Before you hit Record');
  assert.equal(n('Open New video'), 'Open New video');
  assert.equal(n('Ask HN'), 'Ask HN');
});

test('proper nouns learned from the corpus survive Title Case fixes', () => {
  const c = copyContext({ corpus: ['See who is booked on Curium today', 'Hours for Constance and Alvis land here'] });
  assert.ok(c.proper.has('Curium'));
  assert.equal(n('Meet Constance And Alvis', 'title', c), 'Meet Constance and Alvis');
  assert.equal(n('Budgets For Curium And Beyond', 'title', c), 'Budgets for Curium and beyond');
});

test('learnProperNouns ignores sentence starts and Title Case sources', () => {
  const found = learnProperNouns(['Plan Your Whole Week', 'Hours land in Teamdeck. Then forecasts follow.']);
  assert.ok(found.has('Teamdeck'));
  assert.ok(!found.has('Then'));
  assert.ok(!found.has('Whole'));
});

test('lowercase sentence starts are capitalised; camelCase and code are not', () => {
  assert.equal(n('open the thread', 'label'), 'Open the thread');
  assert.equal(n('new', 'label'), 'New');
  assert.equal(n('iPhone setup in one tap'), 'iPhone setup in one tap');
  assert.equal(n('eBay listings, synced'), 'eBay listings, synced');
  assert.equal(n('npm install, then run'), 'npm install, then run');
  assert.equal(n('macos and ios builds'), 'macOS and iOS builds');
  assert.equal(n('./studio --v2 opens the desk', 'body'), './studio --v2 opens the desk.');
  assert.equal(n('kit/ and videos/', 'label'), 'kit/ and videos/');
  assert.equal(n('@team gets the invite', 'body'), '@team gets the invite.');
  assert.equal(n('a.md files stay put', 'label'), 'a.md files stay put');
});

test('copy that uses a word as a path keeps it lowercase elsewhere', () => {
  const code = learnCodeWords(['Run ./studio --v2', 'kit/studio-next']);
  assert.ok(code.has('studio') && code.has('kit'));
  const c = copyContext({ corpus: ['Run ./studio --v2'] });
  assert.equal(n('studio', 'label', c), 'studio');
  assert.equal(n('studio-next is where the UI lives.', 'body', c), 'studio-next is where the UI lives.');
});

test('every sentence in a body starts with a capital; abbreviations do not split', () => {
  assert.equal(n('brief first. capture second.', 'body'), 'Brief first. Capture second.');
  assert.equal(n('Pick a tool, e.g. the calendar view', 'body'), 'Pick a tool, e.g. the calendar view.');
  assert.equal(n('Version 2.5 ships today', 'body'), 'Version 2.5 ships today.');
});

test('brand, acronym and camelCase terms are restored mid-sentence', () => {
  assert.equal(n('Hours flow into teamdeck', 'body'), 'Hours flow into Teamdeck.');
  assert.equal(n('Push the branch to github', 'body'), 'Push the branch to GitHub.');
  assert.equal(n('Sign in once with sso', 'body'), 'Sign in once with SSO.');
  assert.equal(n('Take the rest of the day off', 'body'), 'Take the rest of the day off.');
  assert.equal(n('Get it done before lunch', 'body'), 'Get it done before lunch.');
  const multi = copyContext({ brand: { name: 'Hacker News' } });
  assert.equal(n('Read hacker news like a pro', 'title', multi), 'Read Hacker News like a pro');
  assert.equal(n('Fresh news every hour', 'title', multi), 'Fresh news every hour');
});

test('titles, eyebrows and labels drop the closing period; ? and ! stay', () => {
  assert.equal(n('Invite a teammate.'), 'Invite a teammate');
  assert.equal(n('What we cover:', 'eyebrow'), 'What we cover');
  assert.equal(n('Ready to ship?'), 'Ready to ship?');
  assert.equal(n('Done!'), 'Done!');
  assert.equal(n('URL in. Video out.'), 'URL in. Video out.');
  assert.equal(n('Right *thread.*'), 'Right *thread*');
});

test('multi-line titles: staccato periods stay, mixed periods go, line 2 may start lowercase', () => {
  assert.deepEqual(normalizeTitle(['Invite once.', "They're *in.*"], ctx), ['Invite once.', 'They’re *in.*']);
  assert.deepEqual(normalizeTitle(['Find the *right stories*', 'without the feed fog'], ctx), ['Find the *right stories*', 'without the feed fog']);
  assert.deepEqual(normalizeTitle(['This is', '*Walkthrough Studio.*'], ctx), ['This is', '*Walkthrough Studio*']);
  assert.deepEqual(normalizeTitle(['PLAN THE WEEK', 'WITHOUT THE CHAOS'], ctx), ['Plan the week', 'without the chaos']);
  assert.equal(normalizeTitle('Plan Your Whole Week', ctx), 'Plan your whole week');
});

test('bodies end in a period; short fragments, beats and colons do not get one', () => {
  assert.equal(n('See who is free this month', 'body'), 'See who is free this month.');
  assert.equal(n('One action invites them,', 'body'), 'One action invites them.');
  assert.equal(n('Three moves', 'body'), 'Three moves');
  assert.equal(n('*One invite* · the access they need · in minutes', 'body'), '*One invite* · the access they need · in minutes');
  assert.equal(n('Here is what changes:', 'body'), 'Here is what changes:');
  assert.equal(n('The desk we use — *brief to master*', 'body'), 'The desk we use — *brief to master*.');
  assert.equal(n('They said "ship it"', 'body'), 'They said “ship it.”');
});

test('typography: smart quotes, ellipsis, dashes, spaces', () => {
  assert.equal(n("Don't wait", 'label'), 'Don’t wait');
  assert.equal(n('Open the "Reports" tab', 'label'), 'Open the “Reports” tab');
  assert.equal(n("Back to the '90s", 'label'), 'Back to the ’90s');
  assert.equal(n('Wait for it...', 'label'), 'Wait for it…');
  assert.equal(n('Plan  the   week', 'label'), 'Plan the week');
  assert.equal(n('Fast - and honest', 'label'), 'Fast — and honest');
  assert.equal(n('Weeks 1 - 4', 'label'), 'Weeks 1–4');
  assert.equal(n('Ready , set', 'label'), 'Ready, set');
});

test('accent markers pass through every rule', () => {
  assert.equal(n('PLAN THE *WEEK*'), 'Plan the *week*');
  assert.equal(n('*right stories* first', 'label'), '*Right stories* first');
  assert.equal(n('Plan The *Whole* Week'), 'Plan the *whole* week');
});

test('Polish copy: sentence case, Polish quotes, Title Case fixed, no forced English acronyms', () => {
  const pl = copyContext({ language: 'pl' });
  assert.equal(n('Zaplanuj Swój Cały Tydzień', 'title', pl), 'Zaplanuj swój cały tydzień');
  assert.equal(n('ZAPLANUJ TYDZIEŃ ZESPOŁU', 'title', pl), 'Zaplanuj tydzień zespołu');
  assert.equal(n('łatwe planowanie', 'title', pl), 'Łatwe planowanie');
  assert.equal(n('Kliknij "Raporty" i gotowe', 'body', pl), 'Kliknij „Raporty” i gotowe.');
  assert.equal(n('Pszczoły roi się wokół ula', 'body', pl), 'Pszczoły roi się wokół ula.');
  assert.equal(n('Połącz konto z github', 'body', pl), 'Połącz konto z GitHub.');
});

test('German copy: nouns keep their capitals; quotes are German', () => {
  const de = copyContext({ language: 'de' });
  assert.equal(n('Planen Sie Ihre Woche Neu', 'title', de), 'Planen Sie Ihre Woche Neu');
  assert.equal(n('Die Woche Im Blick', 'title', de), 'Die Woche Im Blick');
  assert.equal(n('ÜBERSICHT FÜR DAS TEAM', 'title', de), 'Übersicht für das team');
  assert.equal(n('Öffnen Sie "Berichte"', 'body', de), 'Öffnen Sie „Berichte“.');
  assert.equal(n('über die Woche', 'label', de), 'Über die Woche');
});

test('quotes, names and raw figures are never recased', () => {
  assert.equal(n('THIS CHANGED HOW WE PLAN', 'quote'), 'THIS CHANGED HOW WE PLAN');
  assert.equal(n("it's the best tool we've used", 'quote'), 'it’s the best tool we’ve used');
  assert.equal(n('ana ruiz', 'name'), 'ana ruiz');
  assert.equal(n('€1.2M', 'raw'), '€1.2M');
  assert.equal(n('4.8★', 'raw'), '4.8★');
});

test('non-strings, templates and markup pass through', () => {
  assert.equal(n(null), null);
  assert.equal(n(undefined), undefined);
  assert.equal(n(''), '');
  assert.equal(n('{{TITLE}}'), '{{TITLE}}');
  assert.equal(n('<b>BOLD MOVE</b>'), '<b>BOLD MOVE</b>');
});

test('harmonizeList: the majority closing style wins, ties drop the period', () => {
  assert.deepEqual(harmonizeList(['Link your tools.', 'Set up teams.', 'Run the week']), ['Link your tools.', 'Set up teams.', 'Run the week.']);
  assert.deepEqual(harmonizeList(['Link your tools.', 'Set up teams']), ['Link your tools', 'Set up teams']);
  assert.deepEqual(harmonizeList(['One', undefined, 'Two.']), ['One', undefined, 'Two']);
});

test('normalizePlateCopy cleans every viewer-facing field and leaves structure alone', () => {
  const plate = {
    id: 'how',
    type: 'process',
    before: 'Plan The Week',
    eyebrow: 'HOW IT WORKS',
    title: 'Three Steps To A Calm Week.',
    sub: 'connect once  and the rest follows',
    motion: { atmosphere: 'grid' },
    steps: [
      { label: 'connect your CRM.', note: 'Hours land on the forecast.' },
      { label: 'SET UP TEAMS', note: 'Roles in one place.' },
      { label: 'Run The Whole Week', note: 'Nothing to chase' },
    ],
  };
  const out = normalizePlateCopy(plate, ctx);
  assert.notEqual(out, plate);
  assert.equal(plate.eyebrow, 'HOW IT WORKS');
  assert.equal(out.before, 'Plan The Week');
  assert.deepEqual(out.motion, { atmosphere: 'grid' });
  assert.equal(out.eyebrow, 'How it works');
  assert.equal(out.title, 'Three steps to a calm week');
  assert.equal(out.sub, 'Connect once and the rest follows.');
  assert.deepEqual(
    out.steps.map((s) => s.label),
    ['Connect your CRM', 'Set up teams', 'Run the whole week']
  );
  assert.deepEqual(
    out.steps.map((s) => s.note),
    ['Hours land on the forecast.', 'Roles in one place.', 'Nothing to chase.']
  );
});

test('statement titles are recased but keep their closing period', () => {
  const out = normalizePlateCopy({ type: 'statement', title: ['ONE PLAN THE TEAM', '*ACTUALLY* FOLLOWS.'] }, ctx);
  assert.deepEqual(out.title, ['One plan the team', '*actually* follows.']);
});

test('normalizePlateCopy: quotes verbatim, logos and team names untouched, faq answers are bodies', () => {
  const quotes = normalizePlateCopy(
    { type: 'testimonials', title: 'WHAT TEAMS SAY', quotes: [{ quote: 'WE SHIP "FASTER"', author: 'ana ruiz', role: 'COO' }] },
    ctx
  );
  assert.equal(quotes.title, 'What teams say');
  assert.equal(quotes.quotes[0].quote, 'WE SHIP “FASTER”');
  assert.equal(quotes.quotes[0].author, 'ana ruiz');
  const logos = normalizePlateCopy({ type: 'logos', title: 'Works with', logos: [{ asset: 'a.png', label: 'monday.com' }] }, ctx);
  assert.equal(logos.logos[0].label, 'monday.com');
  const team = normalizePlateCopy({ type: 'team', title: 'Who plans', items: [{ label: 'de la Cruz', note: 'VP of ops' }] }, ctx);
  assert.equal(team.items[0].label, 'de la Cruz');
  const faq = normalizePlateCopy({ type: 'faq', title: 'Questions', items: [{ label: 'does it scrape my app?', note: 'no — it records a real browser' }] }, ctx);
  assert.equal(faq.items[0].label, 'Does it scrape my app?');
  assert.equal(faq.items[0].note, 'No — it records a real browser.');
});

test('normalizePlateCopy: compare columns, bullets, pills, checklist strings, pricing tiers', () => {
  const cmp = normalizePlateCopy(
    { type: 'compare', title: 'From Chaos To Calm', left: { label: 'BEFORE', items: ['spreadsheets everywhere.', 'status meetings'] }, right: { label: 'after', title: 'One Shared Plan', items: ['One board'] } },
    ctx
  );
  assert.equal(cmp.title, 'From chaos to calm');
  assert.equal(cmp.left.label, 'BEFORE');
  assert.equal(cmp.right.label, 'After');
  assert.equal(cmp.right.title, 'One shared plan');
  assert.deepEqual(cmp.left.items, ['Spreadsheets everywhere', 'Status meetings']);
  const callout = normalizePlateCopy({ type: 'callout', title: 'Why', bullets: ['open via N comments.', 'stay on HN.', 'Headline alone misleads'] }, ctx);
  assert.deepEqual(callout.bullets, ['Open via N comments.', 'Stay on HN.', 'Headline alone misleads.']);
  const metric = normalizePlateCopy({ type: 'metric', title: 'Saved', value: '$10,000', unit: 'per *month*', pills: ['ONE PLAN FOR ALL', '*Two*'] }, ctx);
  assert.equal(metric.value, '$10,000');
  assert.equal(metric.unit, 'per *month*');
  assert.deepEqual(metric.pills, ['One plan for all', '*Two*']);
  const check = normalizePlateCopy({ type: 'checklist', title: 'Done', items: ['changes land.', { label: 'leaders get it', note: 'no asking' }] }, ctx);
  assert.deepEqual(check.items, ['Changes land', { label: 'Leaders get it', note: 'No asking' }]);
  const pricing = normalizePlateCopy(
    { type: 'pricing', title: 'Plans', tiers: [{ label: 'pro', value: '$12', period: '/mo', badge: 'MOST POPULAR', items: ['unlimited projects.', 'SSO'] }] },
    ctx
  );
  assert.equal(pricing.tiers[0].label, 'pro');
  assert.equal(pricing.tiers[0].period, '/mo');
  assert.equal(pricing.tiers[0].badge, 'Most popular');
  assert.deepEqual(pricing.tiers[0].items, ['Unlimited projects', 'SSO']);
});

test('plateCopyFixes and cardCopyFixes report field, before and after', () => {
  const fixes = plateCopyFixes({ type: 'features', eyebrow: 'AT A GLANCE', title: ['Plan The Week.', 'Ship On Time'], items: [{ label: 'calendar' }] }, ctx);
  assert.deepEqual(
    fixes.map((f) => [f.field, f.to]),
    [
      ['eyebrow', 'At a glance'],
      ['title', 'Plan the week / Ship on time'],
      ['items.0.label', 'Calendar'],
    ]
  );
  const cards = cardCopyFixes({ title: 'BOOK A TEAMMATE', body: 'see who is free this month' }, ctx);
  assert.equal(cards[0].to, 'Book a teammate');
  assert.ok(cards[0].fixes.includes('ALL CAPS → sentence case'));
  assert.equal(cards[1].to, 'See who is free this month.');
  assert.deepEqual(cardCopyFixes({ title: 'Book a teammate', body: 'See who is free.' }, ctx), []);
});

test('explainCopy names each fix', () => {
  const r = explainCopy('Plan Your Week In Minutes.', 'title', ctx);
  assert.equal(r.changed, true);
  assert.deepEqual(r.fixes.sort(), ['Title Case → sentence case', 'dropped closing punctuation'].sort());
  assert.equal(explainCopy('Plan the week', 'title', ctx).changed, false);
});

test('already clean copy is a fixed point', () => {
  for (const [s, role] of [
    ['Invite a teammate', 'title'],
    ['One action invites them with the access they need.', 'body'],
    ['*One invite* · the access they need · in minutes', 'body'],
    ['Pick the access they need in one go', 'note'],
  ]) {
    assert.equal(n(s, role), s);
    assert.equal(n(n(s, role), role), n(s, role));
  }
});

test('copyCorpus collects plate copy, not ids, motion or assets', () => {
  const corpus = copyCorpus({
    title: 'Probe',
    open: { eyebrow: 'Hi', title: ['A', 'B'], motion: { atmosphere: 'grid' } },
    interstitials: [{ id: 'x', type: 'logos', before: 'Chapter', logos: [{ asset: 'a.png', label: 'Acme' }] }],
  });
  assert.deepEqual(corpus.sort(), ['A', 'Acme', 'B', 'Hi', 'Probe'].sort());
});

test('live cards show house-style copy but keep the authored text as the edit source', async () => {
  const { renderLiveCardHtml } = await import('./liveCards.mjs');
  const brand = {
    name: 'Teamdeck',
    colors: { ink: '#0a0a0a', surface: '#121412', gold: '#FFFE25', amber: '#42F272', muted: '#94a3b8', text: '#f8fafc', onAccent: '#111' },
    font: { family: 'Inter', css: 'https://fonts.example/inter.css' },
    motion: {},
    direction: {},
  };
  const ch = renderLiveCardHtml(brand, 'chapter', { chapterNo: 1, title: 'PLAN THE WEEK', body: 'see who is free in teamdeck', ms: 2400 });
  assert.match(ch, /<span class="mask"><span>Plan the week<\/span><\/span>/);
  assert.match(ch, /data-edit-raw="PLAN THE WEEK"/);
  assert.match(ch, />See who is free in Teamdeck\.<\/p>/);
  const cap = renderLiveCardHtml(brand, 'caption', { chapterNo: 1, chapterTitle: 'Plan The Whole Week', title: 'open reports.', ms: 2000 });
  assert.match(cap, /data-edit="eyebrow"[^>]*>Plan the whole week</);
  assert.match(cap, /<span class="mask"><span>Open reports<\/span><\/span>/);
});

test('script lint and critic offer the house-style rewrite', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { buildScript } = await import('./script.mjs');
  const { critiqueCopyStyle } = await import('./critic.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'copy-case-'));
  try {
    writeFileSync(
      join(dir, 'flow.mjs'),
      `export default async function flow(page, { chapter, say }) {\n  await chapter('Plan The Whole Week', 'see who is free');\n  await say('Open reports', 'Hours land on the forecast.');\n}\n`
    );
    const config = {
      title: 'Demo',
      open: { eyebrow: 'PRODUCT WALKTHROUGH', title: ['Plan the week', 'with your team'], sub: 'One plan' },
      close: { title: ['Plan once.', 'Ship *on time.*'], steps: [{ label: 'Plan' }, { label: 'Ship' }] },
      interstitials: [{ id: 'pillars', type: 'features', before: 'Plan The Whole Week', title: 'What You Get.', items: [{ label: 'a' }, { label: 'b' }, { label: 'c' }] }],
    };
    const script = await buildScript({ dir, slug: 'demo', out: dir, config, brand: { name: 'Demo' } });
    const style = script.lint.filter((l) => l.fix);
    const byKey = Object.fromEntries(style.map((l) => [`${l.key}|${l.fix.field}`, l.fix.text]));
    assert.equal(byKey['open|eyebrow'], 'Product walkthrough');
    assert.equal(byKey['plate:pillars|title'], 'What you get');
    assert.equal(byKey['chapter:Plan The Whole Week|title'], 'Plan the whole week');
    assert.equal(byKey['chapter:Plan The Whole Week|body'], 'See who is free.');
    assert.ok(!style.some((l) => l.key === 'close'), 'staccato close title is already house style');
    assert.ok(style.every((l) => l.level === 'info' && l.message.startsWith('Copy style')));
    const findings = critiqueCopyStyle(script.scenes);
    const f = findings.find((x) => x.target === 'pillars.title');
    assert.equal(f.suggestion, 'What you get');
    assert.equal(f.severity, 'low');
    assert.deepEqual(f.apply, { type: 'copy', plateId: 'pillars', flowIndex: undefined, field: 'title', text: 'What you get' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('COPY_STYLE_GUIDE states the casing, length and voice rules', () => {
  for (const needle of ['Sentence case', 'ALL CAPS', 'API', 'no closing period', '≤5 words', 'Active voice', 'outcome', 'Parallel structure', 'jargon']) {
    assert.ok(COPY_STYLE_GUIDE.includes(needle), needle);
  }
});
