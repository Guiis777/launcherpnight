const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const LauncherUpdater = require('./src/launcher-updater');
const config = require('./src/config');
const fs = require('fs');

let mainWindow;
const ALLOWED_GAME_EXE = new Set(['PokeNight_DX.exe', 'PokeNight_GL.exe']);

function isValidGameExecutable(gamePath) {
  if (!gamePath || typeof gamePath !== 'string') return false;
  const exeName = path.basename(gamePath);
  if (!ALLOWED_GAME_EXE.has(exeName)) return false;
  if (!path.isAbsolute(gamePath)) return false;
  return fs.existsSync(gamePath);
}

// Configuração do atualizador do launcher
const launcherUpdater = new LauncherUpdater({
  baseUrl: config.LAUNCHER_BASE,
  localPath: path.join(__dirname, 'src')
});

async function checkLauncherUpdates() {
  try {
    console.log('[Main] Verificando atualizações do launcher...');
    const updated = await launcherUpdater.checkForUpdates();
    if (updated) {
      console.log('[Main] Launcher atualizado!');
      // Se main.js foi atualizado, reiniciar o app para carregar a nova versão
      if (launcherUpdater.rootUpdated) {
        console.log('[Main] main.js atualizado — reiniciando app...');
        app.relaunch();
        app.exit(0);
        return true;
      }
      return true;
    }
    console.log('[Main] Launcher já está atualizado');
    return false;
  } catch (error) {
    console.log('[Main] Erro ao verificar atualizações:', error.message);
    return false;
  }
}

function createWindow() {
  const { screen } = require('electron');
  const { width: scrW, height: scrH } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: scrW,
    height: scrH,
    minWidth: 900,
    minHeight: 500,
    frame: false, // Janela sem bordas para visual customizado
    resizable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: false,
      webSecurity: true
    },
    icon: path.join(__dirname, 'assets', 'tamer_quest_icon.ico'),
    backgroundColor: '#000000'
  });

  mainWindow.loadFile('src/index.html');

  // Impede navegação inesperada e abertura de novas janelas dentro do app.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = `file://${path.join(__dirname, 'src', 'index.html').replace(/\\/g, '/')}`;
    if (url !== allowed) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(parsed.toString());
      }
    } catch {
      // Ignora URL inválida
    }
    return { action: 'deny' };
  });

  // Abre DevTools em desenvolvimento (remova em produção)
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Verifica atualizações do launcher antes de criar a janela
  // NOTA: Descomente a linha abaixo quando hospedar em servidor próprio
  // await checkLauncherUpdates();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers para comunicação com o renderer

// Abrir links externos no navegador padrão
ipcMain.on('open-external', (event, url) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      shell.openExternal(parsed.toString());
    }
  } catch {
    // Ignora URL inválida
  }
});

// Controles da janela
ipcMain.on('minimize-window', () => {
  mainWindow.minimize();
});

ipcMain.on('maximize-window', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('close-window', () => {
  mainWindow.close();
});

// Selecionar pasta do jogo
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Selecione a pasta do jogo'
  });
  return result;
});

// Instalar VC Redist
ipcMain.on('install-vcredist', (event) => {
  const gamePath = path.join(__dirname, 'assets', 'cliente');
  const vcPath = path.join(gamePath, 'vc_redist.x86.exe');

  console.log('[VCRedist] Procurando em:', vcPath);
  if (!require('fs').existsSync(vcPath)) {
    event.reply('vcredist-result', { success: false, error: 'vc_redist.x86.exe não encontrado. Baixe o jogo primeiro.' });
    return;
  }
  console.log('[VCRedist] Instalando com elevação:', vcPath);
  try {
    // Usar shell execute com runas para pedir elevação de admin
    const { exec } = require('child_process');
    exec(`powershell -Command "Start-Process -FilePath '${vcPath.replace(/'/g, "''")}' -ArgumentList '/install','/passive','/norestart' -Verb RunAs"`, (err) => {
      if (err) {
        console.error('[VCRedist] Erro:', err.message);
        event.reply('vcredist-result', { success: false, error: 'Instalação cancelada ou erro: ' + err.message });
      } else {
        event.reply('vcredist-result', { success: true });
      }
    });
  } catch (error) {
    console.error('[VCRedist] Erro:', error);
    event.reply('vcredist-result', { success: false, error: error.message });
  }
});

// Iniciar o jogo
ipcMain.on('launch-game', (event, gamePath) => {
  console.log('[launch-game] Caminho:', gamePath);

  if (!isValidGameExecutable(gamePath)) {
    event.reply('game-launched', { success: false, error: 'Executavel invalido para iniciar o jogo.' });
    return;
  }
  
  try {
    const game = spawn(gamePath, ['87UGS56suGSHjkshsSVRsc4csmn'], { 
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
      cwd: path.dirname(gamePath)
    });
    game.unref();
    event.reply('game-launched', { success: true });
  } catch (error) {
    console.error('Erro ao iniciar jogo:', error);
    event.reply('game-launched', { success: false, error: error.message });
  }
});

// ==========================================
// Comments System — DESATIVADO (aguardando API HTTP)
// ==========================================
// TODO: Substituir por chamadas HTTP para API no servidor (sem SSH no launcher)

ipcMain.handle('comments-load', async () => {
  return {};
});

ipcMain.handle('comments-add', async () => {
  return { success: false, error: 'Comentários temporariamente desativados' };
});

ipcMain.handle('comments-like', async () => {
  return { success: false, error: 'Comentários temporariamente desativados' };
});
