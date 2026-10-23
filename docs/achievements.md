# Conquistas e percursos

O PianoCraft distingue dois registros: o **score recente de domínio** (já existente, por música) e as **conquistas de percurso**, que guardam a melhor evidência de prática já obtida. Uma piora recente pode diminuir o primeiro; não apaga uma conquista passada.

Cada música tem até nove percursos: Melodia guiada, Ritmo e Recital, em mão esquerda, direita e ambas. Cada percurso tem 100 pontos possíveis. Mãos sem notas ficam indisponíveis. Completar uma mão não conclui automaticamente outra combinação.

Os pontos correspondem à melhor precisão comprovada nas notas da mão escolhida, ponderada pela cobertura da música. Exemplo: praticar perfeitamente metade das notas concede 50 pontos; repetir o mesmo trecho com o mesmo resultado concede zero. Acertar perfeitamente um trecho curto não comprova o restante da música. A precisão usa `hits / (hits + missed + errors)`; não confia no campo de precisão arredondada do histórico.

A Melodia aceita andamento reduzido, pois espera a execução, e exibe explicitamente que não comprova execução no tempo. Ritmo requer pelo menos 90% do andamento; Recital, 100%. Todos exigem um trecho concluído, sem transposição, todas as notas da mão escolhida incluídas e contagem de notas compatível. Tentativas interrompidas continuam no histórico de prática, mas não geram pontos de percurso.

Os marcos são metade das notas praticadas, todas as notas praticadas, 50, 80 e 95 pontos. A meta do percurso é atingida com cobertura integral e pelo menos 90 pontos. Esses marcos não concedem pontos extras e não afirmam domínio musical definitivo.

## API e persistência

`achievementContentKey(song)` cria uma chave determinística das notas, tempos, durações e divisão das mãos. IDs de notas e ordem do array não alteram a chave. A chave não depende de uma divisão fixa em frases.

`summarizeAchievements(song, history, { profile, ledger })` retorna os nove `tracks` (alias `paths`), marcos e o ledger normalizado. Cada percurso expõe `score`/`points`, `coverage`, `coveredNotes`, `noteCount`, `bestAccuracy`, `completed`, `evaluated`, `eligible`, rótulos e explicação. `totalPoints` soma os scores; `maxPoints` soma os 100 pontos dos percursos disponíveis.

`evaluateAchievementAttempt(song, ledger, attempt, { profile })` retorna `{ ledger, summary, gains, changed }`. `gains` contém `points`, `previousScore`, `score`, `coverageGain`, `track`, `newMilestones`, `qualified` e `reason`. O chamador usa esses ganhos para uma comemoração apenas na conclusão real. `compareAchievements(before, after, attempt)` fornece a mesma comparação entre resumos.

Novas tentativas informam `songContentKey`, `scopeComplete`, `start`, `end`, `expectedNotes`, `speed`, `transpose`, `seconds`, mãos, modo e contadores. `scopeComplete` só pode ser verdadeiro se a seleção de pistas inclui todas as notas da mão escolhida nesse intervalo. A chave deve representar a versão capturada no início da tentativa, evitando creditar uma edição do arranjo a uma prática anterior.

`normalizeAchievementLedger(input, song, { profile })` verifica música, perfil, chave e limites. O ledger versionado guarda intervalos por índice das notas, com precisão máxima em centésimos de porcentagem. Sobreposições usam o máximo, nunca a soma; a representação compacta mantém exatamente a cobertura, inclusive em acordes e trechos sobrepostos. O limite de análise é de 200 mil notas válidas por música.

`mergeAchievementLedgers(song, ledgers, { profile })` normaliza e combina ledgers da mesma música, versão e perfil, preservando a maior precisão em cada nota. Restaurar um backup soma as evidências ausentes; não soma pontos duplicados e não apaga um resultado melhor já existente.

O ledger deve ser persistido por `[profile, songId, contentKey]`, independentemente do limite de linhas do histórico. Assim, apagar linhas antigas ou repetir a mesma tentativa após reabrir não concede os mesmos pontos novamente. As conquistas são locais; não têm valor monetário nem serviço externo.

O histórico antigo só pode semear o ledger silenciosamente quando contém arranjo completo, andamento e transposição conhecidos e uma chave de análise correspondente à análise atual. Linhas antigas sem versão confiável não geram conquistas presumidas. Importar ou abrir o histórico não dispara uma comemoração.

## Retorno na interface

A conclusão mostra precisão, pontos novos, marcos e o score da música quando já existe avaliação. Em um exercício com várias repetições, os pontos são reunidos para o resumo final. Voltas intermediárias só exibem um aviso compacto quando conquistam algo novo; não interrompem a preparação nem recebem um som a cada volta. Uma tarefa de escuta pode ser concluída sem conceder pontos de execução.

O aviso oferece Continuar, Ver progresso e Praticar novamente. Some automaticamente e respeita movimento reduzido; o foco permanece no teclado. O som breve pode ser desativado nas configurações. Importar conquistas, trocar de perfil ou abrir resultados antigos não produz uma comemoração. Mudanças de música, modo, mão ou versão do arranjo não misturam os resultados de uma rotina.
