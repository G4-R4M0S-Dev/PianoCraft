# Análise estática local com REA

Executada em 22/10/2026 sobre `C:\Program Files (x86)\Synthesia\Synthesia.exe`, Synthesia 10.9.5903. O título da janela em execução e o registro de desinstalação confirmaram essa versão.

## Ferramenta e execução

- Fonte oficial: https://github.com/morluto/rea
- Checkout: `tools/rea`, commit `4043e71f6cb9c708b07f3f27e15dfc42663e73f3`.
- CLI distribuído: `rea-agents@6.7.0` em `tools/rea-runtime/node_modules/rea-agents`.
- Runtime usado para os comandos: Node.js 24.19.0 do pacote local de ferramentas do Codex. O Node.js 22.14.0 padrão do terminal é inferior ao mínimo declarado pelo REA.
- A instalação foi local; não foi executado `rea setup` nem alterada a configuração global de agentes.

Comandos executados, com esse runtime:

```text
rea inspect-artifact "C:\Program Files (x86)\Synthesia\Synthesia.exe" --json
rea inspect-pe-resources "C:\Program Files (x86)\Synthesia\Synthesia.exe" --json
rea providers --json
```

O primeiro reconhecimento tentou `inspect-desktop-application`, documentado no checkout, mas indisponível no catálogo do pacote npm 6.7.0. A resposta de erro foi preservada em `evidence/rea-desktop.json`. A análise prosseguiu pelos comandos efetivamente disponíveis; não se atribui sucesso à tentativa anterior. Checkout e pacote npm têm o mesmo número de versão, mas não se presume que tenham conteúdo idêntico.

## Resultados observados

| Observação | Evidência |
| --- | --- |
| SHA-256 | `7fbfa73d43dce29e9a4f0322a94500ce9110a711c3cd29bdcdff3ddc634a361f` |
| Tamanho | 20.153.848 bytes |
| Formato | PE32+, arquitetura x86-64 |
| Tabela de recursos | 296 recursos, 600 entradas examinadas; cobertura completa da tabela admitida |
| Tipos nomeados | DOCS, GRAPHICS, SETTINGS e SONGS |
| Grupo de ícones | 1 |
| Bibliotecas presentes na instalação | BASS, BASSMIDI, Windows MIDI e runtime Microsoft |

Os hashes, faixas e identidades estão em [rea-pe-resources.json](evidence/rea-pe-resources.json); o inventário do artefato está em [rea-artifact.json](evidence/rea-artifact.json). [summary.json](evidence/summary.json) reúne os dados essenciais. Nenhum payload de imagem, música ou banco de sons foi copiado para o PianoCraft.

## Alcance das conclusões

A inspeção prova identidades e estrutura estática dos recursos. Ela não recupera o código-fonte, os algoritmos de avaliação ou a semântica dos payloads. A presença de DLLs é uma observação do diretório, não uma prova de que foram carregadas durante cada operação.

`rea providers` informou Ghidra/IDA/Kuna sem configuração e Hopper sem suporte neste Windows. Portanto **não foi executada descompilação nativa** e nenhum pseudocódigo foi usado como fonte da implementação. Os recursos funcionais foram especificados pela documentação pública, readme instalado e inspeção visual. A primeira tela observada confirmou os três modos de prática, seleção de mãos e distinção entre esperar notas e velocidade constante. Não foram importados dados pessoais da sessão existente do Synthesia.

Essa combinação é suficiente para orientar uma implementação própria e registrar diferenças; ela não demonstra equivalência integral de comportamento ou de latência. A distribuição do PianoCraft usa apenas código próprio e componentes abertos explicitamente licenciados.
