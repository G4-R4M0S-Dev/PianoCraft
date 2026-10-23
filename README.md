# PianoCraft

Aplicativo Windows independente para aprender e praticar piano com MIDI, partitura e acompanhamento do progresso. Interface em português, código aberto sob [licença MIT](LICENSE), sem cobrança, conta ou ativação. Depois de preparado ou empacotado, funciona offline.

O PianoCraft 0.8.0 oferece biblioteca em lista com importação de MIDI e MusicXML, prática da música inteira, notas em queda, partitura, estudo opcional por mãos e trechos, tarefas com retomada, nove percursos de prática, metrônomo e gravação MIDI com até seis pistas. Inclui três exercícios autorais e um SoundFont básico. É um projeto independente, sem vínculo com o Synthesia.

## Baixar o aplicativo pronto para Windows

**[Baixar PianoCraft 0.8.0 para Windows x64 (ZIP)](https://github.com/G4-R4M0S-Dev/PianoCraft/releases/download/v0.8.0/PianoCraft-0.8.0-windows-x64.zip)**

Extraia todo o ZIP, mantenha os arquivos da pasta `PianoCraft-win32-x64` juntos e execute `PianoCraft.exe`. Feche a versão anterior antes de abrir a nova. O aplicativo pronto dispensa Node.js, npm e Git; os requisitos de desenvolvimento abaixo servem para quem deseja trabalhar no código ou gerar seu próprio pacote.

Veja [as versões publicadas e o checksum do download](https://github.com/G4-R4M0S-Dev/PianoCraft/releases/tag/v0.8.0). O alvo atual é Windows 10 ou superior, x64; o pacote portátil não possui instalador, assinatura digital ou atualização automática.

## Requisitos

- **Windows 10 ou superior, x64**, para a versão de desktop e o empacotamento atualmente disponíveis; esta publicação foi verificada no Windows 11. macOS, Linux, Windows ARM e Windows de 32 bits não foram validados e não têm scripts de distribuição neste projeto.
- Para desenvolver ou gerar o aplicativo: **Node.js 22.12.0 ou superior**, com npm, e Git para clonar. Se baixar o ZIP pelo GitHub, o Git é opcional. A validação local desta publicação usa Node.js 22.14.0 e npm 11.4.2.
- Internet para baixar o código, os pacotes npm e o Electron na primeira instalação/geração. O uso do aplicativo preparado não depende de serviços online.
- Teclado MIDI USB e eventual driver do fabricante são opcionais: também é possível tocar com teclado do computador, mouse ou toque. A janela tem tamanho mínimo de 1000 × 720.

Instale o Node.js pelo [site oficial](https://nodejs.org/) e, se for clonar, o [Git](https://git-scm.com/). Confirme as versões no terminal com `node --version`, `npm --version` e `git --version`.

## Baixar e executar pelo código-fonte

No PowerShell ou em outro terminal, execute:

```sh
git clone https://github.com/G4-R4M0S-Dev/PianoCraft.git
cd PianoCraft
npm ci
npm run prepare:assets
npm start
```

Como alternativa, use **Code → Download ZIP** na página do repositório, extraia o conteúdo e abra o terminal na pasta que contém `package.json`; depois execute a partir de `npm ci`.

`npm ci` instala as versões registradas no `package-lock.json`, inclusive as ferramentas de desenvolvimento, e o script `postinstall` baixa/prepara o executável do Electron antes dos testes paralelos. Não use `--ignore-scripts` nesse fluxo; se já tiver usado, execute `npm run postinstall` antes de continuar. `prepare:assets` prepara os componentes locais de notação, MXL e SoundFont com seus avisos de licença. `npm start` abre o aplicativo no Electron; abrir `src/index.html` diretamente no navegador não substitui essa etapa.

No PowerShell, se a política de execução bloquear `npm.ps1`, use `npm.cmd` nos mesmos comandos, por exemplo `npm.cmd ci` e `npm.cmd start`. Se faltar um componente em `src/vendor`, execute novamente `npm run prepare:assets`. Não é necessário instalar um navegador separado pelo Playwright para os testes descritos abaixo.

## Compilar / gerar a versão para Windows

O código do aplicativo é JavaScript, HTML e CSS. A geração prepara os bundles locais e empacota o aplicativo com o Electron. O fluxo validado usa os binários do Electron e do esbuild; uma dependência opcional da notação (`gl`) pode tentar compilação nativa durante a instalação, dependendo do ambiente. Ela não é usada pelo renderizador do aplicativo, que executa no Electron, mas essa tentativa pode produzir avisos sobre ferramentas C++ ausentes.

Na pasta do projeto, depois de instalar as dependências:

```sh
npm run package
```

O comando executa `prepare:assets` automaticamente e gera:

```text
dist/v0.8/PianoCraft-win32-x64/
└── PianoCraft.exe   (junto dos demais arquivos do Electron)
```

Execute **`dist/v0.8/PianoCraft-win32-x64/PianoCraft.exe`**. Para compartilhar, compacte ou copie **a pasta inteira**, mantendo seus arquivos juntos. O computador de destino não precisa de Node.js, npm ou Git. Feche a versão anterior antes de abrir a nova.

O script atual gera uma pasta portátil x64, sem instalador, assinatura digital ou atualização automática. `npm run package` substitui a saída anterior em `dist/v0.8`; mantenha qualquer cópia que deseje preservar fora dessa pasta. O código publicado no Git não inclui `dist/`, `node_modules/`, ferramentas de análise locais ou resultados de testes: a pasta com o executável só existe depois da geração local. O campo `private` no `package.json` impede publicação acidental no registro npm e não restringe o repositório público ou a licença MIT.

## Verificar a instalação e a geração

Depois de `npm ci` e `npm run prepare:assets`:

```sh
npm test
npm run test:app
node scripts/smoke-soundfont.mjs
npm run package
node scripts/check-package.mjs
```

`npm test` reúne testes de lógica e testes que abrem o Electron real, incluindo MusicXML e partitura. `test:app` verifica o fluxo de uso; `smoke-soundfont.mjs` mede áudio sintetizado; `check-package.mjs` verifica o executável gerado, notação, MXL, áudio e uso offline. Execute esses ensaios numa sessão gráfica do Windows. Os três scripts de integração usam um perfil temporário do PianoCraft; os testes de módulos usam seus próprios ambientes e páginas Electron. Relatórios e capturas são gravados em `test-results/`.

Scripts adicionais de diagnóstico de hardware, como `qa-midi-hardware.mjs`, `diagnose-midi.mjs` e `test-guide-hardware.mjs`, dependem de um CASIO conectado; o teste de guias envia mensagens ao instrumento. Outros ensaios históricos podem depender de arquivos locais e não fazem parte dos comandos gerais acima. Consulte [a validação registrada](docs/validation.md) e [a matriz de cobertura](docs/coverage.md).

## Limitações conhecidas

- **Plataformas e distribuição:** o alvo atual é Windows x64. A pasta portátil não possui assinatura digital nem atualizador; cada nova versão precisa ser gerada ou obtida e substituída manualmente.
- **MIDI:** importa arquivos SMF dos tipos 0 e 1; o tipo 2 não é suportado. A exportação não preserva todos os eventos e metadados originais, como SysEx e letras; arquivos com tempo SMPTE são normalizados para PPQ. Use o backup JSON para conservar mãos, dedilhados, frases, tarefas e progresso. Veja [o formato e a avaliação](docs/midi-practice-format.md).
- **MusicXML e partitura:** o importador trabalha com `score-partwise`. Microtons são rejeitados; casas alternativas, D.C./D.S., repetições complexas, ornamentos e pedal editorial têm restrições. A partitura gerada de MIDI usa quantização a semicolcheias, com limite de 12.000 notas e 1.000 compassos, e pode precisar de revisão. Veja [notação](docs/notation.md).
- **Tamanho das importações:** arquivos musicais têm limite de 32 MiB; XML, 20 MiB; MXL, 64 MiB descompactados e 512 entradas. A importação de pasta tem limite de 256 arquivos, 128 MiB no total e cinco níveis de subpastas. O aplicativo informa arquivos omitidos ou erros de formato.
- **Som:** o SoundFont autoral incluído demonstra síntese por amostras e não reproduz um piano acústico realista ou um banco GM completo. É possível carregar SF2/SF3 de até 256 MiB, respeitando a licença do banco. SF2 foi exercitado com áudio real; SF3 ainda não tem validação com um banco real no projeto. Latência e timbre dependem do banco, dispositivo e driver. Veja [SoundFont](docs/soundfont.md).
- **Instrumentos e luzes:** a entrada física foi verificada com CASIO LK-S250. Outros modelos, a saída MIDI e a latência precisam de teste no equipamento escolhido. A iluminação depende do protocolo; o envio de mensagens pela porta não certifica que os LEDs acenderam. Veja [as guias físicas](docs/guide-lights.md).
- **Gravação e avaliação:** a gravação captura MIDI, sem áudio de microfone e sem exportação de áudio. Fraseado automático, acordes, pontuação e metas são critérios próprios e revisáveis; não substituem avaliação de um professor nem garantem equivalência ao Synthesia. Veja [as regras de prática](docs/practice-rules.md).
- **Dados locais:** os perfis compartilham o armazenamento do aplicativo no computador e não são contas com autenticação. Não há sincronização na nuvem. Exporte o projeto em JSON para backup; SoundFonts externos precisam de cópia separada. Encerramento abrupto pode perder alterações recentes.

## Dados e privacidade

O aplicativo mantém biblioteca, preferências e estudo em `%APPDATA%\PianoCraft Studio`, usando IndexedDB e armazenamento local. Não exige conta, não inclui telemetria e não envia suas músicas para análise online. A instalação das dependências usa a rede; os componentes necessários ao uso ficam locais. **Exportar projeto e progresso** salva um JSON para restauração em outra instalação. Os bancos SoundFont externos não entram nesse arquivo.

## Estrutura do projeto e contribuições

| Pasta | Conteúdo |
| --- | --- |
| `electron/` | Janela desktop, permissões e acesso a arquivos |
| `src/` | Interface, motores MIDI/estudo/áudio e componentes locais em `src/vendor/` |
| `assets/` | Ícones e SoundFont autoral |
| `scripts/` | Preparação, empacotamento e ensaios |
| `tests/` | Testes automatizados e seus ambientes Electron |
| `docs/` | Regras, formatos, cobertura, validação e evidências históricas |

Para relatar um problema ou propor uma melhoria, abra uma [issue](https://github.com/G4-R4M0S-Dev/PianoCraft/issues) informando a versão, Windows, teclado/driver quando aplicável, passos para reproduzir e o resultado esperado. Antes de enviar uma contribuição, execute os testes relevantes. Compartilhe arquivos de exemplo somente quando tiver autorização para distribuí-los.

## Novidades da versão 0.8

- **Música inteira como ação principal:** **Praticar música inteira** prepara a execução do início ao fim, sem repetição automática nem avisos de conclusão entre frases. Um loop ou uma tarefa antiga não muda esse escopo. Os nove percursos também abrem a música inteira com o modo e as mãos escolhidos.
- **Trechos por escolha explícita:** **Estudo por trechos · opcional** mostra intervalo, velocidade e quantidade de execuções. **Estudar este trecho** ou **Continuar este trecho** inicia esse treino guiado. No estúdio, o escopo e a repetição ficam visíveis; **Música inteira** sai do trecho e desliga suas repetições.
- **Velocidade fácil de ajustar e preservar:** a barra de prática mantém o campo numérico, o controle deslizante, os atalhos **75%** e **100%** e os botões **−/+**, que mudam cinco pontos percentuais. A escolha de 20% a 150% fica salva por música e perfil, inclusive após fechar o aplicativo, e também é respeitada ao entrar em um trecho guiado.
- **Seu andamento orienta a jornada:** depois de uma escolha manual de velocidade, atingir a meta pode avançar a mão, o trecho ou o modo sem aumentar o andamento automaticamente. Recital continua em 100%, mas preserva a preferência para quando você voltar a outro modo.
- **Biblioteca compacta:** as músicas aparecem em linhas, com título, duração e informações de estudo, mantendo busca, ordenação, favoritos e acesso às ações da música.

## Histórico da versão 0.7

- **Um próximo passo por música:** abrir uma música mostra seu progresso, a tarefa recomendada e **Começar** ou **Continuar**. A missão informa o trecho, a mão, o modo, o andamento e a meta antes da prática.
- **Meta clara:** faça três execuções seguidas com pelo menos 90% de precisão. Durante o treino, a missão mostra a sequência atual. Ao terminar, o resultado informa se a meta foi atingida e oferece uma próxima ação concreta, como aumentar o andamento, trocar a mão ou consolidar o trecho.
- **Retomada e evolução:** a tarefa e a sequência ficam salvas por perfil e arranjo. Uma nova execução começa no início do trecho. Depois da meta, a sugestão aumenta o andamento em dez pontos percentuais e percorre mãos, trechos e modos. Uma dificuldade acentuada propõe uma revisão mais lenta; a sugestão só começa quando você a escolhe.
- **Uma escala principal:** **Progresso de estudo**, de 0 a 100, aparece na biblioteca, na página da música, no resultado e em Meu Progresso. Ele reúne os pontos preservados de Melodia, Ritmo e Recital. A avaliação recente de execução e os nove percursos permanecem disponíveis nos detalhes.
- **Treino com menos decisões:** os padrões geram uma sugestão de trecho automaticamente; a revisão continua disponível em **Estrutura e padrões**. Escolher outro percurso adapta a missão, sem obrigar a reiniciar toda a música a 100%. **Estúdio completo** mantém as ferramentas manuais.
- **Resultado com continuidade:** a decisão final permanece visível até você escolher o próximo passo, repetir ou fechar. Avisos entre repetições são breves e preservam o foco e a contagem do loop. Quando a meta ainda não foi alcançada, a mensagem propõe consolidar o trecho.

O progresso principal é a proporção dos pontos já conquistados nos percursos que têm notas; ouvir, marcar um checklist ou repetir o mesmo resultado não cria pontos. A meta de três execuções guia o estudo e não substitui uma avaliação musical. Veja [as regras da jornada](docs/learning-journey.md).

## Novidades da versão 0.6

- **Resultado ao concluir:** uma comemoração discreta mostra a precisão, os pontos conquistados no percurso, novos marcos e a evolução do score quando houver avaliação. Oferece **Ver progresso** e **Praticar novamente**, sem tirar o foco do teclado. O som breve pode ser desligado em Configurações, em **Som breve ao concluir uma prática**.
- **Percursos e conquistas:** a matriz separa **Melodia, Ritmo e Recital** para **mão esquerda, mão direita e ambas as mãos**. Cada percurso tem até 100 pontos; a meta é praticar todas as suas notas e alcançar 90 pontos. Mãos sem notas ficam indisponíveis. A matriz aparece no estúdio e nos cartões de **Meu Progresso**.
- **Pontos pela evolução:** completar um novo trecho ou melhorar sua precisão pode aumentar os pontos. Repetir o mesmo resultado preserva a pontuação; loops sem novos ganhos não repetem a comemoração. Melodia registra a prática guiada; Ritmo exige pelo menos 90% do andamento e Recital, 100%, sem transposição e com todas as notas da mão escolhida.
- **Conquistas preservadas:** um registro separado guarda a melhor evidência de cada percurso por música, arranjo e perfil. Ele acompanha o backup JSON, mesmo quando o histórico detalhado já não está disponível. Os pontos conquistados são permanentes naquele arranjo; o **score recente de domínio** continua sendo uma avaliação separada, que pode cair se a execução piorar.

Na versão 0.7, clicar em um percurso adapta a tarefa atual ao modo e às mãos escolhidas. Melodia começa a 60%, Ritmo a 90% e Recital a 100%, preservando o andamento da tarefa quando o percurso já é o mesmo. Pausar uma tentativa não anuncia conclusão nem concede pontos. Registros antigos sem o contexto necessário continuam no histórico, mas não comprovam uma conquista.

## Novidades da versão 0.5

- **Tema claro**, escuro ou seguindo o sistema; altere pelo botão de sol/lua no topo ou nas configurações. A conexão do instrumento agora ocupa a barra superior ao lado da navegação.
- **Partitura visível por padrão**, com indicador de compasso/pulso/notas e zoom. No **Piano livre**, uma pauta dupla registra as teclas tocadas, acordes e durações aproximadas; permanece após soltar as teclas e após gravar pistas. O overdub se alinha ao início das pistas anteriores.
- **Metrônomo independente no piano livre**, com BPM e compassos 2/4, 3/4, 4/4 e 6/8. As batidas são agendadas no relógio do áudio e continuam durante a gravação.
- **Preparação dos exercícios:** um compasso de contagem antes de tocar e um segundo de pausa antes de repetir, seguidos da nova contagem. O compasso e a velocidade do trecho determinam os cliques. Ajuste ou desligue em Configurações; durante a preparação o tempo musical, as guias físicas e a avaliação ficam pausados.
- **Etiquetas de conclusão:** uma prática terminada recebe “Prática concluída”; uma revisão marcada recebe “Revisão concluída”. Esses registros permanecem no plano e no backup, separados da avaliação musical.
- **Meu Progresso por música:** sessões agrupam os loops; cada música tem tempo, precisão, evolução comparável, cobertura, score e pontos de erro recorrentes com botão para praticar o trecho. A biblioteca mostra o score e ordena a última prática da mais recente para a mais antiga por padrão.

O mapa de erros usa a posição, a nota e o tipo de erro registrados nas novas práticas. O histórico antigo continua disponível, mas não permite reconstruir posições de erros que não foram gravadas. O score é uma referência de avaliação do programa, e o gráfico diferencia precisão de cobertura e consistência. Veja [o cálculo do progresso](docs/progress.md).

## Estrutura musical e estudo

Abra a música e use **Praticar música inteira** para tocar do início ao fim. Se quiser estudar partes, escolha a sugestão em **Estudo por trechos · opcional**. Em **Estrutura e padrões**, use **Analisar padrões da música** para examinar e revisar a divisão. A quantidade de frases depende dos retornos, pausas e desenhos melódicos do arquivo. Não existe uma regra de onze partes, nem cortes iguais em segundos.

- O mapa **A, B, A′…** mostra famílias, reaparições exatas, transposições e pequenas variações, com os tempos reais e uma comparação com a primeira ocorrência.
- Ouça a base e o retorno, escolha a pista melódica e revise os agrupamentos. Em **Revisar limites das frases**, ajuste cortes, una ou divida trechos; depois salve a revisão.
- **Plano e exercícios** propõe sete sessões ajustáveis: reconhecer intervalos e ritmo, separar/unir mãos, comparar variações, ligar frases, começar de outros pontos e recuperar o desenho de memória.
- Cada exercício configura o trecho, andamento, mãos e modo. O desafio de pontos de partida distribui entradas pela música; o exercício de memória esconde as pistas visuais e apaga as guias físicas até encerrar o exercício.
- O progresso é separado por música, revisão e perfil. Marcar uma atividade registra seu relato; a avaliação usa tentativas completas e recentes, com escopo e andamento conhecidos. Não presume o primeiro minuto dominado.

A análise é local e revisável, baseada em alturas, intervalos e ritmo. Não usa um serviço de IA nem afirma identificar verso, refrão ou intenção do compositor. Em pistas polifônicas, usa a voz superior de cada ataque e permite corrigir a pista. Veja [padrões](docs/patterns.md) e [plano de estudo](docs/study-plan.md).

## Recursos de prática

- Mensagens de erro/acerto e atividade MIDI têm espaço fixo, para não deslocar o piano enquanto você toca.
- A cabeça da nota correspondente na partitura acende ao receber a tecla física, do computador ou do mouse. O realce considera a ocorrência correta, acordes e transposição.
- No **Piano livre**, as notas tocadas deixam barras que sobem a partir das teclas, mesmo sem gravar.
- **Modo foco** esconde a navegação e amplia a partitura e o teclado. Use o botão ou **F10**; **Esc** sai do foco. **F11** continua alternando tela cheia.
- O perfil LK-S250 envia o comando de iluminação quando a posição musical chega à nota. Não há antecipação; a velocidade e a espera do modo Melodia são respeitadas. A resposta dos LEDs precisa ser conferida no instrumento.

Para praticar por frases, salve a estrutura e use a barra de frases para escolher um trecho. Confira o intervalo e a repetição indicados na tela; você pode repetir em loop ou fazer uma passagem única. **Música inteira** sai desse treino, restaura o intervalo completo e desliga a repetição. A revisão de limites também oferece quantidade ou compassos como opções manuais, quando você desejar impor esses cortes.

As sugestões consideram o mapa de andamento, compassos, pausas melódicas, padrões e marcadores; a revisão permite ajustar o fraseado à música. O MIDI permanece inteiro, sem duplicar arquivos ou alterar suas notas. As frases ficam na biblioteca e no backup JSON; a exportação MIDI inclui a música inteira, sem recortá-la pelas frases e com as limitações de conservação de eventos descritas acima. Veja [o guia de frases](docs/phrases.md).

## Usar

1. Abra um dos três exercícios autorais ou importe MIDI, MusicXML/XML e MXL. Também é possível arrastar arquivos e importar uma pasta.
2. Abra uma música e escolha **Praticar música inteira**. A tela prepara a música completa, sem iniciar nem repetir automaticamente; pressione **Espaço** ou o botão de reprodução para começar. Melodia espera as notas corretas; Ritmo segue o relógio; Recital mantém 100% de velocidade e desabilita busca e loops.
3. Ajuste **Velocidade** na barra visível: digite a porcentagem, use o controle deslizante, **−/+** ou **75%/100%**. A escolha fica salva para aquela música e perfil. Para repetir uma parte com meta, volte à página da música e escolha **Estudar este trecho** ou **Continuar este trecho**. Para configurar pistas, transposição, metrônomo ou pontos A/B, abra **Estúdio completo**. Confira sempre o escopo e a repetição mostrados acima da partitura; **Música inteira** encerra o treino por trecho.
4. Expanda **Pistas e acompanhamento** para selecionar partes, mãos, cores e instrumentos. Em **Editar notas**, atribua mãos e dedos às notas.
5. A faixa **Instrumento** mostra a entrada física, o estado real da abertura e cada nota/pedal recebido. O CASIO conecta automaticamente; a seleção fica salva e pode ser alterada nessa faixa. **Instrumento e luzes** configura separadamente a saída de áudio e a iluminação. O perfil específico **CASIO LK-S250** usa mensagens de iluminação próprias, sem tocar as notas de áudio. O botão **Testar luzes** envia comandos de Dó–Mi–Sol por 0,8 s para conferir a iluminação no instrumento.
6. Em **Piano livre**, toque com mouse, teclado ou MIDI, reconheça acordes e grave. Salve a gravação na biblioteca para ouvir, estudar e exportar MIDI.
7. **Exportar projeto e progresso** preserva biblioteca, estruturas revisadas, planos marcados, mãos, dedilhados, histórico, conquistas e retomada da jornada em JSON. Reimporte esse arquivo para restaurá-los.

No teclado do computador: **A W S E D F T G Y H U J K O L P** tocam notas; **Z/X** mudam a oitava; **Shift** sustenta; **Espaço** inicia/pausa; **F11** alterna tela cheia. O teclado virtual aceita toque e mouse. Em menus e campos de edição, as teclas mantêm sua função habitual.

Na versão 0.2, um acorde só pontua quando todas as alturas estão pressionadas juntas e seus ataques ocorrem dentro de **120 ms reais**. Tocar as notas separadamente enquanto a música aguarda não acumula acertos. A interface permite 80/120/180 ms e informa tentativa expirada, nota fora de tempo ou soltura antecipada. O pedal não transforma notas já soltas em um acorde válido. Consulte as [regras de avaliação](docs/practice-rules.md).

O perfil é alterado nas configurações e filtra os resultados. Os dados ficam em `%APPDATA%\PianoCraft Studio`: biblioteca, histórico detalhado, conquistas, jornada de estudo, checklists, rascunhos e SoundFont no IndexedDB; preferências de prática por música/perfil e um cache compacto do histórico no armazenamento local. A versão 0.8 mantém a leitura do histórico antigo. No fechamento normal, o aplicativo aguarda o salvamento. Exporte o projeto para fazer cópias independentes; bancos SoundFont são preservados no computador e podem ser copiados separadamente.

## Análise solicitada com REA

O repositório oficial foi baixado em `tools/rea`, commit `4043e71f6cb9c708b07f3f27e15dfc42663e73f3`. O CLI `rea-agents@6.7.0` foi instalado localmente em `tools/rea-runtime` e usado sobre o executável instalado, sem modificar seus bytes. Os diretórios `tools/` são ferramentas locais e não entram na distribuição do PianoCraft.

- [Análise funcional do Synthesia 10.9.5903](docs/synthesia-analysis.md)
- [Método, evidências e limites do REA](docs/rea-analysis.md)
- [Cobertura e diferenças da implementação](docs/coverage.md)
- [Formato MIDI e avaliação](docs/midi-practice-format.md)
- [Iluminação CASIO e evidências do protocolo](docs/guide-lights.md)

## Validação e limites

`npm test` executa testes de MIDI, prática, MusicXML, MXL, gravação e notação, conforme os módulos disponíveis. `npm run test:app` testa o fluxo real no Electron. `node scripts/smoke-soundfont.mjs` carrega o banco autoral e mede sinal de áudio no AudioWorklet.

Esta entrega é uma base funcional, **não uma certificação de paridade integral com o Synthesia**. A matriz de cobertura registra diferenças e recursos que dependem de ensaio com teclado físico. O cálculo de pontuação é próprio. Notação derivada de MIDI exige quantização; MusicXML preserva mais informações editoriais. Formatos e construções musicais não suportados produzem erros ou avisos explícitos.

Os exercícios, desenhos e o pequeno banco `PianoCraft-Basic.sf2` foram criados para este projeto. O banco Basic demonstra síntese por amostras; para som de piano realista, carregue um SF2/SF3 que você tenha autorização para usar. Os sons e a biblioteca musical do Synthesia não foram reutilizados.

## Componentes abertos

Electron fornece a janela desktop; OpenSheetMusicDisplay renderiza notação; SpessaSynth sintetiza SoundFonts; fflate lê MXL. Os bundles são locais e levam suas licenças em `src/vendor`. As licenças do Electron acompanham a pasta empacotada. Consulte [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
