# Jornada de estudo

Na versão 0.8, **Praticar música inteira** é a ação principal ao abrir uma música: prepara a execução do início ao fim, sem repetir automaticamente nem interromper a cada frase. A jornada aparece como **Estudo por trechos · opcional** e só começa quando a pessoa escolhe **Estudar este trecho** ou **Continuar este trecho**. Ela usa as notas e os padrões locais do MIDI para propor uma missão e um próximo passo. Não chama serviços externos, não escreve no MIDI, não confirma sugestões como se fossem revisadas e não concede pontos por marcar uma tarefa.

## Escopo e andamento na interface

A página da música separa o botão principal, com duração e velocidade salva, da proposta de trecho, com intervalo e meta de execuções. Os nove percursos abrem a música inteira no modo e com as mãos escolhidos. A prática mantém visíveis o intervalo em execução e o estado da repetição. **Música inteira** encerra o exercício ou frase atual, restaura os limites completos, desliga a repetição e fecha o aviso de conclusão do trecho.

O campo numérico e o controle deslizante de **Velocidade** aceitam 20% a 150%; **−/+** mudam cinco pontos percentuais, e **75%/100%** são atalhos. Uma escolha manual fica salva por música e perfil e prevalece sobre o andamento sugerido pela jornada, inclusive ao reabrir o aplicativo. Recital exige 100% sem substituir essa preferência. Ao sair de Recital, o andamento preferido volta a valer.

Quando há uma velocidade escolhida manualmente, a meta concluída avança entre mãos, trechos e modos mantendo esse andamento, com a exceção de Recital. Sem essa preferência, o motor conserva a progressão de andamento descrita abaixo. A tarefa seguinte só inicia quando escolhida.

## API

`buildLearningJourney(song, { profile, history, achievements, state })` retorna:

- `task`: missão serializável, ou `null` quando não há notas para praticar.
- `progress`: `{value, label, detail, description, stage, points, maxPoints}`. O rótulo é **Progresso de estudo** e o valor é o percentual dos pontos permanentes nos percursos elegíveis. Melodia contribui imediatamente; a avaliação técnica recente permanece separada.
- `state`, `streak`, `requiredStreak`, `resumable`, `nextActionLabel`.
- `suggestedStructure` e `structure`: indicam se a estrutura é uma hipótese automática, sem exigir uma etapa manual antes de começar.

`learningProgress(song, { profile, history, achievements })` calcula só o resumo de progresso, sem analisar frases. É apropriado para as linhas da biblioteca. Resumos de conquista de outra música, perfil ou versão do arranjo são ignorados.

`createJourneyTask(song, options)` cria uma missão para uma seleção explícita. Aceita `mode`, `hands`, `speed`, `start`, `end`, `phraseId`, `patternId`, `title`, `instruction` e `reason`. Copiar o intervalo de uma missão permite criar outra tarefa para aquele trecho; isso não muda o comportamento dos nove botões de percurso, que na interface abrem a música inteira. Os padrões do motor, quando `speed` não é informado, são 60% em Melodia, 90% em Ritmo e 100% em Recital. Uma velocidade explícita entre 20% e 150% é preservada. A integração aplica a preferência salva antes de iniciar a tarefa; Recital sempre fica em 100%. Uma seleção de mão sem notas retorna `null`.

Cada tarefa contém `id`, `contentKey`, `title`, `instruction`, `start`, `end`, `mode`, `hands`, `speed`, `repeatCount`, `targetAccuracy`, `targetStreak`, `guided`, `patternId`, `phraseId`, `patternLabel`, `reason`, `occurrences`, `suggestedStructure`, `noteCount`, `estimatedSeconds` e `streak`. `occurrences` é uma lista de `{phraseId, start, end, variant, label}`.

`normalizeJourneyState(input, song, {profile})` valida e devolve um cursor serializável:

```js
{
  version: 1, songId, profile, contentKey, task,
  streak: 0, passed: [], seenAttemptIds: [],
  lastAttemptId: '', lastAccuracy: null, lastOutcome: 'new',
  started: false, startedAt: null, updatedAt: null,
  completed: false,
  // position é opcional e limitado ao intervalo da missão
}
```

Persistir `started: true` ao iniciar permite oferecer **Continuar este trecho** mesmo quando o aluno pausa antes de terminar. A posição é informativa: uma nova execução começa no início do trecho para preservar a avaliação do escopo inteiro. Ao escolher outra missão, o chamador deve zerar `streak`. O histórico de deduplicação e os objetivos anteriores podem ser preservados. O cursor fica isolado por perfil, música, notas e atribuição de mãos; renomear a música não o invalida.

