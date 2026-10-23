import { useEffect } from 'react';

import { wireStatus } from './engine/lifecycle';

/** `#edStatus` — the engine writes the dirty strip (`paintStatus`). */
export function EdStatus() {
  useEffect(() => {
    const ac = new AbortController();
    wireStatus(ac.signal);
    return () => ac.abort();
  }, []);

  return <div id="edStatus" className="ed-status" hidden />;
}
