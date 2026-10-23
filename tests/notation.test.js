import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { createDemoSongs, normalizeSong } from '../src/music/midi.js';
import { songToMusicXml } from '../src/music/notation.js';

let application, page;
before(async () => {
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ args: [fileURLToPath(new URL('./notation-harness.cjs', import.meta.url))], env: environment });
  page = await application.firstWindow();
  await page.evaluate(async ({ notation, musicxml }) => {
    window.notation = await import(notation);
    window.musicxml = await import(musicxml);
    window.scoreNotes = () => window.scoreController.osmd.Sheet.SourceMeasures.flatMap(measure => measure.VerticalSourceStaffEntryContainers.flatMap(entry => entry.StaffEntries.flatMap(staff => staff?.VoiceEntries.flatMap(voice => voice.Notes.map(note => ({
      rest: note.isRest(), pitch: note.Pitch?.getHalfTone(), transposed: note.halfTone,
      length: note.Length.RealValue, finger: note.Fingering?.Value,
    }))) || [])));
  }, { notation: new URL('../src/music/notation.js', import.meta.url).href, musicxml: new URL('../src/music/musicxml.js', import.meta.url).href });
});
after(async () => { await application?.close(); });

async function render(song, options = {}) {
  return page.evaluate(async ({ song, options }) => {
    window.scoreController = await window.notation.renderScore(document.querySelector('#score'), song, options);
    return {
      source: scoreController.source, measures: scoreController.measureCount,
      svgs: document.querySelectorAll('#score svg').length,
      paths: document.querySelectorAll('#score svg path').length,
      staves: scoreController.osmd.Sheet.Staves.length,
      notes: scoreNotes(), xml: scoreController.xml, warnings: scoreController.warnings,
    };
  }, { song, options });
}

async function clickTimeAtSourceBeat(beat) {
  return page.evaluate(beat => {
    const entries = scoreController.osmd.GraphicSheet.MeasureList.flat().filter(Boolean).flatMap(measure => measure.staffEntries);
    const entry = entries.find(entry => Math.abs(entry.getAbsoluteTimestamp().RealValue * 4 - beat) < 1e-7 && entry.graphicalVoiceEntries.some(voice => voice.notes.some(note => !note.sourceNote.isRest())));
    const note = entry?.graphicalVoiceEntries.flatMap(voice => voice.notes).find(note => !note.sourceNote.isRest());
    const element = note?.getNoteheadSVGs()[0] || note?.getSVGGElement();
    if (!element) throw new Error('Cabeça de nota real não encontrada para o ensaio.');
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    const box = element.getBoundingClientRect();
    return { time: scoreController.timeAtPoint(box.left + box.width / 2, box.top + box.height / 2), x: box.left, y: box.top };
  }, beat);
}

test('offline Electron engraves a MIDI scale with stems, rests, bars and both clefs', async () => {
  const song = createDemoSongs()[0];
  const result = await render(song);
  assert.equal(result.source, 'midi');
  assert.equal(result.staves, 2);
  assert.equal(result.measures, 4);
  assert.ok(result.svgs >= 1);
  assert.ok(result.paths > 35);
  assert.equal(result.notes.filter(note => !note.rest).length, song.notes.length);
  assert.ok(result.notes.some(note => note.rest));
  assert.equal(result.notes.find(note => !note.rest).length, .25);
  assert.match(result.xml, /<type>quarter<\/type>/);
  assert.match(result.xml, /<clef number="2"><sign>F<\/sign>/);
  assert.equal(result.warnings.length, 1);
  await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('../test-results/notation-scale.png', import.meta.url)) });
});

test('learning position names the written measure, beat and audible pitches, including after zoom', async () => {
  await render(createDemoSongs()[0]);
  const result = await page.evaluate(() => {
    scoreController.setCursor(0); const first = scoreController.readingPosition;
    scoreController.setCursor(3); const later = scoreController.readingPosition;
    const head = document.querySelector('[data-pc-midi="60"]');
    const label = head?.getAttribute('aria-label');
    scoreController.setZoom(1.2);
    return { first, later, label, afterZoom: scoreController.readingPosition, captions: document.querySelectorAll('.pc-reading-position').length };
  });
  assert.match(result.first, /Compasso 1 · tempo 1\/4 · Dó4/);
  assert.match(result.later, /Compasso 2 · tempo 2\/4/);
  assert.match(result.label, /Dó4, compasso 1/);
  assert.equal(result.afterZoom, result.later); assert.equal(result.captions, 1);
});

