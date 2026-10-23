import { handOf } from './practice.js';

/** Lifetime achievement evidence. This is separate from the recent mastery score. */
const MODES = ['melody', 'rhythm', 'recital'];
const HANDS = ['left', 'right', 'both'];
const MODE_LABELS = { melody: 'Melodia guiada', rhythm: 'Ritmo', recital: 'Recital' };
const HAND_LABELS = { left: 'Mão esquerda', right: 'Mão direita', both: 'Ambas as mãos' };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = (value, length = 200) => typeof value === 'string' ? value.trim().slice(0, length) : '';
const list = value => Array.isArray(value) ? value : [];
const MAX_NOTES = 200000;
const VERSION = 1;
const bestQuality = evidence => evidence.reduce((best, span) => Math.max(best, span.quality), 0) / 100;

function context(song, profile) {
  const duration = finite(song?.duration) ? Math.max(0, song.duration) : 0;
  const notes = list(song?.notes).filter(note => note && finite(note.time) && note.time >= 0 && note.time < duration && Number.isInteger(note.midi) && note.midi >= 0 && note.midi <= 127)
    .map(note => ({ ...note, assignedHand: handOf(note, song.configs || {}) }))
    .sort((a, b) => a.time - b.time || a.midi - b.midi || Number(a.track || 0) - Number(b.track || 0)
      || Number(a.keyDuration ?? a.duration ?? 0) - Number(b.keyDuration ?? b.duration ?? 0) || a.assignedHand.localeCompare(b.assignedHand));
  // Two independent 32-bit streams keep the key deterministic in browser and Node.
  let first = 2166136261, second = 3339675911;
  const feed = value => { for (const char of String(value)) { const code = char.charCodeAt(0); first = Math.imul(first ^ code, 16777619); second = Math.imul(second ^ code, 2246822519); } };
  const round = value => Math.round((Number(value) || 0) * 100000);
  feed(`achievement-v1|${round(duration)}|${notes.length}|`);
  for (const note of notes) feed(`${round(note.time)},${round(note.keyDuration ?? note.duration)},${note.midi},${Number(note.track) || 0},${note.assignedHand};`);
  const contentKey = `achievement-v1-${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
  return { song: song || {}, songId: text(song?.id), profile: text(profile, 40) || 'Meu perfil', duration, contentKey,
    supported: notes.length <= MAX_NOTES,
    notes: { both: notes, left: notes.filter(note => note.assignedHand === 'left'), right: notes.filter(note => note.assignedHand === 'right') } };
}

export function achievementContentKey(song) { return context(song, 'Meu perfil').contentKey; }

function emptyLedger(ctx) {
  return { version: VERSION, songId: ctx.songId, profile: ctx.profile, contentKey: ctx.contentKey,
    paths: MODES.flatMap(mode => HANDS.map(hands => ({ id: `${mode}:${hands}`, evidence: [], bestAccuracy: null }))) };
}

/** Merge overlapping ordinal intervals using their maximum precision. */
function mergeEvidence(input, limit) {
  const events = [];
  for (const span of input) {
    if (!span || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > limit || !Number.isInteger(span.quality) || span.quality < 0 || span.quality > 10000) continue;
    events.push({ index: span.start, quality: span.quality, delta: 1 }, { index: span.end, quality: span.quality, delta: -1 });
  }
  events.sort((a, b) => a.index - b.index);
  const active = new Map(), heap = [], result = []; let at = 0, highest = -1;
  const push = quality => { let index = heap.length; heap.push(quality); while (index > 0) { const parent = (index - 1) >>> 1; if (heap[parent] >= quality) break; heap[index] = heap[parent]; index = parent; } heap[index] = quality; };
  const pop = () => {
    const last = heap.pop(); if (!heap.length) return;
    let index = 0;
    while (index * 2 + 1 < heap.length) {
      let child = index * 2 + 1; if (child + 1 < heap.length && heap[child + 1] > heap[child]) child++;
      if (heap[child] <= last) break;
      heap[index] = heap[child]; index = child;
    }
    heap[index] = last;
  };
  for (let i = 0; i < events.length;) {
    const next = events[i].index;
    if (highest >= 0 && next > at) {
      const last = result.at(-1);
      if (last && last.end === at && last.quality === highest) last.end = next;
      else result.push({ start: at, end: next, quality: highest });
    }
    while (i < events.length && events[i].index === next) {
      const event = events[i++], previous = active.get(event.quality) || 0, amount = previous + event.delta;
      if (amount > 0) { active.set(event.quality, amount); if (!previous) push(event.quality); } else active.delete(event.quality);
    }
    while (heap.length && !active.has(heap[0])) pop();
    highest = heap[0] ?? -1; at = next;
  }
  return result;
}

function normalizeLedger(input, ctx) {
  const clean = emptyLedger(ctx);
  if (!input || input.version !== VERSION || input.songId !== ctx.songId || input.profile !== ctx.profile || input.contentKey !== ctx.contentKey || !ctx.supported) return clean;
  for (const path of clean.paths) {
    const raw = list(input.paths).find(item => item?.id === path.id);
    if (!raw) continue;
    const hands = path.id.split(':')[1], limit = ctx.notes[hands].length;
    // A canonical ledger has at most one segment per note. Larger input is invalid.
    const evidence = list(raw.evidence);
    if (evidence.length > limit) continue;
    path.evidence = mergeEvidence(evidence, limit);
    path.bestAccuracy = path.evidence.length ? bestQuality(path.evidence) : null;
  }
  return clean;
}

export function normalizeAchievementLedger(input, song, { profile = 'Meu perfil' } = {}) {
  return normalizeLedger(input, context(song, profile));
}

/** Backup restoration keeps the greatest evidence, rather than adding points. */
export function mergeAchievementLedgers(song, ledgers, { profile = 'Meu perfil' } = {}) {
  const ctx = context(song, profile), merged = emptyLedger(ctx);
  for (const input of list(ledgers)) {
    const clean = normalizeLedger(input, ctx);
    for (const path of merged.paths) {
      const incoming = clean.paths.find(item => item.id === path.id);
      if (!incoming.evidence.length) continue;
      path.evidence = mergeEvidence([...path.evidence, ...incoming.evidence], ctx.notes[path.id.split(':')[1]].length);
      path.bestAccuracy = bestQuality(path.evidence);
    }
  }
  return merged;
}

function milestonesFor(track) {
  if (!track.evaluated) return [];
  const result = [], add = (suffix, title, description) => result.push({ id: `${track.id}:${suffix}`, trackId: track.id, mode: track.mode, hands: track.hands, title, description });
  if (track.coverage >= .5) add('coverage-half', 'Metade do percurso explorada', 'Você concluiu trechos que cobrem pelo menos metade das notas deste percurso.');
  if (track.coverage >= 1 - 1e-10) add('coverage-full', 'Percurso inteiro praticado', 'Todas as notas deste percurso têm uma prática concluída registrada.');
  if (track.score >= 50) add('score-50', '50 pontos no percurso', 'Sua melhor precisão nos trechos estudados somou 50 de 100 pontos.');
  if (track.score >= 80) add('score-80', '80 pontos no percurso', 'Seu percurso chegou a 80 de 100 pontos. Continue refinando as passagens.');
  if (track.score >= 95) add('score-95', '95 pontos no percurso', 'Seu percurso chegou a 95 de 100 pontos.');
  if (track.completed) add('complete', track.mode === 'melody' ? 'Percurso guiado concluído' : 'Meta do percurso concluída', 'Todas as notas foram praticadas e a pontuação chegou a pelo menos 90 de 100.');
  return result;
}

function summarizeLedger(ledger, ctx) {
  const tracks = ledger.paths.map(path => {
    const [mode, hands] = path.id.split(':'), noteCount = ctx.notes[hands].length;
    const coveredNotes = path.evidence.reduce((sum, span) => sum + span.end - span.start, 0);
    const evidence = path.evidence.reduce((sum, span) => sum + (span.end - span.start) * span.quality, 0);
    const evaluated = coveredNotes > 0, score = evaluated && noteCount ? Math.round(evidence / noteCount / 100) : null;
    const coverage = noteCount ? coveredNotes / noteCount : 0;
    const completed = coverage >= 1 - 1e-10 && score >= 90;
    const label = !ctx.supported ? 'Arranjo muito extenso' : !noteCount ? 'Sem notas desta mão' : !evaluated ? 'A começar' : completed ? (mode === 'melody' ? 'Guiado concluído' : 'Meta concluída') : score >= 80 ? 'Em consolidação' : 'Em estudo';
    const description = mode === 'melody' ? 'Prática guiada, com espera pelas notas. Os pontos mostram sua melhor precisão e a cobertura; não avaliam a execução no tempo.'
      : mode === 'rhythm' ? 'Trechos concluídos a partir de 90% do andamento, sem transposição, com todas as notas da mão escolhida.'
        : 'Trechos concluídos a 100% do andamento, sem transposição, com todas as notas da mão escolhida.';
    const track = { id: path.id, mode, hands, title: `${MODE_LABELS[mode]} · ${HAND_LABELS[hands]}`, modeLabel: MODE_LABELS[mode], handsLabel: HAND_LABELS[hands],
      score, points: score, maxPoints: 100, coverage, coveredNotes, noteCount, bestAccuracy: path.bestAccuracy,
      completed, evaluated, eligible: ctx.supported && noteCount > 0, label, description };
    track.milestones = milestonesFor(track); return track;
  });
  return { version: VERSION, songId: ctx.songId, profile: ctx.profile, contentKey: ctx.contentKey, tracks, paths: tracks,
    milestones: tracks.flatMap(track => track.milestones), totalPoints: tracks.reduce((sum, track) => sum + (track.score || 0), 0),
    maxPoints: tracks.filter(track => track.eligible).length * 100, evaluatedPaths: tracks.filter(track => track.evaluated).length,
    completedPaths: tracks.filter(track => track.completed).length, ledger,
    explanation: 'Conquistas guardam sua melhor evidência em cada nota e percurso. Repetir o mesmo resultado não soma pontos. O score recente de domínio da música é calculado separadamente.' };
}

function validateAttempt(raw, ctx, { legacy = false } = {}) {
  const fail = reason => ({ qualified: false, reason });
  if (!raw || typeof raw !== 'object' || !ctx.supported) return fail('Não foi possível avaliar este arranjo.');
  if (raw.profile !== ctx.profile || raw.songId !== ctx.songId) return fail('Esta prática pertence a outra música ou perfil.');
  if (!MODES.includes(raw.mode) || !HANDS.includes(raw.hands)) return fail('Escolha um modo de prática e as mãos.');
  const sourceKey = text(raw.songContentKey) || text(raw.contentKey);
  if (sourceKey && sourceKey !== ctx.contentKey) return fail('O arranjo mudou desde esta prática.');
  if (!sourceKey) {
    const matchingAnalysis = raw.analysisKey && [ctx.song.phrasing?.contentKey, ctx.song.phrasing?.revisionKey].includes(raw.analysisKey);
    if (!legacy || raw.fullArrangement !== true || !matchingAnalysis) return fail('Esta prática antiga não informa a versão do arranjo.');
  }
  if (raw.completed !== true) return fail('Conclua o trecho para registrar pontos neste percurso.');
  if (raw.scopeComplete !== true && !(legacy && raw.scopeComplete !== false && raw.fullArrangement === true)) return fail('Inclua todas as notas da mão escolhida para pontuar neste percurso.');
  if (raw.transpose !== 0) return fail('Pratique sem transposição para pontuar neste percurso.');
  if (!finite(raw.speed) || raw.speed <= 0 || raw.speed > 4) return fail('O andamento desta prática não foi registrado.');
  if (raw.mode === 'rhythm' && raw.speed < .9 - 1e-8) return fail('No Ritmo, alcance pelo menos 90% do andamento para pontuar.');
  if (raw.mode === 'recital' && Math.abs(raw.speed - 1) > 1e-8) return fail('No Recital, use 100% do andamento para pontuar.');
  const start = raw.start ?? raw.phraseStart ?? 0, end = raw.end ?? raw.phraseEnd ?? (raw.completed && !raw.phraseId ? ctx.duration : null);
  if (!finite(start) || !finite(end) || start < 0 || end <= start || end > ctx.duration + 1e-5) return fail('O intervalo desta prática não é válido.');
  const notes = ctx.notes[raw.hands], first = lowerBound(notes, start), last = lowerBound(notes, Math.min(end, ctx.duration));
  if (last <= first) return fail('Este trecho não contém notas da mão escolhida.');
  if (![raw.hits, raw.missed, raw.errors].every(value => Number.isInteger(value) && value >= 0 && value <= 1e8) || raw.hits <= 0) return fail('Não há notas acertadas para avaliar este percurso.');
  if (raw.hits + raw.missed !== last - first || finite(raw.expectedNotes) && raw.expectedNotes !== last - first) return fail('A contagem não cobre todas as notas deste trecho.');
  if (!finite(raw.seconds) || raw.seconds < Math.max(.05, (end - start) / raw.speed * .5)) return fail('A duração registrada é insuficiente para avaliar o trecho.');
  const quality = Math.round(10000 * raw.hits / (raw.hits + raw.missed + raw.errors));
  return { qualified: true, reason: raw.mode === 'melody' ? 'Evolução na prática guiada; o ritmo é avaliado em outro percurso.' : 'Resultado registrado neste percurso.',
    trackId: `${raw.mode}:${raw.hands}`, first, last, quality };
}

function lowerBound(notes, time) { let low = 0, high = notes.length; while (low < high) { const middle = (low + high) >>> 1; if (notes[middle].time < time) low = middle + 1; else high = middle; } return low; }

function applyAttempt(ledger, validation, ctx) {
  if (!validation.qualified) return false;
  const path = ledger.paths.find(item => item.id === validation.trackId);
  const merged = mergeEvidence([...path.evidence, { start: validation.first, end: validation.last, quality: validation.quality }], ctx.notes[validation.trackId.split(':')[1]].length);
  const changed = JSON.stringify(merged) !== JSON.stringify(path.evidence);
  path.evidence = merged;
  path.bestAccuracy = path.evidence.length ? bestQuality(path.evidence) : null;
  return changed;
}

/** History can seed old achievements, but never itself produces a notification. */
export function summarizeAchievements(song, history = [], { profile = 'Meu perfil', ledger = null } = {}) {
  const ctx = context(song, profile), clean = normalizeLedger(ledger, ctx);
  for (const raw of list(history)) applyAttempt(clean, validateAttempt(raw, ctx, { legacy: true }), ctx);
  return summarizeLedger(clean, ctx);
}

export function compareAchievements(before, after, attempt = {}) {
  const id = `${attempt.mode}:${attempt.hands}`, previous = before?.tracks?.find(track => track.id === id), track = after?.tracks?.find(item => item.id === id);
  const sameScope = before?.contentKey === after?.contentKey && before?.songId === after?.songId && before?.profile === after?.profile;
  const known = new Set(list(before?.milestones).map(item => item.id));
  return { points: sameScope && track ? Math.max(0, (track.score || 0) - (previous?.score || 0)) : 0,
    previousScore: previous?.score ?? null, score: track?.score ?? null, track,
    coverageGain: sameScope && track ? Math.max(0, track.coverage - (previous?.coverage || 0)) : 0,
    newMilestones: sameScope ? list(after?.milestones).filter(item => !known.has(item.id)) : [], qualified: false, reason: '' };
}

export function evaluateAchievementAttempt(song, ledger, attempt, { profile = 'Meu perfil' } = {}) {
  const ctx = context(song, profile), clean = normalizeLedger(ledger, ctx), before = summarizeLedger(clean, ctx);
  const validation = validateAttempt(attempt, ctx), changed = applyAttempt(clean, validation, ctx), summary = summarizeLedger(clean, ctx);
  const gains = compareAchievements(before, summary, attempt);
  gains.qualified = validation.qualified; gains.reason = validation.reason;
  if (validation.qualified && !gains.points && !gains.newMilestones.length) gains.reason = 'Prática concluída. Seu melhor resultado neste trecho foi mantido.';
  return { ledger: clean, summary, gains, changed };
}
