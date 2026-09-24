(() => {
  const supported = ['it', 'en'];
  const fallback = 'it';

  function getLocale() {
    const languages = navigator.languages?.length
      ? navigator.languages
      : [navigator.language];

    for (const language of languages) {
      const locale = language.toLowerCase().split('-')[0];
      if (supported.includes(locale)) return locale;
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
    let locale = getLocale();
    let strings;

    try {
      strings = await loadLocale(locale);
    } catch {
      locale = fallback;
      strings = await loadLocale(fallback);
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

    const script = document.createElement('script');
    script.src = '/js/app.js';
    document.body.appendChild(script);
  }

  init().catch((err) => {
    console.error('Unable to initialize localization:', err);
  });
})();
