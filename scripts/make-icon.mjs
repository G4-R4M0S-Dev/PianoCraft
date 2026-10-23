import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

// Regenerate all raster artwork from the original, code-native SVG in the repo.
const source = await readFile(new URL('../assets/icon.svg', import.meta.url), 'utf8');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({ args: [fileURLToPath(new URL('./icon-harness.cjs', import.meta.url))], env: environment });
try {
  const page = await application.firstWindow();
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = [];
  for (const size of sizes) {
    await page.setContent(`<html><head><style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${source}</body></html>`);
    const raster = await page.locator('svg').screenshot({ type: 'png', omitBackground: true, animations: 'disabled', scale: 'css' });
    if (raster.readUInt32BE(16) !== size || raster.readUInt32BE(20) !== size) throw new Error(`Ícone rasterizado com tamanho incorreto: ${size}px.`);
    images.push(raster);
  }
  await writeFile(new URL('../assets/icon.png', import.meta.url), images.at(-1));
  // Windows ICO supports a PNG image for each embedded resolution.
  const directory = Buffer.alloc(6 + sizes.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    directory[entry] = size === 256 ? 0 : size;
    directory[entry + 1] = size === 256 ? 0 : size;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(images[index].length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  });
  await writeFile(new URL('../assets/icon.ico', import.meta.url), Buffer.concat([directory, ...images]));
  process.stdout.write(`PianoCraft icon generated: PNG 256×256; ICO ${sizes.join(', ')} px.\n`);
} finally { await application.close(); }
