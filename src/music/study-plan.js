/** Local study suggestions grounded in the analysed music and recorded attempts. */
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const clean = (value, fallback = '', length = 180) => typeof value === 'string' && value.trim() ? value.trim().slice(0, length) : fallback;
const uniq = values => [...new Set(values)];
const list = value => Array.isArray(value) ? value : [];
const LIMIT = 512;

function hash(value) {
  let code = 2166136261;
  for (let i = 0; i < value.length; i++) { code ^= value.charCodeAt(i); code = Math.imul(code, 16777619); }
  return (code >>> 0).toString(36);
}

function analysisIdentity(song, analysis) {
  if (clean(analysis?.revisionKey)) return clean(analysis.revisionKey);
  if (clean(analysis?.contentKey)) return clean(analysis.contentKey);
  // Old/manual projects do not have an analysis key. Bind their checklist to
  // actual note content and boundaries, rather than the editable song title.
  return `local-${hash(JSON.stringify([list(song.notes).filter(Boolean).map(n => [n.time, n.keyDuration ?? n.duration, n.midi, n.track, n.channel]), list(analysis?.phrases).filter(Boolean).map(p => [p.start, p.end])]))}`;
}

/** Self-reported task completion is deliberately separate from performance. */
export function normalizeStudyProgress(input, context = {}) {
  const analysisKey = clean(context.analysisKey, clean(input?.analysisKey));
  const songId = clean(context.songId, clean(input?.songId));
  const profile = clean(context.profile, clean(input?.profile, 'Meu perfil', 40), 40);
  const empty = { version: 1, analysisKey, songId, profile, completedSessions: [], completedExercises: [],finishedExercises:[] };
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.version !== 1 || input.analysisKey !== analysisKey || input.songId !== songId || input.profile !== profile) return empty;
  const ids = (values, allowed) => Array.isArray(values) ? uniq(values.filter(v => typeof v === 'string' && v.length > 0 && v.length <= 180 && (!allowed || allowed.has(v)))).slice(0, 4096) : [];
  empty.completedSessions = ids(input.completedSessions, context.validSessionIds ? new Set(context.validSessionIds) : null);
  empty.completedExercises = ids(input.completedExercises, context.validExerciseIds ? new Set(context.validExerciseIds) : null);
  empty.finishedExercises = ids(input.finishedExercises,context.validExerciseIds?new Set(context.validExerciseIds):null);
  return empty;
}

function preparePhrases(song, analysis) {
  const duration = finite(song.duration) && song.duration > 0 ? song.duration : 0;
  return list(analysis?.phrases).slice(0, LIMIT).filter(p => p && finite(p.start) && finite(p.end) && p.start >= 0 && p.end > p.start && p.start < duration)
    .map((p, index) => ({ ...p, id: clean(p.id, `phrase-${hash(`${p.start}:${p.end}`)}`), name: clean(p.name, `Frase ${index + 1}`), patternId: clean(p.patternId ?? p.familyId, `pattern-${hash(`${p.start}:${p.end}`)}`), start: p.start, end: Math.min(duration, p.end), variant: p.variant ?? p.relation ?? 'original' }))
    .filter(p => p.end > p.start).sort((a, b) => a.start - b.start);
}

function preparePatterns(phrases, analysis) {
  const families = new Map();
  for (const phrase of phrases) {
    let family = families.get(phrase.patternId);
    if (!family) {
      const metadata = list(analysis?.patterns).find(p => p && p.id === phrase.patternId) ?? {};
      family = { id: phrase.patternId, label: clean(metadata.label ?? phrase.patternLabel, `Padrão ${families.size + 1}`), description: clean(metadata.description), phrases: [], representativeId: metadata.representativePhraseId ?? metadata.representativeId };
      families.set(phrase.patternId, family);
    }
    family.phrases.push(phrase);
  }
  for (const family of families.values()) family.representative = family.phrases.find(p => p.id === family.representativeId) ?? family.phrases.find(p => p.variant === 'original') ?? family.phrases[0];
  return [...families.values()];
}

function rowRange(row) {
  const start = row.phraseStart ?? row.start;
  const end = row.phraseEnd ?? row.end;
  return finite(start) && finite(end) && start >= 0 && end > start ? { start, end } : null;
}

