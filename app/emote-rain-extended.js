// Kappi Emote Rain for the existing transparent HTML Overlay EXE.
// Uses Streamer.bot Twitch.ChatMessage data.parts as the primary emote source.
(function () {
  'use strict';

  if (window.__KAPPI_EMOTE_RAIN_ACTIVE__) {
    if (window.console && console.warn) {
      console.warn('[Kappi Emote Rain] Already active. Duplicate load prevented.');
    }
    return;
  }

  window.__KAPPI_EMOTE_RAIN_ACTIVE__ = true;
  window.__EMOTE_RAIN_HARD_LOADED__ = true;
  window.__KAPPI_EMOTE_RAIN_VERSION__ = '20260618-bridge1';

  function getSharedConfig() {
    return window.KappiOverlayConfig
      ? window.KappiOverlayConfig.get()
      : (window.KAPPI_OVERLAY_CONFIG || {});
  }

  var SHARED_CONFIG = getSharedConfig();
  var SHARED_RAIN_CONFIG = SHARED_CONFIG.emoteRain || {};
  var EFFECT_STORAGE_KEY = 'kappi.emoteRain.settings';
  var CONTROL_CHANNEL_NAME = 'kappi-overlay-control';
  var BRIDGE_SETTINGS_URL = location.origin + '/emote-rain-settings.json';
  var BRIDGE_POLL_MS = 1000;
  var DIAGNOSE_ONLY = window.KAPPI_EMOTE_RAIN_DIAGNOSE_ONLY === true;

  var CONFIG = {
    host: SHARED_CONFIG.host || '127.0.0.1',
    port: parseInt(SHARED_CONFIG.port || 8081, 10) || 8081,
    debugVisible: false,
    attachClientWaitMs: 60000,
    reconnectMs: 4000,
    maxOnScreen: 80,
    maxPerMessage: 25,
    enabled: typeof SHARED_RAIN_CONFIG.enabled === 'boolean' ? SHARED_RAIN_CONFIG.enabled : true,
    emoteSize: 105,
    emojiSize: 95,
    sizeLevel: parseInt(SHARED_RAIN_CONFIG.sizeLevel || 6, 10) || 6,
    speedLevel: parseInt(SHARED_RAIN_CONFIG.speedLevel || 5, 10) || 5,
    speedMin: 5,
    speedMax: 12,
    lifetimeMs: 18000,
    spawnDelayMs: 80,
    dedupeMs: 8000
  };

  var state = {
    loadedAt: new Date().toISOString(),
    connectedRaw: false,
    connectedClient: false,
    rawSocket: null,
    reconnectTimer: null,
    attachTimer: null,
    attachStartedAt: Date.now(),
    seenMessages: {},
    items: [],
    activeOnScreen: 0,
    frameStarted: false,
    spawnTimers: [],
    lastPayload: null,
    lastItems: [],
    lastError: null,
    rawHelloReceived: false,
    rawGetInfoOk: false,
    rawSubscribeSent: false,
    clientSubscribeRequested: false,
    clientSubscribeOk: false,
    clientSubscribeError: null,
    lastSourceLabel: '',
    lastHandledAt: null,
    lastIgnoredReason: '',
    lastSpawnCount: 0,
    manualEnabledOverride: null,
    controlChannel: null,
    bridgeSettings: null,
    bridgePollTimer: null,
    bridgeRequestInFlight: false,
    bridgeLastSignature: '',
    bridgeLastAppliedAt: null,
    bridgeOk: false,
    bridgeError: null
  };

  function log(message, obj) {
    if (window.console && console.log) console.log('[Kappi Emote Rain]', message, obj || '');
    debug(message, obj);
  }

  function warn(message, obj) {
    state.lastError = obj || message;
    if (window.console && console.warn) console.warn('[Kappi Emote Rain]', message, obj || '');
    debug('WARN: ' + message, obj);
  }

  function clean(value) {
    return value === null || typeof value === 'undefined' ? '' : String(value);
  }

  function normalizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    if (url.indexOf('//') === 0) return 'https:' + url;
    return url;
  }

  function now() {
    return new Date().toLocaleTimeString('de-DE', { hour12: false });
  }

  function clampLevel(value, fallback) {
    var parsed = parseInt(value, 10);
    if (isNaN(parsed)) parsed = fallback;
    return Math.max(1, Math.min(10, parsed));
  }

  function applyEffectLevels(sizeLevel, speedLevel) {
    var before = CONFIG.sizeLevel + '|' + CONFIG.speedLevel + '|' + CONFIG.emoteSize + '|' + CONFIG.emojiSize + '|' + CONFIG.speedMin + '|' + CONFIG.speedMax;
    CONFIG.sizeLevel = clampLevel(sizeLevel, CONFIG.sizeLevel);
    CONFIG.speedLevel = clampLevel(speedLevel, CONFIG.speedLevel);
    CONFIG.emoteSize = 40 + CONFIG.sizeLevel * 11;
    CONFIG.emojiSize = 36 + CONFIG.sizeLevel * 10;
    CONFIG.speedMin = 14 - CONFIG.speedLevel * 0.8;
    CONFIG.speedMax = 20 - CONFIG.speedLevel * 1.1;
    CONFIG.speedMin = Math.max(3, CONFIG.speedMin);
    CONFIG.speedMax = Math.max(CONFIG.speedMin + 1, CONFIG.speedMax);
    CONFIG.spawnDelayMs = Math.max(35, 135 - CONFIG.speedLevel * 9);
    return before !== CONFIG.sizeLevel + '|' + CONFIG.speedLevel + '|' + CONFIG.emoteSize + '|' + CONFIG.emojiSize + '|' + CONFIG.speedMin + '|' + CONFIG.speedMax;
  }

  function itemSize(kind) {
    return kind === 'image' ? CONFIG.emoteSize : CONFIG.emojiSize;
  }

  function viewportWidth() {
    return Math.max(
      320,
      window.innerWidth || 0,
      document.documentElement && document.documentElement.clientWidth || 0,
      document.body && document.body.clientWidth || 0
    );
  }

  function viewportHeight() {
    return Math.max(
      240,
      window.innerHeight || 0,
      document.documentElement && document.documentElement.clientHeight || 0,
      document.body && document.body.clientHeight || 0
    );
  }

  function scheduleFrame(callback) {
    if (typeof window.requestAnimationFrame === 'function') {
      return window.requestAnimationFrame(callback);
    }
    return setTimeout(function () {
      callback(typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
    }, 16);
  }

  function speedFromSeed(seed) {
    var safeSeed = typeof seed === 'number' ? seed : Math.random();
    return CONFIG.speedMin + safeSeed * (CONFIG.speedMax - CONFIG.speedMin);
  }

  function updateActiveItems() {
    for (var i = 0; i < state.items.length; i++) {
      var item = state.items[i];
      if (!item || !item.el) continue;

      var size = itemSize(item.kind);
      item.size = size;
      item.speed = speedFromSeed(item.speedSeed);
      item.el.style.width = size + 'px';
      item.el.style.height = size + 'px';
      if (item.kind !== 'image') {
        item.el.style.fontSize = size + 'px';
      }
    }
  }

  function cancelPendingSpawns() {
    while (state.spawnTimers.length) {
      clearTimeout(state.spawnTimers.pop());
    }
  }

  function stopRainNow() {
    cancelPendingSpawns();
    var layer = ensureLayer();
    layer.innerHTML = '';
    state.items = [];
    state.activeOnScreen = 0;
    state.frameStarted = false;
    state.lastItems = [];
  }

  function toBool(value, fallback) {
    if (typeof value === 'boolean') return value;
    if (value === 'false' || value === '0') return false;
    if (value === 'true' || value === '1') return true;
    return fallback;
  }

  function globalEnabledOverride() {
    if (window.KAPPI_EMOTE_RAIN_FORCE_DISABLED === true) return false;
    if (window.KAPPI_EMOTE_RAIN_ENABLED === false) return false;
    if (window.KAPPI_EMOTE_RAIN_ENABLED === true) return true;
    return null;
  }

  function isOverlayIndexPage() {
    var path = window.location && window.location.pathname ? window.location.pathname : '';
    return /(?:^|\/|\\)index\.html$/i.test(path);
  }

  function readEffectSettings() {
    var out = {
      enabled: true,
      sizeLevel: CONFIG ? CONFIG.sizeLevel : 6,
      speedLevel: CONFIG ? CONFIG.speedLevel : 5
    };

    var shared = getSharedConfig().emoteRain || {};
    if (typeof shared.enabled === 'boolean') out.enabled = shared.enabled;
    if (shared.sizeLevel) out.sizeLevel = shared.sizeLevel;
    if (shared.speedLevel) out.speedLevel = shared.speedLevel;

    try {
      if (window.localStorage) {
        var raw = window.localStorage.getItem(EFFECT_STORAGE_KEY);
        var parsed = raw ? JSON.parse(raw) : null;
        if (parsed && parsed.version >= 3) {
          if (typeof parsed.enabled === 'boolean') out.enabled = parsed.enabled;
          if (parsed.sizeLevel) out.sizeLevel = parsed.sizeLevel;
          if (parsed.speedLevel) out.speedLevel = parsed.speedLevel;
        }
      }
    } catch (err) {
      debug('Stored emote-rain settings ignored.', err);
    }

    var queryHasEnabled = false;
    if (window.location && window.location.search) {
      var query = window.location.search;
      if (/[?&](emoteRainEnabled|rainEnabled)=false(?:&|$)/i.test(query) || /[?&](emoteRainEnabled|rainEnabled)=0(?:&|$)/i.test(query)) {
        queryHasEnabled = true;
        out.enabled = false;
      }
      if (/[?&](emoteRainEnabled|rainEnabled)=true(?:&|$)/i.test(query) || /[?&](emoteRainEnabled|rainEnabled)=1(?:&|$)/i.test(query)) {
        queryHasEnabled = true;
        out.enabled = true;
      }
    }

    var override = globalEnabledOverride();
    if (override !== null) out.enabled = override;
    if (state.manualEnabledOverride !== null) out.enabled = state.manualEnabledOverride;
    if (state.bridgeSettings) {
      if (typeof state.bridgeSettings.enabled === 'boolean') out.enabled = state.bridgeSettings.enabled;
      if (state.bridgeSettings.sizeLevel) out.sizeLevel = state.bridgeSettings.sizeLevel;
      if (state.bridgeSettings.speedLevel) out.speedLevel = state.bridgeSettings.speedLevel;
    }

    return out;
  }

  function saveEffectSettings() {
    var settings = {
      enabled: CONFIG.enabled,
      sizeLevel: CONFIG.sizeLevel,
      speedLevel: CONFIG.speedLevel,
      version: 3,
      savedAt: Date.now()
    };
    if (window.localStorage) window.localStorage.setItem(EFFECT_STORAGE_KEY, JSON.stringify(settings));
    if (window.KappiOverlayConfig && typeof window.KappiOverlayConfig.saveEmoteRain === 'function') {
      window.KappiOverlayConfig.saveEmoteRain(settings);
    }
  }

  function refreshEffectSettings() {
    var settings = readEffectSettings();
    var wasEnabled = CONFIG.enabled;
    CONFIG.enabled = toBool(settings.enabled, CONFIG.enabled);
    var levelsChanged = applyEffectLevels(settings.sizeLevel || CONFIG.sizeLevel, settings.speedLevel || CONFIG.speedLevel);
    if (!CONFIG.enabled) {
      stopRainNow();
    } else if (levelsChanged) {
      updateActiveItems();
    }
    return settings;
  }

  refreshEffectSettings();

  function safeJson(obj) {
    try { return JSON.stringify(obj, null, 2); }
    catch (err) { return String(obj); }
  }

  function ensureDebugBox() {
    var box = document.getElementById('kappi-emote-rain-debug-box');
    if (!box) {
      box = document.createElement('pre');
      box.id = 'kappi-emote-rain-debug-box';
      box.style.position = 'fixed';
      box.style.left = '10px';
      box.style.top = '10px';
      box.style.width = '520px';
      box.style.maxHeight = '320px';
      box.style.overflow = 'hidden';
      box.style.margin = '0';
      box.style.padding = '10px';
      box.style.zIndex = '2147483647';
      box.style.pointerEvents = 'none';
      box.style.background = 'rgba(0,0,0,0.82)';
      box.style.color = '#00ff88';
      box.style.border = '2px solid #00ff88';
      box.style.borderRadius = '8px';
      box.style.font = '13px Consolas, monospace';
      box.style.whiteSpace = 'pre-wrap';
      document.body.appendChild(box);
    }
    box.style.display = CONFIG.debugVisible ? 'block' : 'none';
    return box;
  }

  function debug(message, obj) {
    if (!CONFIG.debugVisible) return;
    var box = ensureDebugBox();
    var line = '[' + now() + '] ' + message;
    if (obj) line += '\n' + safeJson(obj);
    box.textContent = line + '\n\n' + box.textContent.slice(0, 3500);
  }

  function ensureRainStyle() {
    var style = document.getElementById('kappi-emote-rain-style');
    if (style) return style;

    style = document.createElement('style');
    style.id = 'kappi-emote-rain-style';
    style.textContent = [
      '@keyframes kappiRainFallSimple {',
      '  0% { transform: translateY(-180px) rotate(0deg) scale(1); opacity: 1; }',
      '  100% { transform: translateY(calc(100vh + 260px)) rotate(720deg) scale(1); opacity: 1; }',
      '}',
      '@keyframes kappiRainWiggleSimple {',
      '  0% { margin-left: 0px; }',
      '  50% { margin-left: 90px; }',
      '  100% { margin-left: 0px; }',
      '}',
      '.kappi-rain-item-simple {',
      '  position: absolute;',
      '  left: 0;',
      '  top: 0;',
      '  pointer-events: none;',
      '  will-change: transform;',
      '  animation-name: kappiRainFallSimple, kappiRainWiggleSimple;',
      '  animation-timing-function: linear, ease-in-out;',
      '  animation-fill-mode: forwards, both;',
      '  animation-iteration-count: 1, infinite;',
      '}',
      '.kappi-rain-image-simple {',
      '  background-repeat: no-repeat;',
      '  background-position: center;',
      '  background-size: contain;',
      '}',
      '.kappi-rain-emoji-simple {',
      '  font-family: "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif;',
      '  text-align: center;',
      '  line-height: 1;',
      '  filter: drop-shadow(0 0 8px rgba(0,0,0,.7));',
      '}'
    ].join('\n');
    var parent = document.head && typeof document.head.appendChild === 'function'
      ? document.head
      : document.documentElement && typeof document.documentElement.appendChild === 'function'
        ? document.documentElement
        : document.body;
    parent.appendChild(style);
    return style;
  }

  function ensureLayer() {
    var layer = document.getElementById('kappi-emote-rain-layer');
    if (!layer) {
      ensureRainStyle();
      layer = document.createElement('div');
      layer.id = 'kappi-emote-rain-layer';
      layer.style.position = 'fixed';
      layer.style.left = '0';
      layer.style.top = '0';
      layer.style.width = '100vw';
      layer.style.height = '100vh';
      layer.style.overflow = 'hidden';
      layer.style.pointerEvents = 'none';
      layer.style.zIndex = '2147483647';
      layer.style.transform = 'translateZ(0)';
      document.body.appendChild(layer);
    }
    return layer;
  }

  function clearActiveItems() {
    stopRainNow();
  }

  function eventName(payload) {
    var source = payload && payload.event ? payload.event.source || '' : '';
    var type = payload && payload.event ? payload.event.type || '' : '';
    return source || type ? source + '.' + type : '';
  }

  function withEvent(payload, source, type) {
    payload = payload || {};
    if (payload.event) return payload;
    try {
      payload.event = { source: source, type: type };
      return payload;
    } catch (err) {
      return {
        event: { source: source, type: type },
        data: dataOf(payload)
      };
    }
  }

  function dataOf(payload) {
    if (!payload) return {};
    return payload.data || payload.Data || payload;
  }

  function hasParts(obj) {
    return !!(obj && typeof obj === 'object' && Array.isArray(obj.parts || obj.Parts));
  }

  function findDataWithParts(root, depth, seen) {
    if (!root || typeof root !== 'object' || depth > 5) return null;
    if (hasParts(root)) return root;

    seen = seen || [];
    if (seen.indexOf(root) >= 0) return null;
    seen.push(root);

    var preferred = ['data', 'Data', 'message', 'Message', 'msg', 'Msg', 'args', 'Args', 'payload', 'Payload', 'eventData', 'EventData'];
    for (var i = 0; i < preferred.length; i++) {
      var key = preferred[i];
      if (root[key]) {
        var preferredFound = findDataWithParts(root[key], depth + 1, seen);
        if (preferredFound) return preferredFound;
      }
    }

    var keys = Object.keys(root);
    for (var j = 0; j < keys.length; j++) {
      var value = root[keys[j]];
      if (!value || typeof value !== 'object') continue;
      var found = findDataWithParts(value, depth + 1, seen);
      if (found) return found;
    }

    return null;
  }

  function chatDataOf(payload) {
    return findDataWithParts(payload, 0, []) || dataOf(payload);
  }

  function messageText(data) {
    var direct = data.text || data.messageText || data.rawInput || data.rawInputEscaped || data.body;
    if (typeof direct === 'string' && direct.trim()) return direct;
    if (typeof data.message === 'string') return data.message;

    var msg = data.message || data.Message;
    if (msg && typeof msg === 'object') {
      return clean(msg.text || msg.message || msg.body || msg.raw);
    }
    return '';
  }

  function unicodeEmojis(text) {
    if (!text || typeof text !== 'string') return [];

    var matches = text.match(/[\uD800-\uDBFF][\uDC00-\uDFFF](?:\uFE0F|\uFE0E)?/g) || [];
    var out = [];

    for (var i = 0; i < matches.length; i++) {
      out.push({
        type: 'emoji',
        value: matches[i],
        text: matches[i],
        source: 'unicode'
      });
    }

    return out;
  }

  function normalizeKnownObject(obj) {
    if (!obj || typeof obj !== 'object') return null;

    var text = obj.text || obj.Text || obj.name || obj.Name || obj.code || obj.Code || obj.id || obj.Id || '';
    var url = obj.imageUrl || obj.ImageUrl || obj.imageURL || obj.url || obj.Url ||
      obj.image || obj.Image || obj.largeImageUrl || obj.mediumImageUrl || obj.smallImageUrl || '';

    if (url) {
      return {
        type: 'image',
        value: normalizeUrl(url),
        text: clean(text),
        source: clean(obj.source || obj.Source || obj.Kind || 'known-field')
      };
    }

    var id = obj.id || obj.Id || obj.emoteId || obj.EmoteId;
    if (id) {
      return {
        type: 'image',
        value: 'https://static-cdn.jtvnw.net/emoticons/v2/' + id + '/default/dark/3.0',
        text: clean(text || id),
        source: clean(obj.source || obj.Source || 'Twitch')
      };
    }

    return null;
  }

  function extractFromParts(parts) {
    if (!Array.isArray(parts)) return [];

    var items = [];
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (!part || typeof part !== 'object') continue;

      var type = clean(part.type || part.Type).toLowerCase();
      var text = clean(part.text || part.Text || part.name || part.Name);
      var source = clean(part.source || part.Source);
      var imageUrl = normalizeUrl(part.imageUrl || part.ImageUrl || part.imageURL || part.url || part.Url);

      if (type === 'emote' && imageUrl) {
        items.push({
          type: 'image',
          value: imageUrl,
          text: text,
          source: source || 'data.parts'
        });
        continue;
      }

      if (imageUrl) {
        items.push({
          type: 'image',
          value: imageUrl,
          text: text,
          source: source || 'data.parts'
        });
        continue;
      }

      if (type === 'text' || text) {
        items = items.concat(unicodeEmojis(text));
      }
    }

    return items;
  }

  function extractFallback(data) {
    var found = [];
    var msg = typeof data.message === 'object' ? data.message : null;
    var arrays = [
      data.emotes,
      data.Emotes,
      data.fragments,
      data.Fragments,
      msg ? msg.emotes : null,
      msg ? msg.Emotes : null,
      msg ? msg.fragments : null,
      msg ? msg.Fragments : null
    ];

    for (var i = 0; i < arrays.length; i++) {
      var arr = arrays[i];
      if (!Array.isArray(arr)) continue;

      for (var j = 0; j < arr.length; j++) {
        var normal = normalizeKnownObject(arr[j]);
        if (normal) found.push(normal);

        var nested = arr[j] ? normalizeKnownObject(arr[j].emote || arr[j].Emote) : null;
        if (nested) found.push(nested);
      }
    }

    return found.concat(unicodeEmojis(messageText(data)));
  }

  function hasKnownEmoteData(data) {
    if (!data || typeof data !== 'object') return false;
    var msg = typeof data.message === 'object' ? data.message : null;
    return Array.isArray(data.emotes) ||
      Array.isArray(data.Emotes) ||
      Array.isArray(data.fragments) ||
      Array.isArray(data.Fragments) ||
      !!(msg && Array.isArray(msg.emotes)) ||
      !!(msg && Array.isArray(msg.Emotes)) ||
      !!(msg && Array.isArray(msg.fragments)) ||
      !!(msg && Array.isArray(msg.Fragments));
  }

  function dedupe(items) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!item || !item.value) continue;
      out.push(item);
    }
    return out;
  }

  function extractItems(payload) {
    var data = chatDataOf(payload);
    var parts = data.parts || data.Parts;
    var items = extractFromParts(parts);
    if (!items.length) items = extractFallback(data);
    return dedupe(items);
  }

  function messageKey(payload) {
    var data = chatDataOf(payload);
    var msg = data.message || {};
    var id = data.messageId || data.msgId || data.id || msg.id || msg.messageId || '';
    if (id) return eventName(payload) + '|' + id;

    var user = '';
    if (data.user && typeof data.user === 'object') {
      user = data.user.id || data.user.login || data.user.name || '';
    } else {
      user = data.user || '';
    }
    user = user || data.userName || '';
    return eventName(payload) + '|' + user + '|' + messageText(data) + '|' + Math.floor(Date.now() / CONFIG.dedupeMs);
  }

  function alreadyProcessed(payload) {
    var time = Date.now();
    var keys = Object.keys(state.seenMessages);
    for (var i = 0; i < keys.length; i++) {
      if (time - state.seenMessages[keys[i]] > CONFIG.dedupeMs) delete state.seenMessages[keys[i]];
    }

    var key = messageKey(payload);
    if (state.seenMessages[key]) return true;

    state.seenMessages[key] = time;
    return false;
  }

  function random(min, max) {
    return min + Math.random() * (max - min);
  }

  function setCssVar(el, name, value) {
    if (el && el.style && typeof el.style.setProperty === 'function') {
      el.style.setProperty(name, value);
    } else if (el && el.style) {
      el.style[name] = value;
    }
  }

  function spawnOne(item) {
    refreshEffectSettings();
    if (!CONFIG.enabled) {
      stopRainNow();
      return;
    }
    if (state.activeOnScreen >= CONFIG.maxOnScreen) return;

    var layer = ensureLayer();
    var el = document.createElement('div');
    var size = item.type === 'image' ? CONFIG.emoteSize : CONFIG.emojiSize;
    var duration = random(CONFIG.speedMin, CONFIG.speedMax);
    var wiggleDuration = random(1.8, 3.6);
    var left = random(0, 92);

    el.className = 'kappi-rain-item-simple';
    el.style.left = left + 'vw';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.zIndex = '2147483647';
    el.style.animationDuration = duration + 's, ' + wiggleDuration + 's';

    if (item.type === 'image') {
      el.className += ' kappi-rain-image-simple';
      el.style.backgroundImage = 'url("' + String(item.value).replace(/"/g, '%22') + '")';
      el.title = item.text || 'emote';
    } else {
      el.className += ' kappi-rain-emoji-simple';
      el.textContent = item.value;
      el.style.fontSize = size + 'px';
    }

    layer.appendChild(el);
    state.activeOnScreen++;

    var rainItem = {
      el: el,
      kind: item.type,
      size: size,
      born: Date.now(),
      lifetime: CONFIG.lifetimeMs,
      removeTimer: null
    };

    function removeItem() {
      if (rainItem.removeTimer) {
        var timerIndex = state.spawnTimers.indexOf(rainItem.removeTimer);
        if (timerIndex >= 0) state.spawnTimers.splice(timerIndex, 1);
        rainItem.removeTimer = null;
      }
      if (rainItem.el && rainItem.el.parentNode) rainItem.el.parentNode.removeChild(rainItem.el);
      var itemIndex = state.items.indexOf(rainItem);
      if (itemIndex >= 0) state.items.splice(itemIndex, 1);
      state.activeOnScreen = Math.max(0, state.activeOnScreen - 1);
    }

    state.items.push(rainItem);
    if (typeof el.remove === 'function' || typeof el.addEventListener === 'function') {
      if (typeof el.addEventListener === 'function') {
        el.addEventListener('animationend', removeItem, { once: true });
      }
      rainItem.removeTimer = setTimeout(removeItem, CONFIG.lifetimeMs);
      state.spawnTimers.push(rainItem.removeTimer);
    }
  }

  function tick(time) {
    state.frameStarted = false;
  }

  function spawnItems(items) {
    refreshEffectSettings();
    if (!CONFIG.enabled) {
      stopRainNow();
      log('Emoji rain is disabled. Items ignored.', items);
      return 0;
    }
    var free = Math.max(0, CONFIG.maxOnScreen - state.activeOnScreen);
    var selected = items.slice(0, Math.min(CONFIG.maxPerMessage, free));
    state.lastItems = selected;

    for (var i = 0; i < selected.length; i++) {
      (function (item, index) {
        var timer = setTimeout(function () {
          var timerIndex = state.spawnTimers.indexOf(timer);
          if (timerIndex >= 0) state.spawnTimers.splice(timerIndex, 1);
          spawnOne(item);
        }, index * CONFIG.spawnDelayMs);
        state.spawnTimers.push(timer);
      })(selected[i], i);
    }

    return selected.length;
  }

  function supportedEvent(payload) {
    var ev = eventName(payload);
    var evLower = ev.toLowerCase();
    var data = chatDataOf(payload);
    if (Array.isArray(data.parts || data.Parts)) return true;
    if (hasKnownEmoteData(data)) return true;
    return evLower === 'twitch.chatmessage' ||
      evLower === 'youtube.message' ||
      evLower === 'kick.chatmessage' ||
      evLower === 'twitch.message';
  }

  function handlePayload(payload, sourceLabel) {
    sourceLabel = sourceLabel || 'unknown';
    state.lastSourceLabel = sourceLabel;
    state.lastHandledAt = new Date().toISOString();
    refreshEffectSettings();
    if (!CONFIG.enabled) {
      stopRainNow();
      state.lastIgnoredReason = 'disabled';
      state.lastSpawnCount = 0;
      debug('Chat event ignored because emoji rain is disabled.', {
        sourceLabel: sourceLabel,
        event: eventName(payload)
      });
      return 0;
    }
    if (!supportedEvent(payload)) {
      state.lastIgnoredReason = 'unsupported-event:' + eventName(payload);
      state.lastSpawnCount = 0;
      return 0;
    }
    if (alreadyProcessed(payload)) {
      state.lastIgnoredReason = 'duplicate-message';
      state.lastSpawnCount = 0;
      return 0;
    }

    state.lastPayload = payload;
    var items = extractItems(payload);

    if (!items.length) {
      state.lastIgnoredReason = 'no-emotes-or-emojis';
      state.lastSpawnCount = 0;
      debug('Chat event received, but no emotes/emojis were found.', {
        sourceLabel: sourceLabel,
        event: eventName(payload),
        hasParts: Array.isArray(dataOf(payload).parts || dataOf(payload).Parts)
      });
      return 0;
    }

    log('Spawn ' + items.length + ' item(s) via ' + sourceLabel, items);
    state.lastIgnoredReason = '';
    state.lastSpawnCount = spawnItems(items);
    return state.lastSpawnCount;
  }

  function sendRaw(obj) {
    if (!state.rawSocket || state.rawSocket.readyState !== WebSocket.OPEN) return false;
    state.rawSocket.send(JSON.stringify(obj));
    return true;
  }

  function closeRaw() {
    if (!state.rawSocket) return;
    try {
      state.rawSocket.onopen = null;
      state.rawSocket.onmessage = null;
      state.rawSocket.onclose = null;
      state.rawSocket.onerror = null;
      state.rawSocket.close();
    } catch (err) {}
    state.rawSocket = null;
    state.connectedRaw = false;
  }

  function refreshSharedConfig() {
    var cfg = window.KappiOverlayConfig
      ? window.KappiOverlayConfig.get()
      : (window.KAPPI_OVERLAY_CONFIG || {});
    CONFIG.host = cfg.host || CONFIG.host;
    CONFIG.port = parseInt(cfg.port || CONFIG.port, 10) || CONFIG.port;
  }

  function connectRaw(force) {
    refreshSharedConfig();

    if (!force && state.rawSocket && (state.rawSocket.readyState === 0 || state.rawSocket.readyState === 1)) {
      return;
    }

    clearTimeout(state.reconnectTimer);
    closeRaw();

    var url = 'ws://' + CONFIG.host + ':' + CONFIG.port + '/';
    debug('Connecting raw WebSocket', { url: url });

    try {
      var ws = new WebSocket(url);
      state.rawSocket = ws;
      var startupSent = false;

      function sendStartupRequests(force) {
        if (startupSent) return;
        if (!state.rawHelloReceived && !force) return;
        startupSent = true;

        sendRaw({
          request: 'GetInfo',
          id: 'kappi-emote-rain-getinfo-' + Date.now()
        });

        state.rawSubscribeSent = sendRaw({
          request: 'Subscribe',
          id: 'kappi-emote-rain-subscribe-' + Date.now(),
          events: {
            Twitch: ['ChatMessage']
          }
        });
      }

      ws.onopen = function () {
        state.connectedRaw = true;
        state.rawHelloReceived = false;
        state.rawGetInfoOk = false;
        state.rawSubscribeSent = false;
        log('Raw WebSocket connected.', { url: url });
        setTimeout(function () { sendStartupRequests(true); }, 2000);
      };

      ws.onmessage = function (event) {
        var payload;
        try {
          payload = JSON.parse(event.data);
        } catch (err) {
          warn('Invalid raw WebSocket JSON.', event.data);
          return;
        }

        if (payload && (payload.request === 'Hello' || payload.Request === 'Hello')) {
          state.rawHelloReceived = true;
          debug('Server hello', payload);
          sendStartupRequests(false);
          return;
        }

        if (payload && payload.id && String(payload.id).indexOf('kappi-emote-rain-getinfo-') === 0 && payload.status === 'ok') {
          state.rawGetInfoOk = true;
        }
        if (payload && payload.id && String(payload.id).indexOf('kappi-emote-rain-subscribe-') === 0 && payload.status === 'ok') {
          state.rawSubscribeSent = true;
        }

        if (payload && payload.status) {
          debug('Server response', payload);
        }

        handlePayload(payload, 'raw WebSocket');
      };

      ws.onclose = function (event) {
        state.connectedRaw = false;
        warn('Raw WebSocket closed. Reconnect follows.', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean
        });
        state.reconnectTimer = setTimeout(function () { connectRaw(false); }, CONFIG.reconnectMs);
      };

      ws.onerror = function (event) {
        state.connectedRaw = false;
        warn('Raw WebSocket error.', event);
      };
    } catch (err) {
      warn('Raw WebSocket start failed.', err);
      state.reconnectTimer = setTimeout(function () { connectRaw(false); }, CONFIG.reconnectMs);
    }
  }

  function ensureClientSubscription() {
    if (!window.client || typeof window.client.subscribe !== 'function') return false;
    if (state.clientSubscribeRequested && state.clientSubscribeOk) return true;

    state.clientSubscribeRequested = true;
    state.clientSubscribeError = null;

    try {
      var result = window.client.subscribe({ Twitch: ['ChatMessage'] });
      if (result && typeof result.then === 'function') {
        result.then(function (response) {
          state.clientSubscribeOk = true;
          debug('window.client Twitch.ChatMessage subscription confirmed.', response);
        }).catch(function (err) {
          state.clientSubscribeOk = false;
          state.clientSubscribeRequested = false;
          state.clientSubscribeError = err;
          warn('window.client Twitch.ChatMessage subscription failed.', err);
        });
      } else {
        state.clientSubscribeOk = true;
      }
      return true;
    } catch (err) {
      state.clientSubscribeOk = false;
      state.clientSubscribeRequested = false;
      state.clientSubscribeError = err;
      warn('window.client Twitch.ChatMessage subscription failed.', err);
      return false;
    }
  }

  function attachWindowClient() {
    if (state.connectedClient) return true;

    if (window.client && typeof window.client.on === 'function') {
      try {
        window.client.on('Twitch.ChatMessage', function (response) {
          handlePayload(withEvent(response, 'Twitch', 'ChatMessage'), 'window.client Twitch.ChatMessage');
        });
        window.client.on('YouTube.Message', function (response) {
          handlePayload(withEvent(response, 'YouTube', 'Message'), 'window.client YouTube.Message');
        });
        window.client.on('Kick.ChatMessage', function (response) {
          handlePayload(withEvent(response, 'Kick', 'ChatMessage'), 'window.client Kick.ChatMessage');
        });
        window.client.on('General.Custom', function (response) {
          handlePayload(withEvent(response, 'General', 'Custom'), 'window.client General.Custom');
        });

        state.connectedClient = true;
        ensureClientSubscription();
        log('Attached to existing window.client.');
        return true;
      } catch (err) {
        warn('window.client exists, but listener registration failed.', err);
      }
    }

    return false;
  }

  function waitForClientOrFallback() {
    attachWindowClient();
    connectRaw(false);

    if (state.attachTimer) clearInterval(state.attachTimer);
    state.attachTimer = setInterval(function () {
      attachWindowClient();
      ensureClientSubscription();
      if (!state.rawSocket || state.rawSocket.readyState > 1) {
        connectRaw(false);
      }
    }, 1000);
  }

  function makeFakePayload() {
    return {
      event: { source: 'Twitch', type: 'ChatMessage' },
      data: {
        messageId: 'fake-' + Date.now(),
        text: 'Fake monkaTOS',
        user: { login: 'kappitest', name: 'KappiTest' },
        parts: [
          { type: 'text', text: 'Fake ' + String.fromCodePoint(0x1F60E) + ' ' + String.fromCodePoint(0x1F602) + ' ' },
          {
            type: 'emote',
            text: 'monkaTOS',
            source: '7TVChannel',
            imageUrl: 'https://cdn.7tv.app/emote/01F6N373G0000F76KNAAV177D4/4x.gif'
          },
          { type: 'text', text: ' ' + String.fromCodePoint(0x1F49C) }
        ]
      }
    };
  }

  function test() {
    return handlePayload(makeFakePayload(), 'fake test');
  }

  function clear() {
    clearActiveItems();
    return true;
  }

  function setDebug(value) {
    CONFIG.debugVisible = !!value;
    ensureDebugBox().style.display = CONFIG.debugVisible ? 'block' : 'none';
    return CONFIG.debugVisible;
  }

  function setConnection(host, port) {
    CONFIG.host = host || CONFIG.host;
    CONFIG.port = parseInt(port || CONFIG.port, 10) || CONFIG.port;
    if (window.KappiOverlayConfig && typeof window.KappiOverlayConfig.save === 'function') {
      window.KappiOverlayConfig.save(CONFIG.host, CONFIG.port);
    }
    closeRaw();
    connectRaw(true);
    return status();
  }

  function setupControlChannel() {
    if (state.controlChannel || typeof window.BroadcastChannel !== 'function') return false;
    try {
      state.controlChannel = new BroadcastChannel(CONTROL_CHANNEL_NAME);
      state.controlChannel.onmessage = function (event) {
        var data = event && event.data ? event.data : {};
        if (data.type === 'emoteRainSettings') {
          setSettings(data.settings || {});
        }
        if (data.type === 'emoteRainClear') {
          clear();
        }
        if (data.type === 'emoteRainTest') {
          test();
        }
      };
      return true;
    } catch (err) {
      warn('Control channel unavailable.', err);
      return false;
    }
  }

  function normalizeRemoteSettings(settings) {
    settings = settings || {};
    return {
      enabled: toBool(settings.enabled, CONFIG.enabled),
      sizeLevel: clampLevel(settings.sizeLevel, CONFIG.sizeLevel),
      speedLevel: clampLevel(settings.speedLevel, CONFIG.speedLevel),
      version: parseInt(settings.version || 3, 10) || 3,
      updatedAt: parseInt(settings.updatedAt || settings.savedAt || Date.now(), 10) || Date.now()
    };
  }

  function settingsSignature(settings) {
    settings = normalizeRemoteSettings(settings);
    return [
      settings.enabled ? '1' : '0',
      settings.sizeLevel,
      settings.speedLevel,
      settings.updatedAt
    ].join('|');
  }

  function applySettings(settings, options) {
    settings = normalizeRemoteSettings(settings);
    options = options || {};
    var wasEnabled = CONFIG.enabled;
    if (typeof settings.enabled === 'boolean') state.manualEnabledOverride = settings.enabled;
    CONFIG.enabled = toBool(settings.enabled, CONFIG.enabled);
    var levelsChanged = applyEffectLevels(settings.sizeLevel || CONFIG.sizeLevel, settings.speedLevel || CONFIG.speedLevel);
    if (!CONFIG.enabled) {
      stopRainNow();
    } else if (levelsChanged || !wasEnabled) {
      updateActiveItems();
    }
    if (options.save !== false) saveEffectSettings();
    if (options.log !== false) {
      log('Effect settings updated.', {
        enabled: CONFIG.enabled,
        sizeLevel: CONFIG.sizeLevel,
        speedLevel: CONFIG.speedLevel,
        emoteSize: CONFIG.emoteSize,
        emojiSize: CONFIG.emojiSize,
        speedMin: CONFIG.speedMin,
        speedMax: CONFIG.speedMax,
        source: options.source || 'local'
      });
    }
    return status();
  }

  function setSettings(settings) {
    return applySettings(settings, { save: true, log: true, source: 'api' });
  }

  function applyBridgeSettings(settings) {
    var normalized = normalizeRemoteSettings(settings);
    state.bridgeSettings = normalized;
    state.bridgeOk = true;
    state.bridgeError = null;
    state.bridgeLastAppliedAt = new Date().toISOString();
    return applySettings(normalized, { save: false, log: false, source: 'bridge' });
  }

  function pollBridgeSettings() {
    if (state.bridgeRequestInFlight || typeof XMLHttpRequest === 'undefined') return;
    state.bridgeRequestInFlight = true;

    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', BRIDGE_SETTINGS_URL + '?_=' + Date.now(), true);
      xhr.timeout = 1200;
      xhr.onload = function () {
        if (xhr.status < 200 || xhr.status >= 300) {
          state.bridgeOk = false;
          state.bridgeError = 'HTTP ' + xhr.status;
          return;
        }
        try {
          var settings = JSON.parse(xhr.responseText || '{}');
          var signature = settingsSignature(settings);
          if (signature !== state.bridgeLastSignature) {
            state.bridgeLastSignature = signature;
            applyBridgeSettings(settings);
          } else {
            state.bridgeOk = true;
            state.bridgeError = null;
          }
        } catch (err) {
          state.bridgeOk = false;
          state.bridgeError = String(err);
        }
      };
      xhr.onerror = function () {
        state.bridgeOk = false;
        state.bridgeError = 'Bridge nicht erreichbar';
      };
      xhr.ontimeout = function () {
        state.bridgeOk = false;
        state.bridgeError = 'Bridge timeout';
      };
      xhr.onloadend = function () {
        state.bridgeRequestInFlight = false;
      };
      xhr.send();
    } catch (err) {
      state.bridgeRequestInFlight = false;
      state.bridgeOk = false;
      state.bridgeError = String(err);
    }
  }

  function startBridgePolling() {
    if (state.bridgePollTimer) return;
    pollBridgeSettings();
    state.bridgePollTimer = setInterval(pollBridgeSettings, BRIDGE_POLL_MS);
  }

  function status() {
    return {
      loaded: true,
      loadedAt: state.loadedAt,
      active: !!window.__KAPPI_EMOTE_RAIN_ACTIVE__,
      connectedRaw: state.connectedRaw,
      connectedClient: state.connectedClient,
      rawHelloReceived: state.rawHelloReceived,
      rawGetInfoOk: state.rawGetInfoOk,
      rawSubscribeSent: state.rawSubscribeSent,
      clientSubscribeRequested: state.clientSubscribeRequested,
      clientSubscribeOk: state.clientSubscribeOk,
      clientSubscribeError: state.clientSubscribeError,
      host: CONFIG.host,
      port: CONFIG.port,
      enabled: CONFIG.enabled,
      sizeLevel: CONFIG.sizeLevel,
      speedLevel: CONFIG.speedLevel,
      emoteSize: CONFIG.emoteSize,
      emojiSize: CONFIG.emojiSize,
      speedMin: CONFIG.speedMin,
      speedMax: CONFIG.speedMax,
      activeOnScreen: state.activeOnScreen,
      pendingSpawns: state.spawnTimers.length,
      lastSourceLabel: state.lastSourceLabel,
      lastHandledAt: state.lastHandledAt,
      lastIgnoredReason: state.lastIgnoredReason,
      lastSpawnCount: state.lastSpawnCount,
      lastItems: state.lastItems,
      lastPayload: state.lastPayload,
      lastError: state.lastError,
      debugVisible: CONFIG.debugVisible,
      bridgeOk: state.bridgeOk,
      bridgeError: state.bridgeError,
      bridgeLastAppliedAt: state.bridgeLastAppliedAt,
      bridgeSettings: state.bridgeSettings
    };
  }

  window.kappiEmoteRain = {
    status: status,
    test: test,
    clear: clear,
    setDebug: setDebug,
    extractItems: extractItems,
    handlePayload: handlePayload,
    connectRaw: connectRaw,
    setConnection: setConnection,
    setSettings: setSettings
  };

  function start() {
    if (window.addEventListener) {
      window.addEventListener('storage', function (event) {
        if (event && event.key === EFFECT_STORAGE_KEY) refreshEffectSettings();
      });
    }
    setupControlChannel();
    startBridgePolling();
    setInterval(refreshEffectSettings, 1500);
    refreshEffectSettings();
    ensureLayer();
    ensureDebugBox();
    if (window.location && /[?&]debug=1(?:&|$)/.test(window.location.search || '')) {
      setDebug(true);
    }
    log('Loaded in existing overlay layer.', {
      host: CONFIG.host,
      port: CONFIG.port,
      url: location.href,
      diagnoseOnly: DIAGNOSE_ONLY
    });
    if (!DIAGNOSE_ONLY) {
      waitForClientOrFallback();
    }
    if (window.location && /[?&](rainTest|emoteTest)=1(?:&|$)/.test(window.location.search || '')) {
      setDebug(true);
      setTimeout(test, 800);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
