(function () {
  'use strict';

  var STORAGE_KEY = 'kappi.overlay.websocket.config';
  var LINK_STORAGE_KEY = 'kappi.overlay.external.links';
  var DEFAULTS = {
    host: '127.0.0.1',
    port: 8081,
    monitorPreset: 'auto',
    monitorWidth: 1920,
    monitorHeight: 1080,
    overlaysEnabled: true,
    emoteRain: {
      enabled: true,
      sizeLevel: 6,
      speedLevel: 5
    }
  };
  var DEFAULT_EXTERNAL_LINKS = [];
  // Die Bridge-Datei data/config/websocket-config.json ist die verbindliche
  // Quelle fuer Host/Port. Der Wert bleibt nur im Arbeitsspeicher und enthaelt
  // deshalb keine persoenlichen Daten im ausgelieferten Quellcode.
  var sharedConnection = null;

  function toInt(value, fallback) {
    var parsed = parseInt(value, 10);
    return isNaN(parsed) ? fallback : parsed;
  }

  function parseQuery() {
    var out = {};
    var query = window.location && window.location.search ? window.location.search.replace(/^\?/, '') : '';
    if (!query) return out;

    var parts = query.split('&');
    for (var i = 0; i < parts.length; i++) {
      var pair = parts[i].split('=');
      var key = decodeURIComponent(pair[0] || '');
      var value = decodeURIComponent(pair.slice(1).join('=') || '');
      if (key === 'host' && value) out.host = value;
      if (key === 'port' && value) out.port = toInt(value, DEFAULTS.port);
      if (key === 'monitorPreset' && value) out.monitorPreset = value;
      if ((key === 'monitorWidth' || key === 'width') && value) out.monitorWidth = toInt(value, DEFAULTS.monitorWidth);
      if ((key === 'monitorHeight' || key === 'height') && value) out.monitorHeight = toInt(value, DEFAULTS.monitorHeight);
      if (key === 'overlaysEnabled' && value) out.overlaysEnabled = value !== '0' && value !== 'false';
      if (key === 'emoteRainEnabled' && value) {
        out.emoteRain = out.emoteRain || {};
        out.emoteRain.enabled = value !== '0' && value !== 'false';
      }
      if ((key === 'emoteRainSize' || key === 'rainSize' || key === 'sizeLevel') && value) {
        out.emoteRain = out.emoteRain || {};
        out.emoteRain.sizeLevel = toInt(value, DEFAULTS.emoteRain.sizeLevel);
      }
      if ((key === 'emoteRainSpeed' || key === 'rainSpeed' || key === 'speedLevel') && value) {
        out.emoteRain = out.emoteRain || {};
        out.emoteRain.speedLevel = toInt(value, DEFAULTS.emoteRain.speedLevel);
      }
    }
    return out;
  }

  function readStored() {
    try {
      var raw = window.localStorage ? window.localStorage.getItem(STORAGE_KEY) : '';
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      return {};
    }
  }

  function normalize(input) {
    var cfg = input || {};
    var emoteRain = cfg.emoteRain || {};
    return {
      host: cfg.host || DEFAULTS.host,
      port: toInt(cfg.port, DEFAULTS.port),
      monitorPreset: cfg.monitorPreset || DEFAULTS.monitorPreset,
      monitorWidth: toInt(cfg.monitorWidth, DEFAULTS.monitorWidth),
      monitorHeight: toInt(cfg.monitorHeight, DEFAULTS.monitorHeight),
      overlaysEnabled: typeof cfg.overlaysEnabled === 'boolean' ? cfg.overlaysEnabled : DEFAULTS.overlaysEnabled,
      emoteRain: {
        enabled: typeof emoteRain.enabled === 'boolean' ? emoteRain.enabled : DEFAULTS.emoteRain.enabled,
        sizeLevel: toInt(emoteRain.sizeLevel, DEFAULTS.emoteRain.sizeLevel),
        speedLevel: toInt(emoteRain.speedLevel, DEFAULTS.emoteRain.speedLevel)
      }
    };
  }

  function normalizeArea(area) {
    area = area || {};
    return {
      preset: area.preset || 'full',
      x: toInt(area.x, 0),
      y: toInt(area.y, 0),
      width: toInt(area.width, DEFAULTS.monitorWidth),
      height: toInt(area.height, DEFAULTS.monitorHeight)
    };
  }

  function normalizeLink(link) {
    link = link || {};
    return {
      id: link.id || ('external-' + Date.now() + '-' + Math.floor(Math.random() * 100000)),
      name: link.name || 'Overlay-Link',
      url: link.url || '',
      profile: link.profile || 'auto',
      persistent: typeof link.persistent === 'boolean' ? link.persistent : true,
      enabled: typeof link.enabled === 'boolean' ? link.enabled : true,
      area: normalizeArea(link.area)
    };
  }

  function normalizeLinks(links) {
    var out = [];
    if (!Array.isArray(links)) return out;
    for (var i = 0; i < links.length; i++) {
      var item = normalizeLink(links[i]);
      if (item.url) out.push(item);
    }
    return out;
  }

  function get() {
    var stored = readStored();
    var query = parseQuery();
    return normalize({
      host: query.host || (sharedConnection && sharedConnection.host) || stored.host || DEFAULTS.host,
      port: query.port || (sharedConnection && sharedConnection.port) || stored.port || DEFAULTS.port,
      monitorPreset: query.monitorPreset || stored.monitorPreset || DEFAULTS.monitorPreset,
      monitorWidth: query.monitorWidth || stored.monitorWidth || DEFAULTS.monitorWidth,
      monitorHeight: query.monitorHeight || stored.monitorHeight || DEFAULTS.monitorHeight,
      overlaysEnabled: typeof query.overlaysEnabled === 'boolean' ? query.overlaysEnabled : stored.overlaysEnabled,
      emoteRain: {
        enabled: query.emoteRain && typeof query.emoteRain.enabled === 'boolean'
          ? query.emoteRain.enabled
          : stored.emoteRain && typeof stored.emoteRain.enabled === 'boolean'
            ? stored.emoteRain.enabled
            : DEFAULTS.emoteRain.enabled,
        sizeLevel: query.emoteRain && query.emoteRain.sizeLevel
          ? query.emoteRain.sizeLevel
          : stored.emoteRain && stored.emoteRain.sizeLevel || DEFAULTS.emoteRain.sizeLevel,
        speedLevel: query.emoteRain && query.emoteRain.speedLevel
          ? query.emoteRain.speedLevel
          : stored.emoteRain && stored.emoteRain.speedLevel || DEFAULTS.emoteRain.speedLevel
      }
    });
  }

  // Geteilte Verbindungsdaten (Host/Port) an die Bridge schreiben. Grund: Der
  // localStorage der Einstellungsseite (externer Browser) und des Overlays
  // (WebView2 in der EXE) ist getrennt. Die Bridge-Datei websocket-config.json
  // ist der EINE gemeinsame Ort, den beide Umgebungen lesen. Best effort - ein
  // Fehler hier darf das lokale Speichern nie blockieren.
  function postSharedConfig(host, port) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/websocket-config', true);
      xhr.timeout = 2000;
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify({ host: host, port: port }));
    } catch (err) {}
  }

  function applyShared(input) {
    if (!input || !input.host || !input.port) return null;
    sharedConnection = {
      host: String(input.host),
      port: toInt(input.port, DEFAULTS.port)
    };
    window.KAPPI_OVERLAY_CONFIG = get();
    return window.KAPPI_OVERLAY_CONFIG;
  }

  // Geteilte Verbindungsdaten von der Bridge holen. Liefert dem Callback entweder
  // { host, port } (wenn konfiguriert) oder null (dann gilt der lokale Default).
  function fetchShared(callback) {
    var done = false;
    function finish(result) {
      if (done) return;
      done = true;
      try { callback(result); } catch (err) {}
    }
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', '/websocket-config?_=' + Date.now(), true);
      xhr.timeout = 2000;
      xhr.onload = function () {
        try {
          var r = JSON.parse(xhr.responseText || '{}');
          if (r && r.configured && r.host && r.port) {
            var applied = applyShared({ host: r.host, port: r.port });
            finish({ host: applied.host, port: applied.port });
            return;
          }
        } catch (err) {}
        finish(null);
      };
      xhr.onerror = function () { finish(null); };
      xhr.ontimeout = function () { finish(null); };
      xhr.send();
    } catch (err) {
      finish(null);
    }
  }

  // Die Einstellungsseite muss Host/Port kennen, bevor sie gespeicherte Links
  // repariert und Vorschauen erzeugt. Der lokale Bridge-Aufruf ist bewusst
  // synchron und hat ein schnelles Fehler-Fallback auf den bisherigen Stand.
  function fetchSharedSync() {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', '/websocket-config?_=' + Date.now(), false);
      xhr.send();
      if (xhr.status >= 200 && xhr.status < 300) {
        var r = JSON.parse(xhr.responseText || '{}');
        if (r && r.configured && r.host && r.port) return applyShared(r);
      }
    } catch (err) {}
    return null;
  }

  function save(host, port, monitor) {
    var input = typeof host === 'object'
      ? host
      : {
          host: host,
          port: port,
          monitorPreset: monitor && monitor.monitorPreset,
          monitorWidth: monitor && monitor.monitorWidth,
          monitorHeight: monitor && monitor.monitorHeight,
          overlaysEnabled: monitor && monitor.overlaysEnabled,
          emoteRain: monitor && monitor.emoteRain
        };
    var cfg = normalize(input);
    sharedConnection = { host: cfg.host, port: cfg.port };
    if (window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    }
    postSharedConfig(cfg.host, cfg.port);
    window.KAPPI_OVERLAY_CONFIG = cfg;
    return cfg;
  }

  function clear() {
    if (window.localStorage) window.localStorage.removeItem(STORAGE_KEY);
    window.KAPPI_OVERLAY_CONFIG = normalize(DEFAULTS);
    return window.KAPPI_OVERLAY_CONFIG;
  }

  function saveEmoteRain(settings) {
    var current = get();
    current.emoteRain = {
      enabled: typeof settings.enabled === 'boolean' ? settings.enabled : current.emoteRain.enabled,
      sizeLevel: toInt(settings.sizeLevel, current.emoteRain.sizeLevel),
      speedLevel: toInt(settings.speedLevel, current.emoteRain.speedLevel)
    };
    return save(current);
  }

  function readStoredLinks() {
    try {
      var raw = window.localStorage ? window.localStorage.getItem(LINK_STORAGE_KEY) : '';
      return raw ? normalizeLinks(JSON.parse(raw)) : [];
    } catch (err) {
      return [];
    }
  }

  function getExternalLinks() {
    var stored = readStoredLinks();
    return stored.length ? stored : normalizeLinks(DEFAULT_EXTERNAL_LINKS);
  }

  function saveExternalLinks(links) {
    var normalized = normalizeLinks(links);
    if (window.localStorage) {
      window.localStorage.setItem(LINK_STORAGE_KEY, JSON.stringify(normalized));
    }
    window.KAPPI_EXTERNAL_OVERLAY_LINKS = normalized;
    return normalized;
  }

  function readIndex(callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'index.html?_=' + Date.now(), true);
    xhr.onload = function () {
      var text = xhr.responseText || '';
      var hostMatch = text.match(/host:\s*['"]([^'"]+)['"]/);
      var portMatch = text.match(/port:\s*([0-9]+)/);
      callback({
        ok: xhr.status >= 200 && xhr.status < 400 || xhr.status === 0,
        usesSharedConfig: text.indexOf('overlay-config.js') >= 0,
        host: hostMatch ? hostMatch[1] : get().host,
        port: portMatch ? toInt(portMatch[1], get().port) : get().port
      });
    };
    xhr.onerror = function () {
      callback({
        ok: false,
        usesSharedConfig: false,
        host: get().host,
        port: get().port
      });
    };
    xhr.send();
  }

  window.KappiOverlayConfig = {
    storageKey: STORAGE_KEY,
    linkStorageKey: LINK_STORAGE_KEY,
    defaults: DEFAULTS,
    get: get,
    save: save,
    fetchShared: fetchShared,
    fetchSharedSync: fetchSharedSync,
    applyShared: applyShared,
    saveEmoteRain: saveEmoteRain,
    clear: clear,
    getExternalLinks: getExternalLinks,
    saveExternalLinks: saveExternalLinks,
    readIndex: readIndex
  };

  window.KAPPI_OVERLAY_CONFIG = get();
  window.KAPPI_EXTERNAL_OVERLAY_LINKS = getExternalLinks();
})();
