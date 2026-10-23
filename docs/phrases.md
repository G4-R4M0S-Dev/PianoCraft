# Estrutura musical e prática por frases

O PianoCraft mantém o MIDI inteiro e guarda trechos opcionais de estudo dentro da música. Na versão 0.8, o botão principal **Praticar música inteira** prepara a execução do início ao fim, sem loops automáticos ou interrupções entre frases. Para treinar partes, escolha **Estudar este trecho** ou **Continuar este trecho** em **Estudo por trechos · opcional**, ou selecione uma frase no estúdio. Confira o intervalo e a quantidade de execuções antes de começar. **Música inteira** sai desse treino e desliga a repetição.

A análise opcional reconhece padrões melódicos, suas reaparições e pequenas variações. A quantidade de frases depende dos indícios encontrados em cada arranjo; não existe uma quantidade fixa nem uma duração padrão de frase. A existência de frases salvas ou sugeridas não obriga a praticá-las ao escolher a música inteira.

## Analisar, comparar e revisar

Na página da música, abra **Estrutura e padrões** e escolha **Analisar padrões da música**. É possível deixar a escolha da pista melódica automática ou selecionar outra pista. O mapa mostra a ordem das famílias ao longo da música: a mesma letra identifica uma família, o símbolo `′` marca uma variação e uma reaparição transposta pode conservar o desenho em outro registro. Uma família com uma única ocorrência continua disponível para estudo e não é apresentada como repetição confirmada.

Selecione um trecho para ouvir sua referência, comparar as mudanças de notas, ritmo ou registro e praticá-lo diretamente. Se o agrupamento não fizer sentido musicalmente, atribua o trecho a outra família, crie uma família ou renomeie a família. **Salvar estrutura revisada** aplica o mapa à música e atualiza os exercícios. O rascunho pode ser fechado sem substituir o mapa salvo.

Use **Revisar limites das frases** ou **Organizar frases** para ajustar os cortes, dividir, unir e renomear trechos. A opção principal desse editor também é **Padrões melódicos · automático**. As opções **Compassos · manual** e **Quantidade de frases · manual** permanecem como alternativas para quem deseja uma organização específica. Esses alvos são pedidos de edição, não afirmações sobre a forma da composição.

Salvar uma revisão com limites alterados recalcula a comparação e as famílias a partir dos novos trechos. Isso pode mudar as relações antes atribuídas aos trechos. Salvar apenas nomes de frases, mantendo IDs e limites, preserva os grupos e as revisões de família já feitos. Renomear uma família no mapa também preserva seu agrupamento, mas altera a identidade da revisão usada pelo plano.

## O que a análise usa

`src/music/patterns.js` converte o mapa de andamentos em posições musicais e respeita a fórmula de compasso. Procura pausas, pontos de apoio, notas mais longas e sequências melódicas recorrentes para sugerir limites. Compara alturas relativas, intervalos, contorno e ritmo das frases para separar reaparições exatas, transposições e variações. Ritmo igual ou uma única altura repetida, sozinhos, não confirmam uma família melódica.

A seleção automática da melodia é uma hipótese baseada nas pistas e nos ataques do MIDI. A voz superior de cada ataque serve de referência quando a pista mistura várias alturas. O usuário pode selecionar outra pista para conferir o resultado. Acompanhamento sustentado e caudas de pedal não devem apagar uma pausa da voz melódica; a duração física `keyDuration` tem preferência sobre a duração acústica `duration` para avaliar esses limites.

As justificativas, diferenças e indicadores de confiança ajudam na revisão. A confiança exprime indícios da heurística, não uma probabilidade calibrada. A análise não determina com certeza cadências, versos ou refrões. Vozeamento complexo, anacruses e melodia misturada ao acompanhamento podem exigir intervenção. Notas ainda pressionadas num corte recebem aviso.

Nenhuma revisão corta, apaga, duplica ou move os eventos do MIDI. Todos os tempos dos trechos são segundos do arquivo original, com início incluso e fim exclusivo para novos ataques. Um ataque exatamente em B pertence ao próximo trecho; o último fim corresponde ao final da música.

## Contrato v2 e compatibilidade

```js
// Fluxo padrão: não requer uma quantidade ou extensão predeterminada.
const structure = suggestPhrases(song);
// Equivalente explícito:
const structure2 = analyzePatterns(song, { tracks: [1] });

song.phrasing = normalizePhrasing({ ...structure, reviewed: true }, song.duration);

// Alternativas manuais, quando solicitadas pelo usuário:
const manualBars = suggestPhrases(song, { targetBars: barsChosenByUser });
const manualCount = suggestPhrases(song, { targetCount: countChosenByUser });
```

A estrutura v2 inclui `version`, `method`, `contentKey`, `revisionKey`, `reviewed`, `phrases`, `patterns`, `form`, `melodyTracks`, `warnings` e `analysis`. Cada frase tem ID, nome, início, fim, justificativa, confiança, família, rótulo, relação com a referência e características melódicas. Cada família identifica sua referência e lista as ocorrências. `form` representa a sequência dessas famílias na música.

