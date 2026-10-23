# Verificação da entrega

Verificações da implementação por testes lógicos, pelo DOM/Web Audio reais do Electron e pelo executável Windows empacotado.

## Preparação para publicação pública — 23/10/2026

Validada uma cópia limpa contendo apenas os arquivos publicáveis, sem reutilizar `node_modules`, `dist`, ferramentas locais ou a biblioteca pessoal. Ambiente: Windows 11 x64, Node.js 22.14.0, npm 11.4.2 e Electron 45.0.0.

| Comando | Resultado |
| --- | --- |
| `npm ci` | Instalação limpa concluída; `postinstall` preparou o executável Electron antes dos testes paralelos |
| `npm run prepare:assets` | Bundles de SoundFont, MXL e notação preparados com suas licenças |
| `npm test` | **297 testes aprovados, zero falhas**, sem testes ignorados |
| `npm run test:app` | Biblioteca, reprodução, espera de notas, partitura, edição, gravação, importação e 88 teclas; zero erros de página |
| `node scripts/smoke-soundfont.mjs` | SF2 com áudio mensurável, sustain, limpeza e rejeição de banco inválido |
| `npm run package` | Pasta portátil Windows x64 0.7.0 gerada com sucesso |
| `node scripts/check-package.mjs` | Executável sem `node_modules`, biblioteca, importação MXL, partitura SVG e áudio SF2; zero erros de página e requisições externas no ensaio |

O `postinstall` evita instalações simultâneas do runtime sob demanda quando vários testes Electron começam pela primeira vez. Estes ensaios não certificam outros sistemas operacionais, bancos SF3 ou a resposta física dos LEDs. Os hashes e ensaios de hardware das seções seguintes são registros históricos da geração anterior; uma nova geração local pode produzir hashes diferentes. Relatórios e capturas desta checagem são locais, em `test-results/` e na cópia temporária usada na validação.

## Histórico de validação — 22/10/2026

## Versão 0.7

Executável: `dist/v0.7/PianoCraft-win32-x64/PianoCraft.exe`. O estudo agora começa na página da música, com uma tarefa e uma meta, antes da tela de execução. O perfil de produção foi preservado; os ensaios da jornada usam armazenamento temporário e MIDI simulado.

| Ensaio | Resultado |
| --- | --- |
| `npm test` | **297 testes aprovados, zero falhas**, incluindo 27 do motor da jornada e 11 da conclusão |
| `qa-learning-flow.mjs` | Fonte e EXE: biblioteca → tarefa curta a 60% → três execuções MIDI reais no avaliador → meta 3/3 → ação inicia a 70%; retoma trecho/andamento/sequência 1/3 após recarga; erros zeram sequência sem vitória falsa; Ritmo inicia a 90% no mesmo trecho; progresso 6/100 igual nas três páginas; perfis, backup, alteração de arranjo e restauração |
| Layout da jornada | Oito combinações de 1440×960/1000×720, claro/escuro, normal/foco; partitura, teclado e transporte visíveis, sem transbordamento; ajustes disponíveis em painel separado |
| `qa-journey-state.mjs` | Fonte e EXE: nove verificações de estado, Auto→Aprender no escopo escolhido, ajuste manual desvincula a meta antiga, hotspot com erros registrados, exportação real do JSON, backup antigo não regride o cursor, tarefas inválidas rejeitadas, IDs duplicados, escrita atrasada e último clique prevalecendo |
| `qa-song-hub.mjs` | Tarefa principal, nove percursos, callbacks, foco, acessibilidade, texto seguro e temas/resoluções |
| `qa-progress-panel.mjs` | Dez grupos: escala principal única, ordenação, zero versus sem registro, perfis, detalhes técnicos e nove percursos acessíveis; compatibilidade da API anterior |
| `npm run test:app` | Biblioteca, nova página da música, estúdio manual, reprodução/espera, partitura, edição, gravação, importação e 88 teclas; zero erros de página |
| `qa-free-learning.mjs` | EXE: pauta livre, notas PC/MIDI/mouse, retenção, zoom, metrônomo, gravação e overdub de pistas, exclusão/nova gravação, foco em 1000×720; zero achados ou erros de página |
| `check-package.mjs` | EXE 0.7.0, CASIO USB-MIDI aberto e perfil LK-S250 confirmado, MXL/SVG e áudio SF2 reais, sem `node_modules`, erros de página ou requisições externas |

