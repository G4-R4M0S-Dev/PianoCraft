/** Independent free-play pulse, scheduled ahead on the audio clock. */
export class PulseMetronome {
  constructor({audio,onBeat=()=>{},timers=globalThis}){Object.assign(this,{audio,onBeat,timers});this.running=false;}
  start({bpm=120,numerator=4,denominator=4}={}){
    this.stop();if(!this.audio.context)throw new Error('Inicialize o áudio antes do metrônomo.');
    this.bpm=Math.max(30,Math.min(240,Number(bpm)||120));this.numerator=Math.max(1,Math.min(12,Math.round(numerator)||4));this.denominator=[2,4,8,16].includes(denominator)?denominator:4;
    this.pulse=60/this.bpm*4/this.denominator;
    // Keep a short bar on the audio timeline. A busy first renderer frame
    // (SoundFont setup or engraving) must not drop the second pulse. Web Audio
    // plays these nodes independently from the JS interval, and stop() cancels
    // the scheduled nodes when the user stops or changes the tempo.
    this.lookahead=Math.max(1.1,Math.min(2,this.pulse*this.numerator));
    this.next=this.audio.context.currentTime+.03;this.index=0;this.queue=[];this.running=true;this.tick();this.timer=this.timers.setInterval(()=>this.tick(),25);
  }
  tick(){
    if(!this.running)return;const now=this.audio.context.currentTime;
    if(this.next<now-.1){const skip=Math.ceil((now-this.next)/this.pulse);this.next+=skip*this.pulse;this.index+=skip;}
    while(this.next<now+this.lookahead){const beat=this.index%this.numerator+1;this.audio.click(beat===1,this.next);this.queue.push({time:this.next,beat,numerator:this.numerator});this.next+=this.pulse;this.index++;}
    while(this.queue.length&&this.queue[0].time<=now)this.onBeat(this.queue.shift());
  }
  stop(){this.running=false;if(this.timer)this.timers.clearInterval(this.timer);this.timer=null;this.queue=[];this.audio.stopClicks?.();}
  dispose(){this.stop();}
}
