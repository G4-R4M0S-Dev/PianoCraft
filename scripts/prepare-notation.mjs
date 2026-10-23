import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const bundle = require.resolve('opensheetmusicdisplay');
const packageRoot = path.resolve(path.dirname(bundle), '..');
const metadata = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
const destination = fileURLToPath(new URL('../src/vendor/', import.meta.url));
await mkdir(destination, { recursive: true });
await copyFile(bundle, path.join(destination, 'opensheetmusicdisplay.min.js'));
await copyFile(path.join(packageRoot, 'LICENSE'), path.join(destination, 'OSMD-LICENSE.txt'));
const notices = [];
const seen = new Set();
async function collectLicenses(directory) {
  if (seen.has(directory)) return;
  seen.add(directory);
  const data = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  const licenseFiles = (await readdir(directory)).filter(name => /^(license|copying)(?:[.\-_]|$)/i.test(name));
  for (const filename of licenseFiles) notices.push(`${data.name} ${data.version} (${data.license || 'see license'})\n${await readFile(path.join(directory, filename), 'utf8')}`);
  const resolveFromPackage = createRequire(path.join(directory, 'package.json'));
  for (const dependency of Object.keys(data.dependencies || {}).filter(name => !name.startsWith('@types/'))) {
    const dependencyJson = resolveFromPackage.resolve(`${dependency}/package.json`);
    await collectLicenses(path.dirname(dependencyJson));
  }
}
await collectLicenses(packageRoot);
await writeFile(path.join(destination, 'opensheetmusicdisplay.min.js.LICENSE.txt'), notices.join('\n\n' + '-'.repeat(72) + '\n\n'));
await writeFile(path.join(destination, 'osmd-version.json'), JSON.stringify({ name: metadata.name, version: metadata.version, source: 'https://github.com/opensheetmusicdisplay/opensheetmusicdisplay', license: metadata.license }, null, 2));
console.log(`OpenSheetMusicDisplay ${metadata.version}: bundle e licença preparados para uso offline.`);
