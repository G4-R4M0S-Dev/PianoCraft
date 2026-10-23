# Plano de estudo por estruturas

`src/music/study-plan.js` transforma a análise revisável da música em exercícios sobre o próprio MIDI. Não cria arquivos de trechos nem depende de um serviço de IA. As famílias e as variações vêm de `analyzePatterns`; o plano não inventa uma quantidade fixa de frases ou uma primeira seção já aprendida.

## API

```js
buildStudyPlan(song, analysis, {
  history: [], profile: 'Meu perfil', progress: null, sessionMinutes: 20,
  targetPatternId: undefined
})
```

`createStudyPlan` é um alias. O retorno contém `analysisKey` (o `revisionKey` da análise, com fallback para `contentKey`), `songId`, `profile`, `objective`, `summary`, `patternsProgress`, `sessions`, `exercises`, `startingPoints`, `progress` e `warnings`. `targetPatternId` permite escolher a família do plano; uma opção ausente ou inválida mantém a recomendação automática. O retorno informa a família efetiva em `targetPatternId` e a recomendada em `recommendedPatternId`. Essa escolha não modifica a evidência medida nem elimina checklists de outras famílias.

Cada exercício tem `id`, `type`/`kind`, `title`, `instruction`, `instructions`, `start`, `end`, `patternId`, `phraseId`, `hands`, `mode`, `speed`, `repeatCount` e `completed`. `speed` é uma razão, por exemplo `0.6`. A comparação inclui `compareWith: { start, end, phraseId }`; os pontos de partida usam `points: [{ start, end, phraseId, patternId }]`; a recuperação de memória indica `hideGuides: true`. A interface deve oferecer reprodução da referência e da reaparição e interpretar essas opções ao iniciar a prática.

O plano sugere sete sessões sem datas ou lembretes. Cada uma leva o tempo informado (5–90 minutos, 20 por padrão), permitindo rever, espaçar ou repetir as atividades. A sequência percorre reconhecimento, mãos separadas, coordenação, pulso, comparação, transição, recuperação e avaliação. O próximo objetivo favorece uma base recorrente; depois de haver evidência inicial da base, favorece uma variação ainda não avaliada. Os contornos descritos são calculados das notas da voz melódica selecionada. Não se apresentam nomes de seções formais como se fossem certezas da análise.

## Evidência de prática

O histórico é filtrado por ID da música e perfil. Uma tentativa com `analysisKey` diferente é descartada. Para associar uma tentativa a uma frase, seus limites (`phraseStart`/`phraseEnd` ou `start`/`end`) precisam coincidir com o trecho; uma pontuação da música inteira, um loop parcial ou uma transição entre duas frases não atestam o desempenho de uma frase isolada. Registros repetidos com o mesmo ID contam uma única vez.

Há três estados descritivos: **não avaliado**, **em estudo** e **consolidando**. A referência inicial de consistência são três tentativas qualificadas entre as cinco mais recentes de cada trecho. Uma tentativa qualificada exige:

- análise atual, tentativa completa, modo Ritmo ou Recital e ambas as mãos;
- `fullArrangement: true`, indicando avaliação de todas as notas praticáveis do trecho, e `transpose: 0` constante na tentativa;
- andamento registrado de pelo menos 90% e precisão de pelo menos 90%;
- acertos positivos e tempo decorrido compatível com o trecho;
- quando `expectedNotes` foi registrado, ao menos 80% desse total atingido.

Históricos antigos sem andamento, escopo do arranjo, transposição ou chave da análise podem demonstrar contato com uma frase correspondente, mas não qualificam consistência. A interface calcula o escopo ao iniciar a sessão e invalida a transposição ou o andamento quando eles mudam durante a execução. A seleção “Ambas as mãos”, sozinha, não comprova que as pistas de acompanhamento foram avaliadas: pistas em Automático ou Mudo podem reduzir as notas exigidas. Melodia com espera pelas notas, precisão isolada de 100%, tarefa assinalada e sucesso apenas na base não atestam as variações. A explicação visível informa os critérios e os números. Mesmo “consolidando” não declara domínio musical; o resultado deve ser confrontado com pulso, duração e recuperação em outros pontos.

## Persistência

```js
normalizeStudyProgress(input, { analysisKey, songId, profile })
// { version: 1, analysisKey, songId, profile,
//   completedSessions: [], completedExercises: [] }
```

O progresso contém apenas checklists declarados pelo usuário. Nunca é usado para calcular as tentativas ou a precisão. A identidade de perfil, música e revisão da análise precisa coincidir; diferenças descartam o checklist recebido. IDs dos exercícios são estáveis para o mesmo conteúdo, trecho e configuração. É possível filtrar IDs importados com `validSessionIds`/`validExerciseIds`; a lista é limitada e deduplicada. Esses dados devem ser persistidos por perfil e música e incluídos nos backups do projeto. Edições nas notas, nos limites ou no agrupamento geram outra chave, impedindo reutilizar progresso medido de um arranjo anterior como se o conteúdo fosse igual.

Os pontos de partida são embaralhados de forma reproduzível com a identidade da análise e o perfil. Todos pertencem a frases reais e seus limites permanecem dentro da música. O exercício permite começar diretamente nesses pontos, incluindo as partes posteriores, sem exigir reproduzir os compassos anteriores.

## Validação

`node --test tests/study-plan.test.js` cobre ausência de histórico, prioridade de variações após evidência da base, exclusão de perfis/músicas/análises diferentes, limites exatos, critérios de andamento/modo/mãos, deduplicação, declínio recente de desempenho, checklists separados da medida, IDs estáveis, pontos de partida e entradas vazias/malformadas. Os testes não afirmam a qualidade musical subjetiva da segmentação; isso continua revisável na interface.