O motor propõe trechos com limites musicais, reaparições e dificuldades registradas; não exige analisar e salvar a estrutura antes de começar. Três execuções consecutivas com pelo menos 90% de precisão atingem a meta. A próxima tarefa só começa quando escolhida: andamento maior, outra mão, outro trecho ou modo; dificuldade acentuada sugere revisão mais lenta. Os retornos de um padrão precisam ser executados, sem propagar pontos artificialmente.

A retomada é separada por perfil, música e conteúdo do arranjo e recomeça no início do trecho para manter o escopo avaliável. `learning-journeys` guarda tarefa, sequência e tentativas já consideradas; integra o backup. Ajustes manuais passam para prática personalizada, conservando a missão original. Leitura, avaliação e gravação do cursor são serializadas; navegação e seleção concorrente descartam inícios obsoletos.

A escala principal **Progresso de estudo /100** reúne os pontos dos percursos elegíveis, inclusive Melodia. Precisão, avaliação recente de execução e pontos técnicos continuam acessíveis nos detalhes. Uma meta não atingida recebe orientação de consolidação, sem som de vitória; execuções intermediárias bem-sucedidas recebem feedback breve de 1/3 e 2/3.

Evidências: `qa-learning-flow-source.json`, `qa-learning-flow-package.json`, `journey-state-source.json`, `journey-state-package.json`, capturas `learning-flow-*` e logs em `test-results/`. As capturas da jornada avançam o relógio de desenho antes da imagem para evitar quadros antigos do compositor. Fontes do pacote e identidade final estão conferidas em `archive-v07.json` e `docs/evidence/pianocraft-build.json`.

## Histórico da versão 0.6

Executável: `dist/v0.6/PianoCraft-win32-x64/PianoCraft.exe`. A biblioteca e o perfil do usuário foram preservados; os testes funcionais usam um perfil temporário e MIDI simulado, exceto a verificação geral do pacote identificada abaixo.

| Ensaio | Resultado |
| --- | --- |
| `npm test` | **267 testes aprovados, zero falhas**; inclui 16 do motor de conquistas, oito do aviso e o som breve cancelável |
| `qa-completion-integration.mjs` | Fonte e EXE: escuta de duas repetições sem pontos inventados; três repetições ganham 50 pontos uma única vez; compacto conserva foco e contagem; música inteira ganha 100 pontos e atualiza a matriz; ações Progresso/Repetir, pausa parcial, prévia, recarga e perfis; no EXE, som opcional desligado mantém o aviso |
| `qa-audio-start-races.mjs` | Fonte e EXE final: áudio atrasado não inicia após ir à Biblioteca/Piano livre, trocar modo/música ou pausar; dois pedidos pendentes iniciam apenas o mais recente; zero erros de página |
| `qa-achievement-backup.mjs` | EXE: restaura 50 pontos, backup antigo com 25 não regride, complemento chega a 100, perfil B mantém seus 25; versões e músicas inválidas não se misturam; exportação real contém conquistas e preferência do som; recarga sem nova comemoração |
| `qa-achievement-panel.mjs` e `qa-progress-panel.mjs` | Nove percursos, mãos sem notas indisponíveis, zero versus sem registro, callbacks, textos importados, tema claro/escuro, movimento reduzido, conservação de foco e abertura; conquistas sem histórico continuam visíveis, sem inventar sessões ou datas |
| `qa-preparation.mjs` | Fonte: contagem, pausa entre loops, guias e avaliação congeladas, cliques canceláveis e etiquetas preservadas após recarga |
| `qa-progress-integration.mjs` | EXE: ordenação por última prática, score, sessões agrupadas, ponto de erro no intervalo correto, troca de perfil e metadados preservados |
| `check-package.mjs` | EXE 0.6.0, CASIO USB-MIDI aberto e perfil LK-S250 confirmado, MXL/SVG e áudio SF2 RMS≈0,046; sem dependências `node_modules`, erros de página ou requisições externas |

A comemoração é uma camada fixa, sem deslocar o piano ou capturar o foco. Repetições intermediárias mostram apenas um aviso compacto quando existe ganho; a conclusão do exercício reúne os ganhos das voltas. O som usa três tons sintetizados durante 250 ms, respeita o volume, pode ser desligado e não envia notas ao instrumento físico.

Os pontos guardam a melhor evidência de cada percurso, por perfil e conteúdo musical, em `achievement-ledgers` no IndexedDB. O registro é independente do limite de linhas do histórico e é salvo antes do aviso. Melodia guiada não comprova ritmo; os nove percursos têm critérios explícitos, cobertura real de notas e união por máximo, sem somar repetições duplicadas. O score recente de domínio permanece separado. Veja [conquistas](achievements.md).

