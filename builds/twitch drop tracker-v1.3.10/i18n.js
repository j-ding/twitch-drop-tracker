/**
 * i18n — Lightweight translation module.
 * Loads locale JSON bundled with the extension (no external requests).
 */
const i18n = (() => {
  const RTL = new Set(['ar', 'fa']);
  let strings = {};
  let en = {};

  async function load(lang) {
    try {
      const r = await fetch(chrome.runtime.getURL(`locales/${lang}.json`));
      strings = r.ok ? await r.json() : {};
    } catch { strings = {}; }

    if (lang !== 'en') {
      try {
        const r = await fetch(chrome.runtime.getURL('locales/en.json'));
        en = r.ok ? await r.json() : {};
      } catch { en = {}; }
    } else {
      en = {};
    }

    document.documentElement.dir = RTL.has(lang) ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    applyDOM();
  }

  function t(key, vars = {}) {
    let s = strings[key] ?? en[key] ?? key;
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
    return s;
  }

  function applyDOM() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = t(el.dataset.i18nTitle);
    });
  }

  async function init() {
    const { language = 'en' } = await chrome.storage.local.get(['language']);
    await load(language);
    return language;
  }

  async function setLanguage(lang) {
    await chrome.storage.local.set({ language: lang });
    window.location.reload();
  }

  return { init, t, applyDOM, setLanguage };
})();

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'ru', name: 'Русский' },
  { code: 'de', name: 'Deutsch' },
  { code: 'ja', name: '日本語' },
  { code: 'fr', name: 'Français' },
  { code: 'pt', name: 'Português' },
  { code: 'zh', name: '中文' },
  { code: 'it', name: 'Italiano' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'fa', name: 'فارسی' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'pl', name: 'Polski' },
  { code: 'ar', name: 'العربية' },
  { code: 'ko', name: '한국어' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'cs', name: 'Čeština' },
  { code: 'hi', name: 'हिंदी' },
  { code: 'th', name: 'ภาษาไทย' }
];

window.t = (key, vars) => i18n.t(key, vars);
