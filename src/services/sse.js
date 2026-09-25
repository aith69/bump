function createSse() {
  function send(d, event, data) {
    if (d.res) {
      d.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  }

  return {
    send,
  };
}

module.exports = createSse;
