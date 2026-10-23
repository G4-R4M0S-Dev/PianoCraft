# Estruturas melódicas e revisão

`src/music/patterns.js` analisa o conteúdo da música no computador. Não exige uma
quantidade de frases e não usa o número 11 do exemplo de Indila como regra.
Também não lê cortes antigos para escolher os novos limites. Não há chamada a
um modelo de IA: são heurísticas musicais explícitas, revisáveis e com evidência
das notas comparadas.

## O que é comparado

1. O mapa de andamento converte segundos em pulsos de semínima. A comparação de
   ritmo continua correta se a música acelerar ou desacelerar. Fórmulas como
   3/4 e 6/8 têm três pulsos de semínima por compasso. Um evento MIDI que apenas
   repete a fórmula anterior não cria uma seção nova.
2. A pista melódica pode ser escolhida pelo usuário. A inferência automática
   prefere uma parte ativa, aguda e relativamente monofônica; uma pista com uma
   única nota muito aguda não deve deslocar uma melodia completa. Em uma pista
   com acordes, usa-se a nota mais aguda de cada ataque e essa limitação é
   informada. O baixo sustentado de outra pista não esconde pausas da melodia.
3. Sementes de seis ataques com alturas relativas e distâncias rítmicas buscam
   retornos. As correspondências são estendidas para descobrir comprimentos
   variáveis, incluindo pequenas alterações. O mínimo de informação necessário
   aumenta em arranjos longos, evitando transformar cada pequena célula em uma
   frase independente.
4. Retornos maiores têm prioridade sobre pequenos motivos contidos neles. Os
   limites são mantidos coerentes entre suas ocorrências: não se corta uma
   ocorrência de A no meio enquanto outra permanece inteira. Pausas, notas
   longas, compassos e marcadores oferecem limites adicionais. Uma passagem sem
   evidência suficiente recebe um limite de apoio explícito para revisão.
5. Cada frase é comparada às primeiras ocorrências de outras famílias usando
   alinhamento de alturas e ritmo com inserções/omissões limitadas. Essa etapa
   distingue sequência igual, transposição e variação; informa alturas ou ritmo
   alterados, ataques acrescentados/omitidos e deslocamento de registro.

Um ritmo igual, um contorno genérico que sobe/desce, uma nota isolada ou várias
repetições de uma única altura não bastam para afirmar que duas melodias são a
mesma. Quando o material não confirma um retorno, o trecho fica como **único**.
Isso não significa que não exista parentesco musical: significa que o algoritmo
não o confirmou. A revisão pode corrigir pista, limites, família e rótulo.

Os rótulos A, B, C… identificam famílias locais à música. A′ indica uma variação
ou transposição, com a diferença descrita; não significa uma seção harmônica ou
uma identificação de verso/refrão. Um deslocamento de +12 semitons corresponde
à reapresentação uma oitava acima. Comparações de famílias não transferem
automaticamente domínio de execução para outra ocorrência.

## API

```js
const structure = analyzePatterns(song, { tracks: [1] });
// Reclassificar sem substituir limites já revisados:
const reclassified = analyzePatterns(song, {
  tracks: structure.melodyTracks,
  phrases: reviewedPhrases,
});
```

O resultado tem `version: 2`, `method: 'melodic-structure-v1'`, `phrases`,
`patterns`, `form`, `melodyTracks`, `warnings` e `analysis`.

Cada frase mantém `id`, `name`, `start`, `end`, `confidence` e `reason`, acrescidos
de `patternId`, `patternLabel`, `referencePhraseId`, `variant`, `similarity`,
`transpose`, `features` e `comparison`. Os valores de `variant` são `original`,
`exact`, `transposed`, `variation` e `unique`. `features` descreve contorno,
intervalos em semitons, ritmo em pulsos, notas repetidas, graus conjuntos,
saltos e registro. As ocorrências de uma família são IDs das frases em
`patterns[].occurrences`.

`contentKey` identifica o MIDI e a fonte melódica, considerando todas as notas,
inclusive as que excedem o limite de comparação. `revisionKey` identifica a
versão dos limites, famílias e rótulos: alterar a revisão invalida o plano e os
relatos associados à estrutura anterior sem fingir que o arquivo MIDI mudou.

`normalizePatternAnalysis(input, duration)` é a entrada segura de projetos e
backups. Limita dados e texto, restaura intervalos contíguos, remove campos
estranhos, reconstrói ocorrências e mapa de forma e recalcula `revisionKey`.
Não confia em IDs de ocorrências/representantes que não existam nas frases.
Preserva `manualReview` nas frases e famílias.

## Limites e validação

São comparados até 24.000 ataques melódicos, 2.200 pares de sementes e 30.000
pares de frases. O alinhamento usa até 96 notas por comparação, e a partição tem
até 512 trechos. Quando um limite é atingido, aparece um aviso de que podem
existir retornos não identificados; o MIDI original permanece completo.
Identificação de vozes internas em um único piano polifônico, cadências
harmônicas, tonalidade, dedilhado e nomes formais de seções não são inferidos.
Os índices de semelhança são medidas heurísticas, não probabilidades de que uma
divisão musical esteja correta.

Os testes incluem A/B com comprimentos diferentes, A transposto, final B′,
ornamentos, ritmo igual com melodias diferentes, notas isoladas, pedal, baixo
sustentado, seleção de pista, ruído agudo esparso, anacruse, mudanças de tempo e
compasso, persistência e revisão. Um MIDI mecânico com 3.600 ataques foi
analisado em aproximadamente 0,12 s nesta máquina, com comparações limitadas.

Na cópia isolada da biblioteca do usuário, sem alterar o perfil em uso:

| Arranjo completo | Trechos sugeridos | Famílias | Famílias com retornos |
|---|---:|---:|---:|
| Indila — Love Story (Easy), 239,906 s | 22 | 15 | 5 |
| A-ha — Take On Me (Easy), 197,506 s | 20 | 14 | 5 |

Essas contagens descrevem sugestões deste algoritmo; não são validação humana
dos limites nem substituem os 11 trechos da análise anterior como autoridade.
No Indila, o retorno de 1:14,06–1:28,44 aparece em 2:14,06–2:28,44 com registro
12 semitons acima e pequenas alterações. A família iniciada em 0:13,44–0:22,50
retorna perto de 0:43,44, 1:28,44 e 2:28,44. Isso permite estudar um desenho
principal e depois comparar suas reapresentações, em vez de memorizar cada
trecho sem relação com os demais.

Evidência local: `test-results/indila-pattern-analysis.json` e
`test-results/pattern-analysis-library.json`. São derivados de uma cópia de
leitura da biblioteca; nenhum arquivo de música foi substituído.
