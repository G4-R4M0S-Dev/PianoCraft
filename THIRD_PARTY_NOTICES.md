# Componentes de terceiros

PianoCraft é distribuído sob MIT. As licenças abaixo se aplicam aos respectivos componentes, preservadas em suas cópias locais:

| Componente | Uso | Licença / fonte |
| --- | --- | --- |
| Electron | Aplicativo Windows | MIT e avisos Chromium incluídos na distribuição; https://github.com/electron/electron |
| OpenSheetMusicDisplay | Notação convencional | BSD-3-Clause; `src/vendor/OSMD-LICENSE.txt`; https://github.com/opensheetmusicdisplay/opensheetmusicdisplay |
| SpessaSynth lib/core | SoundFont | Apache-2.0; `src/vendor/spessasynth_lib.LICENSE.txt` e `spessasynth_core.LICENSE.txt`; https://github.com/spessasus/SpessaSynth |
| stb-vorbis | Decodificador de amostras | Licença incluída em `src/vendor/stb-vorbis.LICENSE.txt` |
| fflate | Leitura de ZIP/MXL | MIT; `src/vendor/fflate.LICENSE.txt`; https://github.com/101arrowz/fflate |
| REA | Ferramenta de análise local, não embutida no aplicativo | MIT; `tools/rea/LICENSE`; https://github.com/morluto/rea |

As versões efetivas e dependências de desenvolvimento estão fixadas no `package-lock.json`. Os scripts `prepare-*` geram os bundles locais a partir desses pacotes. O banco PianoCraft Basic e os exercícios incluídos são autorais sob a licença MIT do projeto. Nenhum banco de amostras comercial ou recurso do Synthesia acompanha o aplicativo.