function scopedHistory(history, song, analysisKey, profile) {
  const seen = new Set();
  return (Array.isArray(history) ? history : []).filter(row => {
    if (!row || row.profile !== profile || row.songId !== song.id || row.analysisKey && row.analysisKey !== analysisKey) return false;
    if (!['melody', 'rhythm', 'recital'].includes(row.mode) || !finite(row.accuracy) || row.accuracy < 0 || row.accuracy > 100 || !finite(row.seconds) || row.seconds <= 0) return false;
    if (!clean(row.id) || seen.has(row.id) || !finite(row.hits) || row.hits <= 0 || !Number.isFinite(Date.parse(row.date))) return false;
    seen.add(row.id);
    return true;
  });
}

function phraseEvidence(phrase, rows, analysisKey) {
  const attempts = rows.filter(row => {
    const range = rowRange(row);
    // A whole-song score, a partial loop and an exercise on a transition do
    // not establish performance on an individual phrase.
    return range && Math.abs(range.start - phrase.start) <= .05 && Math.abs(range.end - phrase.end) <= .05 && (!row.phraseId || row.phraseId === phrase.id);
  });
  // Historical successes do not permanently conceal more recent trouble.
  const recent = [...attempts].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 5);
  const qualified = recent.filter(row => {
    const speed = row.speed;
    return row.analysisKey === analysisKey && row.completed === true && row.fullArrangement === true && row.transpose === 0 && ['rhythm', 'recital'].includes(row.mode) && row.hands === 'both' && finite(speed) && speed >= .9 && speed <= 2 && row.accuracy >= 90 && row.seconds >= (phrase.end - phrase.start) / speed * .6 && (!finite(row.expectedNotes) || row.expectedNotes > 0 && row.hits >= Math.ceil(row.expectedNotes * .8));
  });
  return { phraseId: phrase.id, attempts: attempts.length, recentAttempts: recent.length, qualifiedAttempts: qualified.length, bestAccuracy: attempts.length ? Math.max(...attempts.map(r => r.accuracy)) : null, status: qualified.length >= 3 ? 'consolidando' : attempts.length ? 'em estudo' : 'não avaliado' };
}

function summarizeEvidence(family, evidence) {
  const occurrences = family.phrases.map(p => evidence.get(p.id));
  const attempts = occurrences.reduce((total, p) => total + p.attempts, 0);
  const qualifiedAttempts = occurrences.reduce((total, p) => total + p.qualifiedAttempts, 0);
  const baseline = family.phrases.filter(p => ['original', 'unique', 'exact', 'repeat'].includes(p.variant));
  const baseQualifiedAttempts = (baseline.length ? baseline : [family.representative]).reduce((total, p) => total + evidence.get(p.id).qualifiedAttempts, 0);
  const variations = family.phrases.filter(p => ['variation', 'transposed'].includes(p.variant));
  const remainingVariations = variations.filter(p => evidence.get(p.id).qualifiedAttempts < 3);
  const status = baseQualifiedAttempts >= 3 && !remainingVariations.length ? 'consolidando' : attempts ? 'em estudo' : 'não avaliado';
  const explanation = !attempts ? 'Ainda não há tentativas registradas neste perfil e neste trecho.' : `${attempts} tentativa(s); ${qualifiedAttempts} completa(s) entre as cinco mais recentes de cada trecho, em ritmo/recital, arranjo completo sem transposição, ambas as mãos, pelo menos 90% do andamento e 90% de precisão. ${baseQualifiedAttempts >= 3 ? remainingVariations.length ? `${remainingVariations.length} variação(ões) ainda precisa(m) de avaliação própria.` : 'Há evidência inicial de consistência; continue verificando em diferentes pontos.' : 'Três tentativas nessas condições são a referência inicial de consistência.'}`;
  return { patternId: family.id, label: family.label, status, attempts, qualifiedAttempts, baseQualifiedAttempts, occurrences, explanation };
}

function melodyNotes(song, analysis, phrase) {
  const tracks = analysis?.melodyTracks;
  const notes = list(song.notes).filter(n => n && finite(n.time) && finite(n.midi) && n.channel !== 9 && n.time >= phrase.start - 1e-6 && n.time < phrase.end - 1e-6 && (!Array.isArray(tracks) || !tracks.length || tracks.includes(n.track))).sort((a, b) => a.time - b.time || b.midi - a.midi);
  const voice = [];
  for (const note of notes) { if (!voice.length || Math.abs(note.time - voice.at(-1).time) > .012) voice.push(note); }
  return voice;
}

