# Tamer Quest Launcher — Documentação Técnica

## Índice

1. [Visão Geral](#visão-geral)
2. [Estrutura do Projeto](#estrutura-do-projeto)
3. [Configuração Centralizada (config.js)](#configuração-centralizada-configjs)
4. [Processo Principal (main.js)](#processo-principal-mainjs)
5. [Interface do Usuário (index.html + renderer.js)](#interface-do-usuário)
6. [Sistema de Atualização do Jogo (updater.js)](#sistema-de-atualização-do-jogo)
7. [Auto-Atualizador do Launcher (launcher-updater.js)](#auto-atualizador-do-launcher)
8. [Sistema de Autenticação (auth.js)](#sistema-de-autenticação)
9. [Sistema de Notícias (news.js)](#sistema-de-notícias)
10. [Fontes e Assets Locais](#fontes-e-assets-locais)
11. [Estrutura do Servidor](#estrutura-do-servidor)
12. [Como Hospedar em Servidor Próprio](#como-hospedar-em-servidor-próprio)
13. [Fluxo Completo de Execução](#fluxo-completo-de-execução)
14. [Comandos de Desenvolvimento](#comandos-de-desenvolvimento)

---

## Visão Geral

O Tamer Quest Launcher é um aplicativo desktop construído com **Electron v28.0.0** que gerencia o download, atualização e execução do cliente do jogo Tamer Quest.

| Campo         | Valor                     |
|---------------|---------------------------|
| Nome          | `tml-launcher`            |
| Versão        | `3.0.0`                   |
| Electron      | `28.0.0`                  |
| Entry point   | `main.js`                 |
| UI            | `src/index.html`          |

### Dependências

| Pacote       | Versão   | Uso                                        |
|--------------|----------|--------------------------------------------|
| archiver     | ^7.0.1   | Compactação de arquivos (reservado)        |
| axios        | ^1.13.5  | Requisições HTTP (manifest, hash.xml)      |
| basic-ftp    | ^5.1.0   | Transferência FTP (reservado)              |
| fs-extra     | ^11.3.3  | Operações de filesystem avançadas          |
| ssh2         | ^1.17.0  | Conexão SSH (reservado para futuro)        |

---

## Estrutura do Projeto

```
Tamer Quest Launcher Recreated/
├── main.js                    # Processo principal do Electron
├── package.json               # Metadados e dependências
│
├── src/                       # Código do renderer (UI)
│   ├── config.js              # ★ Configuração centralizada de URLs
│   ├── index.html             # HTML principal (3 páginas: Home, News, Settings)
│   ├── styles.css             # Estilos CSS (~1800 linhas)
│   ├── renderer.js            # Lógica da UI (~818 linhas)
│   ├── updater.js             # Atualizador do jogo (~835 linhas)
│   ├── launcher-updater.js    # Auto-atualizador do launcher (~100 linhas)
│   ├── auth.js                # Autenticação (login/sessão)
│   ├── news.js                # Gerenciador de notícias/comentários
│   ├── news-config.json       # Dados estáticos das notícias
│   └── main.js                # (Cópia de referência, não é o entry point)
│
├── assets/                    # Recursos estáticos
│   ├── fonts/                 # Fontes locais (antes eram do Google Fonts)
│   │   ├── fonts.css          # @font-face declarations
│   │   ├── cinzel-400.ttf     # Cinzel Regular (títulos)
│   │   ├── cinzel-600.ttf     # Cinzel SemiBold
│   │   ├── cinzel-700.ttf     # Cinzel Bold
│   │   ├── inter-300.ttf      # Inter Light (corpo)
│   │   ├── inter-400.ttf      # Inter Regular
│   │   ├── inter-500.ttf      # Inter Medium
│   │   └── inter-600.ttf      # Inter SemiBold
│   ├── discord-button.png     # Botão do Discord (local)
│   ├── image.png              # Background 4K
│   ├── tamer_quest_icon.gif   # Ícone animado
│   ├── tamer_quest_icon.ico   # Ícone do Windows
│   ├── comments.json          # Dados de comentários
│   ├── emblems/               # Sprites de emblemas
│   └── cliente/               # Cliente do jogo (baixado pelo updater)
│       ├── init.lua
│       ├── data/              # Assets do jogo (sprites, shaders, mapas)
│       └── modules/           # Módulos Lua do cliente
│
├── server/                    # Arquivos para deploy no servidor web
│   ├── README.md              # Instruções de hospedagem
│   ├── generate-manifest.ps1  # Script para gerar manifest.json
│   └── u/                     # Raiz do servidor (mapeia para dominio.com/u/)
│       ├── hash.xml           # Hashes MD5 de todos os arquivos do jogo
│       └── launcher/          # Arquivos de UI servidos para auto-update
│           ├── manifest.json  # Lista de arquivos + MD5 para auto-update
│           ├── index.html
│           ├── styles.css
│           ├── renderer.js
│           ├── updater.js
│           ├── auth.js
│           ├── config.js
│           ├── launcher-updater.js
│           ├── news.js
│           ├── news-config.json
│           └── main.js
│
└── node_modules/              # Dependências (gerado por npm install)
```

---

## Configuração Centralizada (config.js)

O arquivo `src/config.js` centraliza **todas as URLs e chaves** do projeto. Para migrar o launcher para um novo domínio, basta alterar este único arquivo.

```js
module.exports = {
  // Servidor de arquivos do jogo (hash.xml, client.zip, arquivos individuais)
  FILES_BASE: 'https://tamerquest.com/u/',

  // Servidor do auto-updater do launcher (manifest.json + arquivos de UI)
  LAUNCHER_BASE: 'https://tamerquest.com/u/launcher/',

  // API de autenticação
  API_BASE: 'https://tamerquest.online',

  // Chave da API
  API_KEY: 'pk_72Bf9xKzQm4sWdR1TgYp5vCeAhNj8uLo',

  // Links sociais
  DISCORD_URL: 'https://discord.gg/BwHs5k4sMF',
  SITE_URL: 'https://tamerquest.com',
};
```

### Quem consome o config.js

| Arquivo              | Campos usados                              |
|----------------------|--------------------------------------------|
| `main.js`            | `LAUNCHER_BASE`                            |
| `renderer.js`        | `FILES_BASE`, `DISCORD_URL`, `SITE_URL`    |
| `auth.js`            | `API_BASE`, `API_KEY`                      |

---

## Processo Principal (main.js)

O `main.js` é o entry point do Electron (processo principal). Ele:

1. **Cria a janela** — `BrowserWindow` sem bordas (`frame: false`), tamanho da tela, background preto
2. **Configura o LauncherUpdater** — aponta para `config.LAUNCHER_BASE`
3. **Carrega a UI** — `mainWindow.loadFile('src/index.html')`
4. **Registra IPC handlers** — ponte de comunicação entre processo principal e renderer

### IPC Handlers

| Canal                | Tipo     | Função                                                    |
|----------------------|----------|-----------------------------------------------------------|
| `minimize-window`    | `on`     | Minimiza a janela                                         |
| `maximize-window`    | `on`     | Alterna maximizar/restaurar                               |
| `close-window`       | `on`     | Fecha a janela                                            |
| `open-external`      | `on`     | Abre URL no navegador padrão (validação https/http)       |
| `select-folder`      | `handle` | Dialog para selecionar pasta do jogo                      |
| `install-vcredist`   | `on`     | Executa vc_redist.x86.exe com elevação de admin           |
| `launch-game`        | `on`     | Spawn do executável do jogo (detached, unref)             |
| `comments-load`      | `handle` | Retorna `{}` (comentários desativados)                    |
| `comments-add`       | `handle` | Retorna erro (comentários desativados)                    |

### Auto-Update do Launcher

O `main.js` contém a função `checkLauncherUpdates()` que:
1. Chama `launcherUpdater.checkForUpdates()`
2. Se houve atualização e o próprio `main.js` foi atualizado (`rootUpdated`), reinicia o app via `app.relaunch()` + `app.exit(0)`

**Estado atual**: **DESATIVADO** — a linha `await checkLauncherUpdates()` está comentada. Deve ser reativada quando o launcher estiver hospedado em servidor próprio:

```js
app.whenReady().then(async () => {
  // NOTA: Descomente a linha abaixo quando hospedar em servidor próprio
  // await checkLauncherUpdates();
  createWindow();
});
```

---

## Interface do Usuário

### index.html

A interface é uma SPA (Single Page Application) com 3 páginas internas:

| Página          | ID              | Conteúdo                                              |
|-----------------|-----------------|-------------------------------------------------------|
| **Home**        | `page-home`     | Logo, status, botão JOGAR, barra de progresso, destaques |
| **Novidades**   | `page-news`     | Feed de notícias, visualização detalhada, comentários |
| **Configurações** | `page-settings` | Renderizador (DX/GL), pasta do jogo, auto-start, VC Redist |

**Características**:
- Title bar customizada (sem a nativa do Windows)
- CSP configurado: `connect-src 'self' https:` (permite chamadas HTTPS de qualquer domínio)
- Fontes carregadas localmente via `../assets/fonts/fonts.css`
- Todas as imagens são locais (nenhuma dependência externa)

### renderer.js

O `renderer.js` (~818 linhas) gerencia toda a lógica da UI:

- **Inicialização do Updater** — cria instância com `baseUrl: config.FILES_BASE`
- **Controles da janela** — minimize/maximize/close via IPC
- **Navegação** — alterna entre páginas via `data-page` nos botões
- **Barra de progresso** — mostra download/verificação em tempo real
- **Botão JOGAR** — inicia o executável selecionado (DX ou GL)
- **Login/Logout** — exibe modal, chama `Auth.login()`, atualiza a UI
- **Links sociais** — injeta `config.DISCORD_URL` e `config.SITE_URL` via `getElementById`
- **Lançamento do jogo** — executa `otclient_dx.exe` ou `otclient_gl.exe`

---

## Sistema de Atualização do Jogo

### updater.js — Visão Geral

O `updater.js` (~835 linhas) é o coração do launcher. Gerencia o download e atualização de todos os arquivos do cliente do jogo.

### Configuração Remota (updater-config.json)

Ao iniciar, o updater tenta buscar `{FILES_BASE}/updater-config.json` no servidor. Este arquivo controla:

```json
{
  "version": 1,
  "forceCleanInstall": false,
  "maintenance": false,
  "maintenanceMessage": "Servidor em manutenção",
  "message": "Mensagem para todos os jogadores",
  "concurrentDownloads": 3,
  "concurrentDownloadsFirstRun": 6
}
```

| Campo                      | Função                                                |
|----------------------------|-------------------------------------------------------|
| `version`                  | Número da versão — se mudar, invalida cache de headers |
| `forceCleanInstall`        | Se `true`, apaga todo o cliente e redownloada         |
| `maintenance`              | Se `true`, bloqueia a atualização e mostra mensagem   |
| `message`                  | Mensagem informativa exibida a todos os jogadores     |
| `concurrentDownloads`      | Número de downloads simultâneos (padrão: 3)           |
| `concurrentDownloadsFirstRun` | Downloads simultâneos na primeira instalação (padrão: 6) |

### Fluxo de Atualização

```
1. fetchRemoteConfig()
   └─ Busca updater-config.json (manutenção? versão nova? clean install?)

2. needsCleanInstall()
   └─ Compara versão local vs remota, verifica forceCleanInstall
   └─ Se sim: cleanClientFiles() → apaga tudo exceto .launcher/.updater

3. isFirstRun()
   └─ Verifica se otclient_dx.exe / otclient_gl.exe existem

4. [Primeira instalação] hasRemoteZip()
   └─ HEAD em {FILES_BASE}/client.zip
   └─ Se existe: downloadAndExtractZip() (download + tar/PowerShell extract)
   └─ Se não: vai para atualização incremental

5. hasRemoteChanged()
   └─ HEAD em hash.xml, compara Last-Modified/ETag salvos
   └─ Se não mudou: "Jogo atualizado!", fim

6. fetchHashList()
   └─ GET hash.xml, parse regex: <hashing name="..." hash="..."/>

7. checkFiles(serverFiles)
   └─ Para cada arquivo: verifica se existe + compara MD5
   └─ Em lotes de 50 para performance

8. downloadFilesParallel(filesToUpdate)
   └─ Workers concorrentes (3 normal, 6 first run)
   └─ Cada download: GET → .tmp → verificar MD5 → rename
   └─ Fallback: /u/ → /otclient/ se 404
   └─ Retry: 3 tentativas com backoff
```

### Formato do hash.xml

```xml
<hashing name="data/things/catalog-content.json" hash="A1B2C3D4E5F6..."/>
<hashing name="modules/game_battle/battle.lua" hash="F6E5D4C3B2A1..."/>
```

Cada entrada contém o caminho relativo do arquivo e seu hash MD5. O updater compara com os arquivos locais para determinar quais precisam ser baixados.

### Downloads

- **Streaming nativo** — usa `http.get` / `https.get` (não axios) para downloads grandes
- **Arquivo temporário** — baixa como `.tmp`, verifica MD5, depois renomeia para o nome final
- **Inactivity timeout** — 30 segundos sem dados cancela o download
- **Progresso throttled** — emite eventos a cada 200ms (não a cada chunk)
- **Fallback de URL** — se `/u/arquivo` retorna 404, tenta `/otclient/arquivo`

### Primeira Instalação (client.zip)

Na primeira execução (sem `otclient_dx.exe` nem `otclient_gl.exe`):
1. Verifica se `client.zip` existe no servidor (`HEAD request`)
2. Se sim, baixa o zip completo (~centenas de MB)
3. Extrai usando `tar -xf` (Windows 10+) com fallback para `PowerShell Expand-Archive`
4. Após extração, o updater incremental corrige qualquer arquivo diferente

---

## Auto-Atualizador do Launcher

### launcher-updater.js — Como Funciona

O `launcher-updater.js` (~100 linhas) atualiza os próprios arquivos de UI do launcher. É executado pelo `main.js` antes de criar a janela.

### Fluxo

```
1. fetchManifest()
   └─ GET {LAUNCHER_BASE}/manifest.json

2. Para cada arquivo no manifest:
   └─ Compara MD5 local vs MD5 do manifest
   └─ Se diferente: GET {LAUNCHER_BASE}/{arquivo}
   └─ Verifica MD5 do conteúdo baixado
   └─ Sobrescreve arquivo local

3. Arquivos com "root: true" no manifest
   └─ São salvos no diretório pai (raiz do app)
   └─ Ex: main.js vai para a raiz, não para src/
```

### manifest.json

```json
{
  "files": [
    { "name": "index.html", "md5": "abc123..." },
    { "name": "styles.css", "md5": "def456..." },
    { "name": "renderer.js", "md5": "ghi789..." },
    { "name": "main.js", "md5": "jkl012...", "root": true },
    ...
  ]
}
```

| Campo  | Significado                                                |
|--------|------------------------------------------------------------|
| `name` | Nome do arquivo                                            |
| `md5`  | Hash MD5 esperado                                          |
| `root` | Se `true`, arquivo vai para o diretório pai (raiz do app)  |

### rootUpdated — Reinício Automático

Se o arquivo `main.js` (entry point do Electron, marcado com `root: true`) for atualizado, o launcher se reinicia automaticamente (`app.relaunch()` + `app.exit(0)`) para carregar a nova versão.

### Fallback

Se `manifest.json` não existir no servidor, o updater usa uma lista fixa:
```js
['index.html', 'styles.css', 'renderer.js', 'updater.js', 'auth.js']
```

---

## Sistema de Autenticação

### auth.js — Visão Geral

O `auth.js` gerencia login, sessão e personagens. Faz duas chamadas HTTP ao servidor:
1. **Login** — autentica o usuário e retorna sessão + personagens básicos
2. **Detalhes dos Personagens** — busca dados completos (looktype, town, etc.)

### Sessão Local (localStorage)

- **Chave**: `tq_auth`
- **Expira em**: 24 horas (verificado por `loginAt`)
- **Estrutura armazenada**:

```json
{
  "session": "TOKEN_DE_SESSAO_RETORNADO_PELA_API",
  "account": { "id": 123, "name": "jogador@email.com", "...": "..." },
  "characters": [
    { "name": "CharName", "level": 50, "looktype": 128, "town": "Saffron", "...": "..." }
  ],
  "selectedCharacter": { "name": "CharName", "level": 50, "...": "..." },
  "loginAt": 1709740800000
}
```

---

### API Endpoint 1: Login (Autenticação)

```
POST {API_BASE}/accounts/authentication.php
```

**Base URL atual**: `https://tamerquest.online`

#### Request

| Campo        | Tipo     | Obrigatório | Descrição                          |
|--------------|----------|-------------|------------------------------------|
| Content-Type | Header   | Sim         | `application/json`                 |

**Body (JSON)**:

```json
{
  "userAccount": "email@exemplo.com",
  "password": "senha_do_usuario",
  "bearer": "pk_72Bf9xKzQm4sWdR1TgYp5vCeAhNj8uLo"
}
```

| Campo        | Tipo   | Descrição                                              |
|--------------|--------|--------------------------------------------------------|
| `userAccount`| string | Email ou nome da conta do jogador                      |
| `password`   | string | Senha do jogador (texto plano no body, via HTTPS)      |
| `bearer`     | string | Chave da API (`config.API_KEY`) — identifica o launcher |

#### Response — Sucesso

```json
{
  "session": "abc123def456...",
  "account": {
    "id": 123,
    "name": "jogador@email.com"
  },
  "body": [
    {
      "name": "CharName1",
      "level": 50
    },
    {
      "name": "CharName2",
      "level": 30
    }
  ]
}
```

| Campo     | Tipo     | Descrição                                                    |
|-----------|----------|--------------------------------------------------------------|
| `session` | string   | Token de sessão — usado como Bearer token nas próximas calls |
| `account` | object   | Dados da conta (id, name, possivelmente outros campos)       |
| `body`    | array    | Lista de personagens básicos (name, level)                   |

#### Response — Erro

```json
{
  "errorMessage": "Email ou senha incorretos."
}
```

| Campo          | Tipo   | Descrição                         |
|----------------|--------|-----------------------------------|
| `errorMessage` | string | Mensagem de erro exibida ao usuário |

**Comportamento no launcher**: Se `data.errorMessage` existir, o login falha e a mensagem é exibida no modal.

---

### API Endpoint 2: Detalhes dos Personagens

```
GET {API_BASE}/management/Characters/Character.php
```

Chamado automaticamente **após o login bem-sucedido** para enriquecer os dados dos personagens.

#### Request

| Campo         | Tipo   | Obrigatório | Descrição                                     |
|---------------|--------|-------------|-----------------------------------------------|
| Authorization | Header | Sim         | `Bearer {session}` (token retornado no login) |

```
GET /management/Characters/Character.php HTTP/1.1
Host: tamerquest.online
Authorization: Bearer abc123def456...
```

#### Response — Sucesso

```json
{
  "account": {
    "id": 123,
    "name": "jogador@email.com",
    "premiumDays": 30,
    "...": "outros campos da conta"
  },
  "body": [
    {
      "name": "CharName1",
      "level": 50,
      "looktype": 128,
      "town": "Saffron",
      "vocation": "Tamer",
      "...": "outros campos do personagem"
    },
    {
      "name": "CharName2",
      "level": 30,
      "looktype": 256,
      "town": "Cerulean",
      "vocation": "Tamer",
      "...": "outros campos do personagem"
    }
  ]
}
```

| Campo     | Tipo   | Descrição                                                     |
|-----------|--------|---------------------------------------------------------------|
| `account` | object | Dados completos da conta (merge com dados do login)           |
| `body`    | array  | Lista de personagens com dados detalhados (looktype, town...) |

**Comportamento no launcher**:
- Se `dd.body` existir, substitui `this.characters` com os dados detalhados
- Se `dd.account` existir, faz merge com `this.account` (spread: `{ ...this.account, ...dd.account }`)
- Se a chamada falhar, os dados básicos do login são mantidos (graceful fallback)

#### Response — Erro

Se o token for inválido ou expirado, a API pode retornar:

```json
{
  "errorMessage": "Sessão inválida ou expirada."
}
```

O launcher ignora erros neste endpoint (try/catch vazio) — os dados básicos do login continuam funcionando.

---

### Fluxo Completo de Autenticação

```
┌──────────────────────────────────────────────────────────────────┐
│  1. Usuário abre o modal e insere email + senha                  │
│                                                                  │
│  2. POST /accounts/authentication.php                            │
│     Body: { userAccount, password, bearer: API_KEY }             │
│     ├─ Sucesso → recebe session + account + body (personagens)   │
│     └─ Erro → exibe errorMessage no modal, fim                   │
│                                                                  │
│  3. GET /management/Characters/Character.php                     │
│     Header: Authorization: Bearer {session}                      │
│     ├─ Sucesso → substitui personagens com dados detalhados      │
│     └─ Erro → ignora, mantém dados básicos do login              │
│                                                                  │
│  4. Auto-seleciona o primeiro personagem da lista                │
│                                                                  │
│  5. Salva tudo em localStorage (chave: tq_auth)                  │
│     { session, account, characters, selectedCharacter, loginAt } │
│                                                                  │
│  6. UI atualiza:                                                 │
│     - Esconde botão "Entrar"                                     │
│     - Mostra <select> com personagens (nome + level)             │
│     - Habilita likes/comentários nas notícias                    │
│                                                                  │
│  7. Nas próximas aberturas do launcher:                          │
│     - Restaura sessão do localStorage                            │
│     - Se loginAt > 24h → logout automático                       │
│     - Se < 24h → sessão restaurada, sem nova chamada à API       │
│                                                                  │
│  8. Logout:                                                      │
│     - Limpa localStorage (remove tq_auth)                        │
│     - Reseta session/account/characters/selectedCharacter        │
│     - Não faz chamada à API (logout é apenas local)              │
└──────────────────────────────────────────────────────────────────┘
```

---

### Resumo para Replicar a API

Para replicar o backend de autenticação, você precisa implementar **2 endpoints**:

#### `POST /accounts/authentication.php`

1. Receber JSON com `userAccount`, `password`, `bearer`
2. Validar a `bearer` (API key) — rejeitar se inválida
3. Verificar credenciais do usuário (email + senha)
4. Se inválido → retornar `{ "errorMessage": "..." }`
5. Se válido → gerar token de sessão e retornar:
   ```json
   { "session": "token", "account": {...}, "body": [{personagem1}, {personagem2}] }
   ```

#### `GET /management/Characters/Character.php`

1. Ler header `Authorization: Bearer {token}`
2. Validar o token de sessão
3. Buscar dados completos dos personagens da conta
4. Retornar:
   ```json
   { "account": {...dados_completos...}, "body": [{char1_completo}, {char2_completo}] }
   ```

**Campos mínimos necessários nos personagens** (usados pela UI):

| Campo      | Usado em                     | Necessário |
|------------|------------------------------|------------|
| `name`     | Select de personagens, likes | **Sim**    |
| `level`    | Select: "CharName (Lv.50)"  | **Sim**    |
| `looktype` | (futuro: avatar)             | Opcional   |
| `town`     | (futuro: info)               | Opcional   |
| `vocation` | (futuro: info)               | Opcional   |

---

## Sistema de Notícias

### news.js + news-config.json

O sistema de notícias funciona com dados estáticos definidos em `news-config.json`:

- **Feed** — Lista de cards com imagem, título, data, excerpt
- **Detail** — Visualização expandida com conteúdo completo
- **Comentários** — Sistema preparado mas **atualmente desativado** (aguardando API HTTP; anteriormente usava SSH/SFTP)
- **Likes** — Contagem por personagem logado

As notícias atuais:
1. **PVP Casual & Ranked** — Sistema de PVP com picks, bans e elos
2. **Beta 3** — Nova versão do jogo
3. **Beta 1 & 2** — Encerramento das fases anteriores

---

## Fontes e Assets Locais

### Migração de Fontes

Originalmente, o launcher carregava fontes do Google Fonts (CDN remoto):
```css
/* ANTES (remoto) */
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Inter:wght@300;400;500;600&display=swap');
```

Agora todas as fontes são locais:
```css
/* DEPOIS (local) */
@import url('../assets/fonts/fonts.css');
```

### Fontes Instaladas

| Arquivo          | Família | Peso | Uso             |
|------------------|---------|------|-----------------|
| cinzel-400.ttf   | Cinzel  | 400  | Títulos normal  |
| cinzel-600.ttf   | Cinzel  | 600  | Títulos semi    |
| cinzel-700.ttf   | Cinzel  | 700  | Títulos bold    |
| inter-300.ttf    | Inter   | 300  | Corpo light     |
| inter-400.ttf    | Inter   | 400  | Corpo normal    |
| inter-500.ttf    | Inter   | 500  | Corpo medium    |
| inter-600.ttf    | Inter   | 600  | Corpo semibold  |

### Outros Assets Localizados

| Asset                  | Antes (remoto)                          | Depois (local)               |
|------------------------|-----------------------------------------|------------------------------|
| Discord button         | `tamerquest.com/.../discord-button.png` | `../assets/discord-button.png` |
| Google Fonts (Cinzel)  | `fonts.googleapis.com`                  | `../assets/fonts/cinzel-*.ttf` |
| Google Fonts (Inter)   | `fonts.googleapis.com`                  | `../assets/fonts/inter-*.ttf`  |

---

## Estrutura do Servidor

A pasta `server/` contém tudo que precisa ser publicado na web para o launcher funcionar remotamente.

### Estrutura de Deploy

```
servidor-web/
└── u/                           # Mapeado para: https://seudominio.com/u/
    ├── hash.xml                 # Hashes MD5 de todos os arquivos do jogo
    ├── client.zip               # (opcional) ZIP completo para primeira instalação
    ├── updater-config.json      # (opcional) Config remoto do updater
    ├── [arquivos do jogo]       # Todos os arquivos listados no hash.xml
    └── launcher/                # Auto-updater do launcher
        ├── manifest.json        # Lista de arquivos + MD5
        ├── index.html
        ├── styles.css
        ├── renderer.js
        ├── updater.js
        ├── auth.js
        ├── config.js
        ├── launcher-updater.js
        ├── news.js
        ├── news-config.json
        └── main.js
```

### generate-manifest.ps1

Script PowerShell que regenera `manifest.json` automaticamente calculando o MD5 de cada arquivo na pasta `u/launcher/`:

```powershell
# Executar na pasta server/
.\generate-manifest.ps1
```

O script:
1. Lista todos os arquivos em `u/launcher/` (exceto `manifest.json`)
2. Calcula o hash MD5 de cada um
3. Marca `main.js` com `"root": true`
4. Gera `u/launcher/manifest.json`

---

## Como Hospedar em Servidor Próprio

### Passo 1 — Alterar o config.js

Edite `src/config.js` com o seu domínio:

```js
module.exports = {
  FILES_BASE: 'https://seudominio.com/u/',
  LAUNCHER_BASE: 'https://seudominio.com/u/launcher/',
  API_BASE: 'https://seudominio.com',
  API_KEY: 'sua-chave-api',
  DISCORD_URL: 'https://discord.gg/seu-servidor',
  SITE_URL: 'https://seudominio.com',
};
```

### Passo 2 — Upload dos arquivos do servidor

Copie todo o conteúdo de `server/u/` para o seu servidor web, na rota `/u/`:

```
seudominio.com/u/hash.xml            → server/u/hash.xml
seudominio.com/u/launcher/           → server/u/launcher/*
seudominio.com/u/[arquivos do jogo]  → os arquivos listados no hash.xml
```

### Passo 3 — Upload dos arquivos do jogo

Os arquivos do jogo (referenciados no `hash.xml`) devem estar acessíveis em `{FILES_BASE}/{nome_do_arquivo}`. O `hash.xml` contém os caminhos relativos de cada arquivo.

### Passo 4 — Reativar o auto-updater

No `main.js` (raiz), descomente a linha do auto-updater:

```js
app.whenReady().then(async () => {
  await checkLauncherUpdates();  // ← Descomente esta linha
  createWindow();
});
```

### Passo 5 — Gerar o manifest.json atualizado

Copie os arquivos `src/*` atualizados para `server/u/launcher/` e execute:

```powershell
cd server
.\generate-manifest.ps1
```

Depois, faça upload do novo `manifest.json` para o servidor.

### Passo 6 (opcional) — Criar updater-config.json

Crie `u/updater-config.json` no servidor para controle remoto:

```json
{
  "version": 1,
  "forceCleanInstall": false,
  "maintenance": false,
  "maintenanceMessage": "",
  "message": "",
  "concurrentDownloads": 3,
  "concurrentDownloadsFirstRun": 6
}
```

### Passo 7 (opcional) — Criar client.zip

Para primeira instalação rápida, crie um `client.zip` contendo todo o cliente do jogo e coloque em `u/client.zip`. Jogadores novos baixarão o zip de uma vez em vez de milhares de arquivos individuais.

---

## Fluxo Completo de Execução

```
┌─────────────────────────────────────────────────────────┐
│                    npm start / electron .                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. main.js carrega                                     │
│     ├─ Importa config.js e LauncherUpdater              │
│     ├─ [SE ATIVO] checkLauncherUpdates()                │
│     │   ├─ Busca manifest.json do servidor              │
│     │   ├─ Compara MD5 de cada arquivo                  │
│     │   ├─ Baixa arquivos diferentes                    │
│     │   └─ Se main.js mudou → app.relaunch()            │
│     └─ createWindow()                                   │
│        └─ Carrega src/index.html                        │
│                                                         │
│  2. renderer.js carrega                                 │
│     ├─ Importa config.js, Updater, Auth, NewsManager    │
│     ├─ Cria instância do Updater com baseUrl            │
│     ├─ Injeta URLs sociais nos botões                   │
│     ├─ Restaura sessão de auth (localStorage)           │
│     └─ Inicia atualização automática                    │
│                                                         │
│  3. updater.update()                                    │
│     ├─ fetchRemoteConfig() → updater-config.json        │
│     ├─ Verifica manutenção                              │
│     ├─ Verifica necessidade de clean install             │
│     ├─ [FIRST RUN] downloadAndExtractZip()              │
│     ├─ hasRemoteChanged() → HEAD hash.xml               │
│     ├─ fetchHashList() → GET hash.xml + parse           │
│     ├─ checkFiles() → MD5 em lotes de 50                │
│     └─ downloadFilesParallel() → workers concorrentes   │
│                                                         │
│  4. Usuário clica JOGAR                                 │
│     ├─ renderer.js envia IPC 'launch-game'              │
│     ├─ main.js spawn(otclient_dx/gl.exe, detached)      │
│     └─ [SE CONFIGURADO] fecha o launcher                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Comandos de Desenvolvimento

```bash
# Instalar dependências
npm install

# Executar o launcher (produção)
npm start

# Executar em modo dev
npm run dev

# Gerar manifest.json do servidor
cd server
powershell .\generate-manifest.ps1
```

---

## Observações Importantes

1. **O auto-updater está desativado** — O `main.js` tem a linha `await checkLauncherUpdates()` comentada. Isso foi necessário durante o desenvolvimento porque o launcher original apontava para `tamerquest.com` e sobrescrevia as modificações locais. **Reative quando hospedar no seu próprio servidor.**

2. **Comentários estão desativados** — O sistema de comentários usava SSH/SFTP direto do launcher para ler/gravar um `comments.json` no servidor. Isso foi desativado por segurança. O plano é substituir por chamadas HTTP a uma API REST.

3. **Fallback de URL** — O updater tenta automaticamente `/otclient/` como fallback se `/u/` retornar 404 para um arquivo. Isso garante compatibilidade com diferentes estruturas de servidor.

4. **CSP flexível** — O Content Security Policy permite `connect-src 'self' https:`, permitindo chamadas para qualquer domínio HTTPS. Isso é necessário porque o domínio do servidor pode mudar.

5. **Sessão local** — A autenticação é armazenada em `localStorage` e expira em 24 horas. Não há token de refresh — após 24h o usuário precisa fazer login novamente.
