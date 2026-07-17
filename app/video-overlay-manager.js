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
  // Nur das doppelte Echo DESSELBEN unmittelbar aufeinanderfolgenden Events blocken.
  // A -> B -> A muss dagegen auch innerhalb weniger Millisekunden erlaubt bleiben.
  var DUPLICATE_DEBOUNCE_MS = 140;
  var lastRequestedKey = '';
  var lastRequestedAt = 0;

  // Neuester Trigger gewinnt. Alte Lade-/Play-Events duerfen einen spaeteren Trigger
  // niemals mehr ueberholen. Nur ein VOLLSTAENDIG gepuffertes Video darf warm bleiben;
  // Hintergrund-Warmups wuerden auf der seriellen HTTP-Bridge Steuerbefehle blockieren.
  var playbackGeneration = 0;
  var activeVideo = null;
  var playbackStatus = { generation: 0, id: '', phase: 'idle', requestedAt: 0, playingAt: 0 };
  var MAX_WARM_PLAYERS = 1;
  var warmPlayers = Object.create(null);
  var warmOrder = [];

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

  function pathsMatch(source, configured) {
    source = normalizePath(source);
    configured = normalizePath(configured);
    return !!(source && configured && (source === configured || source.slice(-configured.length) === configured));
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

  function clearDurationTimer(video) {
    if (video && video.__kappiDurationTimer) clearTimeout(video.__kappiDurationTimer);
    if (video) video.__kappiDurationTimer = 0;
  }

  function removeWarmReference(video) {
    if (!video) return;
    var id = String(video.getAttribute('data-kappi-video-id') || '');
    if (id && warmPlayers[id] === video) delete warmPlayers[id];
    warmOrder = warmOrder.filter(function (entry) { return entry !== id; });
  }

  function discardVideo(video) {
    if (!video) return;
    removeWarmReference(video);
    clearDurationTimer(video);
    try { video.pause(); } catch (err) {}
    try {
      video.muted = true;
      video.volume = 0;
      video.removeAttribute('src');
      video.load(); // bricht auch eine noch laufende Range-Anfrage ab
    } catch (err) {}
    try { removeChromaCanvas(video); } catch (err) {}
    video.__kappiVideoConfig = null;
    video.__kappiGeneration = 0;
    if (activeVideo === video) activeVideo = null;
    if (video.parentNode) video.parentNode.removeChild(video);
  }

  function trimWarmPlayers() {
    while (warmOrder.length > MAX_WARM_PLAYERS) {
      var oldestId = warmOrder.pop();
      var oldest = warmPlayers[oldestId];
      delete warmPlayers[oldestId];
      discardVideo(oldest);
    }
  }

  function isFullyBuffered(video) {
    if (!video || video.error || video.readyState < 4) return false;
    var duration = Number(video.duration);
    if (!(duration > 0) || !isFinite(duration)) return false;
    try {
      if (!video.buffered || !video.buffered.length) return false;
      return video.buffered.end(video.buffered.length - 1) >= duration - 0.25;
    } catch (err) { return false; }
  }

  function parkWarmVideo(video, config) {
    if (!video || !config || !config.id || video.error) {
      discardVideo(video);
      return;
    }
    var id = String(config.id);
    var previous = warmPlayers[id];
    if (previous && previous !== video) discardVideo(previous);
    clearDurationTimer(video);
    try { video.pause(); } catch (err) {}
    try {
      video.muted = true;
      video.volume = 0;
      video.currentTime = Math.max(0, config.startSeconds || 0);
    } catch (err) {}
    removeChromaCanvas(video);
    video.style.display = 'none';
    video.setAttribute('data-kappi-warm', '1');
    video.setAttribute('data-kappi-video-id', id);
    video.__kappiVideoConfig = null;
    video.__kappiGeneration = 0;
    if (activeVideo === video) activeVideo = null;
    warmPlayers[id] = video;
    warmOrder = warmOrder.filter(function (entry) { return entry !== id; });
    warmOrder.unshift(id);
    trimWarmPlayers();
  }

  function takeWarmVideo(config) {
    var id = String(config && config.id || '');
    var video = id ? warmPlayers[id] : null;
    if (!video) return null;
    if (video.error) {
      discardVideo(video);
      return null;
    }
    delete warmPlayers[id];
    warmOrder = warmOrder.filter(function (entry) { return entry !== id; });
    video.removeAttribute('data-kappi-warm');
    return video;
  }

  function setPlaybackPhase(video, phase) {
    if (!video || video.__kappiGeneration !== playbackGeneration) return;
    playbackStatus.phase = phase;
    if (phase === 'playing') playbackStatus.playingAt = Date.now();
  }

  function finishManagedVideo(video) {
    if (!video) return;
    var config = video.__kappiVideoConfig;
    var isCurrent = video.__kappiGeneration === playbackGeneration;
    if (isCurrent) {
      playbackStatus.phase = 'idle';
      activeVideo = null;
    }
    // Nur ein wirklich vollstaendig gepuffertes Video behalten. readyState >= 2
    // reicht nicht: dann kann im Hintergrund weiterhin eine grosse Range-Anfrage laufen.
    if (config && isFullyBuffered(video)) parkWarmVideo(video, config);
    else discardVideo(video);
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
    if (video.getAttribute('data-kappi-warm') === '1') {
      // Warm-Player laden nur komprimierte Mediendaten. Keine Chroma-Schleife,
      // kein Ton und keine sichtbare Ebene, bis ein echter Trigger sie uebernimmt.
      clearDurationTimer(video);
      removeChromaCanvas(video);
      video.muted = true;
      video.volume = 0;
      video.style.display = 'none';
      return;
    }
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

      var stopAndRemove = function () { finishManagedVideo(video); };

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
        if (video.__kappiGeneration !== playbackGeneration) {
          discardVideo(video);
          return;
        }
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

      video.addEventListener('playing', function () { setPlaybackPhase(video, 'playing'); });
      video.addEventListener('waiting', function () { setPlaybackPhase(video, 'waiting'); });
      video.addEventListener('stalled', function () { setPlaybackPhase(video, 'stalled'); });
      video.addEventListener('error', function () {
        if (video.__kappiGeneration === playbackGeneration) setPlaybackPhase(video, 'error');
      });
      video.addEventListener('ended', stopAndRemove);
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

  function stopCompetingVideos(except) {
    var running = document.querySelectorAll('video');
    for (var i = 0; i < running.length; i++) {
      var old = running[i];
      if (old === except) continue;
      if (old.getAttribute('data-kappi-warm') === '1') {
        // Ein nur teilweise geladener Warm-Player darf den echten Trigger nie
        // ausbremsen. Lediglich vollstaendig gepufferte Daten bleiben im Speicher.
        if (!isFullyBuffered(old)) discardVideo(old);
        continue;
      }
      var oldConfig = old.__kappiVideoConfig || findForVideo(old);
      try { old.pause(); old.muted = true; old.volume = 0; } catch (err) {}
      if (oldConfig && isFullyBuffered(old)) parkWarmVideo(old, oldConfig);
      else discardVideo(old);
    }
  }

  function createManagedVideo(config) {
    if (window.__KAPPI_INSTANCE_DEACTIVATED__) return null; // stummgeschaltete Alt-Instanz
    if (window.__KAPPI_OVERLAY_SUSPENDED__) return null;    // App-Ausnahme aktiv (Vordergrund-App)
    if (!config || !config.enabled || !config.videoPath) return null;
    // Nur ein direktes Doppel-Echo blocken. Der Wechsel A -> B -> A ist erlaubt,
    // auch wenn alle drei Streamer.bot-Events innerhalb von 140 ms eintreffen.
    var dkey = String(config.id || config.trigger || config.videoPath);
    var now = Date.now();
    if (dkey === lastRequestedKey && (now - lastRequestedAt) < DUPLICATE_DEBOUNCE_MS) {
      // "true" ist absichtlich ein Erfolgswert: Die alten Einzelmodule duerfen
      // bei einem geblockten Echo NICHT ihren kalten Fallback-Player starten.
      return true;
    }
    lastRequestedKey = dkey;
    lastRequestedAt = now;

    playbackGeneration += 1;
    var generation = playbackGeneration;
    var video = takeWarmVideo(config);
    stopCompetingVideos(video);
    if (!video) video = document.createElement('video');

    removeChromaCanvas(video);
    clearDurationTimer(video);
    video.removeAttribute('data-kappi-warm');
    video.setAttribute('data-kappi-video-id', config.id);
    video.__kappiGeneration = generation;
    video.__kappiVideoConfig = config;
    video.preload = 'auto';
    video.autoplay = true;
    video.controls = false;
    video.playsInline = true;
    video.muted = false;
    video.style.position = 'fixed';
    video.style.inset = '0';
    video.style.width = '100vw';
    video.style.height = '100vh';
    video.style.objectFit = config.sideBars === false ? 'cover' : 'contain';
    video.style.pointerEvents = 'none';
    video.style.zIndex = '1200';
    video.style.display = 'block';
    video.style.opacity = '';
    // Eigene GPU-Ebene erzwingen, damit das (erste) Video sofort gezeichnet wird
    // und nicht durchsichtig bleibt (WebView2-Erstframe-Effekt nach Neustart).
    video.style.transform = 'translateZ(0)';
    video.style.backfaceVisibility = 'hidden';
    var currentPath = video.currentSrc || video.src || video.getAttribute('src');
    var sourceChanged = !pathsMatch(currentPath, config.videoPath);
    if (sourceChanged) video.src = config.videoPath;
    if (!video.parentNode) document.body.appendChild(video);
    applyToVideo(video);
    activeVideo = video;
    playbackStatus = {
      generation: generation,
      id: dkey,
      phase: sourceChanged ? 'loading' : 'warm',
      requestedAt: now,
      playingAt: 0
    };
    if (sourceChanged) {
      try { video.load(); } catch (err) {}
    } else {
      try { video.currentTime = Math.max(0, config.startSeconds || 0); } catch (err) {}
    }
    var promise = video.play();
    if (promise && typeof promise.catch === 'function') promise.catch(function () {
      if (video.__kappiGeneration === playbackGeneration) setPlaybackPhase(video, 'play-blocked');
    });
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

  var settingsRequestInFlight = false;
  function loadSettings() {
    if (settingsRequestInFlight) return;
    try {
      settingsRequestInFlight = true;
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
      xhr.onloadend = function () { settingsRequestInFlight = false; };
      xhr.send();
    } catch (err) { settingsRequestInFlight = false; }
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
  var triggerRequestInFlight = false;
  function pollTrigger() {
    if (triggerRequestInFlight) return;
    try {
      triggerRequestInFlight = true;
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
      xhr.onloadend = function () { triggerRequestInFlight = false; };
      xhr.send();
    } catch (err) { triggerRequestInFlight = false; }
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
    status: function () {
      return {
        active: true,
        items: items.slice(),
        playback: Object.assign({}, playbackStatus),
        warm: warmOrder.slice()
      };
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
