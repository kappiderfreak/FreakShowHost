/*
 * Overlay-Link-Erkennung für bekannte Anbieter und verbreitete Streamer.bot-Parameter.
 * Verändert ausschließlich Verbindungsparameter; alle übrigen Widget-Einstellungen bleiben erhalten.
 */
(function (root) {
  'use strict';

  function cleanHost(host) {
    host = String(host || '').toLowerCase();
    return host.indexOf('www.') === 0 ? host.slice(4) : host;
  }

  function hostIs(host, expected) {
    host = cleanHost(host);
    expected = cleanHost(expected);
    return host === expected || host.slice(-(expected.length + 1)) === '.' + expected;
  }

  function parse(input) {
    var raw = String(input || '').trim();
    if (!raw) return null;
    try {
      var base = root.location && root.location.origin ? root.location.origin : 'http://127.0.0.1';
      return { raw: raw, url: new URL(raw, base) };
    } catch (e) { return null; }
  }

  function queryKeys(url) {
    var out = {};
    try {
      url.searchParams.forEach(function (value, key) {
        out[String(key || '').toLowerCase()] = key;
      });
    } catch (e) {}
    return out;
  }

  function knownProvider(parsed) {
    if (!parsed) return null;
    var host = cleanHost(parsed.url.hostname);
    var path = String(parsed.url.pathname || '').toLowerCase();

    if (hostIs(host, 'streamlabs.com') && path.indexOf('/widgets/event-list/') === 0) {
      return { id: 'streamlabs-event-list', label: 'Streamlabs Event List', profile: 'none', cloud: true };
    }
    if (hostIs(host, 'streamelements.com') && path.indexOf('/overlay/') === 0) {
      return { id: 'streamelements-overlay', label: 'StreamElements Overlay', profile: 'none', cloud: true };
    }
    if (hostIs(host, 'mustachedmaniac.com') && path.indexOf('/widgets/viewer_queue/') === 0) {
      return { id: 'mustached-viewer-queue', label: 'MustachedManiac Viewer Queue', profile: 'address-port' };
    }
    if (hostIs(host, 'tawmae.xyz') && path.indexOf('/overlays/') === 0) {
      return { id: 'tawmae-overlay', label: 'Tawmae Overlay', profile: 'address-port-password' };
    }
    if (hostIs(host, 'vortisrd.github.io') && path.indexOf('/chatrd/') === 0) {
      return { id: 'chatrd', label: 'ChatRD', profile: 'chatrd' };
    }
    return null;
  }

  function inferredProvider(parsed) {
    if (!parsed) return null;
    var keys = queryKeys(parsed.url);
    if (keys.streamerbotserveraddress || keys.streamerbotserverport) {
      return { id: 'generic-chatrd', label: 'Streamer.bot-Parameter', profile: 'chatrd', inferred: true };
    }
    var pairs = [
      { host: 'address', profile: 'address-port' },
      { host: 'addr', profile: 'address-port' },
      { host: 'host', profile: 'host-port' },
      { host: 'hostname', profile: 'host-port' },
      { host: 'server', profile: 'server-port' },
      { host: 'serveraddress', profile: 'server-port' },
      { host: 'ip', profile: 'ip-port' }
    ];
    for (var i = 0; i < pairs.length; i++) {
      if (keys[pairs[i].host] && keys.port) {
        return { id: 'generic-' + pairs[i].profile, label: 'Streamer.bot-Parameter', profile: pairs[i].profile, inferred: true };
      }
    }
    if (keys.websocketurl) return { id: 'generic-websocket-url', label: 'Streamer.bot WebSocket', profile: 'websocketUrl', inferred: true };
    if (keys.websocket) return { id: 'generic-websocket', label: 'Streamer.bot WebSocket', profile: 'websocket', inferred: true };
    if (keys.wsurl || keys.ws) return { id: 'generic-ws', label: 'Streamer.bot WebSocket', profile: 'ws', inferred: true };
    return null;
  }

  function detect(input) {
    var parsed = parse(input);
    var provider = knownProvider(parsed) || inferredProvider(parsed);
    if (!provider) return { known: false, id: '', label: '', profile: 'auto', inferred: false };
    return {
      known: true,
      id: provider.id,
      label: provider.label,
      profile: provider.profile,
      inferred: provider.inferred === true,
      cloud: provider.cloud === true
    };
  }

  function setValue(url, key, value, values) {
    if (value == null || String(value) === '') return;
    url.searchParams.set(key, String(value));
    values[key] = value;
  }

  function applyProfile(url, profile, config, values) {
    var host = String(config.host || '').trim();
    var port = parseInt(config.port, 10) || 0;
    var ws = host && port ? 'ws://' + host + ':' + port + '/' : '';

    if (profile === 'address-port' || profile === 'address-port-password') {
      setValue(url, 'address', host, values);
      setValue(url, 'port', port, values);
      if (profile === 'address-port-password' && String(config.password || '').trim()) {
        setValue(url, 'password', String(config.password).trim(), values);
      }
    } else if (profile === 'host-port') {
      setValue(url, 'host', host, values); setValue(url, 'port', port, values);
    } else if (profile === 'server-port') {
      setValue(url, 'server', host, values); setValue(url, 'port', port, values);
    } else if (profile === 'ip-port') {
      setValue(url, 'ip', host, values); setValue(url, 'port', port, values);
    } else if (profile === 'chatrd') {
      setValue(url, 'streamerBotServerAddress', host, values);
      setValue(url, 'streamerBotServerPort', port, values);
    } else if (profile === 'ws') {
      setValue(url, 'ws', ws, values);
    } else if (profile === 'websocket') {
      setValue(url, 'websocket', ws, values);
    } else if (profile === 'websocketUrl') {
      setValue(url, 'websocketUrl', ws, values);
    }
  }

  function apply(input, config) {
    var parsed = parse(input);
    var info = detect(input);
    config = config || {};
    if (!parsed || !info.known) return { known: false, url: String(input || ''), values: {}, profile: 'auto', label: '' };
    if (info.cloud || info.profile === 'none') {
      return { known: true, url: parsed.raw, values: {}, profile: 'none', label: info.label, id: info.id };
    }

    var values = {};
    applyProfile(parsed.url, info.profile, config, values);
    if (config.includeMonitorParams) {
      setValue(parsed.url, 'monitorWidth', parseInt(config.monitorWidth, 10) || 0, values);
      setValue(parsed.url, 'monitorHeight', parseInt(config.monitorHeight, 10) || 0, values);
    }
    return {
      known: true,
      url: parsed.url.toString(),
      values: values,
      profile: info.profile,
      label: info.label,
      id: info.id,
      inferred: info.inferred
    };
  }

  root.KappiOverlayLinkRecognizer = {
    detect: detect,
    apply: apply,
    references: [
      'https://mustachedmaniac.com/widgets/Viewer_Queue/',
      'https://streamlabs.com/widgets/event-list/',
      'https://streamelements.com/overlay/',
      'https://tawmae.xyz/overlays/better-shoutouts',
      'https://tawmae.xyz/overlays/dynamic-timers-v2',
      'https://tawmae.xyz/overlays/giphy-and-sb',
      'https://vortisrd.github.io/chatrd/chat.html'
    ]
  };
})(window);