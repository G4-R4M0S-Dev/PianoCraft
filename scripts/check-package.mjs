import { _electron as electron } from 'playwright';
import { listPackage } from '@electron/asar';
import { zipSync, strToU8 } from 'fflate';
import assert from 'node:assert/strict';
import { mkdir, access, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const executablePath = resolve(process.argv[2] || join(root, 'dist/v0.7/PianoCraft-win32-x64/PianoCraft.exe'));
let applicationRoot = join(dirname(executablePath), 'resources', 'app');
const output = join(root, 'test-results');
await mkdir(output, { recursive: true });
await access(executablePath);
let packedFiles = null;
try {
  const archive = join(dirname(executablePath), 'resources', 'app.asar');
  await access(archive);
  applicationRoot = archive;
  packedFiles = new Set(listPackage(archive, { isPack: false }).map(path => path.replace(/\\/g, '/').replace(/^\//, '')));
} catch { /* A folder package is supported too. */ }
let runtimeNodeModules = packedFiles ? [...packedFiles].some(path => path === 'node_modules' || path.startsWith('node_modules/')) : true;
if (!packedFiles) try { await access(join(applicationRoot, 'node_modules')); } catch { runtimeNodeModules = false; }
assert.equal(runtimeNodeModules, false, 'The packaged app must run from local bundles/assets without runtime node_modules.');
for (const file of ['src/vendor/spessasynth.js', 'src/vendor/spessasynth_processor.min.js', 'assets/soundfonts/PianoCraft-Basic.sf2','src/music/phrases.js','src/music/patterns.js','src/music/study-plan.js','src/study-panel.js','src/study.css','src/music/live-trail.js','src/phrases-panel.js','src/phrases.css','src/music/live-score.js','src/live-score.css','src/music/progress.js','src/progress-panel.js','src/progress.css','src/theme.js','src/themes.css','src/music/metronome.js','src/music/practice-cadence.js','src/music/achievements.js','src/achievement-panel.js','src/achievements.css','src/completion.js','src/completion.css','src/music/learning-journey.js','src/song-hub.js','src/song-hub.css','src/learning-flow.css']) {
  if (packedFiles) assert.ok(packedFiles.has(file), `Missing packaged asset ${file}`);
  else await access(join(applicationRoot, file));
}

const xml = '<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>Teste empacotado MXL</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><sound tempo="120"/></direction>'
  + ['C', 'D', 'E', 'G'].map(step => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>`).join('')
  + '</measure></part></score-partwise>';
const fixturePath = join(output, 'Packaged-MXL.mxl');
await writeFile(fixturePath, zipSync({
  'META-INF/container.xml': strToU8('<?xml version="1.0"?><container><rootfiles><rootfile full-path="scores/main.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>'),
  'scores/main.musicxml': strToU8(xml),
}));

const env = { ...process.env, PIANOCRAFT_TEST: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({ executablePath, args: ['--smoke'], env });
const result = { executablePath, runtimeNodeModules, initialSongs: 0, importedSongs: 0, notationSvg: 0, soundFontStatus: '', audioRms: 0, pageErrors: [], externalRequests: [] };
try {
  const page = await application.firstWindow();
  page.on('pageerror', error => result.pageErrors.push(error.message));
  page.on('request', request => { if (/^https?:/i.test(request.url())) result.externalRequests.push(request.url()); });
  await page.addInitScript(() => {
    const NativeContext = window.AudioContext;
    const NativeWorklet = window.AudioWorkletNode;
    window.__packageSoundFontNodes = [];
    window.AudioContext = class extends NativeContext {};
    window.AudioWorkletNode = class extends NativeWorklet {
      constructor(context, name, options) {
        super(context, name, options);
        if (name === 'spessasynth-worklet-processor') window.__packageSoundFontNodes.push(this);
      }
    };
  });
  await page.reload();
  await page.waitForSelector('.song-card');
  result.version=await application.evaluate(({app})=>app.getVersion());
  assert.equal(result.version,JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version);
  await page.waitForFunction(()=>['open','disabled','unavailable','error'].includes(document.querySelector('#instrument-panel').dataset.state),null,{timeout:15000});
  if(await page.locator('#guide-enabled').isChecked())await page.waitForFunction(()=>document.querySelector('#guide-status').textContent.includes('aberta'),null,{timeout:15000});
  result.instrument=await page.evaluate(()=>({state:document.querySelector('#instrument-panel').dataset.state,name:document.querySelector('#instrument-name').textContent,input:document.querySelector('#instrument-input').value,guideProfile:document.querySelector('#guide-profile').value,guideStatus:document.querySelector('#guide-status').textContent}));
  if(/CASIO/i.test(result.instrument.name)){assert.equal(result.instrument.state,'open');assert.equal(result.instrument.guideProfile,'casio-lks250');}
  assert.equal(page.url(), pathToFileURL(join(applicationRoot, 'src', 'index.html')).href, 'Renderer must load from the packaged application.');
  result.initialSongs = await page.locator('.song-card').count();
  assert.equal(result.initialSongs, 3);
  await page.locator('.open-song').first().click();
  await page.locator('[data-hub-action="onManual"]').click();
  await page.locator('#close-practice-tools').click();
  await page.locator('#play').click();
  await page.waitForFunction(() => document.querySelector('#current-time').textContent !== '0:00');
  await page.locator('#play').click();
  await page.locator('[data-view="library"]').click();
  await page.locator('#file-input').setInputFiles(fixturePath);
  await page.waitForFunction(() => document.querySelectorAll('.song-card').length === 4);
  result.importedSongs = await page.locator('.song-card').count();
  await page.locator('.song-card').filter({ hasText: /Teste empacotado MXL|Packaged-MXL/ }).locator('.open-song').click();
  await page.locator('[data-hub-action="onManual"]').click();
  await page.locator('#close-practice-tools').click();
  assert.equal(await page.locator('#sheet').isVisible(),true,'A partitura deve abrir por padrão.');
  await page.waitForSelector('#notation svg');
  result.notationSvg = await page.locator('#notation svg').count();
  assert.ok(result.notationSvg > 0);
  await page.screenshot({ path: join(output, 'package-notation.png') });

  await page.locator('#settings-button').click();
  await page.locator('#synth-engine').selectOption('basic');
  await page.waitForFunction(() => /timbre/i.test(document.querySelector('#soundfont-status').textContent) && window.__packageSoundFontNodes.length > 0);
  result.soundFontStatus = await page.locator('#soundfont-status').textContent();
  await page.locator('#settings button[value=close]').click();
  await page.locator('[data-view="free"]').click();
  await page.evaluate(() => {
    const node = window.__packageSoundFontNodes.at(-1);
    const analyser = node.context.createAnalyser();
    analyser.fftSize = 2048;
    for (let output = 0; output < node.numberOfOutputs; output++) node.connect(analyser, output);
    window.__packageAudioAnalyser = analyser;
  });
  await page.locator('body').click({ position: { x: 450, y: 110 } });
  await page.keyboard.down('a');
  await page.waitForTimeout(160);
  result.audioRms = await page.evaluate(() => {
    const analyser = window.__packageAudioAnalyser;
    const values = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(values);
    return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
  });
  await page.keyboard.up('a');
  assert.ok(result.audioRms > 0.0001, `Packaged SoundFont must synthesize actual samples: RMS=${result.audioRms}`);
  assert.deepEqual(result.pageErrors, []);
  assert.deepEqual(result.externalRequests, []);
  result.passed = true;
  console.log('PASS: packaged executable works without node_modules; library, playback, compressed MXL, notation SVG and actual SF2 audio validated offline.');
} catch (error) {
  result.passed = false;
  result.failure = error.stack || String(error);
  throw error;
} finally {
  await writeFile(join(output, 'package-result.json'), JSON.stringify(result, null, 2));
  await application.close();
}
