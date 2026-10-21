import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const root = join(tmpdir(), `wt-branch-${Date.now()}`);
process.env.WALKTHROUGH_VIDEOS = join(root, 'videos');
process.env.WALKTHROUGH_BRANDS = join(root, 'brands');
process.env.WALKTHROUGH_OUT = join(root, 'out');

mkdirSync(join(root, 'brands', 'demo'), { recursive: true });
writeFileSync(
  join(root, 'brands', 'demo', 'brand.json'),
  JSON.stringify({
    name: 'Demo',
    colors: { ink: '#111111', surface: '#222222', gold: '#c9a227', amber: '#e8c547', teal: '#3d8b8b' },
    font: { family: 'Inter', css: 'data:text/css,' },
    logo: 'logo.html',
  }) + '\n'
);
writeFileSync(join(root, 'brands', 'demo', 'logo.html'), '<div>Demo</div>\n');

const sourceDir = join(root, 'videos', 'demo-overview');
mkdirSync(sourceDir, { recursive: true });
writeFileSync(
  join(sourceDir, 'video.config.json'),
  JSON.stringify({
    title: 'Demo overview',
    brand: 'demo',
    purpose: 'overview',
    audience: 'New users',
    record: { startUrl: 'https://example.com/app' },
    env: { email: '$DEMO_EMAIL' },
    interstitials: [{ id: 'why', type: 'features', title: 'Why Demo', before: 'Invite' }],
    open: { title: ['Welcome'] },
    close: { title: 'Done', steps: ['One', 'Two', 'Three'] },
  }) + '\n'
);
writeFileSync(
  join(sourceDir, 'brief.json'),
  JSON.stringify({
    version: 1,
    title: 'Demo overview',
    product: 'Demo',
    audience: 'New users',
    outcome: 'Invite a teammate',
    purpose: 'overview',
    lengthSec: 120,
    story: {
      mustShow: ['Invite a teammate', 'Share a board'],
      keyMessages: ['One invite, every workspace'],
      mustSay: [],
      avoid: [],
    },
    proof: { plates: ['features'], stats: [], quotes: [], logos: [] },
    app: { startUrl: 'https://example.com/app', loginRequired: true, envVars: ['DEMO_EMAIL'] },
    brand: { id: 'demo', mode: 'existing' },
  }) + '\n'
);
writeFileSync(
  join(sourceDir, 'flow.mjs'),
  `export default async function flow({ chapter, say }) {\n  await chapter('Invite', 'Bring someone in');\n  await say('Send invite', 'Mail goes out');\n}\n`
);
writeFileSync(join(sourceDir, 'narration.mjs'), `export default { intro: 'Hi', lines: { Invite: 'Invite them.' } };\n`);
writeFileSync(join(sourceDir, 'flow-analysis.md'), '# Analysis\n');

const {
  createBranch,
  ensureFolder,
  listFoldersWithVideos,
  mergeBranchIdeas,
  readBranchIdeas,
  readLibrary,
  suggestBranchIdeas,
  writeBranchIdeas,
} = await import('./branch.mjs');
const { loadVideo } = await import('./project.mjs');

test.after(() => rmSync(root, { recursive: true, force: true }));

test('heuristic ideas come from brief beats, plates and chapters', () => {
  const video = loadVideo('demo-overview');
  const ideas = suggestBranchIdeas(video);
  assert.ok(ideas.ideas.length >= 3);
  assert.ok(ideas.ideas.some((i) => /Invite/i.test(i.title)));
  assert.ok(ideas.ideas.every((i) => i.purpose === 'feature' || i.lengthSec === 90 || i.title));
});

