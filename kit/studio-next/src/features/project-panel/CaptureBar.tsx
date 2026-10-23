import { useEffect, useRef, useState, type MouseEvent } from 'react';

import { bridges } from '@/desk/bridge';
import { useDesk } from '@/desk/store';
import { Icon } from '@/ui/icons';
import { captureSummary } from '@/logic/queueUx';

import { saveRecordTarget } from './recordTarget';

/**
 * `#captureBar` — the quiet "Opens …" line: start URL and sign-in flag for the
 * next recording, plus the project settings cog. Inputs are uncontrolled; a
 * summary repaint never overwrites the field the user is typing in.
 */
export function CaptureBar() {
  const freshness = useDesk((s) => s.video?.freshness);
  const urlRef = useRef<HTMLInputElement>(null);
  const loginRef = useRef<HTMLInputElement>(null);
  const [summary, setSummary] = useState('No start URL yet');
  const [status, setStatus] = useState({ hidden: true, text: '' });
  const saveRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!freshness) return;
    const startUrl = freshness.startUrl || '';
    const url = urlRef.current;
    const login = loginRef.current;
    if (url && document.activeElement !== url) url.value = startUrl;
    if (login && document.activeElement !== login) login.checked = Boolean(freshness.loginRequired);
    if (document.activeElement !== url) setSummary(captureSummary(startUrl, freshness.loginRequired));
  }, [freshness]);

  useEffect(() => {
    const save = () => {
      void saveRecordTarget({
        startUrl: urlRef.current?.value ?? '',
        loginRequired: Boolean(loginRef.current?.checked),
      }).then((next) => {
        if (next === null) setStatus((prev) => ({ ...prev, hidden: true }));
        else if (next !== undefined) setStatus({ hidden: false, text: next });
      });
    };
    const url = urlRef.current;
    const login = loginRef.current;
    url?.addEventListener('change', save);
    login?.addEventListener('change', save);
    saveRef.current = save;
    return () => {
      url?.removeEventListener('change', save);
      login?.removeEventListener('change', save);
    };
  }, []);

  const showCapture = Boolean(freshness && (freshness.liveAt || freshness.startUrl));

  const openSettings = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    bridges.workflow?.openProjectSettings();
  };

  return (
    <div id="captureBar" className="capture-bar" hidden={!showCapture}>
      <details id="recordTarget" className="capture-line">
        <summary title="Edit start URL">
          <span className="capture-kicker">Opens</span> <span id="recordTargetSummary">{summary}</span>{' '}
          <span className="capture-chevron" aria-hidden="true">
            <Icon name="ui-chevron" size={14} />
          </span>
        </summary>
        <form
          id="recordTargetForm"
          className="record-target"
          onSubmit={(e) => {
            e.preventDefault();
            saveRef.current();
          }}
        >
          <label className="wf">
            <span className="field-label">Start URL</span>
            <input ref={urlRef} id="recordStartUrl" type="url" inputMode="url" spellCheck="false" autoComplete="off" />
          </label>{' '}
          <label className="tog">
            <input ref={loginRef} type="checkbox" id="recordLoginRequired" />
            <span>Sign-in required</span>
          </label>
          <p id="recordTargetStatus" className="capture-status" hidden={status.hidden}>
            {status.text}
          </p>
        </form>
      </details>
      <button type="button" id="btnCaptureSettings" className="capture-cog" title="Project settings" aria-label="Project settings" onClick={openSettings}>
        <Icon name="ui-settings" size={15} />
      </button>
    </div>
  );
}
