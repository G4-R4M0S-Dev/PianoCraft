import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { _electron as electron } from 'playwright';
import { createDemoSongs, encodeMidi } from '../src/music/midi.js';

let application;
let page;
before(async () => {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ args: [fileURLToPath(new URL('./musicxml-harness.cjs', import.meta.url))], env: environment });
  page = await application.firstWindow();
  await page.evaluate(async url => { window.parseMusicFile = (await import(url)).parseMusicFile; }, new URL('../src/music/import.js', import.meta.url).href);
});
after(async () => { await application?.close(); });
const xml = '<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure></part></score-partwise>';
const container = path => `<?xml version="1.0"?><container><rootfiles><rootfile full-path="${path}" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;
const mxl = (changes = {}, options = {}) => zipSync({ 'META-INF/container.xml': strToU8(container('scores/main.musicxml')), 'scores/main.musicxml': strToU8(xml), ...changes }, options);
const parse = (bytes, name = 'Estudo.mxl') => page.evaluate(({ bytes, name }) => parseMusicFile(new Uint8Array(bytes), name), { bytes: Array.from(bytes), name });
const u16 = (bytes, offset) => bytes[offset] | bytes[offset + 1] << 8;
const u32 = (bytes, offset) => new DataView(bytes.buffer).getUint32(offset, true);
const set32 = (bytes, offset, value) => new DataView(bytes.buffer).setUint32(offset, value, true);
function centralEntries(bytes) {
  const result = [];
  for (let offset = 0; offset < bytes.length - 46; offset++) {
    if (u32(bytes, offset) === 0x02014b50) {
      const nameLength = u16(bytes, offset + 28);
      result.push({ offset, name: new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength)), local: u32(bytes, offset + 42) });
      offset += 45 + nameLength + u16(bytes, offset + 30) + u16(bytes, offset + 32);
    }
  }
  return result;
}

test('import routes MIDI, plain MusicXML and compressed MXL using actual browser modules', async () => {
  const expected = createDemoSongs()[0];
  const midi = await parse(encodeMidi(expected), 'Escala.mid');
  assert.equal(midi.title, 'Escala');
  assert.equal(midi.notes.length, expected.notes.length);
  const plain = await parse(strToU8(xml), 'Estudo.musicxml');
  const compressed = await parse(mxl());
  assert.deepEqual(compressed, plain);
  assert.equal(compressed.notes[0].midi, 60);
  assert.equal(compressed.notes[0].duration, 2);
});

test('MXL accepts stored ZIP and optional media without extracting it', async () => {
  const song = await parse(mxl({ 'images/page.png': new Uint8Array([0, 1, 2, 3]) }, { level: 0 }));
  assert.equal(song.notes.length, 1);
});

test('MXL streams a score whose DEFLATE data crosses multiple input chunks', async () => {
  const notes = Array.from({ length: 2200 }, (_, index) => `<note><pitch><step>${'CDEFGAB'[index % 7]}</step><octave>4</octave></pitch><duration>1</duration><lyric><text>${index}</text></lyric></note>`).join('');
  const largeXml = xml.replace('<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>', notes);
  const bytes = mxl({ 'scores/main.musicxml': strToU8(largeXml) });
  const entry = centralEntries(bytes).find(entry => entry.name === 'scores/main.musicxml');
  assert.ok(u32(bytes, entry.offset + 20) > 1024);
  const song = await parse(bytes);
  assert.equal(song.notes.length, 2200);
  assert.equal(song.notes.at(-1).time, 1099.5);
  assert.equal(song.sourceXml, largeXml);
});

test('MusicXML wrapper decodes UTF-16 and handles a byte view with nonzero offset', async () => {
  const utf16 = Buffer.concat([Buffer.from([255, 254]), Buffer.from(xml.replace('<?xml version="1.0"?>', '<?xml version="1.0" encoding="utf-16"?>'), 'utf16le')]);
  const song = await parse(utf16, 'UTF16.xml');
  assert.equal(song.notes[0].midi, 60);
  const data = Array.from(strToU8(xml));
  const fromView = await page.evaluate(async bytes => {
    const buffer = new Uint8Array(bytes.length + 8);
    buffer.set(bytes, 4);
    return parseMusicFile(buffer.subarray(4, 4 + bytes.length), 'View.xml');
  }, data);
  assert.equal(fromView.notes.length, 1);
});

test('MXL validates container.xml, first rootfile and referenced score', async () => {
  for (const [bytes, pattern] of [
    [zipSync({ 'score.xml': strToU8(xml) }), /referenciado não encontrado/],
    [mxl({ 'META-INF/container.xml': strToU8('<container><rootfiles></container>') }), /malformado/],
    [mxl({ 'META-INF/container.xml': strToU8(container('missing.musicxml')) }), /referenciado não encontrado/],
    [mxl({ 'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="score.pdf" media-type="application/pdf"/></rootfiles></container>') }), /primeiro rootfile/],
    [mxl({ 'META-INF/container.xml': strToU8(container('../outside.xml')) }), /travessia/],
    [mxl({ 'scores/main.musicxml': strToU8('<score-timewise/>') }), /score-timewise/],
  ]) await assert.rejects(parse(bytes), pattern);
});

test('MXL rejects unsafe ZIP paths, duplicate names, overlap and metadata tampering', async () => {
  for (const path of ['../outside.xml', '/absolute.xml', 'C:/absolute.xml', 'a\\b.xml', 'a/%2e%2e/b.xml']) await assert.rejects(parse(mxl({ [path]: new Uint8Array([1]) })), /caminho|travessia/);
  const duplicated = mxl({ 'scores/xxxx.musicxml': strToU8(xml) });
  const entry = centralEntries(duplicated).find(entry => entry.name === 'scores/xxxx.musicxml');
  const replacement = strToU8('scores/main.musicxml');
  duplicated.set(replacement, entry.offset + 46);
  duplicated.set(replacement, entry.local + 30);
  await assert.rejects(parse(duplicated), /duplicados/);
  const tampered = mxl({}, { level: 0 });
  const scoreEntry = centralEntries(tampered).find(entry => entry.name === 'scores/main.musicxml');
  const dataOffset = scoreEntry.local + 30 + u16(tampered, scoreEntry.local + 26) + u16(tampered, scoreEntry.local + 28);
  tampered[dataOffset] ^= 1;
  await assert.rejects(parse(tampered), /CRC32/);
  const overlapped = mxl();
  const records = centralEntries(overlapped);
  set32(overlapped, records[1].offset + 42, records[0].local);
  await assert.rejects(parse(overlapped), /cabeçalho local|nome do cabeçalho|sobrepostas/);
});

test('MXL limits declared expansion and compression ratio before inflation', async () => {
  const oversized = mxl();
  const scoreEntry = centralEntries(oversized).find(entry => entry.name === 'scores/main.musicxml');
  set32(oversized, scoreEntry.offset + 24, 65 * 1024 * 1024);
  await assert.rejects(parse(oversized), /64 MB/);
  await assert.rejects(parse(mxl({ 'bomb.bin': new Uint8Array(2 * 1024 * 1024) })), /zip bomb/);
});

test('MXL streaming inflater rejects actual output larger than its forged declaration', async () => {
  const forged = mxl({ 'scores/main.musicxml': strToU8(xml + ' '.repeat(100_000)) });
  const entry = centralEntries(forged).find(entry => entry.name === 'scores/main.musicxml');
  set32(forged, entry.offset + 24, 10);
  set32(forged, entry.local + 22, 10);
  await assert.rejects(parse(forged), /descomprimidos excedem/);
});

test('import rejects empty, oversized and truncated files', async () => {
  await assert.rejects(parse(new Uint8Array()), /32 MB/);
  await assert.rejects(page.evaluate(() => parseMusicFile(new Uint8Array(32 * 1024 * 1024 + 1), 'large.mxl')), /32 MB/);
  const zipped = mxl();
  await assert.rejects(parse(zipped.subarray(0, zipped.length - 10)), /ausente|truncado/);
});