function describePhrase(song, analysis, phrase) {
  const voice = melodyNotes(song, analysis, phrase);
  let rising = 0, falling = 0, repeats = 0, leaps = 0;
  for (let i = 1; i < voice.length; i++) { const delta = voice[i].midi - voice[i - 1].midi; if (delta > 0) rising++; else if (delta < 0) falling++; else repeats++; if (Math.abs(delta) > 2) leaps++; }
  return voice.length ? `${voice.length} ataques na voz melódica analisada; ${rising} movimento(s) para cima, ${falling} para baixo, ${repeats} repetição(ões) e ${leaps} salto(s) maior(es) que um tom.` : 'Observe o desenho melódico e os intervalos na partitura; a seleção atual não contém ataques de melodia.';
}

/** A repeatable order of real phrase starts; never invents off-phrase seconds. */
export function startingPointChallenge(phrases, seed = 'study') {
  const valid = (Array.isArray(phrases) ? phrases : []).filter(p => p && finite(p.start) && finite(p.end) && p.start >= 0 && p.end > p.start);
  return valid.map(p => ({ start: p.start, end: p.end, phraseId: p.id, patternId: p.patternId, rank: hash(`${seed}:${p.id}:${p.start}`) }))
    .sort((a, b) => a.rank.localeCompare(b.rank) || a.start - b.start).map(({ rank, ...point }) => point);
}

/**
 * Produces suggestions, not a calendar or an assertion of mastery. Musical
 * similarity is inherited from analysis, while measured progress needs real
 * complete, timed attempts with a recorded tempo on the current content.
 */
