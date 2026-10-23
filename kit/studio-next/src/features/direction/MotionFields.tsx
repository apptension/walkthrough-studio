import { Fragment, type MouseEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { HelpTip } from '@/ui/HelpTip';
import { Scrubber } from '@/ui/Scrubber';

import { pickEnergy, scheduleMotionLive } from './actions';
import { radioAria } from './model';
import { directionView, setAtmosphere, STATIC_ATMOSPHERES, useDirectionView, type DirectionView } from './view';

const ENERGY_HELP =
  'Calm uses softer entrances. Clear is balanced. Punchy is more energetic. This direction is local to this video, not every project using the brand.';
const ATMOSPHERE_HELP =
  'A living WebGL backdrop behind every plate, painted from the brand colours. None keeps the flat vignette. The rest — contours, lattices, light, weather — all read the same five-colour scale.';
const EFFECTS_HELP =
  'Title reveal templates. Rise, Cascade and Wipe move the type. Focus and Veil settle the line. Ink, Slit, Iris and Embers are WebGL masks in the brand colours, stepped on the same clock as the plate. Depth tilts cards as they land. Sheen sweeps a highlight after they settle.';

const ENERGIES = [
  { id: 'calm', name: 'Calm', em: 'Soft · slow', title: 'Soft enters, longer holds' },
  { id: 'clear', name: 'Clear', em: 'Balanced', title: 'Balanced product motion' },
  { id: 'punchy', name: 'Punchy', em: 'Snappy', title: 'Snappy enters, stronger push' },
];

export function EnergyField() {
  const { energy, marked } = useDirectionView(useShallow((s) => ({ energy: s.energy, marked: s.energyMarked })));
  return (
    <div className="field">
      <span data-help={ENERGY_HELP} className="has-help">
        Motion energy
        <HelpTip text={ENERGY_HELP} label="Motion energy" />
      </span>
      <div className="energy-row templates" id="energyGrid" role="radiogroup" aria-label="Motion template">
        {ENERGIES.map((e, i) => {
          const on = e.id === energy;
          return (
            <Fragment key={e.id}>
              {i > 0 ? ' ' : null}
              <button
                type="button"
                className={on ? 'energy active' : 'energy'}
                data-energy={e.id}
                role="radio"
                aria-checked={radioAria(on, marked)}
                title={e.title}
                onClick={() => pickEnergy(e.id)}
              >
                <strong>{e.name}</strong>
                <em>{e.em}</em>
              </button>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function AtmosphereSliders() {
  const { hidden, opacity, opacityOut, speed, speedOut } = useDirectionView(
    useShallow((s) => ({
      hidden: s.slidersHidden,
      opacity: s.opacity,
      opacityOut: s.opacityOut,
      speed: s.speed,
      speedOut: s.speedOut,
    })),
  );
  return (
    <div className={hidden ? 'atmosphere-sliders hidden' : 'atmosphere-sliders'}>
      <label className="transition-duration">
        <span>Presence</span>{' '}
        <Scrubber
          id="atmosphereOpacity"
          min="0.1"
          max="1"
          step="0.05"
          value={opacity}
          aria-label="Atmosphere presence"
          onChange={(e) => {
            directionView.set({ opacity: e.target.value, opacityOut: Number(e.target.value).toFixed(2) });
            scheduleMotionLive();
          }}
        />{' '}
        <output id="atmosphereOpacityOut" htmlFor="atmosphereOpacity">
          {opacityOut}
        </output>
      </label>{' '}
      <label className="transition-duration">
        <span>Speed</span>{' '}
        <Scrubber
          id="atmosphereSpeed"
          min="0.3"
          max="2"
          step="0.1"
          value={speed}
          aria-label="Atmosphere speed"
          onChange={(e) => {
            directionView.set({ speed: e.target.value, speedOut: `${Number(e.target.value).toFixed(1)}×` });
            scheduleMotionLive();
          }}
        />{' '}
        <output id="atmosphereSpeedOut" htmlFor="atmosphereSpeed">
          {speedOut}
        </output>
      </label>
    </div>
  );
}

export function AtmosphereField() {
  const { atmospheres, atmosphere, marked } = useDirectionView(
    useShallow((s) => ({ atmospheres: s.atmospheres, atmosphere: s.atmosphere, marked: s.atmosphereMarked })),
  );
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-atmosphere]');
    if (!btn || !e.currentTarget.contains(btn)) return;
    setAtmosphere(btn.dataset.atmosphere ?? '');
    scheduleMotionLive();
  };
  return (
    <div className="field">
      <span data-help={ATMOSPHERE_HELP} className="has-help">
        Atmosphere
        <HelpTip text={ATMOSPHERE_HELP} label="Atmosphere" />
      </span>
      <div
        className="energy-row templates atmosphere-row"
        id="atmosphereGrid"
        role="radiogroup"
        aria-label="Plate atmosphere"
        onClick={onClick}
      >
        {atmospheres.map((a, i) => {
          const on = a.id === atmosphere;
          return (
            <Fragment key={a.id}>
              {i > 0 && atmospheres === STATIC_ATMOSPHERES ? ' ' : null}
              <button
                type="button"
                className={on ? 'energy active' : 'energy'}
                data-atmosphere={a.id}
                role="radio"
                aria-checked={radioAria(on, marked)}
                title={a.title}
              >
                <strong>{a.name}</strong>
                <em>{a.em}</em>
              </button>
            </Fragment>
          );
        })}
      </div>
      <AtmosphereSliders />
    </div>
  );
}

type EffectKey = keyof Pick<DirectionView, 'titleReveal' | 'depth'>;

function setEffect(key: EffectKey, value: string) {
  directionView.set({ [key]: value });
  scheduleMotionLive();
}

export function EffectsField() {
  const { titleReveal, depth, sheen, reveals, revealMarked } = useDirectionView(
    useShallow((s) => ({
      titleReveal: s.titleReveal,
      depth: s.depth,
      sheen: s.sheen,
      reveals: s.reveals,
      revealMarked: s.revealMarked,
    })),
  );
  const onReveal = (e: MouseEvent<HTMLDivElement>) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-title-reveal]');
    if (!btn || !e.currentTarget.contains(btn)) return;
    setEffect('titleReveal', btn.dataset.titleReveal ?? '');
    directionView.set({ revealMarked: true });
  };
  return (
    <div className="field effects-field">
      <span data-help={EFFECTS_HELP} className="has-help">
        Effects
        <HelpTip text={EFFECTS_HELP} label="Effects" />
      </span>
      <div
        className="energy-row templates atmosphere-row"
        id="revealGrid"
        role="radiogroup"
        aria-label="Title reveal"
        onClick={onReveal}
      >
        {reveals.map((r) => {
          const on = r.id === titleReveal;
          return (
            <button
              key={r.id}
              type="button"
              className={on ? 'energy active' : 'energy'}
              data-title-reveal={r.id}
              role="radio"
              aria-checked={radioAria(on, revealMarked)}
              title={r.title}
            >
              <strong>{r.name}</strong>
              <em>{r.em}</em>
            </button>
          );
        })}
      </div>
      <div className="effects-row is-pair">
        <label className="effects-select">
          <span>Depth</span>{' '}
          <select id="cardDepth" aria-label="Card depth" value={depth} onChange={(e) => setEffect('depth', e.target.value)}>
            <option value="flat">Flat</option>
            <option value="soft">Soft</option>
            <option value="deep">Deep</option>
          </select>
        </label>{' '}
        <label className="effects-switch">
          <span>Sheen</span>{' '}
          <input
            type="checkbox"
            id="sheenToggle"
            className="switch"
            role="switch"
            checked={sheen}
            aria-label="Card sheen sweep"
            onChange={(e) => {
              directionView.set({ sheen: e.target.checked });
              scheduleMotionLive();
            }}
          />
        </label>
      </div>
    </div>
  );
}
