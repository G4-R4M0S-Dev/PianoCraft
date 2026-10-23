import { GuideLights, GUIDE_LIGHT_PROFILES } from './music/guide-lights.js';
import { noteName } from './music/midi.js';

const $ = selector => document.querySelector(selector);
const statusLabels = { idle:'MIDI ainda não iniciado', disabled:'Usando o teclado do computador', unavailable:'Entrada ausente · conecte o cabo USB', enumerated:'Entrada encontrada', opening:'Abrindo entrada MIDI…', open:'Entrada MIDI aberta · toque uma tecla para testar', error:'Não foi possível abrir a entrada MIDI' };
const options = (select, entries, value) => {
  select.replaceChildren(...entries.map(([id,name]) => new Option(name,id)));
  // Keep a disconnected preference visible instead of silently selecting a new device.
  if(value && !entries.some(([id])=>id===value))select.add(new Option('Dispositivo desconectado',value));
  select.value=value||'';
};

/** Visible setup, saved routing and hardware activity. Audio and guide routes are independent. */
export class InstrumentControls {
  constructor({midi,settings,saveSettings,beforeChange=()=>{},toast=()=>{}}) {
    Object.assign(this,{midi,settings,saveSettings,beforeChange,toast});
    this.guides=new GuideLights({onError:error=>this.showGuideError(error),onChange:()=>this.renderGuideStatus()});
    this.guideKey=null;this.guideBusy=null;this.disposed=false;this.activityCount=0;this.error='';
    this._guidePort=null;this._guideFailedKey=null;this.guideError='';this.connectionBusy=null;this.restoringRouting=false;
    const guideControls=document.createElement('fieldset');guideControls.id='guide-settings';
    guideControls.innerHTML=`<legend>Luzes do teclado físico</legend>
      <label class="inline-check"><input id="guide-enabled" type="checkbox"> Guiar as notas no instrumento</label>
      <label>Saída exclusiva para as luzes<select id="guide-output"></select></label>
      <label>Protocolo<select id="guide-profile"></select></label>
      <div class="guide-numbers"><label>Canal MIDI (1–16)<input id="guide-channel" type="number" min="1" max="16"></label><label>Deslocamento de notas<input id="guide-offset" type="number" min="-127" max="127"></label></div>
      <p id="guide-help" class="hint"></p><button id="guide-test" type="button">Testar luzes · Dó Mi Sol</button><p id="guide-status" class="hint" role="status"></p>`;
    $('#device-help').after(guideControls);
    const auto=document.createElement('label');auto.className='inline-check';auto.innerHTML='<input id="midi-auto-connect" type="checkbox"> Conectar o instrumento ao abrir o PianoCraft';
    $('#connect-midi').before(auto);
    options($('#guide-profile'),Object.values(GUIDE_LIGHT_PROFILES).map(p=>[p.id,p.label]),settings.guideProfile||'casio-lks250');
    $('#guide-enabled').checked=settings.guideEnabled===true;
    $('#guide-channel').value=settings.guideChannel??4;
    $('#guide-offset').value=settings.guideOffset??0;
    $('#midi-auto-connect').checked=settings.midiAutoConnect!==false;
    for(const id of ['midi-input','instrument-input'])$('#'+id).onchange=event=>this.selectInput(event.target.value);
    $('#midi-output').onchange=event=>this.selectOutput(event.target.value);
    for(const id of ['connect-midi','instrument-retry'])$('#'+id).onclick=()=>this.connect().catch(error=>this.showError(error));
    $('#instrument-settings').onclick=()=>{$('#settings').showModal();this.refresh();};
    $('#midi-auto-connect').onchange=event=>{settings.midiAutoConnect=event.target.checked;saveSettings();};
    $('#guide-profile').onchange=()=>{
      const profile=$('#guide-profile').value;
      $('#guide-channel').value=GUIDE_LIGHT_PROFILES[profile].channel;
      this.saveGuideSettings();
    };
    for(const id of ['guide-enabled','guide-output','guide-channel','guide-offset'])$('#'+id).onchange=()=>this.saveGuideSettings();
    $('#guide-test').onclick=async()=>{
      this.beforeChange();
      try {await this.syncGuides();if(!this.guides.connected)throw new Error('Ative as luzes e escolha uma saída MIDI disponível.');this.guides.test([60,64,67],800);this.toast('Enviado Dó–Mi–Sol por 0,8 s. Confira as luzes no instrumento.');}
      catch(error){this.showGuideError(error);}
    };
    this.refresh();
  }