test('chords, independent hands, pauses, ties and fingering use actual notation', async () => {
  const song = normalizeSong({
    title: 'Acorde e pausa', tempo: 120,
    notes: [
      { midi: 60, time: 0, duration: .5, track: 0, hand: 'right', finger: 1 },
      { midi: 64, time: 0, duration: .5, track: 0, hand: 'right', finger: 3 },
      { midi: 67, time: 0, duration: .5, track: 0, hand: 'right', finger: 5 },
      { midi: 48, time: 0, duration: 3, track: 1, hand: 'left', finger: 5 },
      { midi: 62, time: 1, duration: .75, track: 0, hand: 'right', finger: 2 },
    ],
  });
  const result = await render(song);
  assert.match(result.xml, /<chord\/>/);
  assert.match(result.xml, /<fingering>3<\/fingering>/);
  assert.match(result.xml, /<rest\/>/);
  assert.match(result.xml, /<tie type="start"\/>/);
  assert.match(result.xml, /<tie type="stop"\/>/);
  assert.match(result.xml, /<dot\/>/);
  assert.ok(result.paths > 25);
  const cursor = await page.evaluate(() => {
    scoreController.setCursor(0); const first = scoreController.cursorBeat;
    scoreController.setCursor(1); const later = scoreController.cursorBeat;
    scoreController.setCursor(0); return { first, later, back: scoreController.cursorBeat, visible: !scoreController.osmd.cursor.Hidden };
  });
  assert.equal(cursor.first, 0);
  assert.ok(cursor.later > cursor.first);
  assert.equal(cursor.back, 0);
  assert.equal(cursor.visible, true);
});

const originalXml = `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>Ritmos originais</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><time><beats>3</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction><sound tempo="120"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>6</duration><voice>1</voice><type>quarter</type><dot/><staff>1</staff><notations><technical><fingering>2</fingering></technical></notations></note><note><rest/><duration>2</duration><voice>1</voice><type>eighth</type><staff>1</staff></note><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><staff>1</staff></note><backup><duration>12</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>12</duration><voice>2</voice><type>half</type><dot/><staff>2</staff></note></measure><measure number="2"><attributes><time><beats>6</beats><beat-type>8</beat-type></time></attributes><note><pitch><step>E</step><octave>4</octave></pitch><duration>12</duration><voice>1</voice><type>half</type><dot/><staff>1</staff></note><backup><duration>12</duration></backup><note><rest measure="yes"/><duration>12</duration><voice>2</voice><staff>2</staff></note></measure></part></score-partwise>`;

test('original MusicXML preserves dotted rhythm, rest and changing meter without MIDI reconstruction', async () => {
  const song = await page.evaluate(xml => musicxml.parseMusicXml(xml), originalXml);
  song.sourceXml = originalXml;
  const result = await render(song);
  assert.equal(result.source, 'musicxml');
  assert.equal(result.measures, 2);
  assert.deepEqual(result.warnings, []);
  assert.ok(result.notes.some(note => !note.rest && note.length === .375), JSON.stringify(result.notes));
  assert.ok(result.notes.some(note => note.rest && note.length === .125));
  const meters = await page.evaluate(() => scoreController.osmd.Sheet.SourceMeasures.map(measure => [measure.ActiveTimeSignature.Numerator, measure.ActiveTimeSignature.Denominator]));
  assert.deepEqual(meters, [[3, 4], [6, 8]]);
  assert.match(result.xml, /<fingering>2<\/fingering>/);
});

test('score transposition changes engraved pitches by semitones and leaves song audio data intact', async () => {
  const xmlSong = await page.evaluate(xml => musicxml.parseMusicXml(xml), originalXml);
  xmlSong.sourceXml = originalXml;
  for (const song of [createDemoSongs()[0], xmlSong]) {
    const pitchesBefore = song.notes.map(note => note.midi);
    const before = await render(song);
    const after = await render(song, { transpose: 2 });
    const originalPitches = before.notes.filter(note => !note.rest).map(note => note.transposed);
    const transposedPitches = after.notes.filter(note => !note.rest).map(note => note.transposed);
    assert.deepEqual(transposedPitches, originalPitches.map(pitch => pitch + 2));
    assert.deepEqual(song.notes.map(note => note.midi), pitchesBefore);
    assert.equal(await page.locator('#score svg').count(), after.svgs);
  }
});

