// WebSocket al bridge Node (el navegador no puede recibir UDP). Reconexión automática.
export class OscClient {
  constructor({ onMessage, onStatus, url = 'ws://localhost:8081' } = {}) {
    this.url = url;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.ws = null;
    this.connected = false;
    this.udpPort = Number(localStorage.getItem('vis.oscPort')) || 9000;
    this._retry = null;
  }

  connect() {
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      return this._scheduleRetry();
    }
    this.ws.onopen = () => {
      this.connected = true;
      console.info('[vis] OSC bridge conectado');
      this._send({ t: 'rebind', port: this.udpPort });   // reafirma el puerto guardado
      this._status();
    };
    this.ws.onclose = () => { this.connected = false; this._status(); this._scheduleRetry(); };
    this.ws.onerror = () => { /* onclose se encarga de reintentar */ };
    this.ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'osc') this.onMessage?.({ kind: 'osc', address: m.address, args: m.args ?? [], udpPort: m.udpPort });
      else if (m.t === 'status') { this.udpPort = m.udpPort; this._status(); }
      else if (m.t === 'error') console.error('[vis] osc-bridge:', m.message);
    };
  }

  setPort(port) {
    this.udpPort = Number(port);
    localStorage.setItem('vis.oscPort', String(this.udpPort));
    this._send({ t: 'rebind', port: this.udpPort });
  }

  _send(obj) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  _status() { this.onStatus?.({ connected: this.connected, udpPort: this.udpPort }); }

  _scheduleRetry() {
    if (this._retry) return;
    this._retry = setTimeout(() => { this._retry = null; this.connect(); }, 2000);
  }
}
