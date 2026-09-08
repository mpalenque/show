import test from 'node:test';
import assert from 'node:assert/strict';
import { DDSLibrary, SequenceDeck } from './dds-player.js';
import { Parte2System } from './controller.js';
import { Mapper, DEFAULT_MAPPINGS } from './mappings.js';
import { resolveMediaPaths, ddsRootCandidates, inkRootCandidates } from './media-paths.mjs';

/** TEMPORARY fallback for the 56 catalog clips whose DDS files are not on this
 * machine. These tests pin the exact behaviour the show relies on until the
 * original media is restored: the MIDI selector keeps asking for the original
 * clip, the deck plays a fixed substitute, and nothing is persisted as a lie. */
const engine = { device: { features: new Set() }, bindCache: new Map() };
const ORIGINAL = Array.from({ length: 12 }, (_, i) => i); // clips 0–11 are complete on this machine
const midiClip = velocity => Math.floor(velocity / 127 * 68) % 68; // MIDI SEQ PLAYER: Map ×68 → Frac → GetSlice
function manifest(completeIndices) {
  const clips = Array.from({ length: 68 }, (_, index) => {
    const frameCount = 100 + index, complete = completeIndices.includes(index);
    const availableFrames = complete ? frameCount : index === 12 ? 5 : 0;
    return { id: `clip-${String(index).padStart(2, '0')}`, index, name: `clip ${index}`, frameCount, fps: 30,
      availableFrames, complete, availableRanges: availableFrames ? [[0, availableFrames - 1]] : [] };
  });
  return { revision: 1, clips };
}
class QuietLibrary extends DDSLibrary { get() { return new Promise(() => {}); } preload() { return Promise.resolve([]); } }

test('velocities 23–126 request clips without media; the substitute is deterministic and always playable', () => {
  const library = new QuietLibrary(engine, manifest(ORIGINAL));
  assert.equal(library.playableClips().length, 12);
  assert.equal(library.isPlayable('clip-12'), false, 'a partial clip (5 of 112 frames) never counts as playable');
  const reached = new Set();
  for (let velocity = 1; velocity <= 127; velocity++) {
    const requested = midiClip(velocity), clip = library.substitute(requested);
    assert.ok(library.isPlayable(clip.id), `velocity ${velocity} → clip ${requested} must resolve to complete media`);
    assert.equal(clip.index, requested < 12 ? requested : requested % 12);
    assert.equal(library.substitute(requested).index, clip.index, 'same request, same substitute');
    reached.add(clip.index);
  }
  assert.equal(midiClip(22), 11); assert.equal(midiClip(23), 12); assert.equal(midiClip(25), 13); assert.equal(midiClip(127), 0);
  assert.equal(reached.size, 12, 'every available clip stays reachable through some velocity');
  assert.equal(new QuietLibrary(engine, manifest([])).substitute(30), null, 'nothing playable → no substitute');
  assert.equal(library.substitute('clip-07').id, 'clip-07', 'available clips are never replaced');
});

