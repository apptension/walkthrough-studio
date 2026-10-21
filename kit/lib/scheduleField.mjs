/**
 * Compatibility shim. The schedule-bar field now lives in lib/atmosphere.mjs as one of several
 * brandable WebGL atmospheres (`motion.atmosphere: "schedule"`); `motion.scheduleField: true`
 * still selects it. Import from atmosphere.mjs in new code.
 */
export { atmosphereSnippet as scheduleFieldSnippet, injectAtmosphere as injectScheduleField } from './atmosphere.mjs';
