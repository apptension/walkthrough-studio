import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ATMOSPHERES } from './atmosphere.mjs';
import { LAB_FIELDS, LAB_FIELD_IDS, PROMOTED_FIELDS, labShaderSource } from './atmosphereLab.mjs';

const UNIFORMS = ['uRes', 'uTime', 'uGold', 'uAmber', 'uTeal', 'uInk', 'uSurface', 'uOpacity', 'uDrift', 'uEnv'];

test('promoted fields are exactly the ones in production, and the rest stay candidates', () => {
  assert.equal(LAB_FIELDS.length, 32);
  assert.equal(PROMOTED_FIELDS.length, 32);
  assert.equal(new Set(LAB_FIELD_IDS).size, LAB_FIELD_IDS.length, 'ids are unique');
  const promoted = new Set(PROMOTED_FIELDS.map((f) => f.id));
  for (const id of promoted) assert.ok(id in ATMOSPHERES, `${id} is in production`);
  for (const id of LAB_FIELD_IDS) {
    if (!promoted.has(id)) assert.ok(!(id in ATMOSPHERES), `${id} is still a candidate`);
  }
  for (const f of LAB_FIELDS) {
    assert.match(f.id, /^[a-z]+$/, `${f.id} is a plain lowercase id`);
    assert.ok(f.label && f.hint && f.vibe, `${f.id} carries label, hint and vibe`);
    assert.ok(f.opacity > 0 && f.opacity <= 1, `${f.id} opacity in (0, 1]`);
  }
});

test('every candidate speaks the production shader contract', () => {
  for (const id of LAB_FIELD_IDS) {
    const src = labShaderSource(id);
    for (const u of UNIFORMS) assert.match(src, new RegExp(`uniform \\w+ ${u};`), `${id} declares ${u}`);
    assert.match(src, /void main\(\)/, `${id} has main`);
    assert.match(src, /gl_FragColor = vec4\(col, /, `${id} writes straight alpha`);
    assert.match(src, /vignette\(p0?\) \* contentDim\(uv\) \* uOpacity \* uEnv/, `${id} fades under the copy and with the plate`);
    assert.doesNotMatch(src, /\bfor \(int \w+ = [a-z]/, `${id} keeps GLSL ES 1.0 constant loop inits`);
  }
  assert.throws(() => labShaderSource('nope'));
});

test('every field is painted from the brand scale and obeys the tuning knobs', () => {
  const brandColours = /\bu(Gold|Amber|Teal)\b/g;
  // A numeric vec3 literal landing in `col` would be a hard-coded hue the brand cannot change.
  const hardCodedHue = /\bcol\w*\s*[+\-*]?=[^;]*vec3\(\s*-?\d[\d.]*\s*,\s*-?\d[\d.]*\s*,\s*-?\d[\d.]*\s*\)/;
  for (const f of LAB_FIELDS) {
    const used = new Set((f.body.match(brandColours) || []));
    assert.ok(used.size >= 2, `${f.id} blends at least two brand colours (uses ${[...used].join(', ') || 'none'})`);
    assert.doesNotMatch(f.body, hardCodedHue, `${f.id} never paints a literal colour`);
    assert.match(f.body, /uTime \* [\d.]+ \* uDrift/, `${f.id} derives its clock from uTime × uDrift (speed + energy knobs)`);
    assert.match(f.body, /\* uOpacity \* uEnv/, `${f.id} multiplies by presence and the plate envelope`);
  }
});
