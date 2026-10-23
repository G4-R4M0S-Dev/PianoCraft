import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';

// Exercises the real Web MIDI input with an isolated PianoCraft profile. Every
// output send is blocked by the QA hook: this script never plays or lights notes.
await mkdir('test-results', { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), 'pianocraft-midi-ui-qa-'));
const harness = join(temporary, 'harness.cjs');
// Hold the first navigation until the output-blocking hook and test preferences
// are installed. The real application main process and permission policy run.
await writeFile(harness, `
const {BrowserWindow}=require('electron');
const load=BrowserWindow.prototype.loadURL;
BrowserWindow.prototype.loadURL=function(url,...rest){
  if(!globalThis.qaStartApplication){globalThis.qaStartApplication=()=>load.call(this,url,...rest);return load.call(this,'about:blank');}
  return load.call(this,url,...rest);
};
require(${JSON.stringify(resolve('electron/main.cjs'))});
`);
const app = await electron.launch({ args: [harness, '--smoke'], env: { ...process.env, PIANOCRAFT_TEST: '1' } });
try {
  const page = await app.firstWindow(), pageErrors = [];
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    if(!localStorage.getItem('pc-settings'))localStorage.setItem('pc-settings',JSON.stringify({guideEnabled:false}));
    globalThis.__midiQa = { access: null, requests: [], blockedOutputSends: [] };
    const request = navigator.requestMIDIAccess.bind(navigator);
    navigator.requestMIDIAccess = async options => {
      const access = await request(options);
      globalThis.__midiQa.access = access; globalThis.__midiQa.requests.push(options);
      for (const output of access.outputs.values()) output.send = bytes => {
        globalThis.__midiQa.blockedOutputSends.push({ id: output.id, bytes: [...bytes] });
        throw new Error('QA bloqueou uma tentativa de transmissão MIDI.');
      };
      return access;
    };
  });
  await app.evaluate(() => globalThis.qaStartApplication());
  const waitForCasio = async () => {
    await page.waitForFunction(() => {
      const panel = document.querySelector('#instrument-panel');
      const select = document.querySelector('#instrument-input');
      const input = globalThis.__midiQa?.access?.inputs.get(select?.value);
      return panel?.dataset.state === 'open' && /CASIO/i.test(input?.name || '') && input?.connection === 'open';
    });
  };
  const snapshot = () => page.evaluate(() => {
    const describe = port => ({ id: port.id, name: port.name, manufacturer: port.manufacturer, version: port.version, state: port.state, connection: port.connection });
    return {
      panelState: document.querySelector('#instrument-panel').dataset.state,
      name: document.querySelector('#instrument-name').textContent,
      status: document.querySelector('#instrument-status').textContent,
      selectedInput: document.querySelector('#instrument-input').value,
      savedSettings: JSON.parse(localStorage.getItem('pc-settings') || '{}'),
      inputs: [...(globalThis.__midiQa.access?.inputs.values() || [])].map(describe),
      outputs: [...(globalThis.__midiQa.access?.outputs.values() || [])].map(describe),
      blockedOutputSends: globalThis.__midiQa.blockedOutputSends,
    };
  });

  await waitForCasio();
  const first = await snapshot();
  assert.equal(first.savedSettings.midiInputName, 'CASIO USB-MIDI');
  assert.equal(first.savedSettings.guideEnabled === true, false);
  assert.ok(first.outputs.every(port => port.connection === 'closed'));
  const casioId = first.selectedInput;
  await page.locator('.open-song').first().click();
  await page.screenshot({ path: 'test-results/midi-hardware-panel.png' });

  await page.locator('#instrument-input').selectOption('');
  await page.waitForFunction(() => document.querySelector('#instrument-panel').dataset.state === 'disabled' && JSON.parse(localStorage.getItem('pc-settings') || '{}').midiInputId === '');
  const computer = await snapshot();
  assert.ok(computer.inputs.every(port => port.connection === 'closed'));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#instrument-panel').dataset.state === 'disabled' && globalThis.__midiQa?.access);
  const restoredComputer = await snapshot();
  assert.equal(restoredComputer.selectedInput, '');
  assert.ok(restoredComputer.inputs.every(port => port.connection === 'closed'));

  await page.locator('#instrument-input').selectOption(casioId);
  await waitForCasio();
  // Force an obsolete session id in this test profile. Restoration must resolve
  // the saved hardware name, since Web MIDI port ids may change between sessions.
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('pc-settings'));
    settings.midiInputId = 'obsolete-input-id'; localStorage.setItem('pc-settings', JSON.stringify(settings));
  });
  await page.reload();
  await waitForCasio();
  const restoredCasio = await snapshot();
  assert.equal(restoredCasio.selectedInput, casioId);
  assert.equal(restoredCasio.savedSettings.midiInputName, 'CASIO USB-MIDI');
  assert.equal(restoredCasio.savedSettings.midiInputId, casioId);
  for (const state of [first, computer, restoredComputer, restoredCasio]) assert.deepEqual(state.blockedOutputSends, []);
  assert.deepEqual(pageErrors, []);
  const result = { passed: true, actualHardware: true, transmittedMessages: 0, first, computer, restoredComputer, restoredCasio, pageErrors };
  await writeFile('test-results/midi-hardware-ui.json', JSON.stringify(result, null, 2));
  console.log('PASS: CASIO real aberto automaticamente; seleção de computador e restauração por nome preservadas após reload; nenhuma saída aberta ou mensagem transmitida.');
} finally {
  await app.close();
  if(dirname(temporary)!==resolve(tmpdir())||!basename(temporary).startsWith('pianocraft-midi-ui-qa-'))throw new Error('Diretório temporário inesperado.');
  await rm(temporary,{recursive:true,force:true});
}
