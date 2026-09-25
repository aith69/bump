const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'locales', 'config.json');
const SOURCE_DIR = path.join(__dirname, '..', 'locales', 'translations');
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public', 'locales');

function prepareLocales() {
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

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

  fs.rmSync(PUBLIC_DIR, { recursive: true, force: true });
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });

  for (const locale of config.available) {
    const sourceFile = path.join(SOURCE_DIR, `${locale}.json`);
    const publicFile = path.join(PUBLIC_DIR, `${locale}.json`);

    if (!fs.existsSync(sourceFile)) {
      throw new Error(
        `File di traduzione mancante per il locale configurato: ${locale}`
      );
    }

    const translation = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));

    fs.writeFileSync(
      publicFile,
      `${JSON.stringify(translation, null, 2)}\n`,
      'utf8'
    );
  }

  fs.writeFileSync(
    path.join(PUBLIC_DIR, 'config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8'
  );

  console.log(
    `Localizzazioni preparate: ${config.available.length} lingue, fallback "${config.fallback}"`
  );

  return config;
}

module.exports = prepareLocales;