export function buildStudyPlan(song, analysis, { history = [], profile = 'Meu perfil', progress, sessionMinutes = 20, targetPatternId } = {}) {
  song = song && typeof song === 'object' ? song : {};
  profile = clean(profile, 'Meu perfil', 40);
  const analysisKey = analysisIdentity(song, analysis), songId = clean(song.id);
  const normalizedProgress = normalizeStudyProgress(progress, { analysisKey, songId, profile });
  const minutes = clamp(finite(sessionMinutes) ? Math.round(sessionMinutes) : 20, 5, 90);
  const phrases = preparePhrases(song, analysis), families = preparePatterns(phrases, analysis);
  const rows = scopedHistory(history, song, analysisKey, profile);
  const evidence = new Map(phrases.map(p => [p.id, phraseEvidence(p, rows, analysisKey)]));
  const patternsProgress = families.map(f => summarizeEvidence(f, evidence));
  const base = { version: 1, analysisKey, songId, profile, sessionMinutes: minutes, progress: normalizedProgress, patternsProgress, sessions: [], exercises: [], summary: '', objective: null, warnings: ['Sugestões de estudo: os padrões são hipóteses da análise musical e podem ser revisados.', 'Marcar uma atividade como feita registra seu relato; isso não comprova domínio musical.'] };
  if (!families.length) return { ...base, summary: 'Analise ou revise as frases da música para gerar exercícios nos trechos reais.' };

  // First learn a recurring basis; once it has evidence, compare its still
  // unverified variations before investing in another full sequence.
  const priorities = families.map(family => {
    const measured = patternsProgress.find(p => p.patternId === family.id);
    const variation = measured.baseQualifiedAttempts >= 3 ? family.phrases.find(p => ['variation', 'transposed'].includes(p.variant) && evidence.get(p.id).qualifiedAttempts < 3) : null;
    const priority = variation ? 100 : measured.baseQualifiedAttempts < 3 ? 50 + Math.min(20, family.phrases.length) : 0;
    return { family, measured, variation, priority };
  }).sort((a, b) => b.priority - a.priority || a.family.representative.start - b.family.representative.start);
  const recommendedPatternId = priorities[0].family.id;
  const { family, measured, variation } = priorities.find(item => item.family.id === targetPatternId) ?? priorities[0];
  const target = variation ?? family.representative;
  const reference = family.representative;
  const label = family.label;
  const objective = { title: variation ? `Reconhecer a variação de ${label}` : measured.baseQualifiedAttempts >= 3 ? `Recuperar ${label} em diferentes pontos` : `Aprender a estrutura de ${label}`, description: variation ? `A base já tem ${measured.baseQualifiedAttempts} tentativas completas nas condições de referência. Compare a reaparição com a frase original e pratique a mudança.` : `${label} aparece em ${family.phrases.length} trecho(s). ${measured.explanation}`, patternId: family.id, phraseId: target.id, start: target.start, end: target.end };
  const exercises = [];
  function exercise(type, title, instruction, phrase = target, options = {}) {
    const defaults = { hands: 'both', mode: 'melody', speed: .6, repeatCount: 3 };
    const result = { ...defaults, ...options, type, kind: type, title, instruction, instructions: [instruction], start: phrase.start, end: phrase.end, patternId: phrase.patternId ?? family.id, phraseId: phrase.id };
    result.id = `exercise-${hash(`${analysisKey}|${type}|${phrase.id}|${phrase.start}|${phrase.end}|${result.hands}|${result.mode}|${result.speed}|${result.compareWith?.phraseId ?? ''}`)}`;
    result.completed = normalizedProgress.completedExercises.includes(result.id);
    exercises.push(result);
    return result;
  }

  const listen = exercise('identify', `Ouvir e localizar ${label}`, `Ouça o trecho e localize seu início e fim na partitura. ${describePhrase(song, analysis, target)} Cante ou descreva o desenho antes de tocar.`, target, { mode: 'listen', speed: 1, repeatCount: 2 });
  const contour = exercise('contour', 'Ler o desenho e reconhecer intervalos', `${describePhrase(song, analysis, target)} Antes de tocar, identifique as repetições, os passos de um ou dois semitons e os saltos. Confira cada previsão na partitura.`, target, { mode: 'listen', speed: .7, repeatCount: 2 });
  const right = exercise('separate-hands', 'Mão direita com atenção à melodia', 'Toque devagar com a mão direita. Mantenha o mesmo dedilhado nas reaparições e nomeie onde a melodia sobe, desce ou repete. Se esta pista não contém notas da direita, revise a atribuição das mãos.', target, { hands: 'right', speed: .6 });
  const left = exercise('separate-hands', 'Mão esquerda e apoio rítmico', 'Pratique a mão esquerda isolada. Conte os pulsos e observe as notas que sustentam a melodia. Se não houver notas desta mão no trecho, revise a atribuição das mãos ou pule este exercício.', target, { hands: 'left', speed: .6 });
  const both = exercise('combine-hands', 'Unir as mãos sem perder o desenho', 'Junte as mãos a 60% do andamento. Procure três execuções completas; se um erro se repetir, isole esse ponto antes de tentar o trecho todo outra vez. Aumente o andamento quando conseguir manter o pulso.', target);
  const rhythm = exercise('rhythm', 'Manter o pulso sem a espera por notas', 'Passe ao modo Ritmo a 80% do andamento. Conte o compasso, sustente as durações e observe se os mesmos pontos interrompem a continuidade.', target, { mode: 'rhythm', speed: .8 });

  const comparisonPhrase = variation ?? family.phrases.find(p => p.id !== reference.id && ['variation', 'transposed'].includes(p.variant)) ?? family.phrases.find(p => p.id !== reference.id);
  let compare;
  if (comparisonPhrase) {
    const isVariant = ['variation', 'transposed'].includes(comparisonPhrase.variant);
    const change = clean(comparisonPhrase.comparison?.summary, isVariant ? 'Observe mudanças de notas, ritmo ou registro.' : 'Procure os mesmos intervalos e o mesmo ritmo em outra posição da música.', 500);
    compare = exercise('compare', isVariant ? `${label}: base e variação` : `${label}: reconhecer a reaparição`, `Ouça primeiro a base e depois este trecho. ${change} Toque a reaparição sem reproduzir toda a música desde o começo.`, comparisonPhrase, { mode: 'melody', speed: .7, compareWith: { start: reference.start, end: reference.end, phraseId: reference.id } });
  } else {
    const other = families.find(f => f.id !== family.id)?.representative;
    compare = other ? exercise('contrast', 'Distinguir dois padrões diferentes', `Compare este trecho com ${label}. Identifique o que muda no contorno e no ritmo antes de tocar cada um isoladamente.`, other, { mode: 'melody', speed: .7, compareWith: { start: reference.start, end: reference.end, phraseId: reference.id } }) : exercise('recall', 'Recuperar o mesmo trecho de memória', 'Ouça, faça uma pausa e comece diretamente neste trecho. Confira na partitura depois de tocar e descreva os intervalos que ajudaram a lembrar.', target, { speed: .7 });
  }
  const index = phrases.findIndex(p => p.id === target.id);
  const previous = index > 0 ? phrases[index - 1] : null, following = phrases[index + 1];
  const transitionRange = following ? { ...target, end: following.end } : previous ? { ...previous, end: target.end } : target;
  const transition = exercise('transition', following || previous ? 'Unir frases e preparar a próxima entrada' : 'Manter a continuidade do trecho', 'Toque os trechos ligados. Observe a última posição de uma frase e a primeira da seguinte; mantenha o pulso ao atravessar o limite. Depois inicie diretamente na segunda frase.', transitionRange, { mode: 'rhythm', speed: .7, phraseId: undefined });
  // A transition is a range of two phrases, not evidence of either alone.
  if (following || previous) delete transition.phraseId;
  const distributedPhrases = phrases.length <= 12 ? phrases : Array.from({ length: 12 }, (_, i) => phrases[Math.round(i * (phrases.length - 1) / 11)]);
  const points = startingPointChallenge(distributedPhrases, `${analysisKey}:${profile}`);
  const firstPoint = points[0] ?? target;
  const challenge = exercise('starting-points', 'Desafio: começar de diferentes pontos', 'Comece nos pontos sugeridos, sem tocar os compassos anteriores. Localize as mãos e execute a frase três vezes mantendo o ritmo. Use “Próximo ponto” para variar a ordem de partida.', phrases.find(p => p.id === firstPoint.phraseId) ?? target, { mode: 'rhythm', speed: .8, points });
  const memory = exercise('memory', 'Recuperar a frase com menos apoio visual', 'Localize as mãos, esconda as pistas visuais e tente iniciar o trecho de memória. Ao terminar, reabra a partitura para conferir as notas e os intervalos. O objetivo é reconhecer a estrutura sem depender de uma sequência iniciada no começo.', target, { mode: 'rhythm', speed: .8, hideGuides: true });
  const assessment = exercise('assessment', 'Verificar consistência a 90% do andamento', 'Execute o arranjo completo deste trecho em Ritmo a 90% do andamento, com ambas as mãos e sem transposição. Deixe as pistas do arranjo em Aprender. Registre três tentativas com pelo menos 90% de precisão; observe também o pulso e as durações. A marcação de tarefa feita não substitui essas tentativas.', target, { mode: 'rhythm', speed: .9 });
  const fullTempo = exercise('assessment', 'Conferir no andamento da música', 'Quando o trecho estiver estável, faça uma execução em Recital a 100%. Compare o resultado com as tentativas anteriores. Retome o ponto que mais precisa de atenção antes de ampliar o trecho.', target, { mode: 'recital', speed: 1, repeatCount: 1 });
  const stages = [
    ['Reconhecer a estrutura', 'Ouvir, ler e identificar o desenho melódico antes de repetir movimentos.', [listen, contour, right]],
    ['Coordenar as mãos', 'Separar os papéis de cada mão e reuni-los em andamento confortável.', [left, right, both]],
    ['Firmar o ritmo', 'Conferir continuidade e duração sem parar o relógio da música.', [both, rhythm]],
    ['Comparar as reaparições', 'Distinguir o que se repete e o que mudou em outra ocorrência.', [listen, compare]],
    ['Ligar as frases', 'Estudar a passagem de uma estrutura à seguinte.', [compare, transition]],
    ['Começar de outros pontos', 'Praticar recuperação, localização e independência do início da música.', [challenge, memory]],
    ['Avaliar e escolher o próximo passo', 'Medir tentativas completas e revisar os pontos que ainda oscilam.', [assessment, fullTempo]],
  ];
  const sessions = stages.map(([title, description, items], i) => {
    const id = `session-${hash(`${analysisKey}:${family.id}:${target.id}:${i}`)}`;
    return { id, number: i + 1, title: `Sessão ${i + 1} — ${title}`, description, minutes, exercises: items, completed: normalizedProgress.completedSessions.includes(id) };
  });
  const recurring = families.filter(f => f.phrases.length > 1).length;
  const summary = `${families.length} padrão(ões) em ${phrases.length} trecho(s); ${recurring} com reaparições. Plano de sete sessões sugeridas de aproximadamente ${minutes} minutos, ajustável ao seu ritmo. Nenhum trecho é considerado dominado por uma marcação manual ou uma pontuação isolada.`;
  return { ...base, objective, summary, sessions, exercises, startingPoints: points, targetPatternId: family.id, recommendedPatternId };
}

export const createStudyPlan = buildStudyPlan;
