const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const DIR = path.join(__dirname, '..', 'tmp');

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 20;
const MAX_FILES_PER_IP = 3;
const MAX_STREAMS_PER_IP = 10;

const PAIR_WINDOW = 300;
const SETTLE = 500;
const LOOKBACK = PAIR_WINDOW + SETTLE;

const TTL = 5 * 60 * 1000;
const TOKEN_TTL = 30 * 1000;
const SHARE_TTL = 3 * 60 * 1000;

module.exports = {
  PORT,
  HOST,
  DIR,
  MAX_BYTES,
  MAX_FILES,
  MAX_FILES_PER_IP,
  MAX_STREAMS_PER_IP,
  PAIR_WINDOW,
  SETTLE,
  LOOKBACK,
  TTL,
  TOKEN_TTL,
  SHARE_TTL,
};
