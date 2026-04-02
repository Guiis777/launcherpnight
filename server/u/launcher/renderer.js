const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');
const Updater = require('./updater');
const NewsManager = require('./news');
const config = require('./config');

// ==========================================
// Configuração do Updater
// ==========================================
// O client NÃO vem embutido - é baixado do servidor na primeira execução
// __dirname resolve corretamente em dev (src/) e em produção (resources/app/src/)
const APP_PATH = path.join(__dirname, '..');
const DEFAULT_GAME_PATH = path.join(APP_PATH, 'assets', 'cliente');

const updater = new Updater({
  baseUrl: config.FILES_BASE,
  hashFile: 'hash.xml',
  zipUrl: config.ZIP_URL || null,
  gamePath: localStorage.getItem('gamePath') || DEFAULT_GAME_PATH,
  concurrentDownloads: 15,
  concurrentDownloadsFirstRun: 20,
});

// ==========================================
// Controles da janela
// ==========================================
document.getElementById('btn-minimize').addEventListener('click', () => {
  ipcRenderer.send('minimize-window');
});

document.getElementById('btn-maximize').addEventListener('click', () => {
  ipcRenderer.send('maximize-window');
});

document.getElementById('btn-close').addEventListener('click', () => {
  ipcRenderer.send('close-window');
});

// ==========================================
// Navegação entre páginas
// ==========================================
const navButtons = document.querySelectorAll('.top-nav .nav-btn');
const pages = document.querySelectorAll('.page');

navButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const targetPage = btn.dataset.page;
    if (!targetPage) return;
    
    navButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    pages.forEach(page => {
      page.classList.remove('active');
      if (page.id === `page-${targetPage}`) {
        page.classList.add('active');
      }
    });
  });
});

// ==========================================
// Elementos da UI
// ==========================================
const playBtn = document.getElementById('btn-play');
const progressContainer = document.getElementById('progress-container');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const gamePathInput = document.getElementById('game-path');

// Carregar caminho salvo
if (gamePathInput) {
  gamePathInput.value = updater.getGamePath();
}

// ==========================================
// Funções de UI
// ==========================================
function showProgress() {
  playBtn.style.display = 'none';
  progressContainer.style.display = 'block';
}

function hideProgress() {
  playBtn.style.display = 'flex';
  progressContainer.style.display = 'none';
}

function updateProgress(percent, text) {
  progressFill.style.width = `${percent}%`;
  progressText.textContent = text;
}

