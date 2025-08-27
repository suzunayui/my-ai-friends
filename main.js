// main.js (ESM)
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

function createWindow() {
  const win = new BrowserWindow({
    width: 320,
    height: 800,
    minWidth: 280,
    minHeight: 560,
    resizable: true,          // 固定にしたいなら false
    backgroundColor: '#0b0f14',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,         // 切り分け後は true に戻してもOK
      // preload は用意していないので指定しない（無いとエラーの元）
    },
  });

  win.removeMenu();
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    // macOS: Dockクリックでウィンドウが無ければ再作成
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// すべてのウィンドウが閉じたら終了（macOS除く）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
