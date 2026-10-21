## Where the storyboard comes from

The repo almost always knows what the video should contain. Read these before
deciding anything, in roughly this order of authority:

1. **What the user asked for.** A named flow beats every inference below.
2. **A brief or goal document** — `poc-goal-brief.md`, `docs/brief.md`, a pasted
   client brief. It states who the demo is for and what it has to prove, which is
   exactly the question a storyboard answers. Read it first when it exists.
3. **A demo run-book in the README.** Some POCs ship the meeting script itself: a
   numbered "how the demo runs" section. When you find one, that *is* the
   storyboard unless the brief says otherwise. It was written by someone who
   knew which beats land.
4. **A Project Graph directory**, when the user names one or the PoC is under
   an estimate workspace with `<estimate>/graph/`. Run the reader below. Its
   Actors and functional Requirements give a candidate story when there is no
   handwritten order; excluded Requirements and pending Decisions constrain
   what the recording can claim either way.
5. **The route list.** A README table, or enumerate the router yourself:
   `app/**/page.tsx`, `pages/`, a react-router config, `urls.py`, the nav
   component. Every route then either earns a place in the story or is skipped on
   purpose — no route should be missed by accident.
6. **Smoke or E2E tests.** `scripts/smoke.sh`, Playwright/Cypress specs. These are
   the happy path in executable form, and the assertions tell you which edge cases
   someone already judged worth proving.
7. **Recent commits — only when the audience already knows the product.** For a
   sprint review or a milestone demo, what shipped since last time *is* the
   story. For presales, a portfolio piece or a first showing, it is the wrong
   filter entirely: nobody has seen any of it, so the walkthrough covers the whole
   thing and recent work earns no special billing. Default to complete coverage
   and let the audience narrow it.

Read the **exclusion list** too. Most POC READMEs carry a "deliberately not
included" section; it is the cheapest protection against narrating a capability
the build does not have, and it tells you which questions the video will provoke
so you can decide whether a caption should pre-empt them.

For a Project Graph, pass its directory to the bundled skill script. It reads
`nodes/actors.json`, `nodes/requirements.json`, `nodes/decisions.json`,
`nodes/epics.json`, and `nodes/questions.json` directly and writes nothing to
the graph. `project.json` identifies the graph; absent node collection files
count as empty:

```bash
node <SKILL_DIR>/scripts/graph-brief.mjs <graph-directory>
```

The `story` array groups agreed and proposed functional Requirements under their
Actors in graph order. Each item carries the Actor, Requirement, statement, and
an `unsettled` flag; proposed Requirements are unsettled. `exclusions` lists
excluded Requirements of every kind. `unsettled` lists pending Decisions with
their questions, typed subjects, and affected Requirement IDs. A Decision can
name an Epic or a Question that affects a Requirement; follow those references
before deciding which steps remain unsettled. Treat this output as a storyboard
candidate, then check which steps the running app actually performs.

When a handwritten brief and the graph disagree about order, scope, or what to
show, follow the brief. A brief cannot settle a pending graph Decision. Keep its
subject out of completed-step titles, captions, and the closing card; show only
verified visible behavior with its uncertainty stated, or leave that beat out.
Review every pending Decision in `unsettled`, including subjects without an
affected Requirement ID, before recording. Resolve those typed subjects in the
graph JSON so an unmapped subject does not become a completion claim by accident.

Know who is watching, since it decides both scope and depth. A first showing to a
prospect covers the product end to end; a sprint review covers the increment. The
person deciding the budget wants the flow and the guarantees; their engineers want
the mechanics. When the sources disagree, the brief wins.

If several plausible flows remain after all that, state the storyboard you intend
to record and start. A wrong caption costs one re-recorded segment, and people
redirect far faster from concrete frames than from a question.

## Storyboard, then code

Write the segment list before the script. One segment per page the story visits;
one caption per idea. A segment that shows three things needs three captions,
not one long sentence.