function setPlayButtonState(state, text) {
  playBtn.disabled = state === 'disabled';
  playBtn.querySelector('.play-text').textContent = text;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ==========================================
// Eventos do Updater
// ==========================================
let _isDownloading = false;
let _dlSpeedTracker = { bytes: 0, time: Date.now(), speed: 0 };

function calcSpeed(receivedTotal) {
  const now = Date.now();
  const elapsed = (now - _dlSpeedTracker.time) / 1000;
  if (elapsed >= 1) {
    const diff = receivedTotal - _dlSpeedTracker.bytes;
    _dlSpeedTracker.speed = diff / elapsed;
    _dlSpeedTracker.bytes = receivedTotal;
    _dlSpeedTracker.time = now;
  }
  return _dlSpeedTracker.speed;
}

function formatSpeed(bps) {
  if (bps <= 0) return '';
  if (bps > 1024 * 1024) return ` · ${(bps / 1024 / 1024).toFixed(1)} MB/s`;
  return ` · ${(bps / 1024).toFixed(0)} KB/s`;
}

updater.on('status', (message) => {
  // Não resetar a barra de progresso durante download de arquivo
  if (!_isDownloading) {
    updateProgress(0, message);
  } else {
    // Só atualiza o texto, mantém a barra onde está
    progressText.textContent = message;
  }
  console.log('[Updater]', message);
});

updater.on('check-progress', ({ checked, total, file, needsUpdate }) => {
  const percent = (checked / total) * 100;
  updateProgress(percent, `Verificando: ${checked}/${total} (${needsUpdate} para atualizar)`);
});

updater.on('download-progress', ({ file, downloadedFiles, totalFiles }) => {
  _isDownloading = false;
  const percent = totalFiles > 0 ? (downloadedFiles / totalFiles) * 100 : 0;
  updateProgress(percent, `Baixando: ${file} (${downloadedFiles}/${totalFiles})`);
});

let _totalReceived = 0;
updater.on('file-download-progress', ({ file, received, total, percent, downloadedFiles, totalFiles }) => {
  _isDownloading = true;
  _totalReceived += received;
  const speed = calcSpeed(_totalReceived);
  const speedStr = formatSpeed(speed);
  const dlInfo = totalFiles > 1 ? ` (${downloadedFiles}/${totalFiles})` : '';

  if (total > 0 && percent >= 0) {
    const eta = speed > 0 ? Math.round((total - received) / speed) : 0;
    const etaStr = eta > 5 ? ` · ~${eta < 60 ? eta + 's' : Math.round(eta/60) + 'min'}` : '';
    updateProgress(percent, `Baixando: ${file}${dlInfo} · ${percent}%${speedStr}${etaStr}`);
  } else {
    const fakePct = Math.min(95, Math.round((received / (500 * 1024 * 1024)) * 100));
    updateProgress(fakePct, `Baixando: ${file}${dlInfo} · ${formatBytes(received)}${speedStr}`);
  }
});

updater.on('error', (message) => {
  _isDownloading = false;
  console.error('[Updater Error]', message);
  updateProgress(0, `Erro: ${message}`);
  setTimeout(() => {
    hideProgress();
    setPlayButtonState('enabled', 'JOGAR');
  }, 3000);
});

updater.on('download-error', ({ file, message, status }) => {
  console.warn(`[Updater Download Error] ${message} (status: ${status})`);
});

updater.on('warning', (message) => {
  console.warn('[Updater Warning]', message);
});

updater.on('maintenance', (message) => {
  console.warn('[Updater] Manutenção:', message);
  updateProgress(0, `🔧 ${message}`);
  setPlayButtonState('disabled', 'MANUTENÇÃO');
  setTimeout(() => {
    hideProgress();
    setPlayButtonState('disabled', 'MANUTENÇÃO');
  }, 5000);
});

updater.on('server-message', (message) => {
  console.log('[Updater] Mensagem do servidor:', message);
});

updater.on('first-run', () => {
  updateProgress(0, 'Instalando jogo pela primeira vez...');
});

updater.on('complete', ({ updated, skipped, failed, failedFiles }) => {
  _isDownloading = false;
  if (skipped) {
    // hash.xml não mudou no servidor, pular verificação
    hideProgress();
    startGame();
    return;
  }

  if (failed && failed > 0) {
    // Não iniciar o jogo com falhas para evitar client corrompido em runtime.
    const failedNames = failedFiles ? failedFiles.map(f => f.file || f).join(', ') : '';
    const failedDetails = failedFiles
      ? failedFiles
          .slice(0, 2)
          .map(f => `${f.file || 'arquivo'} (${f.error || 'erro desconhecido'})`)
          .join(' | ')
      : '';
    updateProgress(100, `${updated} atualizados, ${failed} com erro: ${failedNames}${failedDetails ? ' -> ' + failedDetails : ''}`);
    console.error('[Updater] Arquivos com falha:', failedFiles);
    setTimeout(() => {
      hideProgress();
      setPlayButtonState('enabled', 'REPARAR');
    }, 5000);
    return;
  }

  if (updated > 0) {
    updateProgress(100, `${updated} arquivos atualizados!`);
  }
  setTimeout(() => {
    hideProgress();
    updatePlayButton();
    startGame();
  }, 1000);
});

// ==========================================
// Lógica do Jogo
// ==========================================
let isUpdating = false;

// Detecta se o jogo já está instalado
function getClientExe() {
  const pref = localStorage.getItem('tq-renderer') || 'dx';
  return pref === 'gl' ? 'PokeNight_GL.exe' : 'PokeNight_DX.exe';
}

function setRenderer(type) {
  localStorage.setItem('tq-renderer', type);
  document.getElementById('ren-dx').classList.toggle('active', type === 'dx');
  document.getElementById('ren-gl').classList.toggle('active', type === 'gl');
}

// Init renderer buttons
(function() {
  const pref = localStorage.getItem('tq-renderer') || 'dx';
  setRenderer(pref);
})();

function isGameInstalled() {
  const gamePath = updater.getGamePath();
  // Instalado se qualquer um dos exe existe
  return fs.existsSync(path.join(gamePath, 'PokeNight_DX.exe'))
      || fs.existsSync(path.join(gamePath, 'PokeNight_GL.exe'));
}

// Atualiza texto do botão baseado no estado
function updatePlayButton() {
  if (!isGameInstalled()) {
    setPlayButtonState('enabled', 'INSTALAR');
  } else {
    setPlayButtonState('enabled', 'JOGAR');
  }
}

async function startGame() {
  const gamePath = updater.getGamePath();
  const exeName = getClientExe();
  const exePath = path.join(gamePath, exeName);
  
  if (!fs.existsSync(exePath)) {
    // Tentar o outro exe como fallback
    const altExe = exeName === 'PokeNight_DX.exe' ? 'PokeNight_GL.exe' : 'PokeNight_DX.exe';
    const altPath = path.join(gamePath, altExe);
    if (fs.existsSync(altPath)) {
      setPlayButtonState('disabled', 'INICIANDO...');
      ipcRenderer.send('launch-game', altPath);
      setTimeout(() => setPlayButtonState('enabled', 'JOGAR'), 3000);
      return;
    }
    showProgress();
    updateProgress(0, 'Instalação incompleta. Clique novamente para instalar.');
    updatePlayButton();
    setTimeout(() => hideProgress(), 5000);
    return;
  }
  
  setPlayButtonState('disabled', 'INICIANDO...');
  ipcRenderer.send('launch-game', exePath);
  
  setTimeout(() => {
    setPlayButtonState('enabled', 'JOGAR');
  }, 3000);
}

async function checkAndUpdate(force = false) {
  if (isUpdating) return;
  
  isUpdating = true;
  showProgress();
  setPlayButtonState('disabled', 'ATUALIZANDO...');
  
  try {
    if (force) {
      await updater.forceUpdate();
    } else {
      await updater.update();
    }
  } catch (error) {
    console.error('Erro na atualização:', error);
  }
  
  isUpdating = false;
}

// Botão Jogar/Instalar
playBtn.addEventListener('click', () => {
  const currentText = playBtn.querySelector('.play-text')?.textContent || '';
  const forceRepair = currentText.toUpperCase().includes('REPARAR');
  checkAndUpdate(forceRepair);
});

// ==========================================
// Configurações - Selecionar pasta
// ==========================================
document.getElementById('btn-browse')?.addEventListener('click', async () => {
  const result = await ipcRenderer.invoke('select-folder');
  if (result && result.filePaths && result.filePaths[0]) {
    const selectedPath = result.filePaths[0];
    gamePathInput.value = selectedPath;
    updater.setGamePath(selectedPath);
    localStorage.setItem('gamePath', selectedPath);
  }
});

// Botão forçar verificação de arquivos
document.getElementById('btn-force-update')?.addEventListener('click', async () => {
  if (isUpdating) return;
  
  // Muda para aba principal para ver progresso
  navButtons.forEach(b => b.classList.remove('active'));
  document.querySelector('.top-nav [data-page="home"]')?.classList.add('active');
  pages.forEach(page => {
    page.classList.remove('active');
    if (page.id === 'page-home') page.classList.add('active');
  });

  isUpdating = true;
  showProgress();
  setPlayButtonState('disabled', 'VERIFICANDO...');
  
  try {
    await updater.forceUpdate();
  } catch (error) {
    console.error('Erro na verificação forçada:', error);
  }
  
  isUpdating = false;
});

// Botão instalar VC Redist
document.getElementById('btn-vcredist')?.addEventListener('click', () => {
  const btn = document.getElementById('btn-vcredist');
  const gamePath = updater.getGamePath();
  const vcPath = path.join(gamePath, 'vc_redist.x86.exe');

  if (!fs.existsSync(vcPath)) {
    btn.textContent = 'Não encontrado. Baixe o jogo primeiro.';
    setTimeout(() => { btn.textContent = 'Instalar VC Redist'; }, 4000);
    return;
  }

  btn.textContent = 'Instalando...';
  btn.disabled = true;

  const { exec } = require('child_process');
  exec(`powershell -Command "Start-Process -FilePath '${vcPath.replace(/'/g, "''")}' -ArgumentList '/install','/passive','/norestart' -Verb RunAs"`, (err) => {
    if (err) {
      btn.textContent = 'Cancelado ou erro';
      btn.disabled = false;
      setTimeout(() => { btn.textContent = 'Instalar VC Redist'; }, 4000);
    } else {
      btn.textContent = 'Instalando... aguarde o Windows';
      setTimeout(() => {
        btn.textContent = 'Instalar VC Redist';
        btn.disabled = false;
      }, 15000);
    }
  });
});

// ==========================================
// Links externos (URLs do config.js)
// ==========================================
const discordBtn = document.getElementById('btn-discord');
const siteBtn = document.getElementById('btn-site');
if (discordBtn) discordBtn.dataset.url = config.DISCORD_URL;
if (siteBtn) siteBtn.dataset.url = config.SITE_URL;

document.querySelectorAll('.social-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const url = btn.dataset.url;
    if (url) {
      ipcRenderer.send('open-external', url);
    }
  });
});

