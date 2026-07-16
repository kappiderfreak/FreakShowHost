// Local renderer for tawmae.xyz GIPHY & SB events inside the transparent overlay.
(function () {
  'use strict';

  if (window.__KAPPI_GIPHY_SB_LOCAL_ACTIVE__) return;
  window.__KAPPI_GIPHY_SB_LOCAL_ACTIVE__ = true;

  var CONFIG = {
    host: '127.0.0.1',
    port: 8081,
    monitorPreset: 'auto',
    monitorWidth: 1920,
    monitorHeight: 1080,
    overlaysEnabled: true,
    reconnectMs: 4000,
    attachClientWaitMs: 5000,
    maxGifsDefault: 6,
    defaultWidth: 320,
    defaultHeight: 240,
    defaultDuration: 5000,
    defaultVolume: 0.5
  };

  var state = {
    connectedClient: false,
    connectedRaw: false,
    rawSocket: null,
    reconnectTimer: null,
    clientAttachTimer: null,
    seen: {},
    activeGifs: 0,
    centeredActive: false,
    queue: [],
    lastEvent: null,
    lastError: null
  };

  function log(message, obj) {
    if (window.console && console.log) console.log('[Kappi GIPHY & SB]', message, obj || '');
  }

  function warn(message, obj) {
    state.lastError = obj || message;
    if (window.console && console.warn) console.warn('[Kappi GIPHY & SB]', message, obj || '');
  }

  function getConnection() {
    var cfg = window.KappiOverlayConfig && typeof window.KappiOverlayConfig.get === 'function'
      ? window.KappiOverlayConfig.get()
      : (window.KAPPI_OVERLAY_CONFIG || {});
    CONFIG.host = cfg.host || CONFIG.host;
    CONFIG.port = parseInt(cfg.port || CONFIG.port, 10) || CONFIG.port;
    CONFIG.monitorPreset = cfg.monitorPreset || CONFIG.monitorPreset;
    CONFIG.monitorWidth = parseInt(cfg.monitorWidth || CONFIG.monitorWidth, 10) || CONFIG.monitorWidth;
    CONFIG.monitorHeight = parseInt(cfg.monitorHeight || CONFIG.monitorHeight, 10) || CONFIG.monitorHeight;
    CONFIG.overlaysEnabled = typeof cfg.overlaysEnabled === 'boolean' ? cfg.overlaysEnabled : CONFIG.overlaysEnabled;
    return {
      host: CONFIG.host,
      port: CONFIG.port,
      monitorPreset: CONFIG.monitorPreset,
      monitorWidth: CONFIG.monitorWidth,
      monitorHeight: CONFIG.monitorHeight,
      overlaysEnabled: CONFIG.overlaysEnabled
    };
  }

  function giphyLinkEnabled() {
    var links = [];
    if (window.KappiOverlayConfig && typeof window.KappiOverlayConfig.getExternalLinks === 'function') {
      links = window.KappiOverlayConfig.getExternalLinks();
    } else if (Array.isArray(window.KAPPI_EXTERNAL_OVERLAY_LINKS)) {
      links = window.KAPPI_EXTERNAL_OVERLAY_LINKS;
    }
    for (var i = 0; i < links.length; i++) {
      if (/tawmae\.xyz\/overlays\/giphy-and-sb/i.test(links[i].url || '')) {
        return links[i].enabled !== false;
      }
    }
    return true;
  }

  function overlayOutputEnabled() {
    getConnection();
    return CONFIG.overlaysEnabled !== false && giphyLinkEnabled();
  }

  function canvasSize() {
    getConnection();
    if (CONFIG.monitorPreset && CONFIG.monitorPreset !== 'auto') {
      return {
        width: CONFIG.monitorWidth || window.innerWidth || 1920,
        height: CONFIG.monitorHeight || window.innerHeight || 1080
      };
    }
    return {
      width: window.innerWidth || CONFIG.monitorWidth || 1920,
      height: window.innerHeight || CONFIG.monitorHeight || 1080
    };
  }

  function ensureLayer() {
    var layer = document.getElementById('kappi-giphy-sb-layer');
    if (layer) return layer;

    layer = document.createElement('div');
    layer.id = 'kappi-giphy-sb-layer';
    layer.style.position = 'fixed';
    layer.style.left = '0';
    layer.style.top = '0';
    layer.style.width = '100vw';
    layer.style.height = '100vh';
    layer.style.overflow = 'hidden';
    layer.style.pointerEvents = 'none';
    layer.style.background = 'transparent';
    layer.style.zIndex = '2147482400';

    if (document.body.firstChild) {
      document.body.insertBefore(layer, document.body.firstChild);
    } else {
      document.body.appendChild(layer);
    }
    return layer;
  }

  function dataOf(payload) {
    if (!payload) return {};
    return payload.data || payload.Data || payload;
  }

  function eventName(payload) {
    var data = dataOf(payload);
    if (typeof data.event === 'string') return data.event;
    if (payload.event && payload.event.source && payload.event.type) {
      return payload.event.source + '.' + payload.event.type;
    }
    return '';
  }

  function eventData(payload) {
    var data = dataOf(payload);
    return data.data || data.Data || data;
  }

  function normalizeNumber(value, fallback, min, max) {
    var parsed = parseFloat(value);
    if (isNaN(parsed)) parsed = fallback;
    if (typeof min === 'number') parsed = Math.max(min, parsed);
    if (typeof max === 'number') parsed = Math.min(max, parsed);
    return parsed;
  }

  function normalizePayload(data) {
    data = data || {};
    return {
      url: data.url || data.Url || data.href || '',
      width: normalizeNumber(data.width || data.Width, CONFIG.defaultWidth, 20, canvasSize().width),
      height: normalizeNumber(data.height || data.Height, CONFIG.defaultHeight, 20, canvasSize().height),
      duration: normalizeNumber(data.duration || data.Duration, CONFIG.defaultDuration, 300, 60000),
      volume: normalizeNumber(data.volume || data.Volume, CONFIG.defaultVolume, 0, 1),
      randomRotation: data.randomRotation !== false && data.RandomRotation !== false,
      centeredMode: data.centeredMode === true || data.CenteredMode === true,
      maxGifs: normalizeNumber(data.maxGifs || data.MaxGifs, CONFIG.maxGifsDefault, 1, 50)
    };
  }

  function fingerprint(type, data) {
    return [
      type,
      data.url,
      data.width,
      data.height,
      data.duration,
      data.centeredMode
    ].join('|');
  }

  function recentlySeen(type, data) {
    var key = fingerprint(type, data);
    var now = Date.now();
    Object.keys(state.seen).forEach(function (seenKey) {
      if (now - state.seen[seenKey] > 800) delete state.seen[seenKey];
    });
    if (state.seen[key]) return true;
    state.seen[key] = now;
    return false;
  }

  function randomPosition(width, height, rotation) {
    var canvas = canvasSize();
    var canvasWidth = canvas.width;
    var canvasHeight = canvas.height;
    var rad = rotation * Math.PI / 180;
    var cos = Math.abs(Math.cos(rad));
    var sin = Math.abs(Math.sin(rad));
    var rotatedWidth = width * cos + height * sin;
    var rotatedHeight = width * sin + height * cos;
    var maxX = Math.max(0, canvasWidth - rotatedWidth);
    var maxY = Math.max(0, canvasHeight - rotatedHeight);

    return {
      x: Math.max(0, Math.random() * maxX + (rotatedWidth - width) / 2),
      y: Math.max(0, Math.random() * maxY + (rotatedHeight - height) / 2)
    };
  }

  function animate(wrapper, duration, onDone) {
    if (window.gsap && typeof window.gsap.timeline === 'function') {
      var tl = window.gsap.timeline({ onComplete: onDone });
      tl.to(wrapper, { opacity: 1, duration: 0.3, ease: 'power2.out' });
      tl.to(wrapper, { opacity: 0, scale: 0.8, duration: 0.3, ease: 'power2.in' }, '+=' + (duration / 1000));
      return;
    }

    wrapper.style.transition = 'opacity 300ms ease, transform 300ms ease';
    requestAnimationFrame(function () {
      wrapper.style.opacity = '1';
    });
    window.setTimeout(function () {
      wrapper.style.opacity = '0';
      wrapper.style.transform += ' scale(0.8)';
      window.setTimeout(onDone, 350);
    }, duration + 300);
  }

  function processQueue() {
    if (!state.queue.length) return;
    var next = state.queue[0];
    if (next.data.centeredMode && state.centeredActive) return;
    if (!next.data.centeredMode && state.activeGifs >= next.data.maxGifs) return;
    state.queue.shift();
    displayMedia(next.type, next.data);
  }

  function displayMedia(type, data) {
    var layer = ensureLayer();
    var width = data.width;
    var height = data.height;
    var centered = data.centeredMode;
    var rotation = centered || !data.randomRotation ? 0 : Math.random() * 90 - 45;
    var wrapper = document.createElement('div');
    var media;

    if (centered) state.centeredActive = true;

    wrapper.className = 'kappi-giphy-sb-item';
    wrapper.style.position = 'absolute';
    wrapper.style.width = width + 'px';
    wrapper.style.height = height + 'px';
    wrapper.style.opacity = '0';
    wrapper.style.transformOrigin = 'center center';
    wrapper.style.background = 'transparent';

    if (centered) {
      wrapper.style.left = '50%';
      wrapper.style.top = '50%';
      wrapper.style.transform = 'translate(-50%, -50%) rotate(' + rotation + 'deg)';
    } else {
      var pos = randomPosition(width, height, rotation);
      wrapper.style.left = pos.x + 'px';
      wrapper.style.top = pos.y + 'px';
      wrapper.style.transform = 'rotate(' + rotation + 'deg)';
    }

    if (type === 'clip') {
      media = document.createElement('video');
      media.src = data.url;
      media.autoplay = true;
      media.loop = false;
      media.muted = data.volume <= 0;
      media.volume = data.volume;
      media.playsInline = true;
    } else {
      media = document.createElement('img');
      media.src = data.url;
      media.alt = 'GIPHY';
    }

    media.style.display = 'block';
    media.style.width = '100%';
    media.style.height = '100%';
    media.style.objectFit = 'contain';
    media.style.background = 'transparent';

    wrapper.appendChild(media);
    layer.appendChild(wrapper);
    state.activeGifs++;

    animate(wrapper, data.duration, function () {
      if (media.tagName === 'VIDEO') {
        try {
          media.pause();
          media.removeAttribute('src');
          media.load();
        } catch (err) {}
      }
      wrapper.remove();
      state.activeGifs = Math.max(0, state.activeGifs - 1);
      if (centered) state.centeredActive = false;
      processQueue();
    });
  }

  function show(type, rawData) {
    if (!overlayOutputEnabled()) {
      clearLayer();
      return;
    }
    var data = normalizePayload(rawData);
    if (!data.url) return;
    if (recentlySeen(type, data)) return;

    state.lastEvent = { type: type, data: data, at: new Date().toISOString() };

    if (data.centeredMode ? state.centeredActive : state.activeGifs >= data.maxGifs) {
      state.queue.push({ type: type, data: data });
      return;
    }

    displayMedia(type, data);
  }

  function handleMessage(payload) {
    var name = eventName(payload);
    var data = eventData(payload);

    if (name === 'giphy.showGif' || name === 'giphy.showSticker') {
      show('gif', data);
    } else if (name === 'giphy.showClip') {
      show('clip', data);
    }
  }

  function attachExistingClient() {
    if (!window.client || typeof window.client.on !== 'function') return false;
    if (state.connectedClient) return true;
    window.client.on('General.Custom', handleMessage);
    state.connectedClient = true;
    log('Attached to existing Streamer.bot client.');
    return true;
  }

  function startClientAttachLoop() {
    var started = Date.now();
    function tick() {
      if (attachExistingClient()) return;
      if (Date.now() - started > CONFIG.attachClientWaitMs) return;
      state.clientAttachTimer = window.setTimeout(tick, 250);
    }
    tick();
  }

  function sendRaw(obj) {
    if (!state.rawSocket || state.rawSocket.readyState !== WebSocket.OPEN) return;
    state.rawSocket.send(JSON.stringify(obj));
  }

  function startRawSocket() {
    getConnection();
    if (state.rawSocket && state.rawSocket.readyState <= WebSocket.OPEN) return;

    try {
      state.rawSocket = new WebSocket('ws://' + CONFIG.host + ':' + CONFIG.port + '/');
    } catch (err) {
      warn('Raw WebSocket could not start.', err);
      return;
    }

    state.rawSocket.onopen = function () {
      state.connectedRaw = true;
      sendRaw({
        request: 'Subscribe',
        id: 'kappi-giphy-sb-subscribe-' + Date.now(),
        events: { General: ['Custom'] }
      });
      log('Raw WebSocket subscribed to General.Custom.', { host: CONFIG.host, port: CONFIG.port });
    };

    state.rawSocket.onmessage = function (event) {
      try {
        handleMessage(JSON.parse(event.data));
      } catch (err) {
        warn('Raw WebSocket payload could not be parsed.', err);
      }
    };

    state.rawSocket.onclose = function () {
      state.connectedRaw = false;
      state.rawSocket = null;
      if (!state.reconnectTimer) {
        state.reconnectTimer = window.setTimeout(function () {
          state.reconnectTimer = null;
          startRawSocket();
        }, CONFIG.reconnectMs);
      }
    };

    state.rawSocket.onerror = function (event) {
      warn('Raw WebSocket error.', event);
    };
  }

  window.kappiGiphySb = {
    status: function () {
      return {
        connectedClient: state.connectedClient,
        connectedRaw: state.connectedRaw,
        outputEnabled: overlayOutputEnabled(),
        monitor: canvasSize(),
        activeGifs: state.activeGifs,
        queued: state.queue.length,
        lastEvent: state.lastEvent,
        lastError: state.lastError
      };
    },
    test: function () {
      show('gif', {
        url: 'https://media.giphy.com/media/ICOgUNjpvO0PC/giphy.gif',
        width: 320,
        height: 240,
        duration: 3500,
        randomRotation: true,
        centeredMode: false,
        maxGifs: 6
      });
    },
    clear: function () {
      clearLayer();
    }
  };

  function clearLayer() {
    ensureLayer().innerHTML = '';
    state.activeGifs = 0;
    state.queue = [];
    state.centeredActive = false;
  }

  ensureLayer();
  startClientAttachLoop();
  startRawSocket();
  if (window.location && /[?&]giphyTest=1(?:&|$)/.test(window.location.search || '')) {
    window.setTimeout(function () { window.kappiGiphySb.test(); }, 500);
  }
  log('Local GIPHY & SB renderer loaded.');
})();
