import { useDesk } from '@/desk/store';

export function SafeAreaOverlay() {
  const shown = useDesk((s) => s.reelSafeArea);
  return (
    <div id="safeAreaOverlay" className="safe-area-overlay" hidden={!shown} aria-hidden="true">
      <div className="safe-area-phone">
        <span className="safe-top">
          profile · follow
        </span>
        {' '}
        <span className="safe-side">
          actions
        </span>
        {' '}
        <span className="safe-bottom">
          caption / controls
        </span>
      </div>
      <b>
        9:16 safe area
      </b>
    </div>
  );
}