// ==========================================
// Auth & News System
// ==========================================
const news = new NewsManager();


// ==========================================
// Status do servidor (sempre online)
// ==========================================
function checkServerStatus() {
  const statusIndicator = document.querySelector('.status-indicator');
  const statusText = document.querySelector('.status-text');
  const playersOnline = document.querySelector('.players-online');

  if (statusIndicator) statusIndicator.classList.add('online');
  if (statusText) statusText.textContent = 'Online';
  if (playersOnline) playersOnline.textContent = 'Servidor disponível';
}

// ==========================================
// Inicialização
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  checkServerStatus();
  setInterval(checkServerStatus, 30000);
  updatePlayButton();
  news.init();

  // Renderer select (DX / GL)
  const rendererSelect = document.getElementById('renderer-select');
  if (rendererSelect) {
    rendererSelect.value = localStorage.getItem('tq-renderer') || 'dx';
    rendererSelect.addEventListener('change', (e) => {
      localStorage.setItem('tq-renderer', e.target.value);
    });
  }

  // Clickable panels -> open news detail
  document.querySelectorAll('[data-goto]').forEach(card => {
    card.addEventListener('click', () => {
      const postId = card.getAttribute('data-goto');
      // Navigate to news page then open detail
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('.nav-btn[data-page="news"]')?.classList.add('active');
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById('page-news')?.classList.add('active');
      // Trigger the news card
      const newsCard = document.querySelector(`.news-card[data-post="${postId}"]`);
      if (newsCard) newsCard.click();
    });
  });

  // Criar pasta do jogo se não existir
  const gamePath = updater.getGamePath();
  if (!fs.existsSync(gamePath)) {
    fs.mkdirSync(gamePath, { recursive: true });
  }

  // Se não está instalado, mostrar estado correto
  if (!isGameInstalled()) {
    console.log('[Launcher] Primeira execução - jogo será baixado do servidor');
  }
});

