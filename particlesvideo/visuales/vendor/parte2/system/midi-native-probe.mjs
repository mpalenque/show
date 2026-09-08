import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { launchChromium } from './test-browser.mjs';
const browser = await launchChromium();
const context = await browser.newContext();
await context.grantPermissions(['midi', 'midi-sysex'], { origin: 'http://127.0.0.1:8787' });
const page = await context.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:8787/system.html?mode=show');
  await page.waitForFunction(() => window.parte2 && document.getElementById('system-loading').hidden);
  await page.waitForFunction(() => ['listening', 'error', 'missing'].includes(parte2.midi.status().state), null, { timeout: 15000 });
  const initial = await page.evaluate(async () => {
    try { await parte2.connectMidi(); } catch {}
    return { status: parte2.midi.status(), ports: parte2.midi.listInputs(), mode: parte2.controlMode,
      scene: parte2.params.get('scene.current'), mappingCount: parte2.mapper.list().length };
  });
  console.log('INITIAL', JSON.stringify(initial));
  if (initial.status.state === 'listening') await page.waitForTimeout(8000);
  const result = await page.evaluate(() => ({ status: parte2.midi.status(), ports: parte2.midi.listInputs(),
    fired: parte2.mapper.monitor.slice(-8), errors: parte2.errors }));
  const report = { initial, result, errors, note: 'Read-only Web MIDI: no physical messages sent. Test-only browser context grants MIDI permissions.' };
  await writeFile(new URL('../captures/midi-native-validation.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log('RESULT', JSON.stringify(report));
} finally { await browser.close(); }
