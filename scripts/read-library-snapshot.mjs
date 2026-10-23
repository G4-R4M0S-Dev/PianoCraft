import { _electron as electron } from 'playwright';
import { mkdir, readdir, copyFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Read a copy of this application's library. Never open the user's live LevelDB
// with a second Electron process, and never write back to the source profile.
const source=join(process.env.APPDATA,'PianoCraft Studio','IndexedDB');
const directory=resolve('test-results',`library-snapshot-${Date.now()}`),profile=join(directory,'profile');
async function copyTree(from,to){
  await mkdir(to,{recursive:true});
  for(const entry of await readdir(from,{withFileTypes:true})){
    if(entry.isSymbolicLink()||entry.name==='LOCK')continue;
    const input=join(from,entry.name),output=join(to,entry.name);
    if(entry.isDirectory())await copyTree(input,output);else if(entry.isFile())await copyFile(input,output);
  }
}
await copyTree(source,join(profile,'IndexedDB'));
const html=join(directory,'reader.html'),main=join(directory,'reader.cjs');
await writeFile(html,'<!doctype html><meta charset="utf-8"><title>Library snapshot reader</title>');
await writeFile(main,`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(()=>{global.reader=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});reader.loadFile(${JSON.stringify(html)});});app.on('window-all-closed',()=>app.quit());`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:[main],env});
try{
  const page=await app.firstWindow();
  const songs=await page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('PianoCraft');
    request.onupgradeneeded=()=>{request.transaction.abort();reject(new Error('Biblioteca não encontrada na cópia.'));};
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,transaction=db.transaction('library','readonly'),read=transaction.objectStore('library').get('songs');
      read.onsuccess=()=>resolve(read.result||[]);read.onerror=()=>reject(read.error);transaction.oncomplete=()=>db.close();
    };
  }));
  await writeFile(join(directory,'songs.json'),JSON.stringify(songs));
  const chosen=songs.filter(song=>/indila|love\s*story/i.test(song.title||''));
  for(let i=0;i<chosen.length;i++)await writeFile(resolve('test-results',`user-song-${i}.json`),JSON.stringify(chosen[i]));
  console.log(JSON.stringify({sourceReadOnly:true,snapshot:directory,songs:songs.map(s=>({id:s.id,title:s.title,duration:s.duration,notes:s.notes.length})),selected:chosen.map((s,i)=>({title:s.title,file:resolve('test-results',`user-song-${i}.json`),duration:s.duration,notes:s.notes.length}))},null,2));
}finally{await app.close();}
