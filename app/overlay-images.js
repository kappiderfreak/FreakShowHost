/*
 * Bild-/GIF-Overlays.
 * Liest von der Bridge (/image-overlays) positionierte Bilder und zeigt sie im
 * echten Overlay als <img> an (Position/Größe in Prozent des Bildschirms).
 * Wird in index.html geladen.
 */
(function () {
  'use strict';

  var BRIDGE = location.origin + '/image-overlays';
  var LAYER_ID = 'kappi-image-overlays';
  var lastSig = '';
  var lastImages = [];   // zuletzt geholte Bilder (fuer den Trigger-Handler)
  var trigState = {};    // Laufzeit-Umschaltung je Bild-ID (per Streamer.bot-Trigger, NICHT persistiert)
  var lastEnabledById = {}; // zuletzt gesehener Schalter-Zustand je Bild (Flanken-Erkennung)

  function ensureLayer() {
    var l = document.getElementById(LAYER_ID);
    if (!l) {
      l = document.createElement('div');
      l.id = LAYER_ID;
      l.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1000000000;';
      document.body.appendChild(l);
    }
    return l;
  }

  function render(images) {
    var layer = ensureLayer();
    var seen = {};
    // Flanken-Erkennung: Aendert sich der GESPEICHERTE Schalter (enabled) eines Bildes,
    // war das ein manueller Klick im Bedienfeld -> Laufzeit-Trigger-Zustand dieses Bildes
    // verwerfen. Sonst laesst sich ein per Streamer.bot eingeblendetes Bild nicht mehr
    // manuell ausschalten (enabled=false, aber trigState haelt es sichtbar).
    for (var e = 0; e < images.length; e++) {
      var it = images[e];
      if (!it || !it.id) continue;
      var enNow = (it.enabled !== false);
      if (Object.prototype.hasOwnProperty.call(lastEnabledById, it.id) && lastEnabledById[it.id] !== enNow) {
        delete trigState[it.id];
      }
      lastEnabledById[it.id] = enNow;
    }
    for (var i = 0; i < images.length; i++) {
      var im = images[i];
      if (!im || !im.path) continue;
      // Sichtbar, wenn dauerhaft an ODER per Trigger eingeblendet (Laufzeit-Toggle).
      var shown = (im.enabled !== false) || (trigState[im.id] === true);
      if (!shown) continue;
      seen[im.id] = true;
      var wrap = document.getElementById('kappi-imgwrap-' + im.id);
      var img = null, tint = null;
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'kappi-imgwrap-' + im.id;
        wrap.style.cssText = 'position:absolute;pointer-events:none;';
        img = document.createElement('img');
        img.className = 'kappi-img';
        img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;';
        wrap.appendChild(img);
        layer.appendChild(wrap);
      } else {
        img = wrap.querySelector('img.kappi-img');
        tint = wrap.querySelector('.kappi-img-tint');
      }
      if (img && img.getAttribute('data-src') !== im.path) { img.setAttribute('data-src', im.path); img.src = im.path; }
      wrap.style.left = im.x + '%';
      wrap.style.top = im.y + '%';
      wrap.style.width = im.width + '%';
      wrap.style.height = im.height + '%';
      // Transparenz (0..100 -> 0..1).
      var op = (typeof im.opacity === 'number') ? im.opacity : 100;
      wrap.style.opacity = (op < 100) ? String(Math.max(0, op) / 100) : '1';
      // Priorität: erstes Bild in der Liste liegt über allen (höchster z-index).
      wrap.style.zIndex = String(images.length - i);
      // Farbe/Tint: färbt nur die undurchsichtigen Bildpixel (Maske = das Bild selbst).
      var wantTint = im.colorOn && /^#[0-9a-fA-F]{3,8}$/.test(String(im.color || ''));
      if (wantTint) {
        if (!tint) {
          tint = document.createElement('div');
          tint.className = 'kappi-img-tint';
          tint.style.cssText = 'position:absolute;inset:0;pointer-events:none;mix-blend-mode:multiply;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;-webkit-mask-size:contain;mask-size:contain;';
          wrap.appendChild(tint);
        }
        tint.style.background = im.color;
        if (tint.getAttribute('data-mask') !== im.path) {
          var murl = 'url("' + im.path + '")';
          tint.style.webkitMaskImage = murl; tint.style.maskImage = murl;
          tint.setAttribute('data-mask', im.path);
        }
      } else if (tint && tint.parentNode) {
        tint.parentNode.removeChild(tint);
      }
    }
    var existing = layer.querySelectorAll('[id^="kappi-imgwrap-"]');
    for (var j = existing.length - 1; j >= 0; j--) {
      var id = existing[j].id.replace('kappi-imgwrap-', '');
      if (!seen[id]) layer.removeChild(existing[j]);
    }
  }

  function fetchAndRender() {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', BRIDGE + '?t=' + Date.now(), true);
      xhr.timeout = 2500;
      xhr.onload = function () {
        try {
          var r = JSON.parse(xhr.responseText || '{}');
          var images = r.images || [];
          lastImages = images;
          var sig = JSON.stringify(images);
          if (sig !== lastSig) { lastSig = sig; render(images); }
        } catch (e) {}
      };
      xhr.send();
    } catch (e) {}
  }

  // --- Streamer.bot Custom-Event -> Bild ein-/ausblenden (Toggle je Event) ---
  // Streamer.bot sendet { "<trigger>": true }. Nur Bilder mit triggerOn reagieren.
  // Laufzeit-Umschaltung (NICHT persistiert) - genau wie beim Endgame-Speckzettel:
  // das Overlay verarbeitet den Trigger eigenstaendig, ohne die Bridge zu beschreiben.
  function onCustom(payload) {
    var data = payload && payload.data ? payload.data : {};
    // Lokale Client-Lib verpackt CPH.WebsocketBroadcastJson eine Ebene tief -> auspacken.
    if (data && data.event && data.event.source === 'General' && data.event.type === 'Custom' &&
        data.data && typeof data.data === 'object') { data = data.data; }
    var changed = false;
    for (var i = 0; i < lastImages.length; i++) {
      var im = lastImages[i];
      if (!im || !im.triggerOn) continue;
      var trig = String(im.trigger || '').trim();
      if (trig && data[trig] === true) { trigState[im.id] = !trigState[im.id]; changed = true; }
    }
    if (changed) render(lastImages);
  }
  function bindTrigger() {
    if (window.client && typeof window.client.on === 'function') {
      window.client.on('General.Custom', onCustom);
      return true;
    }
    return false;
  }

  fetchAndRender();
  // Schnelles Intervall, damit Bewegen/Ausblenden im Overlay flott nachzieht.
  setInterval(fetchAndRender, 400);
  // Streamer.bot-Client evtl. erst spaeter bereit -> mit Wiederholung binden.
  if (!bindTrigger()) {
    var _tries = 0;
    var _iv = setInterval(function () { if (bindTrigger() || ++_tries > 60) clearInterval(_iv); }, 1000);
  }
})();
