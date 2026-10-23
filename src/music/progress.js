/** Per-song practice evidence. A completed loop is an attempt, not a new session. */
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const text = (value, length = 200) => typeof value === 'string' ? value.trim().slice(0, length) : '';
const count = value => finite(value) ? clamp(Math.round(value), 0, 1e7) : 0;
const list = value => Array.isArray(value) ? value : [];
const reasons = new Set(['wrong-note', 'outside-onset-window', 'chord-timeout', 'released-before-chord', 'released-too-early', 'onset-missed']);
export const errorReasonLabels = {
  'wrong-note': 'Nota diferente', 'outside-onset-window': 'Ataque fora do tempo',
  'chord-timeout': 'Notas do acorde separadas', 'released-before-chord': 'Acorde incompleto',
  'released-too-early': 'Nota solta antes da duração', 'onset-missed': 'Nota não tocada no tempo',
};

export function normalizeErrorEvents(input, duration = Infinity) {
  return list(input).slice(0, 128).filter(event => event && finite(event.time) && event.time >= 0 && event.time <= duration && reasons.has(event.reason))
    .map(event => {
      const result = { time: event.time, reason: event.reason, type: ['pitch', 'timing', 'chord', 'duration', 'miss'].includes(event.type) ? event.type : 'pitch', count: Math.max(1, count(event.count)),
        expectedPitches: [...new Set(list(event.expectedPitches).filter(pitch => Number.isInteger(pitch) && pitch >= 0 && pitch <= 127))].slice(0, 32),
        noteIds: list(event.noteIds).filter(id => typeof id === 'string' || finite(id)).slice(0, 32).map(id => typeof id === 'string' ? id.slice(0, 200) : id) };
      if (Number.isInteger(event.midi) && event.midi >= 0 && event.midi <= 127) result.midi = event.midi;
      if (finite(event.playedTime) && event.playedTime >= 0) result.playedTime = Math.min(864000, event.playedTime);
      return result;
    });
}

/** Safe optional metadata for imported as well as newly recorded attempts. */
export function normalizeAttempt(input) {
  if (!input || typeof input !== 'object' || !text(input.id) || !text(input.profile, 40) || !text(input.title, 300)) return null;
  const timestamp = Date.parse(input.date);
  if (!Number.isFinite(timestamp) || !finite(input.seconds) || input.seconds < 0) return null;
  const result = { id: text(input.id), title: text(input.title, 300), profile: text(input.profile, 40),
    date: new Date(timestamp).toISOString(), seconds: clamp(input.seconds, 0, 864000),
    mode: ['melody', 'rhythm', 'recital'].includes(input.mode) ? input.mode : 'rhythm',
    hands: ['both', 'left', 'right'].includes(input.hands) ? input.hands : 'both', completed: input.completed === true,
    accuracy: finite(input.accuracy) ? clamp(Math.round(input.accuracy), 0, 100) : null,
    hits: count(input.hits), errors: count(input.errors), missed: count(input.missed) };
  for (const key of ['songId', 'practiceSessionId', 'attemptId', 'analysisKey', 'songContentKey', 'journeyTaskId', 'patternId', 'familyId', 'exerciseId', 'phraseId', 'phraseName']) if (text(input[key])) result[key] = text(input[key]);
  for (const key of ['start', 'end', 'position', 'phraseStart', 'phraseEnd']) if (finite(input[key]) && input[key] >= 0) result[key] = Math.min(input[key], 864000);
  if (finite(input.speed) && input.speed > 0) result.speed = Math.min(input.speed, 4);
  if (Number.isInteger(input.transpose) && Math.abs(input.transpose) <= 48) result.transpose = input.transpose;
  result.fullArrangement = input.fullArrangement === true;
  if (typeof input.scopeComplete === 'boolean') result.scopeComplete = input.scopeComplete;
  if (finite(input.expectedNotes)) result.expectedNotes = count(input.expectedNotes);
  result.errorEvents = normalizeErrorEvents(input.errorEvents);
  if (finite(input.errorEventsDropped)) result.errorEventsDropped = count(input.errorEventsDropped);
  return result;
}