test('the deck plays the substitute while the parameter, MIDI monitor and session keep the requested clip', () => {
  const s = new Parte2System(null, { hosted: true, storage: null });
  s.engine = { settings: { final: {}, ink: {} }, extraPresets: new Map(), states: new Map() };
  s.library = new QuietLibrary(engine, manifest(ORIGINAL));
  s.decks = Array.from({ length: 7 }, (_, i) => new SequenceDeck(s.library, { clipId: `clip-0${i}` }));
  s.params.onChange((id, value, meta) => s.parameterChanged(id, value, meta));
  const events = []; s.on('deck-clip', event => events.push(event));
  const mapper = new Mapper({ storage: null, defaults: DEFAULT_MAPPINGS, onControl: (id, value) => s.params.set(id, value),
    getValue: id => s.params.get(id), getDefinition: id => s.params.def(id) });
  try {
    // Channel 13, note 0, velocity 100 → clip 53 ("bacteria naranja"), which is not on disk.
    mapper.dispatch({ kind: 'note', channel: 13, note: 0, velocity: 100, on: true });
    const deck = s.decks[1]; // players.0
    assert.equal(s.params.get('players.0.clip'), 53, 'the public parameter keeps floor(100/127×68) = 53');
    assert.equal(deck.clipId, 'clip-05', 'the deck plays 53 % 12 = 5');
    assert.equal(deck.requestedClipIndex, 53); assert.equal(deck.substituteFor, 53);
    assert.deepEqual(events.at(-1), { deck: 'players.0', index: 1, requested: 53, playing: 5, substitute: true });
    assert.equal(s.params.snapshot({ persistent: true })['players.0.clip'], 53, 'the saved session records the requested clip, not the substitute');
    assert.equal(s.params.get('mix.stripes.0.video'), 1, 'the video gate opens as in the original patch');

    s.params.set('media.fallback', false);
    assert.equal(deck.clipId, 'clip-53'); assert.equal(deck.status, 'missing'); assert.equal(deck.substituteFor, null);
    s.params.set('media.fallback', true);
    assert.equal(deck.clipId, 'clip-05'); assert.equal(deck.substituteFor, 53);

    mapper.dispatch({ kind: 'note', channel: 13, note: 0, velocity: 0, on: false });
    mapper.dispatch({ kind: 'note', channel: 13, note: 0, velocity: 20, on: true }); // → clip 10, available
    assert.equal(s.params.get('players.0.clip'), 10); assert.equal(deck.clipId, 'clip-10'); assert.equal(deck.substituteFor, null);

    mapper.dispatch({ kind: 'note', channel: 13, note: 12, velocity: 90, on: true }); // full deck → clip 48 → 48 % 12 = 0
    assert.equal(s.params.get('player.full.clip'), 48); assert.equal(s.decks[0].clipId, 'clip-00'); assert.equal(s.decks[0].substituteFor, 48);

    // Restoring the media (here: a remapped catalog where clip 48 is complete) returns the deck to its own clip
    // without touching parameters, mappings or sessions. Mirrors Parte2System.remapMedia without the fetch.
    s.library = new QuietLibrary(engine, manifest([...ORIGINAL, 48]));
    s.decks.forEach((item, i) => { item.dispose(); item.library = s.library; s.applyDeckClip(i, undefined, { force: true }); });
    assert.equal(s.decks[0].clipId, 'clip-48'); assert.equal(s.decks[0].substituteFor, null); assert.equal(s.params.get('player.full.clip'), 48);
    assert.equal(s.decks[1].clipId, 'clip-10');
  } finally { mapper.dispose(); clearTimeout(s.saveTimer); }
});

test('media locations prefer the environment, then the M.2 copy, then the package, then the historical folders', async () => {
  const candidates = ddsRootCandidates({ env: { PARTE2_DDS_ROOT: 'X:/otro/dds' }, packageRoot: '/pkg', workspaceRoot: '/ws' });
  assert.deepEqual(candidates.map(root => root.id), ['env', 'fast-dds', 'fast-dds2', 'fast-resize', 'package', 'original',
    'show-dds', 'show-dds2', 'show-resize', 'show-dds-copy', 'legacy-show', 'legacy-liquid']);
  // The show reads from the NVMe copy before either spinning disk.
  const order = candidates.map(root => root.path.replaceAll('\\', '/'));
  assert.ok(order.findIndex(p => p.startsWith('E:/PARTE2-MEDIA')) < order.findIndex(p => p.startsWith('I:/')), 'M.2 before the I: backup drive');
  assert.ok(order.findIndex(p => p.startsWith('E:/PARTE2-MEDIA')) < order.indexOf('/pkg/media/dds'), 'M.2 before the package copy on H:');
  assert.equal(inkRootCandidates({ env: {}, packageRoot: '/pkg', workspaceRoot: '/ws' })[0].path.replaceAll('\\', '/'), 'E:/PARTE2-MEDIA/ink');
  assert.ok(candidates.slice(0, 11).every(root => root.catalog), 'catalog roots are matched by the patch naming rules');
  const several = ddsRootCandidates({ env: { PARTE2_DDS_ROOT: 'X:/uno;Y:/dos' }, packageRoot: '/pkg', workspaceRoot: '/ws' });
  assert.deepEqual(several.slice(0, 2).map(root => [root.id, root.path.replaceAll('\\', '/')]), [['env-1', 'X:/uno'], ['env-2', 'Y:/dos']]);
  const resolved = await resolveMediaPaths({ env: {}, packageRoot: '/definitely/missing/pkg', workspaceRoot: '/definitely/missing/ws' });
  assert.equal(resolved.ddsRoots.find(root => root.id === 'package').exists, false);
  assert.equal(resolved.inkRoot === null || typeof resolved.inkRoot === 'string', true);
  assert.deepEqual(Object.keys(resolved.env), ['dds', 'ink', 'overlay']);
});
