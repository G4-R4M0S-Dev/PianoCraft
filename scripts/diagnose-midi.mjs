import { _electron as electron } from 'playwright';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

// Read-only hardware diagnostic: no outputs are opened and no MIDI is transmitted.
// A separate temporary Electron profile also leaves normal device preferences alone.
const listenMs = Math.min(30000, Math.max(0, Number(process.argv.find(arg => arg.startsWith('--listen-ms='))?.split('=')[1]) || 0));
const temporary = await mkdtemp(join(tmpdir(), 'pianocraft-midi-diagnostic-'));
const entry = pathToFileURL(join(temporary, 'diagnostic.html')).href;
const harness = join(temporary, 'harness.cjs');
await writeFile(join(temporary, 'diagnostic.html'), '<!doctype html><meta charset="utf-8"><title>PianoCraft MIDI diagnostic</title>');
await writeFile(harness, `
const { app, BrowserWindow, session } = require('electron');
let window;
globalThis.diagnosticPermissions = [];
app.setPath('userData', ${JSON.stringify(join(temporary, 'profile'))});
app.whenReady().then(() => {
  const allowed = (contents, permission) => contents === window?.webContents && contents.getURL() === ${JSON.stringify(entry)} && (permission === 'midi' || permission === 'midiSysex');
  session.defaultSession.setPermissionCheckHandler((contents, permission, origin) => {
    const granted = allowed(contents, permission);
    globalThis.diagnosticPermissions.push({ kind: 'check', permission, origin, granted });
    return granted;
  });
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    const granted = allowed(contents, permission);
    globalThis.diagnosticPermissions.push({ kind: 'request', permission, granted });
    callback(granted);
  });
  window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  window.loadURL(${JSON.stringify(entry)});
});
app.on('window-all-closed', () => app.quit());
`);

let app;
try {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [harness], env: environment });
  const page = await app.firstWindow();
  const result = await page.evaluate(async listen => {
    const errorInfo = error => ({ name: error.name || 'Error', message: error.message || String(error) });
    const serialize = port => ({ id: port.id, name: port.name, manufacturer: port.manufacturer, version: port.version, type: port.type, state: port.state, connection: port.connection });
    const timeout = (promise, milliseconds, label) => {
      let timer;
      return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(label), { name: 'TimeoutError' })), milliseconds); })]).finally(() => clearTimeout(timer));
    };
    const report = { timestamp: new Date().toISOString(), secureContext: isSecureContext, webMidiAvailable: !!navigator.requestMIDIAccess, inputs: [], outputs: [], selectedInput: null, open: false, notes: [], listenMs: listen, transmittedMessages: 0 };
    if (!navigator.requestMIDIAccess) return { ...report, error: { name: 'NotSupportedError', message: 'Web MIDI indisponível.' } };
    let input, handler;
    try {
      const access = await timeout(navigator.requestMIDIAccess({ sysex: false }), 15000, 'O enumerador MIDI não respondeu em 15 segundos.');
      report.inputs = [...access.inputs.values()].map(serialize);
      report.outputs = [...access.outputs.values()].map(serialize);
      input = [...access.inputs.values()].find(port => /CASIO/i.test(`${port.name} ${port.manufacturer}`) && port.state === 'connected');
      if (!input) return { ...report, error: { name: 'NotFoundError', message: 'Nenhuma entrada CASIO enumerada pelo Web MIDI.' } };
      report.selectedInput = serialize(input);
      await timeout(input.open(), 10000, 'A entrada CASIO não respondeu à abertura em 10 segundos.');
      report.selectedInput = serialize(input);
      report.open = input.state === 'connected' && input.connection === 'open';
      if (report.open && listen > 0) {
        handler = event => {
          const bytes = [...event.data], command = bytes[0] & 0xf0;
          if (command === 0x80 || command === 0x90) report.notes.push({ timestamp: event.receivedTime ?? event.timeStamp, bytes, note: bytes[1], velocity: bytes[2], on: command === 0x90 && bytes[2] > 0, channel: bytes[0] & 15 });
        };
        input.addEventListener('midimessage', handler);
        await new Promise(resolve => setTimeout(resolve, listen));
      }
    } catch (error) { report.error = errorInfo(error); }
    finally {
      if (input) {
        if (handler) input.removeEventListener('midimessage', handler);
        try { await timeout(input.close(), 5000, 'A entrada não respondeu ao fechamento.'); }
        catch (error) { report.closeError = errorInfo(error); }
        report.closedInput = serialize(input);
      }
    }
    return report;
  }, listenMs);
  result.runtime = await app.evaluate(() => ({ electron: process.versions.electron, chromium: process.versions.chrome, platform: process.platform, architecture: process.arch }));
  result.permissionChecks = await app.evaluate(() => globalThis.diagnosticPermissions);
  await mkdir(resolve('test-results'), { recursive: true });
  await writeFile(resolve('test-results/midi-diagnostic.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (app) await app.close();
  if(dirname(temporary)!==resolve(tmpdir())||!basename(temporary).startsWith('pianocraft-midi-diagnostic-'))throw new Error('Diretório temporário inesperado.');
  await rm(temporary, { recursive: true, force: true });
}
