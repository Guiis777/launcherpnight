const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync, execFile } = require('child_process');
const archiver = require('archiver');

const SETTINGS_PATH = path.join(__dirname, 'admin-settings.json');

ipcMain.handle('load-settings', () => {
  try {
    if (fs.existsSync(SETTINGS_PATH)) return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {}
  return {};
});

ipcMain.handle('save-settings', (_, data) => {
  try {
    let existing = {};
    if (fs.existsSync(SETTINGS_PATH)) {
      try { existing = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch {}
    }
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ ...existing, ...data }, null, 2), 'utf8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('build-exe', async (_, { repoDir }) => {
  try {
    win.webContents.send('build-log', '⚙️  Rodando electron-builder (pode levar alguns minutos)...');
    const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false', CSC_LINK: '', WIN_CSC_LINK: '', CSC_KEY_PASSWORD: '' };
    delete env.WIN_CSC_LINK;
    delete env.CSC_LINK;
    delete env.WIN_CSC_KEY_PASSWORD;
    delete env.CSC_KEY_PASSWORD;
    const out = execSync('npm run build 2>&1', { cwd: repoDir, maxBuffer: 256 * 1024 * 1024, env }).toString();
    win.webContents.send('build-log', out.slice(-800));
    win.webContents.send('build-log', '✅ Build concluído! Arquivo em dist/');
    return { success: true };
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : '') || e.message;
    return { success: false, error: msg.slice(-1000) };
  }
});

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 820,
    height: 640,
    title: 'PokeNight Admin',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  win.loadFile('admin.html');
  win.setMenuBarVisibility(false);
});

app.on('window-all-closed', () => app.quit());

// Selecionar pasta do jogo
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: 'Selecionar pasta do jogo'
  });
  return result.canceled ? null : result.filePaths[0];
});

// Lista arquivos recursivamente
function listFiles(dir, base = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(listFiles(full, base));
    } else {
      files.push(path.relative(base, full).replace(/\\/g, '/'));
    }
  }
  return files;
}

