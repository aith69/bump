const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LOCALES_DIR = path.join(__dirname, '..', 'src', 'locales');
const TRANSLATIONS_DIR = path.join(LOCALES_DIR, 'translations');
const CONFIG_FILE = path.join(LOCALES_DIR, 'config.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('locale configuration is valid', () => {
  const config = readJson(CONFIG_FILE);

  assert.equal(typeof config.fallback, 'string');
  assert.ok(Array.isArray(config.available));
  assert.ok(config.available.length > 0);
  assert.ok(config.available.includes(config.fallback));

  assert.equal(
    new Set(config.available).size,
    config.available.length,
    'available contiene locali duplicati'
  );
});

test('translation files match configured locales', () => {
  const config = readJson(CONFIG_FILE);

  const files = fs.readdirSync(TRANSLATIONS_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -5));

  const configured = new Set(config.available);

  assert.equal(
    files.length,
    configured.size,
    'numero di file diverso dal numero di locali configurati'
  );

  for (const locale of config.available) {
    assert.ok(
      files.includes(locale),
      `file mancante: ${locale}.json`
    );
  }

  for (const locale of files) {
    assert.ok(
      configured.has(locale),
      `file non dichiarato in config.json: ${locale}.json`
    );
  }
});

test('all translations use the same keys as fallback', () => {
  const config = readJson(CONFIG_FILE);

  const fallback = readJson(
    path.join(TRANSLATIONS_DIR, `${config.fallback}.json`)
  );

  const referenceKeys = Object.keys(fallback).sort();

  for (const locale of config.available) {
    const translation = readJson(
      path.join(TRANSLATIONS_DIR, `${locale}.json`)
    );

    assert.deepStrictEqual(
      Object.keys(translation).sort(),
      referenceKeys,
      `${locale}.json ha chiavi diverse dal fallback ${config.fallback}.json`
    );
  }
});

test('shareValidFor contains the time placeholder in every locale', () => {
  const config = readJson(CONFIG_FILE);

  for (const locale of config.available) {
    const translation = readJson(
      path.join(TRANSLATIONS_DIR, `${locale}.json`)
    );

    assert.equal(
      typeof translation.shareValidFor,
      'string',
      `${locale}.json: shareValidFor non è una stringa`
    );

    assert.ok(
      translation.shareValidFor.includes('{time}'),
      `${locale}.json: shareValidFor non contiene {time}`
    );
  }
});
