import { describeSource } from '../reference.js';

const MAX = 20;

export class MonitorPanel {
  constructor(state, bus) {
    this.state = state;
    this.bus = bus;
    this.el = document.getElementById('monitor');
    this.rows = [];
  }

  init() {
    document.getElementById('test-send').onclick = () => this._sendFake();
    document.getElementById('test-kind').onchange = () => this._syncTestFields();
    this._syncTestFields();
  }

  push({ msg, fired }) {
    const time = new Date().toLocaleTimeString('es-AR', { hour12: false });
    const label = msg.kind === 'osc'
      ? `${msg.address} [${(msg.args ?? []).join(', ')}]`
      : describeSource(msg) + (msg.kind === 'note' ? ` v${msg.velocity}${msg.on ? '' : ' off'}` : ` = ${msg.value}`);
    this.rows.unshift(`${time}  ${label}` + (fired?.length ? `  <span class="fired">→ ${fired.join(', ')}</span>` : ''));
    if (this.rows.length > MAX) this.rows.length = MAX;
    this.el.innerHTML = this.rows.join('<br>');
  }

  _syncTestFields() {
    const kind = document.getElementById('test-kind').value;
    const isOsc = kind === 'osc';
    document.getElementById('test-address').style.display = isOsc ? '' : 'none';
    for (const id of ['test-channel', 'test-num']) document.getElementById(id).style.display = isOsc ? 'none' : '';
  }

  _sendFake() {
    const kind = document.getElementById('test-kind').value;
    const channel = Number(document.getElementById('test-channel').value);
    const num = Number(document.getElementById('test-num').value);
    const value = Number(document.getElementById('test-value').value);
    const address = document.getElementById('test-address').value;

    const msg = kind === 'note' ? { kind: 'note', channel, note: num, velocity: value, on: value > 0 }
      : kind === 'cc' ? { kind: 'cc', channel, cc: num, value }
      : { kind: 'osc', address, args: [value] };
    this.bus.post({ t: 'fakeMidi', msg });
  }
}
