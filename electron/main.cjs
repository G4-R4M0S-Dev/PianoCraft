const { app, BrowserWindow, ipcMain, dialog, session, Menu } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
let window;
let closingApproved=false,closeTimeout;
const root = path.join(__dirname, '..');
const entry = pathToFileURL(path.join(root, 'src/index.html')).href;
app.setPath('userData',process.env.PIANOCRAFT_TEST==='1'?path.join(app.getPath('temp'),`pianocraft-test-${process.pid}`):path.join(app.getPath('appData'),'PianoCraft Studio'));
const trusted = event => event.sender === window?.webContents && event.senderFrame?.url === entry;
const check = event => { if (!trusted(event)) throw new Error('Origem não autorizada'); };
async function externalFiles(argumentsList) {
  const files=[];let total=0;
  for(const name of argumentsList.filter(value=>typeof value==='string'&&/\.(mid|midi|musicxml|xml|mxl)$/i.test(value)).slice(0,32)){
    try{const file=path.resolve(name),stat=await fs.stat(file);if(!stat.isFile()||stat.size>32*1024*1024||total+stat.size>128*1024*1024)continue;total+=stat.size;files.push({name:path.basename(file),data:Array.from(await fs.readFile(file))});}catch{}
  }
  if(files.length)window.webContents.send('external-music',files);
}
if(process.env.PIANOCRAFT_TEST!=='1'&&!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',(_event,commandLine)=>{if(window){window.show();window.focus();externalFiles(commandLine);}});
ipcMain.handle('open-music', async event => {
  check(event);
  const result = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Músicas', extensions: ['mid', 'midi', 'xml', 'musicxml', 'mxl', 'json'] }] });
  if (result.canceled) return [];
  return Promise.all(result.filePaths.map(async file => {
    const stat = await fs.stat(file);
    if (stat.size > 32 * 1024 * 1024) throw new Error('Arquivo excede 32 MB.');
    return { name: path.basename(file), data: Array.from(await fs.readFile(file)) };
  }));
});
ipcMain.handle('open-folder', async event => {
  check(event);
  const result=await dialog.showOpenDialog(window,{properties:['openDirectory']});if(result.canceled)return null;
  const files=[],queue=[{directory:result.filePaths[0],depth:0}];let total=0,omitted=0;
  while(queue.length){const {directory,depth}=queue.shift();for(const entry of await fs.readdir(directory,{withFileTypes:true})){
    if(entry.isSymbolicLink())continue;
    const file=path.join(directory,entry.name);
    if(entry.isDirectory()&&depth<5){if(queue.length<512)queue.push({directory:file,depth:depth+1});else omitted++;}
    else if(entry.isFile()&&/\.(mid|midi|xml|musicxml|mxl)$/i.test(entry.name)){
      const stat=await fs.stat(file);if(stat.size>32*1024*1024||total+stat.size>128*1024*1024||files.length>=256){omitted++;continue;}
      total+=stat.size;files.push({name:entry.name,data:Array.from(await fs.readFile(file))});
    }
  }}return {name:path.basename(result.filePaths[0]),files,omitted};
});
ipcMain.handle('open-soundfont', async event => {
  check(event);
  const result = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'SoundFont', extensions: ['sf2', 'sf3'] }] });
  if (result.canceled) return null;
  const file=result.filePaths[0],stat=await fs.stat(file);
  if(stat.size>256*1024*1024)throw new Error('SoundFont excede 256 MB.');
  return {name:path.basename(file),data:await fs.readFile(file)};
});
ipcMain.handle('basic-soundfont', async event => {check(event);return {name:'PianoCraft Basic',data:await fs.readFile(path.join(root,'assets/soundfonts/PianoCraft-Basic.sf2'))};});
ipcMain.handle('save-file', async (event, { name, data, kind }) => {
  check(event);
  if (typeof name !== 'string' || !Array.isArray(data) || data.length > 32 * 1024 * 1024) throw new Error('Arquivo inválido.');
  const result = await dialog.showSaveDialog(window, { defaultPath: path.basename(name), filters: [{ name: kind === 'json' ? 'Projeto PianoCraft' : 'MIDI', extensions: [kind === 'json' ? 'json' : 'mid'] }] });
  if (result.canceled) return false;
  await fs.writeFile(result.filePath, Buffer.from(data));
  return true;
});
ipcMain.handle('fullscreen', event => { check(event); window.setFullScreen(!window.isFullScreen()); });
ipcMain.on('ready-close',event=>{if(!trusted(event))return;closingApproved=true;clearTimeout(closeTimeout);window.close();});
app.whenReady().then(() => {
  // Chromium may request the midiSysex permission category even when Web MIDI
  // is opened with sysex:false. Restrict both categories to our local window.
  const allowed = (webContents, permission) => webContents === window?.webContents && webContents.getURL() === entry && ['midi','midiSysex'].includes(permission);
  session.defaultSession.setPermissionCheckHandler(allowed);
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => callback(allowed(webContents, permission)));
  window = new BrowserWindow({ title: 'PianoCraft', icon:path.join(root,'assets/icon.png'), width: 1440, height: 960, minWidth: 1000, minHeight: 720, backgroundColor: '#101419', show: !process.argv.includes('--smoke'), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  window.on('close',event=>{if(closingApproved)return;event.preventDefault();window.webContents.send('prepare-close');if(!closeTimeout)closeTimeout=setTimeout(()=>{closingApproved=true;window.close();},10000);});
  Menu.setApplicationMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.loadURL(entry);
  window.webContents.once('did-finish-load',()=>externalFiles(process.argv.slice(app.isPackaged?1:2)));
  if (process.argv.includes('--dev')) window.webContents.openDevTools({ mode: 'detach' });
});
app.on('window-all-closed', () => app.quit());
