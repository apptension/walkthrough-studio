import type { Story } from '@/api/types';
import { useDesk } from '@/desk/store';
import { PanelSection } from '@/ui/PanelSection';

import { setStoryPurpose } from './critic';

const STORY_HELP =
  'What the video is for decides its story spine: the beats, their order and the plates that carry them. The draft, script, narration and plate agents follow it; the critic checks it. Change it here and the next agent pass follows the new spine.';
const GUESSED_TITLE = 'Guessed from the audience line — confirm it so every agent pass follows one spine.';

/** Purpose picker — controlled so a click always matches the saved spine. */
function StoryPurpose({ story }: { story: Story | null }) {
  const purpose = story?.purpose ?? '';
  return (
    <div className="seg story-seg" id="storyPurpose" role="radiogroup" aria-label="Video purpose">
      {story
        ? (story.options || []).map((o) => (
            <label key={o.id} title={`${o.framework} — ${o.hint}`}>
              <input
                type="radio"
                name="storyPurpose"
                value={o.id}
                checked={o.id === purpose}
                onChange={() => void setStoryPurpose(o.id)}
              />
              <span>{o.short || o.label}</span>
            </label>
          ))
        : null}
    </div>
  );
}

function StorySpine({ story }: { story: Story | null }) {
  return (
    <ol id="storySpine" className="story-spine">
      {story
        ? (story.beats || []).map((b, i) => (
            <li key={i} className={b.covered === false ? 'is-gap' : b.covered ? 'is-covered' : ''} title={b.job}>
              <span className="beat-dot" aria-hidden="true" />{' '}
              <strong>{b.id}</strong>
              <em>{b.where}</em>
              {b.plates ? <i>{b.covered ? 'plate in place' : `needs ${b.plates.slice(0, 3).join(' / ')}`}</i> : null}
            </li>
          ))
        : null}
    </ol>
  );
}

/** Review → Story: purpose picker, framework and the spine with plate coverage. */
export function StorySection() {
  const story = useDesk((s) => s.video?.story ?? null);
  return (
    <PanelSection
      id="story"
      icon="story"
      title="Story"
      help={STORY_HELP}
      className="story-section"
      badge={
        <span id="storyBadge" className="badge" hidden={story ? story.explicit : true} title={story ? GUESSED_TITLE : undefined}>
          guessed
        </span>
      }
    >
      <StoryPurpose story={story} />
      <p id="storyFramework" className="story-framework meta">
        {story ? (
          <>
            <strong>{story.label}</strong>
            {` · ${story.framework}`}
          </>
        ) : null}
      </p>
      <StorySpine story={story} />
    </PanelSection>
  );
}
