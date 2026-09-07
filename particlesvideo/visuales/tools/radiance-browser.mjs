import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, preview } from 'vite';
import WebSocket from 'ws';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function metrics(samples) {
  const values = samples.map(s => typeof s === 'number' ? s : s.dt).sort((a, b) => a - b);
  return { frames: values.length, fps: 1000 * values.length / values.reduce((a, b) => a + b, 0),
    p95: values[Math.floor(values.length * .95)], p99: values[Math.floor(values.length * .99)],
    worst: values.at(-1), over20ms: values.filter(v => v > 20).length };
}

export async function browser({ directory = root, production = false, port = 5191, base = '/', original = false, mount, initScript } = {}) {
  const options = { root: directory, server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
    preview: { host: '127.0.0.1', port, strictPort: true },
    ...(mount ? { base: mount } : {}),
    ...(original ? { configFile: false, esbuild: { jsx: 'automatic' } } : {}) };
  const server = production ? await preview(options) : await createServer(options);
  if (!production) await server.listen();
  const profile = mkdtempSync(join(tmpdir(), 'vis-radiance-'));
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--enable-unsafe-webgpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--window-size=2688,1008', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  let socket;
  const close = async () => {
    socket?.close(); chrome.kill();
    if (production) await new Promise(resolve => server.httpServer.close(resolve));
    else await server.close();
  };
  try {
    let debugPort;
    for (let i = 0; i < 150; i++) {
      const file = join(profile, 'DevToolsActivePort');
      if (existsSync(file)) { debugPort = Number(readFileSync(file, 'utf8').split('\n')[0]); break; }
      await sleep(100);
    }
    if (!debugPort) throw new Error('Chrome no abrió DevTools');
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const pending = new Map(), errors = [], logs = [];
    let counter = 0;
    socket.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
      else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
      else if (message.method === 'Runtime.consoleAPICalled') {
        const entry = message.params.args.map(a => a.value ?? a.description).join(' ');
        logs.push(entry);
        if (message.params.type === 'error') errors.push(entry);
      }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++counter;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }, 60000);
      pending.set(id, message => { clearTimeout(timeout); message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result); });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const ev = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result?.value;
    };
    const waitFor = async (expression, ms = 60000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { if (await ev(expression)) return; await sleep(100); }
      throw new Error(`Timeout ${expression}\n${JSON.stringify(errors).slice(0, 6000)}`);
    };
    const shot = async file => {
      mkdirSync(dirname(file), { recursive: true });
      const result = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(file, Buffer.from(result.data, 'base64'));
    };
    await send('Runtime.enable');
    await send('Page.enable');
    if (initScript) await send('Page.addScriptToEvaluateOnNewDocument', { source: initScript });
    await send('Emulation.setDeviceMetricsOverride', { width: 2688, height: 1008, deviceScaleFactor: 1, mobile: false });
    const url = `http://127.0.0.1:${port}${base}`;
    await send('Browser.grantPermissions', { origin: new URL(url).origin, permissions: ['midi', 'midiSysex'] });
    await send('Page.navigate', { url });
    return { ev, send, waitFor, shot, close, errors, logs, url };
  } catch (error) { await close(); throw error; }
}
