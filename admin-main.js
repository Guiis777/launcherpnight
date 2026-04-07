const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync, execFile } = require('child_process');
const archiver = require('archiver');

// userData funciona tanto em dev quanto quando instalado (ex: AppData\Roaming\PokeNight Admin)
const SETTINGS_PATH = path.join(app.getPath('userData'), 'admin-settings.json');

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
// Normaliza extensões para minúsculo (ex: .PNG → .png) pois GitHub é case-sensitive
// e o git armazena os arquivos com extensão minúscula
function generateHashXml(sourceDir, files) {
  const lines = files.map(f => {
    const hash = md5(path.join(sourceDir, f.replace(/\//g, path.sep)));
    const normalizedName = f.replace(/(\.[^./]+)$/, ext => ext.toLowerCase());
    return `    <hashing name="${normalizedName}" hash="${hash}"/>`;
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
      const rootMain = path.join(repoDir, 'main.js');
      if (fs.existsSync(rootMain)) {
        fs.copyFileSync(rootMain, path.join(launcherDir, 'main.js'));
      }
      const uiFiles = ['auth.js','config.js','index.html','launcher-updater.js','news-config.json','news.js','renderer.js','styles.css','updater.js','main.js'];
      const entries = [];
      for (const f of uiFiles) {
        const fp = path.join(launcherDir, f);
        if (fs.existsSync(fp)) {
          entries.push({ name: f, md5: md5(fp).toLowerCase(), root: f === 'main.js' });
        }
      }
      const manifest = { version: new Date().toISOString(), files: entries };
      fs.writeFileSync(path.join(launcherDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
      send('✅ manifest.json do launcher gerado');
    }

    // 6. Git — push em lotes para não estourar o limite de 2GB do GitHub
    send('🚀 Fazendo git commit e push em lotes...');
    const msg = commitMsg || `update game files ${new Date().toISOString().slice(0,10)}`;
    const gitOpts = { cwd: repoDir, maxBuffer: 256 * 1024 * 1024 };

    // Alinha histórico local com remoto sem mexer nos arquivos
    send('🔄 Alinhando com o remoto...');
    try {
      execSync('git fetch origin main', gitOpts);
      execSync('git update-ref refs/heads/main refs/remotes/origin/main', gitOpts);
      execSync('git symbolic-ref HEAD refs/heads/main', gitOpts);
      execSync('git reset --mixed HEAD', gitOpts);
    } catch (_) {
      send('ℹ️ Branch remota ainda não existe — criando...');
    }

    // Pega todos os arquivos que o git vê como modificados/novos
    // core.quotePath=false evita que o git escape nomes com caracteres especiais (ex: acentos)
    const statusOut = execSync('git -c core.quotePath=false status --porcelain -u', { ...gitOpts, encoding: 'utf8' });
    const pendingFiles = statusOut.split('\n')
      .map(l => l.trim().replace(/^[A-Z?]{1,2}\s+/, ''))
      .filter(f => f.length > 0);

    send(`📦 ${pendingFiles.length} arquivo(s) para sincronizar`);

    if (pendingFiles.length === 0) {
      send('ℹ️ Nenhuma mudança para commitar');
    } else {
      const BATCH = 500;
      let batchNum = 0;
      const tmpListFile = path.join(repoDir, '.git', '_deploy_filelist.txt');
      for (let i = 0; i < pendingFiles.length; i += BATCH) {
        batchNum++;
        const chunk = pendingFiles.slice(i, i + BATCH);
        const total = Math.ceil(pendingFiles.length / BATCH);
        send(`📤 Lote ${batchNum}/${total} — ${chunk.length} arquivos...`);

        // Usa arquivo temporário para evitar limite de tamanho do comando no Windows
        fs.writeFileSync(tmpListFile, chunk.join('\n'), 'utf8');
        execSync(`git add --pathspec-from-file="${tmpListFile}"`, gitOpts);

        try {
          execSync(`git commit -m "${msg} (lote ${batchNum}/${total})"`, gitOpts);
        } catch (e) {
          if (e.message.includes('nothing to commit')) continue;
          throw e;
        }

        execSync('git push -u origin main', gitOpts);
        send(`✅ Lote ${batchNum}/${total} enviado`);
      }
      try { fs.unlinkSync(tmpListFile); } catch (_) {}
    }

    // Purgar cache do jsDelivr para garantir que o CDN serve o hash.xml novo imediatamente
    send('🧹 Purgando cache do CDN...');
    try {
      const purgePaths = ['server/u/hash.xml', 'server/u/launcher/manifest.json'];
      const purgeReqs = purgePaths.map(p =>
        new Promise(resolve => {
          const purgeUrl = `https://purge.jsdelivr.net/gh/Guiis777/launcherpnight@main/${p}`;
          const mod = require('https');
          mod.get(purgeUrl, res => { res.resume(); resolve(); }).on('error', resolve);
        })
      );
      await Promise.all(purgeReqs);
    } catch (_) {}

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
    const uiFiles = ['auth.js','config.js','index.html','launcher-updater.js','news-config.json','news.js','renderer.js','styles.css','updater.js'];
    for (const f of uiFiles) {
      const src = path.join(srcDir, f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(launcherDir, f));
        send(`   Copiado: ${f}`);
      }
    }

    const rootMain = path.join(repoDir, 'main.js');
    if (fs.existsSync(rootMain)) {
      fs.copyFileSync(rootMain, path.join(launcherDir, 'main.js'));
      send('   Copiado: main.js (raiz)');
    }

    // Gera manifest
    send('🔧 Gerando manifest...');
    const entries = [];
    for (const f of [...uiFiles, 'main.js']) {
      const fp = path.join(launcherDir, f);
      if (fs.existsSync(fp)) {
        entries.push({ name: f, md5: md5(fp).toLowerCase(), root: f === 'main.js' });
      }
    }
    const manifest = { version: new Date().toISOString(), files: entries };
    fs.writeFileSync(path.join(launcherDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    send('✅ manifest.json gerado');

    // Git
    send('🚀 Fazendo git commit e push...');
    const msg = commitMsg || `update launcher ${new Date().toISOString().slice(0,10)}`;
    const gitOpts = { cwd: repoDir, maxBuffer: 256 * 1024 * 1024 };

    send('🔄 Alinhando com o remoto...');
    try {
      execSync('git fetch origin main', gitOpts);
      execSync('git update-ref refs/heads/main refs/remotes/origin/main', gitOpts);
      execSync('git symbolic-ref HEAD refs/heads/main', gitOpts);
      execSync('git reset --mixed HEAD', gitOpts);
    } catch (fetchErr) {
      send('ℹ️ Branch remota ainda não existe — criando...');
    }

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
    execSync('git push -u origin main', gitOpts);

    // Purgar cache do jsDelivr
    try {
      const purgePaths = ['server/u/launcher/manifest.json'];
      const purgeReqs = purgePaths.map(p =>
        new Promise(resolve => {
          const purgeUrl = `https://purge.jsdelivr.net/gh/Guiis777/launcherpnight@main/${p}`;
          const mod = require('https');
          mod.get(purgeUrl, res => { res.resume(); resolve(); }).on('error', resolve);
        })
      );
      await Promise.all(purgeReqs);
    } catch (_) {}

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

// Upload client.zip para GitHub Releases (cria/atualiza release "game-client")
ipcMain.handle('upload-release', async (_, { zipPath, token }) => {
  const https = require('https');
  const owner = 'Guiis777';
  const repo  = 'launcherpnight';
  const tag   = 'game-client';

  function ghRequest(method, endpoint, body, extraHeaders) {
    return new Promise((resolve, reject) => {
      const isUpload = extraHeaders && extraHeaders['Content-Type'] === 'application/zip';
      const host = isUpload ? 'uploads.github.com' : 'api.github.com';
      const options = {
        hostname: host,
        path: isUpload ? endpoint : `/repos/${owner}/${repo}${endpoint}`,
        method,
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'PokeNight-Admin',
          ...extraHeaders
        }
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      });
      req.on('error', reject);
      if (body && !isUpload) req.write(typeof body === 'string' ? body : JSON.stringify(body));
      if (!isUpload) req.end();
    });
  }

  try {
    // 1. Verificar/criar release
    let releaseId, uploadUrl;
    const existing = await ghRequest('GET', `/releases/tags/${tag}`);
    if (existing.status === 200) {
      releaseId = existing.body.id;
      uploadUrl = existing.body.upload_url.replace('{?name,label}', '');
      // Deletar asset antigo se existir
      const assets = await ghRequest('GET', `/releases/${releaseId}/assets`);
      if (assets.status === 200) {
        for (const a of assets.body) {
          if (a.name === 'client.zip') {
            await ghRequest('DELETE', `/releases/assets/${a.id}`);
          }
        }
      }
    } else {
      const created = await ghRequest('POST', '/releases', {
        tag_name: tag, name: 'Game Client', body: 'PokeNight game client files.',
        draft: false, prerelease: false
      });
      if (created.status !== 201) return { success: false, error: `Erro ao criar release: ${JSON.stringify(created.body)}` };
      releaseId = created.body.id;
      uploadUrl = created.body.upload_url.replace('{?name,label}', '');
    }

    // 2. Upload do arquivo com progresso
    const fileSize = fs.statSync(zipPath).size;
    const fileStream = fs.createReadStream(zipPath);

    const url = await new Promise((resolve, reject) => {
      const uploadUrlParsed = new URL(uploadUrl + '?name=client.zip');
      let sent = 0;
      let lastEmit = 0;

      const options = {
        hostname: uploadUrlParsed.hostname,
        path: uploadUrlParsed.pathname + uploadUrlParsed.search,
        method: 'POST',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'PokeNight-Admin',
          'Content-Type': 'application/zip',
          'Content-Length': fileSize,
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          try {
            const body = JSON.parse(data);
            resolve(body.browser_download_url || null);
          } catch { reject(new Error('Resposta inválida do GitHub')); }
        });
      });
      req.on('error', reject);

      fileStream.on('data', (chunk) => {
        sent += chunk.length;
        const now = Date.now();
        if (now - lastEmit > 500) {
          lastEmit = now;
          win.webContents.send('upload-progress', {
            sent, total: fileSize, pct: Math.round((sent / fileSize) * 100)
          });
        }
      });

      fileStream.pipe(req);
    });

    if (!url) return { success: false, error: 'Upload sem URL de retorno' };

    // 3. Salvar URL no config.js automaticamente
    const configPath = path.join(__dirname, 'src', 'config.js');
    let content = fs.readFileSync(configPath, 'utf8');
    content = content.replace(/ZIP_URL:\s*['"][^'"]*['"]/, `ZIP_URL: '${url}'`);
    fs.writeFileSync(configPath, content, 'utf8');

    return { success: true, url };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
