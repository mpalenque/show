import { normalizeMidiMessage } from '../../vendor/parte2/system/midi.js';
import { matches } from '../../vendor/parte2/system/mappings.js';

export class ShowInputRouter {
  constructor(ctx) { this.ctx = ctx; this.recent = []; }
  takeRecentParte2() {
    const now = performance.now();
    const messages = this.recent.filter(item => now - item.time <= 50).map(item => item.message);
    this.recent = []; return messages;
  }
  dispatch(input) {
    const msg = Array.isArray(input) || ArrayBuffer.isView(input) ? normalizeMidiMessage(input, { deviceId: 'editor' }) : input;
    if (!msg) return;
    const { mapper, parte2, bridge } = this.ctx;
    let fired = [];
    // Learn consumes a message before scene selection, in either editor.
    if (mapper.learnRow != null && ['note', 'cc', 'osc'].includes(msg.kind)) mapper.dispatch(msg);
    else if (parte2.system?.mapper.learnRow != null && ['note', 'cc', 'osc'].includes(msg.kind)) parte2.system.mapper.dispatch(msg);
    else if (msg.kind === 'note' && msg.channel === 10 && msg.note >= 1 && msg.note <= 29) mapper.dispatch(msg);
    else if (parte2.system?.mapper.mappings.some(row => row.target === 'scene.goto' && row.enabled !== false && matches(row.source, msg))) {
      fired = parte2.system.mapper.dispatch(msg, { filter: row => row.target === 'scene.goto' });
    } else if (!parte2.system && msg.kind === 'note' && msg.channel === 10 && msg.note >= 60 && msg.note <= 80) {
      if (msg.on) { this.ctx.scenes.goto(`parte2:${msg.note}`); fired = ['show.parte2.scene']; }
    } else {
      const globalOSC = msg.kind === 'osc' && /^\/(?:p|pn|a|scene)(?:\/|$)/.test(msg.address);
      const globalNote = msg.kind === 'note' && msg.channel === 10 && msg.note >= 1 && msg.note <= 29;
      if (globalOSC || globalNote || !parte2.ownsFrame) {
        if (!parte2.ownsFrame && msg.kind === 'note' && [7, 13].includes(msg.channel)) {
          this.recent.push({ time: performance.now(), message: msg }); this.recent = this.recent.slice(-64);
        }
        if (['note', 'cc', 'osc', 'device'].includes(msg.kind)) {
          if (globalOSC || globalNote) mapper.dispatch(msg);
          else mapper.dispatch(msg, { filter: row => !row.target.startsWith('parte2.') || row.target === 'parte2.scene.goto' });
        }
      } else {
        // Global master and user mappings aimed at Parte 2 still use host Params.
        mapper.dispatch(msg, { filter: row => row.target.startsWith('master.') || row.target.startsWith('parte2.') || row.target.startsWith('scene.') });
        fired = parte2.dispatch(msg) || [];
      }
      if (msg.kind === 'device' || (msg.kind === 'cc' && [120, 123].includes(msg.cc))) {
        mapper.releaseDevice(msg.deviceId, msg.channel);
        parte2.system?.mapper.releaseDevice(msg.deviceId, msg.channel);
      }
    }
    bridge?.midiActivity(msg);
    if (performance.now() < parte2.subscribedUntil && msg.command !== 'clock') parte2.event('midi', { msg, fired });
  }
}
