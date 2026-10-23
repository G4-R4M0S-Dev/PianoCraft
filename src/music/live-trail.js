/** Physical key history for the free-piano roll. Uses a monotonic wall clock,
 * independent of transport, recording position, tempo and animation callbacks. */
export class LiveNoteTrail {
  constructor({windowSeconds=6,maxNotes=4096}={}) {
    this.windowSeconds=windowSeconds;this.maxNotes=maxNotes;this.notes=[];this.held=new Map();this.serial=0;
  }
  noteOn(key,midi,velocity=0.8,channel=0,at=performance.now()) {
    if(this.held.has(key)||!Number.isInteger(midi)||midi<0||midi>127||!Number.isFinite(at))return null;
    const note={id:++this.serial,key,midi,velocity:Math.max(0,Math.min(1,velocity)),channel,start:at,end:null};
    this.notes.push(note);this.held.set(key,note);this.prune(at);
    return note;
  }
  noteOff(key,at=performance.now()) {
    const note=this.held.get(key);if(!note)return;
    note.end=Math.max(note.start,at);this.held.delete(key);
  }
  releaseAll(at=performance.now()) {for(const key of this.held.keys())this.noteOff(key,at);}
  clear(){this.notes=[];this.held.clear();}
  prune(now=performance.now()) {
    const threshold=now-this.windowSeconds*1000;
    this.notes=this.notes.filter(note=>note.end===null||note.end>=threshold);
    if(this.notes.length>this.maxNotes){
      const released=this.notes.filter(note=>note.end!==null),remove=new Set(released.slice(0,this.notes.length-this.maxNotes));
      this.notes=this.notes.filter(note=>!remove.has(note));
    }
  }
  visible(now=performance.now(),windowSeconds=this.windowSeconds) {
    this.windowSeconds=Math.max(1,Math.min(30,Number(windowSeconds)||6));this.prune(now);
    return this.notes.map(note=>({...note,ageStart:Math.max(0,(now-note.start)/1000),ageEnd:note.end===null?0:Math.max(0,(now-note.end)/1000),held:note.end===null}));
  }
}
