import { useShallow } from 'zustand/react/shallow';

import {
  atmospherePreview,
  CORE_ATMOSPHERES,
  DEPTH_HINT,
  depthPreview,
  ENERGY_HINT,
  energyPreview,
  revealPreview,
  sheenPreview,
} from '@/ui/look/previews';
import {
  LookTile,
  MoreTiles,
  PaneNote,
  PaneSection,
  PaneSub,
  RangeRow,
  TileGrid,
  useAtmosphereThumbs,
} from '@/ui/pane';

import { pickEnergy, scheduleMotionLive } from './actions';
import {
  directionView,
  setAtmosphere,
  useDirectionView,
  type AtmosphereChoice,
  type DirectionView,
} from './view';

const ENERGY_HELP =
  'Calm uses softer entrances. Clear is balanced. Punchy is more energetic. This direction is local to this video, not every project using the brand.';
const ATMOSPHERE_HELP =
  'A living WebGL backdrop behind every plate, painted from the brand colours. None keeps the flat vignette. The rest — contours, lattices, light, weather — all read the same five-colour scale.';
const EFFECTS_HELP =
  'Title reveal templates. Rise, Cascade and Wipe move the type. Focus and Veil settle the line. Ink, Slit, Iris and Embers are WebGL masks in the brand colours, stepped on the same clock as the plate. Depth tilts cards as they land. Sheen sweeps a highlight after they settle.';

const ENERGIES = [
  { id: 'calm', name: 'Calm' },
  { id: 'clear', name: 'Clear' },
  { id: 'punchy', name: 'Punchy' },
];

export function EnergySection() {
  const energy = useDirectionView((s) => s.energy);
  return (
    <PaneSection
      icon="speed"
      title="Motion energy"
      help={ENERGY_HELP}
      extra={<span className="dir-val">{ENERGIES.find((e) => e.id === energy)?.name}</span>}
    >
      <TileGrid label="Motion template" id="energyGrid">
        {ENERGIES.map((e) => {
          const on = e.id === energy;
          return (
            <LookTile
              key={e.id}
              preview={energyPreview(e.id)}
              label={e.name}
              hint={`${e.name} — ${ENERGY_HINT[e.id]}`}
              on={on}
              data={{ 'data-energy': e.id }}
              onSelect={() => {
                if (!on) pickEnergy(e.id);
              }}
            />
          );
        })}
      </TileGrid>
      {ENERGY_HINT[energy] ? <PaneNote>{ENERGY_HINT[energy]}</PaneNote> : null}
    </PaneSection>
  );
}

const FALLBACK_PALETTE = {
  ink: '#0b0e12',
  surface: '#1b2028',
  gold: '#42f272',
  amber: '#ffb648',
  teal: '#3cc8e8',
};

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
    <div
      className={
        hidden ? 'atmosphere-sliders pane-ranges hidden' : 'atmosphere-sliders pane-ranges'
      }
      hidden={hidden}
    >
      <RangeRow
        id="atmosphereOpacity"
        label="Presence"
        aria="Atmosphere presence"
        min="0.1"
        max="1"
        step="0.05"
        value={opacity}
        out={opacityOut}
        onChange={(e) => {
          directionView.set({
            opacity: e.target.value,
            opacityOut: Number(e.target.value).toFixed(2),
          });
          scheduleMotionLive();
        }}
      />
      <RangeRow
        id="atmosphereSpeed"
        label="Speed"
        aria="Atmosphere speed"
        min="0.3"
        max="2"
        step="0.1"
        value={speed}
        out={speedOut}
        onChange={(e) => {
          directionView.set({
            speed: e.target.value,
            speedOut: `${Number(e.target.value).toFixed(1)}×`,
          });
          scheduleMotionLive();
        }}
      />
    </div>
  );
}

function atmosphereTile(a: AtmosphereChoice, current: string) {
  const on = a.id === current;
  return (
    <LookTile
      key={a.id}
      preview={atmospherePreview(a.id)}
      label={a.em ? `${a.name} · ${a.em}` : a.name}
      hint={a.title}
      on={on}
      data={{ 'data-atmosphere': a.id }}
      onSelect={() => {
        if (on) return;
        setAtmosphere(a.id);
        scheduleMotionLive();
      }}
    />
  );
}