A revisão verificou o isolamento por versão do arranjo também dentro de um exercício e o cancelamento da entrada assíncrona de reprodução quando a pessoa sai da tela ou muda o contexto durante o carregamento do áudio.

Os relatórios e capturas ficam em `test-results/`, excluído da distribuição. Dez arquivos de aplicação do `app.asar` foram comparados byte a byte com a fonte; os metadados de versão também conferem. A captura normal do Playwright pode esperar indefinidamente um quadro com o relógio pausado; a captura nativa do Electron foi usada para conferir a interface do EXE. A identidade de EXE e `app.asar` está em `docs/evidence/pianocraft-build.json`.

## Histórico da versão 0.5

Executável: `dist/v0.5/PianoCraft-win32-x64/PianoCraft.exe`. As versões anteriores permanecem em suas pastas. Nenhuma sessão de teste usa o perfil ao vivo do usuário.

| Ensaio | Resultado |
| --- | --- |
| `npm test` | **242 testes aprovados, zero falhas** na fonte final |
| `npm run test:app` | Biblioteca, reprodução, espera, partitura padrão, edição, gravação, importação, 88 teclas e progresso novo; zero erros de página |
| `qa-preparation.mjs` | Fonte e EXE: 3/4 a 50% dá três segundos de contagem; pausa de um segundo entre loops; posição, avaliação e guias congeladas; três cliques futuros cancelados; histórico exclui preparação; etiquetas de prática/revisão sobrevivem ao reload |
| `qa-progress-integration.mjs` | Fonte e EXE: ordem mais recente/inversa, score por música, loops agrupados, ponto de erro abre intervalo 8–12 s, perfis e metadados preservados; zero erros de página |
| `qa-free-learning.mjs` | Fonte e EXE: pauta padrão, PC/MIDI/mouse, retenção/zoom, metrônomo 3/4 a 120 BPM com cliques programados a 500 ms, duas pistas/quatro notas, overdub alinhado ao relógio do take, OSMD do MIDI salvo, exclusão/nova gravação e foco 1000×720 sem transbordar |
| `qa-theme-layout.mjs` | Paletas, persistência, seguir o sistema, layout 1440×960/1000×720 e mensagens MIDI sem mover controles; 70 medições de contraste, mínimo 6,05:1 inclusive no instante da troca de tema |
| `qa-practice-timing.mjs` | Regressões PC/MIDI, timestamps enfileirados, acordes, duração e pedal; zero erros de página. Preparação desativada neste ensaio para isolar o avaliador |
| `qa-experience.mjs` | Geometria estável, cabeças de nota, foco, trajetória e seis verificações de iluminação no ataque musical; zero erros de página. Preparação tem ensaio próprio |
| `check-package.mjs` | EXE 0.5 abriu o CASIO USB-MIDI, confirmou perfil LK-S250, importou MXL, desenhou SVG e gerou áudio SF2 RMS≈0,046; sem `node_modules`, erros de página ou requisições externas |

Os scripts de preparação, progresso, piano livre e tema aceitam o caminho do executável. Os relatórios finais do pacote são `preparation-package.json`, `progress-integration-package.json` e `qa-free-learning-package.json`, em `test-results/`. A captura opcional de progresso por `fullPage` travou no compositor do pacote; o ensaio funcional completo foi repetido sem essa captura e passou. A imagem da fonte e as capturas de piano livre/preparação do EXE permanecem disponíveis.

O detalhe das tentativas passa a ser salvo no IndexedDB `practice-history`, lendo o histórico antigo como migração. O armazenamento local conserva apenas um cache compacto. Os identificadores de sessão agrupam os loops; a interface exibe fichas por música e sessões resumidas. Erros antigos sem posição não são reconstruídos. O mapa de erros registra novas penalidades e diferencia repetição dentro de uma sessão da recorrência entre sessões.

O metrônomo programa um compasso curto de áudio com antecedência para tolerar o primeiro quadro ocupado; parar ou mudar andamento cancela os cliques agendados. A pauta livre limita a memória visual, preservando independentemente a gravação original. As durações da pauta ao vivo são aproximações quantizadas; gravações salvas usam a partitura convencional do MIDI. A troca de paleta é atômica para evitar texto escuro sobre o fundo antigo durante a transição.

Dezoito arquivos de aplicação do pacote foram comparados byte a byte com a fonte final. Os snapshots e as músicas pessoais continuam excluídos da distribuição. O registro final de EXE e `app.asar` está em `docs/evidence/pianocraft-build.json`.

