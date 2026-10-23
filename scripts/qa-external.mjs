import { _electron as electron } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createDemoSongs, encodeMidi } from '../src/music/midi.js';
await mkdir('test-results',{recursive:true});
const bytes=encodeMidi(createDemoSongs()[0]),other=encodeMidi(createDemoSongs()[1]);
const input=resolve('test-results/external-input.mid');await writeFile(input,bytes);
const app=await electron.launch({executablePath:resolve('dist/PianoCraft-win32-x64/PianoCraft.exe'),args:['--smoke',input],env:{...process.env,PIANOCRAFT_TEST:'1'}});
try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.waitForFunction(()=>document.querySelector('#song-title')?.textContent==='external-input');
  assert.equal(await page.locator('.song-card').count(),4);
  await app.evaluate(({BrowserWindow},data)=>BrowserWindow.getAllWindows()[0].webContents.send('external-music',[{name:'other.mid',data}]),Array.from(other));
  await page.waitForFunction(()=>document.querySelector('#song-title')?.textContent==='other');
  await app.evaluate(({BrowserWindow},data)=>BrowserWindow.getAllWindows()[0].webContents.send('external-music',[{name:'external-input.mid',data}]),Array.from(bytes));
  await page.waitForFunction(()=>document.querySelector('#song-title')?.textContent==='external-input');
  assert.equal(await page.locator('.song-card').count(),5);assert.deepEqual(errors,[]);
  const result={passed:true,executable:fileURLToPath(new URL('../dist/PianoCraft-win32-x64/PianoCraft.exe',import.meta.url)),argumentFileOpened:true,duplicateOpensExistingSong:true,libraryCount:5,pageErrors:errors};
  await writeFile('test-results/external-result.json',JSON.stringify(result,null,2));console.log('PASS: EXE abriu o arquivo recebido por argumento e reabriu duplicata sem trocar para outra música.');
}finally{await app.close();}