function accuracy(rows) {
  const totals = rows.reduce((sum, row) => ({ hits: sum.hits + row.hits, total: sum.total + row.hits + row.errors + row.missed }), { hits: 0, total: 0 });
  if (totals.total) return Math.round(100 * totals.hits / totals.total);
  const fallback = rows.filter(row => row.accuracy !== null);
  return fallback.length ? Math.round(fallback.reduce((sum, row) => sum + row.accuracy, 0) / fallback.length) : null;
}
function interval(row, duration, completedOnly = false) {
  if (completedOnly && !row.completed) return null;
  const start = row.start ?? row.phraseStart ?? 0;
  let end = row.end ?? row.phraseEnd ?? (row.completed && !row.phraseId ? duration : null);
  if (!row.completed) end = finite(row.position) ? Math.min(end ?? duration, row.position) : null;
  return finite(end) && end > start && start < duration ? [clamp(start, 0, duration), clamp(end, 0, duration)] : null;
}
function unionLength(intervals) {
  const sorted = intervals.filter(Boolean).sort((a, b) => a[0] - b[0]);
  let total = 0, end = -Infinity;
  for (const [a, b] of sorted) { total += Math.max(0, b - Math.max(a, end)); end = Math.max(end, b); }
  return total;
}
function sessionGroups(rows) {
  const result = [], explicit = new Map(); let legacy = null;
  for (const row of [...rows].sort((a, b) => Date.parse(a.date) - Date.parse(b.date))) {
    if (row.practiceSessionId) {
      let session = explicit.get(row.practiceSessionId);
      if (!session) { session = { id: row.practiceSessionId, rows: [], estimated: false }; explicit.set(row.practiceSessionId, session); result.push(session); }
      session.rows.push(row); legacy = null;
    } else {
      const timestamp = Date.parse(row.date);
      // Older releases recorded each repeat separately. A gap of 30 minutes
      // starts a new estimated session, without claiming an exact session count.
      if (!legacy || timestamp - legacy.lastTime > 30 * 60 * 1000) { legacy = { id: `legacy:${row.id}`, rows: [], estimated: true, lastTime: timestamp }; result.push(legacy); }
      legacy.rows.push(row); legacy.lastTime = timestamp;
    }
  }
  return result.map(session => ({ id: session.id, estimated: session.estimated,
    date: session.rows.at(-1).date, attempts: session.rows.length,
    seconds: session.rows.reduce((sum, row) => sum + row.seconds, 0), accuracy: accuracy(session.rows),
    hits: session.rows.reduce((sum, row) => sum + row.hits, 0), errors: session.rows.reduce((sum, row) => sum + row.errors, 0), missed: session.rows.reduce((sum, row) => sum + row.missed, 0),
    rows: session.rows })).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}
