const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class LauncherUpdater {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'https://tamerquest.com/u/launcher/';
    this.localPath = options.localPath || path.join(__dirname);
  }

  // Calcula MD5 de um arquivo
  calculateMD5(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
  }

  // Busca o manifest.json do servidor para saber quais arquivos existem
  async fetchManifest() {
    try {
      const response = await axios.get(this.baseUrl + 'manifest.json', {
        responseType: 'json',
        timeout: 10000
      });
      return response.data;
    } catch (error) {
      console.log('[LauncherUpdater] manifest.json não encontrado no servidor');
      return null;
    }
  }

  // Baixa e atualiza um arquivo — usa arraybuffer para comparar bytes exatos
  async checkAndUpdateFile(filename, isRoot = false, subdir = null) {
    try {
      const remoteUrl = this.baseUrl + (subdir ? subdir + '/' : '') + filename;
      let targetDir;
      if (subdir) {
        targetDir = path.join(this.localPath, '..', subdir);
      } else if (isRoot) {
        targetDir = path.join(this.localPath, '..');
      } else {
        targetDir = this.localPath;
      }
      const localFilePath = path.join(targetDir, filename);

      const response = await axios.get(remoteUrl, {
        responseType: 'arraybuffer',
        timeout: 15000
      });

      const remoteBuffer = Buffer.from(response.data);
      const remoteMD5 = crypto.createHash('md5').update(remoteBuffer).digest('hex');
      const localMD5 = this.calculateMD5(localFilePath);

      if (remoteMD5 !== localMD5) {
        fs.mkdirSync(path.dirname(localFilePath), { recursive: true });
        fs.writeFileSync(localFilePath, remoteBuffer);
        console.log(`[LauncherUpdater] Atualizado: ${filename}`);
        return true;
      }

      return false;
    } catch (error) {
      console.log(`[LauncherUpdater] Falha ao baixar ${filename}: ${error.message}`);
      return false;
    }
  }

  // Verifica todos os arquivos usando o manifest — downloads em paralelo
  async checkForUpdates() {
    const manifest = await this.fetchManifest();

    if (manifest && manifest.files) {
      // Filtra apenas os arquivos que realmente mudaram (comparação rápida pelo manifest)
      const toUpdate = manifest.files.filter(fileInfo => {
        let targetDir;
        if (fileInfo.subdir) {
          targetDir = path.join(this.localPath, '..', fileInfo.subdir);
        } else if (fileInfo.root) {
          targetDir = path.join(this.localPath, '..');
        } else {
          targetDir = this.localPath;
        }
        const localMD5 = this.calculateMD5(path.join(targetDir, fileInfo.name));
        return localMD5 !== fileInfo.md5;
      });

      if (toUpdate.length === 0) return false;

      console.log(`[LauncherUpdater] ${toUpdate.length} arquivo(s) para atualizar`);

      // Baixa todos em paralelo
      const results = await Promise.all(
        toUpdate.map(fileInfo => this.checkAndUpdateFile(fileInfo.name, fileInfo.root, fileInfo.subdir))
      );

      return results.some(Boolean);
    } else {
      // Fallback: lista fixa
      const fallbackFiles = ['index.html', 'styles.css', 'renderer.js', 'updater.js', 'auth.js'];
      const results = await Promise.all(fallbackFiles.map(f => this.checkAndUpdateFile(f)));
      return results.some(Boolean);
    }
  }
}

module.exports = LauncherUpdater;
