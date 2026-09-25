const fs = require('fs');

function createDeviceService() {
  function stateOf(d) {
    return {
      pending: d.pending && { name: d.pending.name },
    };
  }

  function dropPending(d) {
    if (d.pending) fs.unlink(d.pending.file, () => {});
    d.pending = null;
  }

  return {
    stateOf,
    dropPending,
  };
}

module.exports = createDeviceService;