// Listener para quando o jogo iniciar
ipcRenderer.on('game-launched', (event, data) => {
  if (data.success) {
    console.log('Jogo iniciado!');
    const closeOnLaunch = document.getElementById('close-on-launch')?.checked;
    if (closeOnLaunch) {
      setTimeout(() => {
        ipcRenderer.send('close-window');
      }, 1000);
    }
  }
});

// ==========================================
// Comments System (JSON/SFTP)
// ==========================================

// News posts metadata
const NEWS_POSTS = {
  pvp: {
    title: 'PVP Casual & Ranked — Picks, Bans e Elos!',
    date: '05 Mar 2026',
    tag: 'Novo Sistema',
    image: '../assets/cliente/updates/03/pvp_ranked_tamer_quest.png',
    text: 'O novo sistema de PVP do Tamer Quest já está no ar! No modo Casual, você pode batalhar sem pressão e testar suas estratégias. No modo Ranked, a competição é real: picks e bans estratégicos, novo balanceamento completo e um sistema de Elos para você subir e provar seu valor. Mostre que você é o melhor Tamer do servidor!',
    emblems: []
  },
  beta3: {
    title: 'Beta 3 — Uma Nova Era Começa!',
    date: '05 Mar 2026',
    tag: 'Atualização',
    image: '../assets/cliente/updates/02/beta_3.png',
    text: 'O Beta 3 do Tamer Quest chegou com mudanças profundas! Novo launcher, novo client, novas mecânicas e muito mais conteúdo. Estamos apenas começando — aguardem grandes novidades nas próximas semanas. Preparem-se, Tamers!',
    emblems: []
  },
  beta1e2: {
    title: 'Fim do Beta 1 & Beta 2 — Obrigado!',
    date: '27 Fev 2026',
    tag: 'Encerramento',
    image: '../assets/cliente/updates/01/evento1k.png',
    text: 'Encerramos oficialmente as fases Beta 1 e Beta 2 do Tamer Quest. Foram meses incríveis de testes, feedback e evolução. Agradecemos a cada jogador que participou, reportou bugs e nos ajudou a construir algo melhor. Vocês são a base de tudo. O que vem a seguir vai surpreender!',
    emblems: [
      '../assets/emblems/beta1e2/emblem_first_32x32_sheet_1.png',
      '../assets/emblems/beta1e2/emblem_first_32x32_sheet_2.png'
    ]
  }
};

