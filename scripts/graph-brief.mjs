import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function readItems(graphDir, name) {
  const file = path.join(graphDir, 'nodes', `${name}.json`);
  let contents;
  try {
    contents = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const data = JSON.parse(contents);
  if (!Array.isArray(data.items)) throw new Error(`${file}: expected an items array`);
  return data.items;
}

function references(node) {
  return ['basis', 'actorRefs', 'readyChecklist']
    .flatMap((field) => node[field] ?? []);
}

const refKey = ({ type, id }) => `${type}\0${id}`;

export async function readGraphBrief(graphDir) {
  await fs.access(path.join(graphDir, 'project.json'));
  const [actors, requirements, decisions, epics, questions] = await Promise.all([
    readItems(graphDir, 'actors'),
    readItems(graphDir, 'requirements'),
    readItems(graphDir, 'decisions'),
    readItems(graphDir, 'epics'),
    readItems(graphDir, 'questions'),
  ]);

  const exclusions = requirements
    .filter(({ status }) => status === 'excluded')
    .map(({ id, statement }) => ({ requirementId: id, statement }));

  const unsettled = decisions
    .filter(({ status }) => status === 'pending')
    .map((decision) => {
      const subjectRefs = decision.subjectRefs ?? [];
      const subjects = new Set(subjectRefs.map(refKey));
      for (const question of questions) {
        if (subjects.has(refKey({ type: 'question', id: question.id }))) {
          for (const ref of question.affects ?? []) subjects.add(refKey(ref));
        }
      }
      const affected = new Set();
      const projectSubject = subjectRefs.some(({ type }) => type === 'project');

      for (const requirement of requirements) {
        if (projectSubject || subjects.has(refKey({ type: 'requirement', id: requirement.id })) ||
            references(requirement).some((ref) =>
              subjects.has(refKey(ref)) || refKey(ref) === refKey({ type: 'decision', id: decision.id }))) {
          affected.add(requirement.id);
        }
      }
      for (const epic of epics) {
        const hasPendingChecklist = (epic.readyChecklist ?? []).some((ref) =>
          refKey(ref) === refKey({ type: 'decision', id: decision.id }));
        const hasAffectedBasis = (epic.basis ?? []).some((ref) =>
          ref.type !== 'requirement' && subjects.has(refKey(ref)));
        if (subjects.has(refKey({ type: 'epic', id: epic.id })) || hasPendingChecklist || hasAffectedBasis) {
          for (const ref of epic.basis ?? []) {
            if (ref.type === 'requirement') affected.add(ref.id);
          }
        }
      }

      return {
        decisionId: decision.id,
        question: decision.question ?? null,
        subjects: subjectRefs,
        requirementIds: [...affected],
      };
    });

  const unsettledIds = new Set(unsettled.flatMap(({ requirementIds }) => requirementIds));
  const candidates = requirements.filter(({ kind, status }) =>
    kind === 'functional' && (status === 'agreed' || status === 'proposed'));
  const story = [];
  const seen = new Set();
  for (const actor of actors) {
    for (const requirement of candidates) {
      if (seen.has(requirement.id) || !(requirement.actorRefs ?? []).some(({ id }) => id === actor.id)) continue;
      story.push({
        actorId: actor.id,
        actor: actor.name,
        requirementId: requirement.id,
        statement: requirement.statement,
        unsettled: requirement.status === 'proposed' || unsettledIds.has(requirement.id),
      });
      seen.add(requirement.id);
    }
  }

  return { story, exclusions, unsettled };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) {
    console.error('Usage: node graph-brief.mjs <graph-directory>');
    process.exitCode = 2;
  } else {
    try {
      console.log(JSON.stringify(await readGraphBrief(process.argv[2]), null, 2));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