test('createBranch copies sources, sets lineage and retargets the brief', () => {
  const result = createBranch('demo-overview', {
    idea: {
      id: 'invite-deep',
      title: 'Inviting teammates',
      angle: 'Stay on invites until they land',
      outcome: 'Send an invite without leaving the people page',
      mustShow: ['Open People', 'Send invite'],
      purpose: 'feature',
      lengthSec: 90,
      plates: ['features', 'callout'],
    },
  });
  assert.equal(result.slug, 'inviting-teammates');
  assert.equal(result.branchedFrom, 'demo-overview');
  assert.ok(result.folderId);

  const child = loadVideo(result.slug);
  assert.equal(child.config.title, 'Inviting teammates');
  assert.equal(child.config.purpose, 'feature');
  assert.equal(child.config.lineage.branchedFrom, 'demo-overview');
  assert.equal(JSON.parse(readFileSync(join(child.dir, 'video.config.json'), 'utf8')).env.email, '$DEMO_EMAIL');
  assert.ok(readFileSync(join(child.dir, 'flow.mjs'), 'utf8').includes('chapter'));
  assert.ok(readFileSync(join(child.dir, 'flow-analysis.md'), 'utf8').includes('Analysis'));

  const brief = JSON.parse(readFileSync(join(child.dir, 'brief.json'), 'utf8'));
  assert.equal(brief.branch.sourceSlug, 'demo-overview');
  assert.deepEqual(brief.story.mustShow, ['Open People', 'Send invite']);

  const source = loadVideo('demo-overview');
  assert.equal(source.config.lineage.folderId, result.folderId);
  assert.equal(readLibrary().folders[0].rootSlug, 'demo-overview');
});

test('createBranch auto-suffixes when the slug is already taken', () => {
  const again = createBranch('demo-overview', {
    idea: {
      id: 'invite-deep-2',
      title: 'Inviting teammates',
      angle: 'Second take on invites',
      outcome: 'Invite again',
      mustShow: ['Invite'],
      purpose: 'feature',
      lengthSec: 90,
      plates: ['features'],
    },
  });
  assert.equal(again.slug, 'inviting-teammates-2');
  assert.equal(again.branchedFrom, 'demo-overview');
});

test('folders group root and branches for the picker', () => {
  ensureFolder('demo-overview');
  const summaries = [
    { slug: 'demo-overview', title: 'Demo overview', lineage: lineageOf('demo-overview') },
    { slug: 'inviting-teammates', title: 'Inviting teammates', lineage: lineageOf('inviting-teammates') },
    { slug: 'orphan', title: 'Orphan', lineage: null },
  ];
  const { folders, loose } = listFoldersWithVideos(summaries);
  assert.equal(folders.length, 1);
  assert.equal(folders[0].videos[0].slug, 'demo-overview');
  assert.ok(folders[0].videos.some((v) => v.slug === 'inviting-teammates'));
  assert.deepEqual(
    loose.map((v) => v.slug),
    ['orphan']
  );
});

test('agent ideas merge over heuristics with the same id', () => {
  const video = loadVideo('demo-overview');
  const heuristic = suggestBranchIdeas(video);
  const agent = writeBranchIdeas(video, {
    ideas: [{ id: heuristic.ideas[0].id, title: heuristic.ideas[0].title, angle: 'Agent angle', source: 'agent' }],
  });
  const merged = mergeBranchIdeas(heuristic, agent);
  assert.equal(merged.ideas.find((i) => i.id === heuristic.ideas[0].id).angle, 'Agent angle');
  assert.equal(readBranchIdeas(video).ideas[0].angle, 'Agent angle');
});

function lineageOf(slug) {
  try {
    return loadVideo(slug).config.lineage
      ? {
          folderId: loadVideo(slug).config.lineage.folderId,
          rootSlug: loadVideo(slug).config.lineage.rootSlug,
          branchedFrom: loadVideo(slug).config.lineage.branchedFrom || null,
          role: loadVideo(slug).config.lineage.branchedFrom ? 'branch' : 'root',
          folderTitle: 'Demo',
        }
      : null;
  } catch {
    return null;
  }
}
