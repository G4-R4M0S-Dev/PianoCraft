# Luzes do teclado físico

Verificação de documentação e ensaio de transporte: 22/10/2026. O usuário confirmou **CASIO LK-S250**. O nome `CASIO USB-MIDI` e o identificador USB `VID_07CF/PID_6803` sozinhos não comprovam um modelo de teclado nem seu protocolo de LEDs.

Na versão 0.3, a aplicação envia a guia somente quando a posição musical chega ao início da nota, sem antecipação. Em Melodia, o acorde permanece indicado enquanto o transporte espera sua execução; a próxima guia só acende ao chegar ao próximo início. Ritmo/Ouvir acompanham o andamento escolhido. Pausa, busca e troca de trecho apagam as guias anteriores.

## Perfis implementados

| Perfil | Mensagens | Valores iniciais |
| --- | --- | --- |
| `casio-lks250` | SysEx próprio de guia do LK-S250, sem Note On de áudio | Nota MIDI sem deslocamento; keepalive de 180 ms; exige SysEx |
| `casio-navigate` | Note On/Note Off no canal Navigate configurado no teclado | Canal 4, velocity 1, deslocamento 0 |
| `midi-note` | Note On/Note Off no canal escolhido | Canal 1, velocity 1, deslocamento 0 |

Nos perfis por notas, os canais mostrados ao usuário vão de **1 a 16**. O byte MIDI usa o canal menos um: uma luz de dó central, nota MIDI 60, no canal 4 produz `[0x93, 60, 1]`; apagar produz `[0x83, 60, 0]`. Não há transposição implícita de oitava. O deslocamento opcional é aplicado à nota MIDI, e notas fora da faixa do perfil são ignoradas. A transposição musical deve ser aplicada pelo transporte antes de chamar `update`.

`casio-navigate` usa o mecanismo Navigate documentado pelo fabricante. `casio-lks250` implementa separadamente o formato proprietário de guia recuperado do programa instalado, conforme a evidência abaixo. O perfil proprietário ignora canal/velocity e não aciona o gerador de notas por mensagens Note On. Nenhum SysEx desconhecido é enviado. Os perfis só ficam ativos depois da seleção da saída de luzes.

## Configuração no CASIO

