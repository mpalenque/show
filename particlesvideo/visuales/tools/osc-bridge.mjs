import osc from 'osc';
import { WebSocketServer } from 'ws';

let UDP_PORT = +(process.env.OSC_PORT ?? 9000);
const WS_PORT = +(process.env.WS_PORT ?? 8081);

const wss = new WebSocketServer({ port: WS_PORT });
const broadcast = (obj) => {
  const s = JSON.stringify(obj);
  wss.clients.forEach((c) => c.readyState === 1 && c.send(s));
};

let udp = null;
const openUdp = (port) => {                       // el editor puede cambiar el puerto en vivo
  if (udp) udp.close();
  UDP_PORT = port;
  udp = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: port, metadata: true });
  udp.on('message', (m) => broadcast({ t: 'osc', address: m.address, args: m.args.map((a) => a.value) }));
  udp.on('ready', () => { console.log(`[osc-bridge] escuchando UDP ${port}`); broadcast({ t: 'status', udpPort: port }); });
  udp.on('error', (e) => { console.error('[osc-bridge]', String(e)); broadcast({ t: 'error', message: String(e) }); });
  udp.open();
};

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ t: 'status', udpPort: UDP_PORT }));
  ws.on('message', (raw) => {
    try {
      const m = JSON.parse(raw);
      if (m.t === 'rebind' && m.port > 0) openUdp(m.port);
    } catch (e) { console.error('[osc-bridge] mensaje inválido', e); }
  });
});

openUdp(UDP_PORT);
console.log(`[osc-bridge] UDP ${UDP_PORT} → ws://localhost:${WS_PORT}`);
