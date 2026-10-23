import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const metadata=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const directory=process.argv[2]?dirname(resolve(process.argv[2])):fileURLToPath(new URL('../dist/v0.8/PianoCraft-win32-x64/',import.meta.url));
const files=[];
for(const name of ['PianoCraft.exe','resources/app.asar']){
  const path=join(directory,name),hash=createHash('sha256');
  for await(const chunk of createReadStream(path))hash.update(chunk);
  files.push({path:name,bytes:(await stat(path)).size,sha256:hash.digest('hex')});
}
const output=new URL(`../docs/evidence/pianocraft-v${metadata.version}-build.json`,import.meta.url);
await writeFile(output,JSON.stringify({name:metadata.productName,version:metadata.version,platform:'win32-x64',builtAt:new Date().toISOString(),files},null,2)+'\n');
console.log(`Build identities saved in docs/evidence/pianocraft-v${metadata.version}-build.json.`);
