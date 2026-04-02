const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync, exec } = require('child_process');

let win;

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

    // 3. Copiar arquivos
    send('📋 Copiando arquivos para o repositório...');
    let copied = 0;
    for (const file of files) {
      const src = path.join(sourceDir, file.replace(/\//g, path.sep));
      const dst = path.join(destDir, file.replace(/\//g, path.sep));
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      copied++;
      if (copied % 50 === 0) send(`   Copiados ${copied}/${files.length}...`);
    }
    send(`✅ ${copied} arquivos copiados`);

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

    execSync('git add .', { cwd: repoDir });
    try {
      execSync(`git commit -m "${msg}"`, { cwd: repoDir });
    } catch (e) {
      if (e.message.includes('nothing to commit')) {
        send('ℹ️ Nenhuma mudança para commitar');
        return { success: true, log };
      }
      throw e;
    }
    execSync('git push', { cwd: repoDir });
    send('✅ Push concluído! O launcher vai se atualizar automaticamente.');

    return { success: true, log };
  } catch (e) {
    send(`❌ Erro: ${e.message}`);
    return { success: false, error: e.message, log };
  }
});

// Só salva o manifest do launcher (sem copiar arquivos do jogo)
ipcMain.handle('deploy-launcher-only', async (_, { repoDir, commitMsg }) => {
  const log = [];
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
    execSync('git add .', { cwd: repoDir });
    try {
      execSync(`git commit -m "${msg}"`, { cwd: repoDir });
    } catch (e) {
      if (e.message.includes('nothing to commit')) {
        send('ℹ️ Nenhuma mudança para commitar');
        return { success: true, log };
      }
      throw e;
    }
    execSync('git push', { cwd: repoDir });
    send('✅ Push do launcher concluído!');

    return { success: true, log };
  } catch (e) {
    send(`❌ Erro: ${e.message}`);
    return { success: false, error: e.message, log };
  }
});
