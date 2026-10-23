# Expressão MIDI e duração de teclas

`song.events` contém eventos em segundos com `time`, `track`, `channel`, `type` e `value`:

- `cc`: `controller` e `value` entre 0 e 127, inclusive sustain CC64.
- `pitchBend`: `value` entre 0 e 16383; centro 8192.
- `aftertouch`: pressão de canal, `value` entre 0 e 127.
- `polyAftertouch`: pressão por tecla, `midi` e `value` entre 0 e 127.
- `program`: instrumento General MIDI, `value` entre 0 e 127. `programChanges` continua disponível para compatibilidade.

O parser mantém `note.duration` incluindo o pedal para representação visual e `note.keyDuration` até o note-off físico. A reprodução que aplica eventos CC64 deve soltar a tecla após `keyDuration ?? duration`. O exportador MIDI usa essa duração física com os controllers originais, sem prolongar o pedal duas vezes. Ao editar diretamente a duração física de uma nota, atualize também `keyDuration` ou remova essa propriedade. Arquivos JSON antigos sem eventos ou `keyDuration` seguem compatíveis.

`MidiDevices.onMessage` recebe esses eventos sem `time` e `track`; notas e pedal continuam também em `onNote`/`onSustain`. Um gravador que usa `onMessage` para CC64 deve evitar gravar o mesmo pedal novamente por `onSustain`. Os métodos de saída são `sendControl(controller,value,channel)`, `sendPitchBend(value,channel)`, `sendAftertouch(value,channel)` e `sendPolyAftertouch(midi,value,channel)`.

`MidiDevices.setInput('all')` seleciona todas as entradas disponíveis, inclusive as conectadas depois. `inputId` permanece `'all'` enquanto essa opção estiver ativa. `onNote`, `onSustain` e `onMessage` incluem `deviceId` na entrada real e nas solturas geradas por desconexão; somente as notas e o pedal da porta removida são liberados. Selecionar `'all'` antes de `connect()` apenas guarda a preferência e não solicita permissão automaticamente. O estado de pedal recebido representa cada porta; uma aplicação que queira unir pedais de portas no mesmo canal deve definir sua regra de combinação.

`SoundFontEngine` aplica os controllers, pitch bend e pressões pelo motor SpessaSynth. O sintetizador Web Audio interno aproxima volume, expressão, pan, pressão e pitch bend, incluindo sensibilidade em semitons pelo RPN 0; ele não reproduz todos os efeitos de um SoundFont.
