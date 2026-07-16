// Central runtime settings for existing and newly managed video overlays.
(function () {
  'use strict';

  if (window.__KAPPI_VIDEO_OVERLAY_MANAGER_ACTIVE__) return;
  window.__KAPPI_VIDEO_OVERLAY_MANAGER_ACTIVE__ = true;

  var SETTINGS_URL = location.origin + '/video-overlays';
  var TRIGGER_URL = location.origin + '/trigger-video';
  var POLL_MS = 500;
  var TRIGGER_POLL_MS = 175;
  var items = [];
  var lastTriggerToken = -1;
  var videosPaused = false;
  var DEBOUNCE_MS = 400;   // dasselbe Video innerhalb dieser Zeit nicht neu starten
  var lastPlayAt = {};

  function number(value, fallback, min, max) {
    var parsed = Number(value);
    if (!isFinite(parsed)) parsed = fallback;
    return Math.max(min, Math.min(max, parsed));
  }

  var ALIGN_POS = {
    center: '50% 50%',
    left: '0% 50%',
    right: '100% 50%',
    top: '50% 0%',
    bottom: '50% 100%'
  };
  function normalizeAlign(value) {
    value = String(value || 'center');
    return ALIGN_POS.hasOwnProperty(value) ? value : 'center';
  }

  function normalizePath(value) {
    value = String(value || '').split('#')[0].split('?')[0].replace(/\\/g, '/').toLowerCase();
    try { value = decodeURIComponent(value); } catch (err) {}
    return value;
  }

  function normalizeItem(item) {
    item = item || {};
    return {
      id: String(item.id || item.videoPath || ''),
      name: String(item.name || 'Video-Overlay'),
      trigger: String(item.trigger || item.name || ''),
      triggerType: (item.triggerType === 'reward') ? 'reward' : 'custom',
      groupTrigger: String(item.groupTrigger || ''),
      videoPath: String(item.videoPath || ''),
      startSeconds: number(item.startSeconds, 0, 0, 86400),
      durationSeconds: number(item.durationSeconds, 0, 0, 86400),
      volume: number(item.volume, 100, 0, 100),
      removeBackground: !!item.removeBackground,
      keyColor: /^#[0-9a-f]{6}$/i.test(item.keyColor || '') ? item.keyColor : '#00ff00',
      tolerance: number(item.tolerance, 20, 0, 100),
      sideBars: item.sideBars !== false,
      align: normalizeAlign(item.align),
      enabled: item.enabled !== false,
      managed: item.managed !== false,
      sourceFile: String(item.sourceFile || '')
    };
  }

  function findForVideo(video) {
    var forcedId = video.getAttribute('data-kappi-video-id') || '';
    var source = normalizePath(video.currentSrc || video.src || video.getAttribute('src'));
    for (var i = 0; i < items.length; i++) {
      if (!items[i].enabled) continue;
      if (forcedId && items[i].id === forcedId) return items[i];
      var configured = normalizePath(items[i].videoPath);
      if (configured && source && (source === configured || source.slice(-configured.length) === configured)) return items[i];
    }
    return null;
  }

  function hexRgb(hex) {
    var value = parseInt(String(hex || '#00ff00').slice(1), 16);
    return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
  }

  function removeChromaCanvas(video) {
    if (video.__kappiChromaFrame) cancelAnimationFrame(video.__kappiChromaFrame);
    video.__kappiChromaFrame = 0;
    if (video.__kappiChromaCanvas && video.__kappiChromaCanvas.parentNode) {
      video.__kappiChromaCanvas.parentNode.removeChild(video.__kappiChromaCanvas);
    }
    video.__kappiChromaCanvas = null;
    video.style.opacity = video.__kappiOriginalOpacity || '';
  }

  function startChroma(video, config) {
    if (!config.removeBackground) {
      removeChromaCanvas(video);
      return;
    }

    var canvas = video.__kappiChromaCanvas;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'kappi-video-chroma-canvas';
      canvas.style.cssText = video.style.cssText;
      canvas.style.pointerEvents = 'none';
      canvas.style.background = 'transparent';
      video.__kappiOriginalOpacity = video.style.opacity || '';
      // Rohvideo NICHT sofort verstecken - erst wenn der Chroma-Canvas den ersten
      // Frame gezeichnet hat. Sonst waere das Video unsichtbar (aber hoerbar),
      // falls der Canvas verzoegert startet (z.B. erster Durchlauf nach Neustart).
      if (video.parentNode) video.parentNode.insertBefore(canvas, video.nextSibling);
      video.__kappiChromaCanvas = canvas;
    }

    if (video.__kappiChromaFrame) return;
    var context = canvas.getContext('2d', { willReadFrequently: true });
    // Chroma NICHT in voller Auflösung rechnen: das freigestellte Bild wird per CSS ohnehin
    // auf Bildschirmgröße skaliert. Bei ~960px ist die Qualität praktisch gleich, aber
    // getImageData + Pixel-Schleife laufen um ein Vielfaches schneller (kein CPU-Stau, kein
    // Maus-Ruckeln, das Bild kommt sofort). Bei 5K-Videos ist der Unterschied riesig.
    var MAX_CHROMA_W = 960;

    function draw() {
      if (!video.isConnected || !canvas.isConnected || !config.removeBackground) {
        removeChromaCanvas(video);
        return;
      }
      if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) {
        var vw = video.videoWidth, vh = video.videoHeight;
        var s = Math.min(1, MAX_CHROMA_W / vw);
        var cw = Math.max(1, Math.round(vw * s));
        var ch = Math.max(1, Math.round(vh * s));
        if (canvas.width !== cw) canvas.width = cw;
        if (canvas.height !== ch) canvas.height = ch;
        try {
          context.clearRect(0, 0, cw, ch);
          context.drawImage(video, 0, 0, cw, ch);
          var frame = context.getImageData(0, 0, cw, ch);
          var key = hexRgb(config.keyColor);
          var threshold = config.tolerance * 4.42;
          var thr2 = threshold * threshold; // quadriert vergleichen -> kein teures Math.sqrt pro Pixel
          var d = frame.data;
          for (var p = 0; p < d.length; p += 4) {
            var dr = d[p] - key.r;
            var dg = d[p + 1] - key.g;
            var db = d[p + 2] - key.b;
            if (dr * dr + dg * dg + db * db <= thr2) d[p + 3] = 0;
          }
          context.putImageData(frame, 0, 0);
          // Ab dem ersten gezeichneten Frame das Rohvideo verstecken (Canvas uebernimmt).
          if (video.style.opacity !== '0') video.style.opacity = '0';
        } catch (err) {
          removeChromaCanvas(video);
          return;
        }
      }
      video.__kappiChromaFrame = requestAnimationFrame(draw);
    }

    video.__kappiChromaFrame = requestAnimationFrame(draw);
  }

  function applyToVideo(video) {
    if (!video || video.tagName !== 'VIDEO') return;
    var config = findForVideo(video);
    if (!config) return;
    video.__kappiVideoConfig = config;
    video.volume = config.volume / 100;
    // Balken links/rechts: Seitenverhältnis behalten (contain) statt Bildschirm füllen (cover).
    video.style.objectFit = config.sideBars === false ? 'cover' : 'contain';
    // Ausrichtung innerhalb des Rahmens (bei Balken an eine Seite ziehen statt mittig).
    video.style.objectPosition = ALIGN_POS[config.align] || '50% 50%';

    if (config.startSeconds > 0 && video.readyState >= 1 && video.currentTime < 0.25) {
      try { video.currentTime = Math.min(config.startSeconds, Math.max(0, video.duration || config.startSeconds)); } catch (err) {}
    }

    if (!video.__kappiVideoEventsBound) {
      video.__kappiVideoEventsBound = true;

      var stopAndRemove = function () {
        try { video.pause(); } catch (err) {}
        removeChromaCanvas(video);
        if (video.parentNode) video.parentNode.removeChild(video);
      };

      video.addEventListener('loadedmetadata', function () {
        var current = video.__kappiVideoConfig;
        if (current && current.startSeconds > 0) {
          try { video.currentTime = Math.min(current.startSeconds, Math.max(0, video.duration || current.startSeconds)); } catch (err) {}
        }
      });

      // Zuverlässiger Stopp am eingestellten Ende ueber die echte Abspielposition.
      // Greift auch dann, wenn das Video von einer Effekt-Datei gestartet wurde
      // (unabhaengig davon, wann die Events gebunden wurden).
      video.addEventListener('timeupdate', function () {
        var current = video.__kappiVideoConfig;
        if (!current || !(current.durationSeconds > 0)) return;
        var endTime = (current.startSeconds || 0) + current.durationSeconds;
        if (video.currentTime >= endTime - 0.03) stopAndRemove();
      });

      video.addEventListener('play', function () {
        var current = video.__kappiVideoConfig;
        if (!current) return;
        video.volume = current.volume / 100;
        // Sicherheits-Fallback, falls timeupdate ausbleibt (etwas groesserer Puffer,
        // damit der genaue timeupdate-Stopp zuerst greift).
        if (video.__kappiDurationTimer) clearTimeout(video.__kappiDurationTimer);
        if (current.durationSeconds > 0) {
          video.__kappiDurationTimer = setTimeout(stopAndRemove, (current.durationSeconds + 0.4) * 1000);
        }
        startChroma(video, current);
      });

      video.addEventListener('ended', function () { removeChromaCanvas(video); });
    }
    startChroma(video, config);
  }

  function scanVideos(root) {
    if (!root) return;
    if (root.tagName === 'VIDEO') applyToVideo(root);
    if (root.querySelectorAll) {
      var videos = root.querySelectorAll('video');
      for (var i = 0; i < videos.length; i++) applyToVideo(videos[i]);
    }
  }

  function createManagedVideo(config) {
    if (window.__KAPPI_INSTANCE_DEACTIVATED__) return null; // stummgeschaltete Alt-Instanz
    if (window.__KAPPI_OVERLAY_SUSPENDED__) return null;    // App-Ausnahme aktiv (Vordergrund-App)
    if (!config || !config.enabled || !config.videoPath) return null;
    // Entprellung: dasselbe Video nicht doppelt kurz hintereinander starten
    // (falls Streamer.bot zwei Events schickt) -> sonst Neustart-Stottern/Echo.
    var dkey = String(config.id || config.trigger || config.videoPath);
    var now = Date.now();
    if (lastPlayAt[dkey] && (now - lastPlayAt[dkey]) < DEBOUNCE_MS) return null;
    lastPlayAt[dkey] = now;
    // Kein Stapeln / kein Echo: ALLE bereits laufenden Overlay-Videos hart stoppen
    // -- egal von welcher Datei sie erzeugt wurden. WICHTIG: removeChild allein
    // stoppt den Ton NICHT (losgelöste Video-Elemente spielen weiter) -> zuerst
    // pausieren + Quelle leeren, sonst hört man ein Echo (mehrere Tonspuren).
    var running = document.querySelectorAll('video');
    for (var e = 0; e < running.length; e++) {
      var old = running[e];
      try { old.pause(); } catch (err) {}
      try { old.muted = true; old.volume = 0; old.removeAttribute('src'); old.load(); } catch (err) {}
      try { removeChromaCanvas(old); } catch (err) {}
      if (old.parentNode) old.parentNode.removeChild(old);
    }
    var video = document.createElement('video');
    video.setAttribute('data-kappi-video-id', config.id);
    video.src = config.videoPath;
    video.autoplay = true;
    video.controls = false;
    video.playsInline = true;
    video.style.position = 'fixed';
    video.style.inset = '0';
    video.style.width = '100vw';
    video.style.height = '100vh';
    video.style.objectFit = config.sideBars === false ? 'cover' : 'contain';
    video.style.pointerEvents = 'none';
    video.style.zIndex = '1200';
    // Eigene GPU-Ebene erzwingen, damit das (erste) Video sofort gezeichnet wird
    // und nicht durchsichtig bleibt (WebView2-Erstframe-Effekt nach Neustart).
    video.style.transform = 'translateZ(0)';
    video.style.backfaceVisibility = 'hidden';
    document.body.appendChild(video);
    applyToVideo(video);
    video.addEventListener('ended', function () {
      removeChromaCanvas(video);
      if (video.parentNode) video.parentNode.removeChild(video);
    });
    var promise = video.play();
    if (promise && typeof promise.catch === 'function') promise.catch(function () {});
    return video;
  }

  function handleCustom(payload) {
    if (videosPaused) return; // global pausiert -> keine automatischen Video-Trigger
    var data = payload && payload.data ? payload.data : {};
    // WICHTIG: Die lokale Client-Bibliothek liefert bei CPH.WebsocketBroadcastJson das
    // KOMPLETTE gesendete JSON als payload.data – also {event:{General/Custom},data:{Trigger:true}}
    // statt direkt {Trigger:true}. Eine Ebene auspacken, sonst matcht kein Trigger.
    // (Alte Einzel-Codes senden FLACH {"Name":true} und sind nicht betroffen.)
    if (data && data.event && data.event.source === 'General' && data.event.type === 'Custom' &&
        data.data && typeof data.data === 'object') {
      data = data.data;
    }
    for (var i = 0; i < items.length; i++) {
      var config = items[i];
      if (!config.enabled || !config.managed || !config.trigger) continue;
      // Videos mit eigener Effekt-Datei (sourceFile) spielt DIESE Datei per
      // playTrigger ab. Hier auf den Trigger-Namen NICHT nochmal reagieren,
      // sonst spielt es doppelt (das "Echo"). Direkte ID/Name-Auswahl bleibt.
      // Reward-Videos reagieren NUR auf die Twitch-Belohnung (handleReward), nicht auf Custom.
      var byTrigger = (data[config.trigger] === true) && !config.sourceFile && config.triggerType !== 'reward';
      var byId = (data.kappiVideoOverlay === config.id || data.videoOverlay === config.name);
      if (byTrigger || byId) createManagedVideo(config);
    }
    // Gruppen-Zufalls-Trigger: kommt der Trigger einer Gruppe über Streamer.bot, spielt
    // EIN zufälliges aktives Video dieser Gruppe – direkt (auch bei sourceFile/reward, wie
    // handleReward), denn die Effekt-Dateien reagieren nicht auf den Gruppen-Trigger.
    var groupBuckets = {};
    for (var g = 0; g < items.length; g++) {
      var gc = items[g];
      if (!gc.enabled || !gc.groupTrigger) continue;
      if (data[gc.groupTrigger] === true) {
        (groupBuckets[gc.groupTrigger] = groupBuckets[gc.groupTrigger] || []).push(gc);
      }
    }
    for (var trig in groupBuckets) {
      if (!groupBuckets.hasOwnProperty(trig)) continue;
      var bucket = groupBuckets[trig];
      createManagedVideo(bucket[Math.floor(Math.random() * bucket.length)]);
    }
  }

  // Twitch-Kanalpunkte-Belohnung: nur Videos im "reward"-Modus reagieren (per Name).
  // Feld-Extraktion bewusst großzügig (wie im Chat-Panel): Streamer.bot liefert die
  // Belohnung je nach Version als data.reward, data.Reward ODER verschachtelt unter
  // data.redemption.reward. Fehlt hier ein Format, wird der Name nicht gefunden und
  // das Video im Reward-Modus zündet nicht.
  function rewardTitle(data) {
    data = data || {};
    var red = data.redemption || data.Redemption || {};
    var r = (data.reward && typeof data.reward === 'object') ? data.reward
          : (data.Reward && typeof data.Reward === 'object') ? data.Reward
          : (red.reward && typeof red.reward === 'object') ? red.reward
          : (red.Reward && typeof red.Reward === 'object') ? red.Reward : {};
    var t = r.title || r.Title || r.name || r.Name ||
            data.rewardName || data.RewardName || data.rewardTitle || data.title ||
            red.rewardName || red.RewardName || '';
    return String(t || '');
  }
  function handleReward(payload) {
    if (videosPaused) return;
    var data = payload && payload.data ? payload.data : {};
    var low = rewardTitle(data).trim().toLowerCase();
    if (!low) return;
    for (var i = 0; i < items.length; i++) {
      var config = items[i];
      // KEIN managed-Check: Reward-Videos werden IMMER direkt hier abgespielt – auch die
      // mit eigener Effekt-Datei (sourceFile → managed=false). Die Effekt-Dateien reagieren
      // nur auf General.Custom, NICHT auf Twitch-Belohnungen; ohne diesen Pfad zündet ein
      // Reward-Video mit Effekt-Datei nie. createManagedVideo braucht nur videoPath.
      if (!config.enabled || config.triggerType !== 'reward') continue;
      if (String(config.trigger).trim().toLowerCase() === low || String(config.name).trim().toLowerCase() === low) {
        createManagedVideo(config);
      }
    }
  }

  function loadSettings() {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', SETTINGS_URL + '?t=' + Date.now(), true);
      xhr.timeout = 1800;
      xhr.onload = function () {
        if (xhr.status < 200 || xhr.status >= 300) return;
        try {
          var response = JSON.parse(xhr.responseText || '{}');
          var source = Array.isArray(response.items) ? response.items : [];
          items = source.map(normalizeItem);
          videosPaused = !!response.paused;
          scanVideos(document);
        } catch (err) {}
      };
      xhr.send();
    } catch (err) {}
  }

  function playById(id, force) {
    id = String(id || '');
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id || items[i].name === id) {
        var cfg = items[i];
        if (force && !cfg.enabled) {
          cfg = normalizeItem(items[i]);
          cfg.enabled = true;
        }
        return createManagedVideo(cfg);
      }
    }
    return null;
  }

  // Zentrale Wiedergabe über den Streamer.bot-Trigger. Wendet Start/Dauer/
  // Effekte aus den gespeicherten Einstellungen an (Bindet die Events VOR dem
  // Abspielen -> der Trim greift auch beim ersten Durchlauf zuverlässig).
  function playByTrigger(trigger, force) {
    trigger = String(trigger || '');
    if (!trigger) return null;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.trigger === trigger || it.name === trigger || it.id === trigger) {
        // Global pausiert: als "erledigt" melden (true), damit die Effekt-Datei
        // NICHT auf ihre eigene Wiedergabe zurueckfaellt -> es spielt nichts.
        if (videosPaused) return true;
        var cfg = it;
        if (force && !cfg.enabled) {
          cfg = normalizeItem(it);
          cfg.enabled = true;
        }
        // Deaktiviert (linker An/Aus-Schalter aus) und NICHT erzwungen: als "erledigt"
        // (true) melden, damit die Effekt-Datei NICHT auf ihre eigene Wiedergabe
        // zurueckfaellt. So blockiert der Schalter auch echte Streamer.bot-/Reward-Trigger.
        if (!cfg.enabled) return true;
        return createManagedVideo(cfg);
      }
    }
    return null;
  }

  // Test-Trigger von der Settings-Seite: Video einmal im Overlay zeigen.
  function pollTrigger() {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', TRIGGER_URL + '?t=' + Date.now(), true);
      xhr.timeout = 1200;
      xhr.onload = function () {
        if (xhr.status < 200 || xhr.status >= 300) return;
        try {
          var res = JSON.parse(xhr.responseText || '{}');
          var token = Number(res.token) || 0;
          if (lastTriggerToken < 0) { lastTriggerToken = token; return; }
          if (token > lastTriggerToken) {
            lastTriggerToken = token;
            if (res.id) playById(res.id, true);
          }
        } catch (err) {}
      };
      xhr.send();
    } catch (err) {}
  }

  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      for (var j = 0; j < mutations[i].addedNodes.length; j++) scanVideos(mutations[i].addedNodes[j]);
    }
  });

  function start() {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('play', function (event) {
      if (event.target && event.target.tagName === 'VIDEO') applyToVideo(event.target);
    }, true);
    if (window.client && typeof window.client.on === 'function') {
      window.client.on('General.Custom', handleCustom);
      window.client.on('Twitch.RewardRedemption', handleReward);
    }
    loadSettings();
    setInterval(loadSettings, POLL_MS);
    pollTrigger();
    setInterval(pollTrigger, TRIGGER_POLL_MS);
  }

  window.kappiVideoOverlays = {
    reload: loadSettings,
    play: function (idOrName) {
      for (var i = 0; i < items.length; i++) {
        if (items[i].id === idOrName || items[i].name === idOrName) return createManagedVideo(items[i]);
      }
      return null;
    },
    playTrigger: playByTrigger,
    status: function () { return { active: true, items: items.slice() }; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
