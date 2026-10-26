import { Fragment, useCallback, useEffect, useRef, useState } from 'react';

import { bridges } from '@/desk/bridge';
import { openDialog, useDesk } from '@/desk/store';
import { helpTips } from '@/ui/helpStore';
import { Icon } from '@/ui/icons';
import { onStageClick } from '@/features/stages/actions';
import { useSheetDialog } from '@/features/stages/sheetDialog';

import { GUIDE_NAV, GUIDE_SECTIONS, helpSub, modKeyGlyph, sectionFromScroll, type GuideSection } from './guide';
import { GuideDesk, GuideHow, GuideKeys, GuideWords } from './GuideSections';

function GuideNav({ active, onJump }: { active: GuideSection; onJump: (id: GuideSection) => void }) {
  return (
    <nav
      className="guide-nav"
      id="guideNav"
      aria-label="Guide sections"
      // Keep the jump button from taking focus — browsers scroll ancestors to
      // reveal the focused control and would undo body.scrollTop.
      onMouseDown={(e) => {
        if ((e.target as Element).closest('[data-guide-jump]')) e.preventDefault();
      }}
    >
      {GUIDE_NAV.map((item, i) => (
        <Fragment key={item.id}>
          {i > 0 ? ' ' : null}
          <button
            type="button"
            className={`guide-nav-btn${active === item.id ? ' is-active' : ''}`}
            data-guide-jump={item.id}
            aria-current={active === item.id ? 'true' : undefined}
            onClick={(e) => {
              e.preventDefault();
              onJump(item.id);
            }}
          >
            {item.label}
          </button>
        </Fragment>
      ))}
    </nav>
  );
}

/** `#helpDialog` — the Studio guide. */
export function HelpDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const version = useDesk((s) => s.version);
  const [active, setActive] = useState<GuideSection>(GUIDE_SECTIONS[0]);
  const jumpLock = useRef(0);
  const spyFrame = useRef(0);
  const [mod] = useState(() => modKeyGlyph());

  const onClose = useCallback(() => {
    helpTips.hide();
    window.clearTimeout(jumpLock.current);
    jumpLock.current = 0;
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    setActive(GUIDE_SECTIONS[0]);
  }, []);
  useSheetDialog('help', ref, { onClose });

  const jump = (id: GuideSection) => {
    const body = bodyRef.current;
    const el = document.getElementById(id);
    if (!body || !el) return;
    setActive(id);
    // Instant jump keeps the nav and scroll position in lockstep (smooth scroll
    // was undershooting and letting scroll-spy flip the active section).
    window.clearTimeout(jumpLock.current);
    jumpLock.current = window.setTimeout(() => {
      jumpLock.current = 0;
    }, 320);
    // offsetTop is relative to the dialog (form uses display:contents), not #guideBody.
    const apply = () => {
      body.scrollTop = Math.max(0, el.offsetTop - body.offsetTop - 6);
    };
    apply();
    // The dialog's open transition can reset child scrollTop — re-apply after it.
    requestAnimationFrame(apply);
    window.setTimeout(apply, 240);
  };

  const openStage = (stage: string) => {
    openDialog('help', false);
    // Defer so the dialog teardown finishes before another sheet opens.
    requestAnimationFrame(() => {
      if (bridges.workflow?.openStage) bridges.workflow.openStage(stage);
      else onStageClick(stage);
    });
  };

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const onScroll = () => {
      if (spyFrame.current) return;
      spyFrame.current = requestAnimationFrame(() => {
        spyFrame.current = 0;
        if (jumpLock.current) return;
        const offsets: Partial<Record<GuideSection, number>> = {};
        for (const id of GUIDE_SECTIONS) {
          const el = document.getElementById(id);
          if (el) offsets[id] = el.offsetTop;
        }
        setActive(sectionFromScroll(body, offsets));
      });
    };
    body.addEventListener('scroll', onScroll, { passive: true });
    return () => body.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <dialog ref={ref} id="helpDialog" className="sheet-dialog help" aria-labelledby="helpDialogTitle" aria-describedby="helpDialogSub">
      <form method="dialog" className="sheet-form">
        <header className="sheet-head">
          <span className="sheet-icon" aria-hidden="true">
            <Icon name="ui-ask" size={16} />
          </span>
          <div className="sheet-titles">
            <h2 id="helpDialogTitle">Studio guide</h2>
            <p id="helpDialogSub" className="sheet-sub">
              {helpSub(version)}
            </p>
          </div>
          <button type="submit" className="sheet-close" aria-label="Close guide" title="Close (Esc)">
            <Icon name="ui-x" size={14} />
          </button>
        </header>
        <GuideNav active={active} onJump={jump} />
        <div ref={bodyRef} className="sheet-body guide-body" id="guideBody">
          <GuideHow onStage={openStage} />
          <GuideDesk />
          <GuideWords />
          <GuideKeys mod={mod} />
        </div>
      </form>
    </dialog>
  );
}
