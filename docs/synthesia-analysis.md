# Synthesia no computador de teste: inventário funcional e critérios de comparação

Análise em 22/10/2026, destinada à implementação independente do PianoCraft. O material abaixo descreve comportamentos observáveis e documentados. Não constitui uma afirmação de que a implementação nova já alcançou paridade. Todos os itens da matriz começam como **a verificar**; somente um ensaio executado pode mudar esse estado.

## Instalação identificada

| Dado | Evidência local |
| --- | --- |
| Diretório | `C:\Program Files (x86)\Synthesia` |
| Produto no registro de desinstalação | Synthesia |
| Versão no registro de desinstalação | **10.9.5903** |
| Publicador no registro | Synthesia LLC |
| Executável | `Synthesia.exe`, 20.153.848 bytes |
| SHA-256 do executável | `7FBFA73D43DCE29E9A4F0322A94500CE9110A711C3CD29BDCDFF3DDC634A361F` |
| Versão indicada no início do histórico local | Synthesia 10.9, dezembro de 2022 |
| Metadados de versão do arquivo PE | `FileVersion`, `ProductVersion`, `ProductName` e `CompanyName` retornaram vazios pelo Windows |
| Arquivos acompanhantes | `readme.html`, `bass.dll`, `bassmidi.dll`, `win10-midi.dll`, bibliotecas de runtime Microsoft e desinstalador |

A versão 10.9.5903 foi obtida consultando as entradas de desinstalação do Windows; não foi inferida apenas do nome da pasta. O nome `Program Files (x86)` não prova a arquitetura do executável. O readme informa que a versão 10.9 exige Windows de 64 bits. Não foram lidos dados pessoais, chaves de ativação, pontuações existentes nem o banco de configurações do usuário.

## Método e limites

1. Inventário de arquivos e leitura de `readme.html` instalado, em modo somente leitura.
2. Consulta a metadados do executável, hash SHA-256 e registro de desinstalação.
3. Conferência com páginas públicas oficiais, citadas abaixo.
4. Formulação de critérios próprios para testar a implementação nova.

Esta análise documental não substitui uma sessão comparativa com o programa aberto, um teclado MIDI conectado e arquivos de teste. O histórico do readme inclui recursos antigos e mudanças ao longo de vinte anos; uma entrada antiga demonstra documentação do comportamento, mas não garante que toda opção permaneça igual na versão instalada. Onde pertinente, isso aparece como limitação na matriz. A equivalência do som, latência, legibilidade e pontuação precisa ser medida, e não presumida.

O trabalho de inspeção binária com REA, solicitado no projeto, deve ser documentado separadamente. Este relatório não apresenta descompilação como evidência e não depende de código extraído.

## Fontes

