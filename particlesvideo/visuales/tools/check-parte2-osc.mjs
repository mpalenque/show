import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createSocket } from 'node:dgram';
import osc from 'osc';
import WebSocket from 'ws';

const tcp = createServer(); await new Promise(resolve => tcp.listen(0, '127.0.0.1', resolve));
const wsPort = tcp.address().port; await new Promise(resolve => tcp.close(resolve));
async function freeUDP() {
  const socket = createSocket('udp4'); await new Promise(resolve => socket.bind(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
}
const mainPort = await freeUDP(), partPort = await freeUDP();
const child = spawn(process.execPath, ['tools/osc-bridge.mjs'], { windowsHide: true,
  env: { ...process.env, WS_PORT: String(wsPort), OSC_PORT: String(mainPort), PARTE2_OSC_PORT: String(partPort) }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '', ws; const sender = createSocket('udp4');
child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  for (let i = 0; i < 100 && !logs.includes(`Parte 2 UDP ${partPort} → mismo`); i++) await sleep(50);
  assert.ok(logs.includes(`escuchando UDP ${mainPort}`), logs);
  assert.ok(logs.includes(`Parte 2 UDP ${partPort} → mismo`), logs);
  ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
  const received = []; ws.on('message', data => received.push(JSON.parse(String(data))));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  for (const [port, address, value] of [[mainPort, '/fx1', .25], [partPort, '/fx2', .75]]) {
    const packet = osc.writePacket({ address, args: [{ type: 'f', value }] }, { metadata: true });
    await new Promise((resolve, reject) => sender.send(packet, port, '127.0.0.1', error => error ? reject(error) : resolve()));
  }
  for (let i = 0; i < 50 && received.filter(m => m.t === 'osc').length < 2; i++) await sleep(20);
  await sleep(80);
  const messages = received.filter(m => m.t === 'osc');
  assert.equal(messages.length, 2); assert.deepEqual(messages.map(m => [m.address, ...m.args]).sort(), [['/fx1', .25], ['/fx2', .75]]);
  assert.ok(received.some(m => m.t === 'status' && m.udpPort === mainPort));
  console.log('PASS two isolated UDP ports feed one WebSocket exactly once; primary port preserved');
} finally { sender.close(); ws?.terminate(); child.kill(); }