## Histórico da versão 0.4

Executável: `dist/v0.4/PianoCraft-win32-x64/PianoCraft.exe`. A versão 0.3 aberta foi preservada. A biblioteca do usuário foi lida de uma cópia isolada do IndexedDB, sem abrir o LevelDB ao vivo em um segundo processo. As músicas usadas na validação estão somente em `test-results`, excluído do pacote.

| Ensaio atual | Resultado |
| --- | --- |
| `npm test` | **205 testes aprovados, zero falhas**, incluindo 16 de estrutura melódica, 14 do plano e oito da interface de estudo |
| Análise dos MIDIs reais | Indila: 239,90625 s/788 notas, 22 trechos sugeridos/15 famílias/cinco recorrentes. Take On Me: 20 trechos/14 famílias/cinco recorrentes. Quantidades calculadas do conteúdo, sem usar os cortes antigos ou nomes das músicas como parâmetros |
| `node scripts/qa-study-practice.mjs` | MIDI importado de fato, famílias/revisão, seleção de qualquer família, notas intactas, exercícios nos limites corretos, partida do meio, memória, restauração das guias, reinício e perfis; Indila completa renderizada, zero erros de página |
| `node scripts/qa-experience.mjs` | Estabilidade, partitura, foco em duas dimensões, trajetória livre e seis verificações de luzes no início musical; zero erros de página |
| `node scripts/qa-phrase-practice.mjs` | Opção manual de quantidade continua funcionando; áudio e avaliação respeitam A/B, prévia restaura o transporte, limites/nomes persistem, zero erros de página |
| `node scripts/check-package.mjs` | EXE 0.4 sem `node_modules`, módulos novos presentes, MXL/SVG e áudio SF2 reais, sem requisições externas |
| QA no EXE 0.4 | Experiência/foco/partitura/trajetória/luzes e fluxo completo de estrutura/plano repetidos no `app.asar`, incluindo reclassificação invalidando o checklist anterior; zero erros de página |

O último ajuste do pacote foi somente o texto “Justificativa do limite final”, para distinguir o motivo de um corte da identidade melódica do trecho. Após empacotar novamente, os nove arquivos da aplicação envolvidos na mudança foram comparados byte a byte com o conteúdo do `app.asar`; músicas do usuário e snapshots não estão no pacote. A identidade final está em `docs/evidence/pianocraft-build.json`.

As sugestões são hipóteses locais de altura/intervalo/ritmo e não rótulos semânticos produzidos por um modelo de IA. O retorno G′ na Indila mantém o desenho uma oitava acima com pequenas diferenças rítmicas; outros retornos são agrupados quando a comparação satisfaz os critérios documentados. Uma música pode produzir trechos únicos e limites que ainda atravessam notas pressionadas; esses limites recebem aviso para revisão. Os exemplos de onze partes fornecidos pelo usuário não foram tratados como resultado obrigatório.

O histórico passou a registrar revisão, andamento constante, transposição e escopo avaliado. Marcar exercícios não cria evidência musical. Perfil diferente, revisão diferente, faixa parcial, modo Melodia, andamento desconhecido/alterado, mãos isoladas ou pistas em Auto/Mudo não comprovam execução integral na regra de consistência. Os checklists permanecem separados por perfil/música/revisão e são incluídos no projeto JSON.

## Histórico de validação da versão 0.3

