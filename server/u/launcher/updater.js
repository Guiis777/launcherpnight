const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { execFile } = require('child_process');
const https = require('https');
const http = require('http');

// Agentes com keep-alive reutilizam conexões TCP — evita handshake por arquivo
const _httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64, timeout: 60000 });
const _httpAgent  = new http.Agent({  keepAlive: true, maxSockets: 64, timeout: 60000 });

class Updater extends EventEmitter {
  constructor(options = {}) {
    super();
    this.baseUrl = options.baseUrl || 'https://tamerquest.com/u/';
    // URL alternativa para binários bloqueados pelo CDN principal (.exe, .dll)
    this.baseUrlRaw = options.baseUrlRaw || this.baseUrl;
    // URL para buscar hash.xml e updater-config.json — usa raw para evitar cache CDN
    this.hashBaseUrl = options.hashBaseUrl || this.baseUrl;
    this.configUrl = options.configUrl || (this.hashBaseUrl + 'updater-config.json');
    this.hashFile = options.hashFile || 'hash.xml';
    // __dirname resolve corretamente em dev e em produção com asar:false
    const appPath = path.join(__dirname, '..');
    this.gamePath = options.gamePath || path.join(appPath, 'assets', 'cliente');
    this.filesToUpdate = [];
    this.totalSize = 0;
    this.downloadedSize = 0;
    this.concurrentDownloads = options.concurrentDownloads || 16;
    this.concurrentDownloadsFirstRun = options.concurrentDownloadsFirstRun || 24;
    
    // Arquivo local para guardar info da última atualização
    this.updateInfoFile = path.join(this.gamePath, '.launcher-update-info.json');
    this.versionFile = path.join(this.gamePath, '.updater-version');
    
    // Config remoto (será buscado do servidor)
    this.remoteConfig = null;
    this.zipFile = options.zipFile || 'client.zip';
    // URL direta para o zip (ex: Google Drive) — se definida, usa em vez de baseUrl+zipFile
    this.zipUrl = options.zipUrl || null;
    // Caminho para o cliente bundled no installer (copiar para gamePath no primeiro uso)
    this.bundledClientPath = options.bundledClientPath || null;
  }

  // Busca updater-config.json do servidor
  async fetchRemoteConfig() {
    try {
      const url = this.configUrl + '?t=' + Date.now();
      const response = await axios.get(url, {
        responseType: 'json',
        timeout: 10000,
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
      });
      this.remoteConfig = response.data;
      console.log('[Updater] Config remoto:', JSON.stringify(this.remoteConfig));
      return this.remoteConfig;
    } catch (error) {
      console.log('[Updater] Não conseguiu buscar config remoto:', error.message);
      // Fallback: config padrão se o servidor não responder
      this.remoteConfig = {
        version: 0,
        forceCleanInstall: false,
        maintenance: false,
        maintenanceMessage: '',
        concurrentDownloads: 3,
        concurrentDownloadsFirstRun: 6,
        message: ''
      };
      return this.remoteConfig;
    }
  }

  // Verifica se precisa limpar o client e re-baixar tudo
  // Agora controlado pelo config remoto (version + forceCleanInstall)
  needsCleanInstall() {
    const remoteVersion = (this.remoteConfig && this.remoteConfig.version) || 0;
    let localVer = 0;
    
    try {
      if (fs.existsSync(this.versionFile)) {
        localVer = parseInt(fs.readFileSync(this.versionFile, 'utf8').trim());
      }
    } catch (e) {}

    // Se a versão local já é igual ou maior que a remota, não precisa limpar
    if (localVer >= remoteVersion) {
      return false;
    }

    // Versão mudou - verificar se precisa clean install
    const exeDx = path.join(this.gamePath, 'PokeNight_DX.exe');
    const exeGl = path.join(this.gamePath, 'PokeNight_GL.exe');
    const hasExistingInstall = fs.existsSync(exeDx) || fs.existsSync(exeGl);

    // Se forceCleanInstall está ativo E já tem instalação, limpar
    if (this.remoteConfig && this.remoteConfig.forceCleanInstall && hasExistingInstall) {
      console.log('[Updater] forceCleanInstall=true + versão nova, limpando...');
      return true;
    }

    // Se não tem forceCleanInstall mas versão mudou e já tinha arquivos
    // Não limpar - deixar o update incremental resolver
    return false;
  }

