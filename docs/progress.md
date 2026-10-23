# Progresso por música

O painel reúne as tentativas de cada música e perfil em uma ficha: sessões, tempo efetivo, precisão ponderada, evolução, cobertura avaliada e pontos de atenção. Cada repetição do loop é uma tentativa. O identificador `practiceSessionId` reúne as tentativas da mesma visita à música; `attemptId` permite ignorar cópias de uma tentativa importada. Registros de versões anteriores, sem identificador de sessão, são agrupados por intervalos de até 30 minutos e aparecem como estimativas.

## Evidência de evolução

A precisão usa `acertos / (acertos + erros + notas perdidas)`, ponderando a quantidade de notas e erros em vez de tirar a média simples das porcentagens. A curva mostra até vinte sessões agregadas. A comparação em pontos percentuais considera a modalidade, as mãos e uma faixa de andamento semelhantes, após ao menos quatro sessões comparáveis. A modalidade guiada fica identificada como tal.

O score de 0 a 100 é uma estimativa conservadora, distinta da conclusão de exercícios. Para participar dele, uma tentativa deve concluir seu intervalo em Ritmo ou Recital, com o arranjo completo, as duas mãos, sem transposição, entre 90% e 110% do andamento original e tempo de execução coerente com a extensão do trecho. Registros antigos sem velocidade e configuração não demonstram esses requisitos. Em cada região, contam as três avaliações mais recentes, a precisão e a recorrência em sessões distintas. Regiões não avaliadas não somam pontos. Um fragmento perfeito não gera domínio da música inteira; regressões posteriores podem reduzir o score. O status máximo exibido é “Consistente”, sem prometer domínio definitivo.

## Erros localizados

`PracticeSession` registra o tempo da nota esperada, notas esperadas/tocadas, tipo e motivo de cada penalidade. O registro se agrega quando o mesmo erro volta ao mesmo ataque, sem alterar os contadores de avaliação. São guardados até 128 locais distintos por tentativa. `errorEventsDropped` informa detalhes excedentes; os totais continuam íntegros. Notas perdidas são contabilizadas uma vez, e uma penalidade de duração não é duplicada pelo pedal.

O mapa usa as últimas cinco sessões da música para que erros antigos já resolvidos deixem de dominar as sugestões. As janelas têm aproximadamente dois compassos no andamento inicial, limitadas a 2–12 segundos. São intervalos temporais, sem afirmar numeração exata de compassos quando o MIDI muda de métrica ou andamento. Cada janela indica o tipo predominante, número de ocorrências, tentativas e sessões distintas. “Recorre em sessões” exige ao menos duas sessões. “Repete em tentativas” pode ocorrer dentro de uma única sessão. Os dados indicam recorrência observada, sem diagnosticar um vício motor. O botão de prática entrega o intervalo original da música para repetição dirigida.

Históricos antigos sem localização permitem exibir os totais, mas não inventam um mapa de erros. Novas tentativas alimentam o mapa automaticamente.

## Integração e validação

`src/music/progress.js`: `normalizeAttempt`, `normalizeErrorEvents`, `summarizeProgress(songs, history, { profile })`, `songProgress(song, history, { profile })`.

`src/progress-panel.js`: `ProgressPanel({ host, onPractice, onOpenSong, onError }).setData(songs, history, { profile })`. O painel inclui busca, ordenação, fichas expansíveis e um resumo de até doze sessões; não despeja cada loop no histórico.

Os testes unitários verificam isolamento por música/perfil, agrupamento de sessões, importação duplicada, cobertura e score, regressão, tendência comparável, recorrência e integridade dos contadores. `scripts/qa-progress-panel.mjs` verifica os controles reais no Electron, os intervalos entregues à prática, títulos tratados como texto e isolamento de perfil.
