// ==========================================
// News Manager — TamerQuest Launcher
// Feed, Detail, Comments, Likes, Suggestions
// Uses IPC → main.js → SFTP (comments.json)
// ==========================================

const { ipcRenderer } = require('electron');

class NewsManager {
  constructor(auth) {
    this.auth = auth;
    this.newsItems = [];
    this.serverData = {};          // { postId: { likes:[], comments:[] } }
    this.currentView = 'feed';
    this.currentDetailId = null;
    this.onRequestLogin = null;    // callback
  }

  async init() {
    try {
      this.newsItems = require('./news-config.json');
    } catch (e) {
      console.error('[News] Falha ao carregar config:', e);
      this.newsItems = [];
    }
    await this.fetchServerData();
    this.renderFeed();
  }

  async fetchServerData() {
    try {
      this.serverData = await ipcRenderer.invoke('comments-load');
    } catch (e) {
      console.warn('[News] Sem dados do servidor:', e.message);
      this.serverData = {};
    }
  }

  // ---- Helpers ----

  _post(newsId) {
    return this.serverData[newsId] || { likes: [], comments: [] };
  }

  getLikeCount(newsId) {
    return this._post(newsId).likes.length;
  }

  isLiked(newsId) {
    const char = this.auth.getSelectedCharacter();
    if (!char) return false;
    return this._post(newsId).likes.includes(char.name);
  }

