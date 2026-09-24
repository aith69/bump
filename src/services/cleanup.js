function createCleanup({
  devices,
  hits,
  ttl,
  intervalMs,
  stateOf,
  dropPending,
  send,
}) {
  return setInterval(() => {
    const now = Date.now();

    for (const [id, d] of devices) {
      if (d.pending && now - d.pending.ts > ttl) {
        dropPending(d);
        send(d, 'state', stateOf(d));
      }

      if (d.res) {
        d.res.write(': ping\n\n');
      } else if (!d.pending && !d.uploading) {
        devices.delete(id);
      }
    }

    for (const [k, list] of hits) {
      if (now - list[list.length - 1] > 10 * 60 * 1000) {
        hits.delete(k);
      }
    }
  }, intervalMs);
}

module.exports = createCleanup;
