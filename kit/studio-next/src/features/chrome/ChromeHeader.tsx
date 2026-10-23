import { bridges } from '@/desk/bridge';
import { useDesk } from '@/desk/store';
import { Icon } from '@/ui/icons';

import { BrandMark } from './BrandMark';
import { ChromeActions } from './ChromeActions';
import { SlugSelect } from './SlugSelect';
import { StatusLine } from './StatusLine';

/** `<header class="chrome">` — brand, sequence picker, project buttons, status and the action cluster. */
export function ChromeHeader() {
  // `loadVideo` reveals Project settings once a sequence has opened.
  const loaded = useDesk((s) => s.video != null);
  return (
    <header className="chrome">
      <BrandMark />
      <label className="chrome-project">
        <span className="sr-only">
          Sequence
        </span>
        {' '}
        <SlugSelect />
      </label>
      {' '}
      <button
        type="button"
        id="btnNewVideo"
        className="btn compact icon-text"
        title="Create a new video from a brief"
        onClick={() => bridges.workflow?.openProjectNew()}
      >
        <Icon name="ui-plus-fill" size={13} />
        {' '}New video
      </button>
      {' '}
      <button
        type="button"
        id="btnProjectSettings"
        className="btn compact icon-text"
        title="Edit the brief and replan"
        hidden={!loaded}
        onClick={() => bridges.workflow?.openProjectSettings()}
      >
        <Icon name="ui-settings" size={13} />
        {' '}Project settings
      </button>
      {' '}
      <button
        type="button"
        id="btnBranch"
        className="btn compact icon-text"
        title="Branch focused feature videos from this overview"
        onClick={() => bridges.workflow?.openBranch()}
      >
        <Icon name="ui-branch" size={13} />
        {' '}Branch
      </button>
      <StatusLine />
      <ChromeActions />
    </header>
  );
}
