function createRateLimiter(hits) {
  return function limited(kind, ip, max, windowMs) {
    const key = `${kind}:${ip}`;
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    const over = list.length >= max;

    if (!over) list.push(now);

    hits.set(key, list);
    return over;
  };
}

module.exports = createRateLimiter;