export function AtmosphereSection() {
  const { atmospheres, atmosphere } = useDirectionView(
    useShallow((s) => ({ atmospheres: s.atmospheres, atmosphere: s.atmosphere })),
  );
  const colors = useDirectionView((s) => s.direction?.colors);
  const palette = { ...FALLBACK_PALETTE, ...colors };
  const thumbsRef = useAtmosphereThumbs(palette, atmospheres.map((a) => a.id).join());
  const core = atmospheres.filter((a) => CORE_ATMOSPHERES.includes(a.id));
  const more = atmospheres.filter((a) => !CORE_ATMOSPHERES.includes(a.id));
  const name = atmospheres.find((a) => a.id === atmosphere)?.name;
  return (
    <PaneSection
      icon="sparkle"
      title="Background"
      help={ATMOSPHERE_HELP}
      extra={name ? <span className="dir-val">{name}</span> : null}
    >
      <div ref={thumbsRef} className="dir-atms">
        <TileGrid label="Plate atmosphere" id="atmosphereGrid">
          {core.map((a) => atmosphereTile(a, atmosphere))}
        </TileGrid>
        {more.length ? (
          <MoreTiles
            label="More backgrounds"
            count={more.length}
            open={more.some((a) => a.id === atmosphere)}
          >
            <TileGrid label="More atmospheres" id="atmosphereMore">
              {more.map((a) => atmosphereTile(a, atmosphere))}
            </TileGrid>
          </MoreTiles>
        ) : null}
      </div>
      <AtmosphereSliders />
    </PaneSection>
  );
}

type EffectKey = keyof Pick<DirectionView, 'titleReveal' | 'depth'>;

function setEffect(key: EffectKey, value: string) {
  directionView.set({ [key]: value });
  scheduleMotionLive();
}

const DEPTHS = ['flat', 'soft', 'deep'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function EffectsSection() {
  const { titleReveal, depth, sheen, reveals } = useDirectionView(
    useShallow((s) => ({
      titleReveal: s.titleReveal,
      depth: s.depth,
      sheen: s.sheen,
      reveals: s.reveals,
    })),
  );
  return (
    <PaneSection icon="text" title="Effects" help={EFFECTS_HELP}>
      <PaneSub label="Title reveal">
        <TileGrid label="Title reveal" id="revealGrid">
          {reveals.map((r) => {
            const on = r.id === titleReveal;
            return (
              <LookTile
                key={r.id}
                preview={revealPreview(r.id)}
                label={r.name}
                hint={r.title}
                on={on}
                data={{ 'data-title-reveal': r.id }}
                onSelect={() => {
                  if (!on) setEffect('titleReveal', r.id);
                }}
              />
            );
          })}
        </TileGrid>
      </PaneSub>
      <PaneSub label="Depth">
        <TileGrid label="Card depth" id="cardDepth">
          {DEPTHS.map((d) => {
            const on = d === depth;
            return (
              <LookTile
                key={d}
                preview={depthPreview(d)}
                label={cap(d)}
                hint={`${cap(d)} — ${DEPTH_HINT[d]}`}
                on={on}
                data={{ 'data-depth': d }}
                onSelect={() => {
                  if (!on) setEffect('depth', d);
                }}
              />
            );
          })}
        </TileGrid>
      </PaneSub>
      <PaneSub label="Sheen">
        <TileGrid label="Card sheen sweep" id="sheenToggle">
          {[true, false].map((v) => (
            <LookTile
              key={String(v)}
              preview={sheenPreview(v)}
              label={v ? 'On' : 'Off'}
              hint={v ? 'A light sweep across titles and cards' : 'No sweep'}
              on={sheen === v}
              data={{ 'data-sheen': v ? 'on' : 'off' }}
              onSelect={() => {
                if (sheen === v) return;
                directionView.set({ sheen: v });
                scheduleMotionLive();
              }}
            />
          ))}
        </TileGrid>
      </PaneSub>
    </PaneSection>
  );
}
