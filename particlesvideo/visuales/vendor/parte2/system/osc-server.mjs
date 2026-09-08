import dgram from 'node:dgram';

/** OSC 1.0 messages and bundles, decoded without interpreting their contents as code. */
export function decodeOsc(buffer, depth = 0) {
  if (depth > 8 || buffer.length > 65536) throw new Error('Paquete OSC demasiado grande');
  let offset = 0;
  const requireBytes = count => { if (offset + count > buffer.length) throw new Error('Paquete OSC incompleto'); };
  const string = () => {
    const end = buffer.indexOf(0, offset);
    if (end < 0) throw new Error('String OSC incompleto');
    const value = buffer.toString('utf8', offset, end); offset = (end + 4) & ~3;
    if (offset > buffer.length) throw new Error('Padding OSC incompleto');
    return value;
  };
  const address = string();
  if (address === '#bundle') {
    requireBytes(8); offset += 8;
    const messages = [];
    while (offset < buffer.length) {
      requireBytes(4); const length = buffer.readUInt32BE(offset); offset += 4;
      if (length === 0) throw new Error('Bundle OSC vacío');
      requireBytes(length); messages.push(...decodeOsc(buffer.subarray(offset, offset + length), depth + 1)); offset += length;
      if (messages.length > 256) throw new Error('Demasiados mensajes OSC');
    }
    return messages;
  }
  if (!address.startsWith('/')) throw new Error('Dirección OSC inválida');
  const tags = string();
  if (!tags.startsWith(',')) throw new Error('Tipos OSC inválidos');
  const args = [];
  for (const type of tags.slice(1)) {
    if (type === 'f') { requireBytes(4); args.push(buffer.readFloatBE(offset)); offset += 4; }
    else if (type === 'i') { requireBytes(4); args.push(buffer.readInt32BE(offset)); offset += 4; }
    else if (type === 'd') { requireBytes(8); args.push(buffer.readDoubleBE(offset)); offset += 8; }
    else if (type === 'h') { requireBytes(8); args.push(Number(buffer.readBigInt64BE(offset))); offset += 8; }
    else if (type === 's' || type === 'S') args.push(string());
    else if (type === 'T') args.push(true);
    else if (type === 'F') args.push(false);
    else if (type === 'N' || type === 'I') args.push(null);
    else if (type === 'b') { requireBytes(4); const length = buffer.readUInt32BE(offset); offset += 4; requireBytes(length); args.push({ blobBytes: length }); offset = (offset + length + 3) & ~3; }
    else throw new Error(`Tipo OSC no soportado: ${type}`);
  }
  if (args.some(v => typeof v === 'number' && !Number.isFinite(v))) throw new Error('Valor OSC no finito');
  return [{ kind: 'osc', address, args }];
}

export function createOscBridge({ port = 1002, host = '127.0.0.1' } = {}) {
  const clients = new Set();
  let socket = null, desiredPort = port, desiredHost = host;
  let status = { connected: false, udpPort: port, host, received: 0, invalid: 0, error: null };
  const broadcast = message => {
    const data = `data: ${JSON.stringify(message)}\n\n`;
    for (const client of clients) if (!client.destroyed) client.write(data);
  };
  async function bind(nextPort, nextHost = desiredHost) {
    desiredPort = Number(nextPort); desiredHost = nextHost;
    if (!Number.isInteger(desiredPort) || desiredPort < 1024 && desiredPort !== 1002 || desiredPort > 65535) throw new Error('Puerto UDP inválido');
    if (!['127.0.0.1', '0.0.0.0'].includes(nextHost)) throw new Error('Interfaz UDP inválida');
    if (socket) { try { socket.close(); } catch {} socket = null; }
    const next = dgram.createSocket('udp4'); socket = next;
    next.on('message', (data, peer) => {
      try {
        for (const message of decodeOsc(data)) {
          status.received++;
          broadcast({ t: 'osc', ...message, timestamp: Date.now(), remote: peer.address });
        }
      } catch { status.invalid++; }
    });
    next.on('error', error => {
      if (socket !== next) return;
      status = { ...status, connected: false, error: error.message };
      broadcast({ t: 'status', ...status });
    });
    return new Promise(resolve => {
      const onError = () => { next.removeListener('listening', onListen); resolve({ ...status }); };
      const onListen = () => {
        next.removeListener('error', onError);
        status = { ...status, connected: true, udpPort: desiredPort, host: desiredHost, error: null };
        broadcast({ t: 'status', ...status }); resolve({ ...status });
      };
      next.once('error', onError); next.once('listening', onListen);
      next.bind(desiredPort, desiredHost);
    });
  }
  const heartbeat = setInterval(() => { for (const client of clients) if (!client.destroyed) client.write(': heartbeat\n\n'); }, 15000);
  heartbeat.unref();
  bind(port, host).catch(error => { status.error = error.message; });
  return {
    status: () => ({ ...status }),
    async handle(req, res, pathname) {
      if (!pathname.startsWith('/api/osc/')) return false;
      const json = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
      if (pathname === '/api/osc/events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(`data: ${JSON.stringify({ t: 'status', ...status })}\n\n`);
        clients.add(res); req.on('close', () => clients.delete(res)); return true;
      }
      if (pathname === '/api/osc/status' && req.method === 'GET') { json(200, status); return true; }
      if (pathname === '/api/osc/config' && req.method === 'POST') {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) { json(403, { error: 'Origen inválido' }); return true; }
        try {
          let data = ''; for await (const chunk of req) { data += chunk; if (data.length > 4096) throw new Error('Configuración demasiado grande'); }
          const config = JSON.parse(data);
          json(200, await bind(config.port, config.host || desiredHost));
        } catch (error) { json(400, { error: error.message }); }
        return true;
      }
      json(404, { error: 'Ruta OSC inexistente' }); return true;
    },
    close() { clearInterval(heartbeat); for (const client of clients) client.end(); clients.clear(); if (socket) { try { socket.close(); } catch {} socket = null; } },
  };
}