// Calcula MD5
function md5(filePath) {
  return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

// Gera hash.xml
function generateHashXml(sourceDir, files) {
  const lines = files.map(f => {
    const hash = md5(path.join(sourceDir, f.replace(/\//g, path.sep)));
    return `    <hashing name="${f}" hash="${hash}"/>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<hashings>\n${lines.join('\n')}\n</hashings>`;
}

// Preview: lista arquivos da pasta
ipcMain.handle('preview-files', async (_, sourceDir) => {
  try {
    const files = listFiles(sourceDir);
    return { success: true, files, count: files.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Deploy: copia arquivos, gera hash.xml, gera manifest do launcher, git push
ipcMain.handle('deploy', async (_, { sourceDir, repoDir, commitMsg }) => {
  const log = [];
  const send = (msg) => { log.push(msg); win.webContents.send('deploy-log', msg); };

  try {
    // 1. Listar arquivos do jogo
    send('📂 Listando arquivos...');
    const files = listFiles(sourceDir);
    send(`✅ ${files.length} arquivos encontrados`);

    // 2. Destino no repo
    const destDir = path.join(repoDir, 'server', 'u');
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    // 3. Copiar apenas arquivos que mudaram (comparar MD5)
    send('📋 Verificando o que mudou...');
    let copied = 0, skipped = 0;
    for (const file of files) {
      const src = path.join(sourceDir, file.replace(/\//g, path.sep));
      const dst = path.join(destDir, file.replace(/\//g, path.sep));
      fs.mkdirSync(path.dirname(dst), { recursive: true });

      let changed = true;
      if (fs.existsSync(dst)) {
        const srcHash = md5(src);
        const dstHash = md5(dst);
        if (srcHash === dstHash) { skipped++; changed = false; }
      }

      if (changed) {
        fs.copyFileSync(src, dst);
        copied++;
      }
    }
    send(`✅ ${copied} alterados copiados, ${skipped} sem mudança ignorados`);

    // 4. Gerar hash.xml
    send('🔧 Gerando hash.xml...');
    const xml = generateHashXml(sourceDir, files);
    fs.writeFileSync(path.join(destDir, 'hash.xml'), xml, 'utf8');
    send('✅ hash.xml gerado');

    // 5. Gerar manifest do launcher
    send('🔧 Gerando manifest do launcher...');
    const launcherDir = path.join(repoDir, 'server', 'u', 'launcher');
    if (fs.existsSync(launcherDir)) {
      const uiFiles = ['auth.js','config.js','index.html','launcher-updater.js','news-config.json','news.js','renderer.js','styles.css','updater.js','main.js'];
      const entries = [];
      for (const f of uiFiles) {
        const fp = path.join(launcherDir, f);
        if (fs.existsSync(fp)) {
          entries.push({ name: f, md5: md5(fp).toLowerCase() });
        }
      }
      const manifest = { version: new Date().toISOString(), files: entries };
      fs.writeFileSync(path.join(launcherDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
      send('✅ manifest.json do launcher gerado');
    }

    // 6. Git add + commit + push
    send('🚀 Fazendo git commit e push...');
    const msg = commitMsg || `update game files ${new Date().toISOString().slice(0,10)}`;
    const gitOpts = { cwd: repoDir, maxBuffer: 256 * 1024 * 1024 };

    execSync('git add .', gitOpts);
    try {
      execSync(`git commit -m "${msg}"`, gitOpts);
    } catch (e) {
      if (e.message.includes('nothing to commit')) {
        send('ℹ️ Nenhuma mudança para commitar');
        return { success: true, log };
      }
      throw e;
    }
    execSync('git push', gitOpts);
    send('✅ Push concluído! O launcher vai se atualizar automaticamente.');

    return { success: true, log };
  } catch (e) {
    send(`❌ Erro: ${e.message}`);
    return { success: false, error: e.message, log };
  }
});

// Gera client.zip da pasta do jogo
ipcMain.handle('generate-zip', async (_, { sourceDir, outputDir }) => {
  const zipPath = path.join(outputDir, 'client.zip');
  return new Promise((resolve) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    let lastSent = 0;

    archive.on('progress', (p) => {
      const now = Date.now();
      if (now - lastSent < 500) return;
      lastSent = now;
      win.webContents.send('zip-progress', {
        entries: p.entries.processed,
        bytes: p.fs.processedBytes
      });
    });

    output.on('close', () => resolve({ success: true, path: zipPath, size: archive.pointer() }));
    archive.on('error', (err) => resolve({ success: false, error: err.message }));

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
});

// Só salva o manifest do launcher (sem copiar arquivos do jogo)
ipcMain.handle('deploy-launcher-only', async (_, { repoDir, commitMsg }) => {  const log = [];
  const send = (msg) => { log.push(msg); win.webContents.send('deploy-log', msg); };

  try {
    // Copia src/ -> server/u/launcher/
    send('📋 Sincronizando arquivos do launcher...');
    const srcDir = path.join(repoDir, 'src');
    const launcherDir = path.join(repoDir, 'server', 'u', 'launcher');
    const uiFiles = ['auth.js','config.js','index.html','launcher-updater.js','news-config.json','news.js','renderer.js','styles.css','updater.js','main.js'];
    for (const f of uiFiles) {
      const src = path.join(srcDir, f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(launcherDir, f));
        send(`   Copiado: ${f}`);
      }
    }

    // Gera manifest
    send('🔧 Gerando manifest...');
    const entries = [];
    for (const f of uiFiles) {
      const fp = path.join(launcherDir, f);
      if (fs.existsSync(fp)) {
        entries.push({ name: f, md5: md5(fp).toLowerCase() });
      }
    }
    const manifest = { version: new Date().toISOString(), files: entries };
    fs.writeFileSync(path.join(launcherDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    send('✅ manifest.json gerado');

    // Git
    send('🚀 Fazendo git commit e push...');
    const msg = commitMsg || `update launcher ${new Date().toISOString().slice(0,10)}`;
    const gitOpts = { cwd: repoDir, maxBuffer: 256 * 1024 * 1024 };
    execSync('git add .', gitOpts);
    try {
      execSync(`git commit -m "${msg}"`, gitOpts);
    } catch (e) {
      if (e.message.includes('nothing to commit')) {
        send('ℹ️ Nenhuma mudança para commitar');
        return { success: true, log };
      }
      throw e;
    }
    execSync('git push', gitOpts);
    send('✅ Push do launcher concluído!');

    return { success: true, log };
  } catch (e) {
    send(`❌ Erro: ${e.message}`);
    return { success: false, error: e.message, log };
  }
});

ipcMain.handle('set-zip-url', (_, { url }) => {
  try {
    const configPath = path.join(__dirname, 'src', 'config.js');
    let content = fs.readFileSync(configPath, 'utf8');
    content = content.replace(/ZIP_URL:\s*['"][^'"]*['"]/, `ZIP_URL: '${url}'`);
    fs.writeFileSync(configPath, content, 'utf8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
