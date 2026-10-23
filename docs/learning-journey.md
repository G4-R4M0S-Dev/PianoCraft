# Jornada de estudo

A jornada dá uma missão concreta ao abrir uma música e propõe o próximo passo depois de uma execução. Ela usa as notas e os padrões locais do MIDI. Não chama serviços externos, não escreve no MIDI, não confirma sugestões como se fossem revisadas e não concede pontos por marcar uma tarefa.

## API

`buildLearningJourney(song, { profile, history, achievements, state })` retorna:

- `task`: missão serializável, ou `null` quando não há notas para praticar.
- `progress`: `{value, label, detail, description, stage, points, maxPoints}`. O rótulo é **Progresso de estudo** e o valor é o percentual dos pontos permanentes nos percursos elegíveis. Melodia contribui imediatamente; a avaliação técnica recente permanece separada.
- `state`, `streak`, `requiredStreak`, `resumable`, `nextActionLabel`.
- `suggestedStructure` e `structure`: indicam se a estrutura é uma hipótese automática, sem exigir uma etapa manual antes de começar.

`learningProgress(song, { profile, history, achievements })` calcula só o resumo de progresso, sem analisar frases. É apropriado para cartões da biblioteca. Resumos de conquista de outra música, perfil ou versão do arranjo são ignorados.

`createJourneyTask(song, options)` cria uma missão para uma seleção explícita. Aceita `mode`, `hands`, `speed`, `start`, `end`, `phraseId`, `patternId`, `title`, `instruction` e `reason`. Copiar o intervalo da missão atual permite escolher outro percurso sem reiniciar a música inteira. Os padrões iniciais de andamento são 60% em Melodia, 90% em Ritmo e 100% em Recital. Recital sempre fica em 100%. Uma seleção de mão sem notas retorna `null`.

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

Persistir `started: true` ao iniciar permite oferecer **Continuar** mesmo quando o aluno pausa antes de terminar. A posição é informativa: uma nova execução começa no início do trecho para preservar a avaliação do escopo inteiro. Ao escolher outra missão, o chamador deve zerar `streak`. O histórico de deduplicação e os objetivos anteriores podem ser preservados. O cursor fica isolado por perfil, música, notas e atribuição de mãos; renomear a música não o invalida.

`evaluateJourneyAttempt(song, state, attempt, {profile})` retorna `{state, task, nextTask, goalMet, streak, requiredStreak, actionLabel, summary, changed, qualified, reason}`. `task` é a missão avaliada. Em três acertos consecutivos, `state.task` passa à proposta seguinte, com `state.streak = 0`; o resultado mantém `streak = 3`. Esse avanço não inicia áudio nem reprodução: o aluno escolhe quando começar.

## Regras de avaliação

Uma execução só altera a sequência se estiver concluída, incluir todas as notas da mão escolhida, tiver contagem de notas coerente, duração suficiente, mesma música, perfil, conteúdo, intervalo, modo, mão e andamento, e nenhuma transposição. A precisão vem dos acertos, erros e notas perdidas; um campo de precisão declarado não substitui essas contagens. Um estado antigo e uma tentativa antiga são rejeitados. `journeyTaskId`, quando presente, precisa coincidir com a missão atual. A integração chama a avaliação apenas para exercícios guiados e grava esse identificador em cada tentativa.

São necessárias três execuções consecutivas com pelo menos 90% de precisão. Uma execução completa abaixo da meta reinicia a sequência. Pausa, prévia, tentativa parcial e alteração de configuração não são falhas e não mudam a sequência. Os últimos 256 identificadores de tentativa impedem que a mesma execução seja contada novamente. O registro de até 4096 objetivos percorridos é apenas um cursor de estudo, sem efeito nos pontos das conquistas.

Depois da meta, a proposta aumenta o andamento em dez pontos percentuais até 100%. Em Melodia, segue para a outra mão quando ela existe, depois ambas, depois o trecho seguinte. As reaparições de padrões são identificadas, mas continuam exigindo execução própria. Depois dos trechos de Melodia, vêm Ritmo e Recital. Em arranjos de uma só mão, exercícios vazios da outra mão são omitidos. O fim do ciclo sugere revisar pontos de partida; não declara a música dominada.

Uma execução com menos de 70% de precisão propõe reduzir o andamento, até 40% em Melodia ou 60% em Ritmo. Um Recital difícil propõe revisão em Ritmo a 90%. A redução só é aplicada ao escolher a sugestão; o cursor atual não muda silenciosamente.

## Estrutura e custo

O motor aproveita os cortes revisados existentes. Na ausência deles, analisa padrões automaticamente e mantém `suggestedStructure: true`. Frases extensas são praticadas em porções de até quatro compassos; compassos muito lentos são limitados a vinte segundos. A identidade editorial original é preservada. Introduções vazias extensas não geram um exercício sem notas. A análise é armazenada em cache por objeto, conteúdo, tempo, compasso e estrutura; alterações nessas fontes invalidam o cache.

Quando ainda não existe um cursor iniciado, erros registrados nas cinco sessões recentes podem recomendar a primeira missão. O motor usa somente eventos de erro da mesma música, perfil e versão do conteúdo, limitados a cinquenta tentativas. Recorrência entre sessões tem prioridade sobre muitos erros em uma única repetição. O local precisa corresponder a um trecho com notas; a mão vem da seleção gravada ou das notas esperadas naquele local. Registros antigos sem identidade de conteúdo não são usados para essa recomendação. Um cursor já iniciado sempre prevalece. Esses eventos ajudam a escolher o foco e não concedem pontos nem comprovam um vício de execução.

Verificação: `node --test tests/learning-journey.test.js` cobre missão inicial, análise automática, trechos extensos, silêncio, retomada, isolamento, três execuções, revisão de dificuldades, sequência entre mãos e modos, ausência de mão, duplicação, registros antigos, contagens inválidas e progresso permanente sem pontos artificiais.