function scoreEvidence(song, rows) {
  const duration = Math.max(0, Number(song.duration) || 0);
  const qualifying = rows.filter(row => {
    const range = interval(row, duration, true);
    return range && row.completed && row.fullArrangement === true && row.transpose === 0 && ['rhythm', 'recital'].includes(row.mode) && row.hands === 'both' && row.speed >= .9 && row.speed <= 1.1 && row.hits + row.errors + row.missed > 0 && row.seconds >= (range[1] - range[0]) / row.speed * .6;
  });
  const coverage = duration ? unionLength(qualifying.map(row => interval(row, duration, true))) / duration : 0;
  if (!qualifying.length) return { score: null, coverage: 0, assessmentAccuracy: null, assessmentSessions: 0, masteryLabel: 'Sem avaliação', scoreExplanation: 'O score usa trechos concluídos em Ritmo ou Recital, com o arranjo completo, duas mãos, sem transposição, entre 90% e 110% do andamento. Práticas guiadas continuam registradas.' };
  // Use the most recent three attempts at each small region. This lets later
  // regressions lower the score; a single perfect fragment cannot represent a song.
  const notes = list(song.notes).filter(note => finite(note.time));
  const bins = Math.min(128, Math.max(8, Math.ceil(duration / 4))), size = duration / bins;
  const weights = Array(bins).fill(notes.length ? 0 : 1);
  for (const note of notes) if (note.time >= 0 && note.time < duration) weights[Math.min(bins - 1, Math.floor(note.time / size))]++;
  let evidence = 0, weight = 0;
  for (let i = 0; i < bins; i++) {
    const center = (i + .5) * size, regionWeight = weights[i];
    const at = qualifying.filter(row => { const [a, b] = interval(row, duration, true); return a <= center && b >= center; }).slice(0, 3);
    weight += regionWeight;
    if (at.length) evidence += regionWeight * (accuracy(at) ?? 0) * (.7 + .3 * Math.min(1, new Set(at.map(row => row.practiceSessionId || `legacy:${row.date.slice(0, 10)}`)).size / 3));
  }
  const score = weight ? Math.round(evidence / weight) : 0;
  const sessions = sessionGroups(qualifying).length, assessmentAccuracy = accuracy(qualifying.slice(0, 10));
  const masteryLabel = coverage >= .95 && score >= 90 && sessions >= 3 ? 'Consistente' : coverage >= .95 && score >= 70 ? 'Em consolidação' : coverage >= .3 ? 'Em desenvolvimento' : 'Trechos em avaliação';
  return { score, coverage, assessmentAccuracy, assessmentSessions: sessions, masteryLabel,
    scoreExplanation: 'Score de 0 a 100: precisão recente nas regiões avaliadas, cobertura das notas da música e repetição em sessões diferentes. Regiões ainda sem avaliação não somam pontos.' };
}
function hotspots(song, rows, sessions) {
  const duration = Math.max(0, Number(song.duration) || 0), meter = list(song.timeSignatures)[0] || { numerator: 4, denominator: 4 };
  const window = clamp(60 / clamp(Number(song.tempo) || 120, 20, 400) * (meter.numerator || 4) * 4 / (meter.denominator || 4) * 2, 2, 12);
  const sessionFor = new Map(); for (const session of sessions) for (const row of session.rows) sessionFor.set(row.id, session.id);
  const bins = new Map();
  for (const row of rows) for (const event of row.errorEvents) {
    if (event.time > duration || !duration) continue;
    const index = Math.floor(event.time / window);
    let bin = bins.get(index);
    if (!bin) { bin = { id: `hotspot-${index}`, start: index * window, end: Math.min(duration, (index + 1) * window), errors: 0, reasons: new Map(), pitches: new Map(), attempts: new Set(), sessions: new Set(), samples: [] }; bins.set(index, bin); }
    bin.errors += event.count; bin.reasons.set(event.reason, (bin.reasons.get(event.reason) || 0) + event.count);
    for (const pitch of event.expectedPitches) bin.pitches.set(pitch, (bin.pitches.get(pitch) || 0) + event.count);
    bin.attempts.add(row.id); bin.sessions.add(sessionFor.get(row.id));
    if (bin.samples.length < 5) bin.samples.push(event);
  }
  return [...bins.values()].map(bin => {
    const ranked = [...bin.reasons].sort((a, b) => b[1] - a[1]), mainReason = ranked[0]?.[0];
    const exposure = rows.filter(row => { const range = interval(row, duration); return bin.attempts.has(row.id) || range && range[0] < bin.end && range[1] > bin.start; }).length;
    const phrase = list(song.phrasing?.phrases).find(phrase => phrase.start <= bin.start && phrase.end > bin.start);
    return { id: bin.id, start: bin.start, end: bin.end, errors: bin.errors, attempts: bin.attempts.size, sessions: bin.sessions.size,
      exposures: exposure, recurrence: bin.sessions.size >= 2 ? 'across-sessions' : bin.attempts.size >= 2 ? 'within-session' : 'single-attempt',
      reason: mainReason, reasonLabel: errorReasonLabels[mainReason], reasons: ranked.map(([reason, total]) => ({ reason, label: errorReasonLabels[reason], count: total })),
      expectedPitches: [...bin.pitches].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([midi]) => midi), samples: bin.samples,
      phraseId: phrase?.id, phraseName: phrase?.name,
      instruction: mainReason === 'released-too-early' ? 'Sustente as notas até completar sua duração. Escute e compare com a partitura.' : ['chord-timeout', 'released-before-chord'].includes(mainReason) ? 'Prepare as notas do acorde antes de tocar. Comece lentamente e ataque as teclas juntas.' : mainReason === 'wrong-note' ? 'Localize as notas e os intervalos na partitura. Pratique devagar, sem repetir o erro em sequência.' : 'Conte os pulsos em voz alta e toque com metrônomo, primeiro em andamento reduzido.',
    };
  }).sort((a, b) => b.sessions - a.sessions || b.errors - a.errors || a.start - b.start).slice(0, 12);
}

