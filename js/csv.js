/* ============================================================================
   csv.js — reading a spreadsheet someone else made

   The app can already write a load schedule; it could not read one back. Data
   had to arrive through hand-edited Python scripts, which meant every schedule
   needed a script written for it before anything could be imported.

   Two things make that problem tractable in general. First, CSV is a small,
   fully specified format and the awkward cases — quotes, commas and newlines
   inside cells, a different delimiter, a byte-order mark — are all enumerable.
   Second, every load schedule has the same shape underneath even when the
   column names differ: a reference, a board, a description, a load. So the
   problem is not "understand this file" but "which of these columns is the
   board", which is a mapping the user confirms once and the app remembers for
   the next file.

   Nothing here guesses silently. Every column the importer does not recognise
   is reported, and the mapping is shown before anything is imported.
   ========================================================================== */
(function () {
  'use strict';
  var CSVC = {};

  /* ------------------------------------------------------------- parsing -- */

  /* Delimiters seen often enough in engineering exports to be worth looking
     for. Comma first because it is what the app writes and what most tools
     default to; a semicolon is the European default when the decimal comma is
     in use, and a tab appears when a file has been through a spreadsheet
     paste. */
  var DELIMS = [',', ';', '\t', '|'];

  /* A CSV parser, not a split. The differences all matter in practice:
       - a quoted cell may contain the delimiter, a newline, or both
       - "" inside a quoted cell is one literal quote, not the end of the cell
       - a quoted cell may appear anywhere in a row, not only at the start
       - a trailing newline at the end of the file is not a blank row
     Written as a single scan because splitting on the delimiter first would
     destroy exactly the information quoted fields exist to preserve. */
  function parse(text, delim) {
    /* A BOM at the start is not part of the first header name, and leaving it
       there silently breaks any lookup by column name. */
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var rows = [], row = [], cell = '', i = 0, n = text.length;
    var inQuotes = false, wasQuoted = false;
    delim = delim || sniff(text);
    var d = delim.length > 1 ? delim[0] : delim;

    while (i < n) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        cell += ch; i++; continue;
      }
      if (ch === '"') { inQuotes = true; wasQuoted = true; i++; continue; }
      if (ch === d) { row.push(cell); cell = ''; wasQuoted = false; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; wasQuoted = false; i++; continue; }
      cell += ch; i++;
    }
    /* The last row has no newline of its own. A file ending in a newline has
       already been flushed by the branch above, so this only adds a row when
       there is genuinely something there. */
    if (cell.length || row.length || wasQuoted) { row.push(cell); rows.push(row); }

    /* Normalise every row to the width of the widest. A short row means the
       author stopped early; padding with blanks keeps column indices honest
       instead of shifting the rest of the row left. */
    var w = 0;
    rows.forEach(function (r) { if (r.length > w) w = r.length; });
    if (!w) return { rows: [], delim: d };
    return {
      rows: rows.map(function (r) {
        while (r.length < w) r.push('');
        return r.map(function (c) { return c.trim(); });
      }),
      delim: d
    };
  }

  /* Pick the delimiter by counting candidates outside quotes on the first few
     lines. Counting every line rather than one matters: a description with a
     comma in it can outvote the real delimiter if only the header is read,
     and a description with a semicolon in it can outvote a comma-delimited
     file. Whichever delimiter gives the most *consistent* column count across
     lines wins, and ties go to the earliest candidate so comma stays the
     default. */
  function sniff(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var lines = [], start = 0;
    /* Only the first 20 lines: enough to be sure, few enough that a very large
       file is not scanned twice. */
    for (var i = 0; i < text.length && lines.length < 20; i++) {
      if (text[i] === '\n') {
        lines.push(text.slice(start, i));
        start = i + 1;
        if (lines.length >= 10) break;
      }
    }
    if (start < text.length && lines.length < 20) lines.push(text.slice(start));

    var best = ',', bestScore = -1;
    DELIMS.forEach(function (d) {
      var counts = lines.map(function (l) { return countOutside(l, d); });
      if (!counts.length) return;
      /* The modal count is taken over the lines that actually contain the
         delimiter, ignoring the ones that do not.

         That distinction matters more than it looks. A vendor file opens with
         the project title and the revision, and neither contains the
         delimiter, so with those counted the mode is a dead heat between zero
         and the real column count — and zero wins on the tie, because it came
         first. Every delimited file would then be read as a single column.

         Only the lines with the delimiter in them vote, which is the set that
         actually describes the table. */
      var tally = {};
      counts.forEach(function (c) { if (c > 0) tally[c] = (tally[c] || 0) + 1; });
      var keys = Object.keys(tally);
      if (!keys.length) return;
      var mode = 0, agree = 0;
      keys.forEach(function (k) { if (tally[k] > agree) { agree = tally[k]; mode = +k; } });
      /* agreement across lines is the stronger signal — a comma inside one
         description inflates one line, but it cannot inflate seven */
      var score = agree * 1000 + mode;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  }

  function countOutside(line, delim) {
    var c = 0, inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') inQ = !inQ;
      else if (!inQ && ch === delim) c++;
    }
    return c;
  }

  CSVC.parse = parse;
  CSVC.sniff = sniff;

  /* -------------------------------------------------------- header names -- */

  /* Fold a header to a comparison key: lower case, and only letters and
     digits. "Feeder mm²", "Feeder mm2" and "feeder  mm2 " are the same column,
     and no spreadsheet worth reading distinguishes them. */
  function key(h) {
    /* The superscript two is folded to a plain 2 first: a spreadsheet column
       headed "Feeder mm²" is the same column as one headed "Feeder mm2", and
       dropping the character instead would reduce it to "feedermm" and lose
       the match. */
    return String(h == null ? '' : h)
      .replace(/\u00b2/g, '2').replace(/\u00b3/g, '3')
      .toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /* The app's own column names, and the words a vendor is likely to use for
     the same thing. Order matters within each list: the first pattern that
     matches a header wins, so the specific names come first. A match must be
     exact on the folded key — substring matching would claim "Demand" for a
     column called "Demand factor" and then the wrong number would be the load.

     Each entry is [field, [accepted keys]]. */
  var FIELDS = [
    ['tag', ['reference', 'ref', 'tag', 'circuit', 'circuitref', 'circuitno', 'circno', 'itemno', 'item', 'id',
             'loadref', 'tagref', 'designation', 'number', 'no', 'feederid', 'feederref', 'feeder',
             'circuitid', 'point', 'pointreference', 'tagno', 'way', 'circuitname']],
    ['board', ['board', 'boardtag', 'fedfrom', 'fedby', 'supply', 'supplyfrom', 'suppliedfrom', 'supplyboard',
               'distributionboard', 'pdp', 'subboard', 'db', 'panelboard', 'switchboard', 'boardname',
               'from', 'fromboard', 'boardref']],
    ['description', ['description', 'load', 'equipment', 'equip', 'loadname', 'equipmentdescription',
                     'itemdescription', 'name', 'details', 'detail', 'duty', 'circuitdescription', 'finalcircuit']],
    ['type', ['type', 'loadtype', 'category', 'kind', 'classification']],
    ['kw', ['connectedkw', 'kw', 'loadkw', 'connectedload', 'power', 'powerkw', 'loadpower', 'demandkw',
            'connecteddemand', 'activepower', 'kwconnected', 'runningload', 'loadpowerkw', 'connectedloadkw',
            'connectedloadkwatt', 'installedpower']],
    ['kva', ['designkva', 'kva', 'kvarated', 'connectedkva', 'apparentpower', 'designkvar']],
    ['pf', ['pf', 'powerfactor', 'cos', 'cosphi', 'cosphi1', 'powerfactor1']],
    ['demand', ['demand', 'demandfactor', 'df', 'diversity', 'maximumdemand']],
    ['phases', ['phases', 'phase', 'nophases', 'numberofphases', 'noofphases', 'ph', 'polarity', 'phasecount']],
    ['volt', ['voltage', 'volt', 'volts', 'v', 'voltagev', 'supplyvoltage', 'systemvoltage', 'lvvoltage', 'voltages']],
    ['prot', ['protectivedevice', 'protection', 'protectiondevice', 'device', 'mcb', 'mccb', 'devicea', 'prot',
              'switch', 'protectiontype', 'deviceused', 'typeofrating', 'circuitbreaker', 'incomerprotection']],
    ['frame', ['deviceframea', 'frame', 'framea', 'frameamp', 'framesize', 'enclosure', 'enclosurea', 'boardrating', 'ratinga']],
    ['icu', ['breakingcapacityka', 'breakingcapacity', 'icu', 'kic', 'faultcapacity', 'ikc', 'breakingcapacitykic']],
    ['trip', ['tripunit', 'trip', 'relay', 'overload', 'trippingunit', 'adjustmentrange']],
    ['start', ['startingmethod', 'startmethod', 'starter', 'starting', 'start', 'dol', 'dolstart', 'drive', 'motors']],
    ['neutral', ['neutralcarried', 'neutralconductor', 'carriesneutral', 'neutralcarriedback', 'neutralpresent', 'hasneutral']],
    ['imbalance', ['imbalance', 'phaseimbalance', 'imbalancepercent', 'unbalance']],
    ['loadTorque', ['loadtorque', 'loadorquetype', 'torquecharacteristic', 'torque', 'loadcharacteristic',
                   'loaddescription', 'loadtype', 'momentofinertia']],
    ['simultaneousStart', ['startingtogether', 'simultaneousstart', 'startsogether', 'startingwith',
                            'simultaneous', 'numberstarting', 'startstogether']],
    ['csa', ['feedermm2', 'mm2', 'csa', 'cablesize', 'cable', 'crosssection', 'crosssectionalarea', 'size',
             'cablersize', 'feedersize', 'conductor', 'fittedcable', 'installedcable', 'supplycable',
             'cabletype', 'cablecore', 'conductorcrosssection', 'cablesizes']],
    ['runs', ['feederruns', 'runs', 'nocables', 'parallel', 'numberofcables', 'noofcables', 'run', 'perway',
              'cablersun', 'noparallel', 'parallelcables']],
    ['cores', ['cores', 'core', 'nocores', 'numberofcores', 'corecount', 'noofcores']],
    ['len', ['lengthm', 'length', 'runlength', 'runlm', 'distance', 'route', 'm', 'cablelength', 'drop',
             'cableroutelength', 'cableroute', 'routedistance', 'meters']],
    ['method', ['installation', 'installmethod', 'method', 'laying', 'install', 'installationmethod', 'installationref']],
    ['ref', ['equipmentref', 'equipmentreference', 'vendorref', 'assetref', 'plantref', 'tagrefplant']],
    ['status', ['status', 'state', 'remarks', 'notes', 'comment', 'comments']],
    ['easting', ['gridrefe', 'easting', 'e', 'x', 'east', 'gridrefeast']],
    ['northing', ['gridrefn', 'northing', 'n', 'y', 'north', 'gridrefnorth']],
    ['grid', ['gridref', 'gridreference', 'location', 'position', 'coordinates', 'coord']]
  ];

  /* Match each header to a field. Two passes: an exact key match first, so a
     column called exactly "Board" is unambiguous, then a unique-prefix match
     for headers that carry a unit or a qualifier ("Board tag", "Connected
     load kW"). A prefix that matches more than one candidate field is left
     alone rather than guessed — "Distribution board rating" matches both
     `board` and `frame`, and picking either silently is worse than asking. */
  function mapHeaders(headers) {
    var out = [], used = {};
    headers.forEach(function (h, idx) {
      var k = key(h);
      var hit = null;
      if (k) {
        FIELDS.forEach(function (f) {
          if (hit) return;
          if (f[1].indexOf(k) >= 0) hit = f[0];
        });
      }
      if (hit && used[hit]) hit = null;   // one field, one column
      if (hit) used[hit] = true;
      out.push({ index: idx, header: h, field: hit, how: hit ? (key(h) === key(hit) ? 'exact' : 'alias') : null });
    });

    /* second pass, only for columns nothing claimed */
    headers.forEach(function (h, idx) {
      if (out[idx].field) return;
      var k = key(h);
      if (!k || k.length < 3) return;
      var cand = [];
      FIELDS.forEach(function (f) {
        f[1].forEach(function (alias) {
          if (alias.length >= 3 && (alias.indexOf(k) >= 0 || k.indexOf(alias) >= 0)) cand.push(f[0]);
        });
      });
      cand = cand.filter(function (v, i, a) { return a.indexOf(v) === i; });
      /* A wrong mapping is worse than no mapping: it puts a number in the
         wrong field and the error is not visible until the schedule is wrong. */
      if (cand.length === 1 && !used[cand[0]]) { out[idx].field = cand[0]; out[idx].how = 'fuzzy'; used[cand[0]] = true; }
      else if (cand.length > 1) out[idx].candidates = cand;
    });
    return out;
  }

  CSVC.mapHeaders = mapHeaders;
  CSVC.FIELDS = FIELDS;

  /* ----------------------------------------------------------- row values -- */

  /* Pull a number out of a cell written by a human: "1600 A", "1 600", "1600.0",
     "1600,0", "2 x 95", "95mm2". Returns null when there is no number, which
     is different from 0 — a blank load is not a zero load, and treating it as
     one would quietly drop the circuit from the totals. */
  function num(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).trim();
    if (!s) return null;
    /* a range or a pair: take the larger, which is the one that has to fit */
    var multi = s.match(/(\d[\d\s.,]*)\s*(?:\/|x|×|\+)\s*(\d[\d\s.,]*)/i);
    if (multi) return Math.max(toNum(multi[1]), toNum(multi[2]));
    var m = s.match(/-?\d[\d\s.,]*/);
    if (!m) return null;
    return toNum(m[0]);
  }
  function toNum(t) {
    /* Strip spaces and any apostrophe used as a thousands separator. */
    var s = String(t).replace(/[\s\u00a0']/g, '');
    if (s.indexOf(',') >= 0) {
      /* A comma is a thousands separator when the number also has a point, or
         when more than one comma is present, or when the last group is not
         exactly two digits. It is a decimal point otherwise. Getting this
         backwards turns 3,963.5 kW into 3 kW, which is a two-thousand-fold
         error that looks plausible on the schedule, so it is worth the three
         lines. */
      var last = s.lastIndexOf(',');
      var commas = (s.match(/,/g) || []).length;
      var looksDecimal = commas === 1 && s.indexOf('.') < 0 && (s.length - last - 1) !== 3;
      if (looksDecimal) s = s.replace(',', '.');
      else s = s.replace(/,/g, '');
    }
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }
  /* A cable cell and the run count in one cell.

     "2 x 95", "2×95mm²", "2/95", "95 x 2" are all how the same thing gets
     written, and the run count is the smaller number when the size is the
     larger. Getting them apart matters: the run count decides the derating and
     the fault withstand, and a feeder read as one run instead of four is
     undersized by a factor of four in both. */
  function runsAndCsa(v) {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    var s = String(v);
    /* only the run count and a size — not a sum, which means something else */
    var m = s.match(/^\s*(\d{1,2})\s*(?:x|×|\/|\*)\s*(\d+(?:\.\d+)?)/i);
    if (m) {
      var runs = parseInt(m[1], 10), csa = parseFloat(m[2]);
      if (runs >= 2 && csa > 0) return { csa: csa, runs: runs };
    }
    /* "95 x 2" — the size first. The cross-section must be larger than the run
       count for this to be a pair at all, which is what stops "1 x 95" being
       read as 95 runs of 1 mm²: a rule that takes the smaller number as the
       count would do exactly that, and the feeder would come in ninety-five
       times too large. */
    var m2 = s.match(/^\s*(\d+(?:\.\d+)?)\s*(?:x|×|\/|\*)\s*(\d{1,2})\s*(?:run|cable|way|core)?\s*$/i);
    if (m2) {
      var csa2 = parseFloat(m2[1]), runs2 = parseInt(m2[2], 10);
      if (runs2 >= 2 && csa2 > runs2) return { csa: csa2, runs: runs2 };
    }
    return null;
  }
  CSVC.runsAndCsa = runsAndCsa;
  CSVC.num = num;

  /* The app writes a position as "E12.0 N34.0" and most site plans write
     something similar. Both columns and one combined column are accepted. */
  function pos(eVal, nVal, combined) {
    var e = num(eVal), n = num(nVal);
    if (e === null && combined) {
      var m = String(combined).match(/E\s*(-?[\d.]+)\s*N\s*(-?[\d.]+)/i);
      if (m) { e = parseFloat(m[1]); n = parseFloat(m[2]); }
    }
    if (e === null && n === null) return null;
    return { x: e === null ? 0 : e, y: n === null ? 0 : n };
  }
  CSVC.pos = pos;

  /* Phase count, from "3", "3~", "3-", "three phases", "1", "single", "1~".
     A 230 V circuit with no phases stated has to come out as 1: computed as
     three-phase it reads three times its real current. */
  function phases(v) {
    if (v === null || v === undefined || v === '') return null;
    var s = String(v).toLowerCase().trim();
    if (/^(1|1~|single|single[- ]phase|1[- ]?ph|1ph|mono|monophase)\b/.test(s) || s === '1') return '1';
    var m = s.match(/(\d)/);
    if (!m) return null;
    if (m[1] === '1') return '1';
    if (m[1] === '2') return '2';
    return '3';
  }
  CSVC.phases = phases;

  /* A voltage. "230V", "400/230 V", "0.4kV". A three-phase system is quoted
     as line-to-line, which is what the app stores, so 400/230 is 400. */
  function volt(v) {
    var n = num(v);
    if (n === null) return null;
    if (n > 0 && n < 10) n *= 1000;      // kV
    return n;
  }
  CSVC.volt = volt;

  /* A protective device cell: "TM 200A", "200A/4P LI", "NSX 250 3P". Pull out
     the rating, the trip family and the poles, and classify it as an MCB or an
     MCCB from what is written — a "C160" is an MCB, "Compact NS" is not. */
  function device(v) {
    if (!v) return null;
    var s = String(v).trim();
    if (!s) return null;
    var out = { raw: s };
    /* Rating, breaking capacity and poles are found in that order, and each
       number is consumed once they are: "NSX 250 3P 50kA" has three numbers and
       they are three different things, so taking them in sequence is the only
       way round without mis-assigning one. */
    var rest = s;

    var m = rest.match(/\b(\d{2,4})\s*(?:A\b|A$|-A\b)/i);
    if (m) { out.ir = parseInt(m[1], 10); rest = rest.replace(m[0], ' '); }

    var k = rest.match(/\b(\d{1,3})\s*(?:kA|KA)\b/);
    if (k) { out.icu = parseInt(k[1], 10); rest = rest.replace(k[0], ' '); }

    var p = rest.match(/(\d)\s*(?:P\b|POLE)/i);
    if (p) { out.poles = parseInt(p[1], 10); rest = rest.replace(p[0], ' '); }

    var t = rest.match(/\b(TM|TD|LI|LS|LSI|ESD|T\+)\b/i);
    if (t) out.trip = t[1].toUpperCase();

    /* A catalogue number written without its unit — "Compact NS 250", "NSX
       160" — is still a rating, and it is the only number left. Only accepted
       when there is a single one, because two bare numbers is ambiguous and
       guessing which is the rating is how a 1600 A device ends up on a 160 A
       feeder. */
    if (out.ir === undefined) {
      var bare = rest.match(/\b(\d{2,4})\b(?!\s*(?:kA|kV|V|A\b))/g);
      if (bare && bare.length === 1) out.ir = parseInt(bare[0], 10);
    }

    if (/\bMCB\b/i.test(s) || /\b[BCD]\s*-?\d{2,3}\b/i.test(s)) out.kind = 'mcb';
    else if (/\bMCCB\b/i.test(s) || out.trip) out.kind = 'mccb';
    /* No MCB in this app's library goes above 125 A, so a small device with no
       other marker is an MCB and a large one is an MCCB. */
    else if (out.ir !== undefined) out.kind = out.ir <= 160 ? 'mcb' : 'mccb';

    if (out.ir === undefined && !out.kind && !out.trip) return { raw: s, unparsed: true };
    return out;
  }
  CSVC.device = device;

  /* Starting method, from "DOL", "direct on line", "VFD", "variable speed
     drive", "soft starter", "star delta". Anything not recognised is left null
     rather than assumed DOL: a wrong starting method changes the cable and the
     protection, and it is far better to ask. */
  function start(v) {
    if (!v) return null;
    var s = String(v).toLowerCase().trim();
    if (/^(dol|direct[\s-]*on[\s-]*line|direct)\b/.test(s)) return 'DOL';
    if (/vfd|variable\s*speed|inverter|vvvf/.test(s)) return 'VFD';
    if (/soft[\s-]*start|\bss\b|softstarter/.test(s)) return 'Soft starter';
    if (/star[\s-]*delta|stardelta|\/\s*delta/.test(s)) return 'Star-delta';
    if (/auto[\s-]*transformer|\bat\b|autotransformer/.test(s)) return 'Autotransformer';
    return null;
  }
  CSVC.start = start;

  /* Load torque characteristic. Matters because a reduced-current start cannot
     accelerate a constant-torque load, and knowing which of the four this is
     decides that before anyone orders the starter. Anything unrecognised is left
     blank so nothing is asserted. */
  function loadTorque(v) {
    if (!v) return null;
    var s = String(v).toLowerCase().trim();
    if (/constant\s*power|constantpower|fixed\s*power/.test(s)) return 'constantpower';
    if (/inertia|flywheel|high\s*inertia|large\s*inertia/.test(s)) return 'inertia';
    if (/variable|quadratic|fan|pump|blower|centrifugal/.test(s)) return 'variable';
    if (/constant\s*torque|constanttorque|conveyor|hoist|hoist|constant/.test(s)) return 'constant';
    return null;
  }
  CSVC.loadTorque = loadTorque;

  /* Whether a three-phase circuit carries its neutral back to the board. From
     "3P+N", "3PN", "4 core", "with neutral". A three-pole feeder must read as no:
     it cannot return zero-sequence current, and treating it as if it could is
     what puts a phantom load on a neutral. */
  function neutral(v) {
    if (!v) return null;
    var s = String(v).toLowerCase().trim();
    if (/^(no|none|n\b|none|3p\b|three\s*pole|3\s*pole|3ph?\s*only)\b/.test(s)) return false;
    if (/3p\s*\+\s*n|3pn|3\s*ph\s*\+\s*n|with\s*neutral|neutral\s*carried|4\s*core|four\s*core|yes|^y\b/.test(s)) return true;
    return null;
  }
  CSVC.neutral = neutral;

  /* Cable installation method from "XL-A1", "A1", "C", "clip". Not everything
     maps; an unknown method is left alone so the app's own default applies
     rather than the importer choosing a wrong one. */
  var METHOD_WORDS = {
    'a1': 'A1', 'a2': 'A2', 'b1': 'B1', 'b2': 'B2', 'c': 'C', 'd': 'D', 'e': 'E', 'f': 'F',
    'xla1': 'XL-A1', 'xla2': 'XL-A2', 'xlb1': 'XL-B1', 'xlb2': 'XL-B2', 'xlc': 'XL-C',
    'clip': 'A1', 'clipped': 'A1', 'conduit': 'B1', 'duct': 'B1', 'tray': 'C',
    'ladder': 'C', 'cleat': 'C', 'buried': 'D2', 'direct': 'D2', 'soil': 'D2',
    'pvc': 'C', 'steel': 'E', 'galvanised': 'E', 'galvanized': 'E', 'trunking': 'A1'
  };
  function method(v) {
    if (!v) return null;
    var k = String(v).toLowerCase().replace(/[^a-z0-9]/g, '');
    return METHOD_WORDS[k] || null;
  }
  CSVC.method = method;

  /* --------------------------------------------------- the app's own file -- */

  /* The export is not one table; it is four, each introduced by a row holding
     only its own name. Recovering the sections means those rows are the only
     structure available, so they are used. Returns the load schedule, which
     is the only one that is a flat per-circuit table. */
  function looksLikeAppExport(text) {
    var head = text.slice(0, 4000);
    return /(^|\n)\s*"?LOAD SCHEDULE"?\s*(,|\r?\n)/i.test(head) ||
           /(^|\n)\s*"?Reference"?\s*,\s*"?Board"?\s*,\s*"?Board description"?/i.test(head);
  }

  /* Find the header row of a section: the first row after the section name
     that has more than one populated cell. Subtotal and total rows are written
     with the label in the first column and blanks elsewhere, so a row that
     carries data in a later column is a header or a record, never a total. */
  function headerAfter(rows, from, limit) {
    for (var i = from; i < Math.min(rows.length, from + (limit || 12)); i++) {
      var r = rows[i];
      if (!r || r.length < 2) continue;
      var filled = r.filter(function (c) { return c !== ''; }).length;
      if (filled >= 2) return i;
    }
    return -1;
  }

  /* The rows that are subtotals, section labels or blank. A subtotal carries
     its label in the first column and a total in the second, which is why it
     has to be excluded before anything is read as a circuit. */
  function isSummaryRow(r, mapped) {
    var first = String(r[0] || '').toUpperCase();
    if (!first) return true;
    if (/SUBTOTAL|DIRECT SUBTOTAL|^UNASSIGNED|^BOARD SCHEDULE|^LOAD SCHEDULE|^CABLE|^DESIGN|^WARNINGS/.test(first)) return true;
    /* a row whose reference column has no data anywhere else is a label */
    var filled = r.filter(function (c) { return c !== ''; }).length;
    if (filled < 2) return true;
    /* the app writes a subtotal with a kW total in the kW column; a real
       circuit has a description too */
    var kwIdx = (mapped || []).reduce(function (a, m, i) { return m.field === 'kw' ? i : a; }, -1);
    var descIdx = (mapped || []).reduce(function (a, m, i) { return m.field === 'description' ? i : a; }, -1);
    if (kwIdx >= 0 && descIdx >= 0 && r[kwIdx] && !r[descIdx]) return true;
    return false;
  }
  /* The rows belonging to one section, up to the next one.

     The app's export is four tables in one file and each is introduced by a row
     holding only its own name. Classifying rows individually is not enough: the
     *header* row of the next section looks exactly like a header row of this
     one. So the section boundary is found instead — a row whose first cell is
     a section name — and everything from there on belongs to that section, not
     to this one. */
  var SECTION_NAMES = /^(LOAD SCHEDULE|BOARD SCHEDULE|CABLE \/ VOLT DROP SCHEDULE|DESIGN WARNINGS|WARNINGS|CABLES? SCHEDULE|SUMMARY)\b/i;
  function isSectionLabel(r) {
    if (!r) return false;
    var first = String(r[0] || '').trim();
    if (!first) return false;
    var filled = r.filter(function (c) { return String(c).trim() !== ''; }).length;
    return filled <= 1 && SECTION_NAMES.test(first);
  }
  function sectionRows(rows, from) {
    var out = [];
    for (var i = from; i < rows.length; i++) {
      if (isSectionLabel(rows[i])) break;
      out.push(rows[i]);
    }
    return out;
  }

  CSVC.looksLikeAppExport = looksLikeAppExport;
  CSVC.headerAfter = headerAfter;
  CSVC.isSummaryRow = isSummaryRow;
  CSVC.isSectionLabel = isSectionLabel;
  CSVC.sectionRows = sectionRows;

  if (typeof module !== 'undefined' && module.exports) module.exports = CSVC;
  window.CSVC = CSVC;
})();