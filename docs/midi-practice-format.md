# Modelo MIDI, projeto JSON e avaliação

O modelo interno usa segundos para `notes[].time`, `notes[].duration` e `notes[].keyDuration`, número MIDI 0–127 para altura, velocidade 0–1 e índices de pista/canal a partir de zero. `tempos`, `timeSignatures`, `markers` e `events` também usam segundos. O importador aceita arquivos Standard MIDI File de formato 0 e 1 com divisão PPQ ou SMPTE válida; formato 2 e divisões inválidas são rejeitados com mensagem explícita.

## Importação e exportação MIDI

O importador interpreta running status, Note On de velocidade zero como soltura, andamento variável, compassos, nomes de pista e mudanças de programa. O campo `programChanges` conserva o instante e o canal de cada mudança de instrumento. O exportador mantém esses eventos, pistas, canais, velocidades e tempos, sujeitos à resolução PPQ e ao arredondamento de microssegundos do formato MIDI.

Divisões SMPTE aceitam códigos -24, -25, -29 e -30 e resolução de 1 a 255 ticks por quadro. O código -29 usa 30000/1001 quadros por segundo. Esse relógio define os segundos independentemente dos eventos de andamento, que ainda são conservados com seus instantes corretos para notação e metrônomo. O modelo editável normaliza essas importações para PPQ 480 e o exportador reconstrói um MIDI PPQ com o mapa de andamento: os tempos absolutos são conservados dentro do arredondamento de ticks, mas a divisão SMPTE original não é regravada. A documentação primária [Timing Information, Microsoft](https://learn.microsoft.com/en-us/windows/win32/multimedia/timing-information) descreve os códigos e a independência do andamento.

O pedal sustain (CC64) prolonga a duração efetiva das notas até sua liberação. All Sound Off (CC120), Reset All Controllers (CC121) e All Notes Off (CC123) também afetam o término das notas. Se faltar uma soltura, a nota termina no final do arquivo. O estado do pedal é compartilhado por notas do mesmo canal, inclusive em pistas diferentes.

Os controladores CC originais, pitch bend, pressão de canal e por tecla e programas são preservados em `song.events`; veja o [schema de expressão MIDI](midi-events.md). `keyDuration` conserva a soltura física e `duration` inclui sustain para apresentação visual. O exportador escreve note-off pela duração física junto com os eventos de pedal, evitando prolongamento duplicado. Marcadores textuais são preservados em `markers:[{time,text}]` como metaeventos 0x06. SysEx, letras e outros metadados não têm conservação de ida e volta nesta versão. Duas vozes sobrepostas com a mesma altura, canal e pista são associadas às solturas por ordem de ataque, pois o SMF não identifica individualmente essas vozes.

As mudanças de programa fazem parte do modelo e da exportação. A presença delas no modelo não comprova sua reprodução em tempo real pelo aplicativo: o agendador de áudio deve aplicá-las separadamente.

MIDI exportado não conserva os campos de mão, dedilhado, favoritos, configurações de prática ou histórico do PianoCraft. Para esses dados, use **Exportar projeto e progresso** em JSON. A normalização JSON conserva `notes[].hand` (`left` ou `right`), `notes[].finger` (1–5), `notes[].keyDuration`, `favorite`, `configs`, `programChanges`, `events`, `markers`, andamento e compassos. O backup do aplicativo inclui a biblioteca e o histórico. Os testes verificam a conservação desses metadados após serializar e ler o JSON.

## Regras de prática

No modo Melodia, o transporte para no próximo início pendente. Um acorde é aceito como grupo indivisível: todas as alturas precisam estar fisicamente pressionadas juntas, com ataques dentro de **120 ms reais**, mesmo que a música esteja parada. Uma tentativa incompleta soma zero acertos; expirar ou soltar uma tecla exige novos ataques. A interface oferece 80/120/180 ms. Uníssonos de mesmo início (tolerância numérica de 1 microssegundo) compartilham uma tecla; uma repetição posterior exige soltura e outro ataque. Notas anteriores à busca e notas exatamente no final do trecho ficam fora da sessão.

A janela de aceitação é de ±200 ms no modo Melodia e de ±250 ms nos modos contínuos de prática. Nos modos contínuos, uma nota pendente vira ausência quando passa mais de 250 ms de seu início. Uma entrada sem nota correspondente incrementa erros. A precisão é `acertos / (acertos + ausências + erros) × 100`, arredondada ao inteiro; sem eventos avaliados, ela permanece indefinida. Uníssonos conservam os IDs de cada nota no total de acertos.

A soltura é avaliada no próprio motor: segurar por menos de `60% da duração física − 120 ms` registra um erro adicional. A duração usa o relógio real e o andamento, inclusive com transporte parado. Pedal não dispensa `keyDuration`; quando o arquivo só traz duração acústica, pode sustentar esse som, mas nunca mantém a tecla fisicamente pressionada para completar acordes. Uníssonos usam a maior duração física. Melodia estrita aguarda a soltura de notas incorretas. Os detalhes do contrato e dos cenários estão em [practice-rules.md](practice-rules.md).

Essas regras são próprias do PianoCraft e não reproduzem uma fórmula interna do Synthesia.

## Verificação local

`node --test tests/midi.test.js tests/smpte.test.js tests/controllers.test.js tests/recorder.test.js tests/practice.test.js` cobre o parser, exportação, relógios PPQ/SMPTE, mapas de tempo, sustain entre pistas, controllers, pitch bend, pressões, marcadores UTF-8, soltura física, gravação, validação de entradas, 20 mil notas, metadados JSON, espera por acordes, uníssonos e fronteiras de busca. Esses testes de lógica não substituem um ensaio físico com entrada/saída MIDI nem confirmam paridade dos demais recursos do aplicativo.
