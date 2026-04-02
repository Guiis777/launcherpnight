// ==========================================
// Configuração Central — Altere o domínio aqui
// ==========================================
// Troque para o seu domínio ao hospedar em servidor próprio

module.exports = {
  // URL base do servidor de arquivos (onde ficam os updates do jogo)
  FILES_BASE: 'https://cdn.jsdelivr.net/gh/Guiis777/launcherpnight@main/server/u/',

  // URL base do launcher updater
  LAUNCHER_BASE: 'https://cdn.jsdelivr.net/gh/Guiis777/launcherpnight@main/server/u/launcher/',

  // URL do client.zip para primeira instalação (Google Drive ou outro host rápido)
  // Deixe vazio ('') para desativar o zip e usar download incremental
  // Formato Google Drive: https://drive.usercontent.google.com/download?id=SEU_FILE_ID&export=download&confirm=t
  ZIP_URL: '',

  // URL base da API de autenticação
  // Endpoints: {API_BASE}/accounts/authentication.php
  API_BASE: 'https://tamerquest.online',

  // Chave da API de autenticação
  API_KEY: 'pk_72Bf9xKzQm4sWdR1TgYp5vCeAhNj8uLo',

  // Links sociais
  DISCORD_URL: 'https://discord.gg/BwHs5k4sMF',
  SITE_URL: 'https://github.com/Guiis777/launcherpnight',
};
