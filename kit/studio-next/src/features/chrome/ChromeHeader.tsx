import { bridges } from '@/desk/bridge';
import { useDesk } from '@/desk/store';
import { Icon } from '@/ui/icons';

import { BrandMark } from './BrandMark';
import { ChromeActions } from './ChromeActions';
import { SlugSelect } from './SlugSelect';

/** `<header class="chrome">` — brand, sequence picker, project buttons and the action cluster (status lives on Render). */
export function ChromeHeader() {
  // `loadVideo` reveals Project settings once a sequence has opened.
  const loaded = useDesk((s) => s.video != null);
  return (
    <header className="chrome">
      <div className="chrome-main">
        <BrandMark />
        <div className="chrome-nav">
          <div className="chrome-sequence" role="group" aria-label="Current sequence">
            <label className="chrome-project">
              <span className="sr-only">
                Sequence
              </span>
              {' '}
              <SlugSelect />
            </label>
            <button
              type="button"
              id="btnProjectSettings"
              className="btn compact icon-text"
              title="Project settings"
              aria-label="Project settings"
              hidden={!loaded}
              onClick={() => bridges.workflow?.openProjectSettings()}
            >
              <Icon name="ui-settings" size={13} />
              {' '}
              <span className="btn-label">
                Project settings
              </span>
            </button>
            <button
              type="button"
              id="btnBranch"
              className="btn compact icon-text"
              title="Branch"
              aria-label="Branch"
              onClick={() => bridges.workflow?.openBranch()}
            >
              <Icon name="ui-branch" size={13} />
              {' '}
              <span className="btn-label">
                Branch
              </span>
            </button>
          </div>
          <button
            type="button"
            id="btnNewVideo"
            className="btn compact icon-text chrome-new"
            title="Create a new video from a brief"
            aria-label="New video"
            onClick={() => bridges.workflow?.openProjectNew()}
          >
            <svg width="0" height="0" aria-hidden="true" className="chrome-new-grad">
              <defs>
                <linearGradient id="chromeNewGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#fffe25" />
                  <stop offset="34%" stopColor="#c6f24a" />
                  <stop offset="72%" stopColor="#42f272" />
                  <stop offset="100%" stopColor="#42f272" />
                </linearGradient>
                <linearGradient id="chromeNewGradHot" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#fff56b" />
                  <stop offset="34%" stopColor="#d4ff62" />
                  <stop offset="72%" stopColor="#6af58c" />
                  <stop offset="100%" stopColor="#6af58c" />
                </linearGradient>
              </defs>
            </svg>
            <Icon name="ui-plus-fill" size={14} className="chrome-new-ico" />
            {' '}
            <span className="btn-label">
              New video
            </span>
          </button>
        </div>
      </div>
      <ChromeActions />
    </header>
  );
}
