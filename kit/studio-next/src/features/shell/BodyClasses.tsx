import { useEffect } from 'react';

import { useDesk } from '@/desk/store';

/**
 * The desk-wide body classes the legacy stylesheet keys off. The editor sets its
 * own (`is-editor`, `is-live-card`, `is-editing-text`) and the resize handles set
 * `is-resizing*` and `tl-collapsed` directly, as they did in `app.js`.
 */
export function BodyClasses() {
  const rendering = useDesk((s) => s.isRendering);
  const activity = useDesk((s) => s.hasActivity);
  useEffect(() => {
    document.body.classList.toggle('is-rendering', rendering);
  }, [rendering]);
  useEffect(() => {
    document.body.classList.toggle('has-activity', activity);
  }, [activity]);
  return null;
}
