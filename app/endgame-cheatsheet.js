/*
 * Endgame-Speckzettel (Cheat-Sheet): blendet Text-Kaesten auf dem Monitor ein -
 * fuer Raid-/Spiel-Notizen. MEHRERE Texte koennen GLEICHZEITIG angezeigt werden,
 * jeder an seiner eigenen Position. Kommt ueber die Bridge (/cheatsheet, jetzt
 * eine LISTE: { items: [...] }; alte Einzelform wird weiter unterstuetzt).
 * Rahmenfarbe und Hintergrundbild unabhängig, Transparenz, Textfarbe, Schriftart - pro Text.
 * Ein Streamer.bot-Trigger blendet den jeweiligen Text ein/aus (pro Text-ID).
 * Laeuft im echten Overlay (index.html).
 */
(function () {
  'use strict';
  if (window.__KAPPI_CHEATSHEET_ACTIVE__) return;
  window.__KAPPI_CHEATSHEET_ACTIVE__ = true;

  var URL_ = location.origin + '/cheatsheet';
  var POLL_MS = 400;   // schnell nachziehen (wie overlay-images.js) - Aenderungen erscheinen zuegig
  var LAYER_ID = 'kappi-cheatsheet-layer';
  var lastKey = '';
  var lastItems = [];
  var trigVis = {};   // pro Text-ID: per Streamer.bot-Trigger ein-/ausgeblendet (unabh. vom Schalter)
  var trigKeys = {};  // erkennt ausgeschaltete oder geaenderte Trigger und verwirft alte Sichtbarkeit
  var lastEnabledCs = {}; // zuletzt gesehener Schalter-Zustand je Text (Flanken-Erkennung, s.u.)

  // Streamer.bot-Globals fuer Notiz-Tokens:
  // {{sb:Name}} = gespeichert, {{sb-temp:Name}} = temporaer.
  // Der bereits vorhandene window.client wird wiederverwendet; kein zweiter Socket.
  var noteVariables = { persisted: {}, temporary: {} };
  var noteVariableEventsBound = false;
  var noteVariableRefreshBusy = false;
  var noteVariableRefreshTimer = null;
  function normalizeVariableSet(source) {
    var result = {};
    if (Array.isArray(source)) {
      for (var i = 0; i < source.length; i++) {
        var item = source[i] || {};
        var name = String(item.name || '').trim();
        if (name) result[name] = item.value;
      }
    } else if (source && typeof source === 'object') {
      for (var key in source) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
        var entry = source[key];
        result[key] = entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'value') ? entry.value : entry;
      }
    }
    return result;
  }
  function variableValueText(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch (e) { return String(value); }
  }
  function variableHtml(value) {
    return variableValueText(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function resolveVariables(raw) {
    return String(raw || '').replace(/\{\{(sb|sb-temp):([^{}\r\n]+)\}\}/g, function (token, kind, name) {
      name = String(name || '').trim();
      var bucket = kind === 'sb-temp' ? noteVariables.temporary : noteVariables.persisted;
      // Im echten Overlay nie den technischen Platzhalter zeigen. Beim Start bleibt
      // die Stelle kurz leer und wird direkt nach dem Variablenabruf neu gerendert.
      return Object.prototype.hasOwnProperty.call(bucket, name) ? variableHtml(bucket[name]) : '';
    });
  }
  function refreshVariables() {
    var c = window.client;
    if (noteVariableRefreshBusy || !c || typeof c.getGlobals !== 'function') return false;
    // getGlobals existiert schon kurz vor abgeschlossenem WebSocket-Handshake. Erst
    // bei ready abrufen, damit der Startversuch nicht verfrueht fehlschlaegt.
    if (typeof c.ready !== 'undefined' && !c.ready) return false;
    noteVariableRefreshBusy = true;
    Promise.all([c.getGlobals(true), c.getGlobals(false)]).then(function (responses) {
      noteVariables.persisted = normalizeVariableSet(responses[0] && (responses[0].variables || responses[0]));
      noteVariables.temporary = normalizeVariableSet(responses[1] && (responses[1].variables || responses[1]));
      renderAll(lastItems);
    }).catch(function () {
      // Verbindung ist beim Start evtl. noch im Handshake; kurzfristig erneut versuchen.
      window.setTimeout(refreshVariables, 750);
    }).then(function () { noteVariableRefreshBusy = false; });
    return true;
  }
  function scheduleVariableRefresh() {
    if (noteVariableRefreshTimer) window.clearTimeout(noteVariableRefreshTimer);
    noteVariableRefreshTimer = window.setTimeout(function () { noteVariableRefreshTimer = null; refreshVariables(); }, 120);
  }
  function bindVariableEvents() {
    if (noteVariableEventsBound || !window.client || typeof window.client.on !== 'function') return false;
    noteVariableEventsBound = true;
    window.client.on('Misc.GlobalVariableCreated', scheduleVariableRefresh);
    window.client.on('Misc.GlobalVariableUpdated', scheduleVariableRefresh);
    window.client.on('Misc.GlobalVariableDeleted', scheduleVariableRefresh);
    return true;
  }

  function clampNum(v, lo, hi, def) {
    v = Number(v);
    if (!isFinite(v)) v = def;
    return Math.max(lo, Math.min(hi, v));
  }

  // Eine gemeinsame, fixe Ebene haelt ALLE Text-Kaesten (so bewegt/entfernt ein Text
  // die anderen nicht). Jeder Text ist ein Kind mit eigener Position.
  function ensureLayer() {
    var l = document.getElementById(LAYER_ID);
    if (!l) {
      l = document.createElement('div');
      l.id = LAYER_ID;
      l.style.cssText = 'position:fixed; inset:0; pointer-events:none; z-index:2147483000;';
      (document.body || document.documentElement).appendChild(l);
    }
    return l;
  }

  function ensureItemEl(layer, id) {
    var el = document.getElementById('kcs-item-' + id);
    if (el) return el;
    el = document.createElement('div');
    el.id = 'kcs-item-' + id;
    el.style.cssText = 'position:absolute; box-sizing:border-box; pointer-events:none; display:none;';
    var bg = document.createElement('div');
    bg.className = 'kcs-bg';
    bg.style.cssText = 'position:absolute; inset:0; border-radius:inherit; z-index:0; background-size:cover; background-position:center; background-repeat:no-repeat;';
    var txt = document.createElement('div');
    txt.className = 'kcs-text';
    txt.style.cssText = 'position:relative; z-index:1; white-space:pre-wrap; word-break:break-word; overflow-wrap:break-word;';
    el.appendChild(bg);
    el.appendChild(txt);
    layer.appendChild(el);
    return el;
  }

  function renderItem(el, cfg) {
    // Zeigen, wenn der manuelle Schalter AN ist ODER per Streamer.bot-Trigger eingeblendet.
    var show = cfg && (cfg.enabled || trigVis[cfg.id]) && String(cfg.text || '').trim().length > 0;
    if (!show) { el.style.display = 'none'; return; }

    // Position/Breite in PROZENT des Monitors (frei positionierbar, pro Text).
    var x = clampNum(cfg.x, 0, 100, 66);
    var y = clampNum(cfg.y, 0, 100, 6);
    var width = clampNum(cfg.width, 5, 90, 24);
    var fontSize = clampNum(cfg.fontSize, 8, 96, 20);
    var bgOpacity = clampNum(cfg.bgOpacity, 0, 100, 85) / 100;
    var textOpacity = clampNum(cfg.textOpacity, 0, 100, 100) / 100;
    var frameColor = cfg.frameColor || '#101826';
    var frameEnabled = (typeof cfg.frameEnabled === 'boolean') ? cfg.frameEnabled : true;
    var backgroundEnabled = (typeof cfg.backgroundEnabled === 'boolean') ? cfg.backgroundEnabled : (cfg.mode === 'image');
    var textColor = cfg.textColor || '#e8f0ff';
    var font = cfg.font || 'Segoe UI, sans-serif';

    el.style.cssText = 'position:absolute; box-sizing:border-box; pointer-events:none; display:block;'
      + ' left:' + x + 'vw; top:' + y + 'vh; width:' + width + 'vw; max-width:calc(100vw - 6px); max-height:calc(100vh - 6px); overflow:hidden;'
      + ' padding:10px 12px; border-radius:10px; border:2px solid ' + (frameEnabled ? frameColor : 'transparent') + ';'
      + ' box-shadow:0 6px 24px rgba(0,0,0,.45);';

    var bg = el.querySelector('.kcs-bg');
    if (backgroundEnabled && String(cfg.bgImage || '').trim()) {
      // Gespeicherte volle Bridge-URL auf die eigene Herkunft umbiegen (Tab-/PC-uebergreifend).
      var _bi = String(cfg.bgImage).replace(/\/content\/backgrounds\//i, '/content/notes/backgrounds/'); var _ci = _bi.indexOf('/content/');
      var _url = (_ci > 0 && /^https?:\/\//.test(_bi)) ? (location.origin + _bi.slice(_ci)) : _bi;
      bg.style.backgroundImage = 'url("' + _url.replace(/"/g, '%22') + '")';
      bg.style.backgroundColor = 'transparent';
    } else {
      bg.style.backgroundImage = 'none';
      bg.style.backgroundColor = frameEnabled ? frameColor : 'transparent';
    }
    bg.style.opacity = String(bgOpacity);

    var txt = el.querySelector('.kcs-text');
    // Formatierter Text (Fett/Kursiv/Unterstrichen kommen als <b>/<i>/<u> aus dem Bedienfeld).
    // Quelle ist der eigene, lokale Speckzettel-Text -> innerHTML ist hier vertretbar.
    // Zusaetzlich wird Mini-Markdown interpretiert (kappi-markdown.js: Ueberschriften,
    // Tabellen, Listen, **fett** usw.) - identisch zur Vorschau im Bedienfeld.
    var rawText = resolveVariables(cfg.text || '');
    txt.innerHTML = (typeof window.kappiMarkdown === 'function') ? window.kappiMarkdown(rawText) : rawText;
    var imageEmojis = txt.querySelectorAll('img.kappi-note-image-emoji');
    for (var ie = 0; ie < imageEmojis.length; ie++) {
      var imageEmojiSize = clampNum(imageEmojis[ie].getAttribute('data-kappi-note-emoji-size'), 16, 256, 48);
      imageEmojis[ie].style.width = imageEmojiSize + 'px';
      imageEmojis[ie].style.height = 'auto';
      imageEmojis[ie].style.maxWidth = '100%';
      imageEmojis[ie].style.objectFit = 'contain';
      imageEmojis[ie].style.verticalAlign = 'middle';
    }
    txt.style.color = textColor;
    txt.style.opacity = String(textOpacity);
    txt.style.fontFamily = font;
    txt.style.fontSize = fontSize + 'px';
    txt.style.lineHeight = '1.35';
    txt.style.fontWeight = '600';
    txt.style.textShadow = '0 1px 2px rgba(0,0,0,.55)';
  }

  function renderAll(items) {
    var layer = ensureLayer();
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var cfg = items[i];
      if (!cfg || !cfg.id) continue;
      seen[cfg.id] = true;
      var triggerKey = cfg.triggerOn ? String(cfg.trigger || '').trim() : '';
      if (!triggerKey || (Object.prototype.hasOwnProperty.call(trigKeys, cfg.id) && trigKeys[cfg.id] !== triggerKey)) {
        delete trigVis[cfg.id];
      }
      trigKeys[cfg.id] = triggerKey;
      // Flanken-Erkennung: aendert sich der GESPEICHERTE Schalter (enabled), war das ein
      // manueller Klick im Bedienfeld -> Laufzeit-Trigger-Sichtbarkeit dieses Textes
      // verwerfen (sonst haelt trigVis einen per Streamer.bot eingeblendeten Text fest
      // und der Schalter laesst sich scheinbar nicht ausschalten).
      var enNow = !!cfg.enabled;
      if (Object.prototype.hasOwnProperty.call(lastEnabledCs, cfg.id) && lastEnabledCs[cfg.id] !== enNow) {
        delete trigVis[cfg.id];
      }
      lastEnabledCs[cfg.id] = enNow;
      renderItem(ensureItemEl(layer, cfg.id), cfg);
    }
    // Veraltete Text-Elemente entfernen (Text geloescht/umbenannt).
    var existing = layer.querySelectorAll('[id^="kcs-item-"]');
    for (var j = existing.length - 1; j >= 0; j--) {
      var id = existing[j].id.replace('kcs-item-', '');
      if (!seen[id]) {
        layer.removeChild(existing[j]);
        delete trigVis[id];
        delete trigKeys[id];
        delete lastEnabledCs[id];
      }
    }
  }

  // Bridge liefert jetzt { items: [...] }. Alte Einzelform ({text,enabled,...} ohne
  // items) wird als 1-Element-Liste behandelt (Abwaertskompatibilitaet).
  function normalizeResponse(r) {
    if (r && Object.prototype.toString.call(r.items) === '[object Array]') return r.items;
    if (r && (typeof r.text === 'string' || typeof r.enabled !== 'undefined')) {
      if (!r.id) r.id = 'legacy';
      return [r];
    }
    return [];
  }

  function poll() {
    try {
      var x = new XMLHttpRequest();
      x.open('GET', URL_ + '?t=' + Date.now(), true);
      x.timeout = 2500;
      x.onload = function () {
        if (x.status < 200 || x.status >= 300) return;
        var key = x.responseText || '';
        if (key === lastKey) return; // nichts geaendert -> nicht neu zeichnen
        lastKey = key;
        try { lastItems = normalizeResponse(JSON.parse(key)); renderAll(lastItems); } catch (e) {}
      };
      x.send();
    } catch (e) {}
  }

  // --- Streamer.bot Custom-Event -> Text ein-/ausblenden (pro Text-ID) ---
  // Streamer.bot sendet { "<trigger>": true }. Nur Texte mit triggerOn reagieren.
  function onCustom(payload) {
    var data = payload && payload.data ? payload.data : {};
    // Lokale Client-Lib verpackt CPH.WebsocketBroadcastJson eine Ebene tief -> auspacken.
    if (data && data.event && data.event.source === 'General' && data.event.type === 'Custom' &&
        data.data && typeof data.data === 'object') { data = data.data; }
    var changed = false;
    for (var i = 0; i < lastItems.length; i++) {
      var cfg = lastItems[i];
      if (!cfg || !cfg.triggerOn) continue;
      var trig = String(cfg.trigger || '').trim();
      if (trig && data[trig] === true) { trigVis[cfg.id] = !trigVis[cfg.id]; changed = true; }
    }
    if (changed) renderAll(lastItems);
  }
  function bindTrigger() {
    if (window.client && typeof window.client.on === 'function') {
      window.client.on('General.Custom', onCustom);
      return true;
    }
    return false;
  }

  function start() {
    poll();
    window.setInterval(poll, POLL_MS);
    // Der Streamer.bot-Client steht evtl. erst spaeter bereit -> mit Wiederholung binden.
    if (!bindTrigger()) {
      var tries = 0;
      var t = window.setInterval(function () { if (bindTrigger() || ++tries > 60) window.clearInterval(t); }, 1000);
    }
    bindVariableEvents();
    // Der echte Client ersetzt beim Start kurz den Warteschlangen-Client. Sobald getGlobals
    // verfuegbar ist, werden beide Variablenarten geladen; danach dienen Events + 15-s-Fallback.
    var variableTries = 0;
    var variableStart = window.setInterval(function () {
      bindVariableEvents();
      if (refreshVariables() || ++variableTries > 60) window.clearInterval(variableStart);
    }, 500);
    window.setInterval(refreshVariables, 15000);
  }
  if (document.body) start();
  else window.addEventListener('DOMContentLoaded', start);
})();