  async start(){if(this.settings.midiAutoConnect!==false)await this.connect().catch(error=>this.showError(error));}

  async connect(){
    if(this.connectionBusy)return this.connectionBusy;
    this.connectionBusy=(async()=>{
      this.error='';this._guideFailedKey=null;this.refresh();
      // Apply saved choices before requesting access so "computer" and an absent
      // preferred keyboard never briefly open another attached instrument.
      await this.midi.setInput(this.settings.midiInputId===undefined?null:this.restorePort(this.midi.inputs,this.settings.midiInputId,this.settings.midiInputName));
      await this.midi.setOutput(this.restorePort(this.midi.outputs,this.settings.midiOutputId,this.settings.midiOutputName));
      await this.midi.connect();
      const input=this.settings.midiInputId===undefined?this.preferredInput()?.id:this.restorePort(this.midi.inputs,this.settings.midiInputId,this.settings.midiInputName);
      if(input!==undefined)await this.midi.setInput(input);
      const output=this.restorePort(this.midi.outputs,this.settings.midiOutputId,this.settings.midiOutputName);
      if(this.settings.midiOutputId)await this.midi.setOutput(output);
      if(this.settings.guideEnabled===undefined&&this.midi.outputs.some(port=>/casio/i.test(`${port.name} ${port.manufacturer}`))){
        // This installation's instrument was identified by its owner as LK-S250.
        this.settings.guideEnabled=true;this.settings.guideProfile='casio-lks250';
        $('#guide-enabled').checked=true;$('#guide-profile').value='casio-lks250';
      }
      if(this.settings.midiInputId!==undefined||this.midi.inputId)this.rememberRouting();
      this.refresh();await this.syncGuides(true);
      return this.midi.connected;
    })();
    try{return await this.connectionBusy;}finally{this.connectionBusy=null;this.refresh();}
  }

  preferredInput(){return this.midi.inputs.find(p=>/casio|yamaha|roland|korg|piano/i.test(p.name))||this.midi.inputs.find(p=>!/loop|virtual|test|wavetable/i.test(p.name));}

  async restoreAvailableRouting(){
    if(this.disposed||this.connectionBusy||this.restoringRouting||!this.midi.accessReady)return;
    this.restoringRouting=true;
    try{
      const input=this.settings.midiInputId===undefined?this.preferredInput()?.id:this.restorePort(this.midi.inputs,this.settings.midiInputId,this.settings.midiInputName);
      if(input&&input!==this.midi.inputId&&this.midi.inputs.some(p=>p.id===input))await this.midi.setInput(input);
      const output=this.restorePort(this.midi.outputs,this.settings.midiOutputId,this.settings.midiOutputName);
      if(output&&output!==this.midi.outputId&&this.midi.outputs.some(p=>p.id===output))await this.midi.setOutput(output);
      if(this.midi.connected){this.error='';this.rememberRouting();}
    }catch(error){this.showError(error);}finally{this.restoringRouting=false;}
  }

