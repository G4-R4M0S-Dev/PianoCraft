import { _electron as electron } from 'playwright';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

// This explicitly transmits the LK-S250 guide profile to the physical CASIO.
// It uses a separate Electron profile and never changes normal preferences.
const temporary = await mkdtemp(join(tmpdir(), 'pianocraft-guide-test-'));
const entry = pathToFileURL(join(temporary, 'test.html')).href;
const harness = join(temporary, 'harness.cjs');
await writeFile(join(temporary, 'test.html'), '<!doctype html><meta charset="utf-8"><title>PianoCraft LK-S250 light test</title>');
await writeFile(harness, `
const { app, BrowserWindow, session } = require('electron');
let window;
app.setPath('userData', ${JSON.stringify(join(temporary, 'profile'))});
app.whenReady().then(() => {
  const allowed = (contents, permission) => contents === window?.webContents && contents.getURL() === ${JSON.stringify(entry)} && ['midi','midiSysex'].includes(permission);
  session.defaultSession.setPermissionCheckHandler(allowed);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(allowed(contents, permission)));
  window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  window.loadURL(${JSON.stringify(entry)});
});
app.on('window-all-closed', () => app.quit());
`);

let app;
try {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [harness], env });
  const page = await app.firstWindow();
  const result = await page.evaluate(async moduleUrl => {
    const result = { timestamp: new Date().toISOString(), profile: 'casio-lks250', requestedNotes: [60,64,67], durationMs: 800,
      sent: [], errors: [], opened: false, cleaned: false, closed: false, observedLedState: 'not observed', inputTest: false };
    const timeout = (promise, milliseconds, label) => {
      let timer;
      return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), milliseconds); })]).finally(() => clearTimeout(timer));
    };
    let output, guide;
    try {
      const { GuideLights } = await import(moduleUrl);
      const access = await timeout(navigator.requestMIDIAccess({ sysex: true }), 15000, 'MIDI enumeration timeout');
      result.sysexEnabled = access.sysexEnabled;
      const serialize = port => ({ id: port.id, name: port.name, manufacturer: port.manufacturer, state: port.state, connection: port.connection });
      result.outputs = [...access.outputs.values()].map(serialize);
      output = [...access.outputs.values()].find(port => /CASIO/i.test(`${port.name} ${port.manufacturer}`) && port.state === 'connected');
      if (!output) throw new Error('A saída física CASIO não foi encontrada.');
      await timeout(output.open(), 10000, 'CASIO output open timeout');
      result.output = serialize(output);
      result.opened = output.connection === 'open';
      const route = { id: output.id, get state() { return output.state; }, send(bytes) {
        output.send(bytes);
        result.sent.push({ at: performance.now(), bytes: [...bytes] });
      } };
      guide = new GuideLights({ onError: error => result.errors.push(error.message) });
      if (!guide.connect(route, 'casio-lks250')) throw guide.error ?? new Error('Guide profile connection failed');
      if (!guide.test(result.requestedNotes, result.durationMs)) throw guide.error ?? new Error('Guide test failed');
      await new Promise(resolve => setTimeout(resolve, 900));
      result.stateAfterTest = guide.status;
    } catch (error) { result.errors.push(error.message ?? String(error)); }
    finally {
      if (guide) { guide.allOff(); guide.disconnect(); result.cleaned = guide.activeNotes.length === 0; }
      if (output) {
        try { await timeout(output.close(), 5000, 'CASIO output close timeout'); result.closed = output.connection === 'closed'; }
        catch (error) { result.errors.push(error.message); }
      }
    }
    result.messagesAccepted = result.sent.length;
    result.onMessages = result.sent.filter(({ bytes }) => bytes.length === 10 && bytes[5] === 2 && bytes[8] === 1).length;
    result.offMessages = result.sent.filter(({ bytes }) => bytes.length === 10 && bytes[5] === 2 && bytes[8] === 0).length;
    result.keepalives = result.sent.filter(({ bytes }) => bytes.length === 8).length;
    result.transportPassed = result.opened && result.sysexEnabled && result.errors.length === 0 && result.onMessages === 3 && result.offMessages === 3 && result.keepalives >= 4 && result.cleaned && result.closed;
    return result;
  }, new URL('../src/music/guide-lights.js', import.meta.url).href);
  await mkdir(resolve('test-results'), { recursive: true });
  await writeFile(resolve('test-results/guide-hardware.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (!result.transportPassed) process.exitCode = 1;
} finally {
  if (app) await app.close();
  const parent = resolve(tmpdir());
  if (dirname(resolve(temporary)).toLowerCase() !== parent.toLowerCase() || !basename(temporary).startsWith('pianocraft-guide-test-')) throw new Error('Unexpected temporary directory');
  await rm(temporary, { recursive: true, force: true });
}