- **L** — Readme local: `C:\Program Files (x86)\Synthesia\readme.html`. Os números indicados a seguir são linhas desse arquivo na data da análise. Destaques: créditos e sons nas linhas 53–79; mudanças 10.9 nas linhas 83–138; MusicXML nas linhas 140–163; gravação nas linhas 165–191; partitura nas linhas 195–230; mãos e Free Play nas linhas 470–528.
- **S1** — [Página oficial do Synthesia](https://www.synthesiagame.com/): apresentação dos modos de aprendizado e versão 10.9.
- **S2** — [About Synthesia](https://www.synthesiagame.com/About): formatos, uso com teclado digital e histórico do produto.
- **S3** — [Playing your first song](https://synthesiagame.com/support/guide/firstSong): blocos, posição da música, velocidade e zoom.
- **S4** — [Choosing a song](https://ws.synthesiagame.com/support/guide/choosingSongs): biblioteca, classificação, dificuldade e progresso.
- **S5** — [Adding songs](https://www.synthesiagame.com/support/guide/addSongs): importação e pastas de músicas.
- **S6** — [First-time setup](https://www.synthesiagame.com/support/Guide/songSetup): partes, instrumentos, mãos, cores e áudio.
- **S7** — [Splitting the piano part](https://ws.synthesiagame.com/support/guide/assignHands): atribuição de mãos a notas individuais.
- **S8** — [Enabling sheet music](https://www.synthesiagame.com/support/guide/displaySheetMusic): partitura, zoom e visualização integral.
- **S9** — [Showing labels](https://synthesiagame.com/support/guide/labels): nomes, oitavas, graus e solfejo.
- **S10** — [Recording](https://synthesiagame.com/support/guide/recording): gravação em até seis pistas, persistência e exportação.
- **S11** — [Changing instrument sounds](https://synthesiagame.com/support/guide/changeSoundFont): SoundFonts e efeitos.
- **S12** — [Creating Great Content for Synthesia](https://synthesiagame.com/support/guide/contentCreators): metadados, grupos, mãos e dedilhados portáveis.
- **S13** — [News Archive](https://www.synthesiagame.com/news): confirmação das versões 10.6 a 10.9.

As páginas foram consultadas em 22/10/2026. A página de suporte oficial é [Synthesia Support](https://synthesiagame.com/support). Synthesia é o programa de piano de Synthesia LLC; o serviço de geração de vídeos de domínio `synthesia.io` é outro produto.

## Matriz de funcionalidades

“Critério” significa um ensaio mínimo proposto para o PianoCraft, não uma cópia do algoritmo interno do Synthesia. A tolerância de tempo e a fórmula de pontos da implementação nova devem ser explícitas. Recursos que exigem hardware devem continuar com estado a verificar até um teste físico.

| ID | Comportamento de referência | Evidência | Critério verificável no PianoCraft | Estado |
| --- | --- | --- | --- | --- |
| F01 | Importar MIDI e MusicXML | L 142; S5 | Abrir exemplos próprios `.mid`, `.midi`, `.xml`, `.musicxml` e `.mxl`; conferir alturas, duração, compassos e andamento. Arquivo inválido deve apresentar erro compreensível. | a verificar |
| F02 | Múltiplas partes e canais | L 509; S6 | Carregar MIDI com três pistas e canais diferentes; exibir partes e manter notas simultâneas e instrumentos independentes. | a verificar |
| F03 | Biblioteca de músicas | S4, S5 | Adicionar músicas, encontrá-las após reinício e abrir o item escolhido. Na implementação desktop, testar pasta local monitorada. | a verificar |
| F04 | Busca e ordenação | S4 | Buscar título e ordenar por título, progresso, última execução, número de execuções, classificação e dificuldade em ambas as direções. | a verificar |
| F05 | Grupos e metadados | S12 | Organizar músicas em grupos; salvar título, autor, identificador e informações adicionais sem alterar as notas originais. | a verificar |
| F06 | Prévia da música | S4 | Ouvir uma prévia do item selecionado e interrompê-la sem iniciar exercício. | a verificar |
| F07 | Notas em queda sincronizadas | S3 | Conferir que cada bloco toca a borda do teclado no instante de início de sua nota e que a altura do bloco corresponde à duração, inclusive após pausar e buscar. | a verificar |
| F08 | Teclado visual | S3; L 487–488 | Teclas brancas e pretas têm posição e ativação corretas; acordes aparecem simultaneamente; notas repetidas são distinguíveis. | a verificar |
| F09 | Assistir e ouvir | S1; L 117 | Reproduzir a música inteira sem entrada do usuário e com acompanhamento completo. | a verificar |
| F10 | Treino de melodia que aguarda a nota | S1; L 774 | O relógio para em uma nota pendente e continua ao recebê-la; acordes e notas já mantidas não causam avanço incorreto. | a verificar |
| F11 | Treino de melodia estrito | L 774–779 | Quando habilitado, uma nota errada impede o avanço e registra erro segundo regra documentada; rearticular uma nota correta não causa bloqueio espúrio. | a verificar |
| F12 | Treino de ritmo | L 319, 692, 747 | A música continua quando o usuário erra ou se atrasa; acertos e erros são medidos com janela de tempo explícita. | a verificar |
| F13 | Recital | L 813, 819 | Uma execução integral a 100% não permite buscar nem alterar velocidade durante avaliação; gera resultado ao terminar. A descrição de 2011 precisa ser conferida na interface 10.9. | a verificar |
| F14 | Praticar mão esquerda, direita ou ambas | S1; S6 | Selecionar cada combinação; somente as partes escolhidas exigem entrada e as restantes são tocadas automaticamente. | a verificar |
| F15 | Definir mão por parte | S6 | Alterar uma parte entre esquerda, direita e acompanhamento; confirmar efeito no treino e salvar escolha. | a verificar |
| F16 | Definir mão por nota | S7; L 473–474 | Separar uma pista por altura e corrigir notas isoladas; preservar essas atribuições após reabrir a música. | a verificar |
| F17 | Instrumento por parte | S6 | Alterar timbre de uma pista e ouvir a alteração sem mudar outras pistas. | a verificar |
| F18 | Cor, ocultação e silêncio por parte | S6 | Cor, visibilidade e áudio são independentes; uma parte oculta pode continuar audível, e uma parte silenciada pode continuar visível. | a verificar |
| F19 | Velocidade ajustável | S3 | Tocar a 50%, 100% e 150%; conferir duração e sincronização visual sem alterar a altura musical. | a verificar |
| F20 | Pausa, reinício e navegação | S3; L 173, 208, 517 | Pausar/resumir, reiniciar e buscar sem notas presas; MIDI de pedal e notas sustentadas devem ser restabelecidos ou finalizados de modo coerente. | a verificar |
| F21 | Linha do tempo | S3; L 743, 753 | Mostrar posição/duração e permitir buscar; testar compassos incompletos e andamento variável. | a verificar |
| F22 | Loop de trecho | L 477–478, 511; S13 | Definir início/fim, repetir sem vazamento de notas, ajustar intervalo entre repetições e restaurar limites salvos por música. | a verificar |
| F23 | Reiniciar loop ao atingir erros | L 747, 778; S13 | Configurar um limite; ao alcançá-lo, voltar ao início do trecho com limpeza de notas e contagem apropriada. | a verificar |
| F24 | Marcadores | L 205–206, 508–510 | Criar, nomear, remover e reencontrar marcadores; distinguir os importados do MIDI e os criados pelo usuário. | a verificar |
| F25 | Metrônomo | L 900, 507, 751 | Ouvir pulsos nos tempos corretos, com acento de compasso e contagem inicial coerente; ajustar volume e compensação temporal se disponíveis. | a verificar |
| F26 | Partitura opcional | S8; L 179, 198 | Exibir notação das mãos, cursor sincronizado e zoom; alternar entre blocos, partitura e ambos. | a verificar |
| F27 | Partitura em tela cheia com navegação | S8; L 143, 198–206 | Com blocos ocultos, exibir várias linhas; clicar em um ponto muda a posição, arrastar rola a página e o acompanhamento mantém a linha atual visível. | a verificar |
| F28 | Dedilhados | S1; L 480, 772 | Editar dedos 1–5, associar à mão correta e salvar; testar substituição de dedo na mesma nota. Não inferir que todo arquivo externo possui dedilhado. | a verificar |
| F29 | Rótulos de notas e teclas | S9; L 316, 93–100 | Oferecer nomes, oitavas, graus, Do fixo, Do móvel, nomes simples, dedilhados e mapa do teclado; testar mudança de tonalidade e opção de só rotular notas praticadas. | a verificar |
| F30 | Zoom do teclado e quantidade de notas visíveis | S3; L 126 | Ajustar intervalo visível para música, instrumento e faixa personalizada; nenhuma nota deve mudar de altura por apenas ampliar a imagem. | a verificar |
| F31 | Entrada por teclado de computador e ponteiro/toque | S9; L 180, 495 | Reproduzir nota com teclado e ponteiro, soltar corretamente e suportar acordes possíveis; não deixar teclas presas após perda de foco. | a verificar |
| F32 | Entrada MIDI | S2; L 88, 182 | Enumerar dispositivo, receber Note On/Off, reconhecer velocidade zero como soltura e tratar desconexão sem travar. Validar com piano físico. | a verificar |
| F33 | Múltiplos dispositivos/canais de entrada | L 88 | Receber dois dispositivos ou canais simultaneamente e configurar suas cores/timbres independentemente no Free Play. | a verificar |
| F34 | Saída MIDI e roteamento | L 481–486, 191 | Enviar notas ao dispositivo escolhido, selecionar canal e ativar separadamente notas do usuário/acompanhamento; evitar duplicação com controle local do piano. | a verificar |
| F35 | Pedal e outros controladores MIDI | L 85, 107, 527 | Sustain prolonga som coerentemente; gravação e reprodução preservam CC, pitch bend e aftertouch quando suportados. Parar/fechar envia limpeza. | a verificar |
| F36 | Teclas iluminadas | S1; L 102, 108, 207, 505 | Em hardware compatível, sinalizar a próxima nota e apagar sinais ao parar; modos específicos de fabricante exigem testes independentes. | a verificar |
| F37 | Ajustes de faixa/octava de entrada | L 126, 614, 749 | Definir alcance do instrumento e deslocamento de oitava; conferir avaliação e sinais de notas fora da tela. | a verificar |
| F38 | Sintetizador e SoundFont | L 267, 106; S11 | Produzir áudio polifônico e carregar SoundFont próprio autorizado SF2/SF3; selecionar programas e testar reverb sem copiar o banco Voice Crystal. | a verificar |
| F39 | Free Play | L 476, 86–91 | Tocar livremente sem música carregada, selecionar timbre e cor, e visualizar as notas executadas. | a verificar |
| F40 | Reconhecimento de acordes e tonalidade | L 86–88, 128 | Tocar tríades, sétimas, inversões e acorde aumentado; mostrar nome e grau romano quando aplicável à tonalidade escolhida. Casos ambíguos devem ter regra explícita. | a verificar |
| F41 | Acompanhamentos rítmicos no Free Play | L 476, 95–97, 190 | Selecionar batida, andamento e volume; áudio e linhas de compasso acompanham o BPM. | a verificar |
| F42 | Gravação com sobreposição de pistas | L 169; S10 | Gravar até seis pistas, escutar as anteriores ao gravar outra e configurar timbre/cor por pista; excluir a selecionada sem afetar as demais. | a verificar |
| F43 | Exportação e quantização da gravação | L 85, 96; S10 | Exportar MIDI, reabrir e comparar notas/controles; quantização opcional alinha início/fim ao valor escolhido, enquanto desligada preserva o tempo gravado. | a verificar |
| F44 | Persistência da gravação em andamento | S10 | Fechar e reabrir preserva pistas ainda não exportadas. | a verificar |
| F45 | Resultados imediatos | S1; L 779, 908 | Exibir acertos, erros e resultado calculado pela regra publicada; comparar sessões intencionalmente perfeitas, atrasadas e com notas extras. | a verificar |
| F46 | Histórico de progresso | S4; L 319, 520 | Conservar resultados por música, modo e mãos e apresentar evolução após reinício; cálculo independente precisa ser documentado. | a verificar |
| F47 | Perfis de usuário | L 144, 121; S2 | Dois perfis mantêm progresso separado e o perfil ativo é identificável. | a verificar |
| F48 | Preferências e acessibilidade | L 93, 100, 103, 121 | Restaurar preferências; testar tamanho/contraste dos rótulos, redução de movimento e interface em português. | a verificar |
| F49 | Atalhos configuráveis | L 109–110, 489–491 | Associar ação a tecla e, quando suportado, MIDI/pedal; impedir disparos duplicados de botões e conflitos básicos. | a verificar |
| F50 | Tela cheia e interface escalável | L 110–111, 500–501 | Alternar tela cheia, redimensionar janela e testar escalas do Windows sem cortar controles essenciais. | a verificar |
| F51 | Abrir arquivo externamente e arrastar/soltar | L 99, 201–202; S5 | Abrir música por associação/argumento e soltá-la na janela; mensagem clara se formato inválido. | a verificar |
| F52 | Robustez de MIDI e MusicXML | L 130, 134, 177, 512 | Testar mudanças de andamento, pedais, compassos de anacruse, notas sobrepostas da mesma altura, ligações MusicXML e MIDI SMPTE; rejeitar entradas corrompidas sem queda. | a verificar |

## Conteúdo e comportamentos fora da equivalência de implementação

- Pagamentos, tela de compra, cobrança, ativação e limitação de demonstração ficam fora do PianoCraft por solicitação do usuário. Isso significa ausência desses mecanismos no programa novo; não significa modificar o executável ou as permissões do Synthesia instalado.
- O banco de instrumentos Voice Crystal instalado é descrito no readme como exclusivo para uso no Synthesia. O PianoCraft deve utilizar síntese própria ou banco de sons com autorização adequada. As DLLs do programa instalado não são dependências do PianoCraft.
- As músicas incluídas, fontes, ícones, imagens, dedilhados e arranjos do Synthesia não foram copiados. Ter composição em domínio público não demonstra, por si só, autorização para redistribuir um arranjo específico. Usar exemplos próprios ou material com permissão documentada.
- Marca, nome, identidade visual e telas não precisam ser reproduzidos para alcançar equivalência funcional. O nome do novo produto permanece PianoCraft.
- Integração com a loja, contas e servidores proprietários não foi analisada como requisito do programa novo. O readme informa que o envio de resultados de recital ao site foi removido na versão 10.1 (L 448). Não implementar dependência dessa função histórica.
- Suporte a macOS, Android e iPad foi citado para contextualizar a documentação. Esta análise tem como alvo o Windows do computador de teste; compatibilidade multiplataforma precisa de escopo e testes próprios.

## Arquivos de ensaio recomendados

Preparar material original pequeno, com resultado esperado conhecido:

1. Escala de duas oitavas a 120 BPM com oito velocidades diferentes.
2. Duas mãos com notas simultâneas, oitavas, repetição e acordes sustentados.
3. Três pistas/canais, incluindo percussão, alterações de programa e volumes independentes.
4. Mudanças de BPM, fórmula de compasso e tonalidade no meio da música.
5. Pedal sustain, pitch bend, expressão e aftertouch antes e depois de um ponto de busca.
6. Nota que cruza a borda do loop e nota que começa exatamente no final dele.
7. MusicXML com anacruse, pausa, alteração, ligadura de duração e vozes simultâneas; versão compactada MXL equivalente.
8. MIDI com Note On de velocidade zero, sobreposição da mesma altura e dados inválidos/truncados.

Para a primeira comparação física, registrar modelo do teclado MIDI, driver, dispositivo de saída, taxa de amostragem e latência. Sem esses dados, diferenças de resposta podem vir do ambiente e não da lógica do treino. A promessa de “mesmas funcionalidades” só pode ser encerrada após os itens aplicáveis passarem nesses ensaios e as diferenças restantes serem explicitadas.

## Implementação inicial do importador MusicXML

O módulo independente `src/music/musicxml.js` usa o `DOMParser` do navegador e retorna o mesmo modelo temporal em segundos usado pelo leitor MIDI. Foram implementados formato `score-partwise`, partes/pautas separadas, acordes, pausas, vozes com `backup`/`forward`, divisões, anacruse explícita, compassos, transposição, alterações cromáticas, ligação de duração, dedilhados numéricos e mudanças de andamento com marca de metrônomo ou `sound`. A duração de notas que atravessam uma mudança de BPM é integrada por segmentos. Os números MIDI de instrumento/canal são convertidos de base 1 do MusicXML para base 0 do modelo interno.

Os testes em `tests/musicxml.test.js` executam no DOMParser real do Electron, usando uma janela de teste oculta. Cobrem alinhamento de mãos, acorde, ligação entre compassos, mudança de divisões/tempo, anacruse, encaminhamento, transposição, marcas pontuadas, alinhamento entre partes, repetição simples e restauração de andamento, avisos e rejeição de entradas inválidas. O módulo passa esses testes locais; isso verifica o importador e não encerra a comparação do programa completo com Synthesia.

As repetições simples `forward`/`backward` são expandidas em duas execuções; também funciona um `backward` sem início explícito, usando o início da partitura, e blocos separados com inícios explícitos. O andamento e o compasso são restaurados ao voltar para o início do bloco. `sourceXml` conserva o XML original, e `measureTimeline` relaciona a posição executada ao compasso original para permitir que a partitura acompanhe as repetições.

Limitações explícitas desta primeira versão: `score-timewise` é rejeitado com orientação de exportação; casas, saltos, repetições aninhadas/incompletas ou contagens diferentes de duas execuções não são expandidos, e a sequência escrita é tocada uma vez com aviso; adornos, ornamentos e marcações de pedal XML não são reproduzidos e geram avisos no resultado. Alterações microtonais e compassos com vários denominadores são rejeitados. Essas limitações devem ser mostradas ao importar e impedem declarar paridade integral de MusicXML.

A implementação foi baseada na especificação pública [MusicXML 4.0 do W3C](https://www.w3.org/2021/06/musicxml40/), especialmente [notas e ligações sonoras](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/note/), [acordes e cursor musical](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/chord/), [backup e múltiplas vozes](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/backup/), [parâmetros sonoros e offsets](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/sound/) e [metrônomo](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/metronome/). Não foi usado código ou conteúdo extraído do Synthesia.

## Importação MIDI, XML e MXL comprimido validada

`src/music/import.js` oferece `parseMusicFile(bytes, name)` e escolhe o leitor MIDI, XML ou MXL pela assinatura do conteúdo. A importação MXL usa **fflate 0.8.3**, dependência de produção distribuída localmente. Lê o arquivo `META-INF/container.xml`, valida seu primeiro `rootfile` e descomprime somente o container e a partitura indicada. Nada é extraído no sistema de arquivos. XML UTF-8 e UTF-16 foi testado.

Os limites concretos são: entrada de até **32 MB**; XML descomprimido de até **20 MB**; container de até **128 KB**; até **512 entradas ZIP**; soma de expansão declarada de até **64 MB**; taxa de expansão máxima de **500 vezes** para entradas maiores que 1 MB. A descompressão recebe blocos de 1 KB e confere a quantidade efetivamente produzida contra o tamanho declarado e o limite permitido; um tamanho forjado no diretório não desativa a proteção.

Antes da descompressão, são conferidos diretório central, cabeçalhos locais e intervalos de dados. São rejeitados caminhos absolutos ou com travessia, entradas duplicadas/sobrepostas, links simbólicos, criptografia, ZIP64 e ZIP dividido em volumes. Os dois arquivos lidos passam por CRC32. Recursos de imagem/áudio opcionais não são extraídos nem executados.

`tests/import.test.js` importa os módulos reais no Electron e verifica MIDI, XML, MXL DEFLATE/armazenado, conteúdo que exige vários blocos de descompressão, UTF-16, subarrays, container/arquivo principal inválidos, caminho inseguro, nome duplicado, corrupção CRC32, tamanhos declarados excessivos, alta taxa de expansão e saída real maior que uma declaração forjada. O comando de validação é `node --test tests/import.test.js tests/musicxml.test.js`.

Fontes da implementação: [formato MXL na especificação MusicXML 4.0](https://www.w3.org/2021/06/musicxml40/tutorial/compressed-mxl-files/), [biblioteca fflate e API de streaming](https://github.com/101arrowz/fflate), [marcas de repetição](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/repeat/) e [casas de repetição](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/ending/). Essa cobertura é restrita aos importadores e aos ensaios descritos; os demais estados da matriz continuam a verificar até a validação integrada do programa.

## Modelo de gravação com seis pistas validado

O módulo autoral `src/music/recorder.js` implementa `Recorder` com até seis pistas. Cada tomada usa um relógio em milissegundos, inicia no tempo zero e preserva as anteriores para reprodução em overdub. Os canais MIDI das tomadas são separados para conservar os instrumentos. É possível regravar uma pista específica, excluir pistas, reiniciar a sessão e restaurar um estado JSON validado por `normalizeSong` mais validações dos eventos de gravação.

As notas mantêm `keyDuration` como duração física e `duration` como duração audível com sustain. CC, pitch bend, aftertouch de canal/polifônico e mudanças de instrumento são conservados. Ao parar, teclas ainda pressionadas são encerradas, e um pedal ainda ativo recebe uma soltura final. O snapshot `song` também fecha provisoriamente notas/pedal para que um estado salvo durante a tomada possa ser restaurado; consultá-lo mantém a gravação ativa.

`tests/recorder.test.js` passou **11 testes determinísticos** com relógio falso: início em zero, perda de Note Off ao parar, snapshots isolados, pedal e duração física, repetição da mesma altura, reset MIDI, overdub com instrumentos/canais separados, limite de seis pistas, regravação, exclusão, restauração JSON e rejeição de estados inválidos. A validação dessa API não demonstra, sozinha, que o fluxo completo da interface oferece todos esses recursos; reprodução ao vivo, latência, persistência automática e conexão MIDI física exigem ensaios integrados.

## Acompanhamento rítmico autoral validado no agendamento

`src/music/drums.js` implementa `DrumMachine` com metrônomo, pop, rock e valsa. Bumbo, caixa e chimbal são gerados por osciladores, filtros e ruído calculado pelo próprio módulo. Não utiliza samples do Synthesia ou de terceiros. O timbre é uma bateria sintetizada simples; não pretende reproduzir o banco de instrumentos do Synthesia.

O relógio é o `AudioContext.currentTime`: um timer de 25 ms agenda áudio 200 ms adiante. Mudanças de BPM preservam a fase musical e cancelam eventos futuros do andamento anterior. Se ocorrer uma pausa longa no event loop, os pulsos perdidos são descartados para evitar uma rajada atrasada. Vozes são limitadas a 64 e o encerramento cancela timers/fontes, preservando aberto o contexto de áudio compartilhado. O callback visual pode atrasar em segundo plano; suspensão ou throttling extremo do sistema ainda pode causar interrupções além da janela de agendamento.

`tests/drums.test.js` passou **8 testes** com tempo/controladores Web Audio simulados: timestamps regulares, troca de andamento, recuperação de travamento, métrica ternária, interrupção/reinício sem timers órfãos, limite de recursos, mute completo, concorrência com retomada do áudio e fechamento do contexto. Isso verifica agendamento e ciclo de vida; avaliação auditiva de timbre e latência no computador de teste continua pendente. Referência técnica: [Web Audio API do W3C](https://www.w3.org/TR/webaudio/).
