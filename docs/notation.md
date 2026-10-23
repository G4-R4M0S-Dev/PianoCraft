# Partitura convencional offline

O PianoCraft utiliza **OpenSheetMusicDisplay 2.2.1**, distribuído sob BSD-3-Clause, para converter MusicXML em notação SVG. O motor e as licenças de suas dependências ficam em `src/vendor`; não há CDN ou requisição de rede durante a renderização. A integração segue a [documentação oficial do OSMD](https://opensheetmusicdisplay.github.io/classdoc/classes/OpenSheetMusicDisplay.html) e sua [configuração de desenho e dedilhados](https://opensheetmusicdisplay.github.io/classdoc/interfaces/IOSMDOptions.html).

Prepare os arquivos após instalar as dependências:

```powershell
node scripts/prepare-notation.mjs
```

## Integração

```javascript
import { renderScore } from './music/notation.js';

const score = await renderScore(container, song, {
  transpose: 0,
  configs: song.configs || {},
  zoom: 1,
});
score.setCursor(playbackSeconds);
// A tecla pressionada acende somente a cabeça da nota correspondente.
score.inputOn({ midi: 64, time: playbackSeconds, key: 'casio:0:64', noteIds: [expectedNote.id] });
score.inputOff('casio:0:64');
// Ao pausar, buscar outro ponto ou trocar a música:
score.clearInputFeedback();
const targetTime = score.timeAtPoint(event.clientX, event.clientY);
if (targetTime !== null) seek(targetTime);
score.setZoom(1.25);
score.resize();
score.dispose();
```

O elemento precisa estar visível, com largura disponível, quando `renderScore` for chamado. Ele recebe SVG e cursor próprios; não deve compartilhar o mesmo elemento com o antigo canvas. O controlador expõe `source`, `xml`, `warnings`, `measureCount` e `cursorBeat` para integração e diagnóstico. Deve-se exibir os avisos retornados, chamar `setCursor` durante a reprodução e `resize` após redimensionar a área. Novas renderizações no mesmo elemento descartam o controlador anterior.

`inputOn({ midi, time, key, noteIds })` colore de verde e adiciona um halo na cabeça individual da nota, sem redesenhar o compasso. `midi` é a altura audível, incluindo a transposição; `time` é o tempo da execução em segundos; `key` identifica a tecla com seu dispositivo e canal. Quando `noteIds` é informado, somente essas notas podem acender e a altura ainda precisa corresponder. Um array vazio significa ausência de correspondência; use-o para uma nota errada. Se `noteIds` for omitido, a busca se limita ao ataque mais próximo dentro de 250 ms, sem procurar notas distantes no restante da partitura. A interface de avaliação deve preferir os IDs dos candidatos/acertos do motor de prática.

`inputOff(key)` encerra o destaque daquela fonte, conservando uma duração visual mínima de 350 ms para toques rápidos. Duas fontes pressionando a mesma nota têm estado independente. `clearInputFeedback()` remove imediatamente estados, halos e timers; deve ser chamado em pausa, navegação e troca de música. Zoom e redimensionamento reaplicam os destaques ativos sobre o novo SVG. O descarte cancela todos os timers. Nenhum evento de tecla altera o tamanho da partitura, faz rolagem ou chama `osmd.render()`.

O mapeamento usa as cabeças e os índices de acorde dos `GraphicalNote` reais do OSMD. Ele distingue alturas de um mesmo acorde e ocorrências de uma mesma altura em compassos diferentes. Notas ligadas por duração iluminam os segmentos da mesma nota sustentada. Em MusicXML com repetição, os IDs da execução expandida retornam ao compasso escrito correspondente, assim como o cursor. A geração MIDI conserva seu limite de quantização para associar o ataque original à escrita interpretada.

`timeAtPoint(clientX, clientY)` associa a geometria SVG real das cabeças de notas e pausas aos timestamps do modelo gráfico do OSMD. A busca usa as coordenadas atuais do DOM, portanto acompanha zoom, rolagem e reposicionamento da área. Retorna segundos da reprodução ou `null` para pontos fora da área ou distantes das notas. Em partituras repetidas, prioriza a ocorrência do ciclo de execução atual informado pelo último `setCursor`. A interface deve desativar busca durante Recital e distinguir clique de arraste antes de chamar `seek`.

## MusicXML importado

Quando `song.sourceXml` está disponível, o renderer conserva a escrita original: compassos, pausas, ritmos pontuados, vozes, ligaduras e dedilhados reconhecidos pelo motor. A transposição usa o modelo de alturas do OSMD e conserva as notas originais de áudio. O cursor recebe segundos, integra mudanças de BPM e consulta `measureTimeline` para retornar ao compasso original durante as repetições expandidas pelo importador.

O projeto JSON conserva `sourceXml`, `measureTimeline` e `notationEdited`. Ao editar manualmente mãos ou dedos no modelo de notas, defina `song.notationEdited = true` para regenerar a partitura e mostrar as alterações; caso contrário, a versão original do XML continua sendo exibida. Uma marca de andamento que contém somente `<sound tempo="…"/>` é normalizada em marca de metrônomo equivalente, pois essa forma provoca a perda silenciosa de um compasso no OSMD 2.2.1. Erros de leitura do motor são apresentados como falhas explícitas para evitar exibir uma peça incompleta.

Arquivos XML podem conter recursos não suportados pelo OSMD. Imagens, links e bookmarks são removidos da cópia usada na visualização. Declarações externas padrão `DOCTYPE PUBLIC` ou `SYSTEM` são removidas antes da leitura, sem consultar DTDs locais ou remotas; entidades e subconjuntos DTD internos são rejeitados. Isso não altera o arquivo de origem. A biblioteca é um renderer de notação, e seu suporte não deve ser confundido com expansão de todas as repetições e saltos pelo motor de reprodução.

## MIDI e gravações

A escrita musical não pode ser reconstruída de forma única a partir de notas executadas. O PianoCraft produz uma interpretação explícita com duas pautas, claves de Sol/Fá, compassos, alterações, notas com hastes e bandeiras, acordes, pausas, valores pontuados, ligaduras entre durações/compassos e dedilhados informados. As mãos seguem a atribuição individual, a configuração de pista ou a divisão automática pela altura.

Inícios e durações são interpretados em semicolcheias; pequenas lacunas de articulação abaixo de um quinto de semínima podem ser unidas ao ataque seguinte. A geração não modifica o áudio, o MIDI ou a avaliação. Durações sobrepostas são separadas em até oito vozes por mão. Mudanças de compasso e BPM são incluídas; notas que atravessam compassos recebem ligações de duração.

Limitações: não há inferência de tercinas, swing, tonalidade, grafia enarmônica original, ligaduras de expressão, dinâmica ou dedilhado ausente. A interpretação usa sustenidos e armadura neutra; um MusicXML original conserva a grafia musical disponível. O limite de transcrição automática é de 12 mil notas e mil compassos, com erro explícito para peças maiores. O reconhecimento automático não substitui uma edição musical revisada.

## Verificação

`node --test tests/notation.test.js` abre Electron com o mesmo bloqueio de rede e CSP da interface. Os testes desenham SVG real, verificam notas/pausas/ritmos no modelo do motor e exercitam escala, acorde, duas mãos, ligaduras, dedilhados, mudanças 3/4 para 6/8, transposição, repetição MusicXML, cursor, zoom e descarte. O feedback é testado por cabeça individual, fontes independentes, flash mínimo, altura errada, IDs vazios, ocorrências repetidas, transposição, ligaduras e recriação do SVG. Há verificação de ausência de redesenho e de alteração de dimensões durante o toque. Capturas de revisão são salvas em `test-results/notation-scale.png` e `test-results/notation-input-feedback.png`. O ensaio não certifica a representação de toda a especificação MusicXML.
