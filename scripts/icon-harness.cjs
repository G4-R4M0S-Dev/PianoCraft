const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 320, height: 360, show: false, webPreferences: { sandbox: true } });
  await window.loadURL('data:text/html;charset=utf-8,<title>PianoCraft icon renderer</title>');
});
app.on('window-all-closed', () => app.quit());