function summarize(song, rows) {
  rows.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const sessions = sessionGroups(rows), recent = sessions.slice(0, 5);
  const latest = rows[0], context = latest ? `${latest.mode}:${latest.hands}:${Math.round((latest.speed || 1) * 10)}` : null;
  const comparable = sessions.map(session => ({ ...session, rows: session.rows.filter(row => `${row.mode}:${row.hands}:${Math.round((row.speed || 1) * 10)}` === context) })).filter(session => session.rows.length);
  const recentContext = comparable.slice(0, 3).flatMap(session => session.rows), previousContext = comparable.slice(3, 6).flatMap(session => session.rows);
  const recentAccuracy = accuracy(recentContext), previousAccuracy = accuracy(previousContext);
  const trend = comparable.length >= 4 && recentAccuracy !== null && previousAccuracy !== null ? recentAccuracy - previousAccuracy : null;
  const duration = Math.max(0, Number(song.duration) || 0), evaluated = scoreEvidence(song, rows);
  return { songId: song.id, title: song.title, duration, sessions: sessions.length, estimatedSessions: sessions.filter(session => session.estimated).length,
    attempts: rows.length, seconds: rows.reduce((sum, row) => sum + row.seconds, 0), accuracy: accuracy(rows), recentAccuracy, previousAccuracy, trend,
    trendContext: latest ? { mode: latest.mode, hands: latest.hands, speed: latest.speed ?? null } : null,
    lastPracticeAt: latest?.date ?? null, lastPracticeMs: latest ? Date.parse(latest.date) : 0,
    studiedCoverage: duration ? unionLength(rows.map(row => interval(row, duration, true))) / duration : 0,
    errorEventsDropped: rows.reduce((sum, row) => sum + (row.errorEventsDropped || 0), 0),
    ...evaluated, hotspots: hotspots(song, recent.flatMap(session => session.rows), recent), hotspotSessions: recent.length,
    sessionHistory: sessions.slice(0, 12).map(({ rows: items, ...session }) => session),
    evolution: sessions.slice(0, 20).reverse().map(session => ({ date: session.date, accuracy: session.accuracy, seconds: session.seconds, attempts: session.attempts })),
    recentSeconds: recent.reduce((sum, session) => sum + session.seconds, 0),
  };
}

export function summarizeProgress(songs, history, { profile = 'Meu perfil' } = {}) {
  const normalized = [], seen = new Set();
  for (const raw of list(history)) {
    const row = normalizeAttempt(raw); if (!row || row.profile !== profile) continue;
    const key = `${row.songId || row.title}:${row.attemptId || row.id}`; if (seen.has(key)) continue; seen.add(key); normalized.push(row);
  }
  const titles = new Map(); for (const song of list(songs)) titles.set(song.title, (titles.get(song.title) || 0) + 1);
  const summaries = list(songs).map(song => summarize(song, normalized.filter(row => row.songId ? row.songId === song.id : row.title === song.title && titles.get(song.title) === 1)));
  const active = summaries.filter(song => song.attempts > 0);
  return { songs: summaries, totals: { songs: active.length, sessions: active.reduce((sum, song) => sum + song.sessions, 0), attempts: active.reduce((sum, song) => sum + song.attempts, 0), seconds: active.reduce((sum, song) => sum + song.seconds, 0), accuracy: accuracy(normalized), scoredSongs: active.filter(song => song.score !== null).length } };
}
export function songProgress(song, history, options = {}) { return summarizeProgress([song], history, options).songs[0]; }