| Ensaio | Resultado executado |
| --- | --- |
| `npm test` | **167 testes aprovados, zero falhas**; MIDI, PPQ/SMPTE, expressão, marcadores, acordes/duração/pedal, portas, iluminação, frases, trajetória livre, MXL/MusicXML, partitura, gravador e bateria |
| `npm run test:app` | Biblioteca, reprodução, espera de notas, partitura, edição, gravação/salvamento, importação e 88 teclas; zero erros de página |
| `node scripts/qa-core.mjs` | Mãos/acompanhamento, teclado após clique, Recital fixo, limites do loop, marcadores persistentes, Melodia estrita e histórico parcial; zero erros de página |
| `node scripts/qa-recording.mjs` | **11 verificações aprovadas com relógio real e janela oculta**; overdub e instrumentos/canais distintos, sustain, recuperação durante tomada, regravar/remover pista, salvar música, atalho Q→C4 e intervalos Auto/Custom incluindo MIDI 0 |
| `node scripts/smoke-soundfont.mjs` | SF2 autoral gerou sinal medido RMS≈0,041; pedal/pânico/recarga/descarte e banco inválido testados |
| `node scripts/check-package.mjs` | EXE abriu sem `node_modules`, avançou reprodução, importou MXL, renderizou SVG e produziu áudio real SF2; zero erros de página e zero requisições externas |
| `node scripts/qa-external.mjs` | EXE abriu um MIDI recebido por argumento; reabrir o arquivo já importado selecionou a música correta sem duplicar a biblioteca |
| `node scripts/qa-practice-timing.mjs` | **17 cenários aprovados** no Electron com teclado PC e bytes MIDI simulados: 80 ms aceito, 500 ms com zero acertos, timestamps enfileirados, duração, pedal curto/suficiente, reataque e limpeza em pausa/busca |
| `node scripts/diagnose-midi.mjs` | Hardware real CASIO USB-MIDI encontrado; entrada abriu e fechou sem erro; não houve execução musical humana durante a escuta |
| `node scripts/qa-midi-hardware.mjs` | Hardware real no aplicativo: conexão automática, seleção PC persistente e restauração do CASIO por nome após ID obsoleto; sem erros de página |
| `node scripts/qa-guide-integration.mjs` | Guias LK-S250 na interface com transporte simulado: mãos, transposição, pausa/busca, teste temporizado, fechamento da saída, notas MIDI mantidas ao perder foco e pausa ao remover entrada; nenhum Note On de áudio enviado pela guia |
| `node scripts/test-guide-hardware.mjs` | Saída CASIO física aceitou 12 SysEx de inicialização, acender/apagar três notas e keepalive; porta fechada e estado limpo após 800 ms; LEDs não observados visualmente |
| `node scripts/qa-experience.mjs` | Geometria estável durante feedback e MIDI em **1440×960 e 1000×720**, realce individual da partitura, foco/Esc, trajetória livre PC/MIDI sem gravar e expiração; luzes somente no início em Ouvir/Melodia/Ritmo a 100%/50%; zero erros de página |
| `node scripts/qa-phrases-panel.mjs` | Revisão de 11 frases, nomes, limites contíguos, dividir/unir, posição local, prévia/cancelamento, salvamento e falhas; plano só aplicado ao salvar |
| `node scripts/qa-phrase-practice.mjs` | **11 frases em uma música, 88 notas preservadas**; prática e acompanhamento respeitam A/B, histórico por frase, loop, passagem única, Recital desde A, anterior/próxima, saída, prévia limitada com restauração, JSON e reload |

O QA de gravação encontrou uma dependência indevida do relógio musical em `requestAnimationFrame`, que pode parar quando a janela não desenha. Reprodução e overdub passaram a usar um timer separado; o teste completo com janela oculta e relógio real confirmou a correção. O desenho continua em RAF.

Os ensaios determinísticos 0.3 instalam o relógio do Playwright antes de carregar o módulo do aplicativo, para que o timer do transporte use o mesmo relógio dos eventos. Ensaios PC/simulados desabilitam a entrada física ou a substituem por transporte explícito; o CASIO real é usado nos testes de hardware identificados. Os scripts de experiência e frases aceitam o caminho do EXE para verificar o código empacotado.

Ambos foram executados também no **EXE 0.3.0**, carregado de `resources/app.asar`, após empacotar: estabilidade/foco/partitura/trajetória/luzes e todos os fluxos de frases passaram sem erros de página. O ensaio geral do pacote confirmou versão 0.3.0, CASIO aberto, perfil LK-S250, MXL, SVG, áudio SF2 e ausência de requisições externas.

Os JSON, logs e capturas completos estão em `test-results/`. A análise do executável original com REA tem evidências separadas em `docs/evidence/`. O registro de build do PianoCraft identifica o EXE e `app.asar` entregues.

A correção 0.2 encontrou o bloqueio MIDI: o Chromium desta versão pede a categoria `midiSysex` mesmo no pedido `sysex:false`; a janela local confiável agora recebe a permissão adequada. Antes, a enumeração era negada antes de abrir qualquer instrumento. A interface passou a distinguir porta encontrada, abertura pendente, porta realmente aberta e falha.

O modelo físico informado é **CASIO LK-S250**. A abertura real da porta foi verificada; notas de testes automatizados do avaliador são simuladas e estão identificadas como tal. O alcance do ensaio de envio de iluminação e a evidência do protocolo estão em [guide-lights.md](guide-lights.md). Latência fim a fim, execução musical humana, observação dos LEDs e todos os casos de SF3/MusicXML não foram certificados. A lista de diferenças está em [coverage.md](coverage.md).