  getComments(newsId) {
    const comments = this._post(newsId).comments || [];
    return [...comments].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  getNewsById(id) {
    return this.newsItems.find(n => n.id === id);
  }

  // ---- Render Feed ----

  renderFeed() {
    const container = document.getElementById('news-feed');
    const feedView = document.getElementById('news-feed-view');
    const detailView = document.getElementById('news-detail-view');
    if (!container) return;

    container.innerHTML = this.newsItems.map(item => {
      const likes = this.getLikeCount(item.id);
      const comments = this.getComments(item.id).length;
      const suggestions = this.getComments(item.id).filter(c => c.type === 'suggestion').length;

      return `
        <article class="news-card ${item.featured ? 'news-featured' : ''}" data-news-id="${item.id}">
          <div class="news-card-image">
            <img src="${item.image}" alt="${esc(item.title)}" class="news-image" onerror="this.style.opacity='0.3'">
            ${item.badge ? `<div class="news-badge">${item.badge}</div>` : ''}
          </div>
          <div class="news-body">
            <div class="news-meta">
              <span class="news-date">${item.date}</span>
              <span class="news-tag">${item.tag}</span>
            </div>
            <h3 class="news-heading">${esc(item.title)}</h3>
            <p class="news-excerpt">${esc(item.excerpt)}</p>
            <div class="news-stats">
              <span class="news-stat">${likes} curtidas</span>
              <span class="news-stat">${comments} comentários</span>
              ${suggestions > 0 ? `<span class="news-stat">${suggestions} sugestões</span>` : ''}
              <span class="news-read-more">Ver detalhes \u2192</span>
            </div>
            <div class="news-footer">
              <span class="news-author">${esc(item.author)}</span>
            </div>
          </div>
        </article>`;
    }).join('');

    // Click handlers
    container.querySelectorAll('.news-card').forEach(card => {
      card.addEventListener('click', () => this.showDetail(card.dataset.newsId));
    });

    if (feedView) feedView.style.display = 'block';
    if (detailView) detailView.style.display = 'none';
    this.currentView = 'feed';
  }

  // ---- Render Detail ----

  showDetail(newsId) {
    const item = this.getNewsById(newsId);
    if (!item) return;

    const feedView = document.getElementById('news-feed-view');
    const detailView = document.getElementById('news-detail-view');
    if (!feedView || !detailView) return;

    const likes = this.getLikeCount(newsId);
    const liked = this.isLiked(newsId);
    const comments = this.getComments(newsId);
    const isLoggedIn = this.auth.isLoggedIn();
    const charName = this.auth.getSelectedCharacter()?.name || '';

    // Emblems
    let emblemsHtml = '';
    if (item.emblems && item.emblems.length > 0) {
      emblemsHtml = `
        <div class="detail-section">
          <h4 class="detail-section-title">Recompensas</h4>
          <div class="emblems-grid">
            ${item.emblems.map(e => `
              <div class="emblem-item">
                <div class="emblem-sprite" style="background-image:url('${e.image}')"></div>
                <span class="emblem-name">${esc(e.name)}</span>
              </div>
            `).join('')}
          </div>
          <div class="reward-claim-box">
            <p class="reward-claim-msg">Você poderá resgatar essas recompensas depois de completar os desafios.</p>
            <button class="reward-challenges-btn" onclick="document.querySelector('.challenges-locked-msg').style.display='flex'">Ver Desafios</button>
          </div>
          <div class="challenges-locked-msg" style="display:none">
            <span class="locked-icon">&#128274;</span>
            <p class="locked-text">Os desafios serão liberados no <strong>Beta 3</strong>. Fique ligado!</p>
            <button class="locked-close-btn" onclick="this.parentElement.style.display='none'">Entendi</button>
          </div>
        </div>`;
    }

    // Comments
    const commentsList = comments.map(c => {
      const initial = c.character ? c.character.charAt(0).toUpperCase() : '?';
      return `
      <div class="comment-item ${c.type === 'suggestion' ? 'is-suggestion' : ''}">
        <div class="comment-avatar">${initial}</div>
        <div class="comment-info">
          <div class="comment-header">
            <span class="comment-char">${esc(c.character)}</span>
            <span class="comment-level">Lv ${c.level || '?'}</span>
            ${c.type === 'suggestion' ? '<span class="comment-type-tag">Sugestão</span>' : ''}
            <span class="comment-time">${timeAgo(c.timestamp)}</span>
          </div>
          <p class="comment-text">${esc(c.text)}</p>
        </div>
      </div>`;
    }).join('') || '<p class="comments-empty">Nenhum comentário ainda. Seja o primeiro!</p>';

    // Comment form
    let formHtml;
    if (isLoggedIn) {
      formHtml = `
        <div class="comment-form">
          <div class="comment-as">Comentando como <strong>${esc(charName)}</strong></div>
          <textarea class="comment-input" id="detail-comment-text" placeholder="Escreva um comentário ou sugestão..." maxlength="500" rows="3"></textarea>
          <div class="comment-form-bar">
            <select class="comment-type-sel" id="detail-comment-type">
              <option value="comment">Comentário</option>
              <option value="suggestion">Sugestão</option>
            </select>
            <button class="btn-gold-sm" id="btn-send-comment" data-news="${newsId}">Enviar</button>
          </div>
        </div>`;
    } else {
      formHtml = `
        <div class="comment-login-prompt">
          <span>Faça login para curtir, comentar e enviar sugestões.</span>
          <button class="btn-gold-sm" id="btn-detail-login">Entrar</button>
        </div>`;
    }

    detailView.innerHTML = `
      <div class="detail-top-bar">
        <button class="detail-back" id="btn-back-feed">\u2190 Voltar</button>
      </div>

      <div class="detail-card">
        <img src="${item.image}" alt="${esc(item.title)}" class="detail-hero" onerror="this.style.display='none'">
        <div class="detail-body">
          <div class="news-meta">
            <span class="news-date">${item.date}</span>
            <span class="news-tag">${item.tag}</span>
          </div>
          <h2 class="detail-title">${esc(item.title)}</h2>
          <div class="detail-text">${item.content.replace(/\n/g, '<br>')}</div>
          <div class="detail-author">\u2014 ${esc(item.author)}</div>
        </div>
      </div>

      ${emblemsHtml}

      <div class="detail-section">
        <div class="detail-actions-bar">
          <button class="like-btn ${liked ? 'liked' : ''}" id="btn-like" data-news="${newsId}">
            <span class="like-heart">${liked ? '\u2764' : '\u2661'}</span>
            <span class="like-num" id="like-count">${likes}</span>
            Curtir
          </button>
          <span class="detail-comment-count">${comments.length} comentário${comments.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <div class="detail-section">
        <h4 class="detail-section-title">Comentários & Sugestões</h4>
        ${formHtml}
        <div class="comments-list" id="comments-list">
          ${commentsList}
        </div>
      </div>
    `;

    // Wire events
    document.getElementById('btn-back-feed')?.addEventListener('click', () => this.renderFeed());
    document.getElementById('btn-like')?.addEventListener('click', () => this.toggleLike(newsId));
    document.getElementById('btn-send-comment')?.addEventListener('click', () => {
      const text = document.getElementById('detail-comment-text')?.value;
      const type = document.getElementById('detail-comment-type')?.value || 'comment';
      if (text?.trim()) this.postComment(newsId, text.trim(), type);
    });
    document.getElementById('btn-detail-login')?.addEventListener('click', () => {
      if (this.onRequestLogin) this.onRequestLogin();
    });

    feedView.style.display = 'none';
    detailView.style.display = 'block';
    this.currentView = 'detail';
    this.currentDetailId = newsId;
    document.querySelector('.content')?.scrollTo(0, 0);
  }

  // ---- Actions ----

  async toggleLike(newsId) {
    if (!this.auth.isLoggedIn()) {
      if (this.onRequestLogin) this.onRequestLogin();
      return;
    }
    const char = this.auth.getSelectedCharacter();
    if (!char) return;

    try {
      const result = await ipcRenderer.invoke('comments-like', {
        postId: newsId,
        characterName: char.name
      });
      if (result.success) {
        this.serverData = result.data;
        this.showDetail(newsId);
      } else {
        console.error('[News] Like error:', result.error);
      }
    } catch (e) {
      console.error('[News] Like failed:', e);
    }
  }

  async postComment(newsId, text, type = 'comment') {
    if (!this.auth.isLoggedIn()) return;
    const char = this.auth.getSelectedCharacter();
    if (!char) return;

    const btn = document.getElementById('btn-send-comment');
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

    const comment = {
      id: `${Date.now()}_${char.name.replace(/\s+/g, '_')}`,
      character: char.name,
      level: char.level || 0,
      text: text,
      timestamp: Date.now(),
      type: type
    };

    try {
      const result = await ipcRenderer.invoke('comments-add', {
        postId: newsId,
        comment: comment
      });
      if (result.success) {
        this.serverData = result.data;
        this.showDetail(newsId);
      } else {
        console.error('[News] Comment error:', result.error);
      }
    } catch (e) {
      console.error('[News] Comment failed:', e);
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar'; }
  }

  // Refresh when auth state changes
  onAuthChanged() {
    if (this.currentView === 'detail' && this.currentDetailId) {
      this.showDetail(this.currentDetailId);
    } else {
      this.renderFeed();
    }
  }
}

// Utils
function esc(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

module.exports = NewsManager;
