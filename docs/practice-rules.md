# Regras de avaliação da prática

O avaliador em `src/music/practice.js` usa dois relógios. `time` é a posição da música, em segundos; `wallTimeMs` é o relógio monotônico real (`performance.now()`), em milissegundos. O modo Melodia pode parar a música à espera do aluno, mas esse congelamento não prolonga a janela de um acorde.

Para eventos MIDI, passe o timestamp original recebido pelo dispositivo. A dispersão do acorde usa a diferença entre o maior e o menor timestamp dos ataques, preservando seus intervalos quando mensagens ficam na fila após uma pausa do processamento. O relógio interno de duração continua monotônico; atualizar o transporte antes de consumir uma fila MIDI não transforma ataques separados em ataques simultâneos. A expiração visual da tentativa começa quando o primeiro evento é observado, permitindo processar um acorde válido que chegou em lote.

## Acordes e ataques

- Notas do mesmo início formam um grupo indivisível. A tolerância numérica de agrupamento é de um microssegundo; onsets diferentes continuam sendo grupos diferentes.
- Todos os ataques do grupo precisam ocorrer em até **120 ms reais** entre o primeiro e o último. `chordWindowMs` permite ajustar esse valor.
- Todas as alturas precisam estar fisicamente pressionadas quando o grupo fica completo. Soltar uma tecla antes disso invalida a tentativa, mesmo com pedal.
- Um grupo incompleto registra **zero acertos**. Somente a conclusão do acorde acrescenta todas as suas notas ao conjunto `hits` e libera a espera.
- Uma tentativa expirada ou invalidada exige novos ataques. Teclas ainda seguradas da tentativa anterior não são reaproveitadas.
- Um novo `note-on` da mesma origem enquanto a tecla continua pressionada é ignorado. Notas repetidas precisam de soltura e novo ataque.
- Uníssonos simultâneos de várias pistas correspondem a uma única tecla física. Um ataque satisfaz esses uníssonos quando todo o grupo estiver completo.
- O próximo grupo é avaliado em ordem cronológica. Uma nota pertencente a um início posterior não completa o acorde atual.

O modo Melodia permite atacar o início esperado até 200 ms antes ou depois da posição da música. Ritmo e Recital usam 250 ms e marcam como perdidas todas as notas de um grupo que passou dessa tolerância sem ser aceito. `onsetTolerance`, em segundos, configura essa margem. A janela de 120 ms para formar o acorde também é exigida em Ritmo e Recital.

Uma tentativa de acorde que expira ou perde uma tecla registra um erro. Notas erradas e ataques fora da margem registram erros próprios. Um grupo que simplesmente passou da margem em Ritmo/Recital acrescenta suas notas a `missed`, uma única vez.

## Soltura e duração

Depois de acertar o ataque, soltar a tecla muito cedo registra um erro de duração, mantendo os acertos de ataque. O padrão exige `duração × 0,6 − 0,12 s`, com mínimo zero. `releaseRatio` e `releaseTolerance` configuram esses valores. Em um uníssono vale a maior duração física das vozes que compartilham a tecla.

O tempo de sustentação é medido entre os timestamps originais de ataque e soltura e convertido pela velocidade da reprodução, inclusive quando a Melodia está parada no início seguinte. `setSpeed()` registra as mudanças de velocidade para integrar corretamente cada trecho da sustentação. Uma soltura recebida em lote após um atraso de processamento conserva sua duração física original.

`keyDuration` representa a soltura física e tem precedência sobre `duration`, que pode incluir pedal. Quando `keyDuration` existe, pedal não dispensa a duração física. Se só houver `duration`, `release(..., { sustain: true, pedalKey })` mantém pendente o restante da duração acústica até `setSustain(pedalKey, false, timestamp)`. Soltar o pedal cedo demais registra o erro de duração; mantê-lo pelo tempo necessário conclui a verificação. As pendências são isoladas pela chave do pedal/canal. Essa informação nunca mantém uma tecla no conjunto fisicamente pressionado e, portanto, nunca completa um acorde já solto.

## Contrato com a interface

```js
const practice = new PracticeSession(notes, {
  mode, hands, configs, start, end, speed,
  chordWindowMs: 120,
});

// sourceKey identifica a tecla na origem, incluindo dispositivo/canal/altura.
const sourceKey = `midi:${deviceId}:${channel}:${pitch}`;
practice.input(pitch, songTime, transpose, performance.now(), sourceKey);

// Retorno é uma nota representativa apenas ao concluir todo o grupo.
// O resultado detalhado fica em practice.lastResult:
// pending  -> tentativa válida incompleta; não exibir como nota incorreta.
// accepted -> notes contém todas as notas do grupo aceito.
// rejected -> reason explica a falha; errors já foi atualizado.
// duplicate / ignored -> nenhum novo acerto ou erro.

practice.release(pitch, songTime, transpose, performance.now(), sourceKey, {
  sustain: pedalDaOrigem,
  pedalKey: `channel:${channel}`,
});
// Enviar o estado agregado (PC + dispositivos físicos) do canal.
practice.setSustain(`channel:${channel}`, pedalPressionado, performance.now());
practice.advance(songTime, performance.now()); // também enquanto Melodia espera
practice.setSpeed(newSpeed, performance.now());
practice.clearInput('pause'); // também em seek, troca de música e limpeza de som
```

A interface não deve adicionar outro erro de duração. `release()` e a soltura do pedal por `setSustain()` fazem essa avaliação e incrementam `errors` e `durationErrors`. `durationErrorsAdded` informa a quantidade de novos erros no resultado retornado. `clearInput()` cancela tentativas, estados de pedal e verificações de duração pendentes sem penalidade, preservando a pontuação existente. Ao buscar outra posição da música, uma nova sessão com `start` impede o retorno de notas anteriores.

`next()`, `gate()`, `hits`, `missed`, `errors`, `accuracy` e `complete` preservam o contrato de transporte e placar. `expectedNotes()` fornece uma cópia das notas do grupo atual para instruções e luzes. `complete` indica que todos os ataques foram acertados ou perdidos; a avaliação de duração pode acrescentar um erro na soltura posterior.

## Verificação

`node --test tests/practice.test.js` cobre acordes separados por 500 ms sem acertos, acordes simultâneos em 80 ms, soltura prematura, janela configurável, tentativas expiradas e reataque, uníssonos, onsets próximos, margens de Ritmo/Recital, duração, velocidade, pedal, limpeza em pausa/busca e origens físicas/PC independentes.

Os testes exercitam o avaliador com eventos explícitos. O ensaio com um teclado MIDI físico continua necessário para verificar latência, seleção da porta e protocolos de iluminação do hardware.
