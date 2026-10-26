import { zen } from './engine/util';

/** The engine owns `#inspectorRoot` (`renderInspector` writes its markup); this is the page-load content. */
const INITIAL = zen('pointer', 'Nothing picked yet 👆', 'Open the Editor and click a clip, a zoom, a voice line or the music. It lands here.', {
  action: '<button type="button" class="ins-btn zen-action" data-open-editor="">Open the Editor</button>',
});

export function InspectorTab() {
  return (
    <div id="rightInspector" className="panel-body inspector" hidden>
      <div id="inspectorRoot" dangerouslySetInnerHTML={{ __html: INITIAL }} />
    </div>
  );
}
