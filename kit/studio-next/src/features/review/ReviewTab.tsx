import { QualityChecks } from './QualityChecks';
import { StorySection } from './StorySection';
import { StoryReview } from './StoryReview';

/** `#rightReview`: story spine, persona critic and quality checks.
 *  Chapters live on the timeline — the Review list was a duplicate jumper. */
export function ReviewTab() {
  return (
    <div id="rightReview" className="panel-body" hidden>
      <StorySection />
      <StoryReview />
      <QualityChecks />
    </div>
  );
}
