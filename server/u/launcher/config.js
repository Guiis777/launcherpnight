// ==========================================
// Configuração Central — Altere o domínio aqui
// ==========================================
// Troque para o seu domínio ao hospedar em servidor próprio

module.exports = {
  // URL base do servidor de arquivos (onde ficam os updates do jogo)
  // Estrutura esperada: {FILES_BASE}/hash.xml, {FILES_BASE}/client.zip, etc.
  FILES_BASE: 'https://raw.githubusercontent.com/Guiis777/launcherpnight/main/server/u/',

  // URL base do launcher updater (onde ficam os arquivos de UI do launcher)
  // Estrutura esperada: {LAUNCHER_BASE}/manifest.json, {LAUNCHER_BASE}/renderer.js, etc.
  LAUNCHER_BASE: 'https://raw.githubusercontent.com/Guiis777/launcherpnight/main/server/u/launcher/',

  // URL base da API de autenticação
  // Endpoints: {API_BASE}/accounts/authentication.php
  API_BASE: 'https://tamerquest.online',

  // Chave da API de autenticação
  API_KEY: 'pk_72Bf9xKzQm4sWdR1TgYp5vCeAhNj8uLo',

  // Links sociais
  DISCORD_URL: 'https://discord.gg/BwHs5k4sMF',
  SITE_URL: 'https://github.com/Guiis777/launcherpnight',
};
