# Cobertura do PianoCraft 0.7

Data: 22/10/2026. Implementação independente baseada nos comportamentos descritos em [synthesia-analysis.md](synthesia-analysis.md). **Não há certificação de equivalência integral com o Synthesia.** Os 52 critérios da análise de referência são mais amplos que uma verificação automatizada local.

“Validado” abaixo significa que o caminho indicado foi efetivamente exercitado. Testes com mocks de MIDI não demonstram compatibilidade de um piano físico, latência de palco ou protocolos de iluminação.

| Área | Implementação | Evidência / alcance |
| --- | --- | --- |
| MIDI | SMF 0/1, PPQ e SMPTE; múltiplos canais/pistas, running status, tempos e compassos | Testes de leitura e round-trip; SMPTE é normalizado para PPQ ao exportar |
| Expressão MIDI | Pedal, CC, pitch bend, channel/poly aftertouch, programas e marcadores | Testes de round-trip, pedal físico versus duração audível e dispositivos simulados |
| MusicXML/MXL | Partwise, acordes, vozes, pautas, pausas, ligaduras, tempos, dedilhados e repetição simples | DOMParser real no Electron; ZIP limitado, CRC, paths e expansão testados |
| Biblioteca | Importação de arquivos/pasta, busca, ordenação nos dois sentidos, favoritos, coleções, autor, classificação e dificuldade | Fluxos principais de biblioteca/importação no Electron; dados em IndexedDB |
| Prévia | Até oito segundos sem abrir o exercício; interrompível | Implementada; timbres seguem a pista, sem pretensão de equivalência sonora |
| Blocos e teclado | Notas em queda, cores por mão/pista, teclado 49/61/88, faixa automática/personalizada | Fluxos reais de 61/88 teclas e sincronização básica; zoom/rótulos adicionais implementados |
| Estabilidade da tela | Espaço fixo para feedback e atividade MIDI, números tabulares e campos longos limitados | Geometria da partitura/piano/transporte verificada durante acordes, erros e mensagens MIDI em duas dimensões de janela |
| Modo foco | Navegação oculta, partitura/teclado ampliados; botão, F10 e Esc | Layout flexível mantém teclas e transporte dentro da janela; tela cheia continua independente |
| Tema e espaço | Temas claro/escuro/sistema, instrumento no top bar, partitura visível por padrão | Persistência e geometria em 1000×720/1440×960; contraste verificado imediatamente ao alternar a paleta |
| Preparação | Contagem de 0/1/2 compassos, pausa configurável entre loops; cliques no relógio do áudio | 3/4 a 50% validado; contagem não soma tempo nem pontuação e mantém guias físicas apagadas; pausa/busca cancela cliques futuros |
| Conclusão dos exercícios | Etiquetas de prática concluída e revisão concluída, persistentes por perfil/música/revisão | Fluxo real de duas repetições, reabertura e checkbox; conclusão separada do score |
| Conclusão com próximo passo | Aviso sem modal, precisão, progresso de estudo e meta de execuções seguidas; próximo desafio inicia ao escolher a ação; detalhes preservam os percursos e a avaliação recente | Aviso final guiado permanece até a decisão; compacto preserva foco/contagem; meta não atingida propõe consolidação, sem declarar vitória; deduplicação e movimento reduzido; escuta não concede pontos |
| Percursos e conquistas | Matriz Melodia/Ritmo/Recital × esquerda/direita/ambas; até 100 pontos por percurso, meta de cobertura integral e pelo menos 90 pontos | Melodia guiada não comprova ritmo; Ritmo exige ≥90% do andamento e Recital 100%; todas as notas da mão escolhida, sem transposição; mãos sem notas ficam indisponíveis |
| Jornada guiada | Página da música com uma tarefa principal, meta de três execuções seguidas com ≥90% de precisão, mão/modo/trecho/andamento e retomada por perfil/arranjo | Motor com validação de escopo, contagens, duração e identidade; tentativas parciais/duplicadas não avançam; sugestão aumenta andamento, alterna mãos/trechos/modos ou propõe revisão mais lenta |
| Sugestão e revisão | Padrões analisados automaticamente quando falta estrutura; sugestão explícita, revisável, sem bloquear o primeiro treino | Missões aproveitam cortes revisados ou trechos sugeridos, preservando as notas originais; a análise local não afirma interpretar a intenção do compositor |
| Simplicidade do treino | Missão mantém uma tarefa evidente; página da música reúne os percursos; estúdio completo mantém ferramentas manuais | Layout guiado reduz controles concorrentes; navegar entre desafios adapta trecho, mão e andamento da missão |
| Ouvir | Reprodução integral e acompanhamento | Executável empacotado avançou a música sem entrada |
| Melodia | Aguarda acordes atômicos; ataques dentro de 120 ms reais e teclas fisicamente juntas; uníssonos e modo estrito | Testes lógicos e Electron PC/MIDI: 500 ms entre notas = zero acertos; 80 ms = acorde aceito; expiração exige reataque |
| Ritmo | Relógio contínuo, acertos, notas perdidas e notas extras | Janela de ±250 ms documentada e testada |
| Recital | Velocidade 100%, busca/loops bloqueados, avaliação | QA real confirmou bloqueios; pontuação é própria |
| Duração executada | Avaliação central por relógio real convertido pelo andamento; 60% da duração física com tolerância de 120 ms | Pedal não dispensa keyDuration nem simultaneidade; pausa/busca limpa obrigações sem erro |
| Mãos/dedilhados | Por pista ou nota, divisão por altura, dedos 1–5 | Edição exercitada no Electron; JSON preserva metadados |
| Pistas | Aprender/acompanhar, programa, volume, cor, visibilidade e som separados | Implementado; saída MIDI respeita limitações de canais compartilhados do instrumento |
| Transporte/loop | Andamento 20–150%, transposição, pausa/busca/reinício, A/B persistente, reinício por limite de erros | QA confirmou acompanhamento por mão, limites de recital e exclusão da nota exatamente em B |
| Marcadores | Importados/exportados como MIDI meta 0x06 e editáveis no aplicativo | Testes UTF-8/tempo e QA de criar, buscar e restaurar após reload |
| Partitura | OSMD local, XML original ou MIDI quantizado, duas pautas, ritmos, pausas, ligaduras, dedos, transposição, zoom, cursor e página | Testes reais de SVG, repetições, zoom e navegação; MIDI exige interpretação, sem alterar áudio |
| Notas tocadas na partitura | Cabeças individuais com realce e halo, retenção mínima de 350 ms e correspondência por ID/ocorrência | Acordes, teclas PC/MIDI, repetições, ligaduras, transposição e reaplicação após zoom; nenhum redesenho durante o toque |
| Frases | Segmentação variável por conteúdo melódico, revisão de limites/nomes, dividir/unir, ouvir e treinar em loop; quantidade/compassos opcionais manuais | Notas originais preservadas, limites A inclusivo/B exclusivo; metadados v2 persistentes e compatibilidade com v1 |
| Padrões | Famílias de alturas/intervalos/ritmo, retornos exatos, transposições e pequenas variações; comparação visual e explicação; pista e grupos revisáveis | Testes sintéticos contrastantes e MIDI real Indila/Take On Me; não impõe 11 frases nem identifica semanticamente verso/refrão |
| Plano de estudo | Sete sessões sugeridas com família escolhida ou prioridade por histórico; mãos, ritmo, comparações, transições, memória e pontos de partida pela música | Exercícios abrem os limites reais e configuram andamento/mãos/modo; progresso manual separado da evidência de desempenho |
| Entradas | Computador, mouse/toque, uma ou todas as portas MIDI; conexão automática, seleção salva, diagnóstico e atividade visíveis | CASIO USB-MIDI físico abriu no computador de teste; troca para PC e restauração por nome passaram em reload; hotplug/falhas com mocks |
| Perda da entrada | Prática em Melodia/Ritmo/Recital pausa quando uma entrada antes aberta deixa de funcionar; MIDI continua ao perder foco da janela | QA Electron removeu entrada simulada sem acrescentar notas perdidas; acorde MIDI sobreviveu à perda de foco |
| Luzes físicas | Saída independente, perfis CASIO LK-S250 e Navigate/Note On; teste temporizado e limpeza em transições | Protocolo LK-S250 recuperado por leitura estática do comportamento instalado; ver alcance do ensaio físico em guide-lights.md |
| Saída | MIDI escolhido explicitamente; notas, programas, pedal e expressão | Testes de mensagens e limpeza; sem ensaio de hardware físico |
| Sintetizador | Web Audio polifônico próprio, famílias GM aproximadas e controle por canal | Testes de vozes, sustain, pitch bend e volume |
| SoundFont | SF2/SF3 com SpessaSynth local; banco autoral incluído; banco escolhido persistente | SF2 gerou sinal de áudio mensurável no AudioWorklet do EXE; SF3 não possui fixture real validada |
| Piano livre | Instrumentos, acordes/inversões, sétimas, tonalidade maior e graus romanos | Reconhecimento por conjuntos de classes de altura; ambiguidades usam a primeira correspondência por raiz crescente |
| Trajeto no piano livre | Barras sobem das teclas, crescem enquanto pressionadas e conservam a duração após soltar; independe da gravação | Fontes separadas PC/MIDI, relógio real, expiração de histórico e limite de memória |
| Pauta no piano livre | Pauta dupla incremental, acordes, sustenidos, linhas suplementares, duração aproximada, zoom, retenção e trilhas gravadas | PC/MIDI/mouse; overdub ancorado no take, remover pista e nova gravação atualizam a pauta; o limite visual não corta a gravação |
| Metrônomo livre | BPM e compassos 2/4, 3/4, 4/4, 6/8 independentes da gravação | Áudio real de cliques, acento e intervalos; agendamento antecipado resiste ao primeiro atraso do renderizador, parada cancela nós futuros |
| Ritmos | Metrônomo, pop, rock e valsa; BPM/volume próprios | Testes de agenda Web Audio, mudança de andamento, atraso e limpeza |
| Gravação | Seis pistas, overdub com escuta anterior, regravar/remover pista, programas/canais independentes | Testes do gravador e de sua exportação MIDI; fluxo básico gravar/salvar passou no Electron |
| Quantização | Opcional ao salvar: semínimas, colcheias ou semicolcheias | Mantém rascunho original; arquivo salvo quantiza notas e controles |
| Rascunhos | Snapshot a cada dois segundos e salvamento antes do fechamento normal | Modelo de restauração testado; fechamento abrupto do processo pode perder o último intervalo |
| Progresso | Perfis, histórico por música/frase/exercício/modo/mãos, precisão, andamento e escopo avaliados; checklist por revisão | Tentativas antigas sem contexto não qualificam consistência; Auto/Mudo, mudança de andamento ou transposição não comprovam execução integral; histórico e checklist exportáveis em JSON |
| Progresso por música | Escala principal Progresso de estudo de 0 a 100 na biblioteca, página da música, resultado e Meu Progresso; precisão, tempo, evolução e erros por música | Escala é o percentual dos pontos permanentes nos percursos elegíveis; ordenação por progresso usa o mesmo valor; avaliação recente e nove percursos ficam acessíveis nos detalhes |
| Pontos preservados e backup | Melhor evidência por percurso em registro independente do histórico, por perfil e conteúdo do arranjo; backup JSON restaura sem somar duplicatas | Mesma execução não concede pontos adicionais; perfil ou conteúdo diferente não reutiliza evidência; música com conquistas e sem histórico continua visível, sem inventar data/tempo/sessões |
| Erros recorrentes | Local, nota e tipo de erro, agrupados por região com recorrência entre sessões; treino direto do ponto | Dados novos capturados no avaliador; resultados antigos sem posições não são reconstruídos; detalhes limitados têm indicação explícita |
| Preferências | Volume, rótulos, faixa, oitava MIDI e teclas configuráveis | Implementado com persistência local; projeto JSON inclui preferências |
| Desktop Windows | EXE x64, ícone próprio, tela cheia, arquivo por argumento e arrastar/soltar | EXE abriu sem `node_modules`, importou MXL, renderizou partitura e carregou SF2; zero requisições externas nesse ensaio |
| Pagamento/licença | Sem conta, cobrança, ativação ou dependência do Synthesia | Nenhuma biblioteca/arquivo de licença do Synthesia foi usado |

