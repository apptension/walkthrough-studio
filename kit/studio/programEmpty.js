/**
 * Copy + CTAs for the Program monitor empty state.
 * Mirrors decideAction so the center pane always says what to do next.
 */

/** Busy Program empty state while a render pass is running. */
export function programEmptyBusyView(action = {}) {
  return {
    tone: 'run',
    icon: 'empty-play',
    kicker: 'Rendering',
    title: action.title || 'Rendering your sequence',
    reason: action.reason || 'Watch the pipeline on the left — Program updates when this pass finishes.',
    primary: null,
    secondary: null,
  };
}

export function programEmptyView(action) {
  if (action?.busy || /^rendering\b/i.test(String(action?.status || ''))) {
    return programEmptyBusyView(action);
  }

  const primary = action?.primary || { label: 'Render', mode: 'full' };
  const secondary = action?.secondary || null;

  if (!action?.title) {
    return {
      tone: 'ready',
      icon: 'empty-play',
      kicker: 'Program',
      title: 'Nothing to play yet',
      reason: 'Render a sequence to watch the cut here — record, plates, voice, and export in one pass.',
      primary: { label: primary.label || 'Render', mode: primary.mode || 'quick' },
      secondary,
    };
  }

  const status = String(action.status || '').toLowerCase();
  let kicker = 'Next step';
  let tone = 'ready';
  let icon = 'empty-play';
  if (/not rendered|first/.test(status) || /first sequence/i.test(action.title)) {
    kicker = 'Ready to render';
    tone = 'ready';
    icon = 'empty-play';
  } else if (/re-record|record failed/.test(status)) {
    kicker = 'Needs capture';
    tone = 'capture';
    icon = 'empty-capture';
  } else if (/plate/.test(status)) {
    kicker = 'Plates';
    tone = 'ready';
    icon = 'empty-play';
  } else if (/out of date|stale/.test(status)) {
    kicker = 'Out of date';
    tone = 'stale';
    icon = 'empty-stale';
  }

  return {
    tone,
    icon,
    kicker,
    title: action.title,
    reason: action.reason || 'Use Render to update Program.',
    primary,
    secondary,
  };
}
