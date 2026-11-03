/* PDF export: draw the loaded sheet onto the user's own copy of the
 * official Renegade character sheet PDF, kept as its 4 pages (no merging).
 *
 * The file's pages are cropped halves of 1642x670 pt wide canvases, so
 * every field position below is measured in the VISIBLE page space
 * (top-left origin, points, as a viewer shows the page) and converted at
 * draw time with the picked file's own crop boxes, read from the document
 * itself — never hardcoded. That keeps the export working on any copy of
 * the sheet with the same layout, even if its crop windows differ.
 *
 * The Renegade PDF is never bundled: the user picks their own copy with a
 * file picker, the filled copy downloads, and the original is untouched.
 * Page order in the file: 1 identity/stats/combat, 2 hotlist/gear/story,
 * 3 skills, 4 inventory.
 */
(function () {
  'use strict';

  /* ---- text helpers (font = an embedded pdf-lib font) ---- */
  function textWidth(font, text, size) {
    try { return font.widthOfTextAtSize(text, size); } catch (e) { return text.length * size * 0.55; }
  }
  function fit(font, text, size, maxW) {
    text = String(text == null ? '' : text);
    if (!maxW || textWidth(font, text, size) <= maxW) return text;
    var t = text;
    while (t.length > 1 && textWidth(font, t + '…', size) > maxW) t = t.slice(0, -1);
    return t + '…';
  }
  function wrap(font, text, size, maxW, maxLines) {
    var words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
    var lines = [], cur = '';
    words.forEach(function (w) {
      var next = cur ? cur + ' ' + w : w;
      if (textWidth(font, next, size) <= maxW) cur = next;
      else { if (cur) lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = fit(font, lines[maxLines - 1], size, maxW);
    }
    return lines;
  }

  /* ---- field positions: visible-page coords, baseline y from top ---- */
  /* Page 1: identity, stats, combat. */
  var P1 = {
    /* Header values start just past their printed label and sit on the
     * line below it (labels sit above the line, so starting at the line's
     * left edge would print over the label). */
    header: {
      name: { x: 198, y: 38, size: 13, w: 197 }, race: { x: 424, y: 38, size: 13, w: 171 },
      level: { x: 196, y: 70, size: 13, w: 54 }, number: { x: 323, y: 70, size: 13, w: 72 },
      className: { x: 426, y: 70, size: 13, w: 169 }, floor: { x: 623, y: 70, size: 13, w: 152 }
    },
    /* stat rows: Enhanced/Unenhanced values sit on the underline above
     * their labels (centred on it); MOD sits in the bottom strip. */
    stats: [
      { enhY: 142, modY: 190 }, { enhY: 241, modY: 288 }, { enhY: 339, modY: 387 },
      { enhY: 438, modY: 485 }, { enhY: 536, modY: 584 }
    ],
    statEnhCX: 50.3, statUnenhCX: 125.2, statModCX: 90.8, statSize: 14,
    hpSegs: [
      [178.3, 33.7], [225.3, 33.6], [266.4, 33.6], [312.7, 33.6], [359.1, 33.6],
      [400.2, 33.6], [446.5, 33.6], [493.2, 33.6], [539.5, 33.6], [585.8, 33.6]
    ],
    hpY0: 90.1, hpY1: 112.0,
    evadeY: 157, drY: 209, boxSize: 12,
    evade: { dexMod: 278.1, buffs: 361.8, total: 460.6, move: 533.1, step: 596.5 },
    dr: { armor: 278.1, buffs: 361.8, total: 461.6, aiFavor: 533.8 },
    /* The mana box has a printed "/" in the middle: max goes left of it,
     * current right of it. */
    mana: { maxCX: 195, curCX: 237, y: 279, size: 12 },
    debuffs: { x: 302, y: 283, size: 11, w: 260 },
    extBuffs: [{ x: 584, y: 266 }, { x: 584, y: 291 }, { x: 584, y: 317 }],
    extBuffsSize: 11, extBuffsW: 190,
    portrait: { x0: 631.7, y0: 82.3, x1: 774.7, y1: 218.4 },
    attackRows: [385, 431, 478, 524, 570],
    attackCols: { name: { x: 176, w: 156 }, toHit: { x: 344, w: 62 }, damage: { x: 416, w: 80 }, effects: { x: 508, w: 264 } }
  };
  /* Page 2: hotlist, gear, story. */
  var P2 = {
    hotlistCX: [90.2, 244.5, 398.8, 553.2, 707.5], hotlistRows: [84, 158], hotlistSize: 11, hotlistW: 130,
    gearSinglesY: [227, 251, 274, 298, 345, 369], gearX: 110, gearSize: 11, gearW: 420,
    accX: 28, accY0: 408, accStep: 19, accMax: 10,
    popularity: { cx: 658.1, y: 222, size: 14 },
    notes: { x: 548, y0: 492, step: 16, size: 10, w: 224, maxLines: 6 }
  };
  /* Page 3: skills (20 rows). */
  var P3 = {
    rowY0: 83.3, rowStep: 26, rows: 20,
    cols: { name: { x: 32, w: 232 }, rankCX: 285.5, statMod: { x: 305, w: 50 }, check: { x: 363, w: 90 }, notes: { x: 461, w: 288 }, usedCX: 768.5 }
  };
  /* Page 4: inventory (20 rows). */
  var P4 = {
    rowY0: 85.3, rowStep: 26.1, rows: 20,
    cols: { item: { x: 27, w: 228 }, qtyCX: 285.7, notes: { x: 316, w: 460 } }
  };

  /* Final page layout: base pages 0 (stats) and 1 (hotlist/gear), then
   * one skills page per 20 cards (base + extras), then one inventory page
   * per 20 items (base + extras). Extra pages are copies of their base
   * page, inserted right after it, so overflow rows always have a page. */
  function pagePlan(data) {
    var skillsPages = Math.max(1, Math.ceil((data.skills.length + data.spells.length) / P3.rows));
    var invPages = Math.max(1, Math.ceil(data.inventory.length / P4.rows));
    return { skillsPages: skillsPages, invPages: invPages, invBase: 2 + skillsPages };
  }
  function buildCommands(data, fonts, crops) {
    var cmds = [], overflow = { attacks: [] };
    var plan = pagePlan(data);
    var txt = function (page, fx, fy, size, font, text, opts) {
      if (text === '' || text == null) return;
      var c = crops[page];
      var x = c.x + fx, y = c.y + c.height - fy;
      if (opts && opts.center) x = c.x + fx - textWidth(font, text, size) / 2;
      cmds.push({ page: page, kind: 'text', x: x, y: y, size: size, font: font, text: text });
    };
    var rect = function (page, fx0, fy0, fx1, fy1) {
      var c = crops[page];
      cmds.push({ page: page, kind: 'rect', x: c.x + fx0, y: c.y + c.height - fy1,
        w: fx1 - fx0, h: fy1 - fy0, opacity: 0.8 });
    };
    var H = fonts.regular, HB = fonts.bold;

    /* ---- page 1 ---- */
    var h = P1.header;
    txt(0, h.name.x, h.name.y, h.name.size, HB, fit(HB, data.name, h.name.size, h.name.w));
    txt(0, h.race.x, h.race.y, h.race.size, HB, fit(HB, data.race, h.race.size, h.race.w));
    txt(0, h.level.x, h.level.y, h.level.size, HB, String(data.level));
    txt(0, h.number.x, h.number.y, h.number.size, HB, fit(HB, data.number, h.number.size, h.number.w));
    txt(0, h.className.x, h.className.y, h.className.size, HB, fit(HB, data.className, h.className.size, h.className.w));
    txt(0, h.floor.x, h.floor.y, h.floor.size, HB, String(data.floor));
    data.stats.forEach(function (s, i) {
      var row = P1.stats[i];
      txt(0, P1.statEnhCX, row.enhY, P1.statSize, H, String(s.enh), { center: true });
      txt(0, P1.statUnenhCX, row.enhY, P1.statSize, H, String(s.unenh), { center: true });
      txt(0, P1.statModCX, row.modY, P1.statSize, H, String(s.mod), { center: true });
    });
    for (var s = 0; s < Math.max(0, Math.min(10, data.hpCurrent)); s++) {
      var seg = P1.hpSegs[s];
      rect(0, seg[0], P1.hpY0, seg[0] + seg[1], P1.hpY1);
    }
    var ev = data.evade, e = P1.evade;
    txt(0, e.dexMod, P1.evadeY, P1.boxSize, H, String(ev.dexMod), { center: true });
    var buffText = String(ev.buffs) + (ev.dice ? ' + ' + ev.dice + 'd4' : '');
    txt(0, e.buffs, P1.evadeY, P1.boxSize, H, fit(H, buffText, P1.boxSize, 100), { center: true });
    txt(0, e.total, P1.evadeY, P1.boxSize, H, String(ev.total), { center: true });
    txt(0, e.move, P1.evadeY, P1.boxSize, H, String(data.move), { center: true });
    txt(0, e.step, P1.evadeY, P1.boxSize, H, String(data.step), { center: true });
    var dr = data.dr, d = P1.dr;
    txt(0, d.armor, P1.drY, P1.boxSize, H, String(dr.armor), { center: true });
    txt(0, d.buffs, P1.drY, P1.boxSize, H, String(dr.buffs), { center: true });
    txt(0, d.total, P1.drY, P1.boxSize, H, String(dr.total), { center: true });
    txt(0, d.aiFavor, P1.drY, P1.boxSize, H, String(data.aiFavor), { center: true });
    txt(0, P1.mana.maxCX, P1.mana.y, P1.mana.size, H, String(data.mana.max), { center: true });
    txt(0, P1.mana.curCX, P1.mana.y, P1.mana.size, H, String(data.mana.current), { center: true });
    if (data.debuffs.length) txt(0, P1.debuffs.x, P1.debuffs.y, P1.debuffs.size, H, fit(H, data.debuffs.join(', '), P1.debuffs.size, P1.debuffs.w));
    data.buffs.slice(0, 3).forEach(function (b, i) {
      var p = P1.extBuffs[i];
      txt(0, p.x, p.y, P1.extBuffsSize, H, fit(H, b, P1.extBuffsSize, P1.extBuffsW));
    });
    data.attacks.slice(0, 5).forEach(function (a, i) {
      var y = P1.attackRows[i], c = P1.attackCols;
      txt(0, c.name.x, y, 10, H, fit(H, a.name, 10, c.name.w));
      txt(0, c.toHit.x, y, 9, H, fit(H, a.toHit, 9, c.toHit.w));
      txt(0, c.damage.x, y, 9, H, fit(H, a.damage, 9, c.damage.w));
      txt(0, c.effects.x, y, 9, H, fit(H, a.effects, 9, c.effects.w));
    });
    overflow.attacks = data.attacks.slice(5).map(function (a) { return a.name; });
    if (data.avatar) {
      var p = P1.portrait;
      cmds.push({ page: 0, kind: 'image', x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, src: data.avatar });
    }

    /* ---- page 2 ---- */
    data.hotlist.slice(0, 10).forEach(function (name, i) {
      var col = i % 5, row = Math.floor(i / 5);
      txt(1, P2.hotlistCX[col], P2.hotlistRows[row], P2.hotlistSize, H, fit(H, name, P2.hotlistSize, P2.hotlistW), { center: true });
    });
    [data.gear.head, data.gear.torso, data.gear.arms, data.gear.hands, data.gear.legs, data.gear.feet].forEach(function (v, i) {
      txt(1, P2.gearX, P2.gearSinglesY[i], P2.gearSize, H, fit(H, v, P2.gearSize, P2.gearW));
    });
    data.gear.accessories.slice(0, P2.accMax).forEach(function (v, i) {
      txt(1, P2.accX, P2.accY0 + i * P2.accStep, P2.gearSize, H, fit(H, v, P2.gearSize, 500));
    });
    txt(1, P2.popularity.cx, P2.popularity.y, P2.popularity.size, H, String(data.popularity), { center: true });
    wrap(H, data.notes, P2.notes.size, P2.notes.w, P2.notes.maxLines).forEach(function (line, i) {
      txt(1, P2.notes.x, P2.notes.y0 + i * P2.notes.step, P2.notes.size, H, line);
    });

    /* ---- skills pages: skills, then spells, in the same table ---- */
    var cards = data.skills.concat(data.spells);
    cards.forEach(function (c, i) {
      var page = 2 + Math.floor(i / P3.rows), row = i % P3.rows;
      var y = P3.rowY0 + row * P3.rowStep, col = P3.cols;
      txt(page, col.name.x, y, 10, H, fit(H, c.name, 10, col.name.w));
      txt(page, col.rankCX, y, 10, H, String(c.rank), { center: true });
      txt(page, col.statMod.x, y, 10, H, fit(H, c.statMod, 10, col.statMod.w));
      txt(page, col.check.x, y, 10, H, fit(H, c.check, 10, col.check.w));
      txt(page, col.notes.x, y, 9, H, fit(H, c.notes, 9, col.notes.w));
      if (c.used) cmds.push({ page: page, kind: 'check', cx: col.usedCX, fy: y });
    });

    /* ---- inventory pages ---- */
    data.inventory.forEach(function (it, i) {
      var page = plan.invBase + Math.floor(i / P4.rows), row = i % P4.rows;
      var y = P4.rowY0 + row * P4.rowStep, col = P4.cols;
      txt(page, col.item.x, y, 10, H, fit(H, it.name, 10, col.item.w));
      txt(page, col.qtyCX, y, 10, H, String(it.qty), { center: true });
      txt(page, col.notes.x, y, 9, H, fit(H, it.notes, 9, col.notes.w));
    });

    return { commands: cmds, overflow: overflow };
  }

  function applyCommands(doc, cmds, fonts) {
    var pages = [];
    var jobs = cmds.map(function (cmd) {
      var page = pages[cmd.page] || (pages[cmd.page] = doc.getPage(cmd.page));
      if (cmd.kind === 'text') {
        page.drawText(cmd.text, { x: cmd.x, y: cmd.y, size: cmd.size, font: cmd.font });
        return Promise.resolve();
      }
      if (cmd.kind === 'rect') {
        page.drawRectangle({ x: cmd.x, y: cmd.y, width: cmd.w, height: cmd.h, color: doc.__rgbBlack, opacity: cmd.opacity });
        return Promise.resolve();
      }
      if (cmd.kind === 'check') {
        /* U+2713 in ZapfDingbats is a check mark; the ✔ column has no
         * Helvetica glyph for it. */
        var c = doc.__crops[cmd.page];
        page.drawText('✓', { x: c.x + cmd.cx - 6, y: c.y + c.height - cmd.fy - 2, size: 14, font: fonts.dingbats });
        return Promise.resolve();
      }
      if (cmd.kind === 'image') {
        var c = doc.__crops[cmd.page];
        var x = c.x + cmd.x0, y = c.y + c.height - cmd.y1, w = cmd.x1 - cmd.x0, h = cmd.y1 - cmd.y0;
        var embed = cmd.src.indexOf('data:image/png') === 0 ? doc.embedPng(cmd.src)
          : cmd.src.indexOf('data:image/jpeg') === 0 ? doc.embedJpg(cmd.src) : Promise.resolve(null);
        return embed.then(function (img) {
          if (!img) return;
          var scale = Math.min(w / img.width, h / img.height);
          var dw = img.width * scale, dh = img.height * scale;
          page.drawImage(img, { x: x + (w - dw) / 2, y: y + (h - dh) / 2, width: dw, height: dh });
        });
      }
      return Promise.resolve();
    });
    return Promise.all(jobs);
  }

  var api = { buildCommands: buildCommands, applyCommands: applyCommands, pagePlan: pagePlan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DCCPdfExport = api;

  /* ---- browser wiring ---- */
  if (typeof document === 'undefined') return;
  function toast(msg) {
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#141414;color:#f2f2ec;padding:10px 16px;border:1px solid #a855f7;border-radius:8px;z-index:9999;';
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4000);
  }
  function onPdfPicked(file) {
    if (!window.PDFLib) { alert('The PDF tool did not load. Check your connection and try again.'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var PDFLib = window.PDFLib;
      PDFLib.PDFDocument.load(reader.result).then(function (doc) {
        if (doc.getPageCount() < 4) { alert('That PDF has fewer than 4 pages — pick the 4-page character sheet.'); return; }
        return Promise.all([
          doc.embedFont(PDFLib.StandardFonts.Helvetica),
          doc.embedFont(PDFLib.StandardFonts.HelveticaBold),
          doc.embedFont(PDFLib.StandardFonts.ZapfDingbats)
        ]).then(function (embedded) {
          var fonts = { regular: embedded[0], bold: embedded[1], dingbats: embedded[2] };
          var data = window.DCC.getExportData();
          var plan = pagePlan(data);
          /* Extra pages: copies of the skills page (index 2) inserted
           * right after it, then copies of the inventory page (which
           * shifts to index plan.invBase) inserted right after it. */
          var chain = Promise.resolve();
          var s;
          for (s = 1; s < plan.skillsPages; s++) {
            (function (at) {
              chain = chain.then(function () {
                return doc.copyPages(doc, [2]).then(function (copied) { doc.insertPage(at, copied[0]); });
              });
            })(2 + s);
          }
          var invAt = plan.invBase;
          for (s = 1; s < plan.invPages; s++) {
            (function (at) {
              chain = chain.then(function () {
                return doc.copyPages(doc, [invAt]).then(function (copied) { doc.insertPage(at, copied[0]); });
              });
            })(invAt + s);
          }
          return chain.then(function () {
            var crops = [];
            for (var i = 0; i < doc.getPageCount(); i++) crops.push(doc.getPage(i).getCropBox());
            doc.__crops = crops;
            doc.__rgbBlack = PDFLib.rgb(0, 0, 0);
            var built = buildCommands(data, fonts, crops);
            return applyCommands(doc, built.commands, fonts).then(function () { return { doc: doc, overflow: built.overflow }; });
          });
        });
      }).then(function (res) {
        if (!res) return;
        return res.doc.save().then(function (bytes) {
          var name = (window.DCC.getState().name || 'crawler').replace(/[^a-z0-9-_]+/gi, '-');
          var blob = new Blob([bytes], { type: 'application/pdf' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = name + '-character-sheet.pdf';
          a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
          toast('Exported ' + a.download);
          /* Skills/spells and items now get extra pages, so only attacks
           * can still overflow (page 1 is the whole stats sheet and has
           * no extra-page form). */
          if (res.overflow.attacks.length) alert('Exported, but ' + res.overflow.attacks.length + ' attack(s) did not fit on the Attacks table: ' + res.overflow.attacks.join(', '));
        });
      }).catch(function (e) {
        alert('Could not fill that PDF: ' + (e && e.message ? e.message : e));
      });
    };
    reader.readAsArrayBuffer(file);
  }
  var btn = document.getElementById('btn-export-pdf');
  var input = document.getElementById('pdf-file');
  if (btn && input) {
    btn.addEventListener('click', function () {
      if (!window.PDFLib) { alert('The PDF tool did not load. Check your connection and try again.'); return; }
      input.value = '';
      input.click();
    });
    input.addEventListener('change', function () {
      if (input.files && input.files[0]) onPdfPicked(input.files[0]);
    });
  }
})();
