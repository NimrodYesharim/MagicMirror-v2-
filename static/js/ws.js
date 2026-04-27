/**
 * WebSocket client with automatic reconnect and exponential backoff.
 * Dispatches typed messages to registered handlers.
 */
const WS = (() => {
  const handlers = {};
  let socket = null;
  let retryDelay = 1000;

  function connect() {
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${wsProto}//${location.host}/ws`);

    socket.onopen = () => {
      retryDelay = 1000;
      console.log('[WS] connected');
      (handlers['open'] || []).forEach(fn => fn());
    };

    socket.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      const fns = handlers[msg.type] || [];
      fns.forEach(fn => fn(msg.data));
    };

    socket.onclose = () => {
      console.warn(`[WS] closed — reconnecting in ${retryDelay}ms`);
      (handlers['close'] || []).forEach(fn => fn());
      setTimeout(() => {
        retryDelay = Math.min(retryDelay * 2, 30000);
        connect();
      }, retryDelay);
    };

    socket.onerror = () => socket.close();
  }

  return {
    start: connect,
    on(type, fn) {
      if (!handlers[type]) handlers[type] = [];
      handlers[type].push(fn);
    },
  };
})();
