/* ================================================================ XLSX ========
   Writing a real .xlsx file, with nothing to install.

   An .xlsx is a ZIP archive containing a handful of XML files. That sounds like
   a dependency, and it would be if the ZIP had to be compressed — but ZIP's
   "stored" method is a valid compression method, so a conforming archive can
   carry uncompressed members and every spreadsheet program will open it. The
   alternative — shelling out to a library or a converter — would break the one
   property this whole app is built on: it runs from a file:// URL with nothing
   installed and nothing fetched.

   So: CRC-32 (about twenty lines), local file headers, and a central directory.
   No compression, which means the files are larger than Excel's own output. For
   a load schedule that is a few hundred kilobytes, and it opens everywhere.

   What is deliberately NOT here: styling, formulas, multiple fonts, merged
   cells, charts, conditional formatting. A schedule is a grid of numbers and a
   few hundred cells of text, and the value of an import that opens in Excel
   without a repair prompt is worth more than the value of colour-coding. Bold
   headers and column widths are included because they are cheap; anything past
   that is a spreadsheet application wearing a disguise. */
(function (root) {
  'use strict';

  /* ---- CRC-32, the only piece of arithmetic a ZIP needs ------------------ */
  var CRC_TABLE = (function () {
    var t = new Array(256), c, n, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---- byte helpers ------------------------------------------------------ */
  /* Everything is assembled as an array of byte values, because the ZIP format
     is byte-oriented and the offsets in the central directory are byte counts.
     Concatenating strings and hoping the encoding works is how these writers
     end up producing archives that unzip on the author's machine only. */
  function utf8(str) {
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F)); }
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
        /* a surrogate pair is one code point, not two */
        var lo = str.charCodeAt(i + 1);
        var cp = 0x10000 + ((c - 0xD800) << 10) + (lo - 0xDC00);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
        i++;
      } else { out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F)); }
    }
    return out;
  }

  function u16(v) { return [v & 0xFF, (v >>> 8) & 0xFF]; }
  function u32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }

  /* ---- the archive ------------------------------------------------------- */
  function zip(files) {
    var local = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = utf8(f.name);
      var data = f.data;
      var crc = crc32(data);
      /* Local file header. Method 0 is "stored" — no compression. */
      var head = [].concat(
        u32(0x04034B50), u16(20), u16(0x0800), u16(0),    /* signature, version, UTF-8 names, stored */
        u16(0), u16(0),                                  /* time, date — fixed, so the file is reproducible */
        u32(crc), u32(data.length), u32(data.length),
        u16(name.length), u16(0)
      );
      local = local.concat(head, name, data);
      /* offset is a byte count, so it must be the flattened length. head and name
         are already flat byte arrays, and data is one, so their lengths are
         correct — asserted here because a nested one would silently corrupt
         every subsequent offset and produce an archive that unzips to nothing. */

      /* Central directory entry: 46 bytes of fixed fields, then the name.

         The layout is fixed and getting it wrong is silent — a reader that walks
         the local file headers will still find every member with a matching CRC,
         so the archive looks almost right, and only the central directory is
         nonsense. Every tool reads the central directory, so the file simply
         would not open, and the symptom pointed nowhere near the cause.

         Two mistakes are worth recording because both produce exactly that
         symptom, and both were made here:

         - **A missing field.** Every one of the 17 below is required. One short
           of them and the name length lands in the wrong place.
         - **A three-argument `concat.apply`.** `Function.prototype.apply` takes
           exactly two: a `thisArg` and an argument *array*. Written as
           `concat.apply([], cd, name)` the third argument is silently ignored, so
           the name was never appended at all — every entry was 46 bytes, which
           happens to be the fixed-field size, which is why it looked plausible.

         So the fields are spread and the name pushed separately, with nothing
         clever and nothing implied. */
      var cd = [
        u32(0x02014B50),
        u16(20),          /* version made by */
        u16(20),          /* version needed */
        u16(0x0800),      /* UTF-8 names */
        u16(0),           /* method: stored */
        u16(0), u16(0),   /* time, date */
        u32(crc),
        u32(data.length), /* compressed size — same, nothing is compressed */
        u32(data.length), /* uncompressed size */
        u16(name.length),
        u16(0),           /* extra field length */
        u16(0),           /* comment length */
        u16(0),           /* disk number start */
        u16(0),           /* internal attributes */
        u32(0),           /* external attributes */
        u32(offset)
      ];
      /* Two pushes, not one clever line. `cd` holds seventeen byte-*arrays* and
         has to be spread a level; `name` is already a flat array of byte values
         and must simply follow it. */
      Array.prototype.push.apply(central, [].concat.apply([], cd));
      Array.prototype.push.apply(central, name);

      offset += head.length + name.length + data.length;
    });

    var end = [].concat(
      u32(0x06054B50), u16(0), u16(0),
      u16(files.length), u16(files.length),
      u32(central.length), u32(local.length),
      u16(0)
    );
    /* Flatten. `local` is built by concatenating arrays of byte values, so it
       contains numbers — but Array.prototype.concat on a nested array spreads one
       level, and passing a still-nested array to Blob() stringifies it into
       "38,30,37,..." rather than writing those bytes. Which is exactly what
       happened: the file began with the ASCII text "8075342000800000". */
    /* A typed array, not a plain one. Blob() coerces a plain array through
       String(), which turns 80,75,3,4 into the text "807534" — the file then
       begins with ASCII digits instead of the ZIP signature and nothing will
       open it. Uint8Array carries the bytes through untouched. */
    var flat = new Uint8Array([].concat(local, central, end));
    return new Blob([flat], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  /* ---- SpreadsheetML ----------------------------------------------------- */
  /* Cell references are A1-style and the column letters are base-26, so column
     27 is AA. Getting that wrong shifts every cell after the first 26 columns,
     which is exactly where a load schedule's extra data lives. */
  function colName(n) {
    var s = '';
    n = n + 1;
    while (n > 0) {
      var r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function esc(v) {
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      /* XML 1.0 forbids most control characters outright. Stripping them is
         better than emitting a file Excel refuses to open. */
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  /* Excel's own limit, and a real one: a worksheet cannot address beyond it. */
  var MAX_ROWS = 1048576, MAX_COLS = 16384;

  /* A cell is inline rather than shared-string, which costs size but removes a
     whole file from the archive and the lookup table that goes with it. */
  function cellXml(v, row, col, styleId) {
    var ref = colName(col) + row;
    var a = ' s="' + styleId + '"';
    if (v === null || v === undefined || v === '') return '<c r="' + ref + '"' + a + '/>';
    if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + a + '><v>' + v + '</v></c>';
    if (typeof v === 'boolean') return '<c r="' + ref + '"' + a + ' t="b"><v>' + (v ? 1 : 0) + '</v></c>';
    return '<c r="' + ref + '"' + a + ' t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
  }

  /* `rows` is an array of arrays. `cols` optionally gives a width per column. */
  function sheetXml(rows, opts) {
    opts = opts || {};
    var out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'];
    if (opts.freezeRow) {
      out.push('<sheetViews><sheetView workbookViewId="0">',
        '<pane ySplit="' + opts.freezeRow + '" topLeftCell="A' + (opts.freezeRow + 1) +
        '" activePane="bottomLeft" state="frozen"/>',
        '</sheetView></sheetViews>');
    }
    if (opts.cols && opts.cols.length) {
      out.push('<cols>');
      opts.cols.forEach(function (w, i) {
        if (!w) return;
        out.push('<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w +
          '" customWidth="1"/>');
      });
      out.push('</cols>');
    }
    out.push('<sheetData>');
    var n = Math.min(rows.length, MAX_ROWS);
    for (var r = 0; r < n; r++) {
      var row = rows[r] || [];
      out.push('<row r="' + (r + 1) + '">');
      var nc = Math.min(row.length, MAX_COLS);
      for (var c = 0; c < nc; c++) {
        /* Style 1 is the header: bold on a grey fill. Everything else is plain. */
        var st = (opts.headerRows && r < opts.headerRows) ? 1 : 0;
        out.push(cellXml(row[c], r + 1, c, st));
      }
      out.push('</row>');
    }
    out.push('</sheetData></worksheet>');
    return out.join('');
  }

  /* ---- styles ------------------------------------------------------------ */
  /* Three styles: normal, bold grey header, and a number format for the values
     that need one. A style index of 0 is the default, so every cell names its
     own and the reader never has to guess. */
  function stylesXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2">' +
      '<font><sz val="10"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="10"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>' +
      '</fonts>' +
      '<fills count="3">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF334155"/><bgColor indexed="64"/></patternFill></fill>' +
      '</fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';
  }

  /* Sheet names have rules Excel enforces: 31 characters, and none of
     : \ / ? * [ ]. A name taken from a board tag can break all of those. */
  function safeSheetName(name, used) {
    var s = String(name || 'Sheet')
      .replace(/[:\\/?*\[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 31) || 'Sheet';
    used = used || {};
    if (!used[s]) { used[s] = 1; return s; }
    var base = s, n = 2;
    while (used[s]) {
      var suffix = ' (' + n + ')';
      s = base.slice(0, 31 - suffix.length) + suffix;
      n++;
    }
    used[s] = 1;
    return s;
  }

  /* ---- the workbook ------------------------------------------------------ */
  /* `sheets` is [{ name, rows, cols, freezeRow, headerRows }]. */
  function build(sheets) {
    var used = {};
    /* Every option is carried through, not just the name and the rows. An earlier
       version rebuilt each sheet as `{ name, rows }` and dropped the rest, so
       header styling, column widths and frozen panes were silently discarded —
       the file opened perfectly and simply looked like nothing had been asked
       for. */
    var named = sheets.map(function (s) {
      return {
        name: safeSheetName(s.name, used),
        rows: s.rows || [],
        cols: s.cols || null,
        freezeRow: s.freezeRow === undefined ? null : s.freezeRow,
        headerRows: s.headerRows === undefined ? null : s.headerRows
      };
    });

    var files = [];
    files.push({
      name: '[Content_Types].xml',
      data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        named.map(function (s) {
          return '<Override PartName="/xl/worksheets/sheet' +
            (named.indexOf(s) + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
        }).join('') +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>')
    });
    files.push({
      name: '_rels/.rels',
      data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>')
    });
    files.push({
      name: 'xl/workbook.xml',
      data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        named.map(function (s, i) {
          return '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
        }).join('') +
        '</sheets></workbook>')
    });
    files.push({
      name: 'xl/_rels/workbook.xml.rels',
      data: utf8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        named.map(function (s, i) {
          return '<Relationship Id="rId' + (i + 1) +
            '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' +
            (i + 1) + '.xml"/>';
        }).join('') +
        '<Relationship Id="rId' + (named.length + 1) +
        '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>')
    });
    files.push({ name: 'xl/styles.xml', data: utf8(stylesXml()) });

    named.forEach(function (s, i) {
      files.push({
        name: 'xl/worksheets/sheet' + (i + 1) + '.xml',
        data: utf8(sheetXml(s.rows, {
          cols: s.cols, freezeRow: s.freezeRow, headerRows: s.headerRows
        }))
      });
    });

    return zip(files);
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { build: build, crc32: crc32, colName: colName };
  root.XLSXW = { build: build, crc32: crc32, colName: colName, safeSheetName: safeSheetName };
  if (typeof window !== 'undefined') window.XLSXW = root.XLSXW;
})(typeof window !== 'undefined' ? window : this);