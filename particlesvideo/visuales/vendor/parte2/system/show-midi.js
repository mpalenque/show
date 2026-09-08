import { DEFAULT_MAPPINGS } from './mappings.js';

export function isOriginalShowNote(message) {
  if (message?.kind !== 'note') return false;
  return DEFAULT_MAPPINGS.some(({ source }) => source.kind === 'note' && source.channel === message.channel
    && (source.note == null || source.note === message.note)
    && (!source.notes || source.notes.includes(message.note))
    && (!source.noteRange || (message.note >= source.noteRange[0] && message.note <= source.noteRange[1])));
}

/** Idle MidiNote outputs are zero. Demo alphas and the repeating ink loop are not show cues. */
export function armOriginalMidi(system) {
  system.mapper.releaseAll();
  const values = {
    'scene.current': system.lastMidiScene ?? 0,
    'scene.automation': true, 'output.preview': 'composition', 'output.blackout': false,
    'transport.playing': true, 'transport.sync': 'internal',
    'mix.fullVideo': 0, 'mix.fullMilky': 0, 'milky.full.preset': 'full1',
    'final.button': false, 'final.loop': false, 'final.inkAuto': true,
    'events.kickWarp': false, 'events.snareHeld': false,
    'composition.fullVideo.enabled': true, 'composition.fullMilky.enabled': true,
    'composition.stripes.enabled': true,
  };
  for (let i = 0; i < 6; i++) {
    values[`mix.stripes.${i}.video`] = 0;
    values[`mix.stripes.${i}.milky`] = 0;
    values[`graphics.blocks.${i}`] = false;
    values[`players.${i}.playing`] = true;
  }
  values['player.full.playing'] = true;
  system.fullVideoFade = 0;
  system.params.apply(values, { source: 'midi-show' });
  system.controlMode = 'show'; system.emit('control-mode', 'show');
}