  // Limpa todos os arquivos do client para re-download
  cleanClientFiles() {
    console.log('[Updater] Limpando client antigo para re-download...');
    try {
      const entries = fs.readdirSync(this.gamePath);
      for (const entry of entries) {
        // Preservar arquivos de controle do launcher
        if (entry.startsWith('.launcher') || entry.startsWith('.updater')) continue;
        const full = path.join(this.gamePath, entry);
        fs.rmSync(full, { recursive: true, force: true });
      }
      console.log('[Updater] Client limpo!');
    } catch (e) {
      console.error('[Updater] Erro ao limpar client:', e);
    }
  }

  // Salva a versão do config remoto como versão local
  saveUpdaterVersion() {
    try {
      const ver = (this.remoteConfig && this.remoteConfig.version) || 0;
      fs.writeFileSync(this.versionFile, String(ver));
    } catch (e) {}
  }

  // Copia o cliente bundled do installer para o gamePath
  // Usa robocopy (rápido no Windows), com fallback para cópia Node
  async copyBundledClient(srcPath) {
    this.emit('status', 'Copiando cliente do jogo...');
    if (!fs.existsSync(this.gamePath)) {
      fs.mkdirSync(this.gamePath, { recursive: true });
    }

    let progressTimer = null;
    let dotCount = 0;
    progressTimer = setInterval(() => {
      dotCount = (dotCount + 1) % 4;
      const dots = '.'.repeat(dotCount + 1);
      this.emit('status', `Copiando cliente${dots}`);
      this.emit('file-download-progress', { percent: -1, downloadedFiles: 0, totalFiles: 0 });
    }, 800);

    try {
      await new Promise((resolve, reject) => {
        execFile('robocopy', [
          srcPath, this.gamePath,
          '/E',    // inclui subpastas e pastas vazias
          '/NFL',  // sem log de arquivo
          '/NDL',  // sem log de pasta
          '/NJH',  // sem cabeçalho
          '/NJS',  // sem sumário
          '/NC',   // sem classes
          '/NS',   // sem tamanhos
          '/NP'    // sem percentual
        ], { timeout: 600000 }, (err) => {
          const code = err ? err.code : 0;
          // robocopy: código < 8 = sucesso (0=nada, 1=copiado, 2=extra, 3=ambos)
          if (code < 8) resolve();
          else reject(new Error(`robocopy falhou com código ${code}`));
        });
      });
    } catch (robocopyErr) {
      console.warn('[Updater] robocopy falhou, usando cópia Node:', robocopyErr.message);
      await this._nodeCopyDir(srcPath, this.gamePath);
    } finally {
      clearInterval(progressTimer);
    }

    this.emit('status', 'Cliente copiado!');
  }

