export function handOf(note, configs = {}) {
  const explicit = note.hand === 'left' || note.hand === 'right' ? note.hand : configs[note.track]?.hand;
  return explicit === 'left' || explicit === 'right' ? explicit : (note.midi < 60 ? 'left' : 'right');
}
export function isPracticeNote(note, mode, hands, configs = {}) {
  const role = configs[note.track]?.role || 'learn';
  return mode !== 'listen' && role === 'learn' && (hands === 'both' || handOf(note, configs) === hands);
}
const now = () => globalThis.performance?.now() ?? Date.now();
const keyFor = (midi, sourceKey) => sourceKey ?? `default:${midi}`;
const durationOf = note => Math.max(0, Number(note.keyDuration ?? note.duration) || 0);

export class PracticeSession {
  constructor(notes, { mode = 'listen', hands = 'both', configs = {}, start = 0, end = Infinity,
    chordWindowMs = 120, onsetTolerance = mode === 'melody' ? .2 : .25,
    releaseRatio = .6, releaseTolerance = .12, speed = 1 } = {}) {
    this.mode = mode;
    this.notes = notes.filter(n => n.time >= start && n.time < end && isPracticeNote(n, mode, hands, configs)).sort((a,b) => a.time-b.time);
    this.chordWindowMs = Number.isFinite(chordWindowMs) && chordWindowMs >= 0 ? chordWindowMs : 120;
    this.onsetTolerance = Number.isFinite(onsetTolerance) && onsetTolerance >= 0 ? onsetTolerance : .25;
    this.releaseRatio = Number.isFinite(releaseRatio) ? Math.min(1, Math.max(0, releaseRatio)) : .6;
    this.releaseTolerance = Number.isFinite(releaseTolerance) ? Math.max(0, releaseTolerance) : .12;
    this.speed = Number.isFinite(speed) && speed > 0 ? speed : 1;
    this.initialSpeed = this.speed;
    this.speedChanges = [];
    this.hits = new Set(); this.missed = new Set(); this.errors = 0; this.durationErrors = 0;
    this.errorEvents = []; this.errorEventsDropped = 0;
    // Group from a fixed onset (never transitively), so nearby successive notes
    // cannot be folded into the same chord. The epsilon only absorbs float noise.
    this.groups = [];
    for (const note of this.notes) {
      let group = this.groups.at(-1);
      if (!group || Math.abs(note.time - group.time) > 1e-6) {
        group = { time: note.time, notes: [], pitches: new Set(), status: 'pending' };
        this.groups.push(group);
      }
      group.notes.push(note); group.pitches.add(note.midi);
    }
    this.groupIndex = 0;
    this.held = new Map();
    this.sustainPedals = new Set();
    this.pendingPedals = new Map();
    this.attempt = null;
    this.attemptId = 0;
    this.wallTimeMs = null;
    this.holdClock = 0;
    this.lastResult = { status: 'idle', notes: [], pendingPitches: [] };
  }
  currentGroup() {
    while (this.groups[this.groupIndex]?.status !== 'pending' && this.groupIndex < this.groups.length) this.groupIndex++;
    return this.groups[this.groupIndex];
  }
  next() { return this.currentGroup()?.notes[0]; }
  expectedNotes() { return [...(this.currentGroup()?.notes || [])]; }
  gate(target) { const next = this.next(); return this.mode === 'melody' && next && target >= next.time ? Math.min(target, next.time) : target; }
  tick(wallTimeMs = now()) {
    if (!Number.isFinite(wallTimeMs)) wallTimeMs = now();
    // Keep time monotonic even when a driver delivers an old MIDI timestamp.
    if (this.wallTimeMs !== null) {
      wallTimeMs = Math.max(this.wallTimeMs, wallTimeMs);
      this.holdClock += (wallTimeMs - this.wallTimeMs) / 1000 * this.speed;
    }
    this.wallTimeMs = wallTimeMs;
    return wallTimeMs;
  }
  setSpeed(speed, wallTimeMs = now()) {
    this.tick(wallTimeMs);
    if (Number.isFinite(speed) && speed > 0 && speed !== this.speed) {
      this.speedChanges.push({ time: this.wallTimeMs, speed });
      this.speed = speed;
    }
  }
  heldSeconds(startMs, endMs) {
    if (endMs <= startMs) return 0;
    let at = startMs, speed = this.initialSpeed, seconds = 0;
    for (const change of this.speedChanges) {
      if (change.time <= startMs) { speed = change.speed; continue; }
      if (change.time >= endMs) break;
      seconds += (change.time - at) / 1000 * speed;
      at = change.time; speed = change.speed;
    }
    return seconds + (endMs - at) / 1000 * speed;
  }
  requiredDuration(duration) { return Math.max(0, duration * this.releaseRatio - this.releaseTolerance); }
  recordError(reason, { notes = [], midi, time, type = 'pitch', count = 1, expectedPitches } = {}) {
    const onset = Number.isFinite(notes[0]?.time) ? notes[0].time : Number.isFinite(time) ? time : 0;
    const pitches = [...new Set(expectedPitches || notes.map(note => note.midi))].filter(Number.isFinite).slice(0, 32);
    // Repeated failures at the same attack share one record. Counters above
    // remain authoritative, including when the bounded detail log is full.
    const existing = this.errorEvents.find(event => event.reason === reason && Math.abs(event.time - onset) < 1e-6 && event.midi === midi && event.expectedPitches.join(',') === pitches.join(','));
    if (existing) { existing.count += count; return; }
    if (this.errorEvents.length >= 128) { this.errorEventsDropped += count; return; }
    const event = { time: onset, reason, type, count, expectedPitches: pitches, noteIds: notes.map(note => note.id).filter(id => typeof id === 'string' || Number.isFinite(id)).slice(0, 32) };
    if (Number.isFinite(midi)) event.midi = midi;
    if (Number.isFinite(time)) event.playedTime = time;
    this.errorEvents.push(event);
  }
  penalizeDuration(obligation) {
    if (obligation.penalized) return 0;
    obligation.penalized = true;
    this.errors++; this.durationErrors++;
    this.recordError('released-too-early', { notes: obligation.notes, type: 'duration' });
    return 1;
  }
  setSustain(pedalKey, down, wallTimeMs = now()) {
    const eventTimeMs = Number.isFinite(wallTimeMs) ? wallTimeMs : now();
    this.tick(wallTimeMs);
    if (down) { this.sustainPedals.add(pedalKey); return this.lastResult; }
    this.sustainPedals.delete(pedalKey);
    const pending = this.pendingPedals.get(pedalKey);
    if (!pending) return this.lastResult;
    this.pendingPedals.delete(pedalKey);
    let durationErrorsAdded = 0, early = false;
    const notes = [];
    for (const obligation of pending) {
      notes.push(...obligation.notes);
      const heldSeconds = this.heldSeconds(obligation.startEventAtMs, Math.max(obligation.latestReleaseAtMs, eventTimeMs));
      if (heldSeconds + 1e-9 < this.requiredDuration(obligation.soundDuration)) {
        early = true;
        durationErrorsAdded += this.penalizeDuration(obligation);
      }
    }
    this.result(early ? 'rejected' : 'released', early ? 'released-too-early' : 'duration-complete', { notes, durationErrorsAdded, pedalKey });
    return this.lastResult;
  }
  result(status, reason, extra = {}) {
    this.lastResult = { status, reason, notes: [], pendingPitches: [], ...extra };
  }
  failAttempt(reason) {
    if (!this.attempt) return;
    for (const key of this.attempt.keys) {
      const held = this.held.get(key);
      if (held) held.blocked = true;
    }
    const notes = this.attempt.group.notes;
    this.attempt = null;
    this.errors++;
    this.recordError(reason, { notes, type: 'chord' });
    this.result('rejected', reason);
  }
  expireAttempt(wallTimeMs) {
    if (this.attempt && wallTimeMs - this.attempt.observedAtMs > this.chordWindowMs) this.failAttempt('chord-timeout');
  }
  expireEventAttempt(eventTimeMs) {
    if (this.attempt && Math.max(this.attempt.latestEventAtMs, eventTimeMs) - Math.min(this.attempt.startedAtMs, eventTimeMs) > this.chordWindowMs) this.failAttempt('chord-timeout');
  }
  input(midi, time, transpose = 0, wallTimeMs = now(), sourceKey) {
    // MIDI timestamps describe the actual attacks, even if several queued
    // messages arrive after a scheduler tick. Never clamp their separation away.
    const eventTimeMs = Number.isFinite(wallTimeMs) ? wallTimeMs : now();
    wallTimeMs = this.tick(wallTimeMs);
    this.advance(time, wallTimeMs);
    this.expireEventAttempt(eventTimeMs);
    const key = keyFor(midi, sourceKey);
    if (this.held.has(key)) {
      this.result('duplicate', 'key-already-down');
      return null;
    }
    const held = { midi, time, wallTimeMs: eventTimeMs, holdClock: this.holdClock, blocked: false };
    this.held.set(key, held);
    const group = this.currentGroup();
    if (this.mode === 'listen' || !group) {
      this.result('ignored', this.mode === 'listen' ? 'listen' : 'finished');
      return null;
    }
    const expected = [...group.pitches].map(pitch => pitch + transpose);
    if (!Number.isFinite(time) || Math.abs(group.time - time) > this.onsetTolerance + 1e-9 || !expected.includes(midi)) {
      this.errors++;
      const reason = expected.includes(midi) ? 'outside-onset-window' : 'wrong-note';
      this.recordError(reason, { notes: group.notes, midi, time, expectedPitches: expected, type: reason === 'wrong-note' ? 'pitch' : 'timing' });
      this.result('rejected', reason);
      return null;
    }
    if (!this.attempt) this.attempt = { id: ++this.attemptId, group, startedAtMs: eventTimeMs, latestEventAtMs: eventTimeMs, observedAtMs: wallTimeMs, keys: new Set() };
    const attempt = this.attempt;
    attempt.startedAtMs = Math.min(attempt.startedAtMs, eventTimeMs);
    attempt.latestEventAtMs = Math.max(attempt.latestEventAtMs, eventTimeMs);
    held.attemptId = attempt.id;
    attempt.keys.add(key);
    const down = new Map();
    for (const candidateKey of attempt.keys) {
      const candidate = this.held.get(candidateKey);
      if (candidate && !candidate.blocked && candidate.attemptId === attempt.id) {
        if (!down.has(candidate.midi)) down.set(candidate.midi, []);
        down.get(candidate.midi).push(candidateKey);
      }
    }
    const pendingPitches = expected.filter(pitch => !down.has(pitch));
    if (pendingPitches.length) {
      this.result('pending', 'incomplete-chord', { pendingPitches, startedAtMs: attempt.startedAtMs, deadlineMs: attempt.observedAtMs + this.chordWindowMs });
      return null;
    }
    // Only a complete chord commits hits; no partial note can advance the gate.
    for (const note of group.notes) this.hits.add(note.id);
    group.status = 'accepted';
    this.attempt = null;
    for (const pitch of group.pitches) {
      const keys = new Set(down.get(pitch + transpose));
      const pitchNotes = group.notes.filter(note => note.midi === pitch);
      const obligation = {
        keys, notes: pitchNotes,
        startEventAtMs: Math.min(...[...keys].map(candidateKey => this.held.get(candidateKey).wallTimeMs)),
        latestReleaseAtMs: -Infinity,
        physicalDuration: Math.max(0, ...pitchNotes.filter(note => note.keyDuration != null).map(durationOf)),
        soundDuration: Math.max(0, ...pitchNotes.filter(note => note.keyDuration == null).map(durationOf)),
      };
      for (const candidateKey of keys) this.held.get(candidateKey).obligation = obligation;
    }
    const representative = group.notes.filter(note => note.midi + transpose === midi).reduce((longest, note) => durationOf(note) > durationOf(longest) ? note : longest);
    this.result('accepted', 'complete-chord', { notes: [...group.notes], onset: group.time, spreadMs: attempt.latestEventAtMs - attempt.startedAtMs });
    return representative;
  }
  release(midi, time, transpose = 0, wallTimeMs = now(), sourceKey, { sustain = false, pedalKey = 'channel:0' } = {}) {
    const eventTimeMs = Number.isFinite(wallTimeMs) ? wallTimeMs : now();
    wallTimeMs = this.tick(wallTimeMs);
    this.expireAttempt(wallTimeMs);
    this.expireEventAttempt(eventTimeMs);
    const key = keyFor(midi, sourceKey), held = this.held.get(key);
    if (!held || held.midi !== midi) {
      this.result('ignored', 'key-not-down');
      return this.lastResult;
    }
    this.held.delete(key);
    if (this.attempt && this.attempt.id === held.attemptId && !held.blocked) {
      const stillDown = [...this.attempt.keys].some(candidateKey => {
        const candidate = this.held.get(candidateKey);
        return candidate && !candidate.blocked && candidate.midi === midi;
      });
      if (!stillDown) {
        this.failAttempt('released-before-chord');
        return this.lastResult;
      }
    }
    const obligation = held.obligation;
    if (obligation) {
      obligation.keys.delete(key);
      obligation.latestReleaseAtMs = Math.max(obligation.latestReleaseAtMs, eventTimeMs);
      if (!obligation.keys.size) {
        // Duration follows the original MIDI event interval, not the time the
        // renderer got around to processing it. Speed changes remain integrated.
        const heldSeconds = this.heldSeconds(obligation.startEventAtMs, obligation.latestReleaseAtMs);
        const physicalEarly = heldSeconds + 1e-9 < this.requiredDuration(obligation.physicalDuration);
        const soundEarly = heldSeconds + 1e-9 < this.requiredDuration(obligation.soundDuration);
        const durationPending = soundEarly && (sustain || this.sustainPedals.has(pedalKey));
        if (durationPending) {
          if (!this.pendingPedals.has(pedalKey)) this.pendingPedals.set(pedalKey, new Set());
          this.pendingPedals.get(pedalKey).add(obligation);
        }
        const early = physicalEarly || (soundEarly && !durationPending);
        const durationErrorsAdded = early ? this.penalizeDuration(obligation) : 0;
        this.result(early ? 'rejected' : durationPending ? 'sustained' : 'released', early ? 'released-too-early' : durationPending ? 'awaiting-pedal-release' : 'duration-complete', { notes: obligation.notes, heldSeconds, durationPending, durationErrorsAdded, pedalKey });
        return this.lastResult;
      }
    }
    this.result('released', 'key-up');
    return this.lastResult;
  }
  advance(time, wallTimeMs = now()) {
    wallTimeMs = this.tick(wallTimeMs);
    if (this.mode !== 'melody') {
      let group = this.currentGroup();
      while (group && group.time < time - this.onsetTolerance - 1e-9) {
        // A rhythm miss already penalizes every note; do not also charge the
        // unfinished attempt as a separate wrong chord.
        if (this.attempt?.group === group) {
          for (const key of this.attempt.keys) { const held = this.held.get(key); if (held) held.blocked = true; }
          this.attempt = null;
        }
        group.status = 'missed';
        for (const note of group.notes) this.missed.add(note.id);
        this.recordError('onset-missed', { notes: group.notes, type: 'miss', count: group.notes.length });
        this.result('missed', 'onset-missed', { notes: [...group.notes], onset: group.time });
        group = this.currentGroup();
      }
    }
    this.expireAttempt(wallTimeMs);
  }
  clearInput(reason = 'pause') {
    this.held.clear();
    this.sustainPedals.clear();
    this.pendingPedals.clear();
    this.attempt = null;
    this.wallTimeMs = null;
    this.initialSpeed = this.speed;
    this.speedChanges = [];
    this.result('idle', reason);
  }
  get accuracy() { const total = this.hits.size + this.missed.size + this.errors; return total ? Math.round(this.hits.size / total * 100) : null; }
  get complete() { return this.hits.size + this.missed.size >= this.notes.length; }
}
