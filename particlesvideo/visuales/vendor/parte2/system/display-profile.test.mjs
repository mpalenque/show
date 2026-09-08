import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISPLAY_PROFILE, migrateDisplayProfile } from './display-profile.js';

test('old sessions and saved scenes migrate to the LED wall while keeping media, effects and MIDI', () => {
  const old = { version: 1, system: 'parte2', parameters: {
    'output.resolution': '3840x1200', 'composition.stripes.height': .589466,
    'composition.stripes.width': 1.4, 'players.2.clip': 8, 'final.fx2': .75,
  }, mappings: [{ id: 'custom', target: 'final.fx2' }], scenes: { 69: {
    'output.resolution': '3840x1200', 'composition.stripes.height': .589466, 'final.fx2': .2,
  } } };
  const result = migrateDisplayProfile(old);
  assert.equal(result.displayProfile, DISPLAY_PROFILE);
  assert.equal(result.parameters['output.resolution'], '2688x1008');
  assert.equal(result.parameters['players.2.clip'], 8); assert.equal(result.parameters['final.fx2'], .75);
  assert.equal(result.scenes[69]['output.resolution'], '2688x1008'); assert.equal(result.scenes[69]['final.fx2'], .2);
  assert.deepEqual(result.mappings, old.mappings);
  assert.equal(old.parameters['output.resolution'], '3840x1200');
});

test('later manual display changes survive reload once the LED profile was applied', () => {
  const saved = { version: 1, displayProfile: DISPLAY_PROFILE,
    parameters: { 'composition.stripes.height': .9, 'output.resolution': '1920x600' } };
  assert.equal(migrateDisplayProfile(saved), saved);
});