  // Cópia recursiva assíncrona (fallback do robocopy)
  async _nodeCopyDir(src, dest) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcFull = path.join(src, entry.name);
      const destFull = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await this._nodeCopyDir(srcFull, destFull);
      } else {
        await fs.promises.copyFile(srcFull, destFull);
      }
    }
  }

  // Detecta se é primeira instalação (nenhum exe do client existe)
  isFirstRun() {
    const exeDx = path.join(this.gamePath, 'PokeNight_DX.exe');
    const exeGl = path.join(this.gamePath, 'PokeNight_GL.exe');
    return !fs.existsSync(exeDx) && !fs.existsSync(exeGl);
  }

  // Carrega informações da última atualização
  loadUpdateInfo() {
    try {
      if (fs.existsSync(this.updateInfoFile)) {
        return JSON.parse(fs.readFileSync(this.updateInfoFile, 'utf8'));
      }
    } catch (e) {
      // Ignora erro, retorna padrão
    }
    return { lastModified: null, etag: null, lastCheck: null };
  }

  // Salva informações da atualização
  saveUpdateInfo(info) {
    try {
      const dir = path.dirname(this.updateInfoFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.updateInfoFile, JSON.stringify(info, null, 2));
    } catch (e) {
      console.error('Erro ao salvar info de atualização:', e);
    }
  }

  // Verifica se o hash.xml mudou no servidor (usando Last-Modified / ETag)
  async hasRemoteChanged() {
    try {
      const url = this.baseUrl + this.hashFile + '?t=' + Date.now();
      const savedInfo = this.loadUpdateInfo();

      const response = await axios.head(url, { timeout: 15000, headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });
      
      const remoteLastModified = response.headers['last-modified'] || null;
      const remoteEtag = response.headers['etag'] || null;
      const remoteContentLength = response.headers['content-length'] || null;

      // Se temos info salva, comparar
      if (savedInfo.lastModified || savedInfo.etag) {
        const sameLastModified = remoteLastModified && savedInfo.lastModified && 
                                  remoteLastModified === savedInfo.lastModified;
        const sameEtag = remoteEtag && savedInfo.etag && 
                          remoteEtag === savedInfo.etag;
        
        if (sameLastModified || sameEtag) {
          return { changed: false, headers: { lastModified: remoteLastModified, etag: remoteEtag, contentLength: remoteContentLength } };
        }
      }

      return { changed: true, headers: { lastModified: remoteLastModified, etag: remoteEtag, contentLength: remoteContentLength } };
    } catch (error) {
      // Em caso de erro, assume que mudou para forçar verificação
      return { changed: true, headers: {} };
    }
  }

  // Baixa o hash.xml do servidor
  async fetchHashList() {
    try {
      const url = this.hashBaseUrl + this.hashFile + '?t=' + Date.now();
      this.emit('status', 'Verificando atualizações...');
      
      const response = await axios.get(url, { 
        responseType: 'text',
        timeout: 60000,
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
      });
      
      return { files: this.parseHashXml(response.data), xmlContent: response.data };
    } catch (error) {
      this.emit('error', `Erro ao baixar lista de arquivos: ${error.message}`);
      throw error;
    }
  }

  // Parse do hash.xml
  // Formato: <hashing name="caminho/arquivo.ext" hash="MD5HASH"/>
  parseHashXml(xmlContent) {
    const files = [];
    
    const hashingRegex = /<hashing\s+name="([^"]+)"\s+hash="([^"]+)"\s*\/>/gi;
    let match;
    
    while ((match = hashingRegex.exec(xmlContent)) !== null) {
      files.push({
        name: match[1],
        md5: match[2].toLowerCase(),
        size: 0
      });
    }

    return files;
  }

  // Calcula MD5 de um arquivo local
  calculateMD5(filePath) {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(filePath)) {
        resolve(null);
        return;
      }

      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', data => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
      stream.on('error', (err) => {
        // Se não conseguir ler, considerar como não existente
        resolve(null);
      });
    });
  }

  // Limpa arquivos .tmp abandonados de downloads interrompidos
  cleanTmpFiles() {
    try {
      const findTmp = (dir) => {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            findTmp(full);
          } else if (entry.name.endsWith('.tmp')) {
            try { fs.unlinkSync(full); } catch (e) {}
          }
        }
      };
      findTmp(this.gamePath);
    } catch (e) {}
  }

  // Verifica quais arquivos precisam ser atualizados
  async checkFiles(serverFiles) {
    this.filesToUpdate = [];
    this.totalSize = 0;
    
    // Limpar .tmp abandonados de sessões anteriores
    this.cleanTmpFiles();
    
    this.emit('status', 'Verificando arquivos locais...');
    
    let checked = 0;
    const total = serverFiles.length;
    const batchSize = 50; // Verificar em lotes para melhor performance

    for (let i = 0; i < serverFiles.length; i += batchSize) {
      const batch = serverFiles.slice(i, i + batchSize);
      
      const results = await Promise.all(
        batch.map(async (file) => {
          const localPath = path.join(this.gamePath, file.name);
          
          // Verificação rápida: se o arquivo não existe, precisa baixar
          if (!fs.existsSync(localPath)) {
            return { file, needsUpdate: true };
          }
          
          const localMd5 = await this.calculateMD5(localPath);
          return { file, needsUpdate: localMd5 !== file.md5 };
        })
      );

      for (const result of results) {
        checked++;
        if (result.needsUpdate) {
          this.filesToUpdate.push(result.file);
        }
      }

      // Emitir progresso a cada lote
      this.emit('check-progress', { 
        checked: Math.min(checked, total), 
        total, 
        file: batch[batch.length - 1].name,
        needsUpdate: this.filesToUpdate.length
      });
    }

    return this.filesToUpdate;
  }

  // Baixa um arquivo com retry (streaming para arquivos grandes)
  // Faz GET nativo (https/http) retornando stream - funciona em Electron diferente de axios
  _nativeGet(url) {
    return new Promise((resolve, reject) => {
      const mod = url.startsWith('https') ? https : http;
      const agent = url.startsWith('https') ? _httpsAgent : _httpAgent;
      const req = mod.get(url, { agent, headers: {} }, (res) => {
        // Seguir redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return this._nativeGet(res.headers.location).then(resolve).catch(reject);
        }
        resolve(res);
      });
      req.on('error', reject);
      req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout na conexão')); });
    });
  }

  _fallbackBaseUrl() {
    if (this.baseUrl.includes('/u/')) {
      return this.baseUrl.replace('/u/', '/otclient/');
    }
    return null;
  }

  async _getDownloadResponse(fileName) {
    // Encode cada segmento do path separadamente para preservar '/' e tratar espaços/caracteres especiais
    const encodedName = fileName.split('/').map(seg => encodeURIComponent(seg)).join('/');
    const isBinary = /\.(exe|dll|so|dylib|bin)$/i.test(fileName);
    const base = isBinary ? this.baseUrlRaw : this.baseUrl;
    const primaryUrl = base + encodedName;
    let res = await this._nativeGet(primaryUrl);
    let usedUrl = primaryUrl;

    if (res.statusCode === 404) {
      const fallbackBase = this._fallbackBaseUrl();
      if (fallbackBase) {
        const fallbackUrl = fallbackBase + encodedName;
        const fallbackRes = await this._nativeGet(fallbackUrl);
        if (fallbackRes.statusCode < 400) {
          console.warn(`[Updater] Fallback /otclient aplicado para ${fileName}`);
          res = fallbackRes;
          usedUrl = fallbackUrl;
        }
      }
    }

    return { res, usedUrl };
  }

  async downloadFile(file, retries = 3) {
    const localPath = path.join(this.gamePath, file.name);
    const tmpPath = localPath + '.tmp';
    
    // Cria o diretório se não existir
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const { res, usedUrl } = await this._getDownloadResponse(file.name);

        // Tratar erros HTTP
        if (res.statusCode === 404) {
          const msg = `Arquivo não encontrado no servidor (404): ${file.name}`;
          this.emit('download-error', { file: file.name, message: msg, status: 404 });
          console.error(`[Updater] ${msg} — URL: ${usedUrl}`);
          return { success: false, file: file.name, error: msg };
        }
        if (res.statusCode >= 400) {
          throw Object.assign(new Error(`HTTP ${res.statusCode}`), { httpStatus: res.statusCode });
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let receivedBytes = 0;
        let lastProgressEmit = 0;

        await new Promise((resolve, reject) => {
          const writer = fs.createWriteStream(tmpPath, { highWaterMark: 1024 * 1024 }); // 1MB buffer
          let finished = false;
          
          // Timeout de inatividade: se não receber dados por 30s, aborta
          let inactivityTimer = setTimeout(() => {
            if (!finished) {
              finished = true;
              res.destroy();
              writer.destroy();
              reject(new Error('Timeout: sem dados por 30 segundos'));
            }
          }, 30000);

          res.on('data', (chunk) => {
            receivedBytes += chunk.length;
            
            // Resetar timer de inatividade
            clearTimeout(inactivityTimer);
            inactivityTimer = setTimeout(() => {
              if (!finished) {
                finished = true;
                res.destroy();
                writer.destroy();
                reject(new Error('Timeout: sem dados por 30 segundos'));
              }
            }, 30000);

            // Throttle: emitir progresso no máximo a cada 200ms
            const now = Date.now();
            if (now - lastProgressEmit < 200) return;
            lastProgressEmit = now;

            const pct = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : -1;
            this.emit('file-download-progress', {
              file: file.name,
              received: receivedBytes,
              total: totalBytes,
              percent: pct,
              downloadedFiles: this.downloadedFiles,
              totalFiles: this.totalFiles
            });
          });

          res.pipe(writer);
          writer.on('finish', () => {
            if (!finished) { finished = true; clearTimeout(inactivityTimer); resolve(); }
          });
          writer.on('error', (err) => {
            if (!finished) { finished = true; clearTimeout(inactivityTimer); reject(err); }
          });
          res.on('error', (err) => {
            if (!finished) { finished = true; clearTimeout(inactivityTimer); reject(err); }
          });
        });

        // Verificar MD5 pós-download via streaming (sem carregar tudo na memória)
        const downloadedMd5 = await new Promise((resolve, reject) => {
          const hash = crypto.createHash('md5');
          const stream = fs.createReadStream(tmpPath);
          stream.on('data', data => hash.update(data));
          stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
          stream.on('error', reject);
        });

        if (file.md5 && downloadedMd5 !== file.md5.toLowerCase()) {
          console.warn(`[Updater] MD5 mismatch após download: ${file.name} (esperado: ${file.md5}, recebido: ${downloadedMd5})`);
          try { fs.unlinkSync(tmpPath); } catch (e) {}
          if (attempt < retries) {
            await new Promise(r => setTimeout(r, 1000 * attempt));
            continue;
          }
          this.emit('download-error', { file: file.name, message: `MD5 mismatch: ${file.name}`, status: 0 });
          return { success: false, file: file.name, error: `MD5 mismatch` };
        }

        // Mover .tmp para o arquivo final (resiliente no Windows para read-only/lock).
        if (fs.existsSync(localPath)) {
          try { fs.chmodSync(localPath, 0o666); } catch (e) {}
          try { fs.unlinkSync(localPath); } catch (e) {}
        }

        try {
          fs.renameSync(tmpPath, localPath);
        } catch (renameErr) {
          // Fallback: alguns ambientes bloqueiam rename entre handles abertos.
          fs.copyFileSync(tmpPath, localPath);
          try { fs.unlinkSync(tmpPath); } catch (e) {}
          console.warn(`[Updater] rename falhou para ${file.name}, aplicado fallback copy (${renameErr.message})`);
        }
        
        const fileSize = fs.statSync(localPath).size;
        this.downloadedSize += fileSize;
        
        this.emit('download-progress', {
          file: file.name,
          fileSize: fileSize,
          totalProgress: this.totalFiles > 0 ? (this.downloadedFiles / this.totalFiles) * 100 : 0,
          downloadedFiles: this.downloadedFiles,
          totalFiles: this.totalFiles
        });

        return { success: true, file: file.name };
      } catch (error) {
        // Limpar arquivo temporário em caso de erro
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) {}

        if (error.httpStatus === 404) {
          const msg = `Arquivo não encontrado no servidor: ${file.name}`;
          this.emit('download-error', { file: file.name, message: msg, status: 404 });
          console.error(`[Updater] ${msg}`);
          return { success: false, file: file.name, error: msg };
        }
        if (attempt === retries) {
          const msg = `Erro ao baixar ${file.name}: ${error.message}`;
          this.emit('download-error', { file: file.name, message: msg, status: error.httpStatus });
          console.error(`[Updater] ${msg}`);
          return { success: false, file: file.name, error: msg };
        }
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }

  // Download em paralelo com alta concorrência
  // startOffset: número de arquivos já concluídos antes desta chamada (para retry)
  // totalOverride: total real de arquivos (para manter contador contínuo no retry)
  async downloadFilesParallel(files, startOffset = 0, totalOverride = 0) {
    this.downloadedFiles = startOffset;
    this.totalFiles = totalOverride || files.length;
    this.downloadedSize = 0;
    this.failedFiles = [];
    
    // Limite alto mas que não mata o servidor
    const maxConcurrent = Math.min(this.concurrentDownloads, files.length);
    const queue = [...files];
    let completedCount = startOffset;
    const workers = [];

    for (let i = 0; i < maxConcurrent; i++) {
      workers.push((async () => {
        while (queue.length > 0) {
          const file = queue.shift();
          if (!file) break;
          
          const result = await this.downloadFile(file);
          completedCount++;
          this.downloadedFiles = completedCount;
          
          if (result && !result.success) {
            this.failedFiles.push(result);
          }
        }
      })());
    }

    await Promise.all(workers);
    return this.failedFiles;
  }

  // Verifica se o client.zip existe no servidor
  async hasRemoteZip() {
    try {
      // Se zipUrl direto está configurado (Google Drive, etc.), sempre considera disponível
      if (this.zipUrl) return { exists: true, size: 0 };
      const url = this.baseUrl + this.zipFile + '?t=' + Date.now();
      const response = await axios.head(url, { timeout: 10000 });
      const size = parseInt(response.headers['content-length'] || '0', 10);
      return { exists: true, size };
    } catch (e) {
      return { exists: false, size: 0 };
    }
  }

  // Baixa client.zip e extrai localmente (para primeira instalação)
  async downloadAndExtractZip() {
    const url = this.zipUrl || (this.baseUrl + this.zipFile + '?t=' + Date.now());
    const zipPath = path.join(this.gamePath, '_client-download.zip');

    this.emit('status', 'Baixando cliente do jogo...');

    // Usa módulos https/http declarados no topo com keep-alive agent
    const client = url.startsWith('https') ? https : http;
    const agent  = url.startsWith('https') ? _httpsAgent : _httpAgent;

    await new Promise((resolve, reject) => {
      const request = client.get(url, { agent }, (response) => {
        // Seguir redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          const redirectClient = response.headers.location.startsWith('https') ? https : http;
          const redirectAgent  = response.headers.location.startsWith('https') ? _httpsAgent : _httpAgent;
          redirectClient.get(response.headers.location, { agent: redirectAgent }, (res) => handleResponse(res));
          return;
        }
        handleResponse(response);
      });

      request.on('error', reject);

      const handleResponse = (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode} ao baixar zip`));
          return;
        }

        const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
        let receivedBytes = 0;
        let lastEmit = 0;
        const writer = fs.createWriteStream(zipPath);
        let finished = false;

        // Timeout de inatividade de 60s
        let inactivityTimer = setTimeout(() => {
          if (!finished) { finished = true; response.destroy(); writer.destroy(); reject(new Error('Timeout: sem dados por 60 segundos')); }
        }, 60000);

        response.on('data', (chunk) => {
          receivedBytes += chunk.length;

          clearTimeout(inactivityTimer);
          inactivityTimer = setTimeout(() => {
            if (!finished) { finished = true; response.destroy(); writer.destroy(); reject(new Error('Timeout: sem dados por 60 segundos')); }
          }, 60000);

          const now = Date.now();
          if (now - lastEmit < 300) return;
          lastEmit = now;

          if (totalBytes > 0) {
            const pct = Math.round((receivedBytes / totalBytes) * 100);
            this.emit('file-download-progress', {
              file: 'client.zip',
              received: receivedBytes,
              total: totalBytes,
              percent: pct,
              downloadedFiles: 1,
              totalFiles: 1
            });
          }
        });

        response.pipe(writer);
        writer.on('finish', () => { if (!finished) { finished = true; clearTimeout(inactivityTimer); resolve(); } });
        writer.on('error', (err) => { if (!finished) { finished = true; clearTimeout(inactivityTimer); reject(err); } });
        response.on('error', (err) => { if (!finished) { finished = true; clearTimeout(inactivityTimer); reject(err); } });
      };
    });

    this.emit('status', 'Download concluído! Extraindo arquivos...');

    // Contar arquivos para feedback de progresso
    const countFiles = (dir) => {
      let count = 0;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.name === '_client-download.zip') continue;
          if (e.name.startsWith('.')) continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) count += countFiles(full);
          else count++;
        }
      } catch (e) {}
      return count;
    };

    // Monitor de progresso durante extração (a cada 2s conta os arquivos)
    let extractionDone = false;
    const startTime = Date.now();
    const progressInterval = setInterval(() => {
      if (extractionDone) return;
      const fileCount = countFiles(this.gamePath);
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      this.emit('status', `Extraindo arquivos... ${fileCount} extraídos (${elapsed}s)`);
      this.emit('file-download-progress', {
        file: 'Extraindo client.zip',
        received: fileCount,
        total: 0,
        percent: -1,
        downloadedFiles: 1,
        totalFiles: 1
      });
    }, 2000);

    // Extrair usando tar nativo do Windows (mais rápido que PowerShell)
    // tar.exe está disponível no Windows 10+ e suporta .zip
    try {
      await new Promise((resolve, reject) => {
        execFile('tar', [
          '-xf', zipPath,
          '-C', this.gamePath
        ], { timeout: 600000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            console.error('[Updater] tar falhou, tentando PowerShell:', stderr || err.message);
            // Fallback: PowerShell Expand-Archive
            execFile('powershell.exe', [
              '-NoProfile', '-Command',
              `Expand-Archive -Path "${zipPath}" -DestinationPath "${this.gamePath}" -Force`
            ], { timeout: 600000 }, (err2, stdout2, stderr2) => {
              if (err2) {
                console.error('[Updater] PowerShell também falhou:', stderr2 || err2.message);
                reject(new Error('Falha ao extrair: ' + (stderr2 || err2.message)));
              } else {
                resolve();
              }
            });
          } else {
            resolve();
          }
        });
      });
    } finally {
      extractionDone = true;
      clearInterval(progressInterval);
    }

    // Limpar o zip
    try { fs.unlinkSync(zipPath); } catch (e) {}

    const finalCount = countFiles(this.gamePath);
    this.emit('status', `Extração concluída! ${finalCount} arquivos extraídos`);
    return true;
  }

  // Executa a atualização completa
  async update(forceCheck = false) {
    try {
      // Criar pasta do jogo se não existir
      if (!fs.existsSync(this.gamePath)) {
        fs.mkdirSync(this.gamePath, { recursive: true });
      }

      // 0. Buscar config remoto do servidor
      this.emit('status', 'Verificando configuração...');
      await this.fetchRemoteConfig();

      // Verificar manutenção
      if (this.remoteConfig.maintenance) {
        const msg = this.remoteConfig.maintenanceMessage || 'Servidor em manutenção. Tente novamente mais tarde.';
        this.emit('maintenance', msg);
        this.emit('error', msg);
        return false;
      }

      // Mostrar mensagem do servidor se houver
      if (this.remoteConfig.message) {
        this.emit('server-message', this.remoteConfig.message);
      }

      // Aplicar concorrência do config remoto
      if (this.remoteConfig.concurrentDownloads) {
        this.concurrentDownloads = this.remoteConfig.concurrentDownloads;
      }
      if (this.remoteConfig.concurrentDownloadsFirstRun) {
        this.concurrentDownloadsFirstRun = this.remoteConfig.concurrentDownloadsFirstRun;
      }

      // Migração: se versão mudou ou forceCleanInstall, limpar client
      const didCleanInstall = this.needsCleanInstall();
      if (didCleanInstall) {
        this.emit('status', 'Atualizando client - limpando arquivos antigos...');
        this.cleanClientFiles();
        // Remover cache de verificação para forçar download completo
        try { if (fs.existsSync(this.updateInfoFile)) fs.unlinkSync(this.updateInfoFile); } catch (e) {}
        // Salvar versão AGORA só no caso de clean install
        // Para evitar que feche e limpe tudo de novo ao reabrir
        this.saveUpdaterVersion();
      }

      // Se a versão remota mudou (mesmo sem forceCleanInstall), invalidar cache de headers
      // para garantir verificação completa de todos os arquivos
      {
        const remoteVer = (this.remoteConfig && this.remoteConfig.version) || 0;
        let localVer = 0;
        try {
          if (fs.existsSync(this.versionFile)) {
            localVer = parseInt(fs.readFileSync(this.versionFile, 'utf8').trim());
          }
        } catch (e) {}
        if (remoteVer > localVer) {
          console.log(`[Updater] Versão mudou (${localVer} → ${remoteVer}), invalidando cache para forçar verificação completa`);
          try { if (fs.existsSync(this.updateInfoFile)) fs.unlinkSync(this.updateInfoFile); } catch (e) {}
          forceCheck = true;
        }
      }

      const firstRun = this.isFirstRun();

      // Na primeira instalação, sempre força verificação completa
      if (firstRun) {
        forceCheck = true;
        this.emit('first-run', true);
      }

      // PRIMEIRA INSTALAÇÃO: se há cliente bundled no installer, copiar para gamePath
      // Depois cai no check incremental para garantir que está na versão mais recente
      if (firstRun) {
        const hasBundled = this.bundledClientPath && fs.existsSync(this.bundledClientPath);
        if (hasBundled) {
          this.emit('status', 'Instalando cliente do jogo...');
          await this.copyBundledClient(this.bundledClientPath);
          // Apagar arquivos de controle copiados da máquina de build — serão recriados frescos
          try { if (fs.existsSync(this.updateInfoFile)) fs.unlinkSync(this.updateInfoFile); } catch (e) {}
          try { if (fs.existsSync(this.versionFile)) fs.unlinkSync(this.versionFile); } catch (e) {}
          // Continua abaixo para check incremental (atualiza diffs desde o installer)
        } else {
          // Sem bundled — tenta baixar zip completo
          const zipInfo = await this.hasRemoteZip();
          if (zipInfo.exists) {
            this.emit('status', 'Baixando cliente completo via zip...');
            await this.downloadAndExtractZip();
            this.saveUpdaterVersion();
            this.emit('status', 'Instalação concluída!');
            this.emit('complete', { updated: 1 });
            return true;
          }
        }
      }

      // 1. Baixar hash.xml e verificar se mudou pelo conteúdo (mais confiável que ETag/Last-Modified)
      const { files: serverFiles, xmlContent } = await this.fetchHashList();

      if (!forceCheck) {
        const xmlHash = crypto.createHash('md5').update(xmlContent).digest('hex');
        const savedInfo = this.loadUpdateInfo();
        if (savedInfo.xmlHash && savedInfo.xmlHash === xmlHash) {
          this.emit('status', 'Jogo atualizado!');
          this.emit('complete', { updated: 0, skipped: true });
          return true;
        }
        this._pendingXmlHash = xmlHash;
      }

      if (serverFiles.length === 0) {
        this.emit('error', 'Nenhum arquivo encontrado no hash.xml');
        return false;
      }

      this.emit('status', `${serverFiles.length} arquivos encontrados no servidor`);

      // 3. Verificar quais arquivos precisam de atualização
      const filesToUpdate = await this.checkFiles(serverFiles);
      const skippedFiles = serverFiles.length - filesToUpdate.length;
      
      if (skippedFiles > 0 && filesToUpdate.length > 0) {
        this.emit('status', `${skippedFiles} arquivos já OK, ${filesToUpdate.length} para baixar`);
      }
      
      if (filesToUpdate.length === 0) {
        this.emit('status', 'Jogo atualizado!');
        
        // Salvar xmlHash para evitar re-verificação na próxima vez
        if (this._pendingXmlHash) {
          this.saveUpdateInfo({
            xmlHash: this._pendingXmlHash,
            lastCheck: new Date().toISOString(),
            totalFiles: serverFiles.length
          });
        }
        
        this.saveUpdaterVersion();
        this.emit('complete', { updated: 0 });
        return true;
      }

      // 4. Download individual dos arquivos que mudaram (update incremental)
      if (firstRun) {
        this.emit('status', `Instalando ${filesToUpdate.length} arquivos...`);
      } else {
        this.emit('status', `${filesToUpdate.length} arquivos para atualizar`);
      }

      const prevConcurrent = this.concurrentDownloads;
      if (firstRun) {
        this.concurrentDownloads = this.concurrentDownloadsFirstRun;
      }
      const failedFiles = await this.downloadFilesParallel(filesToUpdate);
      this.concurrentDownloads = prevConcurrent;

      // 5. Verificação final: só re-baixa arquivos que realmente falharam
      if (failedFiles.length > 0) {
        const successCount = filesToUpdate.length - failedFiles.length;
        console.log(`[Updater] ${failedFiles.length} arquivo(s) com falha — re-baixando...`);
        this.emit('status', `Re-baixando ${failedFiles.length} arquivo(s) com falha...`);
        // Continua a contagem a partir dos já baixados (evita parecer que reiniciou)
        await this.downloadFilesParallel(failedFiles, successCount, filesToUpdate.length);
      }

      // 6. Salvar info da atualização
      // Salva o xmlHash mesmo com falhas 404 (arquivo inexistente no servidor não vai
      // aparecer magicamente — salvar evita re-verificar todos os arquivos a cada abertura).
      // Falhas de rede (não-404) não salvam o hash para forçar retry na próxima execução.
      const only404Failures = !failedFiles || failedFiles.length === 0 ||
        failedFiles.every(f => f.error && (f.error.includes('404') || f.error.includes('não encontrado')));
      if (this._pendingXmlHash && only404Failures) {
        this.saveUpdateInfo({
          xmlHash: this._pendingXmlHash,
          lastCheck: new Date().toISOString(),
          totalFiles: serverFiles.length,
          lastUpdateFiles: filesToUpdate.length
        });
      } else if (failedFiles && failedFiles.length > 0) {
        console.log(`[Updater] ${failedFiles.length} arquivo(s) falharam por erro de rede — cache NÃO salvo para retry na próxima execução`);
        try {
          if (fs.existsSync(this.updateInfoFile)) fs.unlinkSync(this.updateInfoFile);
        } catch (e) {}
      }

      // Marcar versão do updater após sucesso
      this.saveUpdaterVersion();

      // 7. Reportar resultado
      const successCount = filesToUpdate.length - (failedFiles ? failedFiles.length : 0);
      
      if (failedFiles && failedFiles.length > 0) {
        const failedNames = failedFiles.map(f => f.file).join(', ');
        this.emit('warning', `${successCount} arquivos atualizados, ${failedFiles.length} falharam: ${failedNames}`);
        console.error(`[Updater] Arquivos com falha: ${failedNames}`);
      }

      this.emit('status', failedFiles && failedFiles.length > 0
        ? `Atualização concluída com ${failedFiles.length} erro(s)!`
        : 'Atualização concluída!');
      this.emit('complete', { updated: successCount, failed: failedFiles ? failedFiles.length : 0, failedFiles });
      return true;

    } catch (error) {
      this.emit('error', error.message);
      return false;
    }
  }

  // Força verificação completa ignorando cache de data
  async forceUpdate() {
    // Remove info salva para forçar verificação completa
    try {
      if (fs.existsSync(this.updateInfoFile)) {
        fs.unlinkSync(this.updateInfoFile);
      }
    } catch (e) {}
    
    return this.update(true);
  }

  // Define o caminho do jogo
  setGamePath(gamePath) {
    this.gamePath = gamePath;
    this.updateInfoFile = path.join(this.gamePath, '.launcher-update-info.json');
  }

  // Retorna o caminho atual do jogo
  getGamePath() {
    return this.gamePath;
  }
}

module.exports = Updater;
