/* ============================================================================
   underlay.js — loading a raster image or a CAD drawing as a background

   Handles the file -> project-underlay step, including:
   - image files (png / jpg / webp / gif / bmp) decoded to an <img>
   - ASCII DXF parsed by dxf.js into flat geometry
   - binary DWG: not decodable in the browser, so it is detected and the user
     is told to export a DXF instead, with a suggested scale

   The underlay lives on the project so it can be moved, scaled, faded and
   exported/imported with the rest of the schedule.
   ==========================================================================*/
'use strict';

var UNDERLAY = (function () {

  var MAX_BYTES = 80 * 1024 * 1024;

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      if (file.size > MAX_BYTES) {
        reject(new Error('File is ' + (file.size / 1048576).toFixed(0) + ' MB — too large to load in the browser.'));
        return;
      }
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error || new Error('Could not read the file.')); };
      fr.readAsArrayBuffer(file);
    });
  }

  function ext(name) {
    var m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  /* DWG files start with the ASCII tag "AC10xx"; they are a proprietary
     binary format we cannot decode, so say so plainly rather than failing
     silently or pretending it loaded. Accepts an ArrayBuffer or a typed
     array — readFile hands back an ArrayBuffer, tests pass a Uint8Array. */
  function isDwg(buf) {
    if (!buf) return false;
    var bytes = (buf instanceof ArrayBuffer) ? new Uint8Array(buf) : buf;
    var head = '';
    for (var i = 0; i < 6; i++) head += String.fromCharCode(bytes[i] || 0);
    return /^AC10\d\d$/.test(head);
  }
  function isDxfText(text) {
    /* A DXF is a long run of group-code / value pairs and always names its
       sections. Requiring an early "0 / SECTION" pair, or an AutoCAD comment
       group, is a reliable enough sniff without parsing the whole file. */
    var head = text.slice(0, 4000);
    return /(^|\n)[ \t]*0[ \t]*(\r\n|\n|\r)[ \t]*SECTION[ \t]*(\r\n|\n|\r)/.test(head) ||
           /(^|\n)[ \t]*999[ \t]*(\r\n|\n|\r)/.test(text.slice(0, 2000)) ||
           /(^|\n)[ \t]*0[ \t]*(\r\n|\n|\r)[ \t]*HEADER[ \t]*(\r\n|\n|\r)/.test(head);
  }

  function loadImage(file, dataUrl) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        resolve({ kind: 'image', name: file.name, img: img, w: img.naturalWidth, h: img.naturalHeight });
      };
      img.onerror = function () { reject(new Error('Could not decode the image.')); };
      img.src = dataUrl;
    });
  }

  /* Load any supported file into an underlay object (not yet placed). */
  function load(file) {
    var name = file.name || 'drawing';
    var e = ext(name);
    var isImage = /^image\//.test(file.type) || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'].indexOf(e) >= 0;

    if (isImage) {
      return readFile(file).then(function (buf) {
        var url = URL.createObjectURL(new Blob([buf], { type: file.type || 'image/png' }));
        return loadImage(file, url).then(function (r) {
          r.dataUrl = url;
          r.opacity = 0.9;
          r.colour = null;
          return r;
        });
      });
    }

    return readFile(file).then(function (buf) {
      if (isDwg(buf)) {
        var err = new Error(
          '“' + name + '” is a DWG file. DWG is a closed binary format and cannot be read in a browser.\n\n' +
          'Export a DXF instead (AutoCAD: SAVEAS → AutoCAD DXF, or use ODA File Converter / QCAD / LibreDWG), then drop that in here.'
        );
        err.code = 'DWG_UNSUPPORTED';
        throw err;
      }
      var text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      if (!isDxfText(text)) {
        var err2 = new Error('“' + name + '” does not look like an ASCII DXF file.');
        err2.code = 'NOT_DXF';
        throw err2;
      }
      var geo = DXF.parse(text, { maxPoints: 600000 });
      if (!geo.entities.length) {
        var err3 = new Error('No usable geometry found in “' + name + '”.');
        err3.code = 'EMPTY_DXF';
        throw err3;
      }
      return {
        kind: 'dxf', name: name, geo: geo, srcText: text,
        opacity: 0.85, layersOff: geo.layersOff, colour: null
      };
    });
  }

  /* Attach a freshly loaded underlay to the project and fit it to the site.
     Returns a short report for the UI. */
  function attach(p, u) {
    u.scale = u.scale || 1;
    if (!isFinite(u.ox)) u.ox = 0;
    if (!isFinite(u.oy)) u.oy = 0;
    u.visible = u.visible !== false;
    if (u.kind === 'image' && !u.geo) {
      u.geo = { minX: 0, minY: 0, maxX: u.w, maxY: u.h, width: u.w, height: u.h };
    }
    p.underlay = u;
    fit(p, u);
    return report(u);
  }

  function fit(p, u) {
    u = u || p.underlay;
    if (!u || !u.geo) return;
    var w = u.geo.width, h = u.geo.height;
    if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return;
    var minX = isFinite(u.geo.minX) ? u.geo.minX : 0;
    var minY = isFinite(u.geo.minY) ? u.geo.minY : 0;
    var margin = 0.04;
    var availW = p.site.w * (1 - margin * 2);
    var availH = p.site.h * (1 - margin * 2);
    /* fit the larger dimension: never distort the drawing's aspect ratio */
    u.scale = Math.min(availW / w, availH / h);
    u.ox = (p.site.w - w * u.scale) / 2 - minX * u.scale;
    u.oy = (p.site.h - h * u.scale) / 2 - minY * u.scale;
  }

  /* Human-readable summary for the UI after loading. Tolerates a partial
     underlay object so it can be called on restored or hand-built data. */
  function report(u) {
    var out = { name: u.name || 'drawing', kind: u.kind };
    if (u.kind === 'image') {
      out.size = (u.w || '?') + ' × ' + (u.h || '?') + ' px';
      out.scale = u.scale;
      out.note = 'Placed at ' + ((u.scale || 0) * 1000).toFixed(2) + ' mm per pixel. Set the scale to match a known dimension on the image.';
      return out;
    }
    var g = u.geo || {};
    var w = g.width, h = g.height;
    out.size = (isFinite(w) && isFinite(h) ? w.toFixed(1) + ' × ' + h.toFixed(1) : '?') +
               ' ' + (g.unitName && g.unitName !== 'unitless' ? g.unitName : 'units');
    out.layers = (g.layers || []).length;
    out.entities = (g.entities || []).length;
    var st = g.stats || {};
    out.drawn = st.drawn || 0;
    out.skipped = st.skipped || {};
    out.warnings = g.warnings || [];
    out.unit = g.unitName;
    out.metresPerUnit = g.metresPerUnit;
    out.scale = u.scale;
    if (g.metresPerUnit) out.note = 'Read as ' + g.unitName + ' (' + g.metresPerUnit + ' m per unit).';
    else out.note = 'No unit scale in the file — set the scale to metres per drawing unit.';
    return out;
  }

  /* Read a scale the user typed, e.g. "0.001", "1:100", or a known-length
     measurement, and return metres per drawing unit. */
  function parseScale(text, drawingWidth) {
    var s = String(text || '').trim().toLowerCase();
    if (!s) return null;
    var m;
    if ((m = /^(\d+(?:\.\d+)?)\s*(mm|cm|m|km|in|ft)$/.exec(s))) {
      var u = { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048 }[m[2]];
      return parseFloat(m[1]) * u;
    }
    if ((m = /^1\s*:\s*(\d+(?:\.\d+)?)$/.exec(s))) {
      // a 1:N scale means 1 drawing unit of paper = N of reality, but we need
      // the real-world size of one drawing unit; if the drawing is in mm and
      // the user means "1 unit = 1 mm", this is just 0.001
      return null;
    }
    var n = parseFloat(s);
    return isFinite(n) && n > 0 ? n : null;
  }

  return {
    load: load, attach: attach, fit: fit, report: report,
    isDwg: isDwg, isDxfText: isDxfText, parseScale: parseScale
  };
})();
