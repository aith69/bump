window.createWebrtcFallback = function ({
  timeout,
  hasUrl,
  isChannelOpen,
  isTransferActive,
  isTransferComplete,
  fallback,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer = null;

  function cancel() {
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
  }

  function arm() {
    if (!hasUrl() || isChannelOpen()) return;

    cancel();

    timer = setTimer(() => {
      timer = null;

      if (
        isChannelOpen() ||
        isTransferActive() ||
        isTransferComplete()
      ) {
        return;
      }

      fallback();
    }, timeout);
  }

  return {
    arm,
    cancel,
  };
};