test('cursor returns to original measure when expanded playback repeats it', async () => {
  const repeatedXml = originalXml.replace('</attributes><direction>', '</attributes><barline location="left"><repeat direction="forward"/></barline><direction>').replace('</measure></part>', '<barline location="right"><repeat direction="backward"/></barline></measure></part>');
  const song = await page.evaluate(xml => musicxml.parseMusicXml(xml), repeatedXml);
  const length = song.measureTimeline[2].time;
  assert.equal(song.measureTimeline.length, 4);
  song.sourceXml = repeatedXml;
  await render(song);
  const cursor = await page.evaluate(length => {
    scoreController.setCursor(1); const first = scoreController.cursorBeat;
    scoreController.setCursor(2.5); const end = scoreController.cursorBeat;
    scoreController.setCursor(length + 1); return { first, end, repeated: scoreController.cursorBeat };
  }, length);
  assert.ok(cursor.end > cursor.first, JSON.stringify(cursor));
  assert.equal(cursor.repeated, cursor.first);
  const click = await clickTimeAtSourceBeat(2);
  assert.equal(click.time, length + 1);
});

test('click navigation uses actual notehead geometry after zoom and scrolling', async () => {
  const song = normalizeSong({ title: 'Navegação', tempo: 120, notes: Array.from({ length: 160 }, (_, index) => ({ midi: 60 + index % 8, time: index * .5, duration: .5, hand: 'right' })) });
  await render(song);
  const first = await clickTimeAtSourceBeat(5);
  assert.equal(first.time, 2.5);
  await page.evaluate(() => scoreController.setZoom(1.4));
  const zoomed = await clickTimeAtSourceBeat(5);
  assert.equal(zoomed.time, 2.5);
  const scrolled = await clickTimeAtSourceBeat(100);
  assert.equal(scrolled.time, 50);
  assert.ok(await page.evaluate(() => document.querySelector('#score').scrollTop > 0));
  assert.equal(await page.evaluate(() => scoreController.timeAtPoint(-100, -100)), null);
});

test('notation survives JSON backup, redraw and zoom, and rejects unsafe original XML', async () => {
  const song = normalizeSong({ ...createDemoSongs()[0], sourceXml: originalXml, measureTimeline: [{ measure: 0, time: 0, beat: 0, sourceBeat: 0 }] });
  const reopened = normalizeSong(JSON.parse(JSON.stringify(song)));
  assert.equal(reopened.sourceXml, originalXml);
  assert.deepEqual(reopened.measureTimeline, song.measureTimeline);
  await render(reopened);
  const result = await page.evaluate(() => {
    scoreController.setCursor(1); scoreController.setZoom(1.25); scoreController.resize();
    const zoom = scoreController.osmd.zoom, paths = document.querySelectorAll('#score path').length;
    scoreController.dispose(); return { zoom, paths, remaining: document.querySelectorAll('#score svg').length };
  });
  assert.equal(result.zoom, 1.25);
  assert.ok(result.paths > 20);
  assert.equal(result.remaining, 0);
  await assert.rejects(render({ ...reopened, sourceXml: '<!DOCTYPE score-partwise [<!ENTITY x "unsafe">]><score-partwise/>' }), /inválido/);
});

