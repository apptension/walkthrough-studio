import { EdTimeline } from '@/features/editor/EdTimeline';

/** The one timeline: Program's overview of the cut, unfolding into the Editor's tracks. */
export function TimelineShell() {
  return (
    <footer className="timeline-shell" aria-label="Timeline">
      <EdTimeline />
    </footer>
  );
}
