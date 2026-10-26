import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ATMOSPHERES, atmosphereSnippet, fieldShaderSource, injectAtmosphere, resolveAtmosphere } from './atmosphere.mjs';
import { ATMOSPHERE_IDS, DEPTHS, LOOK_VAR_KEYS, TITLE_REVEALS, lookVarTable, mergeMotion, motionCssVars, plateLook, resolveMotion } from './plateMotion.mjs';

const brand = (motion = {}) => ({
  colors: { ink: '#0a1f0a', surface: '#0f2a0f', gold: '#0ca300', amber: '#7ac943', teal: '#2dd4bf' },
  motion: { energy: 'clear', ...motion },
});

test('atmosphere ids are one list everywhere', () => {
  assert.deepEqual(Object.keys(ATMOSPHERES), ATMOSPHERE_IDS);
  for (const id of ATMOSPHERE_IDS.filter((x) => x !== 'none')) {
    assert.doesNotThrow(() => fieldShaderSource(id), id);
  }
  assert.throws(() => fieldShaderSource('nope'));
});

test('resolveAtmosphere honours brand motion, legacy scheduleField and unknown ids', () => {
  assert.equal(resolveAtmosphere(brand()).id, 'none');
  assert.equal(resolveAtmosphere(brand({ atmosphere: 'aurora' })).id, 'aurora');
  assert.equal(resolveAtmosphere(brand({ scheduleField: true })).id, 'schedule');
  assert.equal(resolveAtmosphere(brand({ scheduleField: true, scheduleFieldOpacity: 0.5 })).opacity, 0.5);
  assert.equal(resolveAtmosphere(brand({ atmosphere: 'lava' })).id, 'none');
  const tuned = resolveAtmosphere(brand({ atmosphere: 'mesh', atmosphereOpacity: 0.7, atmosphereSpeed: 1.5 }));
  assert.equal(tuned.opacity, 0.7);
  assert.equal(tuned.speed, 1.5);
});

test('every field compiles into one shader body with the shared uniforms', () => {
  for (const id of ATMOSPHERE_IDS.filter((x) => x !== 'none')) {
    const src = fieldShaderSource(id);
    for (const u of ['uRes', 'uTime', 'uGold', 'uAmber', 'uTeal', 'uInk', 'uSurface', 'uOpacity', 'uDrift', 'uEnv']) {
      assert.match(src, new RegExp(`uniform \\w+ ${u};`), `${id} declares ${u}`);
    }
    assert.match(src, /void main\(\)/, `${id} has main`);
    assert.match(src, /gl_FragColor = vec4\(col, /, `${id} writes straight alpha`);
  }
});

test('snippet emits a canvas + runtime for fields and only the clock for none', () => {
  const on = atmosphereSnippet(brand({ atmosphere: 'particles' }));
  assert.equal(on.enabled, true);
  assert.match(on.markup, /<canvas class="plate-field" data-field="particles"/);
  assert.match(on.script, /__plateRuntime/);
  assert.match(on.script, /blendFuncSeparate/);
  // Colour uniforms are JS arrays, never GLSL constructors leaking into the page script.
  // The field follows the page's colour variables live, with the brand baked in as the fallback.
  assert.match(on.script, /gl\.uniform3fv\(U\.uGold, tint\('--gold', \[0\.0471, 0\.6392, 0\.0000\]\)\)/);
  assert.doesNotMatch(on.script, /uniform3fv\(U\.\w+, (tint\('--\w+', )?vec3\(/);
  assert.doesNotThrow(() => new Function(on.script.replace(/<\/?script>/g, '')));
  const local = atmosphereSnippet(brand({ atmosphere: 'particles' }), { local: true });
  assert.match(local.script, /const tint = \(_name, baked\) => baked;/, 'live cards keep the baked colours');

  const off = atmosphereSnippet(brand());
  assert.equal(off.enabled, false);
  assert.doesNotMatch(off.markup, /<canvas/);
  assert.match(off.markup, /plate-clock/);
  assert.match(off.script, /__plateRuntime/, 'runtime (hooks, count-ups) exists without a field');
});

test('injectAtmosphere places the field after .bg and the runtime before </body>', () => {
  const html = '<body><div class="stage"><div class="bg"></div><h1>x</h1></div></body>';
  const out = injectAtmosphere(html, brand({ atmosphere: 'grid' }));
  assert.ok(out.indexOf('<div class="bg"></div>') < out.indexOf('plate-field'));
  assert.ok(out.indexOf('<script>') < out.indexOf('</body>'));
  assert.equal(injectAtmosphere('<body>no bg</body>', brand({ atmosphere: 'grid' })), '<body>no bg</body>');
});

test('effects tokens resolve with defaults and reach the CSS vars', () => {
  const m = resolveMotion(brand());
  assert.equal(m.titleReveal, 'rise');
  assert.equal(m.depth, 'soft');
  assert.equal(m.sheen, true);
  assert.ok(TITLE_REVEALS.includes(m.titleReveal));
  assert.ok(DEPTHS.includes(m.depth));

  const css = motionCssVars(brand({ depth: 'deep', sheen: false, titleReveal: 'cascade' }));
  assert.match(css, /--card-tilt: 17deg/);
  assert.match(css, /--card-lift: 44px/);
  assert.match(css, /--sheen: 0/);
  assert.match(css, /--title-reveal: cascade/);
  assert.match(motionCssVars(brand({ depth: 'flat' })), /--card-tilt: 0deg/);
});

test('a new energy brings its own timing even when the brand pinned the old numbers', () => {
  const pinned = { energy: 'clear', enterMs: 900, staggerMs: 120, pushScale: 1.035, tWord: 3 };
  const punchy = mergeMotion(pinned, { energy: 'punchy' });
  assert.equal(punchy.enterMs, undefined, 'pinned clear timing steps aside');
  assert.equal(punchy.tWord, 3, 'logo timing is not a profile number and stays');
  assert.equal(resolveMotion(brand(punchy)).enterMs, 720);
  assert.deepEqual(mergeMotion(pinned, { energy: 'clear', depth: 'deep' }), { ...pinned, depth: 'deep' }, 'same energy keeps the pins');
  assert.deepEqual(mergeMotion(pinned, { energy: 'punchy', enterMs: 500 }).enterMs, 500, 'the override may pin again');
});

test('look tables give the Studio the vars behind every choice, resolved on this brand', () => {
  const table = lookVarTable(brand({ enterMs: 900 }));
  assert.deepEqual(Object.keys(table).sort(), ['depth', 'energy', 'sheen', 'titleReveal']);
  assert.deepEqual(table.depth.deep, { '--card-tilt': '17deg', '--card-lift': '44px' });
  assert.deepEqual(table.sheen.off, { '--sheen': '0' });
  assert.deepEqual(table.titleReveal.wipe, { '--title-reveal': 'wipe' });
  assert.equal(table.energy.punchy['--motion-enter'], '0.72s', 'energy wins over the pinned number');
  assert.deepEqual(Object.keys(table.energy.calm), LOOK_VAR_KEYS.energy);

  const look = plateLook(brand({ atmosphere: 'grid' }), { depth: 'flat', sheen: false, cascade: true });
  assert.equal(look.atmosphere, 'grid');
  assert.equal(look.vars['--card-tilt'], '0deg');
  assert.equal(look.vars['--sheen'], '0');
  assert.equal(plateLook(brand(), {}).titleReveal, 'rise');
});
