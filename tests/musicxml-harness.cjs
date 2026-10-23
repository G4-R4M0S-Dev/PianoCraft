const { app, BrowserWindow } = require('electron');
const path = require('node:path');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  await window.loadFile(path.join(__dirname, 'musicxml-harness.html'));
});
app.on('window-all-closed', () => app.quit());
