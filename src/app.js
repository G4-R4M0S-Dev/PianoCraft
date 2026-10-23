import { parseMidi, encodeMidi, createDemoSongs, normalizeSong, noteName } from './music/midi.js';
import { parseMusicFile } from './music/import.js';
import { SoundFontEngine } from './music/soundfont.js';
import { AudioEngine } from './music/audio.js';
import { MidiDevices } from './music/devices.js';
import { PracticeSession, handOf, isPracticeNote } from './music/practice.js';
import { getStored, setStored } from './storage.js';
import { renderScore } from './music/notation.js';
import { Recorder } from './music/recorder.js';
import { DrumMachine, patterns as drumPatterns } from './music/drums.js';
import { InstrumentControls } from './instrument.js';
import { LiveNoteTrail } from './music/live-trail.js';
import { PhrasePanel } from './phrases-panel.js';
import { StudyPanel } from './study-panel.js';
import { analyzePatterns } from './music/patterns.js';
import { normalizePhrasing } from './music/phrases.js';
import { normalizeStudyProgress } from './music/study-plan.js';
import { PracticeCadence } from './music/practice-cadence.js';
import { PulseMetronome } from './music/metronome.js';
import { summarizeProgress, songProgress, normalizeErrorEvents } from './music/progress.js';
import { ProgressPanel } from './progress-panel.js';
import { LiveScore } from './music/live-score.js';
import { initTheme } from './theme.js';
import { achievementContentKey, summarizeAchievements, mergeAchievementLedgers, evaluateAchievementAttempt } from './music/achievements.js';
import { AchievementPanel } from './achievement-panel.js';
import { CompletionNotice } from './completion.js';
import { buildLearningJourney, normalizeJourneyState, evaluateJourneyAttempt, createJourneyTask, learningProgress as summarizeLearningProgress } from './music/learning-journey.js';
import { SongHub } from './song-hub.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const audio = new AudioEngine(), midi = new MidiDevices();
let soundfont = null;
let instrument = null;
let phrasePanel=null,activePhraseId=null,phrasePreview=null;
let studyPanel=null,activeStudyExercise=null,sessionStart=0,sessionSpeed=1,sessionTranspose=0,sessionFullArrangement=false;
let progressPanel=null,liveScore=null,freeMetronome=null,practiceSessionId=null,themeController=null;
let achievementPanel=null,completionNotice=null,completionEpoch=0,achievementWrite=Promise.resolve(),sessionScopeComplete=false,sessionContentKey='';
let achievementLedgers=await getStored('achievement-ledgers',{});
if(!achievementLedgers||typeof achievementLedgers!=='object'||Array.isArray(achievementLedgers))achievementLedgers={};
const initializedAchievementKeys=new Set();
let lastCompletion=null;
let songHub=null,journeyWrite=Promise.resolve(),guidedRequest=0;
let journeyStates=await getStored('learning-journeys',{});
if(!journeyStates||typeof journeyStates!=='object'||Array.isArray(journeyStates))journeyStates={};
let evaluationAt=-Infinity;
const cadence=new PracticeCadence();
let studyProgress=await getStored('study-progress',{});
let progressWrite=Promise.resolve();
if(!studyProgress||typeof studyProgress!=='object'||Array.isArray(studyProgress))studyProgress={};
const liveTrail=new LiveNoteTrail();
let hadMidiInput = false;
let drums=null;
let pendingSoundfontBank=await getStored('soundfont-bank'),restoringSoundfont=null;
const synth = () => soundfont?.ready?soundfont:audio;
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const settings = { profile:'Meu perfil', volume:65, keys:61, labels:'letters', lookahead:4, chordWindowMs:120,theme:'dark',practiceCountInBars:1,practiceRestSeconds:1,freeBpm:120,freeNumerator:4,freeDenominator:4,celebrationSound:true,...read('pc-settings',{}) };
let songs = await getStored('songs',read('pc-songs', createDemoSongs())), history = await getStored('practice-history',read('pc-history',[]));
const libraryMetadata = s => ({sourceHash:typeof s.sourceHash==='string'&&/^[a-f\d]{64}$/i.test(s.sourceHash)?s.sourceHash:undefined,collection:typeof s.collection==='string'?s.collection.slice(0,100):'',author:typeof s.author==='string'?s.author.slice(0,200):'',rating:Number.isFinite(s.rating)?Math.max(0,Math.min(5,Math.round(s.rating))):0,difficulty:Number.isFinite(s.difficulty)?Math.max(1,Math.min(5,Math.round(s.difficulty))):1,userPractice:s.userPractice&&Number.isFinite(s.userPractice.a)&&Number.isFinite(s.userPractice.b)?{a:Math.max(0,s.userPractice.a),b:Math.max(0,s.userPractice.b),loop:s.userPractice.loop===true}:undefined});
try { songs=songs.map(s=>({...normalizeSong(s),configs:validateConfigs(s.configs),...libraryMetadata(s)}));if(!songs.length)songs=createDemoSongs(); }catch{songs=createDemoSongs();}
history=Array.isArray(history)?history.map(validateHistory).filter(Boolean):[];
let current = null, view = 'library', favoriteOnly = false, free = false, folderFilter='';
let playing = false, playRequest=0, time = 0, speed = 1, transpose = 0, mode = 'listen', hands = 'both';
let loop = false, loopA = 0, loopB = 0, metronome = false, lastBeat = -1;
let practice = new PracticeSession([]), elapsedPractice = 0, sessionSaved = false;
let activePlayback = new Map(), held = new Map(), keys = new Map(), keyGeometry = new Map();
let lastClockTick=performance.now();
let octave = 4, sustain = false, recording = null, recordSong = null, recordTrack = 0, freeProgram = 0;
const recorder=new Recorder();
const savedDraft=await getStored('recording-draft');
if(savedDraft)try{recorder.restore(savedDraft);recordSong=recorder.song;recordTrack=recordSong.tracks.length;}catch{}
let playbackEvents=[],nextEventIndex=0,currentPrograms=new Map(),backing=null;
let toastTimer, nextNoteIndex = 0;
let notation=null,notationZoom=1,notationRevision=0;
let rollPalette={bg:'#111820',grid:'#4d60711a',line:'#a0b5c21c',text:'#253a34'};
let previewTimers=[],previewSongId=null;
let pendingSplit=null;
function stopPreview(){previewTimers.forEach(clearTimeout);previewTimers=[];previewSongId=null;audio.allNotesOff();soundfont?.allNotesOff();midi.allNotesOff();}
const wrongHeld=new Set(),inputPedals=new Set(),midiPedals=new Map();
const fmt = seconds => `${Math.floor(Math.max(0,seconds)/60)}:${String(Math.floor(Math.max(0,seconds)%60)).padStart(2,'0')}`;
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => crypto.randomUUID();
function toast(message) { $('#toast').textContent = message; $('#toast').style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(()=>$('#toast').style.display='none',4200); }
function saveSettings() { try { localStorage.setItem('pc-settings',JSON.stringify(settings)); } catch { toast('Não foi possível salvar as preferências.'); } }
function saveSongs() {setStored('songs',songs).catch(()=>toast('Não foi possível salvar a biblioteca. Exporte um projeto para preservar suas alterações.'));}
function persistHistory(){
  const snapshot=history;
  try{localStorage.setItem('pc-history',JSON.stringify(snapshot.slice(0,100).map(row=>({...row,errorEvents:row.errorEvents?.slice(0,16)}))));}catch{}
  return setStored('practice-history',snapshot).catch(()=>toast('Não foi possível salvar os resultados da prática. Exporte seu projeto.'));
}
function configs() { return current?.configs || {}; }
function config(track) { return configs()[track] || {}; }
function visibleNote(note) { return !config(note.track).hidden; }
function audibleNote(note) { return config(note.track).role !== 'mute'&&!config(note.track).muted; }
function noteColor(note) { return config(note.track).color || (handOf(note,configs()) === 'left' ? '#b4a0ee' : '#a4dfb8'); }
function labelFor(pitch){
  const type=settings.labels,tonic=Number($('#tonic')?.value)||0,relative=(pitch-tonic+120)%12;
  if(type==='none')return '';
  if(type==='degrees')return ['1','♭2','2','♭3','3','4','♯4','5','♭6','6','♭7','7'][relative];
  if(type==='movable')return noteName(relative+60,true).replace(/\d+$/,'');
  if(type==='keyboard'){const code=Object.entries(settings.keyMap||keyMap).find(([,offset])=>pitch===(octave+1)*12+offset)?.[0];return code?.replace(/^Key/,'')||'';}
  return noteName(pitch,type==='solfege');
}
function rangeSelected(){return !!(activePhraseId||activeStudyExercise);}
function resetSession() { const end=(loop||rangeSelected())&&loopB>loopA?loopB:Infinity;practice = new PracticeSession(current?.notes || [],{mode,hands,speed,chordWindowMs:settings.chordWindowMs,configs:configs(),start:time,end});notation?.clearInputFeedback?.();elapsedPractice=0; sessionSaved=false;sessionStart=time;sessionSpeed=speed;sessionTranspose=transpose;sessionFullArrangement=hands==='both'&&practice.notes.length>0&&practice.notes.length===(current?.notes||[]).filter(n=>n.time>=time&&n.time<end).length;sessionScopeComplete=practice.notes.length>0&&practice.notes.length===(current?.notes||[]).filter(n=>n.time>=time&&n.time<end&&(hands==='both'||handOf(n,configs())===hands)).length;sessionContentKey=current&&!free?achievementContentKey(current):''; updateScore(); }
function saveSession(completed=false,completion={}) {
  if (!current || free || phrasePreview || mode==='listen' || sessionSaved || (elapsedPractice<1&&!(completed&&elapsedPractice>0&&practice.notes.length))) return;
  sessionSaved=true;
  const row={id:uid(),songId:current.id,profile:settings.profile,title:current.title,date:new Date().toISOString(),mode,hands,seconds:elapsedPractice<1?Math.round(elapsedPractice*1000)/1000:Math.round(elapsedPractice),hits:practice.hits.size,missed:practice.missed.size,errors:practice.errors,accuracy:practice.accuracy,completed};
  const phrase=current.phrasing?.phrases.find(p=>p.id===activePhraseId);if(phrase)Object.assign(row,{phraseId:phrase.id,phraseName:phrase.name,phraseStart:phrase.start,phraseEnd:phrase.end});
  Object.assign(row,{analysisKey:current.phrasing?.revisionKey??current.phrasing?.contentKey,speed:sessionSpeed,transpose:sessionTranspose,fullArrangement:sessionFullArrangement,start:sessionStart,end:(loop||rangeSelected())&&loopB>loopA?loopB:current.duration,expectedNotes:practice.notes.length});
  if(phrase)Object.assign(row,{patternId:phrase.patternId,phraseStart:sessionStart});
  if(activeStudyExercise)Object.assign(row,{exerciseId:activeStudyExercise.id,patternId:activeStudyExercise.patternId});
  if(activeStudyExercise?.guided)row.journeyTaskId=activeStudyExercise.id;
  Object.assign(row,{practiceSessionId:practiceSessionId||=uid(),attemptId:row.id,position:time,errorEvents:normalizeErrorEvents(practice.errorEvents,current.duration),errorEventsDropped:practice.errorEventsDropped||0});
  Object.assign(row,{songContentKey:sessionContentKey,scopeComplete:sessionScopeComplete});
  const reward=completed?{song:structuredClone(current),context:achievementState(current,settings.profile),beforeScore:songProgress(current,history,{profile:settings.profile}).score,epoch:completionEpoch,run:activeStudyExercise?.rewardRun,
    mode,hands,speed:sessionSpeed??speed,transpose:sessionTranspose??transpose,start:row.start,end:row.end,exercise:activeStudyExercise?structuredClone({...activeStudyExercise,rewardRun:undefined}):null,...completion}:null;
  history.unshift(row); history=history.slice(0,1000);
  persistHistory();
  studyPanel?.refreshProgress();
  if(reward){reward.afterScore=songProgress(reward.song,history,{profile:row.profile}).score;queueAchievement(row,reward);}
  return row;
}
function achievementState(song,profile=settings.profile){
  const contentKey=achievementContentKey(song),key=JSON.stringify([profile,song.id,contentKey]);
  if(!initializedAchievementKeys.has(key)){
    achievementLedgers[key]=summarizeAchievements(song,history,{profile,ledger:achievementLedgers[key]}).ledger;
    initializedAchievementKeys.add(key);
  }
  return {key,profile,contentKey,summary:summarizeAchievements(song,[],{profile,ledger:achievementLedgers[key]})};
}
function refreshAchievements(){achievementPanel?.setData(free?null:current,current&&!free?achievementState(current).summary:null,{profile:settings.profile});}
function learningProgress(song,profile=settings.profile){
  return summarizeLearningProgress(song,{profile,history,achievements:achievementState(song,profile).summary});
}
function journeyKey(song,profile=settings.profile){return JSON.stringify([profile,song.id,achievementContentKey(song)]);}
function learningJourney(song,profile=settings.profile){return buildLearningJourney(song,{profile,history,achievements:achievementState(song,profile).summary,state:journeyStates[journeyKey(song,profile)]});}
function persistJourney(song,state,profile=settings.profile){
  const key=journeyKey(song,profile),valid=normalizeJourneyState(state,song,{profile});
  const task=journeyWrite.catch(()=>{}).then(async()=>{await setStored('learning-journeys',{...journeyStates,[key]:valid});journeyStates={...journeyStates,[key]:valid};});
  journeyWrite=task;return task;
}
function updateJourney(song,profile,update){
  const key=journeyKey(song,profile);
  const task=journeyWrite.catch(()=>{}).then(async()=>{
    const previous=normalizeJourneyState(journeyStates[key],song,{profile}),result=update(previous);
    const state=normalizeJourneyState(result.state||result,song,{profile});
    await setStored('learning-journeys',{...journeyStates,[key]:state});journeyStates={...journeyStates,[key]:state};return result;
  });journeyWrite=task;return task;
}
function renderSongHub(){if(current&&!free)songHub?.setData(current,learningJourney(current),{achievements:achievementState(current).summary,profile:settings.profile});}
function openSongHub(song){
  if(!song)return;
  stopPhrasePreview();pause();saveSession();if(recording)stopRecord();freeMetronome?.stop();
  invalidateCompletion();clearStudyExercise();current=song;free=false;time=0;elapsedPractice=0;sessionSaved=true;
  document.body.classList.remove('free-piano','guided-practice');
  setView('song');renderSongHub();window.scrollTo(0,0);
}
async function startGuidedTask({songId=current?.id,task}={}){
  const request=++guidedRequest;
  const song=songs.find(s=>s.id===songId),profile=settings.profile;if(!song)return;
  const journey=learningJourney(song,profile);task ||= journey.task;if(!task)throw new Error('Esta música não contém notas para praticar.');
  const epoch=completionEpoch,state=await updateJourney(song,profile,previous=>normalizeJourneyState({...previous,task,streak:previous.task?.id===task.id?previous.streak:0,started:true,startedAt:previous.startedAt||new Date().toISOString(),updatedAt:new Date().toISOString()},song,{profile}));
  if(request!==guidedRequest||profile!==settings.profile||epoch!==completionEpoch||current?.id!==song.id)return;
  loadSong(song);
  for(const note of current.notes.filter(n=>n.time>=task.start&&n.time<task.end&&(task.hands==='both'||handOf(n,configs())===task.hands))){current.configs[note.track]={...config(note.track),role:'learn'};}
  saveSongs();renderTracks();
  await practiceStudyExercise({...task,guided:true,goalStreak:state.streak,repeatCount:Math.max(1,(task.targetStreak||3)-(state.streak||0))});
}
async function continueLearning(){
  const saved=lastCompletion;if(!saved)return;
  const song=songs.find(s=>s.id===saved.reward.song.id);if(!song)return;
  const task=saved.reward.journeyResult?.nextTask||learningJourney(song).task;
  if(!task){openSongHub(song);return;}
  return startGuidedTask({songId:song.id,task});
}
function invalidateCompletion(){completionEpoch++;completionNotice?.clear();lastCompletion=null;}
function rewardRun(){return {id:uid(),gain:0,milestones:[],started:false};}
function showCompletion(result,reward,{compact=false}={}){
  if(reward.epoch!==completionEpoch||reward.song.id!==current?.id||reward.profile!==settings.profile||view!=='studio'||free)return;
  if(reward.context&&reward.context.contentKey!==achievementContentKey(current))return;
  lastCompletion={result,reward};
  if(completionNotice?.show(result,{compact})&&!compact&&(!result.goal||result.goal.met)&&settings.celebrationSound!==false)audio.completionChime();
}
function queueAchievement(row,reward){
  const task=achievementWrite.catch(()=>{}).then(async()=>{
    const {key}=reward.context;
    const previousSummary=achievementState(reward.song,row.profile).summary;
    const learningBefore=previousSummary.maxPoints?Math.round(100*previousSummary.totalPoints/previousSummary.maxPoints):0;
    const evaluated=evaluateAchievementAttempt(reward.song,achievementLedgers[key],row,{profile:row.profile});
    // Commit the evidence before announcing it. Each path keeps only its best evidence.
    await setStored('achievement-ledgers',{...achievementLedgers,[key]:evaluated.ledger});
    achievementLedgers={...achievementLedgers,[key]:evaluated.ledger};
    let journeyResult=null;
    if(reward.exercise?.guided){
      journeyResult=await updateJourney(reward.song,row.profile,previous=>evaluateJourneyAttempt(reward.song,previous,row,{profile:row.profile}));
      reward.journeyResult=journeyResult;
      if(activeStudyExercise?.id===reward.exercise.id&&current?.id===reward.song.id&&settings.profile===row.profile){activeStudyExercise.goalStreak=journeyResult.streak;activeStudyExercise.goalMet=journeyResult.goalMet;renderStudyExercise();}
    }
    const gains=evaluated.gains,run=reward.run;
    if(run){
      if(run.contextKey!==key||run.pathId!==`${row.mode}:${row.hands}`)Object.assign(run,{id:uid(),contextKey:key,pathId:`${row.mode}:${row.hands}`,gain:0,milestones:[],started:false,hits:0,total:0,learningBefore:undefined,learningAfter:undefined});
      if(!run.started){run.trackBefore=gains.previousScore;run.scoreBefore=reward.beforeScore;run.started=true;}
      run.learningBefore??=learningBefore;run.learningAfter=evaluated.summary.maxPoints?Math.round(100*evaluated.summary.totalPoints/evaluated.summary.maxPoints):0;
      run.gain+=gains.points;run.trackAfter=gains.score;run.scoreAfter=reward.afterScore;
      run.hits=(run.hits||0)+row.hits;run.total=(run.total||0)+row.hits+row.missed+row.errors;
      run.milestones=[...new Map([...run.milestones,...gains.newMilestones].map(m=>[m.id,m])).values()];
    }
    if(current?.id===reward.song.id&&settings.profile===row.profile)refreshAchievements();
    if(view==='progress')renderProgress();else if(view==='library')renderLibrary();
    else if(view==='song')renderSongHub();
    const compact=reward.kind==='loop';
    if(compact&&!gains.points&&!gains.newMilestones.length&&!journeyResult?.qualified)return;
    if(!compact&&reward.taskSaved)await reward.taskSaved;
    const total=!compact&&run?.started?run:null;
    showCompletion({kind:reward.kind,title:compact?'Evolução registrada':reward.kind==='exercise'?'Exercício concluído':reward.kind==='phrase'?'Frase concluída':'Música concluída',
      songTitle:reward.song.title,mode:row.mode,hands:row.hands,accuracy:total?.total?Math.round(100*total.hits/total.total):row.accuracy,
      gain:total?.gain??gains.points,trackBefore:total?total.trackBefore:gains.previousScore,trackAfter:total?total.trackAfter:gains.score,
      scoreBefore:total?total.scoreBefore:reward.beforeScore,scoreAfter:total?total.scoreAfter:reward.afterScore,
      milestones:total?.milestones??gains.newMilestones,reason:gains.reason,newRecord:(total?.gain??gains.points)>0,
      learningProgress:{before:total?.learningBefore??learningBefore,after:total?.learningAfter??(evaluated.summary.maxPoints?Math.round(100*evaluated.summary.totalPoints/evaluated.summary.maxPoints):0),value:evaluated.summary.maxPoints?Math.round(100*evaluated.summary.totalPoints/evaluated.summary.maxPoints):0,label:'Progresso de estudo'},
      ...(journeyResult?{goal:{met:journeyResult.goalMet,streak:journeyResult.streak,required:journeyResult.requiredStreak,targetAccuracy:reward.exercise.targetAccuracy||90,label:journeyResult.summary},nextAction:{label:journeyResult.actionLabel,description:journeyResult.nextTask?.instruction}}:{}),
      attemptId:!compact&&run?run.id:row.id}, {...reward,profile:row.profile}, {compact});
  });
  achievementWrite=task;
  task.catch(()=>toast('Não foi possível salvar a conquista. O resultado da prática continua no histórico.'));
  return task;
}
async function practiceAchievementPath({songId,mode:nextMode,hands:nextHands}){
  const song=songs.find(s=>s.id===songId);if(!song)return;
  if(current?.id!==song.id||free)openSongHub(song);
  const journey=learningJourney(song),same=journey.task?.mode===nextMode&&journey.task?.hands===nextHands;
  const task=createJourneyTask(song,{...journey.task,title:same?journey.task.title:undefined,instruction:same?journey.task.instruction:undefined,reason:same?journey.task.reason:undefined,mode:nextMode,hands:nextHands,speed:same?journey.task.speed:nextMode==='melody'?.6:nextMode==='rhythm'?.9:1});
  return startGuidedTask({songId,task});
}
async function replayCompletion(){
  const saved=lastCompletion;if(!saved)return;
  const {reward}=saved,song=songs.find(s=>s.id===reward.song.id);if(!song)return;
  if(reward.exercise?.guided)return startGuidedTask({songId:song.id,task:reward.journeyResult?.task||reward.exercise});
  loadSong(song);
  if(reward.exercise)return practiceStudyExercise(reward.exercise);
  $('#mode').value=reward.mode;$('#hands').value=reward.hands;$('#mode').dispatchEvent(new Event('change'));
  speed=reward.mode==='recital'?1:reward.speed;transpose=reward.transpose??0;
  $('#speed').value=Math.round(speed*100);$('#speed-value').textContent=`${Math.round(speed*100)}%`;$('#transpose').value=transpose;
  if(reward.start>0||reward.end<song.duration){activePhraseId=`replay-${reward.start}`;loopA=reward.start;loopB=reward.end;time=loopA;loop=false;$('#loop').setAttribute('aria-pressed','false');}
  else{activePhraseId=null;loop=false;loopA=0;loopB=song.duration;time=0;$('#loop').setAttribute('aria-pressed','false');}
  resetPlayback();resetSession();updateLoop();updateTransport();await play();
}
function updateScore() {
  $('#hits').textContent=practice.hits.size;
  $('#accuracy').textContent=practice.accuracy===null?'—':`${practice.accuracy}%`;
  if($('#errors'))$('#errors').textContent=practice.errors;
  if($('#missed'))$('#missed').textContent=practice.missed.size;
  if($('#practice-feedback')){
    const result=practice.lastResult||{},messages={
      'incomplete-chord':`Complete o acorde com as teclas pressionadas juntas em até ${settings.chordWindowMs} ms.`,
      'chord-timeout':'As notas ficaram separadas demais. Solte as teclas e toque o acorde novamente.',
      'released-before-chord':'Uma tecla foi solta antes de completar o acorde. Toque todas juntas.',
      'released-too-early':'Nota solta cedo demais. Sustente pelo tempo indicado na música.',
      'awaiting-pedal-release':'Som sustentado pelo pedal. Mantenha a duração indicada.',
      'wrong-note':'Nota diferente da esperada.',
      'outside-onset-window':'Nota fora do momento esperado.',
      'onset-missed':'O início do acorde passou. Acompanhe o próximo grupo de notas.',
      'complete-chord':`Acerto · notas juntas em ${Math.round(result.spreadMs||0)} ms.`,
    };
    $('#practice-feedback').textContent=mode==='listen'?'':messages[result.reason]||'';
    $('#practice-feedback').dataset.state=result.status||'idle';
  }
}
function maybeResetLoop(){const threshold=Number($('#error-reset').value);if(playing&&!cadence.active&&loop&&threshold&&practice.errors>=threshold){saveSession();seek(loopA);startPreparation(true);toast('Recomeçando o trecho após o limite de erros.');}}
function setView(name) {
  if(name!==view)invalidateCompletion();
  if(name!=='studio'&&name!=='free')stopPhrasePreview();
  if (name !== 'studio' && name !== 'free') { pause();saveSession();practiceSessionId=null;if(recording) stopRecord();drums?.stop();freeMetronome?.stop();if($('#free-metronome')){$('#free-metronome').setAttribute('aria-pressed','false');}if($('#drum-pattern'))$('#drum-pattern').value='off'; }
  view=name;
  applyFocusMode();
  $$('.view').forEach(el=>el.classList.add('hidden'));
  $(`#${name==='free'?'studio':name}-view`).classList.remove('hidden');
  document.body.classList.toggle('studio-screen',name==='studio'||name==='free');
  $$('.nav').forEach(el=>el.classList.toggle('active',el.dataset.view===(name==='song'?'studio':name)));
  $('#page-label').textContent={library:'Biblioteca',song:'Meu estudo',studio:'Praticando',free:'Piano livre',progress:'Meu progresso'}[name];
  if(name==='library') renderLibrary();
  if(name==='progress') renderProgress();
  if(name==='studio'||name==='free') {practiceSessionId||=uid();buildKeyboard(); resizeCanvas(); }
}
function applyFocusMode(){
  const enabled=!!settings.focusMode&&(view==='studio'||view==='free');
  document.body.classList.toggle('practice-focus',enabled);
  $('#focus-mode').setAttribute('aria-pressed',String(enabled));$('#focus-mode').textContent=enabled?'Sair do foco · Esc':'Modo foco';
  requestAnimationFrame(()=>{if(view==='studio'||view==='free')resizeCanvas();});
}
function setFocusMode(enabled){settings.focusMode=!!enabled;saveSettings();applyFocusMode();}
function renderLibrary() {
  const query=$('#search').value.toLocaleLowerCase('pt-BR');
  const list=songs.filter(song=>(!favoriteOnly||song.favorite)&&(!folderFilter||song.collection===folderFilter)&&song.title.toLocaleLowerCase('pt-BR').includes(query));
  const sort=$('#sort')?.value||'title';
  const summaries=new Map(summarizeProgress(songs,history,{profile:settings.profile}).songs.map(s=>[s.songId,s]));
  const summary=s=>summaries.get(s.id)||{score:null,trend:null,coverage:0,studiedCoverage:0,sessions:0,seconds:0,lastPracticeMs:0,masteryLabel:'Ainda sem avaliação'};
  const learningSummaries=new Map(list.map(song=>[song.id,learningProgress(song)]));
  const comparators={title:(a,b)=>a.title.localeCompare(b.title,'pt-BR'),duration:(a,b)=>a.duration-b.duration,tempo:(a,b)=>a.tempo-b.tempo,rating:(a,b)=>(a.rating||0)-(b.rating||0),difficulty:(a,b)=>(a.difficulty||1)-(b.difficulty||1),progress:(a,b)=>(learningSummaries.get(b.id)?.value||0)-(learningSummaries.get(a.id)?.value||0),count:(a,b)=>summary(b).sessions-summary(a).sessions,recent:(a,b)=>summary(b).lastPracticeMs-summary(a).lastPracticeMs};
  list.sort(comparators[sort]||comparators.title);if($('#sort-direction')?.dataset.desc==='true')list.reverse();
  $('#song-count').textContent=songs.length;
  $('#library-total').textContent=`${songs.length} músicas`;
  $('#song-grid').innerHTML=list.length?list.map((song,i)=>{
    const palettes=[['#344c43','#71978d55'],['#403b53','#8e77a955'],['#49402e','#a28c5855']];
    const [base,glow]=palettes[i%3];
    const progress=summary(song),learning=learningSummaries.get(song.id),resumable=journeyStates[journeyKey(song)]?.started===true;
    return `<article class="song-card" data-song="${escapeHtml(song.id)}"><div class="card-art" style="--artBase:${base};--artGlow:${glow}"><div class="staff-lines"></div><span class="music-symbol">${['𝄞','♬','𝄢'][i%3]}</span><button class="favorite-button" aria-label="Favoritar ${escapeHtml(song.title)}">${song.favorite?'♥':'♡'}</button></div><div class="card-body"><h3>${escapeHtml(song.title)}</h3><div class="card-meta">${escapeHtml(song.author||(song.id.startsWith('demo-')?'Exercício PianoCraft':'Sua biblioteca'))} · ${fmt(song.duration)} · ${Math.round(song.tempo)} BPM</div><div class="song-mastery"><div><b>${learning.value??'—'}<small>/100</small></b><span>Progresso de estudo</span></div><progress max="100" value="${learning.value??0}" aria-label="Progresso de estudo desta música"></progress><small>${escapeHtml(learning.stage)}</small></div><div class="card-footer"><span>${progress.sessions} sessões · ${fmt(progress.seconds)} de prática</span><div><button class="song-progress" title="Ver progresso desta música">↗ Progresso</button><button class="preview-song" title="Ouvir prévia">▷</button> <button class="open-song">${resumable?'Continuar estudo':'Começar estudo'} ↗</button></div></div></div></article>`;
  }).join(''):'<div class="empty">Nenhuma música encontrada. Importe um MIDI ou MusicXML para começar.</div>';
  $$('.song-card').forEach(card=>{
    card.querySelector('.song-progress').onclick=()=>{setView('progress');progressPanel?.focusSong?.(card.dataset.song);};
    card.querySelector('.open-song').onclick=()=>openSongHub(songs.find(s=>s.id===card.dataset.song));
    card.querySelector('.preview-song').onclick=async()=>{const song=songs.find(s=>s.id===card.dataset.song);if(!song)return;const wasPlaying=previewSongId===song.id;stopPreview();if(wasPlaying)return;pause();await audio.init();previewSongId=song.id;for(const n of song.notes.filter(n=>n.time<8)){const timer=setTimeout(()=>{if(view!=='library'||previewSongId!==song.id)return;routeOn(n.midi,n.velocity,n.channel,song.tracks.find(t=>t.id===n.track)?.program||0);previewTimers.push(setTimeout(()=>routeOff(n.midi,n.channel),Math.min(n.duration,8-n.time)*1000));},n.time*1000);previewTimers.push(timer);}previewTimers.push(setTimeout(stopPreview,8500));toast('Prévia · até 8 segundos. Clique novamente para encerrar.');};
    card.querySelector('.favorite-button').onclick=()=>{const song=songs.find(s=>s.id===card.dataset.song);song.favorite=!song.favorite;saveSongs();renderLibrary();};
  });
}
function loadSong(song, isFree=false) {
  invalidateCompletion();
  stopPhrasePreview();
  pause(); saveSession(); if(recording) stopRecord();
  clearStudyExercise();
  practiceSessionId=uid();freeMetronome?.stop();if($('#free-metronome'))$('#free-metronome').setAttribute('aria-pressed','false');
  current=song; free=isFree; time=0; loopA=Number(song.userPractice?.a)||0;loopB=Number(song.userPractice?.b)||song.duration;loop=!!song.userPractice?.loop;current.configs ||= {};
  if($('#practice-tools')){$('#practice-tools').hidden=isFree;$('#practice-tools').open=false;}
  $('#back-to-song').hidden=isFree;
  document.body.classList.toggle('free-piano',isFree);
  liveTrail.clear();activePhraseId=null;phrasePreview=null;phrasePanel?.setSong(isFree?null:song);phrasePanel?.setActive(null);$('#phrases-host').classList.toggle('hidden',isFree);
  studyPanel?.setSong(isFree?null:song);$('#study-host').classList.toggle('hidden',isFree);refreshStudyProgress();refreshAchievements();
  if(!isFree){drums?.stop();$('#drum-pattern').value='off';}
  if(loopA>=loopB||loopB>song.duration){loopA=0;loopB=song.duration;loop=false;}
  activePhraseId=!isFree&&loop?song.phrasing?.phrases.find(p=>Math.abs(p.start-loopA)<1e-5&&Math.abs(p.end-loopB)<1e-5)?.id||null:null;phrasePanel?.setActive(activePhraseId);
  $('#loop').setAttribute('aria-pressed',loop);
  $('#song-title').textContent=isFree?'Um piano. Todas as possibilidades.':song.title;
  $('#studio-eyebrow').textContent=isFree?'PIANO LIVRE':'ESTÚDIO DE PRÁTICA';
  $('.practice-bar').classList.toggle('hidden',isFree);
  $('.transport').classList.toggle('hidden',isFree);
  $('#score-strip').classList.toggle('hidden',isFree);
  $('.track-panel').classList.toggle('hidden',isFree);
  $('#edit-notes').classList.toggle('hidden',isFree);
  $('#sheet-toggle').classList.remove('hidden');
  $('#sheet').classList.remove('hidden');
  document.body.classList.add('with-sheet');
  notationRevision++;notation?.dispose();notation=null;$('.piano-stage').classList.remove('hidden');
  $('#notation').classList.remove('full-score');$('#live-notation').classList.remove('full-score');
  $('#export-midi').classList.toggle('hidden',isFree);
  $('#free-tools').classList.toggle('hidden',!isFree);
  $('#record-takes').classList.toggle('hidden',!isFree);
  $('#beat-tools').classList.toggle('hidden',!isFree);
  $('#practice-options').classList.toggle('hidden',isFree);
  $('#duration').textContent=fmt(song.duration);
  $('#timeline').value=0; $('#current-time').textContent='0:00';
  resetPlayback(); resetSession(); renderTracks(); updateLoop();renderMarkers();
  renderPracticeMission();
  setView(isFree?'free':'studio');
  window.scrollTo(0,0);
  $('#notation').classList.toggle('hidden',isFree);$('#live-notation').classList.toggle('hidden',!isFree);
  if(isFree){liveScore?.setTempo(Number($('#drum-bpm').value));liveScore?.setMeter(...$('#free-meter').value.split('/').map(Number));liveScore?.setSong(recordSong?.notes.length?recordSong:null);$('#notation-status').textContent='Pauta ao vivo · toque para escrever';}
  else refreshNotation();
}
function silence() {
  if(previewTimers.length)stopPreview();
  practice.clearInput?.('pause');instrument?.guides.allOff();notation?.clearInputFeedback?.();liveTrail.releaseAll();liveScore?.releaseAll(performance.now()/1000);
  if(recording) for(const n of held.values()) recorder.noteOff(n.pitch,n.channel);
  audio.allNotesOff(); soundfont?.allNotesOff(); midi.allNotesOff(); activePlayback.clear(); held.clear();wrongHeld.clear();inputPedals.clear();midiPedals.clear();sustain=false;keys.forEach(k=>k.classList.remove('down','active-note','left-note'));
}
function resetPlayback() {
  silence();lastBeat=-1;
  nextNoteIndex=current?.notes.findIndex(n=>n.time>=time)??0;
  if(nextNoteIndex<0) nextNoteIndex=current?.notes.length||0;
  playbackEvents=current?.events||[];nextEventIndex=0;currentPrograms.clear();
  for(let ch=0;ch<16;ch++){synth().controlChange?.(121,0,ch);synth().pitchBend?.(8192,ch);if(midi.outputId)midi.sendControl(121,0,ch);}
  if(current) for(const track of current.tracks) midi.sendProgram(config(track.id).program??track.program??0,track.channel??0);
  while(nextEventIndex<playbackEvents.length&&playbackEvents[nextEventIndex].time<=time)routeEvent(playbackEvents[nextEventIndex++]);
}
async function play({guard=()=>true}={}) {
  if(!current || free) return;
  if(playing) return pause();
  const request=++playRequest,song=current,epoch=completionEpoch;
  await ensureAudio();
  if(request!==playRequest||song!==current||epoch!==completionEpoch||view!=='studio'||free||!guard())return;
  const impossible=current.notes.some(n=>isPracticeNote(n,mode,hands,configs())&&(n.midi+transpose<0||n.midi+transpose>127));
  if(impossible){toast('A transposição deixa notas fora do intervalo MIDI. Escolha outro valor.');return;}
  const end=rangeSelected()||loop?loopB:current.duration;
  invalidateCompletion();
  if(activeStudyExercise?.remaining<=0){activeStudyExercise.remaining=activeStudyExercise.repeatCount;activeStudyExercise.rewardRun=rewardRun();renderStudyExercise();}
  if(time>=end-.05) seek(rangeSelected()||loop?loopA:0);
  if(sessionSaved)resetSession();
  resetPlayback();
  if($('#practice-tools'))$('#practice-tools').open=false;
  playing=true;lastClockTick=performance.now();sessionSaved=false;
  $('#play').textContent='Ⅱ';$('#play-state').textContent='Em prática';
  const prepare=!phrasePreview&&(mode!=='listen'||rangeSelected());
  if(prepare&&startPreparation(false))return;
  startPlaybackSounds();
}
function startPlaybackSounds(startAt=-Infinity){evaluationAt=startAt;for(const note of current.notes){if(note.time>=time||note.time+note.duration<=time||!audibleNote(note)||isPracticeNote(note,mode,hands,configs()))continue;routeOn(note.midi+transpose,note.velocity*(config(note.track).volume??1),note.channel,config(note.track).program??currentPrograms.get(note.channel)??current.tracks.find(t=>t.id===note.track)?.program??0);if(note.time+(note.keyDuration??note.duration)<=time)routeOff(note.midi+transpose,note.channel);else activePlayback.set(note.id,note);}}
function cancelPreparation(){cadence.cancel();audio.stopClicks();if($('#practice-countdown')){$('#practice-countdown').hidden=true;$('#practice-countdown').dataset.phase='idle';}}
function startPreparation(repeat){
  cancelPreparation();const beat=beatAt(time),now=performance.now();
  const schedule=cadence.start({now,bpm:beat.bpm,speed,numerator:beat.numerator,denominator:beat.denominator,bars:settings.practiceCountInBars,restSeconds:repeat?settings.practiceRestSeconds:0});
  if(!cadence.active)return false;
  evaluationAt=cadence.endAt;
  instrument?.guides.allOff();const anchor=audio.context?.currentTime??0;for(const click of schedule.clicks)audio.click(click.accent,anchor+click.offset);
  renderPreparation(now);return true;
}
function renderPreparation(now){
  const state=cadence.advance(now),element=$('#practice-countdown');
  if(element){element.hidden=!state.active;element.dataset.phase=state.phase||'idle';element.textContent=state.phase==='rest'?`Respire e prepare as mãos · ${Math.ceil(state.remaining)} s`:state.active?`Preparação · ${state.beat} de ${state.total}`:'';}
  if(state.active){$('#play-state').textContent=state.phase==='rest'?'Pausa entre repetições':'Contagem de entrada';$('#waiting').textContent='A avaliação começa depois da contagem';}
  return state;
}
function pause() { playRequest++;playing=false;cancelPreparation();silence();$('#play').textContent='▶';$('#play-state').textContent='Pausado';$('#waiting').textContent='Espaço para continuar'; }
function seek(value,{internal=false}={}) { if(!internal)invalidateCompletion();const wasPreparing=cadence.active;cancelPreparation();saveSession();const low=rangeSelected()?loopA:0,high=rangeSelected()?loopB:current?.duration||0;time=Math.min(high,Math.max(low,value));resetPlayback();resetSession();evaluationAt=wasPreparing?performance.now():-Infinity;updateTransport(); }
function routeOn(note, velocity, channel=0, program=0) { if(note<0||note>127)return;if(midi.outputId)midi.sendNoteOn(note,velocity,channel);else synth().noteOn(note,velocity,channel,program); }
function routeOff(note,channel=0) { if(midi.outputId)midi.sendNoteOff(note,channel);else synth().noteOff(note,channel); }
function pedal(value,channel=0) {synth().setSustain(value,channel);if(midi.outputId)midi.sendSustain(value,channel);}
function practicePedal(value,channel=0,receivedTime=performance.now()) {
  if(free)liveScore?.setPedal(value,receivedTime/1000);
  if(!playing||cadence.active||mode==='listen')return;
  practice.setSustain(`channel:${channel}`,value,receivedTime);updateScore();maybeResetLoop();
}
function routeEvent(event) {
  const channel=event.channel??0,value=event.value,engine=synth();
  if(event.type==='program'){currentPrograms.set(channel,value);if(midi.outputId)midi.sendProgram(value,channel);else engine.programChange?.(value,channel);}
  else if(event.type==='cc'){if(midi.outputId)midi.sendControl(event.controller,value,channel);else engine.controlChange?.(event.controller,value,channel);}
  else if(event.type==='pitchBend'){if(midi.outputId)midi.sendPitchBend(value,channel);else engine.pitchBend?.(value,channel);}
  else if(event.type==='aftertouch'){if(midi.outputId)midi.sendAftertouch(value,channel);else engine.aftertouch?.(value,channel);}
  else if(event.type==='polyAftertouch'){if(midi.outputId)midi.sendPolyAftertouch(event.midi,value,channel);else engine.polyAftertouch?.(event.midi,value,channel);}
}
async function ensureAudio(){await audio.init();if(pendingSoundfontBank&&!soundfont?.ready){restoringSoundfont||=loadSoundFont(pendingSoundfontBank,{preserveHeld:true,save:false}).finally(()=>restoringSoundfont=null);await restoringSoundfont;}if(soundfont?.ready)await soundfont.init();}
async function loadSoundFont(bank,{preserveHeld=false,save=true}={}) {
  if(!bank)return;
  if(!preserveHeld){pause();if(recording)stopRecord();silence();}await audio.init();
  $('#soundfont-status').textContent='Carregando instrumento…';
  const candidate=new SoundFontEngine({context:audio.context,volume:settings.volume/100});
  try {
    const bytes=new Uint8Array(bank.data);await candidate.init(bytes.buffer);
    soundfont?.dispose();soundfont=candidate;soundfont.onError=error=>toast(error.message);
    pendingSoundfontBank=null;
    if(save)setStored('soundfont-bank',bank).catch(()=>toast('O som foi carregado, mas o banco não pôde ser salvo para a próxima abertura.'));
    $('#soundfont-status').textContent=`${bank.name} · ${soundfont.presets.length} timbre(s)`;
    toast('SoundFont pronto para tocar.');
  } catch(error) {candidate.dispose();pendingSoundfontBank=null;$('#soundfont-status').textContent='Usando o sintetizador interno';toast(error.message);}
}
function updateTransport() { $('#current-time').textContent=fmt(time);$('#timeline').value=current?.duration?Math.round(time/current.duration*1000):0;phrasePanel?.refreshTime(); }
function updateLoop() { $('#loop-range').textContent=loopA===0&&loopB===current?.duration?'música inteira':`${fmt(loopA)} – ${fmt(loopB)}`;phrasePanel?.setRepeat(loop);if(current&&!free){current.userPractice={a:loopA,b:loopB,loop};saveSongs();} }
function studyContext(){return {analysisKey:current?.phrasing?.revisionKey??current?.phrasing?.contentKey??'',songId:current?.id??'',profile:settings.profile};}
function studyProgressKey(context=studyContext()){return JSON.stringify([context.profile,context.songId,context.analysisKey]);}
function refreshStudyProgress(){studyPanel?.setProgress(normalizeStudyProgress(studyProgress[studyProgressKey()],studyContext()));}
function persistStudyProgress(progress,context=studyContext()){
  const task=progressWrite.catch(()=>{}).then(async()=>{
    const key=studyProgressKey(context),valid=normalizeStudyProgress(progress,context),previous=normalizeStudyProgress(studyProgress[key],context);
    valid.finishedExercises=[...new Set([...previous.finishedExercises,...valid.finishedExercises])];
    const next={...studyProgress,[key]:valid};await setStored('study-progress',next);studyProgress=next;
    if(studyProgressKey()===key)refreshStudyProgress();
  });progressWrite=task;return task;
}
function finishStudyExercise(){
  const exercise=activeStudyExercise;if(!exercise?.id||!current?.phrasing?.patterns?.length)return;
  const context=studyContext(),progress=normalizeStudyProgress(studyProgress[studyProgressKey(context)],context);
  progress.finishedExercises.push(exercise.id);const task=persistStudyProgress(progress,context);task.catch(()=>toast('Não foi possível salvar a conclusão do exercício.'));return task;
}
function renderStudyExercise(){
  const exercise=activeStudyExercise,element=$('#study-exercise');if(!element)return;
  element.hidden=!exercise;document.body.classList.toggle('study-memory',!!exercise?.hideGuides);
  document.body.classList.toggle('guided-practice',!!exercise?.guided);
  renderPracticeMission();
  if(!exercise)return;
  element.dataset.completed=String(exercise.guided?!!exercise.goalMet:exercise.remaining<=0);
  element.dataset.attemptsComplete=String(exercise.remaining<=0);
  $('#study-exercise-title').textContent=exercise.guided?(exercise.goalMet?`✓ Meta atingida · ${exercise.title}`:exercise.remaining<=0?`Vamos consolidar · ${exercise.title}`:exercise.title):exercise.remaining<=0?`✓ Prática concluída · ${exercise.title}`:`${exercise.title} · ${Math.max(0,exercise.remaining)}/${exercise.repeatCount} repetições restantes`;
  $('#study-exercise-instruction').textContent=exercise.instruction||'';
}
function clearStudyExercise(){activeStudyExercise=null;renderStudyExercise();}
function personalizePractice(){
  if(!activeStudyExercise?.guided)return;
  saveSession();pause();activeStudyExercise.guided=false;activeStudyExercise.goalMet=false;activeStudyExercise.goalStreak=0;activeStudyExercise.rewardRun=rewardRun();activeStudyExercise.title='Trecho personalizado';
  renderStudyExercise();toast('Prática personalizada. Sua tarefa guiada continua salva em Meu estudo.');
}
async function practiceStudyExercise(exercise){
  if(!current||free||!exercise||!Number.isFinite(exercise.start)||!Number.isFinite(exercise.end)||exercise.start<0||exercise.end<=exercise.start||exercise.end>current.duration+1e-5)throw new Error('O exercício não possui um trecho válido nesta música.');
  stopPhrasePreview();saveSession();pause();clearStudyExercise();
  $('#mode').value=['listen','melody','rhythm','recital'].includes(exercise.mode)?exercise.mode:'melody';
  $('#hands').value=['both','left','right'].includes(exercise.hands)?exercise.hands:'both';
  $('#mode').dispatchEvent(new Event('change'));
  speed=mode==='recital'?1:Math.max(.2,Math.min(1.5,Number(exercise.speed)||.6));$('#speed').value=Math.round(speed*100);$('#speed-value').textContent=`${Math.round(speed*100)}%`;
  transpose=0;$('#transpose').value='0';
  activeStudyExercise={...exercise,rewardRun:rewardRun(),repeatCount:Math.max(1,Math.min(20,Math.round(exercise.repeatCount)||3)),remaining:Math.max(1,Math.min(20,Math.round(exercise.repeatCount)||3))};
  activePhraseId=current.phrasing?.phrases.find(p=>p.id===exercise.phraseId&&Math.abs(p.start-exercise.start)<1e-5&&Math.abs(p.end-exercise.end)<1e-5)?.id||null;
  loopA=exercise.start;loopB=exercise.end;loop=activeStudyExercise.repeatCount>1;time=loopA;
  $('#loop').setAttribute('aria-pressed',String(loop));phrasePanel?.setActive(activePhraseId);
  renderStudyExercise();resetPlayback();resetSession();updateLoop();updateTransport();refreshNotation();
  await play();
}
function renderPracticeMission(){
  const element=$('#practice-mission');if(!element)return;
  element.hidden=free||!current;
  const exercise=activeStudyExercise;
  const modeName={listen:'Escuta',melody:'Melodia',rhythm:'Ritmo',recital:'Recital'}[mode],handName={left:'Mão esquerda',right:'Mão direita',both:'Duas mãos'}[hands];
  $('#mission-title').textContent=exercise?.title||'Prática livre da música';
  $('#mission-context').textContent=`${handName} · ${modeName} · ${Math.round(speed*100)}%${exercise?` · ${fmt(exercise.start)}–${fmt(exercise.end)}`:''}`;
  $('#mission-goal').textContent=exercise?.guided?`${Math.min(exercise.targetStreak||3,exercise.goalStreak||0)}/${exercise.targetStreak||3} execuções seguidas · meta ${exercise.targetAccuracy||90}% de precisão`:exercise?`${Math.max(0,exercise.remaining)}/${exercise.repeatCount} repetições restantes`:'Escolha seu próximo passo em Meu estudo';
  element.dataset.met=String(!!exercise?.goalMet);
}
async function applyStructure(plan){
  if(!current||free)throw new Error('Abra uma música para salvar a estrutura.');
  const normalized=normalizePhrasing({...plan,reviewed:true},current.duration);
  if(!normalized?.phrases.length)throw new Error('A estrutura não contém frases válidas.');
  stopPhrasePreview();saveSession();pause();const song=current,old=song.phrasing,oldActive=activePhraseId;
  song.phrasing=normalized;
  try{await setStored('songs',songs);}catch(error){song.phrasing=old;throw error;}
  if(current!==song)return normalized;
  clearStudyExercise();phrasePanel.setSong(song);studyPanel?.setSong(song);studyPanel?.setAnalysis(normalized);refreshStudyProgress();
  const selected=normalized.phrases.find(p=>p.id===oldActive);
  if(selected)configurePhrase(selected,{autoplay:false});else if(oldActive)exitPhrase();
  toast(`${normalized.phrases.length} frases e ${normalized.patterns?.length??0} famílias salvas nesta música.`);
  return normalized;
}
function configurePhrase(phrase,{autoplay=true}={}){
  if(!current||free)return;
  stopPhrasePreview();saveSession();pause();
  clearStudyExercise();
  if(mode==='listen'||mode==='recital'){$('#mode').value='melody';$('#mode').dispatchEvent(new Event('change'));}
  activePhraseId=phrase.id;loopA=phrase.start;loopB=phrase.end;loop=true;time=loopA;
  $('#loop').setAttribute('aria-pressed','true');resetPlayback();resetSession();updateLoop();updateTransport();phrasePanel?.setActive(activePhraseId);
  if(autoplay)play().catch(error=>toast(error.message));
}
function exitPhrase(){
  invalidateCompletion();
  if(!current||free)return;stopPhrasePreview();saveSession();pause();activePhraseId=null;loop=false;loopA=0;loopB=current.duration;time=0;
  clearStudyExercise();
  $('#loop').setAttribute('aria-pressed','false');resetPlayback();resetSession();updateLoop();updateTransport();phrasePanel?.setActive(null);
}
function clearPhraseSelection(){activePhraseId=null;clearStudyExercise();phrasePanel?.setActive(null);}
function stopPhrasePreview(){
  const saved=phrasePreview;if(!saved)return;phrasePreview=null;pause();
  ({time,mode,speed,loop,loopA,loopB,activePhraseId,activeStudyExercise}=saved);renderStudyExercise();resetPlayback();
  practice=saved.practice;elapsedPractice=saved.elapsedPractice;sessionSaved=saved.sessionSaved;sessionStart=saved.sessionStart;sessionSpeed=saved.sessionSpeed;sessionTranspose=saved.sessionTranspose;sessionFullArrangement=saved.sessionFullArrangement;
  $('#loop').setAttribute('aria-pressed',String(loop));updateScore();updateTransport();
}
async function previewPhrase(phrase){
  invalidateCompletion();
  stopPhrasePreview();if(!phrase||!current||free)return;
  pause();const saved={...phrase,time,mode,speed,loop,loopA,loopB,activePhraseId,activeStudyExercise,practice,elapsedPractice,sessionSaved,sessionStart,sessionSpeed,sessionTranspose,sessionFullArrangement};phrasePreview=saved;
  activeStudyExercise=null;renderStudyExercise();mode='listen';loop=false;activePhraseId=null;time=phrase.start;practice=new PracticeSession([]);elapsedPractice=0;sessionSaved=false;
  resetPlayback();updateTransport();
  try{await play({guard:()=>phrasePreview===saved});}catch(error){stopPhrasePreview();throw error;}
}
function scheduler(dt) {
  if(!current||!playing) return;
  if(cadence.active){const state=renderPreparation(performance.now());if(!state.active){resetPlayback();startPlaybackSounds(cadence.endAt);}return;}
  elapsedPractice+=dt;
  const end=phrasePreview?.end??((loop||rangeSelected())&&loopB>loopA?loopB:current.duration);
  let next=Math.min(end,time+dt*speed);
  next=practice.gate(next);
  const strict=mode==='melody'&&$('#strict-melody').checked&&wrongHeld.size>0;if(strict)next=time;
  const waiting=strict||(mode==='melody'&&practice.next()&&next===practice.next().time);
  $('#waiting').textContent=activeStudyExercise?.hideGuides?'Recupere o desenho da frase de memória':strict?'Solte as notas incorretas':waiting?'Toque: '+[...new Set(practice.notes.filter(n=>Math.abs(n.time-next)<.04&&!practice.hits.has(n.id)).map(n=>noteName(n.midi+transpose,settings.labels==='solfege')))].join(' + '):'Siga as notas no seu ritmo';
  $('#play-state').textContent=waiting?'Aguardando suas notas':'Em prática';
  time=next; practice.advance(time,performance.now());updateGuideNotes();
  while(nextEventIndex<playbackEvents.length&&playbackEvents[nextEventIndex].time<=time+.012&&playbackEvents[nextEventIndex].time<end)routeEvent(playbackEvents[nextEventIndex++]);
  for(const [id,n] of activePlayback) if(n.time+(n.keyDuration??n.duration)<=time){routeOff(n.midi+transpose,n.channel);activePlayback.delete(id);}
  while(nextNoteIndex<current.notes.length&&current.notes[nextNoteIndex].time<=time+.012&&current.notes[nextNoteIndex].time<end) {
    const note=current.notes[nextNoteIndex++];
    if(!audibleNote(note)||isPracticeNote(note,mode,hands,configs())||note.time+note.duration<time) continue;
    routeOn(note.midi+transpose,note.velocity*(config(note.track).volume??1),note.channel,config(note.track).program??currentPrograms.get(note.channel)??current.tracks.find(t=>t.id===note.track)?.program??0);
    activePlayback.set(note.id,note);
  }
  if(metronome) {
    const beatInfo=beatAt(time),beat=Math.floor(beatInfo.beat);
    if(beat!==lastBeat){audio.click(beat%beatInfo.numerator===0);lastBeat=beat;}
  }
  updateTransport();updateScore();
  if(time>=end) {
    if(phrasePreview){stopPhrasePreview();phrasePanel?.stopPreview();return;}
    practice.advance(end+.3,performance.now());
    const finalExercise=activeStudyExercise&&activeStudyExercise.remaining<=1;
    const taskSaved=finalExercise&&!activeStudyExercise.guided?finishStudyExercise():null;
    const completion={kind:finalExercise?'exercise':loop?'loop':activePhraseId?'phrase':'song',taskSaved};
    const row=saveSession(true,completion);
    if(activeStudyExercise){activeStudyExercise.remaining--;renderStudyExercise();}
    if(finalExercise){
      pause();time=end;updateTransport();
      if(!row){
        const reward={song:structuredClone(current),profile:settings.profile,epoch:completionEpoch,mode,hands,speed,transpose,exercise:structuredClone({...activeStudyExercise,rewardRun:undefined})};
        const result={kind:'exercise',title:'Exercício concluído',songTitle:current.title,mode,hands,attemptId:activeStudyExercise.rewardRun?.id||uid(),reason:mode==='listen'?'Etapa de escuta concluída e marcada no plano. Os pontos são registrados quando você toca.':'Etapa concluída. Não há um resultado avaliável para conceder pontos.'};
        Promise.resolve(taskSaved).then(()=>showCompletion(result,reward)).catch(()=>{});
      }
      return;
    }
    if(loop){seek(loopA,{internal:true});startPreparation(true);}else{pause();time=end;updateTransport();if(mode==='listen')toast('Reprodução concluída.');}
  }
}
function beatAt(seconds) {
  let beat=0, previous=0, bpm=current?.tempo||120;
  for(const tempo of current?.tempos||[]){if(tempo.time>seconds)break;beat+=(tempo.time-previous)*bpm/60;previous=tempo.time;bpm=tempo.bpm;}
  beat+=(seconds-previous)*bpm/60;
  const signature=[...(current?.timeSignatures||[])].reverse().find(s=>s.time<=seconds);
  return {beat,bpm,numerator:signature?.numerator||4,denominator:signature?.denominator||4};
}
function inputOn(pitch,velocity=.8,channel=0,source='keyboard',receivedTime=performance.now()) {
  if(!Number.isInteger(pitch)||pitch<0||pitch>127)return;
  if(view!=='studio'&&view!=='free')return;
  if(playing&&cadence.active&&receivedTime>=cadence.endAt){renderPreparation(receivedTime);resetPlayback();startPlaybackSounds(cadence.endAt);lastClockTick=performance.now();}
  const id=`${source}:${channel}:${pitch}`;if(held.has(id))return;
  const state={pitch,velocity,channel,source,soundChannel:recording?recorder.channelFor(channel):channel};
  if(recording)recorder.noteOn(pitch,velocity,channel);
  held.set(id,state);ensureAudio().then(()=>{if(held.get(id)===state&&settings.monitorInput!==false){state.sounded=true;routeOn(pitch,velocity,state.soundChannel,currentPrograms.get(state.soundChannel)??(free?freeProgram:0));}}).catch(e=>toast(e.message));
  if(free){liveTrail.noteOn(id,pitch,velocity,channel,receivedTime);liveScore?.noteOn({key:id,midi:pitch,velocity,time:receivedTime/1000});}
  if(playing&&!cadence.active&&receivedTime>=evaluationAt&&mode!=='listen') {
    const expected=practice.expectedNotes();
    practice.input(pitch,time,transpose,receivedTime,id);
    const result=practice.lastResult;
    state.scoreNoteIds=(result?.status==='accepted'?result.notes:result?.status==='pending'?expected:[]).filter(n=>n.midi+transpose===pitch).map(n=>n.id);
    if(result?.status==='rejected')wrongHeld.add(id);
    else if(result?.status==='accepted'){
      for(const [key,n] of held)if(result.notes?.some(expected=>expected.midi+transpose===n.pitch))wrongHeld.delete(key);
    }
    updateScore();updateGuideNotes();maybeResetLoop();
  }
  if(!free)notation?.inputOn?.({midi:pitch,time,key:id,noteIds:state.scoreNoteIds});
  if(held.has(id))keys.get(pitch)?.classList.add('down');detectChord();
}
function inputOff(pitch,channel=0,source='keyboard',receivedTime=performance.now()) {
  const id=`${source}:${channel}:${pitch}`,state=held.get(id);if(!state)return;
  liveTrail.noteOff(id,receivedTime);notation?.inputOff?.(id);
  if(free)liveScore?.noteOff(id,receivedTime/1000);
  wrongHeld.delete(id);
  if(playing&&!cadence.active&&receivedTime>=evaluationAt&&mode!=='listen'){practice.release(pitch,time,transpose,receivedTime,id,{sustain:(channel===0&&sustain)||inputPedals.has(channel),pedalKey:`channel:${channel}`});updateScore();}
  held.delete(id);if(state.sounded)routeOff(pitch,state.soundChannel);
  if(recording)recorder.noteOff(pitch,channel);
  if(![...held.values()].some(n=>n.pitch===pitch))keys.get(pitch)?.classList.remove('down');
  detectChord();updateGuideNotes();maybeResetLoop();
}
function updateGuideNotes(){
  if(!instrument?.guides.connected||instrument.guides.testing)return;
  if(!playing||cadence.active||free||!current||activeStudyExercise?.hideGuides){instrument.guides.allOff();return;}
  let notes;
  if(mode==='listen')notes=current.notes.filter(n=>visibleNote(n)&&n.time<=time+1e-7&&n.time+(n.keyDuration??n.duration)>time);
  else if(mode==='melody'){
    const expected=practice.next();
    notes=expected&&expected.time<=time+1e-7?practice.expectedNotes():[];
  }else notes=practice.notes.filter(n=>!practice.hits.has(n.id)&&!practice.missed.has(n.id)&&n.time>=time-.25&&n.time<=time+1e-7);
  instrument.guides.update(notes.map(n=>n.midi+transpose-(Number(settings.inputOctave)||0)*12));
}
function detectChord() {
  const pitches=[...new Set([...held.values()].map(n=>n.pitch%12))].sort((a,b)=>a-b);
  if(!pitches.length){$('#chord').textContent='Toque para descobrir um acorde';return;}
  const patterns=[['',[0,4,7]],['m',[0,3,7]],['7',[0,4,7,10]],['maj7',[0,4,7,11]],['m7',[0,3,7,10]],['dim',[0,3,6]],['aug',[0,4,8]],['sus2',[0,2,7]],['sus4',[0,5,7]]];
  for(const root of pitches) for(const [suffix,pattern] of patterns) if(pattern.length===pitches.length&&pattern.every(p=>pitches.includes((p+root)%12))) {
    const tonic=Number($('#tonic').value),degrees=['I','♭II','II','♭III','III','IV','♯IV','V','♭VI','VI','♭VII','VII'];
    $('#chord').textContent=`${noteName(root+60).replace(/-?\d+$/,'')}${suffix} · ${degrees[(root-tonic+12)%12]}${suffix} em ${noteName(tonic+60).replace(/\d+$/,'')}`;return;
  }
  $('#chord').textContent=pitches.map(p=>noteName(p+60,settings.labels==='solfege').replace(/\d+$/,'')).join(' · ');
}
function buildKeyboard() {
  let count=Number(settings.keys)||61,min=count===88?21:count===49?48:36,max=min+count-1;
  if(settings.keys==='auto'&&current?.notes.length){let lowest=127,highest=0;for(const n of current.notes){lowest=Math.min(lowest,n.midi+transpose);highest=Math.max(highest,n.midi+transpose);}min=Math.max(0,Math.floor(lowest/12)*12);max=Math.min(127,Math.ceil((highest+1)/12)*12);}
  if(settings.keys==='custom'){const low=Number(settings.minKey),high=Number(settings.maxKey);min=Math.max(0,Math.min(126,Number.isFinite(low)?low:36));max=Math.max(min+1,Math.min(127,Number.isFinite(high)?high:96));}
  count=max-min+1;
  const isBlack=n=>[1,3,6,8,10].includes(n%12);
  const whites=Array.from({length:count},(_,i)=>i+min).filter(n=>!isBlack(n));
  const width=100/whites.length;keys.clear();keyGeometry.clear();$('#keyboard').innerHTML='';
  let whiteIndex=0;
  for(let note=min;note<=max;note++) {
    const black=isBlack(note),left=black?(whiteIndex-.31)*width:whiteIndex*width,w=width*(black?.62:1);
    if(!black)whiteIndex++;
    const key=document.createElement('button');key.className=`piano-key${black?' black':''}`;key.style.left=`${left}%`;key.style.width=`${w}%`;key.setAttribute('aria-label',noteName(note));key.dataset.midi=note;
    const label=document.createElement('span');label.className='key-label';label.textContent=labelFor(note);key.append(label);
    key.onpointerdown=event=>{event.preventDefault();key.setPointerCapture(event.pointerId);inputOn(note,.8,0,'pointer');};
    key.onpointerup=key.onpointercancel=()=>inputOff(note,0,'pointer');
    $('#keyboard').append(key);keys.set(note,key);keyGeometry.set(note,{left,width:w,black});
  }
}
function resizeCanvas() {
  const c=$('#roll'),rect=c.getBoundingClientRect();if(rect.width){c.width=Math.round(rect.width*devicePixelRatio);c.height=Math.round(rect.height*devicePixelRatio);}notation?.resize();liveScore?.resize();
}
function drawRoll() {
  const canvas=$('#roll'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;if(!w)return;
  const ratio=devicePixelRatio;ctx.clearRect(0,0,w,h);ctx.fillStyle=rollPalette.bg;ctx.fillRect(0,0,w,h);
  for(const [note,g] of keyGeometry) {if(g.black)continue;ctx.fillStyle=rollPalette.grid;ctx.fillRect(g.left*w/100,0,ratio,h);}
  if(free){drawFreeTrail(ctx,w,h,ratio);return;}
  if(activeStudyExercise?.hideGuides)return;
  const look=Number(settings.lookahead);
  const bpm=beatAt(time).bpm;
  const step=60/bpm;
  for(let s=Math.floor(time/step)*step;s<time+look;s+=step){const y=h-(s-time)/look*h;ctx.strokeStyle=rollPalette.line;ctx.lineWidth=ratio;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  const notes=free?(recordSong?.notes||[]):current?.notes||[];
  for(const note of notes) {
    if(note.time>time+look||note.time+note.duration<time||!visibleNote(note))continue;
    const pitch=note.midi+(free?0:transpose),g=keyGeometry.get(pitch);if(!g)continue;
    const x=g.left*w/100+ratio,y=h-(note.time+note.duration-time)/look*h,nh=Math.max(5*ratio,note.duration/look*h-2*ratio),nw=g.width*w/100-2*ratio;
    ctx.fillStyle=practice.hits.has(note.id)?'#e7f9eb':noteColor(note);
    ctx.globalAlpha=isPracticeNote(note,mode,hands,configs())?1:.68;
    ctx.beginPath();ctx.roundRect(x,y,nw,nh,3*ratio);ctx.fill();ctx.globalAlpha=1;
    if(nw>12*ratio&&nh>20*ratio){ctx.fillStyle='#253a34';ctx.font=`${Math.max(8,Math.min(11,nw/ratio-2))*ratio}px Segoe UI`;ctx.textAlign='center';const label=labelFor(pitch);ctx.fillText(note.finger||(['letters','solfege'].includes(settings.labels)?label.replace(/\d+$/,''):label),x+nw/2,y+Math.min(nh-6*ratio,18*ratio));}
  }
  if(playing) {
    keys.forEach(k=>k.classList.remove('active-note','left-note'));
    for(const n of activePlayback.values()) keys.get(n.midi+transpose)?.classList.add(handOf(n,configs())==='left'?'left-note':'active-note');
  }
}
function drawFreeTrail(ctx,w,h,ratio){
  const windowSeconds=Math.max(2,Math.min(8,Number(settings.lookahead)||4));
  ctx.lineWidth=ratio;
  for(let age=1;age<windowSeconds;age++){const y=h-age/windowSeconds*h;ctx.strokeStyle=rollPalette.line;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  const notes=liveTrail.visible(performance.now(),windowSeconds);
  for(const note of notes){
    const g=keyGeometry.get(note.midi);if(!g)continue;
    const x=g.left*w/100+ratio,nw=Math.max(2*ratio,g.width*w/100-2*ratio),top=Math.max(-8*ratio,h-note.ageStart/windowSeconds*h),bottom=h-note.ageEnd/windowSeconds*h,nh=Math.max(6*ratio,bottom-top);
    ctx.fillStyle=note.midi<60?'#b4a0ee':'#a4dfb8';ctx.globalAlpha=.68+note.velocity*.32;
    ctx.beginPath();ctx.roundRect(x,top,nw,nh,4*ratio);ctx.fill();ctx.globalAlpha=1;
    if(nw>13*ratio&&nh>14*ratio){ctx.fillStyle='#20372d';ctx.font=`${Math.max(9,Math.min(14,nw/ratio-3))*ratio}px Segoe UI`;ctx.textAlign='center';ctx.fillText(labelFor(note.midi),x+nw/2,Math.min(bottom-4*ratio,Math.max(13*ratio,top+17*ratio)));}
  }
  const count=String(notes.length);if($('#roll').dataset.liveNotes!==count)$('#roll').dataset.liveNotes=count;
}
function drawSheet() {
  if($('#sheet').classList.contains('hidden'))return;
  notation?.setCursor(time);
}
async function refreshNotation() {
  if(!current||$('#sheet').classList.contains('hidden'))return;
  if(free){liveScore?.resize();return;}
  const revision=++notationRevision;$('#notation-status').textContent='Preparando partitura…';
  try{const controller=await renderScore($('#notation'),current,{transpose,configs:configs(),zoom:notationZoom});if(revision!==notationRevision){controller.dispose();return;}notation=controller;$('#notation-status').textContent=controller.source==='musicxml'?'MusicXML original':'MIDI · notação quantizada a semicolcheias';if(controller.warnings.length)toast(controller.warnings.join(' '));notation.setCursor(time);for(const [key,n]of held)notation.inputOn({midi:n.pitch,time,key,noteIds:n.scoreNoteIds});}catch(error){if(revision===notationRevision&&error.name!=='AbortError'){$('#notation-status').textContent='Partitura indisponível para este arquivo';toast(error.message);}}
}
function frame() {if(view==='studio'||view==='free'){drawRoll();drawSheet();}requestAnimationFrame(frame);}
const transportTimer=setInterval(()=>{const now=performance.now(),dt=Math.max(0,(now-lastClockTick)/1000);lastClockTick=now;if(playing)scheduler(dt);if(recording)recordBacking(now);},16);
function recordBacking(now) {
  if(!backing)return;const elapsed=(now-recording.start)/1000;if(free)time=elapsed;
  while(backing.eventIndex<backing.events.length&&backing.events[backing.eventIndex].time<=elapsed){const event=backing.events[backing.eventIndex++];if(event.type==='program')backing.programs.set(event.channel,event.value);routeEvent(event);}
  for(const [id,n] of backing.active)if(n.time+(n.keyDuration??n.duration)<=elapsed){routeOff(n.midi,n.channel);backing.active.delete(id);}
  while(backing.index<backing.notes.length&&backing.notes[backing.index].time<=elapsed){const n=backing.notes[backing.index++];if(n.time+n.duration<elapsed)continue;routeOn(n.midi,n.velocity,n.channel,backing.programs.get(n.channel)??0);backing.active.set(n.id,n);}
}
function renderTracks() {
  if(!current)return;
  $('#track-count').textContent=`· ${current.tracks.length}`;
  $('#tracks').innerHTML=current.tracks.map(track=>{
    const c=config(track.id);return `<div class="track" data-track="${track.id}"><input type="color" value="${c.color||'#a4dfb8'}" aria-label="Cor da pista"><span class="track-name">${escapeHtml(track.name||`Pista ${track.id+1}`)}</span><select class="track-hand" aria-label="Mão"><option value="">Automática</option><option value="right">Direita</option><option value="left">Esquerda</option></select><select class="track-role" aria-label="Participação"><option value="learn">Aprender</option><option value="auto">Acompanhar</option><option value="mute">Não participar</option></select><select class="track-program" aria-label="Instrumento">${instrumentOptions()}</select><label title="Mostrar notas"><input type="checkbox" class="track-visible" ${c.hidden?'':'checked'}>Ver</label><label title="Ouvir pista"><input type="checkbox" class="track-audible" ${c.muted?'':'checked'}>Som</label><input class="track-volume" type="range" min="0" max="100" value="${Math.round((c.volume??1)*100)}" aria-label="Volume da pista"></div>`;
  }).join('');
  $$('.track').forEach(el=>{
    const id=Number(el.dataset.track),c=config(id);el.querySelector('.track-hand').value=c.hand||'';el.querySelector('.track-role').value=c.role||'learn';el.querySelector('.track-program').value=c.program??current.tracks.find(t=>t.id===id)?.program??0;
    el.onchange=()=>{saveSession();const hand=el.querySelector('.track-hand').value||undefined;if(hand!==c.hand)current.notationEdited=true;current.configs[id]={hand,role:el.querySelector('.track-role').value,color:el.querySelector('input[type=color]').value,program:Number(el.querySelector('.track-program').value),hidden:!el.querySelector('.track-visible').checked,muted:!el.querySelector('.track-audible').checked,volume:Number(el.querySelector('.track-volume').value)/100};resetPlayback();resetSession();saveSongs();refreshNotation();};
  });
}
const gmNames={0:'Piano acústico',1:'Piano brilhante',2:'Piano elétrico',3:'Honky-tonk',4:'Rhodes',5:'Piano FM',6:'Cravo',7:'Clavinete',8:'Celesta',9:'Glockenspiel',10:'Caixa de música',11:'Vibrafone',12:'Marimba',13:'Xilofone',14:'Sinos',15:'Dulcimer',16:'Órgão',24:'Violão',32:'Baixo',40:'Violino',48:'Cordas',56:'Trompete',64:'Sax',72:'Flauta piccolo',73:'Flauta',80:'Sintetizador',88:'Pad',96:'Efeito',104:'Sitar',112:'Percussão',120:'Efeito sonoro'};
function instrumentOptions(){return Array.from({length:128},(_,i)=>`<option value="${i}">${i+1}. ${gmNames[i]||`GM ${i+1}`}</option>`).join('');}
async function importFiles(files,collection='') {
  stopPhrasePreview();saveSession();pause();await achievementWrite.catch(()=>{});await journeyWrite.catch(()=>{});invalidateCompletion();
  let imported=0,lastSong=null;const importWarnings=[];
  for(const file of files) try {
    const data=new Uint8Array(file.data??await file.arrayBuffer()),name=file.name.replace(/\.[^.]+$/,'');
    let song;
    if(/\.json$/i.test(file.name)) {
      const project=JSON.parse(new TextDecoder().decode(data));
      if(project.pianocraft===1){
        if(!Array.isArray(project.songs)||project.songs.length>2000)throw new Error('Projeto inválido.');
        const validated=project.songs.map(s=>({...normalizeSong(s),id:typeof s.id==='string'&&s.id?s.id.slice(0,200):uid(),configs:validateConfigs(s.configs),favorite:!!s.favorite,...libraryMetadata(s)}));
        for(const s of validated){const existing=songs.findIndex(x=>x.id===s.id);if(existing>=0)songs[existing]=s;else songs.push(s);}
        if(Array.isArray(project.history)) {const ids=new Set(history.map(h=>h.id));for(const raw of project.history.slice(0,1000)){const h=validateHistory(raw);if(h&&!ids.has(h.id)){history.push(h);ids.add(h.id);}}history=history.slice(0,1000);await persistHistory();}
        if(project.settings)applyProjectSettings(project.settings);
        if(project.studyProgress&&typeof project.studyProgress==='object'&&!Array.isArray(project.studyProgress)){
          const next={...studyProgress};
          for(const raw of Object.values(project.studyProgress).slice(0,1024)){
            if(!raw||typeof raw.profile!=='string'||typeof raw.songId!=='string')continue;
            const song=songs.find(s=>s.id===raw.songId),key=song?.phrasing?.revisionKey??song?.phrasing?.contentKey;
            if(!key||raw.analysisKey!==key)continue;
            const context={analysisKey:key,songId:song.id,profile:raw.profile.slice(0,40)};
            next[studyProgressKey(context)]=normalizeStudyProgress(raw,context);
          }
          await setStored('study-progress',next);studyProgress=next;
        }
        if(project.achievementLedgers&&typeof project.achievementLedgers==='object'&&!Array.isArray(project.achievementLedgers)){
          const next={...achievementLedgers};
          for(const raw of Object.values(project.achievementLedgers).slice(0,20000)){
            if(!raw||typeof raw.profile!=='string'||typeof raw.songId!=='string'||raw.profile.length>40)continue;
            const song=songs.find(s=>s.id===raw.songId);if(!song||raw.contentKey!==achievementContentKey(song))continue;
            const key=JSON.stringify([raw.profile,song.id,raw.contentKey]);
            next[key]=mergeAchievementLedgers(song,[next[key],raw],{profile:raw.profile});
          }
          await setStored('achievement-ledgers',next);achievementLedgers=next;
        }
        if(project.learningJourneys&&typeof project.learningJourneys==='object'&&!Array.isArray(project.learningJourneys)){
          const next={...journeyStates};
          for(const raw of Object.values(project.learningJourneys).slice(0,20000)){
            if(!raw||raw.version!==1||typeof raw.profile!=='string'||raw.profile.length>40||typeof raw.songId!=='string')continue;
            const song=songs.find(s=>s.id===raw.songId);if(!song||raw.contentKey!==achievementContentKey(song))continue;
            const valid=normalizeJourneyState(raw,song,{profile:raw.profile});
            if(raw.profile!==valid.profile||raw.task?.id!==valid.task?.id||raw.task?.contentKey!==valid.contentKey||!Number.isFinite(raw.task?.start)||!Number.isFinite(raw.task?.end)||raw.task.start<0||raw.task.end>song.duration||raw.task.end<=raw.task.start||['mode','hands','speed','start','end'].some(field=>raw.task[field]!==valid.task?.[field]))continue;
            const key=journeyKey(song,raw.profile),previous=next[key];
            if(!previous||(Date.parse(valid.updatedAt||valid.startedAt)||0)>=(Date.parse(previous.updatedAt||previous.startedAt)||0))next[key]=valid;
          }
          await setStored('learning-journeys',next);journeyStates=next;
        }
        initializedAchievementKeys.clear();
        lastSong=validated.at(-1)||lastSong;imported+=validated.length;continue;
      }
      song={...normalizeSong(project),...libraryMetadata(project)};
    }else {song=await parseMusicFile(data,file.name);if(song.warnings?.length)importWarnings.push(...song.warnings);}
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(n=>n.toString(16).padStart(2,'0')).join('');
    const existing=songs.find(s=>s.sourceHash===hash);if(existing){lastSong=existing;continue;}
    song.id=uid();song.configs=validateConfigs(song.configs);song.sourceHash=hash;song.collection=collection;songs.push(song);lastSong=song;imported++;
  }catch(error){toast(`${file.name}: ${error.message}`);}
  if(current&&!free){const replacement=songs.find(song=>song.id===current.id);if(replacement&&replacement!==current){if(view==='song'||view==='studio')openSongHub(replacement);else{current=replacement;time=0;elapsedPractice=0;sessionSaved=true;clearStudyExercise();}}}
  saveSongs();renderLibrary();renderCollections();if(imported)toast(`${imported} música(s) adicionada(s) à biblioteca.${importWarnings.length?' '+[...new Set(importWarnings)].slice(0,3).join(' '):''}`);
  return lastSong;
}
function applyProjectSettings(value){
  if(!value||typeof value!=='object')return;
  pause();saveSession();invalidateCompletion();
  if(typeof value.profile==='string')settings.profile=value.profile.trim().slice(0,40)||'Meu perfil';
  if(Number.isFinite(value.volume))settings.volume=Math.max(0,Math.min(100,value.volume));
  if([49,61,88,'auto','custom'].includes(value.keys))settings.keys=value.keys;
  if(['letters','solfege','none','degrees','movable','keyboard'].includes(value.labels))settings.labels=value.labels;
  if(Number.isFinite(value.lookahead))settings.lookahead=Math.max(2,Math.min(8,value.lookahead));
  if(Number.isInteger(value.inputOctave))settings.inputOctave=Math.max(-4,Math.min(4,value.inputOctave));
  if(typeof value.monitorInput==='boolean')settings.monitorInput=value.monitorInput;
  if(typeof value.focusMode==='boolean')settings.focusMode=value.focusMode;
  if(typeof value.celebrationSound==='boolean')settings.celebrationSound=value.celebrationSound;
  if([80,120,180].includes(value.chordWindowMs))settings.chordWindowMs=value.chordWindowMs;
  if(['dark','light','system'].includes(value.theme)){settings.theme=value.theme;themeController?.setTheme(value.theme);}
  if([0,1,2].includes(value.practiceCountInBars))settings.practiceCountInBars=value.practiceCountInBars;
  if([0,.5,1,2,3].includes(value.practiceRestSeconds))settings.practiceRestSeconds=value.practiceRestSeconds;
  if($('#practice-count-in'))$('#practice-count-in').value=String(settings.practiceCountInBars);if($('#practice-rest'))$('#practice-rest').value=String(settings.practiceRestSeconds);
  if(Number.isFinite(value.minKey))settings.minKey=Math.max(0,Math.min(126,Math.round(value.minKey)));
  if(Number.isFinite(value.maxKey))settings.maxKey=Math.max(1,Math.min(127,Math.round(value.maxKey)));
  const validCode=code=>/^(Key[A-Z]|Digit\d|F\d{1,2}|Space|Enter|Tab|Backspace|Semicolon|Quote|Comma|Period|Slash|Backslash|BracketLeft|BracketRight|Minus|Equal|Arrow(Up|Down|Left|Right)|Numpad\w+)$/.test(code);
  if(value.keyMap&&typeof value.keyMap==='object'){const entries=Object.entries(value.keyMap).slice(0,128).filter(([code,n])=>validCode(code)&&Number.isInteger(n)&&n>=0&&n<=16);if(entries.length)settings.keyMap=Object.fromEntries(entries);}
  if(typeof value.playKey==='string'&&validCode(value.playKey))settings.playKey=value.playKey;
  $('#profile').value=settings.profile;$('#volume').value=settings.volume;$('#key-range').value=settings.keys;$('#labels').value=settings.labels;$('#lookahead').value=settings.lookahead;$('#input-octave').value=settings.inputOctave||0;$('#range-min').value=settings.minKey??36;$('#range-max').value=settings.maxKey??96;
  $('#input-monitor').checked=settings.monitorInput!==false;
  $('#celebration-sound').checked=settings.celebrationSound!==false;
  audio.setVolume(settings.volume/100);soundfont?.setVolume(settings.volume/100);saveSettings();buildKeyboard();renderShortcuts();resetSession();applyFocusMode();refreshStudyProgress();refreshAchievements();
}
function validateConfigs(value) {
  const result={};if(!value||typeof value!=='object')return result;
  for(const [id,c] of Object.entries(value)){if(!/^\d+$/.test(id)||!c||typeof c!=='object')continue;result[id]={role:['learn','auto','mute'].includes(c.role)?c.role:'learn',hand:['left','right'].includes(c.hand)?c.hand:undefined,program:Number.isInteger(c.program)&&c.program>=0&&c.program<=127?c.program:0,color:/^#[a-f\d]{6}$/i.test(c.color)?c.color:'#a4dfb8',hidden:c.hidden===true,muted:c.muted===true,volume:Number.isFinite(c.volume)?Math.min(1,Math.max(0,c.volume)):1};}
  return result;
}
function validateHistory(h) {
  if(!h||typeof h.id!=='string'||typeof h.title!=='string'||typeof h.profile!=='string'||!Number.isFinite(h.seconds)||h.seconds<0||!Number.isFinite(new Date(h.date).getTime()))return null;
  const row={id:h.id.slice(0,200),songId:typeof h.songId==='string'?h.songId.slice(0,200):undefined,title:h.title.slice(0,300),profile:h.profile.slice(0,40),seconds:Math.min(864000,h.seconds),date:new Date(h.date).toISOString(),mode:['melody','rhythm','recital'].includes(h.mode)?h.mode:'rhythm',hands:['both','left','right'].includes(h.hands)?h.hands:'both',completed:h.completed===true,accuracy:Number.isFinite(h.accuracy)?Math.max(0,Math.min(100,Math.round(h.accuracy))):null,hits:Math.max(0,Number(h.hits)||0),errors:Math.max(0,Number(h.errors)||0),missed:Math.max(0,Number(h.missed)||0)};
  if(typeof h.phraseId==='string'&&typeof h.phraseName==='string'&&Number.isFinite(h.phraseStart)&&Number.isFinite(h.phraseEnd)&&h.phraseStart>=0&&h.phraseEnd>h.phraseStart)Object.assign(row,{phraseId:h.phraseId.slice(0,80),phraseName:h.phraseName.slice(0,100),phraseStart:h.phraseStart,phraseEnd:h.phraseEnd});
  for(const key of ['analysisKey','patternId','exerciseId','songContentKey','journeyTaskId'])if(typeof h[key]==='string')row[key]=h[key].slice(0,180);
  if(Number.isFinite(h.speed)&&h.speed>=.2&&h.speed<=2)row.speed=h.speed;
  if(Number.isInteger(h.transpose)&&Math.abs(h.transpose)<=48)row.transpose=h.transpose;
  row.fullArrangement=h.fullArrangement===true;
  if(typeof h.scopeComplete==='boolean')row.scopeComplete=h.scopeComplete;
  if(Number.isFinite(h.start)&&Number.isFinite(h.end)&&h.start>=0&&h.end>h.start){row.start=h.start;row.end=h.end;}
  if(Number.isFinite(h.expectedNotes)&&h.expectedNotes>=0)row.expectedNotes=Math.min(1000000,Math.round(h.expectedNotes));
  for(const key of ['practiceSessionId','attemptId'])if(typeof h[key]==='string')row[key]=h[key].slice(0,200);
  if(Number.isFinite(h.position)&&h.position>=0)row.position=h.position;
  row.errorEvents=normalizeErrorEvents(h.errorEvents);row.errorEventsDropped=Math.max(0,Math.min(1000000,Number(h.errorEventsDropped)||0));
  return row;
}
async function exportBytes(name,bytes,kind='midi') {
  try{if(window.desktop){if(await window.desktop.saveFile(name,bytes,kind))toast('Arquivo salvo.');}else{const url=URL.createObjectURL(new Blob([bytes]));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),500);}}catch(e){toast(e.message);}
}
function renderProgress() {
  $('#progress-summary').replaceChildren();$('#progress-summary').hidden=true;
  $('#history').replaceChildren();$('#history').hidden=true;$('#progress-chart')?.remove();
  progressPanel?.setData(songs,history,{profile:settings.profile});
}
function showEditor() {
  if(!current)return;pause();pendingSplit=null;
  $('#note-list').innerHTML=current.notes.slice(0,1500).map(n=>`<div class="note-row" data-note="${escapeHtml(n.id)}"><span>${fmt(n.time)} · ${escapeHtml(noteName(n.midi))}</span><select aria-label="Mão"><option value="">Automática</option><option value="left">Esquerda</option><option value="right">Direita</option></select><label>Dedo <input type="number" min="1" max="5" value="${n.finger||''}" aria-label="Dedo"></label></div>`).join('');
  $$('.note-row').forEach(el=>el.querySelector('select').value=current.notes.find(n=>String(n.id)===el.dataset.note)?.hand||'');
  if(current.notes.length>1500)toast('O editor mostra as primeiras 1.500 notas. As demais continuam na música.');
  $('#note-editor').showModal();
}
async function startRecord() {
  if(recording){stopRecord();return;}
  pause();silence();
  try{
    await ensureAudio();
    const previous=recorder.song,selected=$('#record-track').value;
    const take=recorder.start({track:selected===''?undefined:Number(selected),program:freeProgram,clock:()=>performance.now()});
    if(midi.outputId)midi.sendProgram(take.program,take.channel);
    recording={...take,start:performance.now()};
    if(free){liveScore?.startRecording({...previous,notes:previous.notes.filter(n=>n.track!==take.track)},{time:recording.start/1000});if(freeMetronome?.running)startFreeMetronome();}
    $('#drum-bpm').disabled=true;$('#free-meter').disabled=true;
    backing={notes:previous.notes.filter(n=>n.track!==take.track),events:(previous.events||[]).filter(e=>e.track!==take.track),index:0,eventIndex:0,active:new Map(),programs:new Map(previous.tracks.map(t=>[t.channel,t.program]))};
    $('#record').classList.add('recording');$('#record').textContent=`■ Parar · pista ${take.track+1}`;$('#record-track').disabled=true;toast('Gravando com as pistas anteriores como acompanhamento.');
  }catch(error){toast(error.message);}
}
function stopRecord() {
  if(!recording)return;
  for(const n of [...held.values()]) inputOff(n.pitch,n.channel,n.source);
  recordSong=recorder.stop();recording=null;backing=null;silence();time=0;persistDraft();renderRecorder();
  if(free)liveScore?.setSong(recordSong);
  $('#drum-bpm').disabled=false;$('#free-meter').disabled=false;
  $('#record').classList.remove('recording');$('#record').textContent='● Gravar';$('#record-track').disabled=false;
  toast('Gravação preservada. Salve na biblioteca para estudar ou exportar.');
}
function persistDraft(){return setStored('recording-draft',recorder.song).catch(()=>toast('Não foi possível salvar o rascunho da gravação.'));}
function renderRecorder(){recordSong=recorder.song;recordTrack=recordSong.tracks.length;$('#save-recording').disabled=!recordSong.notes.length;$('#record-info').textContent=`${recordTrack}/6 pistas · ${recordSong.notes.length} notas`;$('#record-track').innerHTML='<option value="">Nova pista</option>'+recordSong.tracks.map(t=>`<option value="${t.id}">Regravar ${t.id+1}</option>`).join('');$('#record-takes').innerHTML=recordSong.tracks.map(t=>`<button data-delete-take="${t.id}" title="Excluir somente esta pista">Pista ${t.id+1} · remover ×</button>`).join('');$$('[data-delete-take]').forEach(el=>el.onclick=()=>{if(recording)stopRecord();recorder.deleteTrack(Number(el.dataset.deleteTake));if(free)liveScore?.setSong(recorder.song);persistDraft();renderRecorder();});}
function refreshDevices() {
  const lostInput=hadMidiInput&&!midi.connected;hadMidiInput=midi.connected;
  instrument?.refresh();
  if(lostInput&&playing&&mode!=='listen'){pause();toast('Teclado MIDI desconectado. A prática foi pausada para preservar a avaliação.');}
}
instrument=new InstrumentControls({midi,settings,saveSettings,beforeChange:()=>pause(),toast});
themeController=initTheme({theme:settings.theme,onChange:theme=>{settings.theme=theme;saveSettings();}});
function refreshRollPalette(){const style=getComputedStyle(document.documentElement);for(const key of ['bg','grid','line','text'])rollPalette[key]=style.getPropertyValue(`--roll-${key}`).trim()||rollPalette[key];}
document.addEventListener('pianocraft-theme-change',refreshRollPalette);refreshRollPalette();
liveScore=new LiveScore({host:$('#live-notation'),bpm:settings.freeBpm,beatsPerBar:settings.freeNumerator,onClear:()=>$('#clear-live-score')?.click()});
achievementPanel=new AchievementPanel({host:$('#achievements-host'),onPractice:practiceAchievementPath,onError:error=>toast(error.message)});
songHub=new SongHub({host:$('#song-hub-host'),onStart:startGuidedTask,onPath:practiceAchievementPath,onReview:({songId})=>{const song=songs.find(s=>s.id===songId);if(!song)return;if(!song.phrasing?.patterns?.length){song.phrasing={...analyzePatterns(song,{phrases:song.phrasing?.phrases}),reviewed:false};saveSongs();}loadSong(song);studyPanel.open();},onManual:({songId})=>{const song=songs.find(s=>s.id===songId);if(song){loadSong(song);$('#practice-tools').open=true;}},onError:error=>toast(error.message)});
completionNotice=new CompletionNotice({onProgress:()=>{const id=lastCompletion?.reward.song.id;setView('progress');progressPanel?.focusSong(id);},onReplay:replayCompletion,onContinue:continueLearning,onError:error=>toast(error.message)});
progressPanel=new ProgressPanel({host:$('#music-progress'),getLearningProgress:learningProgress,getAchievements:(song,profile)=>achievementState(song,profile).summary,onPracticePath:practiceAchievementPath,onOpenSong:id=>{const song=songs.find(s=>s.id===id);if(song)openSongHub(song);},onPractice:range=>{
  const song=songs.find(s=>s.id===range.songId);if(!song)return;loadSong(song);configurePhrase({id:`hotspot-${range.start}`,name:'Trecho para revisar',start:range.start,end:range.end});
},onError:error=>toast(error.message)});
phrasePanel=new PhrasePanel({
  host:$('#phrases-host'),getTime:()=>time,onOpen:()=>pause(),
  onApply:applyStructure,
  onPractice:phrase=>configurePhrase(phrase),onExit:exitPhrase,onPreview:previewPhrase,onError:error=>toast(error.message),
});
studyPanel=new StudyPanel({
  host:$('#study-host'),getTime:()=>time,getHistory:()=>history,getProfile:()=>settings.profile,
  onOpen:()=>pause(),onAnalyze:options=>analyzePatterns(current,options),onApply:applyStructure,
  onPractice:practiceStudyExercise,onPreview:previewPhrase,onEditBoundaries:()=>phrasePanel.open(),
  onSaveProgress:async progress=>{
    if(!current?.phrasing?.patterns?.length)throw new Error('Salve a estrutura antes de registrar o estudo.');
    await persistStudyProgress(progress);
  },onError:error=>toast(error.message),
});
$('#study-exercise-exit').onclick=()=>openSongHub(current);
$('#back-to-song').onclick=()=>openSongHub(current);

// Controls are bound once; imported file contents are always rendered as text.
const freeTools=document.createElement('div');freeTools.id='free-tools';freeTools.className='practice-bar hidden';freeTools.style.marginBottom='16px';freeTools.innerHTML=`<label>Instrumento<select id="free-instrument">${instrumentOptions()}</select></label><label>Tonalidade (maior)<select id="tonic">${Array.from({length:12},(_,i)=>`<option value="${i}">${noteName(i+60).replace(/\d+$/,'')}</option>`).join('')}</select></label><label>Gravar em<select id="record-track"><option value="">Nova pista</option></select></label><label>Quantizar ao salvar<select id="record-grid"><option value="0">Desligado</option><option value="1">Semínima</option><option value="2">Colcheia</option><option value="4">Semicolcheia</option></select></label><span class="hint" id="record-info">0/6 pistas</span><button id="new-recording">Nova gravação</button>`;$('.practice-bar').after(freeTools);
const recordTakes=document.createElement('div');recordTakes.id='record-takes';recordTakes.className='hidden';freeTools.after(recordTakes);renderRecorder();
const beatTools=document.createElement('div');beatTools.id='beat-tools';beatTools.className='practice-extras hidden';beatTools.innerHTML=`<label>Acompanhamento <select id="drum-pattern"><option value="off">Desligado</option>${drumPatterns.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}</select></label><label>Andamento <input id="drum-bpm" type="number" min="30" max="240" value="120" style="width:60px"> BPM</label><label>Volume <input id="drum-volume" type="range" min="0" max="100" value="30"></label>`;recordTakes.after(beatTools);
const freePulse=document.createElement('div');freePulse.className='free-pulse-controls';freePulse.innerHTML='<button id="free-metronome" type="button" aria-pressed="false">♩ Metrônomo</button><label>Compasso <select id="free-meter"><option value="4/4">4/4</option><option value="3/4">3/4</option><option value="6/8">6/8</option><option value="2/4">2/4</option></select></label><span id="free-beat" aria-live="off">—</span><button id="clear-live-score" type="button">Limpar pauta ao vivo</button>';
beatTools.prepend(freePulse);$('#drum-bpm').value=recordSong?.notes.length?recordSong.tempo:settings.freeBpm;
$('#free-meter').value=`${settings.freeNumerator}/${settings.freeDenominator}`;
function startFreeMetronome(){freeMetronome||=new PulseMetronome({audio,onBeat:beat=>{$('#free-beat').textContent=`${beat.beat}/${beat.numerator}`;$('#free-metronome').dataset.beat=beat.beat;}});const [numerator,denominator]=$('#free-meter').value.split('/').map(Number);freeMetronome.start({bpm:Number($('#drum-bpm').value),numerator,denominator});$('#free-metronome').setAttribute('aria-pressed','true');}
$('#free-metronome').onclick=async()=>{if(freeMetronome?.running){freeMetronome.stop();$('#free-metronome').setAttribute('aria-pressed','false');$('#free-beat').textContent='—';return;}try{await audio.init();if(view==='free')startFreeMetronome();}catch(error){toast(error.message);}};
function updateFreeTempo(){
  const [numerator,denominator]=$('#free-meter').value.split('/').map(Number),bpm=Math.max(30,Math.min(240,Number($('#drum-bpm').value)||120));
  settings.freeBpm=bpm;settings.freeNumerator=numerator;settings.freeDenominator=denominator;saveSettings();liveScore?.setTempo(bpm);liveScore?.setMeter(numerator,denominator);
  if(freeMetronome?.running)startFreeMetronome();
  if(!recording){const song=recorder.song;song.tempo=bpm;song.tempos=[{time:0,bpm}];song.timeSignatures=[{time:0,numerator,denominator}];recorder.restore(song);persistDraft();}
}
$('#free-meter').onchange=updateFreeTempo;
$('#clear-live-score').onclick=()=>{liveScore?.clear();if(recording)liveScore?.startRecording(null,{time:recording.start/1000});toast('Pauta ao vivo limpa. As pistas gravadas continuam salvas.');};
$('#drum-pattern').onchange=async e=>{if(e.target.value==='off'){drums?.stop();return;}try{await audio.init();drums||=new DrumMachine({context:audio.context});await drums.start({bpm:Number($('#drum-bpm').value)||120,pattern:e.target.value,volume:Number($('#drum-volume').value)/100});}catch(error){toast(error.message);e.target.value='off';}};
$('#drum-bpm').onchange=e=>{const bpm=Math.max(30,Math.min(240,Number(e.target.value)||120));e.target.value=bpm;drums?.setTempo(bpm);updateFreeTempo();};
$('#drum-volume').oninput=e=>drums?.setVolume(Number(e.target.value)/100);
const practiceOptions=document.createElement('div');practiceOptions.id='practice-options';practiceOptions.className='practice-extras';practiceOptions.innerHTML='<label><input id="strict-melody" type="checkbox"> Melodia estrita</label><label>Reiniciar loop após <select id="error-reset"><option value="0">desligado</option><option value="1">1 erro</option><option value="3">3 erros</option><option value="5">5 erros</option></select></label><div><select id="marker-picker" aria-label="Marcadores"><option value="">Marcadores</option></select><button id="add-marker">＋ Marcar posição</button><button id="remove-marker" title="Remover marcador selecionado">×</button></div>';
$('.bottom-tools').after(practiceOptions);
const chordTolerance=document.createElement('label');chordTolerance.innerHTML='Simultaneidade do acorde <select id="chord-window"><option value="80">80 ms · rigorosa</option><option value="120">120 ms · padrão</option><option value="180">180 ms · iniciante</option></select>';practiceOptions.append(chordTolerance);$('#chord-window').value=String(settings.chordWindowMs);$('#chord-window').onchange=e=>{saveSession();pause();settings.chordWindowMs=Number(e.target.value);saveSettings();resetSession();};
const timingSettings=document.createElement('fieldset');timingSettings.id='practice-timing-settings';timingSettings.innerHTML='<legend>Preparação dos exercícios</legend><label>Contagem antes de tocar<select id="practice-count-in"><option value="0">Sem contagem</option><option value="1">1 compasso</option><option value="2">2 compassos</option></select></label><label>Pausa entre repetições<select id="practice-rest"><option value="0">Sem pausa</option><option value="0.5">0,5 segundo</option><option value="1">1 segundo</option><option value="2">2 segundos</option><option value="3">3 segundos</option></select></label><p class="hint">A contagem usa o compasso e o andamento do trecho. A avaliação fica pausada durante a preparação.</p>';$('#volume').closest('label').before(timingSettings);
$('#practice-count-in').value=String(settings.practiceCountInBars);$('#practice-rest').value=String(settings.practiceRestSeconds);
for(const selector of ['#practice-count-in','#practice-rest'])$(selector).onchange=()=>{pause();settings.practiceCountInBars=Number($('#practice-count-in').value);settings.practiceRestSeconds=Number($('#practice-rest').value);saveSettings();};
$('#score-strip>span:last-child').insertAdjacentHTML('beforeend',' <span class="divider">|</span> Erros <b id="errors">0</b> · Perdidas <b id="missed">0</b>');
const practiceFeedback=document.createElement('div');practiceFeedback.id='practice-feedback';practiceFeedback.setAttribute('role','status');$('#score-strip').after(practiceFeedback);
const markerDialog=document.createElement('dialog');markerDialog.id='marker-dialog';markerDialog.innerHTML='<form method="dialog"><div class="dialog-heading"><h2>Marcar posição</h2><button value="cancel">✕</button></div><label>Nome do trecho<input id="marker-name" maxlength="100" required></label><button id="save-marker" type="button" class="primary">Salvar marcador</button></form>';document.body.append(markerDialog);
function renderMarkers(){const list=current?.markers||[];$('#marker-picker').innerHTML='<option value="">Marcadores</option>'+list.map((m,i)=>`<option value="${i}">${fmt(m.time)} · ${escapeHtml(m.text)}</option>`).join('');}
$('#add-marker').onclick=()=>{if(!current||mode==='recital')return;$('#marker-name').value=`Trecho ${(current.markers?.length||0)+1}`;markerDialog.showModal();$('#marker-name').focus();};
$('#save-marker').onclick=()=>{const text=$('#marker-name').value.trim();if(!text||!current)return;current.markers||=[];current.markers.push({time,text});current.markers.sort((a,b)=>a.time-b.time);saveSongs();renderMarkers();markerDialog.close();};
$('#marker-picker').onchange=e=>{if(e.target.value!==''&&mode!=='recital')seek(current.markers[Number(e.target.value)].time);};
$('#remove-marker').onclick=()=>{const value=$('#marker-picker').value;if(value===''||!current)return;current.markers.splice(Number(value),1);saveSongs();renderMarkers();};
const bankTools=document.createElement('div');bankTools.innerHTML='<label>Som do instrumento<select id="synth-engine"><option value="internal">PianoCraft · síntese interna</option><option value="basic">PianoCraft Basic · banco de demonstração</option><option value="custom">Abrir SoundFont SF2 / SF3…</option></select></label><p class="hint" id="soundfont-status">Use seu próprio banco de sons para personalizar o piano.</p>';$('#volume').closest('label').before(bankTools);
const monitorSetting=document.createElement('label');monitorSetting.style.cssText='flex-direction:row;align-items:center';monitorSetting.innerHTML='<input id="input-monitor" type="checkbox"> Ouvir minhas teclas no aplicativo';bankTools.before(monitorSetting);$('#input-monitor').checked=settings.monitorInput!==false;$('#input-monitor').onchange=e=>{silence();settings.monitorInput=e.target.checked;saveSettings();};
if(pendingSoundfontBank){$('#synth-engine').value='custom';$('#soundfont-status').textContent=`${pendingSoundfontBank.name} · será carregado ao tocar`;} 
const importFolder=document.createElement('button');importFolder.textContent='＋ Importar pasta';importFolder.style.marginRight='8px';importFolder.onclick=async()=>{try{const folder=await window.desktop?.openFolder();if(!folder)return;await importFiles(folder.files,folder.name);if(folder.omitted)toast(`${folder.omitted} arquivo(s) excederam os limites desta importação (256 músicas / 128 MB).`);}catch(error){toast(error.message);}};$('#import').before(importFolder);
const importActions=document.createElement('div');importActions.style.cssText='display:flex;gap:8px;flex-shrink:0';importActions.append(importFolder,$('#import'));$('.heading-row').append(importActions);
const sortSelect=document.createElement('select');sortSelect.id='sort';sortSelect.setAttribute('aria-label','Ordenar músicas');sortSelect.innerHTML='<option value="title">Nome A–Z</option><option value="duration">Duração</option><option value="tempo">Andamento</option>';sortSelect.style.cssText='margin-left:auto;margin-right:12px;background:#1b232c;color:#9dabb8;border:1px solid #343f4b;border-radius:5px;padding:9px;font-size:10px';sortSelect.onchange=renderLibrary;$('#search').before(sortSelect);
sortSelect.insertAdjacentHTML('beforeend','<option value="recent">Última prática · mais recente</option><option value="count">Número de sessões</option><option value="progress">Progresso de estudo</option><option value="rating">Classificação</option><option value="difficulty">Dificuldade</option>');
const sortDirection=document.createElement('button');sortDirection.id='sort-direction';sortDirection.textContent='↑';sortDirection.title='Inverter ordem';sortDirection.dataset.desc='false';sortDirection.style.marginRight='10px';sortDirection.onclick=()=>{const desc=sortDirection.dataset.desc!=='true';sortDirection.dataset.desc=desc;sortDirection.textContent=desc?'↓':'↑';renderLibrary();};$('#search').before(sortDirection);
function updateLibrarySort(){settings.librarySort=sortSelect.value;settings.librarySortReversed=sortDirection.dataset.desc==='true';sortDirection.textContent=['recent','count','progress'].includes(sortSelect.value)?(settings.librarySortReversed?'↑':'↓'):(settings.librarySortReversed?'↓':'↑');saveSettings();renderLibrary();}
if([...sortSelect.options].some(option=>option.value===settings.librarySort))sortSelect.value=settings.librarySort;
sortDirection.dataset.desc=String(settings.librarySortReversed===true);sortSelect.onchange=()=>{sortDirection.dataset.desc='false';updateLibrarySort();};sortDirection.onclick=()=>{sortDirection.dataset.desc=String(sortDirection.dataset.desc!=='true');updateLibrarySort();};
const collectionList=document.createElement('div');collectionList.id='collections';$('#favorites').after(collectionList);
function renderCollections(){const names=[...new Set(songs.map(s=>s.collection).filter(Boolean))];$('#collections').innerHTML=names.map(name=>`<button class="collection" style="display:block;width:100%" data-collection="${escapeHtml(name)}">▱ ${escapeHtml(name)}</button>`).join('');$$('[data-collection]').forEach(el=>el.onclick=()=>{folderFilter=el.dataset.collection;favoriteOnly=false;setView('library');});}
const infoButton=document.createElement('button');infoButton.textContent='Detalhes';$('.studio-actions').prepend(infoButton);
const infoDialog=document.createElement('dialog');infoDialog.innerHTML='<form method="dialog"><div class="dialog-heading"><h2>Sobre esta música</h2><button value="cancel">✕</button></div><label>Título<input id="info-title" maxlength="200"></label><label>Autor<input id="info-author" maxlength="200"></label><label>Coleção<input id="info-collection" maxlength="100"></label><label>Classificação<select id="info-rating"><option value="0">Sem classificação</option><option value="1">★</option><option value="2">★★</option><option value="3">★★★</option><option value="4">★★★★</option><option value="5">★★★★★</option></select></label><label>Dificuldade<select id="info-difficulty"><option value="1">1 · Iniciante</option><option value="2">2 · Básico</option><option value="3">3 · Intermediário</option><option value="4">4 · Avançado</option><option value="5">5 · Experiente</option></select></label><button type="button" id="save-info" class="primary">Salvar</button></form>';document.body.append(infoDialog);
infoButton.onclick=()=>{if(!current||free)return;$('#info-title').value=current.title;$('#info-author').value=current.author||'';$('#info-collection').value=current.collection||'';$('#info-rating').value=current.rating||0;$('#info-difficulty').value=current.difficulty||1;infoDialog.showModal();};
$('#save-info').onclick=()=>{const title=$('#info-title').value.trim();if(!title)return;current.title=title;current.author=$('#info-author').value.trim();current.collection=$('#info-collection').value.trim();current.rating=Number($('#info-rating').value);current.difficulty=Number($('#info-difficulty').value);$('#song-title').textContent=title;saveSongs();renderCollections();refreshNotation();infoDialog.close();};
const splitTools=document.createElement('div');splitTools.className='practice-extras';splitTools.innerHTML='<label>Dividir mãos a partir da nota MIDI <input id="hand-split" type="number" min="0" max="127" value="60" style="width:55px"></label><button id="split-hands">Aplicar em toda a música</button>';$('#note-list').before(splitTools);
$('#split-hands').onclick=()=>{if(!current)return;pendingSplit=Math.max(0,Math.min(127,$('#hand-split').value===''?60:Number($('#hand-split').value)));$$('.note-row').forEach(el=>{const n=current.notes.find(n=>String(n.id)===el.dataset.note);el.querySelector('select').value=n.midi<pendingSplit?'left':'right';});toast('Mãos divididas. Clique em Salvar alterações para concluir.');};
$('#synth-engine').onchange=async e=>{
  try{if(e.target.value==='internal'){silence();soundfont?.dispose();soundfont=null;pendingSoundfontBank=null;setStored('soundfont-bank',null).catch(()=>{});$('#soundfont-status').textContent='PianoCraft · síntese interna';}
  else if(window.desktop){const bank=e.target.value==='basic'?await window.desktop.basicSoundFont():await window.desktop.openSoundFont();if(bank)await loadSoundFont(bank);else e.target.value=soundfont?'custom':'internal';}
  else toast('SoundFont está disponível no aplicativo desktop.');}catch(error){toast(error.message);}
};
for(let i=-12;i<=12;i++)$('#transpose').add(new Option(i===0?'Original':`${i>0?'+':''}${i} semitons`,i));$('#transpose').value=0;
$$('.nav').forEach(button=>button.onclick=()=>{
  const name=button.dataset.view;
  if(name==='free'){loadSong({id:'free',title:'Piano livre',notes:[],tracks:[],duration:0,tempo:120},true);return;}
  if(name==='studio'){openSongHub(current&&!free?current:songs[0]);return;}
  setView(name);
});
$('#import').onclick=async()=>{try{if(window.desktop)await importFiles(await window.desktop.openMusic());else $('#file-input').click();}catch(e){toast(e.message);}};
$('#file-input').onchange=e=>importFiles([...e.target.files]);
$('#search').oninput=renderLibrary;
$('#all-songs').onclick=$('#tab-all').onclick=()=>{favoriteOnly=false;folderFilter='';setView('library');};
$('#favorites').onclick=()=>{favoriteOnly=true;folderFilter='';setView('library');};
$('#hero-play').onclick=()=>openSongHub(songs[0]);
$('#play').onclick=()=>play().catch(e=>toast(e.message));
$('#restart').onclick=()=>seek(loop?loopA:0);
$('#timeline').oninput=e=>seek(Number(e.target.value)/1000*current.duration);
$('#speed').oninput=e=>{personalizePractice();speed=Number(e.target.value)/100;if(speed!==sessionSpeed)sessionSpeed=null;practice.setSpeed(speed,performance.now());$('#speed-value').textContent=`${e.target.value}%`;renderPracticeMission();};
$('#transpose').onchange=e=>{personalizePractice();transpose=Number(e.target.value);if(transpose!==sessionTranspose)sessionTranspose=null;resetPlayback();refreshNotation();};
for(const selector of ['mode','hands'])$(`#${selector}`).onchange=()=>{
  personalizePractice();
  saveSession();pause();invalidateCompletion();mode=$('#mode').value;hands=$('#hands').value;
  if(activeStudyExercise){activeStudyExercise.mode=mode;activeStudyExercise.hands=hands;activeStudyExercise.remaining=activeStudyExercise.repeatCount;activeStudyExercise.rewardRun=rewardRun();renderStudyExercise();}
  const recital=mode==='recital';$('#speed').disabled=recital;$('#timeline').disabled=recital;$('#loop').disabled=recital;$('#set-a').disabled=recital;$('#set-b').disabled=recital;
  if(recital){speed=1;$('#speed').value=100;$('#speed-value').textContent='100%';loop=false;$('#loop').setAttribute('aria-pressed','false');time=rangeSelected()?loopA:0;updateLoop();updateTransport();}
  resetPlayback();resetSession();
  renderPracticeMission();
};
$('#metronome').onclick=()=>{metronome=!metronome;$('#metronome').setAttribute('aria-pressed',metronome);};
$('#loop').onclick=()=>{loop=!loop;$('#loop').setAttribute('aria-pressed',loop);updateLoop();resetSession();};
$('#set-a').onclick=()=>{if(time>=loopB-.1){toast('A precisa ficar antes de B.');return;}clearPhraseSelection();loopA=time;updateLoop();resetSession();};
$('#set-b').onclick=()=>{if(time<=loopA+.1){toast('B precisa ficar depois de A.');return;}clearPhraseSelection();loopB=time;updateLoop();resetSession();};
$('#sheet-toggle').onclick=()=>{$('#sheet').classList.toggle('hidden');document.body.classList.toggle('with-sheet',!$('#sheet').classList.contains('hidden'));if(!$('#sheet').classList.contains('hidden'))refreshNotation();else $('.piano-stage').classList.remove('hidden');resizeCanvas();};
$('#sheet-only').onclick=()=>{$('.piano-stage').classList.toggle('hidden');for(const selector of ['#notation','#live-notation'])$(selector).classList.toggle('full-score',$('.piano-stage').classList.contains('hidden'));notation?.resize();liveScore?.resize();};
$('#sheet-zoom-out').onclick=()=>{notationZoom=Math.max(.5,notationZoom-.1);if(free)liveScore?.setZoom(notationZoom);else notation?.setZoom(notationZoom);};
$('#sheet-zoom-in').onclick=()=>{notationZoom=Math.min(2,notationZoom+.1);if(free)liveScore?.setZoom(notationZoom);else notation?.setZoom(notationZoom);};
let scoreDrag=null;
$('#notation').onpointerdown=event=>{if(event.button!==0)return;scoreDrag={x:event.clientX,y:event.clientY,scroll:$('#notation').scrollTop,moved:false};$('#notation').setPointerCapture(event.pointerId);};
$('#notation').onpointermove=event=>{if(!scoreDrag)return;const delta=event.clientY-scoreDrag.y;if(Math.abs(delta)>4)scoreDrag.moved=true;if(scoreDrag.moved){$('#notation').scrollTop=scoreDrag.scroll-delta;event.preventDefault();}};
$('#notation').onpointerup=event=>{const drag=scoreDrag;scoreDrag=null;if(!drag||drag.moved||mode==='recital')return;const position=notation?.timeAtPoint?.(event.clientX,event.clientY);if(position!==null&&position!==undefined)seek(position);};
$('#notation').onpointercancel=()=>scoreDrag=null;
$('#fullscreen').onclick=()=>window.desktop?.fullscreen();
$('#focus-mode').onclick=()=>setFocusMode(!document.body.classList.contains('practice-focus'));
$('#export-midi').onclick=()=>current&&exportBytes(`${current.title.replace(/[<>:"/\\|?*]/g,'_')}.mid`,encodeMidi(current));
$('#settings-button').onclick=()=>{refreshDevices();$('#settings').showModal();};
$('#profile').value=settings.profile;$('#volume').value=settings.volume;$('#key-range').value=settings.keys;$('#labels').value=settings.labels;$('#lookahead').value=settings.lookahead;
$('#celebration-sound').checked=settings.celebrationSound!==false;
$('#celebration-sound').onchange=e=>{settings.celebrationSound=e.target.checked;saveSettings();};
audio.setVolume(settings.volume/100);
$('#profile').onchange=e=>{stopPhrasePreview();saveSession();pause();invalidateCompletion();clearStudyExercise();practiceSessionId=uid();settings.profile=e.target.value.trim()||'Meu perfil';saveSettings();resetSession();refreshStudyProgress();refreshAchievements();renderLibrary();if(view==='progress')renderProgress();if(view==='song')renderSongHub();};
$('#volume').oninput=e=>{settings.volume=Number(e.target.value);audio.setVolume(settings.volume/100);soundfont?.setVolume(settings.volume/100);saveSettings();};
$('#key-range').insertAdjacentHTML('beforeend','<option value="auto">Ajustar à música</option><option value="custom">Intervalo personalizado</option>');$('#key-range').value=settings.keys;
const rangeSettings=document.createElement('div');rangeSettings.innerHTML='<label>Intervalo personalizado · nota MIDI inicial/final<div><input id="range-min" type="number" min="0" max="126" style="width:70px"> – <input id="range-max" type="number" min="1" max="127" style="width:70px"></div></label><label>Oitava da entrada MIDI<select id="input-octave">'+Array.from({length:9},(_,i)=>`<option value="${i-4}">${i-4>0?'+':''}${i-4} oitava(s)</option>`).join('')+'</select></label>';$('#key-range').closest('label').after(rangeSettings);$('#range-min').value=settings.minKey??36;$('#range-max').value=settings.maxKey??96;$('#input-octave').value=settings.inputOctave??0;
$('#key-range').onchange=e=>{settings.keys=['auto','custom'].includes(e.target.value)?e.target.value:Number(e.target.value);buildKeyboard();saveSettings();};
for(const selector of ['range-min','range-max'])$(`#${selector}`).onchange=()=>{settings.minKey=Math.max(0,Math.min(126,Number($('#range-min').value)||0));settings.maxKey=Math.max(settings.minKey+1,Math.min(127,Number($('#range-max').value)||127));buildKeyboard();saveSettings();};
$('#input-octave').onchange=e=>{silence();settings.inputOctave=Number(e.target.value);saveSettings();};
$('#labels').onchange=e=>{settings.labels=e.target.value;buildKeyboard();saveSettings();};
$('#lookahead').oninput=e=>{settings.lookahead=Number(e.target.value);saveSettings();};
midi.onChange=refreshDevices;
midi.onError=error=>instrument.showError(error);
midi.onNote=n=>{if(n.synthetic)practice.clearInput('device-detached');else instrument.activity(n);const pitch=n.midi+(Number(settings.inputOctave)||0)*12;return n.on?inputOn(pitch,n.velocity,n.channel,`midi-${n.deviceId||'input'}`,n.receivedTime):inputOff(pitch,n.channel,`midi-${n.deviceId||'input'}`,n.receivedTime);};
midi.onSustain=n=>{
  if(n.synthetic)practice.clearInput('device-detached');else instrument.activity(n);
  const key=`${n.deviceId||'input'}:${n.channel}`;if(n.value)midiPedals.set(key,n.channel);else midiPedals.delete(key);
  const down=[...midiPedals.values()].some(channel=>channel===n.channel);if(down)inputPedals.add(n.channel);else inputPedals.delete(n.channel);
  if(view==='studio'||view==='free'){const value=down||(n.channel===0&&sustain);practicePedal(value,n.channel,n.receivedTime);pedal(value,recording?recorder.channelFor(n.channel):n.channel);if(recording)recorder.event({type:'cc',controller:64,value:value?127:0,channel:n.channel});}
};
midi.onMessage=event=>{
  if(event.type==='cc'&&event.controller===64)return;
  if(!event.synthetic)instrument.activity(event);
  if(view!=='studio'&&view!=='free')return;
  const channel=recording?recorder.channelFor(event.channel):event.channel;
  if(recording)recorder.event(event);
  if(event.type==='program'&&free){freeProgram=event.value;$('#free-instrument').value=freeProgram;}
  routeEvent({...event,channel});
};
$('#backup').onclick=async()=>{await achievementWrite.catch(()=>{});await journeyWrite.catch(()=>{});for(const song of songs)achievementState(song);await exportBytes('PianoCraft-projeto.json',new TextEncoder().encode(JSON.stringify({pianocraft:1,songs,history,settings,studyProgress,achievementLedgers,learningJourneys:journeyStates},null,2)),'json');};
$('#edit-notes').onclick=showEditor;$('#close-editor').onclick=()=>$('#note-editor').close();
$('#save-edits').onclick=()=>{if(pendingSplit!==null)for(const n of current.notes)n.hand=n.midi<pendingSplit?'left':'right';$$('.note-row').forEach(el=>{const n=current.notes.find(n=>String(n.id)===el.dataset.note);n.hand=el.querySelector('select').value||undefined;const finger=Number(el.querySelector('input').value);n.finger=finger>=1&&finger<=5?Math.round(finger):undefined;});current.notationEdited=true;saveSongs();resetSession();refreshNotation();$('#note-editor').close();toast('Mãos e dedilhados salvos. Exporte o projeto para preservar esses metadados.');};
$('#record').onclick=startRecord;
$('#save-recording').onclick=()=>{
  if(recording)stopRecord();if(!recordSong?.notes.length)return;
  let song=structuredClone(recordSong);song.title=`Gravação ${new Date().toLocaleString('pt-BR')}`;
  const divisions=Number($('#record-grid').value);
  if(divisions){const step=60/song.tempo/divisions;for(const note of song.notes){const end=Math.max(step,Math.round((note.time+(note.keyDuration??note.duration))/step)*step);note.time=Math.max(0,Math.round(note.time/step)*step);note.keyDuration=Math.max(step,end-note.time);note.duration=Math.max(note.keyDuration,Math.round(note.duration/step)*step);}for(const event of song.events||[])event.time=Math.max(0,Math.round(event.time/step)*step);for(const event of song.programChanges||[])event.time=Math.max(0,Math.round(event.time/step)*step);song=parseMidi(encodeMidi(song),song.title);song.id=recordSong.id;}
  const index=songs.findIndex(s=>s.id===song.id);if(index>=0)songs[index]=song;else songs.push(song);saveSongs();loadSong(song);toast('Gravação salva na biblioteca.');
};
$('#new-recording').onclick=()=>{if(recording)stopRecord();recorder.reset();recordSong=recorder.song;recordTrack=0;liveScore?.clear();updateFreeTempo();persistDraft();renderRecorder();toast('Nova sessão de gravação. As músicas salvas permanecem na biblioteca.');};
$('#free-instrument').onchange=e=>{silence();freeProgram=Number(e.target.value);midi.sendProgram(freeProgram,0);};
$('#tonic').onchange=detectChord;
const keyMap={KeyA:0,KeyW:1,KeyS:2,KeyE:3,KeyD:4,KeyF:5,KeyT:6,KeyG:7,KeyY:8,KeyH:9,KeyU:10,KeyJ:11,KeyK:12,KeyO:13,KeyL:14,KeyP:15,Semicolon:16};
$('#labels').insertAdjacentHTML('beforeend','<option value="degrees">Graus da tonalidade</option><option value="movable">Dó móvel</option><option value="keyboard">Teclas do computador</option>');$('#labels').value=settings.labels;
const shortcuts=document.createElement('details');shortcuts.innerHTML='<summary style="font-size:11px;cursor:pointer">Personalizar teclas</summary><p class="hint">Clique em um campo e pressione a tecla desejada. Z/X mudam oitava; Shift sustenta.</p><div id="shortcut-notes" style="display:grid;grid-template-columns:repeat(4,1fr);gap:7px"></div><label>Iniciar/pausar<input id="shortcut-play" readonly aria-label="Atalho iniciar ou pausar"></label><button id="reset-shortcuts" type="button">Restaurar teclas</button>';$('#backup').before(shortcuts);
function renderShortcuts(){const map=settings.keyMap||keyMap;$('#shortcut-notes').innerHTML=Array.from({length:17},(_,offset)=>{const code=Object.entries(map).find(([,value])=>value===offset)?.[0]||'';return `<label style="margin:5px 0;font-size:9px">${noteName(60+offset)}<input readonly data-offset="${offset}" value="${escapeHtml(code.replace(/^Key/,''))}" aria-label="Atalho ${escapeHtml(noteName(60+offset))}" style="width:65px;padding:6px"></label>`;}).join('');$$('[data-offset]').forEach(input=>input.onkeydown=e=>{e.preventDefault();if(e.ctrlKey||e.altKey||e.metaKey||['KeyZ','KeyX','ShiftLeft','ShiftRight','F10','F11','Escape',settings.playKey||'Space'].includes(e.code)){toast('Esta tecla está reservada para uma ação.');return;}const offset=Number(input.dataset.offset),next={...map};for(const [code,value]of Object.entries(next))if(value===offset||code===e.code)delete next[code];next[e.code]=offset;settings.keyMap=next;saveSettings();renderShortcuts();if(view==='studio'||view==='free')buildKeyboard();});$('#shortcut-play').value=(settings.playKey||'Space').replace('Space','Espaço');}
$('#shortcut-play').onkeydown=e=>{e.preventDefault();if(e.ctrlKey||e.altKey||e.metaKey||['KeyZ','KeyX','ShiftLeft','ShiftRight','F10','F11','Escape'].includes(e.code)||(settings.keyMap||keyMap)[e.code]!==undefined){toast('Escolha uma tecla sem outra função.');return;}settings.playKey=e.code;saveSettings();renderShortcuts();};
$('#reset-shortcuts').onclick=()=>{delete settings.keyMap;delete settings.playKey;saveSettings();renderShortcuts();buildKeyboard();};renderShortcuts();
const computerNotes=new Map();
document.addEventListener('keydown',event=>{
  if(!document.querySelector('dialog[open]')){
    if(event.code==='Escape'&&document.body.classList.contains('practice-focus')){event.preventDefault();setFocusMode(false);return;}
    if(event.code==='F10'&&(view==='studio'||view==='free')){event.preventDefault();setFocusMode(!document.body.classList.contains('practice-focus'));return;}
  }
  if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)||document.querySelector('dialog[open]'))return;
  if(event.repeat)return;
  if(event.code==='F11'){event.preventDefault();window.desktop?.fullscreen();return;}
  if(view!=='studio'&&view!=='free')return;
  if(event.code===(settings.playKey||'Space')){event.preventDefault();play().catch(e=>toast(e.message));return;}
  if(event.code==='KeyZ'){octave=Math.max(1,octave-1);buildKeyboard();toast(`Oitava ${octave}`);return;}
  if(event.code==='KeyX'){octave=Math.min(7,octave+1);buildKeyboard();toast(`Oitava ${octave}`);return;}
  if(event.code==='ShiftLeft'||event.code==='ShiftRight'){sustain=true;const channel=recording?recorder.channelFor(0):0;practicePedal(true);pedal(true,channel);if(recording)recorder.event({type:'cc',controller:64,value:127,channel:0});return;}
  const bindings=settings.keyMap||keyMap;
  if(bindings[event.code]!==undefined){event.preventDefault();const note=(octave+1)*12+bindings[event.code];computerNotes.set(event.code,note);inputOn(note);}
});
document.addEventListener('keyup',event=>{
  if(event.code==='ShiftLeft'||event.code==='ShiftRight'){sustain=false;const down=inputPedals.has(0),channel=recording?recorder.channelFor(0):0;practicePedal(down);pedal(down,channel);if(recording)recorder.event({type:'cc',controller:64,value:down?127:0,channel:0});}
  if(computerNotes.has(event.code)){inputOff(computerNotes.get(event.code));computerNotes.delete(event.code);}
});
window.addEventListener('blur',()=>{
  // Losing computer-key focus must not release physical MIDI keys, stop their
  // sustain or erase an in-progress chord while the instrument is still used.
  for(const n of [...held.values()])if(n.source==='keyboard'||n.source==='pointer')inputOff(n.pitch,n.channel,n.source);
  computerNotes.clear();
  if(sustain){sustain=false;const down=inputPedals.has(0),channel=recording?recorder.channelFor(0):0;practicePedal(down);pedal(down,channel);if(recording)recorder.event({type:'cc',controller:64,value:down?127:0,channel:0});}
});
window.addEventListener('resize',resizeCanvas);
window.addEventListener('beforeunload',()=>{clearInterval(transportTimer);stopPhrasePreview();if(recording)stopRecord();saveSession();instrument.dispose();midi.disconnect();freeMetronome?.dispose();liveScore?.dispose();themeController?.destroy();drums?.dispose();soundfont?.dispose();audio.dispose();});
setInterval(()=>{if(recording)persistDraft();},2000);
document.addEventListener('dragover',event=>event.preventDefault());
document.addEventListener('drop',event=>{event.preventDefault();importFiles([...event.dataTransfer.files]);});
window.desktop?.onExternalMusic(async files=>{const song=await importFiles(files);if(song)openSongHub(song);});
window.desktop?.onPrepareClose(async()=>{stopPhrasePreview();pause();if(recording)stopRecord();saveSession();freeMetronome?.dispose();await progressWrite.catch(()=>{});await achievementWrite.catch(()=>{});await journeyWrite.catch(()=>{});await setStored('achievement-ledgers',achievementLedgers);await setStored('learning-journeys',journeyStates);await persistHistory();await instrument.dispose();await midi.disconnect();await setStored('songs',songs);await persistDraft();});
function organizePracticeWorkspace(){
  const mission=document.createElement('section');mission.id='practice-mission';mission.setAttribute('aria-label','Sua tarefa atual');mission.innerHTML='<div><strong id="mission-title"></strong><span id="mission-context"></span></div><span id="mission-goal" role="status" aria-live="polite"></span>';$('#score-strip').before(mission);
  const tools=document.createElement('details');tools.id='practice-tools';tools.className='practice-drawer';
  tools.innerHTML='<summary>Ajustes</summary><div class="practice-drawer-body"><div class="practice-drawer-heading"><strong>Ajustes de prática</strong><button type="button" id="close-practice-tools" aria-label="Fechar ajustes">✕</button></div><div class="practice-file-tools"></div></div>';
  $('.studio-actions').append(tools);
  const body=tools.querySelector('.practice-drawer-body');
  for(const selector of ['.practice-bar','.practice-navigation','#practice-options','#achievements-host','.track-panel'])body.append($(selector));
  for(const selector of ['#edit-notes','#sheet-toggle','#export-midi'])tools.querySelector('.practice-file-tools').append($(selector));
  tools.querySelector('.practice-file-tools').append(infoButton);
  tools.addEventListener('toggle',()=>{if(tools.open){pause();saveSession();}});
  $('#close-practice-tools').onclick=()=>tools.open=false;
}
organizePracticeWorkspace();renderCollections();renderLibrary();requestAnimationFrame(frame);instrument.start();
