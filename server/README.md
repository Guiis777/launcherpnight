# Tamer Quest — Estrutura do Servidor

Esta pasta contém todos os arquivos que devem ser hospedados no seu servidor web.
Faça upload do conteúdo para o seu domínio/servidor.

## Estrutura

```
server/
├── u/
│   ├── hash.xml              ← Lista de hashes dos arquivos do jogo
│   ├── updater-config.json   ← Config do updater (opcional)
│   ├── client.zip            ← ZIP do cliente para primeira instalação
│   ├── [arquivos do jogo]    ← Arquivos individuais referenciados no hash.xml
│   └── launcher/
│       ├── manifest.json     ← Lista de arquivos UI + hashes MD5
│       ├── main.js           ← Entry point do Electron (root)
│       ├── config.js         ← Configuração de URLs
│       ├── renderer.js       ← Lógica da UI
│       ├── updater.js        ← Updater do jogo
│       ├── auth.js           ← Sistema de autenticação
│       ├── news.js           ← Sistema de notícias
│       ├── news-config.json  ← Conteúdo das notícias
│       ├── index.html        ← Página principal
│       ├── styles.css        ← Estilos
│       └── launcher-updater.js ← Auto-updater do launcher
└── generate-manifest.ps1     ← Script para regenerar manifest.json
```

## Como hospedar

1. **Edite `u/launcher/config.js`** — troque as URLs para o seu domínio:
   ```js
   FILES_BASE: 'https://seudominio.com/u/',
   LAUNCHER_BASE: 'https://seudominio.com/u/launcher/',
   API_BASE: 'https://seudominio.com',
   ```

2. **Faça upload de `u/`** para o seu servidor web (Apache, Nginx, etc.)
   - O diretório `u/` deve ser acessível em `https://seudominio.com/u/`

3. **Regenere o manifest** após qualquer alteração nos arquivos:
   ```powershell
   .\generate-manifest.ps1
   ```

4. **Coloque os arquivos do jogo** dentro de `u/`:
   - Os arquivos listados no `hash.xml` devem estar em `u/[caminho]`
   - Exemplo: `u/data/fonts/cipsoftFont.otfont`
   - O `client.zip` para primeira instalação em `u/client.zip`

## No launcher (cliente)

Edite `src/config.js` no launcher com as mesmas URLs do seu servidor.
O launcher vai:
1. Baixar `manifest.json` do seu servidor
2. Comparar MD5 dos arquivos locais com o servidor
3. Atualizar apenas os arquivos que mudaram