## Diferenças e verificações ainda necessárias

- **Iluminação:** o modelo confirmado no computador de teste é CASIO LK-S250. Outros modelos podem exigir canal Navigate ou protocolo diferente. Aceitação das mensagens pela porta USB não substitui observar os LEDs no instrumento.
- **Fraseado automático:** é uma sugestão musical revisável; não garante a mesma interpretação de um professor. Pausas, compassos e padrões podem exigir ajustes em melodias complexas. Cortes em notas sustentadas têm avisos. O plano fica no projeto/biblioteca, não altera o SMF original.
- **MusicXML avançado:** `score-timewise`, microtons, casas alternativas, D.C./D.S., repetições aninhadas e contagens diferentes de duas execuções não têm reprodução integral. O importador recusa ou avisa conforme o caso. Ornamentos e pedal editorial MusicXML têm limitações explícitas.
- **Partitura derivada de MIDI** é uma interpretação quantizada a semicolcheias, em duas pautas e com limites de tamanho; não recupera escolhas editoriais ausentes do arquivo. XML original oferece maior fidelidade. Substituições múltiplas de dedo na mesma nota não são representadas.
- **Pastas** são importadas quando solicitadas; não há monitoramento automático de mudanças em segundo plano. Prévia não reconstrói toda a expressão do arquivo.
- **Loops e metrônomo** não reproduzem todas as opções de contagem preparatória, pausa entre repetições e compensação de latência do Synthesia.
- **Gravação** captura notas e expressão MIDI, sem áudio de microfone. A exportação JSON conserva metadados de aprendizagem que não pertencem ao MIDI padrão. Acompanhamentos de bateria são síntese própria e não entram como gravação de áudio no arquivo MIDI exportado.
- **Som, pontuação e cursos** são próprios. Não foram copiados o banco Voice Crystal, a coleção de músicas, os desenhos, as animações ou os algoritmos do Synthesia. Os três estudos incluídos são originais. Não se promete identidade de timbre ou de notas de avaliação.
- **Progresso e avaliação têm finalidades distintas:** a escala principal reúne a melhor evidência dos percursos e preserva os ganhos de Melodia. A avaliação de execução, disponível nos detalhes, considera desempenho recente e pode diminuir. Concluir Melodia, marcar uma tarefa manualmente ou ouvir uma música não comprova execução no tempo. A sequência de três execuções é uma meta de estudo, sem pontos extras artificiais. Registros antigos sem contexto suficiente não concedem pontos retroativos.
- **Hardware, latência e SF3** ainda precisam de uma sessão musical real com o instrumento e banco escolhidos pelo usuário. Os testes automatizados não substituem essa etapa.

## Reproduzir os ensaios

```powershell
npm ci
npm run prepare:assets
npm test
npm run test:app
node scripts/qa-core.mjs
node scripts/qa-achievement-panel.mjs
node scripts/qa-progress-panel.mjs
node --test tests/learning-journey.test.js tests/completion.test.js
node scripts/qa-completion-integration.mjs
node scripts/qa-achievement-backup.mjs
node scripts/qa-audio-start-races.mjs
node scripts/smoke-soundfont.mjs
npm run package
node scripts/check-package.mjs
```

Os resultados e capturas dos ensaios locais ficam em `test-results/`, ignorado pelo Git. Evidências do REA ficam em `docs/evidence/`. Uma melhoria futura deve manter esses contratos e adicionar verificação para o comportamento que alterar.
