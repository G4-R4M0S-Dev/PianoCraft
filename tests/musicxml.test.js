import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

let application;
let page;
before(async () => {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ args: [fileURLToPath(new URL('./musicxml-harness.cjs', import.meta.url))], env: environment });
  page = await application.firstWindow();
  const source = await readFile(new URL('../src/music/musicxml.js', import.meta.url), 'utf8');
  await page.addScriptTag({ content: source.replace('export function parseMusicXml', 'function parseMusicXml') });
});
after(async () => { await application?.close(); });

const pitch = (step, octave, duration, extra = '') => `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration>${extra}</note>`;
const attributes = '<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>';
const score = measures => `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>Estudo original</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name><midi-instrument id="I1"><midi-channel>2</midi-channel><midi-program>5</midi-program></midi-instrument></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
const parse = (xml, title) => page.evaluate(({ xml, title }) => parseMusicXml(xml, title), { xml, title });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} ≠ ${expected}`);

test('MusicXML uses browser DOMParser, splits staves, handles chords and backup', async () => {
  const xml = score(`<measure number="1">${attributes}<direction><sound tempo="120"/></direction>${pitch('C', 4, 4, '<voice>1</voice><staff>1</staff><notations><technical><fingering>1</fingering></technical></notations>')}<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>${pitch('G', 4, 4, '<voice>1</voice><staff>1</staff>')}<backup><duration>8</duration></backup>${pitch('C', 3, 16, '<voice>2</voice><staff>2</staff>')}</measure>`);
  const song = await parse(xml);
  assert.equal(song.title, 'Estudo original');
  assert.equal(song.notes.length, 4);
  assert.equal(song.tracks.length, 2);
  assert.deepEqual(song.tracks.map(track => [track.channel, track.program]), [[1, 4], [1, 4]]);
  assert.deepEqual(song.notes.filter(note => note.time === 0).map(note => note.midi).sort((a, b) => a - b), [48, 60, 64]);
  close(song.notes.find(note => note.midi === 67).time, 0.5);
  assert.equal(song.notes.find(note => note.midi === 60).finger, 1);
  assert.equal(song.notes.find(note => note.midi === 60).hand, 'right');
  assert.equal(song.notes.find(note => note.midi === 48).hand, 'left');
  close(song.duration, 2);
});

test('MusicXML joins ties across a change of tempo and divisions', async () => {
  const xml = score(`<measure number="1">${attributes}<direction><sound tempo="120"/></direction>${pitch('C', 4, 16, '<tie type="start"/>')}</measure><measure number="2"><attributes><divisions>8</divisions></attributes><direction><sound tempo="60"/></direction>${pitch('C', 4, 8, '<tie type="stop"/>')}${pitch('D', 4, 24)}</measure>`);
  const song = await parse(xml, 'Título do usuário');
  assert.equal(song.title, 'Título do usuário');
  assert.equal(song.notes.length, 2);
  close(song.notes[0].duration, 3);
  close(song.notes[1].time, 3);
  close(song.duration, 6);
  assert.deepEqual(song.tempos, [{ time: 0, bpm: 120 }, { time: 2, bpm: 60 }]);
});

test('MusicXML keeps written staff assignments when hands cross central C and divisions change', async () => {
  const xml = score(`<measure>${attributes}${pitch('C', 3, 16, '<staff>1</staff>')}</measure><measure><attributes><divisions>8</divisions></attributes>${pitch('C', 5, 32, '<staff>2</staff>')}</measure>`);
  const song = await parse(xml);
  assert.deepEqual(song.notes.map(note => [note.midi, note.hand]), [[48, 'right'], [72, 'left']]);
});

test('MusicXML handles implicit pickup, forward and metronome beat units', async () => {
  const xml = score(`<measure number="0" implicit="yes">${attributes}<direction><direction-type><metronome><beat-unit>half</beat-unit><per-minute>60</per-minute></metronome></direction-type></direction>${pitch('G', 4, 4)}</measure><measure number="1"><forward><duration>4</duration></forward>${pitch('C', 5, 4)}<note><rest/><duration>8</duration></note></measure>`);
  const song = await parse(xml);
  close(song.notes[1].time, 1);
  close(song.duration, 2.5);
  assert.equal(song.tempo, 120);
});

test('MusicXML applies transposition, accidental and dotted metronome', async () => {
  const xml = score(`<measure>${attributes}<attributes><transpose><chromatic>-2</chromatic></transpose></attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>80</per-minute></metronome></direction-type></direction><note><pitch><step>C</step><alter>1</alter><octave>4</octave></pitch><duration>16</duration></note></measure>`);
  const song = await parse(xml);
  assert.equal(song.notes[0].midi, 59);
  close(song.duration, 2);
  assert.equal(song.tempo, 120);
});