test('standard external MusicXML DOCTYPE is removed offline and internal subsets stay rejected', async () => {
  const standardXml = originalXml.replace('<?xml version="1.0"?>', '<?xml version="1.0"?><!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  const requests = [];
  const capture = request => { if (/^https?:/i.test(request.url())) requests.push(request.url()); };
  page.on('request', capture);
  try {
    const song = await page.evaluate(xml => musicxml.parseMusicXml(xml), standardXml);
    assert.equal(song.notes.some(note => note.midi === 60), true);
    const result = await render({ ...song, sourceXml: standardXml });
    assert.equal(result.source, 'musicxml');
    assert.equal(result.measures, 2);
    assert.ok(result.notes.some(note => !note.rest && note.length === .375));
    assert.doesNotMatch(result.xml, /<!DOCTYPE/i);
    assert.deepEqual(requests, []);
    await assert.rejects(render({ ...song, sourceXml: originalXml.replace('<?xml version="1.0"?>', '<?xml version="1.0"?><!DOCTYPE score-partwise [<!-- internal subset -->]>') }), /DTD interna/);
  } finally { page.off('request', capture); }
});

test('automatic transcription handles tempo changes and refuses excessively dense scores explicitly', () => {
  const song = normalizeSong({ notes: [{ midi: 60, time: 0, duration: 1.5 }], tempos: [{ time: 0, bpm: 120 }, { time: .5, bpm: 60 }] });
  const score = songToMusicXml(song);
  assert.match(score.xml, /<per-minute>120<\/per-minute>/);
  assert.match(score.xml, /<per-minute>60<\/per-minute>/);
  assert.match(score.xml, /<duration>64<\/duration>/);
  assert.throws(() => songToMusicXml({ notes: Array.from({ length: 12001 }, () => ({ midi: 60, time: 0, duration: 1 })) }), /até/);
});

async function illuminatedNotes() {
  return page.evaluate(() => [...document.querySelectorAll('#score [data-pc-played]')].map(element => ({
    midi: Number(element.dataset.pcMidi), beat: Number(element.dataset.pcSourceBeat),
    halo: element.querySelectorAll('[data-pc-note-halo]').length,
    color: element.querySelector('path')?.style.fill,
  })).sort((a, b) => a.beat - b.beat || a.midi - b.midi));
}

test('pressed chord tones illuminate individual real noteheads without re-engraving or a layout change', async () => {
  const song = normalizeSong({ title: 'Feedback individual', tempo: 120, notes: [
    { midi: 60, time: 0, duration: .5 }, { midi: 64, time: 0, duration: .5 }, { midi: 67, time: 0, duration: .5 },
    { midi: 64, time: 1, duration: .5 },
  ] });
  await render(song);
  const geometry = await page.evaluate(() => {
    window.feedbackRenders = 0;
    const render = scoreController.osmd.render.bind(scoreController.osmd);
    scoreController.osmd.render = (...args) => { window.feedbackRenders++; return render(...args); };
    const score = document.querySelector('#score'), before = [score.scrollHeight, score.scrollWidth, score.getBoundingClientRect().height];
    const count = scoreController.inputOn({ midi: 64, time: 0, key: 'midi-device:0:64', noteIds: [0, 1, 2] });
    return { before, after: [score.scrollHeight, score.scrollWidth, score.getBoundingClientRect().height], count, renders: window.feedbackRenders };
  });
  assert.equal(geometry.count, 1);
  assert.equal(geometry.renders, 0);
  assert.deepEqual(geometry.after, geometry.before);
  assert.deepEqual((await illuminatedNotes()).map(note => [note.midi, note.beat, note.halo]), [[64, 0, 1]]);
  assert.equal((await illuminatedNotes())[0].color, 'rgb(8, 123, 67)');
  await page.evaluate(() => {
    scoreController.inputOn({ midi: 60, time: 0, key: 'keyboard:0:60', noteIds: [0, 1, 2] });
    scoreController.inputOn({ midi: 67, time: 0, key: 'pointer:1:67', noteIds: [0, 1, 2] });
  });
  assert.deepEqual((await illuminatedNotes()).map(note => note.midi), [60, 64, 67]);
  await page.screenshot({ path: fileURLToPath(new URL('../test-results/notation-input-feedback.png', import.meta.url)) });
});

test('feedback never colors another occurrence of a repeated pitch or a wrong candidate ID', async () => {
  const song = normalizeSong({ title: 'Mesma altura, outro ataque', tempo: 120, notes: [
    { midi: 60, time: 0, duration: .5 }, { midi: 60, time: 1, duration: .5 }, { midi: 62, time: 2, duration: .5 },
  ] });
  await render(song);
  await page.evaluate(() => scoreController.inputOn({ midi: 60, time: 1, key: 'physical', noteIds: [1] }));
  assert.deepEqual((await illuminatedNotes()).map(note => [note.midi, note.beat]), [[60, 2]]);
  await page.evaluate(() => {
    scoreController.clearInputFeedback();
    scoreController.inputOn({ midi: 62, time: 0, key: 'wrong-height', noteIds: [0] });
    scoreController.inputOn({ midi: 62, time: 1.9, key: 'wrong-explicit', noteIds: [] });
    scoreController.inputOn({ midi: 62, time: 0, key: 'distant-inference' });
  });
  assert.deepEqual(await illuminatedNotes(), []);
  await page.evaluate(() => scoreController.inputOn({ midi: 60, time: 1.04, key: 'inferred' }));
  assert.deepEqual((await illuminatedNotes()).map(note => [note.midi, note.beat]), [[60, 2]]);
});

test('short note-off retains a visible flash and independent devices cannot cancel one another', async () => {
  await render(normalizeSong({ title: 'Flash e dispositivos', notes: [{ midi: 60, time: 0, duration: .5 }] }));
  await page.evaluate(() => {
    scoreController.inputOn({ midi: 60, time: 0, key: 'casio:0:60', noteIds: [0] });
    scoreController.inputOn({ midi: 60, time: 0, key: 'pc:0:60', noteIds: [0] });
    scoreController.inputOff('casio:0:60');
  });
  assert.equal((await illuminatedNotes()).length, 1);
  await page.waitForTimeout(390);
  assert.equal((await illuminatedNotes()).length, 1);
  await page.evaluate(() => scoreController.inputOff('pc:0:60'));
  assert.deepEqual(await illuminatedNotes(), []);
  await page.evaluate(() => {
    scoreController.inputOn({ midi: 60, time: 0, key: 'quick', noteIds: [0] });
    scoreController.inputOff('quick');
  });
  assert.equal((await illuminatedNotes()).length, 1);
  await page.waitForTimeout(390);
  assert.deepEqual(await illuminatedNotes(), []);
});

test('transposed MIDI ties light their own sustained heads and survive zoom until explicitly cleared', async () => {
  const song = normalizeSong({ title: 'Ligação transposta', tempo: 120, notes: [
    { midi: 60, time: 0, duration: 3 }, { midi: 60, time: 4, duration: .5 },
  ] });
  await render(song, { transpose: 2 });
  await page.evaluate(() => scoreController.inputOn({ midi: 62, time: 0, key: 'physical', noteIds: [0] }));
  const before = await illuminatedNotes();
  assert.deepEqual(before.map(note => [note.midi, note.beat]), [[62, 0], [62, 4]]);
  await page.evaluate(() => { scoreController.setZoom(1.4); scoreController.resize(); });
  assert.deepEqual(await illuminatedNotes(), before);
  await page.evaluate(() => scoreController.clearInputFeedback());
  assert.deepEqual(await illuminatedNotes(), []);
  assert.equal(await page.locator('[data-pc-note-halo]').count(), 0);
  await page.evaluate(() => { scoreController.resize(); scoreController.inputOn({ midi: 60, time: 0, key: 'untransposed', noteIds: [0] }); });
  assert.deepEqual(await illuminatedNotes(), []);
});

test('original repeated MusicXML maps performed notes to the source measure after transposition', async () => {
  const repeatedXml = originalXml.replace('</attributes><direction>', '</attributes><barline location="left"><repeat direction="forward"/></barline><direction>').replace('</measure></part>', '<barline location="right"><repeat direction="backward"/></barline></measure></part>');
  const song = await page.evaluate(xml => musicxml.parseMusicXml(xml), repeatedXml);
  song.sourceXml = repeatedXml;
  await render(song, { transpose: -2 });
  const repeatedStart = song.measureTimeline[2].time;
  const performedD = song.notes.find(note => note.midi === 62 && note.time > repeatedStart);
  assert.ok(performedD);
  await page.evaluate(({ id, time }) => {
    scoreController.setCursor(time);
    scoreController.inputOn({ midi: 60, time, key: 'casio', noteIds: [id] });
  }, performedD);
  assert.deepEqual((await illuminatedNotes()).map(note => [note.midi, note.beat]), [[60, 2]]);
});

test('original MusicXML tied note lights both written segments without lighting a later reattack', async () => {
  const xml = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><tie type="start"/><type>whole</type><notations><tied type="start"/></notations></note></measure><measure number="2"><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><tie type="stop"/><type>whole</type><notations><tied type="stop"/></notations></note></measure><measure number="3"><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`;
  const song = await page.evaluate(xml => musicxml.parseMusicXml(xml), xml);
  song.sourceXml = xml;
  assert.equal(song.notes.length, 2);
  await render(song);
  await page.evaluate(() => scoreController.inputOn({ midi: 60, time: 0, key: 'casio', noteIds: [0] }));
  assert.deepEqual((await illuminatedNotes()).map(note => [note.midi, note.beat]), [[60, 0], [60, 4]]);
});

test('feedback preserves caller note IDs when normalized notes are not in their original input order', async () => {
  const song = normalizeSong({ title: 'Identidade', notes: [{ midi: 64, time: 1, duration: .5 }, { midi: 60, time: 0, duration: .5 }] });
  assert.equal(song.notes.find(note => note.midi === 64).id, 0);
  await render(song);
  await page.evaluate(() => scoreController.inputOn({ midi: 64, time: 1, key: 'input', noteIds: [0] }));
  assert.deepEqual((await illuminatedNotes()).map(note => [note.midi, note.beat]), [[64, 2]]);
});