let commentsData = {};
let currentPostId = null;
let currentCommentType = 'comment';

// ---- Auth UI ----
function updateAuthUI() {
  const cfBox = document.getElementById('cf-box');
  const cfHint = document.getElementById('cf-login-hint');
  if (cfBox) cfBox.style.display = 'none';
  if (cfHint) cfHint.style.display = 'none';
}

// ---- Comments ----
async function loadComments() {
  try {
    commentsData = await ipcRenderer.invoke('comments-load');
  } catch (e) {
    console.error('[Comments] Erro ao carregar:', e);
    commentsData = {};
  }
  updateFeedStats();
}

function updateFeedStats() {
  Object.keys(NEWS_POSTS).forEach(postId => {
    const post = commentsData[postId] || { likes: [], comments: [] };
    document.querySelectorAll(`.ns-likes[data-post="${postId}"] .lk-count`).forEach(el => {
      el.textContent = post.likes ? post.likes.length : 0;
    });
    document.querySelectorAll(`.ns-comments[data-post="${postId}"] .cm-count`).forEach(el => {
      el.textContent = post.comments ? post.comments.length : 0;
    });
  });
}

// ---- News Detail ----
function openDetail(postId) {
  const post = NEWS_POSTS[postId];
  if (!post) return;

  currentPostId = postId;

  // Switch views
  document.getElementById('news-feed-view').style.display = 'none';
  document.getElementById('news-detail-view').style.display = '';

  // Render image
  const imgWrap = document.getElementById('detail-img-wrap');
  imgWrap.innerHTML = `<img src="${post.image}" alt="${post.title}">`;

  // Render text
  const textEl = document.getElementById('detail-text');
  textEl.innerHTML = `
    <h2>${post.title}</h2>
    <div class="detail-meta">${post.date} · ${post.tag}</div>
    <p>${post.text}</p>
  `;

  // Emblems (sprite sheets: 12 frames, 32x32 each)
  const embEl = document.getElementById('detail-emblems');
  if (post.emblems && post.emblems.length > 0) {
    embEl.style.display = 'flex';
    embEl.innerHTML = '<span class="detail-emblems-title">Recompensas</span>' +
      post.emblems.map(src => `<div class="emblem-sprite" style="background-image:url('${src}')"></div>`).join('');
  } else {
    embEl.style.display = 'none';
  }

  // Like state
  updateDetailLike();

  // Comments
  renderComments();

  // Auth-dependent UI
  updateAuthUI();

  // Scroll to top
  document.querySelector('#page-news .page-inner')?.scrollTo(0, 0);
}

