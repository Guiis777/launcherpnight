// ==========================================
// Autenticação — TamerQuest
// POST /accounts/authentication.php → login + personagens
// GET  /management/Characters/Character.php → detalhes
// ==========================================
const config = require('./config');

const API_BASE = config.API_BASE;
const API_KEY  = config.API_KEY;

class Auth {
  constructor() {
    this.session = null;
    this.account = null;
    this.characters = [];
    this.selectedCharacter = null;
    this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem('tq_auth');
      if (!raw) return;
      const d = JSON.parse(raw);
      // Session expira em 24h
      if (d.loginAt && (Date.now() - d.loginAt) > 24 * 3600 * 1000) {
        this.logout();
        return;
      }
      this.session = d.session;
      this.account = d.account;
      this.characters = d.characters || [];
      this.selectedCharacter = d.selectedCharacter || (this.characters[0] || null);
    } catch (_) { this.logout(); }
  }

  _save() {
    localStorage.setItem('tq_auth', JSON.stringify({
      session: this.session,
      account: this.account,
      characters: this.characters,
      selectedCharacter: this.selectedCharacter,
      loginAt: Date.now()
    }));
  }

  isLoggedIn()           { return !!this.session; }
  getSession()           { return this.session; }
  getAccount()           { return this.account; }
  getCharacters()        { return this.characters; }
  getSelectedCharacter() { return this.selectedCharacter; }

  selectCharacter(name) {
    this.selectedCharacter = this.characters.find(c => c.name === name) || null;
    this._save();
  }

  async login(email, password) {
    const res = await fetch(`${API_BASE}/accounts/authentication.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userAccount: email, password, bearer: API_KEY })
    });
    const data = await res.json();

    if (data.errorMessage) {
      return { success: false, error: data.errorMessage };
    }

    this.session = data.session;
    this.account = data.account;
    this.characters = data.body || [];

    // Buscar personagens detalhados (looktype, town, etc.)
    try {
      const detail = await fetch(`${API_BASE}/management/Characters/Character.php`, {
        headers: { 'Authorization': `Bearer ${this.session}` }
      });
      const dd = await detail.json();
      if (dd.body) this.characters = dd.body;
      if (dd.account) this.account = { ...this.account, ...dd.account };
    } catch (_) {}

    // Auto-selecionar primeiro personagem
    if (this.characters.length > 0) {
      this.selectedCharacter = this.characters[0];
    }

    this._save();
    return { success: true };
  }

  logout() {
    this.session = null;
    this.account = null;
    this.characters = [];
    this.selectedCharacter = null;
    localStorage.removeItem('tq_auth');
  }
}

module.exports = Auth;
