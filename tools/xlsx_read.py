"""Minimal, correct xlsx reader — no third-party modules.

The regex approach that walks <c ...> tags has to be careful about self-closing
cells: a pattern like <c r="E9"[^>]*(?:/>|>(.*?)</c>) will let the greedy [^>]*
eat the '/' and then match '>' instead of '/>', swallowing the next cell.
Fix: exclude '/' from the attribute run, or better, find each tag's end properly.
"""
import re, zipfile


def colidx(c):
    n = 0
    for ch in c:
        n = n * 26 + ord(ch) - 64
    return n


def letter(i):
    s = ''
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def unesc(t):
    for a, b in [('&lt;', '<'), ('&gt;', '>'), ('&quot;', '"'),
                 ('&apos;', "'"), ('&***REMOVED***10;', ' '), ('&amp;', '&')]:
        t = t.replace(a, b)
    return t


def read(path, sheet='xl/worksheets/sheet1.xml'):
    z = zipfile.ZipFile(path)
    ss = []
    if 'xl/sharedStrings.xml' in z.namelist():
        xml = z.read('xl/sharedStrings.xml').decode('utf8', 'replace')
        for si in re.findall(r'<si>(.*?)</si>', xml, re.S):
            ss.append(unesc(''.join(re.findall(r'<t[^>]*>(.*?)</t>', si, re.S))))

    sh = z.read(sheet).decode('utf8', 'replace')

    ***REMOVED*** a cell is either <c .../> or <c ...>...</c>; find the tag head without
    ***REMOVED*** letting [^>]* swallow a trailing slash
    cell = re.compile(r'<c\s+r="([A-Z]+)(\d+)"((?:[^>"]|"[^"]*")*?)(/>|>)', re.S)
    grid, cur_r, pos = {}, None, 0
    for m in cell.finditer(sh):
        col, rown, attrs, close = m.group(1), int(m.group(2)), m.group(3), m.group(4)
        if close == '/>':
            grid[(rown, colidx(col))] = ''
            continue
        ***REMOVED*** body runs to the matching </c>
        end = sh.find('</c>', m.end())
        body = sh[m.end():end]
        v = re.search(r'<v>(.*?)</v>', body, re.S)
        isn = re.search(r'<is>(.*?)</is>', body, re.S)
        val = ''
        if isn:
            val = unesc(''.join(re.findall(r'<t[^>]*>(.*?)</t>', isn.group(1), re.S)))
        elif v:
            val = unesc(v.group(1))
            if 't="s"' in attrs:
                val = ss[int(val)]
        grid[(rown, colidx(col))] = val

    ***REMOVED*** sheet-level dimension / workbook sheet names
    names = []
    try:
        wb = z.read('xl/workbook.xml').decode('utf8', 'replace')
        names = re.findall(r'<sheet[^>]*name="([^"]+)"', wb)
    except KeyError:
        pass
    return grid, names