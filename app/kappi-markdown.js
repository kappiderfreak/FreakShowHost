/*
 * Mini-Markdown fuer die Notizen (Speckzettel): Ueberschriften (#, ##, ###),
 * Tabellen (| a | b |), Listen (- Punkt), **fett**, *kursiv*, __unterstrichen__,
 * ~~durchgestrichen~~. Wird im ECHTEN Overlay (endgame-cheatsheet.js) UND in der
 * Einstellungsseiten-Vorschau benutzt, damit beide identisch rendern.
 *
 * Bewusst KEIN HTML-Escaping: die Notizen durften schon immer HTML enthalten
 * (<b>/<i>/<u> aus dem Bedienfeld); Quelle ist der eigene, lokale Text.
 * Beide Anzeigen nutzen white-space:pre-wrap -> normale Zeilen behalten ihr \n,
 * Block-Elemente (Ueberschrift/Tabelle/Liste) bringen ihre eigene Zeile mit und
 * bekommen deshalb KEIN zusaetzliches \n (sonst entstehen Leerzeilen).
 */
(function () {
  'use strict';

  function inline(s) {
    return String(s)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/__([^_]+)__/g, '<u>$1</u>')
      .replace(/~~([^~]+)~~/g, '<s>$1</s>')
      .replace(/\*([^*\n]+)\*/g, '<i>$1</i>');
  }

  function isTableLine(l) { return /^\s*\|.*\|\s*$/.test(l); }
  function isSepLine(l) { return /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(l); }
  function cells(l) {
    var t = l.trim().replace(/^\|/, '').replace(/\|$/, '');
    return t.split('|').map(function (c) { return c.trim(); });
  }

  var TD = 'border:1px solid rgba(128,144,168,.55);padding:2px 8px;text-align:left;vertical-align:top;';

  // Das Notiz-Feld ist ein contenteditable-DIV: Zeilen werden dort als <div>…</div>
  // (leere Zeile: <div><br></div>) bzw. <br> gespeichert – NICHT als \n. Fuer die
  // zeilenbasierte Markdown-Erkennung in \n umwandeln; Inline-HTML (<b>/<i>/<u>/<span>)
  // bleibt unberuehrt. Alte Notizen mit echten \n laufen unveraendert durch.
  function htmlLinesToText(s) {
    return String(s)
      .replace(/\r/g, '')
      .replace(/<div[^>]*>(?:\s|&nbsp;)*<br\s*\/?>(?:\s|&nbsp;)*<\/div>/gi, '<div></div>')
      .replace(/<\/div>\s*<div[^>]*>/gi, '\n')
      .replace(/^\s*<div[^>]*>/i, '')
      .replace(/<\/div>\s*$/i, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?div[^>]*>/gi, '\n')
      .replace(/&nbsp;/g, ' ');
  }

  function md(text) {
    var lines = htmlLinesToText(text == null ? '' : text).split('\n');
    var out = [];
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];

      // Tabelle: aufeinanderfolgende |-Zeilen; 2. Zeile "| --- |" = Kopfzeilen-Trenner.
      if (isTableLine(line)) {
        var rows = [];
        while (i < lines.length && isTableLine(lines[i])) { rows.push(lines[i]); i++; }
        var hasSep = rows.length >= 2 && isSepLine(rows[1]);
        var html = '<table style="border-collapse:collapse;margin:.25em 0;">';
        var start = 0;
        if (hasSep) {
          html += '<tr>' + cells(rows[0]).map(function (c) { return '<th style="' + TD + 'font-weight:800;">' + inline(c) + '</th>'; }).join('') + '</tr>';
          start = 2;
        }
        for (var r = start; r < rows.length; r++) {
          if (isSepLine(rows[r])) continue;
          html += '<tr>' + cells(rows[r]).map(function (c) { return '<td style="' + TD + '">' + inline(c) + '</td>'; }).join('') + '</tr>';
        }
        html += '</table>';
        out.push({ block: true, html: html });
        continue;
      }

      // Liste: aufeinanderfolgende "- "-Zeilen.
      if (/^\s*-\s+/.test(line)) {
        var lis = [];
        while (i < lines.length && /^\s*-\s+/.test(lines[i])) { lis.push(lines[i].replace(/^\s*-\s+/, '')); i++; }
        out.push({ block: true, html: '<ul style="margin:.15em 0 .15em 1.15em;padding:0;">' + lis.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ul>' });
        continue;
      }

      // Ueberschriften: #  ##  ###
      var m = /^(#{1,3})\s+(.*)$/.exec(line);
      if (m) {
        var lvl = m[1].length;
        var size = lvl === 1 ? '1.55em' : (lvl === 2 ? '1.3em' : '1.12em');
        out.push({ block: true, html: '<div style="font-size:' + size + ';font-weight:800;line-height:1.2;margin:.12em 0;">' + inline(m[2]) + '</div>' });
        i++;
        continue;
      }

      out.push({ block: false, html: inline(line) });
      i++;
    }

    var s = '';
    for (var k = 0; k < out.length; k++) {
      if (out[k].block) { s += out[k].html; }
      else {
        s += out[k].html;
        if (k < out.length - 1 && !out[k + 1].block) s += '\n';
      }
    }
    return s;
  }

  window.kappiMarkdown = md;
})();
