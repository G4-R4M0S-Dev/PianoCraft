import { achievementContentKey, summarizeAchievements } from './achievements.js';
import { analyzePatterns, createPatternClock, normalizePatternAnalysis } from './patterns.js';
import { handOf } from './practice.js';

/** Suggestions are a route through real notes, never proof of musical mastery. */
const VERSION = 1, TARGET = 90, STREAK = 3, EPS = 1e-5;
const MODES = ['melody', 'rhythm', 'recital'], HANDS = ['left', 'right', 'both'];
const MODE_LABELS = { melody: 'Melodia', rhythm: 'Ritmo', recital: 'Recital' };
const HAND_LABELS = { left: 'mão esquerda', right: 'mão direita', both: 'ambas as mãos' };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const text = (value, fallback = '', limit = 300) => typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : fallback;
const list = value => Array.isArray(value) ? value : [];
const rounded = value => Math.round(value * 1e6) / 1e6;
const cache = new WeakMap();

function hash(value) {
  let first = 2166136261, second = 2246822519;
  for (const char of String(value)) { const code = char.charCodeAt(0); first = Math.imul(first ^ code, 16777619); second = Math.imul(second ^ code, 3266489917); }
  return `${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
}

function context(song, profile) {
  song = song && typeof song === 'object' && !Array.isArray(song) ? song : {};
  const duration = finite(song.duration) && song.duration > 0 ? song.duration : 0;
  const notes = list(song.notes).filter(note => note && finite(note.time) && note.time >= 0 && note.time < duration && Number.isInteger(note.midi) && note.midi >= 0 && note.midi <= 127)
    .map(note => ({ ...note, assignedHand: handOf(note, song.configs || {}) })).sort((a, b) => a.time - b.time || a.midi - b.midi);
  return { song, songId: text(song.id), profile: text(profile, 'Meu perfil', 40), duration, notes, contentKey: achievementContentKey(song) };
}

function lowerBound(notes, time) { let low = 0, high = notes.length; while (low < high) { const middle = (low + high) >>> 1; if (notes[middle].time < time) low = middle + 1; else high = middle; } return low; }
function notesIn(ctx, task) {
  const notes = ctx.notes.slice(lowerBound(ctx.notes, task.start), lowerBound(ctx.notes, task.end));
  return task.hands === 'both' ? notes : notes.filter(note => task.hands === note.assignedHand);
}
function handsIn(ctx, range) {
  const hands = new Set(notesIn(ctx, { ...range, hands: 'both' }).map(note => note.assignedHand));
  return hands.has('left') && hands.has('right') ? ['right', 'left', 'both'] : hands.has('right') ? ['right'] : hands.has('left') ? ['left'] : [];
}

function structureFor(ctx) {
  const raw = ctx.song.phrasing;
  const signature = `${ctx.contentKey}|${ctx.song.tempo}|${JSON.stringify(ctx.song.tempos ?? [])}|${JSON.stringify(ctx.song.timeSignatures ?? [])}|${JSON.stringify(raw ?? null)}`;
  const previous = cache.get(ctx.song);
  if (previous?.signature === signature) return previous.structure;
  let structure = normalizePatternAnalysis(raw, ctx.duration);
  if (!structure) {
    try { structure = analyzePatterns(ctx.song); }
    catch { structure = { reviewed: false, phrases: [], patterns: [] }; }
  }
  cache.set(ctx.song, { signature, structure });
  return structure;
}

/** A long phrase is practiced in small bar-aligned portions, without changing
 * its reviewed boundaries or persisting an automatic analysis as reviewed. */
function unitsFor(ctx, structure) {
  if (!ctx.notes.length || !ctx.duration) return [];
  const memo = cache.get(ctx.song);
  if (memo?.structure === structure && memo.units) return memo.units;
  const clock = createPatternClock(ctx.song, ctx.duration);
  const source = list(structure.phrases).filter(phrase => finite(phrase?.start) && finite(phrase?.end) && phrase.start >= 0 && phrase.end > phrase.start && phrase.start < ctx.duration)
    .slice(0, 512).map((phrase, index) => ({ ...phrase, id: text(phrase.id, `phrase-${index + 1}`, 80), start: phrase.start, end: Math.min(ctx.duration, phrase.end) })).sort((a, b) => a.start - b.start);
  if (!source.length) source.push({ id: 'opening', name: 'Trecho inicial', start: 0, end: ctx.duration, variant: 'unique', patternId: 'opening', patternLabel: '' });
  const units = [];
  for (const phrase of source) {
    let start = phrase.start, part = 0;
    while (start < phrase.end - EPS && units.length < 2048) {
      const firstNote = ctx.notes[lowerBound(ctx.notes, start)];
      if (!firstNote || firstNote.time >= phrase.end) break;
      // Skip a long empty introduction or interlude; retain one bar of context.
      if (firstNote.time - start > 8) {
        const beat = clock.toBeat(firstNote.time), section = clock.sectionAt(beat);
        start = Math.max(start, clock.toTime(section.beat + Math.floor((beat - section.beat) / section.beatsPerBar) * section.beatsPerBar));
      }
      const beat = clock.toBeat(start), section = clock.sectionAt(beat);
      const bar = section.beat + (Math.floor((beat - section.beat) / section.beatsPerBar + EPS) + 4) * section.beatsPerBar;
      let end = Math.min(phrase.end, clock.toTime(bar));
      // Four very slow bars can still be too long for a first exercise.
      if (end - start > 20) {
        const singleBar = section.beat + (Math.floor((beat - section.beat) / section.beatsPerBar + EPS) + 1) * section.beatsPerBar;
        end = Math.min(phrase.end, clock.toTime(singleBar), start + 20);
      }
      if (!(end > start + EPS)) end = Math.min(phrase.end, start + 8);
      const range = { start: rounded(start), end: rounded(end) };
      if (notesIn(ctx, { ...range, hands: 'both' }).length) units.push({ ...phrase, ...range, part: ++part, portion: start > phrase.start + EPS || end < phrase.end - EPS });
      start = end;
    }
    if (units.length >= 2048) break;
  }
  if (memo?.structure === structure) memo.units = units;
  return units;
}

function occurrencesFor(structure, phrase) {
  return list(structure.phrases).filter(item => phrase?.patternId && item?.patternId === phrase.patternId)
    .slice(0, 512).map(item => ({ phraseId: text(item.id, '', 80), start: item.start, end: item.end, variant: text(item.variant, 'unique', 30), label: text(item.name, 'Frase', 100) }));
}

function defaultSpeed(mode) { return mode === 'melody' ? .6 : mode === 'rhythm' ? .9 : 1; }
function taskFrom(ctx, structure, options = {}) {
  const units = unitsFor(ctx, structure), fallback = units[0];
  if (!fallback) return null;
  const hasRange = finite(options.start) && finite(options.end) && options.start >= 0 && options.end > options.start && options.end <= ctx.duration + EPS;
  const unit = units.find(item => options.phraseId && item.id === options.phraseId && (!hasRange || item.start <= options.start + EPS && item.end >= options.end - EPS))
    ?? units.find(item => hasRange && item.start <= options.start + EPS && item.end >= options.end - EPS) ?? fallback;
  const range = hasRange ? { start: rounded(options.start), end: rounded(Math.min(ctx.duration, options.end)) } : { start: unit.start, end: unit.end };
  const available = handsIn(ctx, range);
  const mode = MODES.includes(options.mode) ? options.mode : 'melody';
  const hands = HANDS.includes(options.hands) ? options.hands : available[0];
  if (!hands || !notesIn(ctx, { ...range, hands }).length) return null;
  const speed = mode === 'recital' ? 1 : finite(options.speed) && options.speed >= .2 && options.speed <= 1.5 ? rounded(options.speed) : defaultSpeed(mode);
  const phraseId = text(options.phraseId, text(unit.id), 80), patternId = text(options.patternId, text(unit.patternId), 80);
  const phrase = list(structure.phrases).find(item => item.id === phraseId) ?? unit;
  const occurrences = occurrencesFor(structure, { ...phrase, patternId });
  const label = text(phrase.patternLabel, text(list(structure.patterns).find(item => item.id === patternId)?.label), 30);
  const patternName = label ? `Padrão ${label}` : text(phrase.name, 'Trecho inicial', 100);
  const variation = ['variation', 'transposed'].includes(phrase.variant), returns = phrase.variant === 'exact' || phrase.variant === 'repeat';
  const phraseName = `${variation ? 'Comparar a variação' : returns ? 'Reconhecer o retorno' : patternName}${unit.portion ? ` · parte ${unit.part}` : ''}`;
  const instruction = `${variation ? 'Compare as notas e os intervalos que mudaram; depois toque' : returns ? 'Reconheça o desenho já estudado e comece diretamente neste ponto; toque' : 'Observe o desenho na partitura e toque'} com ${HAND_LABELS[hands]} a ${Math.round(speed * 100)}% do andamento. Faça ${STREAK} execuções consecutivas com pelo menos ${TARGET}% de precisão.`;
  const reason = occurrences.length > 1 ? `Este padrão reaparece em ${occurrences.length} frases. Cada retorno precisa ser tocado; reconhecer a semelhança não comprova a execução.` : 'Estude um trecho curto e reconheça suas notas, intervalos e ritmo antes de juntar a música.';
  return { version: VERSION, id: `journey-${hash(JSON.stringify([ctx.contentKey, range.start, range.end, mode, hands, speed]))}`, contentKey: ctx.contentKey,
    title: text(options.title, `${phraseName} · ${HAND_LABELS[hands]}`, 160), instruction: text(options.instruction, instruction, 700),
    ...range, mode, hands, speed, repeatCount: STREAK, targetAccuracy: TARGET, targetStreak: STREAK, guided: true,
    patternId, phraseId, patternLabel: label, reason: text(options.reason, reason, 600), occurrences,
    suggestedStructure: structure.reviewed !== true, noteCount: notesIn(ctx, { ...range, hands }).length,
    estimatedSeconds: Math.round((range.end - range.start) / speed * STREAK), streak: 0 };
}

/** Explicit path selection reuses a range instead of restarting the whole song. */
export function createJourneyTask(song, options = {}) {
  const ctx = context(song, options.profile), structure = structureFor(ctx);
  return taskFrom(ctx, structure, options);
}

function validState(input, ctx) {
  return input && typeof input === 'object' && !Array.isArray(input) && input.version === VERSION && input.songId === ctx.songId && input.profile === ctx.profile && input.contentKey === ctx.contentKey;
}
function normalizeState(input, ctx, structure) {
  const empty = { version: VERSION, songId: ctx.songId, profile: ctx.profile, contentKey: ctx.contentKey,
    task: taskFrom(ctx, structure), streak: 0, passed: [], seenAttemptIds: [], lastAttemptId: '', lastAccuracy: null,
    lastOutcome: 'new', started: false, startedAt: null, updatedAt: null, completed: false };
  if (!validState(input, ctx)) return empty;
  const rawTask = input.task;
  if (rawTask && rawTask.contentKey && rawTask.contentKey !== ctx.contentKey) return empty;
  const task = rawTask && finite(rawTask.start) && finite(rawTask.end) && rawTask.start >= 0 && rawTask.end > rawTask.start && rawTask.end <= ctx.duration + EPS
    && MODES.includes(rawTask.mode) && HANDS.includes(rawTask.hands) && finite(rawTask.speed) && rawTask.speed >= .2 && rawTask.speed <= 1.5
    && (rawTask.mode !== 'recital' || rawTask.speed === 1) ? taskFrom(ctx, structure, rawTask) : null;
  if (rawTask && !task) return empty;
  empty.task = task ?? empty.task;
  const sameTask = rawTask?.id === empty.task?.id;
  empty.streak = sameTask && Number.isInteger(input.streak) ? clamp(input.streak, 0, STREAK - 1) : 0;
  const ids = values => [...new Set(list(values).map(value => text(value, '', 180)).filter(Boolean))];
  empty.passed = ids(input.passed).slice(-4096); empty.seenAttemptIds = ids(input.seenAttemptIds).slice(-256);
  empty.lastAttemptId = text(input.lastAttemptId, '', 180);
  empty.lastAccuracy = finite(input.lastAccuracy) ? clamp(input.lastAccuracy, 0, 100) : null;
  empty.lastOutcome = ['new', 'success', 'retry', 'goal', 'review'].includes(input.lastOutcome) ? input.lastOutcome : 'new';
  empty.startedAt = Number.isFinite(Date.parse(input.startedAt)) ? new Date(input.startedAt).toISOString() : null;
  empty.updatedAt = Number.isFinite(Date.parse(input.updatedAt)) ? new Date(input.updatedAt).toISOString() : null;
  empty.started = input.started === true || Boolean(empty.startedAt) || Boolean(empty.lastAttemptId);
  empty.completed = input.completed === true;
  if (finite(input.position) && input.position >= (empty.task?.start ?? 0) && input.position <= (empty.task?.end ?? ctx.duration)) empty.position = input.position;
  if (empty.task) empty.task.streak = empty.streak;
  return empty;
}

function recordedDifficulty(ctx, structure, history) {
  const rows = list(history).filter(row => row && row.songId === ctx.songId && row.profile === ctx.profile && row.songContentKey === ctx.contentKey
    && MODES.includes(row.mode) && Number.isFinite(Date.parse(row.date)) && finite(row.seconds) && row.seconds > 0 && list(row.errorEvents).length)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const sessions = new Set(), seen = new Set(), recent = [];
  for (const row of rows) {
    const id = text(row.attemptId, text(row.id)); if (!id || seen.has(id)) continue;
    const session = text(row.practiceSessionId, id);
    if (!sessions.has(session) && sessions.size >= 5) continue;
    sessions.add(session); seen.add(id); recent.push({ row, id, session });
    if (recent.length >= 50) break;
  }
  if (!recent.length) return null;
  const buckets = unitsFor(ctx, structure).map(unit => ({ unit, count: 0, sessions: new Set(), attempts: new Set(), hands: new Map() }));
  const validReasons = new Set(['wrong-note', 'outside-onset-window', 'chord-timeout', 'released-before-chord', 'released-too-early', 'onset-missed']);
  for (const { row, id, session } of recent) {
    for (const event of list(row.errorEvents).slice(0, 128)) {
      if (!finite(event?.time) || event.time < 0 || !validReasons.has(event.reason)) continue;
      const bucket = buckets.find(item => event.time >= item.unit.start && event.time < item.unit.end);
      if (!bucket) continue;
      const selected = notesIn(ctx, { ...bucket.unit, hands: 'both' });
      const expectedPitches = new Set(list(event.expectedPitches).filter(pitch => Number.isInteger(pitch) && pitch >= 0 && pitch <= 127));
      const expectedHands = new Set(selected.filter(note => expectedPitches.has(note.midi) && Math.abs(note.time - event.time) <= 1).map(note => note.assignedHand));
      let hands = row.hands === 'left' || row.hands === 'right' ? row.hands : expectedHands.size === 1 ? [...expectedHands][0] : expectedHands.size > 1 ? 'both' : handsIn(ctx, bucket.unit)[0];
      if (!selected.some(note => hands === 'both' || note.assignedHand === hands)) continue;
      const count = Number.isInteger(event.count) && event.count > 0 ? Math.min(1000, event.count) : 1;
      bucket.count += count; bucket.sessions.add(session); bucket.attempts.add(id);
      bucket.hands.set(hands, (bucket.hands.get(hands) || 0) + count);
    }
  }
  const best = buckets.filter(bucket => bucket.count).sort((a, b) => b.sessions.size - a.sessions.size || b.attempts.size - a.attempts.size || b.count - a.count || a.unit.start - b.unit.start)[0];
  if (!best) return null;
  const hands = [...best.hands].sort((a, b) => b[1] - a[1])[0][0], pattern = text(best.unit.patternLabel, text(best.unit.name, 'este trecho'), 60);
  return taskFrom(ctx, structure, { ...best.unit, phraseId: best.unit.id, mode: 'melody', hands, speed: .6,
    title: `Revisar ${best.unit.patternLabel ? `o padrão ${pattern}` : pattern} · ${HAND_LABELS[hands]}`,
    reason: `${best.count} erro(s) registrado(s) neste trecho em ${best.attempts.size} tentativa(s) de ${best.sessions.size} sessão(ões) recentes. Comece por esta dificuldade antes de juntar os trechos.`,
  });
}

/** A task cursor is isolated by profile, song, actual notes and hand assignment. */
export function normalizeJourneyState(input, song, { profile = 'Meu perfil' } = {}) {
  const ctx = context(song, profile);
  return normalizeState(input, ctx, structureFor(ctx));
}

/** One primary percentage; technical assessment remains a separate metric. */
export function learningProgress(song, { profile = 'Meu perfil', history = [], achievements = null } = {}) {
  const ctx = context(song, profile);
  const sameScope = achievements?.contentKey === ctx.contentKey && achievements?.songId === ctx.songId && achievements?.profile === ctx.profile;
  const summary = sameScope ? achievements : summarizeAchievements(song, history, { profile: ctx.profile });
  const maximum = finite(summary.maxPoints) && summary.maxPoints > 0 ? summary.maxPoints : 0;
  const total = finite(summary.totalPoints) ? clamp(summary.totalPoints, 0, maximum) : 0;
  const value = maximum ? Math.round(total / maximum * 100) : null;
  const detail = maximum ? `${total} de ${maximum} pontos nos percursos de Melodia, Ritmo e Recital, separados por mão. O progresso guarda sua melhor precisão e as notas já praticadas; a avaliação técnica recente é apresentada separadamente.` : 'Não há notas elegíveis neste arranjo para calcular progresso de estudo.';
  return { value, label: 'Progresso de estudo', detail, description: detail,
    stage: value === null ? 'Sem notas para praticar' : value === 0 ? 'A começar' : summary.completedPaths === summary.tracks?.filter(track => track.eligible).length && summary.completedPaths > 0 ? 'Percursos concluídos' : value >= 70 ? 'Em consolidação' : 'Em estudo',
    points: total, maxPoints: maximum };
}

export function buildLearningJourney(song, { profile = 'Meu perfil', history = [], achievements = null, state = null } = {}) {
  const ctx = context(song, profile), structure = structureFor(ctx), normalized = normalizeState(state, ctx, structure);
  const existingCursor = validState(state, ctx) && state.task && (state.started === true || state.startedAt || state.lastAttemptId || finite(state.position) || list(state.passed).length);
  if (!existingCursor) normalized.task = recordedDifficulty(ctx, structure, history) ?? normalized.task;
  const progress = learningProgress(song, { profile: ctx.profile, history, achievements });
  const task = normalized.task ? { ...normalized.task, streak: normalized.streak } : null;
  const historyMatch = list(history).some(row => row?.songId === ctx.songId && row.profile === ctx.profile && row.songContentKey === ctx.contentKey && row.journeyTaskId === task?.id);
  const resumable = Boolean(validState(state, ctx) && state.task && task?.id === state.task.id && (normalized.started || historyMatch));
  return { version: VERSION, songId: ctx.songId, profile: ctx.profile, contentKey: ctx.contentKey, progress, task, state: normalized,
    streak: normalized.streak, requiredStreak: STREAK, resumable, suggestedStructure: structure.reviewed !== true,
    structure: { phraseCount: list(structure.phrases).length, patternCount: list(structure.patterns).length, recurringPatterns: list(structure.patterns).filter(pattern => list(pattern.occurrences).length > 1).length },
    nextActionLabel: task ? `${resumable ? 'Continuar' : 'Começar'} · ${MODE_LABELS[task.mode]} a ${Math.round(task.speed * 100)}%` : 'Escolha uma música com notas' };
}

function nextTaskFor(ctx, structure, task, preferredSpeed) {
  const units = unitsFor(ctx, structure), available = handsIn(ctx, task);
  const nextSpeed = mode => mode === 'recital' ? 1 : preferredSpeed ?? defaultSpeed(mode);
  if (preferredSpeed === undefined && task.mode !== 'recital' && task.speed < 1 - EPS) return { task: taskFrom(ctx, structure, { ...task, title: undefined, instruction: undefined, reason: undefined, speed: Math.min(1, rounded(task.speed + .1)) }), action: `Praticar a ${Math.round(Math.min(1, rounded(task.speed + .1)) * 100)}%`, finished: false };
  if (task.mode === 'melody') {
    const nextHand = available[available.indexOf(task.hands) + 1];
    if (nextHand) return { task: taskFrom(ctx, structure, { ...task, title: undefined, instruction: undefined, reason: undefined, hands: nextHand, speed: nextSpeed(task.mode) }), action: `Praticar com ${HAND_LABELS[nextHand]}`, finished: false };
  }
  let index = units.findIndex(unit => unit.id === task.phraseId && unit.start <= task.start + EPS && unit.end >= task.end - EPS);
  if (index < 0) index = units.findIndex(unit => unit.start <= task.start + EPS && unit.end >= task.end - EPS);
  const next = index >= 0 ? units[index + 1] : units.find(unit => unit.start >= task.end - EPS);
  if (next) {
    const hands = task.mode === 'melody' ? handsIn(ctx, next)[0] : handsIn(ctx, next).at(-1);
    const nextTask = taskFrom(ctx, structure, { ...next, phraseId: next.id, mode: task.mode, hands, speed: nextSpeed(task.mode) });
    return { task: nextTask, action: nextTask?.patternId === task.patternId ? 'Praticar a reaparição do padrão' : 'Praticar o próximo trecho', finished: false };
  }
  const nextMode = MODES[MODES.indexOf(task.mode) + 1], first = units[0];
  if (nextMode && first) return { task: taskFrom(ctx, structure, { ...first, phraseId: first.id, mode: nextMode, hands: handsIn(ctx, first).at(-1), speed: nextSpeed(nextMode) }), action: nextMode === 'rhythm' ? `Experimentar o Ritmo a ${Math.round(nextSpeed(nextMode)*100)}%` : 'Experimentar o Recital', finished: false };
  return { task: taskFrom(ctx, structure, { ...task, title: 'Revisar a música em diferentes pontos', instruction: 'Comece diretamente neste trecho, sem tocar os anteriores. Depois escolha outra frase para verificar sua memória e seu ritmo.', reason: 'O ciclo sugerido foi percorrido. Isso não substitui as avaliações de cada percurso e mão.' }), action: 'Revisar este ponto de partida', finished: true };
}

function validation(ctx, task, attempt) {
  const fail = reason => ({ qualified: false, reason });
  if (!task || !attempt || typeof attempt !== 'object') return fail('Não há uma missão válida para avaliar.');
  if (attempt.songId !== ctx.songId || attempt.profile !== ctx.profile || (attempt.songContentKey ?? attempt.contentKey) !== ctx.contentKey) return fail('A prática pertence a outro arranjo, música ou perfil.');
  if (attempt.journeyTaskId && attempt.journeyTaskId !== task.id) return fail('Esta tentativa pertence a outra missão.');
  if (attempt.completed !== true || attempt.scopeComplete !== true) return fail('Conclua todas as notas do trecho para avaliar esta missão.');
  if (attempt.transpose !== 0 || attempt.mode !== task.mode || attempt.hands !== task.hands || !finite(attempt.speed) || Math.abs(attempt.speed - task.speed) > EPS) return fail('A missão exige o mesmo modo, mãos, andamento e nenhuma transposição.');
  const start = attempt.start ?? attempt.phraseStart, end = attempt.end ?? attempt.phraseEnd;
  if (!finite(start) || !finite(end) || Math.abs(start - task.start) > EPS || Math.abs(end - task.end) > EPS) return fail('Esta prática não cobre exatamente o trecho da missão.');
  const expected = notesIn(ctx, task).length;
  if (!expected || ![attempt.hits, attempt.missed, attempt.errors].every(value => Number.isInteger(value) && value >= 0 && value <= 1e8) || attempt.hits + attempt.missed !== expected || finite(attempt.expectedNotes) && attempt.expectedNotes !== expected) return fail('A contagem de notas não cobre o trecho inteiro.');
  if (!finite(attempt.seconds) || attempt.seconds < Math.max(.05, (task.end - task.start) / task.speed * .5)) return fail('A duração registrada é insuficiente para avaliar a missão.');
  const id = text(attempt.attemptId, text(attempt.id), 180);
  if (!id) return fail('Esta tentativa não tem uma identificação válida.');
  const accuracy = 100 * attempt.hits / (attempt.hits + attempt.missed + attempt.errors);
  return { qualified: true, reason: accuracy >= TARGET ? 'Execução concluída dentro da meta.' : 'Trecho concluído; repita para alcançar a meta.', id, accuracy };
}

/** Only complete, comparable performances change a mission's consecutive streak.
 * The next task is a suggestion: the caller starts it only after user action. */
export function evaluateJourneyAttempt(song, input, attempt, { profile = 'Meu perfil', preferredSpeed } = {}) {
  if (!finite(preferredSpeed) || preferredSpeed < .2 || preferredSpeed > 1.5) preferredSpeed = undefined;
  const ctx = context(song, profile), structure = structureFor(ctx), state = normalizeState(input, ctx, structure), task = state.task;
  const sourceMatches = validState(input, ctx) && input.task?.id === task?.id;
  const outcome = sourceMatches ? validation(ctx, task, attempt) : { qualified: false, reason: 'O estado da missão mudou. Escolha o desafio atual antes de avaliar outra tentativa.' };
  const result = { state, task, nextTask: task, goalMet: false, streak: state.streak, requiredStreak: STREAK,
    actionLabel: 'Repetir a missão', summary: '', changed: false, qualified: false, reason: outcome.reason };
  if (!outcome.qualified) return { ...result, summary: outcome.reason };
  if (state.seenAttemptIds.includes(outcome.id)) return { ...result, reason: 'Esta tentativa já foi considerada.', summary: 'Seu progresso foi mantido; esta tentativa já foi considerada.', duplicate: true };
  state.seenAttemptIds = [...state.seenAttemptIds, outcome.id].slice(-256);
  state.lastAttemptId = outcome.id; state.lastAccuracy = rounded(outcome.accuracy);
  state.updatedAt = Number.isFinite(Date.parse(attempt.date)) ? new Date(attempt.date).toISOString() : state.updatedAt;
  state.started = true; state.startedAt ||= state.updatedAt;
  delete state.position;
  const streak = outcome.accuracy + EPS >= TARGET ? state.streak + 1 : 0;
  state.streak = streak; state.lastOutcome = streak ? 'success' : 'retry'; state.completed = false;
  if (state.task) state.task.streak = streak;
  Object.assign(result, { streak, qualified: true, changed: true, reason: outcome.reason,
    summary: streak ? `${streak} de ${STREAK} execuções consecutivas com pelo menos ${TARGET}% de precisão.` : `Precisão de ${Math.round(outcome.accuracy)}%. A sequência recomeça; a meta continua sendo ${STREAK} execuções consecutivas com pelo menos ${TARGET}%.` });
  if (streak >= STREAK) {
    const next = nextTaskFor(ctx, structure, task, preferredSpeed);
    state.passed = [...new Set([...state.passed, task.id])].slice(-4096);
    state.task = next.task; state.streak = 0; state.completed = next.finished; state.lastOutcome = 'goal';
    if (state.task) state.task.streak = 0;
    Object.assign(result, { goalMet: true, nextTask: next.task, actionLabel: next.action,
      summary: next.finished ? 'Ciclo de estudo percorrido. Continue revisando os pontos de partida e os percursos de cada mão.' : `Meta atingida: ${STREAK} execuções consecutivas com pelo menos ${TARGET}% de precisão. O próximo desafio está pronto.` });
  } else if (outcome.accuracy < 70) {
    const mode = task.mode === 'recital' ? 'rhythm' : task.mode;
    const speed = preferredSpeed ?? (task.mode === 'recital' ? .9 : Math.min(task.speed, Math.max(mode === 'melody' ? .4 : .6, rounded(task.speed - .1))));
    const nextTask = taskFrom(ctx, structure, { ...task, mode, speed, title: undefined, instruction: undefined,
      reason: preferredSpeed === undefined ? 'A última execução teve menos de 70% de precisão. Reduza o andamento para preparar notas, acordes e durações antes de tentar de novo.' : 'Revise notas, acordes e durações. Sua velocidade escolhida foi mantida; você pode ajustá-la na barra acima.' });
    state.lastOutcome = 'review';
    Object.assign(result, { nextTask, actionLabel: preferredSpeed !== undefined ? `Revisar a ${Math.round(speed * 100)}%` : task.mode === 'recital' ? 'Revisar no Ritmo a 90%' : speed < task.speed ? `Revisar a ${Math.round(speed * 100)}%` : 'Repetir devagar',
      summary: preferredSpeed !== undefined ? `${Math.round(outcome.accuracy)}% de precisão. Revise este trecho; sua velocidade escolhida foi mantida.` : `${Math.round(outcome.accuracy)}% de precisão. A sugestão é revisar com calma; a velocidade só muda quando você escolher o próximo desafio.` });
  }
  return result;
}