  restorePort(ports,id,name){
    if(!id||id==='all')return id||null;
    return ports.find(p=>p.id===id)?.id||ports.find(p=>p.name===name)?.id||id;
  }
  rememberRouting(){
    const {midi,settings}=this;
    settings.midiInputId=midi.inputId||'';settings.midiOutputId=midi.outputId||'';
    settings.midiInputName=midi.inputs.find(p=>p.id===midi.inputId)?.name||settings.midiInputName||'';
    settings.midiOutputName=midi.outputs.find(p=>p.id===midi.outputId)?.name||settings.midiOutputName||'';
    this.saveSettings();
  }
  async selectInput(id){
    this.beforeChange();this.error='';
    this.settings.midiInputId=id||'';this.settings.midiInputName=this.midi.inputs.find(p=>p.id===id)?.name||this.settings.midiInputName||'';this.saveSettings();
    try {await this.midi.setInput(id||null);if(!this.midi.accessReady)await this.midi.connect();this.rememberRouting();}
    catch(error){this.showError(error);}finally{this.refresh();}
  }
  async selectOutput(id){
    this.beforeChange();this.error='';
    this.settings.midiOutputId=id||'';this.settings.midiOutputName=this.midi.outputs.find(p=>p.id===id)?.name||this.settings.midiOutputName||'';this.saveSettings();
    try {await this.releaseGuidePort();await this.midi.setOutput(id||null);if(!this.midi.accessReady)await this.midi.connect();this.rememberRouting();await this.syncGuides(true);}
    catch(error){this.showError(error);}finally{this.refresh();}
  }
  saveGuideSettings(){
    const {settings}=this;
    this.beforeChange();
    this.guides.allOff();this.guideKey=null;
    settings.guideEnabled=$('#guide-enabled').checked;settings.guideOutputId=$('#guide-output').value;
    settings.guideOutputName=this.midi.outputs.find(p=>p.id===settings.guideOutputId)?.name||settings.guideOutputName||'';
    settings.guideProfile=$('#guide-profile').value;
    settings.guideChannel=Math.max(1,Math.min(16,Math.round(Number($('#guide-channel').value)||4)));
    settings.guideOffset=Math.max(-127,Math.min(127,Math.round(Number($('#guide-offset').value)||0)));
    $('#guide-channel').value=settings.guideChannel;$('#guide-offset').value=settings.guideOffset;
    this.saveSettings();this.syncGuides(true).catch(error=>this.showGuideError(error));this.renderGuideStatus();
  }
  guideTarget(){
    const {settings,midi}=this;
    if(!settings.guideEnabled||!midi.accessReady)return null;
    const outputId=this.restorePort(midi.outputs,settings.guideOutputId,settings.guideOutputName),port=midi.access.outputs.get(outputId);
    if(!port||port.state==='disconnected')return null;
    return {port,key:[outputId,settings.guideProfile||'casio-navigate',settings.guideChannel??4,settings.guideOffset??0].join(':'),profile:settings.guideProfile||'casio-navigate',channel:settings.guideChannel??4,noteOffset:settings.guideOffset??0};
  }
  async releaseGuidePort(){
    const port=this._guidePort;this.guides.disconnect();this._guidePort=null;this.guideKey=null;
    // Closing a Web MIDI port affects every route sharing that same port object.
    // The audio route keeps ownership until MidiDevices explicitly releases it.
    if(port&&!(this.midi.outputId===port.id&&this.midi.outputStatus==='open'))try{await port.close();}catch{}
  }
  async syncGuides(force=false){
    if(this.disposed)return;
    if(force){this.guideKey=null;this._guideFailedKey=null;this.guideError='';}
    if(this.guideBusy){await this.guideBusy;return this.syncGuides();}
    let target=this.guideTarget();
    if(target&&target.key===this.guideKey&&this._guidePort===target.port&&this.guides.connected&&target.port.connection==='open')return true;
    if(target?.key===this._guideFailedKey&&!this._guidePort)return false;
    if(!target&&!this._guidePort&&!this.guides.connected){this.renderGuideStatus();return false;}
    this.guideBusy=(async()=>{
      await this.releaseGuidePort();
      if(this.disposed||!target||target.key===this._guideFailedKey||this.guideTarget()?.key!==target.key)return;
      try{
        if(GUIDE_LIGHT_PROFILES[target.profile]?.requiresSysex&&!this.midi.sysexEnabled){
          await this.midi.enableSysex();
          target=this.guideTarget();
          if(this.disposed||!target)return;
        }
        this._guidePort=target.port;await target.port.open();
        if(this.disposed||this.guideTarget()?.key!==target.key||this.guideTarget()?.port!==target.port){await this.releaseGuidePort();return;}
        if(target.port.state==='disconnected'||target.port.connection!=='open')throw new Error('A saída das luzes não ficou aberta.');
        if(this.guides.connect(target.port,target)){this.guideKey=target.key;this.guideError='';this.settings.guideOutputId=target.port.id;this.settings.guideOutputName=target.port.name;this.saveSettings();}
        else await this.releaseGuidePort();
      }catch(error){this._guideFailedKey=target?.key;this.showGuideError(error);await this.releaseGuidePort();}
      finally{this.renderGuideStatus();}
    })();
    try{await this.guideBusy;}finally{this.guideBusy=null;}
    if(!this.disposed&&this.guideTarget()?.key!==target?.key)return this.syncGuides();
    return this.guides.connected;
  }
  refresh(){
    const {midi}=this,inputs=[['','Teclado do computador'],['all','Todas as entradas MIDI'],...midi.inputs.map(p=>[p.id,p.name])];
    for(const id of ['midi-input','instrument-input'])options($('#'+id),inputs,midi.inputId);
    options($('#midi-output'),[['','Sintetizador interno'],...midi.outputs.map(p=>[p.id,p.name])],midi.outputId);
    let guideId=this.restorePort(midi.outputs,this.settings.guideOutputId,this.settings.guideOutputName);
    if(!guideId){const input=midi.inputs.find(p=>p.id===midi.inputId);guideId=midi.outputs.find(p=>p.name===input?.name)?.id||midi.outputs.find(p=>/casio/i.test(p.name))?.id||'';if(guideId){this.settings.guideOutputId=guideId;this.settings.guideOutputName=midi.outputs.find(p=>p.id===guideId)?.name;}}
    options($('#guide-output'),[['','Escolha a saída do teclado'],...midi.outputs.map(p=>[p.id,p.name])],guideId);
    const name=midi.inputId==='all'?'Todas as entradas MIDI':midi.inputs.find(p=>p.id===midi.inputId)?.name||'Teclado do computador';
    const diagnostic=midi.inputDiagnostics?.find(p=>p.error)?.error?.message;
    const detail=this.error||diagnostic||statusLabels[midi.inputStatus]||'Entrada MIDI indisponível';
    $('#instrument-name').textContent=name;$('#instrument-status').textContent=detail;$('#device-help').textContent=detail;
    $('#instrument-panel').dataset.state=midi.connected?'open':this.error||midi.inputStatus==='error'?'error':midi.inputStatus;
    $('#midi-status').replaceChildren(document.createTextNode(name),Object.assign(document.createElement('small'),{textContent:midi.connected?'Entrada MIDI aberta':detail}));
    $('.device-dot').style.background=midi.connected?'#89cfa5':'#798492';
    this.renderGuideStatus();
    // MIDI statechange includes open/close events, so configuration is coalesced.
    if(!this.guideScheduled){this.guideScheduled=true;queueMicrotask(async()=>{this.guideScheduled=false;await this.restoreAvailableRouting();this.syncGuides().catch(error=>this.showGuideError(error));});}
  }
  renderGuideStatus(){
    if(!$('#guide-status'))return;
    const {settings,guides}=this;
    const specific=GUIDE_LIGHT_PROFILES[settings.guideProfile||$('#guide-profile').value]?.requiresSysex===true;
    $('#guide-channel').disabled=specific;
    $('#guide-help').textContent=(settings.guideProfile||'casio-navigate')==='casio-lks250'
      ?'CASIO LK-S250: iluminação específica do modelo, independente do som. Ative Key Light no teclado para ver as notas indicadas.'
      :(settings.guideProfile||'casio-navigate')==='casio-navigate'
      ?'CASIO compatível: ative Key Light e ajuste o canal Navigate direito para o canal acima. Em modelos com MIDI In Navigate, escolha BothHandOff/RightHandOff. Consulte o manual do modelo. As luzes usam velocidade MIDI 1; o som depende da configuração do teclado.'
      :'Para instrumentos que acendem teclas ao receber Note On/Off no canal selecionado. O suporte depende do modelo.';
    $('#guide-status').textContent=(!settings.guideEnabled?'Luzes desativadas':this.guideError||guides.error?.message||(guides.connected?`Saída das luzes aberta${specific?'':` · canal ${guides.channel}`} · ${guides.activeNotes.length} nota(s) guia`:'Escolha uma saída disponível para as luzes'));
    $('#guide-test').disabled=!guides.connected;
  }
  activity(event){
    this.activityCount++;
    const text=event.midi!==undefined?`${noteName(event.midi)} · ${event.on?'pressionada':'solta'} · canal ${(event.channel??0)+1}`:event.type==='cc'?`Controle ${event.controller} · ${event.value}`:'Pedal · '+(event.value?'pressionado':'solto');
    $('#midi-activity').textContent=`${text} · ${this.activityCount} eventos`;
    $('#midi-activity').dataset.active='true';clearTimeout(this.activityTimer);
    this.activityTimer=setTimeout(()=>{$('#midi-activity').dataset.active='false';},250);
  }
  showError(error){this.error=error?.message||String(error);$('#instrument-status').textContent=this.error;$('#device-help').textContent=this.error;$('#instrument-panel').dataset.state='error';}
  showGuideError(error){this.guideError=error?.message||String(error);this._guideFailedKey=this.guideTarget()?.key||this._guideFailedKey;this.renderGuideStatus();if(!this.guideBusy&&!this.disposed)queueMicrotask(()=>this.syncGuides().catch(()=>{}));}
  async dispose(){this.disposed=true;clearTimeout(this.activityTimer);this.guides.dispose();if(this.guideBusy)await this.guideBusy;await this.releaseGuidePort();}
}