function closeDetail() {
  currentPostId = null;
  document.getElementById('news-detail-view').style.display = 'none';
  document.getElementById('news-feed-view').style.display = '';
  updateFeedStats();
}

function updateDetailLike() {
  if (!currentPostId) return;
  const post = commentsData[currentPostId] || { likes: [], comments: [] };
  const btn = document.getElementById('btn-like');
  const count = document.getElementById('detail-like-count');
  if (count) count.textContent = post.likes ? post.likes.length : 0;
  if (btn) btn.querySelector('.like-heart').textContent = '\u2661';
}

function renderComments() {
  if (!currentPostId) return;
  const post = commentsData[currentPostId] || { likes: [], comments: [] };
  const list = document.getElementById('comments-list');
  const countEl = document.getElementById('detail-cm-count');

  countEl.textContent = post.comments ? post.comments.length : 0;

  if (!post.comments || post.comments.length === 0) {
    list.innerHTML = '<div class="comments-empty">Nenhum comentário ainda. Seja o primeiro!</div>';
    return;
  }

  // Most recent first
  list.innerHTML = [...post.comments].reverse().map(c => {
    const initial = c.character ? c.character.charAt(0).toUpperCase() : '?';
    const badgeClass = c.type === 'suggestion' ? 'suggestion' : 'comment-badge';
    const badgeLabel = c.type === 'suggestion' ? 'Sugestão' : 'Comentário';
    const badge = `<span class="comment-type-badge ${badgeClass}">${badgeLabel}</span>`;
    const time = timeAgo(c.timestamp);

    return `
      <div class="comment-item">
        <div class="comment-avatar">${initial}</div>
        <div class="comment-info">
          <div class="comment-header">
            <span class="comment-name">${escapeHtml(c.character)}</span>
            <span class="comment-level">Lv ${c.level || '?'}</span>
            ${badge}
          </div>
          <div class="comment-body">${escapeHtml(c.text)}</div>
          <div class="comment-time">${time}</div>
        </div>
      </div>
    `;
  }).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str || ''));
  return div.innerHTML;
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

// ---- Event: Click cards ----
document.querySelectorAll('.news-card[data-post]').forEach(card => {
  card.addEventListener('click', () => {
    openDetail(card.dataset.post);
  });
});

// Back button
document.getElementById('btn-news-back')?.addEventListener('click', closeDetail);

// Like button
document.getElementById('btn-like')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-like');
  btn.disabled = true;
  try {
    const result = await ipcRenderer.invoke('comments-like', { postId: currentPostId, characterName: 'anon' });
    if (result.success) { commentsData = result.data; updateDetailLike(); }
  } catch (e) { console.error('[Like] Error:', e); }
  btn.disabled = false;
});

// Comment type tabs
document.querySelectorAll('.cf-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.cf-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentCommentType = tab.dataset.type;
  });
});

// Submit comment
document.getElementById('cf-submit')?.addEventListener('click', async () => {
  if (!auth.isLoggedIn()) return;

  const sel = auth.getSelectedCharacter();
  const textEl = document.getElementById('cf-text');
  const text = textEl.value.trim();
  if (!sel || !text || !currentPostId) return;

  const submitBtn = document.getElementById('cf-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Enviando...';

  const comment = {
    id: `${Date.now()}_${sel.name.replace(/\s+/g, '_')}`,
    character: sel.name,
    level: sel.level || 0,
    text: text,
    timestamp: Date.now(),
    type: currentCommentType
  };

  try {
    const result = await ipcRenderer.invoke('comments-add', {
      postId: currentPostId,
      comment: comment
    });
    if (result.success) {
      commentsData = result.data;
      textEl.value = '';
      renderComments();
      updateDetailLike();
    }
  } catch (e) {
    console.error('[Comment] Error:', e);
  }

  submitBtn.disabled = false;
  submitBtn.textContent = 'Enviar';
});

// ---- Init comments ----
loadComments();