Nos modelos LK compatíveis, confirme **Key Light/Keylight ligado** e o **Navigate Channel/Navi. Ch**. A FAQ oficial CASIO descreve canal 4 para a mão direita e 3 para a esquerda como configuração inicial. O manual LK-230 explica o par de canais vizinhos: escolher o canal direito também escolhe o imediatamente anterior para a mão esquerda. Envie as luzes para um canal que o seu teclado esteja usando para Navigate. [FAQ CASIO](https://www.casio.com/europe/support/electronic-musical-instruments/faq/article/00/09/69/19/), [manual LK-230, E-35–36](https://support.casio.com/pdf/008/LK230E1A_web.pdf).

No **LK-S250**, o manual lista `MIDIInNavigate` e `MIDIInNavi R Ch`/`MIDIInNavi L Ch` em Configuração de Funções, EN-38. O modo Navigate precisa estar habilitado; `Listen` habilita a navegação, e os modos de mão desligada permitem silenciar a parte de estudo. Ajuste no próprio instrumento os canais correspondentes à saída selecionada no PianoCraft. Os canais R/L desse modelo são independentes. [Manual oficial LK-S250](https://www.casio.com/content/dam/casio/global/support/manuals/electronic-musical-instruments/pdf/008-en/l/LKS250_usersguide_B_EN.pdf).

Mensagens Note On podem gerar som no instrumento. Velocity 1 reduz esse som, mas não garante silêncio. O manual LK-210/215 descreve desligar o som da parte Navigate com RIGHT e da parte anterior com LEFT, preservando a guia visual. A disponibilidade e os botões variam por modelo. O programa não altera automaticamente volume, Local Control ou configurações do teclado. [Manual LK-210/215, E-37](https://support.casio.com/pdf/008/LK210_215_e.pdf).

As mensagens exatas de Note On/Off são definidas na implementação MIDI CASIO: status `9n`/`8n`, nota 0–127 e velocity. O suporte MIDI não prova, sozinho, suporte a luzes. [Implementação MIDI oficial CT-S200/CT-S300/LK-S250, seções 6–7](https://www.casio.com/content/dam/casio/global/support/manuals/electronic-musical-instruments/pdf/008-en/l/LKS250_midiimplementation_EN.pdf).

## Evidência do Synthesia instalado

O arquivo `C:\Program Files (x86)\Synthesia\readme.html`, linha 207, identifica o perfil **Proprietary 2** para o LK-S250. A linha 505 documenta velocity padrão 1 para guias por notas e a alternativa 2 para modelos que piscam. Essas são informações fornecidas pelo próprio programa.

No arquivo local `%APPDATA%\Synthesia\multiDevice.xml`, a saída CASIO contém `lightChannel="-4"`. A análise estática do executável confirmou que **-4 seleciona Casiotone LK-S250/Proprietary 2**: a referência ao texto do modelo e os dois usos de -4 aparecem juntos no bloco de escolha. Não é o canal MIDI 4. A página pública do Synthesia confirma o suporte a guias de próxima nota em Melody Practice. [Synthesia: teclados](https://synthesiagame.com/keyboards/info).

REA 6.7.0 registrou o inventário e os recursos PE do executável. Não havia um motor nativo Ghidra/Hopper/IDA configurado; a conclusão sobre instruções foi complementada por leitura estática com Capstone 5.0.7, sem executar o alvo. O SHA-256 e os endereços exatos ficam em [guide-lights-static.json](evidence/guide-lights-static.json). O script de reprodução é `tools/analyze-key-lights.py`. A implementação nova expressa apenas o formato de comunicação recuperado; não inclui código do Synthesia.

O ramo de perfil -4 monta a mensagem `F0 44 7E 7E 7F 02 00 nn vv F7`, onde `nn` é a nota MIDI e `vv` é 1 para acender ou 0 para apagar. A constante fica em VA `0x14043c7e8`, e os campos são substituídos em `0x14011fda3` e `0x14011fdb9`. A faixa admitida nesse ramo é 21–108, sem deslocar a numeração das notas.

A inicialização/keepalive é `F0 44 7E 7E 7F 00 03 F7`, constante em VA `0x14043c7d8`. O relógio em `0x140120390..0x1401203cd` converte o contador para nanosegundos usando o fator 1.000.000.000; `0x140120472` soma `0xABA9500`, ou 180.000.000 ns = **180 ms**. O módulo usa esse período enquanto há luzes ativas, cancela o timer ao limpar/parar e reativa a inicialização na próxima sequência. Não foi inferido um comando não documentado de saída do modo.

## Contrato do módulo

```js
import { GuideLights } from './src/music/guide-lights.js';

const lights = new GuideLights({
  onChange: status => updateLightsStatus(status),
  onError: error => showError(error.message),
});
// Abra a porta pelo gerenciador MIDI, depois da escolha explícita do usuário.
// Para LK-S250, obtenha antes acesso com requestMIDIAccess({sysex:true}).
lights.connect(selectedMidiOutput, { profile: 'casio-lks250' });
lights.update([60, 64, 67]);
lights.allOff(); // pausa, busca, troca de música/modo/mãos, parada e fechamento
lights.test([60, 64, 67], 800); // teste temporizado; lights.testing indica execução
lights.disconnect();
```

`connect(output, profile, channel, options)` também é aceito. `output` pode ser um MIDIOutput, um adaptador com `send(bytes)` síncrono ou uma função síncrona; retornar `false` sinaliza falha. `status` expõe conexão, identificação da porta, perfil, canal, deslocamento, velocity, notas acesas e mensagem de erro. `onChange` só é chamado na mudança de estado, não em quadros com o mesmo conjunto de notas.

O módulo **não abre nem fecha a porta**, para respeitar seu compartilhamento com outros consumidores. Quem administra a porta deve mantê-la aberta enquanto a rota de luzes estiver ativa. A saída das luzes é independente da saída musical: nenhum dispositivo é escolhido automaticamente. A rota não envia CC de volume, reset global ou programas. Cada guia acesa recebe sua mensagem de apagar, uníssonos são consolidados e quadros repetidos não duplicam mensagens de notas. O keepalive é periódico por exigência do protocolo proprietário. `GUIDE_LIGHT_PROFILES[profile].requiresSysex` indica quando elevar o acesso MIDI; se a permissão não estiver disponível, o envio falha de forma explícita e a rota é desabilitada.

Na remoção ou falha de envio, o módulo tenta apagar suas notas, limpa seu estado e desabilita a rota. Se o cabo já estiver retirado, nenhuma aplicação consegue entregar o Note Off naquele instante. Ao selecionar novamente uma porta com o mesmo ID, o módulo entrega primeiro os Note Off pendentes, inclusive de um canal anterior. As transições do aplicativo devem chamar `allOff()` antes de alterar seu contexto. Durante um teste manual, o loop de renderização deve respeitar `testing` para não substituí-lo imediatamente por outro conjunto de notas.

## Verificação

`node --test tests/guide-lights.test.js` verifica bytes exatos dos três perfis, canais 1/3/4/16, velocity, deslocamento, ausência de mensagens duplicadas, keepalive, limpeza nas transições, teste temporizado, erros, remoção e reconexão. Esses testes exercitam transportes simulados.

`node scripts/test-guide-hardware.mjs` executou um teste **real de saída** no computador de teste: CASIO USB-MIDI abriu com `sysexEnabled=true` e aceitou 12 SysEx, sendo 3 para acender C4/E4/G4, 3 para apagar e 6 de inicialização/keepalive. O teste de 800 ms encerrou sem erros, sem notas acesas no estado do módulo e com a porta fechada. O relatório está em `test-results/guide-hardware.json`. Isso confirma abertura, permissão, aceitação de envio pelo transporte e limpeza; **o estado visual dos LEDs não foi observado e entrada de teclas não foi testada nesse ensaio**. A confirmação visual e uma execução musical com o usuário permanecem separadas.