`evaluateJourneyAttempt(song, state, attempt, {profile, preferredSpeed})` retorna `{state, task, nextTask, goalMet, streak, requiredStreak, actionLabel, summary, changed, qualified, reason}`. `task` é a missão avaliada. `preferredSpeed` é opcional e aceita de `0.2` a `1.5`; a integração passa a escolha manual salva, sem fabricar uma preferência para quem ainda não a fez. Em três acertos consecutivos, `state.task` passa à proposta seguinte, com `state.streak = 0`; o resultado mantém `streak = 3`. Esse avanço não inicia áudio nem reprodução: o aluno escolhe quando começar.

## Regras de avaliação

Uma execução só altera a sequência se estiver concluída, incluir todas as notas da mão escolhida, tiver contagem de notas coerente, duração suficiente, mesma música, perfil, conteúdo, intervalo, modo, mão e andamento, e nenhuma transposição. A precisão vem dos acertos, erros e notas perdidas; um campo de precisão declarado não substitui essas contagens. Um estado antigo e uma tentativa antiga são rejeitados. `journeyTaskId`, quando presente, precisa coincidir com a missão atual. A integração chama a avaliação apenas para exercícios guiados e grava esse identificador em cada tentativa.

São necessárias três execuções consecutivas com pelo menos 90% de precisão. Uma execução completa abaixo da meta reinicia a sequência. Pausa, prévia, tentativa parcial e alteração de configuração não são falhas e não mudam a sequência. Os últimos 256 identificadores de tentativa impedem que a mesma execução seja contada novamente. O registro de até 4096 objetivos percorridos é apenas um cursor de estudo, sem efeito nos pontos das conquistas.

Depois da meta, sem `preferredSpeed`, a proposta aumenta o andamento em dez pontos percentuais até 100%. Com `preferredSpeed`, pula esse aumento e mantém a velocidade escolhida nas tarefas seguintes; Recital usa 100%. Em Melodia, a sequência segue para a outra mão quando ela existe, depois ambas, depois o trecho seguinte. As reaparições de padrões são identificadas, mas continuam exigindo execução própria. Depois dos trechos de Melodia, vêm Ritmo e Recital. Em arranjos de uma só mão, exercícios vazios da outra mão são omitidos. O fim do ciclo sugere revisar pontos de partida; não declara a música dominada.

Uma execução com menos de 70% de precisão propõe revisão. Sem `preferredSpeed`, a sugestão reduz o andamento, até 40% em Melodia ou 60% em Ritmo; um Recital difícil propõe Ritmo a 90%. Com a preferência manual, a revisão preserva a velocidade escolhida e informa que ela pode ser ajustada na barra; a revisão de Recital passa a Ritmo. A sugestão só é aplicada ao ser escolhida, sem mudar silenciosamente o cursor atual.

## Estrutura e custo

O motor aproveita os cortes revisados existentes. Na ausência deles, analisa padrões automaticamente e mantém `suggestedStructure: true`. Frases extensas são praticadas em porções de até quatro compassos; compassos muito lentos são limitados a vinte segundos. A identidade editorial original é preservada. Introduções vazias extensas não geram um exercício sem notas. A análise é armazenada em cache por objeto, conteúdo, tempo, compasso e estrutura; alterações nessas fontes invalidam o cache.

Quando ainda não existe um cursor iniciado, erros registrados nas cinco sessões recentes podem recomendar a primeira missão. O motor usa somente eventos de erro da mesma música, perfil e versão do conteúdo, limitados a cinquenta tentativas. Recorrência entre sessões tem prioridade sobre muitos erros em uma única repetição. O local precisa corresponder a um trecho com notas; a mão vem da seleção gravada ou das notas esperadas naquele local. Registros antigos sem identidade de conteúdo não são usados para essa recomendação. Um cursor já iniciado sempre prevalece. Esses eventos ajudam a escolher o foco e não concedem pontos nem comprovam um vício de execução.

Verificação: `node --test tests/learning-journey.test.js` cobre missão inicial, análise automática, trechos extensos, silêncio, retomada, isolamento, três execuções, revisão de dificuldades, sequência entre mãos e modos, ausência de mão, duplicação, registros antigos, contagens inválidas, progresso permanente sem pontos artificiais e respeito à velocidade manual em toda a faixa suportada. `tests/practice-preferences.test.js` verifica preferências por música/perfil e a normalização dos dados salvos; `scripts/qa-simple-practice.mjs` exercita a interface e a persistência integradas em perfil temporário com MIDI simulado.
