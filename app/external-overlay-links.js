// Loads persistent external overlay links inside the transparent overlay layer.
(function () {
  'use strict';

  if (window.__KAPPI_EXTERNAL_OVERLAYS_ACTIVE__) return;
  window.__KAPPI_EXTERNAL_OVERLAYS_ACTIVE__ = true;

  var STORAGE_KEY = 'kappi.overlay.external.links';
  var LEGACY_STORAGE_KEY = 'kappi.diagnose.broadcast.links';
  var RELOAD_MS = 5000;
  var POSITION_PREVIEW_URL = location.origin + '/position-preview';
  var POSITION_PREVIEW_ACK_URL = location.origin + '/position-preview-ack';
  var POSITION_PREVIEW_POLL_MS = 450;
  var POSITION_PREVIEW_SCRIPT_VERSION = '20260628-ack1';
  var EXTERNAL_LINKS_URL = location.origin + '/external-links';
  var EXTERNAL_LINKS_POLL_MS = 1000;
  var lastSignature = '';
  var lastPreviewSignature = '';
  var lastPreviewAckAt = 0;
  var bridgeLinks = null;
  var bridgeMonitorWidth = 0;
  var bridgeMonitorHeight = 0;

  function log(message, obj) {
    if (window.console && console.log) {
      console.log('[Kappi External Overlays]', message, obj || '');
    }
  }

  function getConnection() {
    if (window.KappiOverlayConfig && typeof window.KappiOverlayConfig.get === 'function') {
      return window.KappiOverlayConfig.get();
    }
    return window.KAPPI_OVERLAY_CONFIG || { host: '127.0.0.1', port: 8081 };
  }

  function readJson(key) {
    try {
      var raw = window.localStorage ? window.localStorage.getItem(key) : '';
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      return [];
    }
  }

  function normalizeLink(link) {
    link = link || {};
    return {
      id: link.id || link.url || ('external-' + Math.floor(Math.random() * 100000)),
      name: link.name || 'Overlay-Link',
      url: link.url || '',
      profile: link.profile || 'auto',
      persistent: link.persistent !== false,
      enabled: link.enabled !== false,
      area: normalizeArea(link.area)
    };
  }

  function toInt(value, fallback) {
    var parsed = parseInt(value, 10);
    return isNaN(parsed) ? fallback : parsed;
  }

  function normalizeArea(area) {
    var cfg = getConnection();
    area = area || {};
    return {
      preset: area.preset || 'full',
      x: Math.max(0, toInt(area.x, 0)),
      y: Math.max(0, toInt(area.y, 0)),
      width: Math.max(20, toInt(area.width, cfg.monitorWidth || window.innerWidth || 1920)),
      height: Math.max(20, toInt(area.height, cfg.monitorHeight || window.innerHeight || 1080))
    };
  }

  function normalizeLinks(links) {
    var out = [];
    if (!Array.isArray(links)) return out;
    for (var i = 0; i < links.length; i++) {
      var item = normalizeLink(links[i]);
      if (isHandledLocally(item)) continue;
      if (item.url && item.enabled && item.persistent) out.push(item);
    }
    return out;
  }

  function isHandledLocally(link) {
    return !!(link && /tawmae\.xyz\/overlays\/giphy-and-sb/i.test(link.url || ''));
  }

  function parseUrl(url) {
    var hashIndex = url.indexOf('#');
    var hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
    var noHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
    var queryIndex = noHash.indexOf('?');
    return {
      base: queryIndex >= 0 ? noHash.slice(0, queryIndex) : noHash,
      query: queryIndex >= 0 ? noHash.slice(queryIndex + 1) : '',
      hash: hash
    };
  }

  function parseQuery(query) {
    var out = [];
    if (!query) return out;
    var pairs = query.split('&');
    for (var i = 0; i < pairs.length; i++) {
      if (!pairs[i]) continue;
      var eq = pairs[i].indexOf('=');
      var key = eq >= 0 ? pairs[i].slice(0, eq) : pairs[i];
      var value = eq >= 0 ? pairs[i].slice(eq + 1) : '';
      out.push({
        key: decodeURIComponent(key || ''),
        value: decodeURIComponent(value || '')
      });
    }
    return out;
  }

  function encodeQuery(pairs) {
    var out = [];
    for (var i = 0; i < pairs.length; i++) {
      if (!pairs[i].key) continue;
      out.push(encodeURIComponent(pairs[i].key) + '=' + encodeURIComponent(pairs[i].value || ''));
    }
    return out.join('&');
  }

  function setQueryValues(url, values) {
    var parts = parseUrl(url);
    var pairs = parseQuery(parts.query);
    var lower = {};
    var key;

    for (key in values) {
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        lower[String(key).toLowerCase()] = { key: key, value: values[key] };
      }
    }

    var next = [];
    for (var i = 0; i < pairs.length; i++) {
      var lowered = String(pairs[i].key || '').toLowerCase();
      if (lower[lowered]) {
        next.push({ key: pairs[i].key, value: lower[lowered].value });
        delete lower[lowered];
      } else {
        next.push(pairs[i]);
      }
    }

    for (key in lower) {
      if (Object.prototype.hasOwnProperty.call(lower, key)) next.push(lower[key]);
    }

    var query = encodeQuery(next);
    return parts.base + (query ? '?' + query : '') + parts.hash;
  }

  // Cloud-/Server-gehostete Overlays (Streamlabs, StreamElements, ...) laufen NICHT
  // ueber deinen lokalen Streamer.bot. Ihnen Adresse/Port anzuhaengen zerstoert den Link.
  function isCloudHostedOverlay(url) {
    var m = String(url || '').match(/^[a-z][a-z0-9+.-]*:\/\/([^\/?#]+)/i);
    if (!m) return false;
    var host = m[1].split('@').pop().split(':')[0].toLowerCase();
    var cloud = [
      'streamlabs.com', 'streamelements.com',
      'nightbot.tv', 'kick.com', 'twitch.tv', 'youtube.com', 'youtu.be',
      'ko-fi.com', 'streamlabs.link', 'social-stream.ninja', 'onstream.gg',
      'lumiastream.com', 'muxy.io', 'crowdcontrol.live',
      'tipeeestream.com', 'donationalerts.com', 'streamdps.com', 'pretzel.rocks'
    ];
    for (var i = 0; i < cloud.length; i++) {
      if (host === cloud[i] || host.slice(-(cloud[i].length + 1)) === '.' + cloud[i]) return true;
    }
    return false;
  }

  // Verbindungs-Parameter (evtl. frueher fest eingebacken) aus einer URL entfernen.
  var CONNECTION_QUERY_KEYS = [
    'address', 'addr', 'host', 'hostname', 'ip', 'port',
    'server', 'serveraddress', 'ws', 'wsurl',
    'websocket', 'websocketurl', 'socketurl',
    'monitorwidth', 'monitorheight'
  ];
  function stripConnectionParams(url) {
    var parts = parseUrl(url);
    var pairs = parseQuery(parts.query);
    var kept = [];
    for (var i = 0; i < pairs.length; i++) {
      var lk = String(pairs[i].key || '').toLowerCase();
      if (CONNECTION_QUERY_KEYS.indexOf(lk) < 0) kept.push(pairs[i]);
    }
    var query = encodeQuery(kept);
    return parts.base + (query ? '?' + query : '') + parts.hash;
  }

  // Lokaler Relay-Proxy der Bridge. HTTPS-Overlays (z. B. ChatRD von github.io)
  // duerfen aus Browser-Sicht KEIN unverschluesseltes ws:// zu einer LAN-IP
  // aufbauen (Mixed Content) - nur zu 127.0.0.1. Laeuft Streamer.bot auf einem
  // anderen PC, leiten wir solche Overlays ueber 127.0.0.1:PROXY, das die Bridge
  // transparent zum echten Streamer.bot weiterreicht.
  var PROXY_HOST = '127.0.0.1';
  var PROXY_PORT = 18082;

  function needsProxy(url, host) {
    return /^https:/i.test(String(url || '')) &&
      !/^(127\.0\.0\.1|localhost|\[?::1\]?)$/i.test(String(host || ''));
  }

  // Alle bereits in der URL vorhandenen Adress-/Port-Parameter auf den Proxy
  // umbiegen - noetig fuer Overlays mit eigenen Schluesseln (ChatRD:
  // streamerBotServerAddress / streamerBotServerPort). speakerBot* bleibt unberuehrt.
  var PROXY_ADDR_KEYS = ['address', 'addr', 'host', 'hostname', 'ip', 'server', 'serveraddress', 'streamerbotserveraddress'];
  var PROXY_PORT_KEYS = ['port', 'streamerbotserverport'];
  var PROXY_WS_KEYS = ['ws', 'wsurl', 'websocket', 'websocketurl', 'socketurl'];
  function rewriteConnectionParamsToProxy(url) {
    var parts = parseUrl(url);
    var pairs = parseQuery(parts.query);
    var wsUrl = 'ws://' + PROXY_HOST + ':' + PROXY_PORT + '/';
    for (var i = 0; i < pairs.length; i++) {
      var lk = String(pairs[i].key || '').toLowerCase();
      if (PROXY_ADDR_KEYS.indexOf(lk) >= 0) pairs[i].value = PROXY_HOST;
      else if (PROXY_PORT_KEYS.indexOf(lk) >= 0) pairs[i].value = String(PROXY_PORT);
      else if (PROXY_WS_KEYS.indexOf(lk) >= 0) pairs[i].value = wsUrl;
    }
    var query = encodeQuery(pairs);
    return parts.base + (query ? '?' + query : '') + parts.hash;
  }

  function applyConnection(link) {
    var cfg = getConnection();
    var url = link.url;
    var profile = link.profile || 'auto';

    // Sicherheitsnetz: Cloud-Overlays NIE eigene Adresse/Port anhaengen und
    // evtl. schon eingebackene wieder ENTFERNEN, egal welches Profil gespeichert ist.
    if (isCloudHostedOverlay(url)) return stripConnectionParams(url);

    if (profile === 'auto' && /tawmae\.xyz\/overlays\/giphy-and-sb/i.test(url)) {
      profile = 'address-port';
    }

    // Ziel-Host/-Port bestimmen: HTTPS-Overlay + SB nicht auf localhost -> Proxy.
    var proxied = needsProxy(url, cfg.host);
    var host = proxied ? PROXY_HOST : cfg.host;
    var port = proxied ? PROXY_PORT : cfg.port;
    var wsUrl = 'ws://' + host + ':' + port + '/';

    var out;
    if (profile === 'none') out = url;
    else if (profile === 'host-port') out = setQueryValues(url, { host: host, port: port });
    else if (profile === 'server-port') out = setQueryValues(url, { server: host, port: port });
    else if (profile === 'ip-port') out = setQueryValues(url, { ip: host, port: port });
    else if (profile === 'ws') out = setQueryValues(url, { ws: wsUrl });
    else if (profile === 'websocket') out = setQueryValues(url, { websocket: wsUrl });
    else if (profile === 'websocketUrl') out = setQueryValues(url, { websocketUrl: wsUrl });
    else out = setQueryValues(url, { address: host, port: port });

    // Bei Proxy zusaetzlich alle schon eingebackenen Verbindungs-Parameter umbiegen.
    if (proxied) out = rewriteConnectionParamsToProxy(out);
    return out;
  }

  function configuredLinks() {
    if (window.KappiOverlayConfig && typeof window.KappiOverlayConfig.getExternalLinks === 'function') {
      return normalizeLinks(window.KappiOverlayConfig.getExternalLinks());
    }
    return normalizeLinks(window.KAPPI_EXTERNAL_OVERLAY_LINKS || []);
  }

  function storedLinks() {
    var current = normalizeLinks(readJson(STORAGE_KEY));
    if (current.length) return current;
    return normalizeLinks(readJson(LEGACY_STORAGE_KEY));
  }

  function getLinks() {
    if (getConnection().overlaysEnabled === false) return [];
    var map = {};
    var out = [];
    var sources = bridgeLinks !== null ? [bridgeLinks] : [configuredLinks(), storedLinks()];

    for (var s = 0; s < sources.length; s++) {
      for (var i = 0; i < sources[s].length; i++) {
        var item = sources[s][i];
        var key = item.id || item.url;
        if (map[key]) continue;
        map[key] = true;
        out.push(item);
      }
    }

    return out;
  }

  function pollExternalLinks() {
    if (typeof XMLHttpRequest === 'undefined') return;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', EXTERNAL_LINKS_URL + '?t=' + Date.now(), true);
      xhr.timeout = 900;
      xhr.onload = function () {
        if (xhr.status < 200 || xhr.status >= 300) return;
        try {
          var response = JSON.parse(xhr.responseText || '{}');
          bridgeMonitorWidth = Math.max(100, toInt(response.monitorWidth, window.innerWidth || 1920));
          bridgeMonitorHeight = Math.max(100, toInt(response.monitorHeight, window.innerHeight || 1080));
          bridgeLinks = normalizeLinks(response.links || []);
          render(false);
        } catch (err) {}
      };
      xhr.send();
    } catch (err) {}
  }

  function ensureLayer() {
    var layer = document.getElementById('kappi-external-overlay-layer');
    if (layer) return layer;

    layer = document.createElement('div');
    layer.id = 'kappi-external-overlay-layer';
    layer.style.position = 'fixed';
    layer.style.left = '0';
    layer.style.top = '0';
    layer.style.width = '100vw';
    layer.style.height = '100vh';
    layer.style.overflow = 'hidden';
    layer.style.pointerEvents = 'none';
    layer.style.background = 'transparent';

    if (document.body.firstChild) {
      document.body.insertBefore(layer, document.body.firstChild);
    } else {
      document.body.appendChild(layer);
    }
    return layer;
  }

  function ensurePreviewLayer() {
    var layer = document.getElementById('kappi-position-preview-layer');
    if (layer) return layer;

    layer = document.createElement('div');
    layer.id = 'kappi-position-preview-layer';
    layer.style.position = 'fixed';
    layer.style.left = '0';
    layer.style.top = '0';
    layer.style.width = '100vw';
    layer.style.height = '100vh';
    layer.style.overflow = 'hidden';
    layer.style.pointerEvents = 'none';
    layer.style.background = 'transparent';
    layer.style.zIndex = '2147483600';
    document.body.appendChild(layer);
    return layer;
  }

  function previewAreaFromPayload(payload) {
    payload = payload || {};
    var monitorWidth = Math.max(100, toInt(payload.monitorWidth, window.innerWidth || 1920));
    var monitorHeight = Math.max(100, toInt(payload.monitorHeight, window.innerHeight || 1080));
    var area = normalizeArea(payload.area || {});

    if (area.preset === 'full') {
      area.x = 0;
      area.y = 0;
      area.width = monitorWidth;
      area.height = monitorHeight;
    }

    area.width = Math.max(20, Math.min(area.width, monitorWidth));
    area.height = Math.max(20, Math.min(area.height, monitorHeight));
    area.x = Math.max(0, Math.min(area.x, Math.max(0, monitorWidth - area.width)));
    area.y = Math.max(0, Math.min(area.y, Math.max(0, monitorHeight - area.height)));

    return {
      monitorWidth: monitorWidth,
      monitorHeight: monitorHeight,
      area: area
    };
  }

  function activePositionPreviewItems(payload) {
    var now = Date.now();
    var items = [];
    if (!payload) return items;

    if (Array.isArray(payload.items) && payload.items.length) {
      for (var i = 0; i < payload.items.length; i++) {
        var item = payload.items[i];
        if (item && item.visible && (!item.expiresAt || item.expiresAt > now)) items.push(item);
      }
      return items;
    }

    if (payload.visible && (!payload.expiresAt || payload.expiresAt > now)) items.push(payload);
    return items;
  }

  function appendPositionPreviewFrame(layer, payload) {
    var normalized = previewAreaFromPayload(payload);
    var scaleX = (window.innerWidth || normalized.monitorWidth) / normalized.monitorWidth;
    var scaleY = (window.innerHeight || normalized.monitorHeight) / normalized.monitorHeight;
    var area = normalized.area;

    var frame = document.createElement('div');
    frame.style.position = 'absolute';
    frame.style.left = Math.round(area.x * scaleX) + 'px';
    frame.style.top = Math.round(area.y * scaleY) + 'px';
    frame.style.width = Math.round(area.width * scaleX) + 'px';
    frame.style.height = Math.round(area.height * scaleY) + 'px';
    frame.style.border = '4px solid rgba(48, 150, 255, .98)';
    frame.style.background = 'rgba(48, 150, 255, .16)';
    frame.style.boxShadow = '0 0 0 2px rgba(0, 0, 0, .48), 0 0 24px rgba(48, 150, 255, .85), inset 0 0 22px rgba(48, 150, 255, .28)';
    frame.style.boxSizing = 'border-box';

    var label = document.createElement('div');
    label.textContent = (payload.name || 'Overlay-Position') + ' | ' + area.x + ':' + area.y + ' | ' + area.width + 'x' + area.height;
    label.style.position = 'absolute';
    label.style.left = '8px';
    label.style.top = '8px';
    label.style.maxWidth = 'calc(100% - 16px)';
    label.style.padding = '6px 9px';
    label.style.borderRadius = '5px';
    label.style.background = 'rgba(4, 10, 18, .82)';
    label.style.color = '#e7f1ff';
    label.style.font = '700 13px Consolas, monospace';
    label.style.whiteSpace = 'nowrap';
    label.style.overflow = 'hidden';
    label.style.textOverflow = 'ellipsis';
    frame.appendChild(label);

    layer.appendChild(frame);
  }

  function renderPositionPreview(payload) {
    var layer = ensurePreviewLayer();
    var items = activePositionPreviewItems(payload);
    reportPositionPreview(items);
    var signature = items.length ? JSON.stringify(items) : 'hidden';
    if (signature === lastPreviewSignature) return;
    lastPreviewSignature = signature;

    layer.innerHTML = '';
    for (var i = 0; i < items.length; i++) appendPositionPreviewFrame(layer, items[i]);
  }

  function reportPositionPreview(items) {
    var now = Date.now();
    if (now - lastPreviewAckAt < 1000 || typeof XMLHttpRequest === 'undefined') return;
    lastPreviewAckAt = now;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', POSITION_PREVIEW_ACK_URL, true);
      xhr.timeout = 700;
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify({
        frames: items.length,
        scriptVersion: POSITION_PREVIEW_SCRIPT_VERSION,
        width: window.innerWidth || 0,
        height: window.innerHeight || 0
      }));
    } catch (err) {}
  }

  function pollPositionPreview() {
    if (typeof XMLHttpRequest === 'undefined') return;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', POSITION_PREVIEW_URL + '?t=' + Date.now(), true);
      xhr.timeout = 700;
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            renderPositionPreview(JSON.parse(xhr.responseText || '{}'));
          } catch (err) {
            renderPositionPreview(null);
          }
        }
      };
      xhr.onerror = function () { renderPositionPreview(null); };
      xhr.ontimeout = xhr.onerror;
      xhr.send();
    } catch (err) {}
  }

  function makeFrame(link) {
    var frame = document.createElement('iframe');
    var area = normalizeArea(link.area);
    var sourceWidth = bridgeMonitorWidth || window.innerWidth || 1920;
    var sourceHeight = bridgeMonitorHeight || window.innerHeight || 1080;
    var scaleX = (window.innerWidth || sourceWidth) / sourceWidth;
    var scaleY = (window.innerHeight || sourceHeight) / sourceHeight;
    frame.title = link.name || 'External Overlay';
    // Kein Referer senden -> wie eine OBS-Browserquelle. Streamlabs & Co. liefern
    // sonst 404, wenn ein fremder Referer (127.0.0.1:<Port>) mitgeschickt wird.
    frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.src = applyConnection(link);
    frame.allow = 'autoplay; fullscreen; clipboard-read; clipboard-write; local-network-access';
    frame.setAttribute('allowtransparency', 'true');
    frame.style.position = 'absolute';
    frame.style.left = area.preset === 'full' ? '0' : Math.round(area.x * scaleX) + 'px';
    frame.style.top = area.preset === 'full' ? '0' : Math.round(area.y * scaleY) + 'px';
    frame.style.width = area.preset === 'full' ? '100vw' : Math.round(area.width * scaleX) + 'px';
    frame.style.height = area.preset === 'full' ? '100vh' : Math.round(area.height * scaleY) + 'px';
    frame.style.border = '0';
    frame.style.margin = '0';
    frame.style.padding = '0';
    frame.style.background = 'transparent';
    frame.style.pointerEvents = 'none';
    return frame;
  }

  function signatureFor(links) {
    var sourceWidth = bridgeMonitorWidth || window.innerWidth || 1920;
    var sourceHeight = bridgeMonitorHeight || window.innerHeight || 1080;
    var parts = [
      'geometry|' + sourceWidth + 'x' + sourceHeight +
      '|' + (window.innerWidth || sourceWidth) + 'x' + (window.innerHeight || sourceHeight)
    ];
    for (var i = 0; i < links.length; i++) {
      parts.push(links[i].id + '|' + links[i].name + '|' + applyConnection(links[i]) + '|' + JSON.stringify(normalizeArea(links[i].area)));
    }
    return parts.join('\n');
  }

  function render(force) {
    var links = getLinks();
    var signature = signatureFor(links);
    if (!force && signature === lastSignature) return;
    lastSignature = signature;

    var layer = ensureLayer();
    layer.innerHTML = '';

    for (var i = 0; i < links.length; i++) {
      layer.appendChild(makeFrame(links[i]));
    }

    log('Loaded external overlay link(s).', links);
  }

  // --- Internet-Waechter: nach einem PC-Neustart ist das Netz oft noch nicht
  // bereit, wenn das Overlay startet. Die iframes laden dann ins Leere und
  // wuerden ewig leer bleiben. Darum: Erreichbarkeit der externen Links testen
  // und die Frames SOFORT neu laden, sobald das Internet da ist. ---
  var netKnownGood = false;
  var netProbeTimer = null;
  var NET_PROBE_MS = 3000;

  function externalProbeUrl() {
    var links = getLinks();
    for (var i = 0; i < links.length; i++) {
      var url = String(links[i].url || '');
      if (/^https?:\/\//i.test(url) && !/^https?:\/\/(127\.0\.0\.1|localhost|192\.168\.|10\.)/i.test(url)) {
        var m = /^(https?:\/\/[^\/]+)/i.exec(url);
        if (m) return m[1] + '/favicon.ico';
      }
    }
    return '';
  }

  function probeInternet() {
    var probe = externalProbeUrl();
    if (!probe || typeof fetch !== 'function') { netKnownGood = true; return; }
    fetch(probe, { mode: 'no-cors', cache: 'no-store' }).then(function () {
      if (!netKnownGood) {
        netKnownGood = true;
        log('Internet erreichbar - lade externe Overlay-Links neu.');
        render(true);   // Frames neu laden, jetzt klappt es
      }
      stopNetProbe();
    }).catch(function () {
      netKnownGood = false; // weiter warten; Timer laeuft
    });
  }

  function startNetProbe() {
    if (netProbeTimer) return;
    netProbeTimer = window.setInterval(probeInternet, NET_PROBE_MS);
    probeInternet();
  }
  function stopNetProbe() {
    if (netProbeTimer) { window.clearInterval(netProbeTimer); netProbeTimer = null; }
  }

  window.addEventListener('online', function () {
    netKnownGood = false;   // Verbindung kam (neu) - Frames sicherheitshalber neu laden
    startNetProbe();
  });

  window.kappiExternalOverlays = {
    reload: function () { render(true); },
    status: function () {
      return {
        active: true,
        links: getLinks(),
        layer: !!document.getElementById('kappi-external-overlay-layer')
      };
    },
    hide: function () {
      var layer = ensureLayer();
      layer.style.display = 'none';
    },
    show: function () {
      var layer = ensureLayer();
      layer.style.display = 'block';
      render(true);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      render(true);
      pollPositionPreview();
      pollExternalLinks();
      startNetProbe();
    });
  } else {
    render(true);
    pollPositionPreview();
    pollExternalLinks();
    startNetProbe();
  }

  window.addEventListener('storage', function (event) {
    if (!event || event.key === STORAGE_KEY || event.key === LEGACY_STORAGE_KEY) render(true);
  });
  window.addEventListener('resize', function () { render(false); });
  window.setInterval(function () { render(false); }, RELOAD_MS);
  window.setInterval(pollPositionPreview, POSITION_PREVIEW_POLL_MS);
  window.setInterval(pollExternalLinks, EXTERNAL_LINKS_POLL_MS);
})();