test('MusicXML aligns separate parts by measure boundary, including sparse parts', async () => {
  const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Um</part-name></score-part><score-part id="P2"><part-name>Dois</part-name></score-part></part-list><part id="P1"><measure>${attributes}${pitch('C', 4, 16)}</measure><measure>${pitch('D', 4, 16)}</measure></part><part id="P2"><measure>${attributes}${pitch('C', 3, 4)}</measure><measure>${pitch('D', 3, 16)}</measure></part></score-partwise>`;
  const song = await parse(xml);
  close(song.notes.find(note => note.midi === 50).time, 2);
  close(song.duration, 4);
});

test('MusicXML integrates a tempo change within a sustained note using sound offset', async () => {
  const xml = score(`<measure>${attributes}${pitch('C', 4, 16)}<direction><offset>-4</offset><sound tempo="60"><offset>-8</offset></sound></direction></measure><measure><attributes><time><beats>3</beats><beat-type>8</beat-type></time></attributes>${pitch('D', 4, 6)}</measure>`);
  const song = await parse(xml);
  close(song.notes[0].duration, 3);
  close(song.notes[1].time, 3);
  close(song.duration, 4.5);
  assert.deepEqual(song.tempos, [{ time: 0, bpm: 120 }, { time: 1, bpm: 60 }]);
  assert.deepEqual(song.timeSignatures, [{ time: 0, numerator: 4, denominator: 4 }, { time: 3, numerator: 3, denominator: 8 }]);
});

test('MusicXML expands a backward repeat from the beginning and warns for grace notes', async () => {
  const xml = score(`<measure>${attributes}<note><grace/><pitch><step>C</step><octave>4</octave></pitch></note>${pitch('D', 4, 16)}<barline><repeat direction="backward"/></barline></measure>`);
  const song = await parse(xml);
  assert.equal(song.notes.length, 2);
  assert.equal(song.warnings.length, 1);
  assert.equal(song.sourceXml, xml);
  assert.deepEqual(song.measureTimeline.map(event => event.measure), [0, 0]);
});

test('MusicXML expands a simple repeat twice and restores tempo at the repeat start', async () => {
  const xml = score(`<measure>${attributes}<barline location="left"><repeat direction="forward"/></barline>${pitch('C', 4, 16)}</measure><measure><direction><sound tempo="60"/></direction>${pitch('D', 4, 16)}<barline location="right"><repeat direction="backward" times="2"/></barline></measure><measure>${pitch('E', 4, 16)}</measure>`);
  const song = await parse(xml);
  assert.deepEqual(song.notes.map(note => note.midi), [60, 62, 60, 62, 64]);
  assert.deepEqual(song.notes.map(note => note.time), [0, 2, 6, 8, 12]);
  close(song.duration, 16);
  assert.deepEqual(song.measureTimeline.map(event => event.measure), [0, 1, 0, 1, 2]);
  assert.deepEqual(song.tempos, [{ time: 0, bpm: 120 }, { time: 2, bpm: 60 }, { time: 6, bpm: 120 }, { time: 8, bpm: 60 }]);
  assert.equal(song.warnings.length, 0);
});

test('MusicXML expands disjoint repeats and keeps ties within their repeat instance', async () => {
  const xml = score(`<measure>${attributes}<barline location="left"><repeat direction="forward"/></barline>${pitch('C', 4, 16, '<tie type="start"/>')}</measure><measure>${pitch('C', 4, 16, '<tie type="stop"/>')}<barline><repeat direction="backward"/></barline></measure><measure><barline location="left"><repeat direction="forward"/></barline>${pitch('E', 4, 16)}<barline><repeat direction="backward"/></barline></measure>`);
  const song = await parse(xml);
  assert.deepEqual(song.notes.map(note => note.midi), [60, 60, 64, 64]);
  assert.deepEqual(song.notes.map(note => note.duration), [4, 4, 2, 2]);
  close(song.duration, 12);
});

test('MusicXML reports unsupported endings, nested repeats and other repeat counts', async () => {
  for (const measures of [
    `<measure>${attributes}${pitch('C', 4, 16)}<barline><ending number="1" type="start"/><repeat direction="backward"/></barline></measure>`,
    `<measure>${attributes}<barline location="left"><repeat direction="forward"/></barline>${pitch('C', 4, 16)}</measure><measure><barline location="left"><repeat direction="forward"/></barline>${pitch('D', 4, 16)}<barline><repeat direction="backward"/></barline></measure>`,
    `<measure>${attributes}${pitch('C', 4, 16)}<barline><repeat direction="backward" times="3"/></barline></measure>`,
  ]) {
    const song = await parse(score(measures));
    assert.ok(song.warnings.some(warning => /não são expandid/.test(warning)));
    assert.equal(song.measureTimeline.length, measures.match(/<measure>/g).length);
  }
});

test('MusicXML rejects compressed, timewise, malformed and unsafe documents', async () => {
  for (const [xml, pattern] of [
    ['PK\u0003\u0004compressed', /comprimido/],
    ['<score-timewise/>', /score-timewise/],
    ['<score-partwise><part></score-partwise>', /malformado/],
    ['<!DOCTYPE score-partwise [<!ENTITY payload "bad">]><score-partwise/>', /entidades/],
    [score(`<measure>${attributes}<backup><duration>4</duration></backup></measure>`), /backup/],
  ]) await assert.rejects(parse(xml), pattern);
});
