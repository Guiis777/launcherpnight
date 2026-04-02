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

  // Verifica e atualiza um arquivo de UI
  async checkAndUpdateFile(filename, isRoot = false) {
    try {
      const remoteUrl = this.baseUrl + filename;
      // Arquivos root vão para o diretório pai (raiz do app)
      const targetDir = isRoot ? path.join(this.localPath, '..') : this.localPath;
      const localFilePath = path.join(targetDir, filename);
      
      const response = await axios.get(remoteUrl, { 
        responseType: 'text',
        timeout: 10000 
      });
      
      const remoteContent = response.data;
      const remoteMD5 = crypto.createHash('md5').update(remoteContent).digest('hex');
      const localMD5 = this.calculateMD5(localFilePath);
      
      if (remoteMD5 !== localMD5) {
        fs.writeFileSync(localFilePath, remoteContent, 'utf8');
        console.log(`[LauncherUpdater] Atualizado: ${filename}`);
        return true;
      }
      
      return false;
    } catch (error) {
      console.log(`[LauncherUpdater] Arquivo ${filename} não encontrado no servidor (ok se não configurado)`);
      return false;
    }
  }

  // Verifica todos os arquivos de UI usando o manifest
  async checkForUpdates() {
    let updated = false;
    
    // Tenta usar manifest.json para lista dinâmica de arquivos
    const manifest = await this.fetchManifest();
    
    if (manifest && manifest.files) {
      for (const fileInfo of manifest.files) {
        // Arquivos com root:true vão para o diretório pai (raiz do app)
        const targetDir = fileInfo.root ? path.join(this.localPath, '..') : this.localPath;
        const localMD5 = this.calculateMD5(path.join(targetDir, fileInfo.name));
        
        // Só baixa se o MD5 for diferente
        if (localMD5 !== fileInfo.md5) {
          const wasUpdated = await this.checkAndUpdateFile(fileInfo.name, fileInfo.root);
          if (wasUpdated) updated = true;
        }
      }
    } else {
      // Fallback: lista fixa caso manifest não exista ainda
      const fallbackFiles = ['index.html', 'styles.css', 'renderer.js', 'updater.js', 'auth.js'];
      for (const file of fallbackFiles) {
        const wasUpdated = await this.checkAndUpdateFile(file);
        if (wasUpdated) updated = true;
      }
    }
    
    return updated;
  }
}

module.exports = LauncherUpdater;
