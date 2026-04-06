// ==========================================
// Configuração Central — Altere o domínio aqui
// ==========================================
// Troque para o seu domínio ao hospedar em servidor próprio

module.exports = {
  // URL base para DOWNLOAD dos arquivos do jogo — jsDelivr CDN é rápido para assets
  FILES_BASE: 'https://cdn.jsdelivr.net/gh/Guiis777/launcherpnight@main/server/u/',

  // URL para buscar hash.xml e updater-config.json — raw.githubusercontent sem cache CDN
  FILES_BASE_HASH: 'https://raw.githubusercontent.com/Guiis777/launcherpnight/main/server/u/',

  // raw.githubusercontent para binários (.exe, .dll) — jsDelivr bloqueia esses por política (403)
  FILES_BASE_RAW: 'https://raw.githubusercontent.com/Guiis777/launcherpnight/main/server/u/',

  // URL base do launcher updater — raw para sempre pegar a versão mais recente sem cache CDN
  LAUNCHER_BASE: 'https://raw.githubusercontent.com/Guiis777/launcherpnight/main/server/u/launcher/',

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
  DISCORD_URL: 'https://discord.gg/h755xjPyA',
  SITE_URL: 'https://pnight.com.br/',
};