`contentKey` identifica o conteúdo musical analisado; `revisionKey` identifica o mapa atual, incluindo limites e agrupamento. O normalizador recalcula a chave da revisão. Isso impede reutilizar a evidência de uma organização antiga como se ela avaliasse exatamente a revisão atual.

`normalizePhrasing` continua aceitando o formato v1 de projetos anteriores. As divisões já salvas permanecem disponíveis e não são substituídas automaticamente. Ao analisar e salvar o mapa de padrões, a música passa a guardar a estrutura v2. Os alvos manuais do motor anterior continuam disponíveis quando são explicitamente informados.

As operações puras de revisão em `src/music/phrases.js` continuam retornando uma nova lista:

- `splitPhrase(phrases, idOuIndice, time, duration)` divide um trecho.
- `mergePhrases(phrases, idOuIndice, duration)` une o selecionado ao seguinte.
- `movePhraseBoundary(phrases, idOuIndice, time, duration)` move o fim de um trecho e o início do seguinte.
- `getPhraseAtTime(phrases, time)` encontra o trecho correspondente, respeitando a fronteira exclusiva.
- `normalizePhrases(input, duration)` recupera uma partição contígua dentro da música, limitando textos e descartando entradas inválidas.
- `normalizePhrasing(input, duration)` valida os metadados conhecidos de v1 ou v2 sem modificar as notas.

## Exercícios e acompanhamento

O **Plano e exercícios** usa as famílias da música e o histórico do perfil atual. Propõe reconhecer o desenho, praticar mãos separadas e juntas, manter o ritmo, comparar a base com uma variação, ligar trechos e começar de pontos diferentes. A atividade de memória pode esconder os apoios visuais. As sete sessões são sugestões ajustáveis de estudo, sem datas ou lembretes automáticos.

Cada exercício contém `start` e `end` reais da música, configuração de mãos, modo, andamento e quantidade de repetições. Comparações guardam o intervalo da referência; desafios guardam os intervalos e famílias dos pontos de partida. Assim, é possível começar uma frase posterior diretamente ou treinar a transição entre duas frases sem gerar outro arquivo MIDI. Durante a prática, o intervalo selecionado limita a execução inclusive em Recital.

A barra de prática informa o escopo e o estado da repetição. Desligar a repetição faz uma passagem pelo intervalo escolhido; **Música inteira** restaura os limites completos e remove a meta do trecho. A velocidade ajustada manualmente fica salva por música e perfil e é respeitada pela jornada guiada; Recital exige 100% sem apagar essa escolha. Veja [a jornada de estudo](learning-journey.md) para as regras de meta e avanço.

As marcações **Revisei este exercício** e de sessão concluída são relatos do usuário, separados dos resultados ao tocar. Os estados **não avaliado**, **em estudo** e **consolidando** não declaram domínio automático. A referência inicial de consistência exige tentativas completas recentes em Ritmo ou Recital, arranjo completo, ambas as mãos, sem transposição, com andamento registrado de pelo menos 90% e precisão de pelo menos 90%. Históricos antigos sem os campos necessários não recebem essa qualificação. Mudanças no andamento ou na transposição durante a tentativa invalidam sua utilização para esse critério. Veja os detalhes em [study-plan.md](study-plan.md).

## Salvar e transportar o estudo

O armazenamento local conserva a estrutura na música, os resultados das tentativas e os checklists. O progresso é separado por **perfil, ID da música e chave da revisão**. Reanalisar os cortes ou alterar os grupos invalida a associação dos resultados anteriores ao mapa atual; outro perfil tem seu próprio acompanhamento.

O backup JSON inclui músicas, estrutura revisada, histórico, configurações e `studyProgress`. Ao importar, os checklists são normalizados e só são associados a uma música cuja chave de revisão corresponda. `normalizeSong` conserva `phrasing` nos projetos. O MIDI exportado continua inteiro, mas o formato SMF não carrega os metadados específicos de estrutura, exercícios ou progresso do PianoCraft; use o backup JSON para transportá-los.

## Validação

`tests/patterns.test.js` verifica a análise de recorrências, transposições, pequenas variações, escolha de melodia, revisão de grupos e identidades de conteúdo/revisão. `tests/phrases.test.js` mantém a cobertura dos alvos manuais, mapas de andamento/compasso, cortes, normalização e preservação dos eventos musicais. `tests/study-plan.test.js` cobre os exercícios nos intervalos reais, prioridade de variações, pontos de partida, critérios de evidência e isolamento do progresso. `tests/study-panel.test.js` verifica o painel em Electron isolado.

`scripts/qa-study-practice.mjs` exercita o fluxo integrado de estrutura, revisão, plano, prática e persistência com armazenamento isolado e sem usar o instrumento físico. Os scripts `qa-phrases-panel.mjs` e `qa-phrase-practice.mjs` continuam disponíveis para verificar o editor e a prática por trechos. Os resultados de testes do motor não substituem a revisão musical dos padrões sugeridos.
