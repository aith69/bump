(() => {
  async function loadConfig() {
    const response = await fetch('/locales/config.json', {
      cache: 'no-cache',
    });

    if (!response.ok) {
      throw new Error('Unable to load locale configuration');
    }

    return response.json();
  }

  function getLocale(languages, available, fallback) {
    const normalized = new Map(
      available.map((locale) => [locale.toLowerCase(), locale])
    );

    for (const language of languages) {
      const value = String(language).toLowerCase();

      // Prima prova la lingua completa, ad esempio pt-br o zh-tw.
      const exact = normalized.get(value);
      if (exact) return exact;

      // Poi prova la lingua base, ad esempio en-us -> en.
      const base = value.split('-')[0];
      const baseLocale = normalized.get(base);
      if (baseLocale) return baseLocale;
    }

    return fallback;
  }

  async function loadLocale(locale) {
    const response = await fetch(`/locales/${locale}.json`, {
      cache: 'no-cache',
    });

    if (!response.ok) {
      throw new Error(`Unable to load locale: ${locale}`);
    }

    return response.json();
  }

  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach((element) => {
      element.textContent = window.t(element.dataset.i18n);
    });

    document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
      element.setAttribute(
        'aria-label',
        window.t(element.dataset.i18nAriaLabel)
      );
    });
  }

  async function init() {
    const config = await loadConfig();

    if (!config.fallback) {
      throw new Error('Locale configuration: fallback mancante');
    }

    if (!Array.isArray(config.available) || config.available.length === 0) {
      throw new Error('Locale configuration: available mancante o vuoto');
    }

    if (!config.available.includes(config.fallback)) {
      throw new Error(
        `Locale configuration: fallback "${config.fallback}" non presente in available`
      );
    }

    const languages = navigator.languages?.length
      ? navigator.languages
      : [navigator.language];

    let locale = getLocale(
      languages,
      config.available,
      config.fallback
    );

    let strings;

    try {
      strings = await loadLocale(locale);
    } catch {
      locale = config.fallback;
      strings = await loadLocale(config.fallback);
    }

    document.documentElement.lang = locale;

    window.t = (key, values = {}) => {
      let text = strings[key] ?? key;

      for (const [name, value] of Object.entries(values)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }

      return text;
    };

    applyTranslations();

    const configResponse = await fetch('/config', {
      cache: 'no-cache',
    });

    if (!configResponse.ok) {
      throw new Error('Unable to load application configuration');
    }

    window.appConfig = await configResponse.json();

    if (
      !Number.isInteger(window.appConfig.maxBytes) ||
      window.appConfig.maxBytes <= 0 ||
      !Number.isInteger(window.appConfig.shareTtl) ||
      window.appConfig.shareTtl <= 0
    ) {
      throw new Error('Invalid application configuration');
    }

    const script = document.createElement('script');
    script.src = '/js/app.js';
    document.body.appendChild(script);
  }

  init().catch((err) => {
    console.error('Unable to initialize localization:', err);
  });
})();
