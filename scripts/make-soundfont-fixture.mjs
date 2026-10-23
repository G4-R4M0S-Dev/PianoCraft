import { BasicSoundBank, BasicInstrument, BasicPreset, BasicSample, GeneratorTypes, SampleTypes } from 'spessasynth_core';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Author-created test timbre. Uses additive sine waves; no recorded/proprietary samples. */
export function makeSoundFontFixture() {
  const bank = new BasicSoundBank();
  bank.soundBankInfo.name = 'PianoCraft Basic';
  bank.soundBankInfo.engineer = 'PianoCraft';
  bank.soundBankInfo.copyright = 'Copyright 2026 PianoCraft contributors. MIT License.';
  bank.soundBankInfo.comment = 'Original synthesized demonstration timbre. Not an acoustic piano recording or a complete GM bank.';
  bank.soundBankInfo.creationDate = new Date('2026-10-22T00:00:00Z');
  bank.soundBankInfo.software = 'PianoCraft fixture generator';
  const rate = 44100;
  const rootKey = 60;
  const frequency = 440 * 2 ** ((rootKey - 69) / 12);
  const length = rate * 3;
  const data = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const time = index / rate;
    const phase = 2 * Math.PI * frequency * time;
    const attack = Math.min(1, time / 0.004);
    const tail = Math.min(1, (length - index) / (rate * 0.08));
    data[index] = attack * tail * 0.62 * (
      Math.sin(phase) * Math.exp(-time * 1.6)
      + 0.3 * Math.sin(phase * 2.001) * Math.exp(-time * 2.8)
      + 0.14 * Math.sin(phase * 3.004) * Math.exp(-time * 4.5)
      + 0.06 * Math.sin(phase * 4.009) * Math.exp(-time * 6)
    );
  }
  const sample = new BasicSample('PianoCraft C4', rate, rootKey, 0, SampleTypes.monoSample, 0, length - 1);
  sample.setAudioData(data, rate);
  bank.addSamples(sample);
  const instrument = new BasicInstrument();
  instrument.name = 'PianoCraft Basic';
  instrument.globalZone.setGenerator(GeneratorTypes.releaseVolEnv, -2200);
  instrument.globalZone.setGenerator(GeneratorTypes.initialAttenuation, 55);
  instrument.createZone(sample);
  bank.addInstruments(instrument);
  const preset = new BasicPreset(bank);
  preset.name = 'PianoCraft Basic';
  preset.program = 0;
  preset.bankMSB = 0;
  preset.bankLSB = 0;
  preset.createZone(instrument);
  bank.addPresets(preset);
  bank.flush();
  return bank.writeSF2();
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const output = new URL('../assets/soundfonts/', import.meta.url);
  await mkdir(output, { recursive: true });
  await writeFile(new URL('PianoCraft-Basic.sf2', output), new Uint8Array(makeSoundFontFixture()));
  await writeFile(new URL('LICENSE.txt', output), 'PianoCraft Basic SoundFont\nCopyright (c) 2026 PianoCraft contributors\n\nThis SoundFont is generated entirely from additive sine waves by scripts/make-soundfont-fixture.mjs. It contains no third-party recordings. It is distributed under the MIT License, as in the root LICENSE file.\n');
  console.log('Generated original MIT SoundFont: assets/soundfonts/PianoCraft-Basic.sf2');
}
