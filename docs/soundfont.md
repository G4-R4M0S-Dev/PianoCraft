# SoundFont offline

`SoundFontEngine` em `src/music/soundfont.js` carrega um `ArrayBuffer` SF2/SF3 fornecido pelo usuário, com limite de 256 MB. O banco fica no processo de áudio; não há CDN, serviço remoto ou banco proprietário incluído. `assets/soundfonts/PianoCraft-Basic.sf2` é um pequeno timbre sintetizado do projeto, com licença MIT, gerado de ondas senoidais por `scripts/make-soundfont-fixture.mjs`. Ele não é uma gravação de piano acústico nem um banco GM completo.

O mecanismo usa `spessasynth_lib@4.3.14`, `spessasynth_core@4.3.22` e `stb-vorbis@0.0.6`, todos Apache-2.0. O código de descompressão fflate incluído na biblioteca é MIT. As licenças e fontes estão identificadas em `src/vendor/VENDOR-NOTICES.txt`.

`node scripts/prepare-assets.mjs` cria o bundle ES independente e copia o AudioWorklet do mesmo pacote instalado. O aplicativo empacotado precisa somente de `src/vendor` e do banco selecionado; os pacotes npm e esbuild não são necessários no runtime de SoundFont. A CSP permite WASM por `script-src 'self' 'wasm-unsafe-eval'`, sem permitir eval JavaScript geral. Os módulos e o worklet usam URLs relativas locais e funcionam por `file://` no Electron.

O contrato inclui `init(buffer)`, `noteOn`, `noteOff`, `allNotesOff`, `setVolume`, `setSustain`, `controlChange`, `pitchBend`, `aftertouch`, `polyAftertouch`, `programChange` e `dispose`. O construtor aceita `{context,volume,maxVoices}`; um contexto compartilhado não é fechado por `dispose`. `ready`, `presets` e `onError` permitem acompanhar o estado. `init()` sem buffer retoma um mecanismo já carregado.

`node scripts/smoke-soundfont.mjs` verifica um SF2 autoral em Electron real: áudio com RMS mensurável, pedal e soltura, pânico, descarte, recarga no contexto compartilhado e rejeição de banco malformado. SF3 é suportado pelo decodificador da dependência, mas a fixture local testada é SF2. O projeto SpessaSynth documenta um [problema de áudio SF3 em Chromium no WorkletSynthesizer](https://spessasus.github.io/spessasynth_lib/synthesizer/), especialmente em equipamentos fracos. O teste local não confirma desempenho de todo banco externo nem de hardware MIDI.

Fontes primárias: [repositório e licença](https://github.com/spessasus/spessasynth_lib), [WorkletSynthesizer](https://spessasus.github.io/spessasynth_lib/synthesizer/worklet-synthesizer/), [cópia do módulo AudioWorklet](https://spessasus.github.io/spessasynth_lib/synthesizer/importing-the-worklet/) e [API do sintetizador](https://spessasus.github.io/spessasynth_lib/synthesizer/basic-synthesizer/).
