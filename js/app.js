/* app.js — state, rendering, save/load, tabs, cards, pickers.
 * Depends on rules.js (window.DCCRules). Data JSON files are lazy-loaded:
 * each file is fetched only the first time something needs it (a picker,
 * a race/class application, a spell render). Rendering only rebuilds the
 * active tab panel, plus the sidebar and counters. Text inputs commit on
 * 'change' (Enter/Tab/blur), not on every keystroke, and saves are
 * debounced — the old sheet's per-keystroke full rebuild is deliberately
 * not repeated here.
 *
 * Rank model (see rules.js): displayed Rank = ownRank + gearGiven +
 * raceGiven + groupGiven + backgroundGiven. ownRank is what the player
 * trained; given
 * amounts are recomputed from live records on every render, so removing
 * a source can never double-count or leave a stale bonus behind.
 */
(function () {
  'use strict';
  var R = window.DCCRules;
  var SAVE_KEY = 'dcc-sheet-v2';
  var uidCounter = 1;

  function uid() { return 'id' + (Date.now().toString(36)) + (uidCounter++); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function $(id) { return document.getElementById(id); }
  function setVal(id, val) {
    var el = $(id);
    if (el && document.activeElement !== el) el.value = val;
  }
  function num(v, fb) { var n = parseInt(v, 10); return isNaN(n) ? fb : n; }

  /* ---------------- state ---------------- */
  function blankState() {
    return {
      name: '', number: '', race: '', class: '', level: 1, floor: 1, avatarUrl: '',
      ownBase: { str: 1, con: 1, dex: 1, int: 1, cha: 1 },
      ownEnh: { str: 0, con: 0, dex: 0, int: 0, cha: 0 },
      ownArmor: 0, evadeBuffs: 0, drBuffs: 0,
      hpCurrent: 10, manaCurrent: 1, prevMaxMana: 1,
      statPointsSpent: 0, gold: 0, popularity: 0, aiFavor: 0,
      moveVal: 20, stepVal: 10, bossKills: 0, pkKills: 0,
      buffs: [], debuffs: [], hotlist: [],
      skills: [], spells: [], attacks: [], items: [], pendingDamage: null,
      story: { quests: [], journal: [], pets: [], mounts: [], sponsors: [], faith: { deity: '', tier: 'none', looted: 0, streak: 0, missed: 0, offerings: [], tithes: [] }, crafting: [], bio: { appearance: '', personality: '', backstory: '', notes: '' } },
      raceClassApplied: [], raceClassChoices: {}, raceClassMoveApplied: null, backgrounds: null, cardOpen: {},
      loadouts: [{ id: 'loadout-1', name: 'Loadout 1', placements: {} }, { id: 'loadout-2', name: 'Loadout 2', placements: {} }],
      activeLoadoutId: null,
      activeTab: 'vitals'
    };
  }
  var state = blankState();
  var hasSaved = false;

  function refreshWizard() {
    try {
      var w = document.getElementById('wizard');
      if (w && !w.hidden && window.Wizard && window.Wizard.render) window.Wizard.render();
    } catch (e) { /* wizard not open: nothing to refresh */ }
  }
  /* ---------------- lazy data ---------------- */
  var cache = { skills: null, items: null, races: null, keywords: null, bookChecks: null, _p: {} };
  function loadJSON(path) {
    return fetch(path + '?v=10').then(function (r) {
      if (!r.ok) throw new Error('Failed to load ' + path);
      return r.json();
    });
  }
  function ensureSkills() {
    if (!cache._p.skills) cache._p.skills = loadJSON('data/skills_spells.json').then(function (list) { cache.skills = list; buildLibIndex(list); return list; });
    return cache._p.skills;
  }
  function ensureItems() {
    if (!cache._p.items) cache._p.items = loadJSON('data/items.json').then(function (list) { cache.items = list; return list; });
    return cache._p.items;
  }
  function ensureRaces() {
    if (!cache._p.races) cache._p.races = loadJSON('data/races_classes.json').then(function (list) { cache.races = list; return list; });
    return cache._p.races;
  }
  function ensureBookChecks() {
    if (!cache._p.bookChecks) cache._p.bookChecks = loadJSON('data/book_checks.json').then(function (list) {
      var map = {};
      (list || []).forEach(function (e) { map[R.normName(e.name)] = e; });
      cache.bookChecks = map; return map;
    }).catch(function () { cache.bookChecks = {}; return {}; });
    return cache._p.bookChecks;
  }
  function bookCheckFor(name) {
    if (!cache.bookChecks) return null;
    return cache.bookChecks[R.normName(name)] || null;
  }
  function ensureKeywords() {
    if (!cache._p.keywords) cache._p.keywords = loadJSON('data/spell_keywords.json').then(function (d) { cache.keywords = R.normalizeKeywordMap(d.keywords || {}); return cache.keywords; });
    return cache._p.keywords;
  }
  var libByName = null;
  function findLib(name) {
    if (!cache.skills || !libByName) return null;
    return libByName[R.normName(name)] || null;
  }
  function buildLibIndex(list) {
    libByName = {};
    list.forEach(function (e) { libByName[R.normName(e.name)] = e; });
  }
  function findRaceClass(name, kind) {
    if (!cache.races) return null;
    var n = R.normName(name);
    for (var i = 0; i < cache.races.length; i++) {
      if (cache.races[i].kind === kind && R.normName(cache.races[i].name) === n) return cache.races[i];
    }
    return null;
  }
  function raceEntry() { return findRaceClass(state.race, 'race'); }
  function classEntry() { return findRaceClass(state.class, 'class'); }

  /* ---------------- derived values ---------------- */
  function fixedStats() {
    var out = { str: 0, con: 0, dex: 0, int: 0, cha: 0 };
    [raceEntry(), classEntry()].forEach(function (e) {
      var s = R.parseRaceClassStats(e);
      R.STAT_KEYS.forEach(function (k) { out[k] += s[k]; });
    });
    return out;
  }
  function splitAssignments() {
    var out = { str: 0, con: 0, dex: 0, int: 0, cha: 0 };
    Object.keys(state.raceClassChoices).forEach(function (cid) {
      var parts = cid.split(':');
      if (parts.length < 3) return;
      var cur = parts[0] === 'race' ? state.race : state.class;
      if (parts[1] !== cur) return;
      var ch = state.raceClassChoices[cid];
      if (ch && ch.split) R.STAT_KEYS.forEach(function (k) { out[k] += num(ch.split[k], 0); });
    });
    return out;
  }
  function raceClassDR() {
    return R.parseRaceClassDR(raceEntry()) + R.parseRaceClassDR(classEntry());
  }
  /* Stat model (Antony, 2026-11-06): Base is the player's own base
   * only — race/class is NOT folded into it. Total = Base + Enhance
   * (own) + Gear + Race/Class (fixed + split, may be negative) with
   * a minimum of 1 per stat and the race/class cap applied. */
  function computeStats() {
    var fixed = fixedStats();
    var splits = splitAssignments();
    var gear = equippedBonuses().stat;
    var derived = R.derivedBase(state.ownBase);
    var out = {};
    R.STAT_KEYS.forEach(function (k) {
      var raceClass = (fixed[k] || 0) + (splits[k] || 0);
      var total = R.statTotal(derived[k], state.ownEnh[k] || 0, gear[k] || 0, raceClass, R.statCapFor(state.race, state.class, k));
      out[k] = { derived: derived[k], fixed: fixed[k], split: splits[k], raceClass: raceClass, penalty: Math.min(0, fixed[k]), gear: gear[k] || 0, ownEnh: state.ownEnh[k] || 0, total: total, mod: R.getModifier(total) };
    });
    return out;
  }
  function equippedBonuses() {
    var stat = { str: 0, con: 0, dex: 0, int: 0, cha: 0 }, dr = 0, evade = 0;
    state.items.forEach(function (it) {
      if (!it.equipped) return;
      (it.bonuses || []).forEach(function (b) {
        if (b.type === 'stat' && stat[b.stat] !== undefined) stat[b.stat] += num(b.amount, 0);
        if (b.type === 'dr') dr += num(b.amount, 0);
        if (b.type === 'evade') evade += num(b.amount, 0);
      });
    });
    return { stat: stat, dr: dr, evade: evade };
  }
  /* Evade Buffs granted by ranked skills/spells (e.g. Dodge): recomputed
   * every render from each card's displayed rank, like the rank model.
   * Rank 0 cards never count. Manual Buffs (state.evadeBuffs) and gear
   * stay separate — this is only what the cards themselves grant. */
  function skillEvadeTotal() {
    var total = 0;
    state.skills.concat(state.spells).forEach(function (c) {
      var r = cardRank(c);
      if (r < 1) return;
      total += R.skillEvadeBuff(findLib(c.name), r, c.effect);
    });
    return total;
  }
  function gearGivenFor(card) {
    var total = 0;
    Object.keys(card.gearGrants || {}).forEach(function (k) { total += num(card.gearGrants[k], 0); });
    return total;
  }
  function raceGivenFor(card) {
    var total = 0, key = R.normName(card.name);
    state.raceClassApplied.forEach(function (a) {
      if (a.kind === card.kind && R.normName(a.skillName) === key) total += num(a.amount, 0);
    });
    return total;
  }
  var keywordCache = {};
  function groupGivenFor(card) {
    var lib = findLib(card.name);
    var kw = keywordCache[R.normName(card.name)] || [];
    return R.groupBonusFor(card, state.race, state.class, lib, kw);
  }
  function backgroundGivenFor(card) {
    return (card.backgroundRank || 0);
  }
  function cardRank(card) {
    return R.displayRank(card, gearGivenFor(card), raceGivenFor(card), groupGivenFor(card), backgroundGivenFor(card));
  }
  function cardFloor(card) {
    return R.combinedFloor(gearGivenFor(card), raceGivenFor(card), groupGivenFor(card), backgroundGivenFor(card));
  }
  /* Rank math for a character row the DM is inspecting (cloud.js): the
   * same displayed rank the player sees, computed from that row's own
   * data instead of the loaded sheet's. The caller must have loaded the
   * library and spell keywords first (ensureSkills/ensureKeywords), so
   * findLib and the keyword cache cover the card. */
  function remoteCardRank(card, d) {
    var gear = 0;
    Object.keys(card.gearGrants || {}).forEach(function (k) { gear += num(card.gearGrants[k], 0); });
    var race = 0, key = R.normName(card.name);
    (d.raceClassApplied || []).forEach(function (a) {
      if (a.kind === card.kind && R.normName(a.skillName) === key) race += num(a.amount, 0);
    });
    var lib = findLib(card.name);
    var kw = keywordCache[R.normName(card.name)] || [];
    var group = R.groupBonusFor(card, d.race, d.class, lib, kw);
    var bg = card.backgroundRank || 0;
    var rank = R.displayRank(card, gear, race, group, bg);
    return { rank: rank, gear: gear, race: race, group: group, bg: bg, eff: R.effectiveRank(rank, card, d.race, d.class) };
  }
  function findCard(name, kind) {
    var list = kind === 'spell' ? state.spells : state.skills;
    var n = R.normName(name);
    for (var i = 0; i < list.length; i++) if (R.normName(list[i].name) === n) return list[i];
    return null;
  }

  /* ---------------- save / load ---------------- */
  var saveTimer = null;
  function saveSoon() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }
  function saveNow() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); hasSaved = true; } catch (e) { /* storage full/blocked: sheet still works in memory */ }
    try { if (window.Cloud && typeof window.Cloud.onLocalSave === 'function') window.Cloud.onLocalSave(); } catch (e) {}
  }
  function loadSaved() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return false;
      state = Object.assign(blankState(), data);
      (state.skills || []).forEach(function (c) { R.splitBackgroundRank(c); });
      (state.spells || []).forEach(function (c) { R.splitBackgroundRank(c); });
      // Ensure every field exists even for older v2 saves.
      var b = blankState();
      Object.keys(b).forEach(function (k) { if (state[k] === undefined) state[k] = b[k]; });
      ensureUnarmed();
      hasSaved = true;
      return true;
    } catch (e) { return false; }
  }
  function exportJSON() {
    saveNow();
    var blob = new Blob([JSON.stringify({ format: 'dcc-sheet-v2', version: 1, character: state }, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (state.name || 'crawler').replace(/[^a-z0-9-_]+/gi, '-') + '-sheet-v2.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    var t = document.createElement('div');
    t.textContent = 'Exported ' + a.download;
    t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#141414;color:#f2f2ec;padding:10px 16px;border:1px solid #a855f7;border-radius:8px;z-index:9999;';
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3000);
  }
  function exportOriginalJSON() {
    saveNow();
    var stats = computeStats();
    var derived = {};
    R.STAT_KEYS.forEach(function (k) { derived[k] = stats[k].derived; });
    function floorFor(card) {
      return { rank: cardRank(card), gear: gearGivenFor(card), race: raceGivenFor(card), group: groupGivenFor(card) };
    }
    var orig = window.Convert.mergedToOriginal(state, derived, floorFor);
    var blob = new Blob([JSON.stringify({ format: 'crawler-sheet', version: 1, exportedAt: new Date().toISOString(), character: orig }, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (state.name || 'crawler').replace(/[^a-z0-9-_]+/gi, '-') + '-crawler.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    var t = document.createElement('div');
    t.textContent = 'Exported ' + a.download + ' (original format)';
    t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#141414;color:#f2f2ec;padding:10px 16px;border:1px solid #a855f7;border-radius:8px;z-index:9999;';
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3000);
  }
  /* Data for the PDF export (js/pdfexport.js): everything the paper sheet
   * has a box for, already in display form. The paper sheet has no boxes
   * for Gold, Boss Kills, Player Kills, Pets, Mounts, Sponsors, Faith or
   * Crafting, so those are left out; Gender/Pronouns and Size have no site
   * field and are left blank by the exporter. */
  function getExportData() {
    var stats = computeStats();
    var fmtMod = function (m) { return (m >= 0 ? '+' : '') + m; };
    var statRows = ['str', 'int', 'con', 'dex', 'cha'].map(function (k) {
      var s = stats[k];
      return { key: k, unenh: s.derived, enh: (s.ownEnh || 0) + (s.gear || 0), mod: fmtMod(s.mod) };
    });
    var gearBon = equippedBonuses();
    var evadeDice = R.evadeDiceCount(raceEntry(), classEntry());
    var evadeBuffs = (state.evadeBuffs || 0) + (gearBon.evade || 0) + skillEvadeTotal();
    var armor = (state.ownArmor || 0) + (gearBon.dr || 0);
    var drBuffs = (state.drBuffs || 0) + raceClassDR();
    var drTotal = R.totalDR(armor, state.drBuffs, raceClassDR());
    var maxMana = R.maxMana(stats.int.total);
    // Attacks: the same rows the Attacks tab shows — manual attacks first,
    // then ranked attack skills/spells not already listed manually.
    var manualNames = {};
    state.attacks.forEach(function (a) { manualNames[R.normName(a.name)] = true; });
    var attacks = state.attacks.map(function (a) {
      var override = R.attackDamageStat(a.name, state.race, state.class);
      var thStat = a.toHitStat || 'str';
      var mod = stats[thStat] ? stats[thStat].mod : 0;
      return { name: a.name, toHit: thStat.toUpperCase() + ' ' + fmtMod(mod), damage: a.damage || '', effects: (override ? 'Damage uses ' + override.toUpperCase() + ' Mod. ' : '') + (a.notes || '') };
    });
    state.skills.concat(state.spells).forEach(function (c) {
      if (cardRank(c) < 1 || !isAttackCard(c) || manualNames[R.normName(c.name)]) return;
      var lib = findLib(c.name);
      var cStat = c.stat || 'str';
      var mod = stats[cStat] ? stats[cStat].mod : 0;
      var override = R.attackDamageStat(c.name, state.race, state.class);
      var adj = lib ? R.adjustedDamage(lib.base_damage, lib.upgrades, cardRank(c)) : { damage: '—', additions: [] };
      var adjNote = adj.additions.length ? ' (includes ' + adj.additions.map(function (a) { return '+' + a.count + 'd' + a.sides + ' at Rank ' + a.tier; }).join(', ') + ')' : '';
      attacks.push({ name: c.name,
        toHit: cardRank(c) + ' ' + cStat.toUpperCase() + ' ' + fmtMod(mod),
        damage: adj.damage,
        effects: (override ? 'Damage uses ' + override.toUpperCase() + ' Mod. ' : '') + adjNote + ((lib && lib.mana_cost) ? ' Mana: ' + lib.mana_cost : '') });
    });
    var cardRow = function (c) {
      var lib = findLib(c.name);
      var cStat = c.stat || 'str';
      var mod = stats[cStat] ? stats[cStat].mod : 0;
      return { name: c.name, rank: cardRank(c),
        statMod: cStat.toUpperCase() + ' ' + fmtMod(mod),
        check: c.checkType || '',
        notes: c.effect || (lib ? (lib.base_effect || '') : ''),
        used: !!c.used };
    };
    var skills = state.skills.filter(function (c) { return cardRank(c) >= 1; }).map(cardRow);
    var spells = state.spells.filter(function (c) { return cardRank(c) >= 1; }).map(cardRow);
    // Gear: placements resolved to item names per paper slot.
    var placed = R.derivePlacements(state.items);
    var byId = {};
    state.items.forEach(function (it) { byId[it.id] = it; });
    var itemAt = function (pl) { var it = byId[placed[pl]]; return it ? it.name : ''; };
    var acc = Object.keys(placed).filter(function (pl) { return /^Accessory \d+$/.test(pl); })
      .sort(function (a, b) { return parseInt(a.split(' ')[1], 10) - parseInt(b.split(' ')[1], 10); })
      .map(function (pl) { return byId[placed[pl]].name; });
    var hands = placed['Both Hands'] ? 'Both Hands: ' + byId[placed['Both Hands']].name
      : [itemAt('Left Hand'), itemAt('Right Hand')].filter(Boolean).join(' / ');
    var bio = (state.story && state.story.bio) || {};
    var avatar = (typeof state.avatarUrl === 'string' && state.avatarUrl.indexOf('data:image/') === 0) ? state.avatarUrl : null;
    return {
      name: state.name || '', number: state.number || '', race: state.race || '', className: state.class || '',
      level: state.level, floor: state.floor,
      stats: statRows, hpCurrent: state.hpCurrent,
      evade: { dexMod: fmtMod(stats.dex.mod), buffs: evadeBuffs, dice: evadeDice, total: stats.dex.mod + evadeBuffs },
      move: state.moveVal, step: state.stepVal,
      dr: { armor: armor, buffs: drBuffs, total: drTotal },
      aiFavor: state.aiFavor,
      mana: { current: Math.max(0, Math.min(maxMana, state.manaCurrent)), max: maxMana },
      debuffs: (state.debuffs || []).slice(), buffs: (state.buffs || []).slice(),
      attacks: attacks,
      hotlist: (state.hotlist || []).map(function (e) { return e.name || ''; }),
      gear: { head: itemAt('Head'), torso: itemAt('Torso'), arms: itemAt('Arms'), hands: hands, legs: itemAt('Legs'), feet: itemAt('Feet'), accessories: acc },
      popularity: state.popularity,
      notes: bio.notes || bio.backstory || '',
      skills: skills, spells: spells,
      inventory: state.items.map(function (it) {
        var bs = bonusSummary(it);
        return { name: it.name, qty: it.kind === 'consumable' ? getQty(it) : 1,
          notes: (it.effect || '') + (bs ? ' (' + bs + ')' : '') };
      }),
      avatar: avatar
    };
  }
  function importFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var obj = JSON.parse(reader.result);
        var ch = obj.character || obj;
        if (!ch || (!ch.skills && !ch.spells && !ch.name && ch.level === undefined)) throw new Error('not a character');
        var isOriginal = obj.format === 'crawler-sheet' || ch.strBase !== undefined || ch.raceClassSkillApplied !== undefined;
        if (!confirm('Replace the current sheet with the imported character?')) return;
        if (isOriginal) {
          // Original-format import needs the library (bonus grant kinds),
          // so it resolves after the skills list loads.
          ensureSkills().then(function () {
            var converted = window.Convert.originalToMerged(ch, {
              isSpellName: function (n) { var lib = findLib(n); return !!(lib && lib.kind === 'spell'); },
              normalizeSlot: R.normalizeSlot
            });
            state = Object.assign(blankState(), converted);
            ensureUnarmed();
            syncGearGrants();
            saveNow();
            renderAll();
          }).catch(function () { alert('Import failed: the rulebook data could not be loaded. Nothing was changed.'); });
          return;
        }
        state = Object.assign(blankState(), ch);
        ensureUnarmed();
        saveNow();
        renderAll();
      } catch (e) { alert('Import failed: that file is not a valid character sheet. Nothing was changed.'); }
    };
    reader.readAsText(file);
  }

  /* ---------------- attacks ---------------- */
  /* UNARMED COMBAT must never be a separate manual attack entry: it
   * lives on the Skills tab, and the Attacks tab derives it from there
   * like every other attack skill. A manual entry was a second source
   * of truth — its damage text never actually followed the skill rank,
   * and it pushed the real derived entry into a separate section.
   * So: drop any manual UNARMED COMBAT attack (migration for sheets
   * that already have one), and make sure the skill card exists. */
  function ensureUnarmed() {
    state.attacks = state.attacks.filter(function (a) { return R.normName(a.name) !== 'unarmed combat'; });
    var hasSkill = state.skills.some(function (c) { return R.normName(c.name) === 'unarmed combat'; });
    if (!hasSkill) {
      state.skills.push({ id: uid(), name: 'UNARMED COMBAT', kind: 'skill', ownRank: 1, stat: 'str', checkType: 'Active Check', effect: '', used: false, gearGrants: {} });
    }
  }

  /* ---------------- gear grants ---------------- */
  function syncGearGrants() {
    // Create cards for equipped grants that have no card yet.
    state.items.forEach(function (it) {
      if (!it.equipped) return;
      (it.bonuses || []).forEach(function (b) {
        if (b.type !== 'grant' || !b.skillName) return;
        var kind = b.kind || 'skill';
        if (!findCard(b.skillName, kind)) {
          var lib = findLib(b.skillName);
          var card = { id: uid(), name: lib ? lib.name : b.skillName, kind: kind, ownRank: 0, stat: lib && lib.stat ? lib.stat.toLowerCase() : (kind === 'spell' ? 'int' : 'str'), checkType: 'Active Check', effect: '', used: false, gearGrants: {} };
          (kind === 'spell' ? state.spells : state.skills).push(card);
        }
      });
    });
    // Recompute each card's gearGrants from equipped items only.
    var all = state.skills.concat(state.spells);
    all.forEach(function (card) {
      var map = {};
      state.items.forEach(function (it) {
        if (!it.equipped) return;
        (it.bonuses || []).forEach(function (b) {
          if (b.type === 'grant' && b.skillName && R.normName(b.skillName) === R.normName(card.name) && (b.kind || 'skill') === card.kind) {
            map[it.id] = (map[it.id] || 0) + num(b.amount, 0);
          }
        });
      });
      card.gearGrants = map;
    });
    pruneBonusCards();
  }
  function pruneBonusCards() {
    function keep(list) {
      return list.filter(function (card) {
        return !R.shouldRemoveCard(card, gearGivenFor(card), raceGivenFor(card), groupGivenFor(card), backgroundGivenFor(card));
      });
    }
    state.skills = keep(state.skills);
    state.spells = keep(state.spells);
  }

  /* ---------------- race / class ---------------- */
  function choiceId(kind, sourceName, grantIdx, pickIdx) {
    return kind + ':' + sourceName + ':' + grantIdx + '-' + pickIdx;
  }
  function applyFixedBonus(source, sourceName, skillName, kind, amount) {
    var card = findCard(skillName, kind);
    var applied;
    if (!card) {
      var lib = findLib(skillName);
      applied = Math.min(amount, 10);
      card = { id: uid(), name: lib ? lib.name : skillName, kind: kind, ownRank: 0, stat: lib && lib.stat ? lib.stat.toLowerCase() : (kind === 'spell' ? 'int' : 'str'), checkType: 'Active Check', effect: '', used: false, gearGrants: {} };
      (kind === 'spell' ? state.spells : state.skills).push(card);
    } else {
      var before = cardRank(card);
      applied = Math.max(0, Math.min(amount, 10 - before)); // cap Rank 10 at selection
      if (applied <= 0) return;
    }
    state.raceClassApplied.push({ source: source, sourceName: sourceName, skillName: card.name, kind: kind, amount: applied, createdByBonus: card.ownRank === 0 });
  }
  function reverseSource(source, sourceName) {
    state.raceClassApplied = state.raceClassApplied.filter(function (a) {
      return !(a.source === source && (!sourceName || a.sourceName === sourceName));
    });
  }
  function syncMoveBonus() {
    if (state.raceClassMoveApplied) {
      var a = state.raceClassMoveApplied;
      state.moveVal = Math.max(a.ownBefore, state.moveVal - a.amount);
      state.raceClassMoveApplied = null;
    }
    var bonus = R.tigranMoveBonus(state.race, state.class);
    if (bonus > 0) {
      state.raceClassMoveApplied = { amount: bonus, ownBefore: state.moveVal };
      state.moveVal = state.moveVal + bonus;
    }
  }
  async function setRaceClass(kind, name) {
    var oldName = kind === 'race' ? state.race : state.class;
    if (oldName === name) return;
    await ensureSkills();
    await ensureRaces();
    // Reverse this source's fixed bonuses and its choices.
    reverseSource(kind, oldName);
    Object.keys(state.raceClassChoices).forEach(function (cid) {
      if (cid.indexOf(kind + ':' + oldName + ':') === 0) {
        reverseSource('choice', cid);
        delete state.raceClassChoices[cid];
      }
    });
    if (kind === 'race') state.race = name; else state.class = name;
    var entry = findRaceClass(name, kind);
    if (entry) {
      R.parseFixedSkillBonuses(entry, findLib).forEach(function (s) {
        applyFixedBonus(kind, name, s.name, s.kind === 'spell' ? 'spell' : 'skill', s.amount);
      });
    }
    syncMoveBonus();
    pruneBonusCards();
    saveSoon();
    renderAll();
    refreshWizard();
  }
  function setChoice(cid, kind, sourceName, grant, pickIdx, name) {
    reverseSource('choice', cid);
    if (!name) { delete state.raceClassChoices[cid]; }
    else {
      state.raceClassChoices[cid] = { name: name, kind: grant.category === 'spell' ? 'spell' : 'skill' };
      applyFixedBonus('choice', cid, name, grant.category === 'spell' ? 'spell' : 'skill', grant.amount);
    }
    pruneBonusCards();
    saveSoon();
    renderAll();
  }
  function setSplit(cid, statKey, delta, pool) {
    var ch = state.raceClassChoices[cid] || { split: {} };
    ch.split = ch.split || {};
    var total = 0;
    R.STAT_KEYS.forEach(function (k) { total += num(ch.split[k], 0); });
    var next = Math.max(0, num(ch.split[statKey], 0) + delta);
    if (delta > 0 && total >= pool) return;
    ch.split[statKey] = next;
    state.raceClassChoices[cid] = ch;
    saveSoon();
    renderAll();
  }
  function choiceSections() {
    var sections = [];
    [{ kind: 'race', entry: raceEntry() }, { kind: 'class', entry: classEntry() }].forEach(function (pair) {
      var entry = pair.entry;
      if (!entry) return;
      R.parseRaceClassSplit(entry).forEach(function (sp, si) {
        var cid = choiceId(pair.kind, entry.name, 'split' + si, 0);
        var cur = state.raceClassChoices[cid] || { split: {} };
        var total = 0;
        R.STAT_KEYS.forEach(function (k) { total += num((cur.split || {})[k], 0); });
        sections.push({ type: 'split', cid: cid, entry: entry, kind: pair.kind, pool: sp, total: total, cur: cur });
      });
      R.parseChoiceGrants(entry).forEach(function (g, gi) {
        for (var n = 0; n < g.count; n++) {
          var cid2 = choiceId(pair.kind, entry.name, 'choice' + gi, n);
          sections.push({ type: 'grant', cid: cid2, entry: entry, kind: pair.kind, grant: g, cur: state.raceClassChoices[cid2] });
        }
      });
    });
    return sections;
  }

  /* ---------------- rendering: sidebar / counters ---------------- */
  var activeTab = 'vitals';
  function killMarks(kind, n) {
    if (!n) return kind === 'pk' ? 'No marks' : 'No stars';
    var big = Math.floor(n / 5), small = n % 5, icon = kind === 'pk' ? '💀' : '⭐';
    var out = '';
    if (big) out += '<span class="mark-big ' + kind + '">' + icon + '</span> ×' + big;
    if (small) out += (out ? ' ' : '') + '<span class="mark-small ' + kind + '">' + icon + '</span> ×' + small;
    return out;
  }
  function renderSidebar() {
    $('profile-name').textContent = state.name || 'Unnamed Crawler';
    $('profile-number').textContent = 'Crawler #' + (state.number ? String(state.number).replace(/^#/, '') : '—');
    $('profile-sub').textContent = (state.race || '—') + ' • ' + (state.class || 'Unassigned') + ' • Floor ' + state.floor;
    $('pk-count').textContent = state.pkKills;
    $('boss-count').textContent = state.bossKills;
    $('pk-marks').innerHTML = killMarks('pk', state.pkKills);
    $('boss-marks').innerHTML = killMarks('boss', state.bossKills);
    setVal('f-name', state.name);
    setVal('f-number', state.number);
    setVal('f-level', state.level);
    setVal('f-floor', state.floor);
    $('race-name').textContent = state.race || '—';
    $('class-name').textContent = state.class || '—';
    var img = $('avatar-img'), ph = $('avatar-placeholder');
    if (state.avatarUrl) { img.src = state.avatarUrl; img.hidden = false; ph.hidden = true; }
    else { img.hidden = true; ph.hidden = false; }
  }
  function renderCounters(stats, hbMod) {
    var bank = R.statBank(state.level, state.statPointsSpent);
    $('ctr-level').textContent = state.level;
    $('ctr-floor').textContent = state.floor;
    $('ctr-bank').textContent = bank;
    $('ctr-gold').textContent = state.gold;
    $('ctr-pop').textContent = state.popularity;
    $('ctr-favor').textContent = state.aiFavor;
    $('ctr-move').textContent = state.moveVal;
    $('ctr-step').textContent = state.stepVal;
    $('ctr-boss').textContent = state.bossKills;
    $('ctr-pk').textContent = state.pkKills;
    $('bank-text').textContent = bank;
  }
  function hpStatus(pct) {
    if (pct >= 75) return 'Healthy';
    if (pct >= 50) return 'Damaged';
    if (pct >= 25) return 'Low';
    return 'Critical';
  }
  function renderVitals(stats) {
    var hbMod = R.healthBarUsesCha(raceEntry(), classEntry()) ? stats.cha.mod : stats.con.mod;
    var maxHp = R.totalHp(hbMod);
    var curHp = state.hpCurrent * hbMod;
    var pct = Math.round(state.hpCurrent / 10 * 100);
    $('hp-text').textContent = curHp + ' / ' + maxHp + ' HP (' + pct + '% · ' + hpStatus(pct) + ')';
    var bar = $('hp-bar');
    var cls = pct >= 75 ? 'filled' : pct >= 50 ? 'filled mid' : pct >= 25 ? 'filled low' : 'filled crit';
    var html = '';
    for (var i = 0; i < 10; i++) {
      html += '<div class="hp-seg ' + (i < state.hpCurrent ? cls : '') + '">' + (i < state.hpCurrent ? hbMod : '') + '</div>';
    }
    bar.innerHTML = html;
    var maxMana = R.maxMana(stats.int.total);
    if (state.prevMaxMana !== undefined && maxMana > state.prevMaxMana) {
      state.manaCurrent = Math.min(maxMana, state.manaCurrent + (maxMana - state.prevMaxMana));
    }
    state.prevMaxMana = maxMana;
    if (state.manaCurrent > maxMana) state.manaCurrent = maxMana;
    if (state.manaCurrent < 0) state.manaCurrent = 0;
    $('mana-text').textContent = state.manaCurrent + ' / ' + maxMana + ' Mana';
    $('mana-fill').style.width = (maxMana ? Math.round(state.manaCurrent / maxMana * 100) : 0) + '%';
    var evadeDice = R.evadeDiceCount(raceEntry(), classEntry());
    var gearEvade = equippedBonuses().evade;
    var skillEvade = skillEvadeTotal();
    $('evade-disp').textContent = R.evadeString(stats.dex.mod, evadeDice, state.evadeBuffs + skillEvade, gearEvade);
    $('evade-sub').textContent = 'Evade = d20' + (evadeDice ? ' + ' + evadeDice + 'd4 (Race/Class)' : '') + ' + DEX modifier (+' + stats.dex.mod + ')' + ' + Buffs (' + (state.evadeBuffs >= 0 ? '+' : '') + state.evadeBuffs + ')' + (skillEvade ? ' + Skills (+' + skillEvade + ')' : '') + (gearEvade ? ' + Gear (+' + gearEvade + ')' : '');
    var armor = state.ownArmor + equippedBonuses().dr;
    var dr = R.totalDR(armor, state.drBuffs, raceClassDR());
    $('dr-disp').textContent = dr;
    $('dr-sub').textContent = 'Damage Resistance = Armor (' + armor + ') + Buffs (' + (state.drBuffs >= 0 ? '+' : '') + state.drBuffs + ')' + (raceClassDR() ? ' + Race/Class (+' + raceClassDR() + ')' : '');
    setVal('f-armor', state.ownArmor);
    setVal('f-evade-buffs', state.evadeBuffs);
    setVal('f-dr-buffs', state.drBuffs);
    // Stat cards
    var cards = '';
    R.STAT_KEYS.forEach(function (k) {
      var s = stats[k];
      cards += '<div class="stat-card"><h3>' + k.toUpperCase() + ' — ' + R.STAT_NAMES[k] + '</h3>'
        + '<p class="stat-total">Total: <strong>' + s.total + '</strong> &nbsp; Modifier: <strong>+' + s.mod + '</strong></p>'
        + '<label>Base (edit to set) <input type="number" min="1" value="' + s.derived + '" onchange="DCC.setOwnBase(\'' + k + '\', this.value)"></label>'
        + '<label>Enhance <input type="number" min="1" value="' + s.total + '" onchange="DCC.setEnhTotal(\'' + k + '\', this.value)"></label>'
        + '<p>Gear: +' + s.gear + ' &nbsp; Race/Class: +' + (Math.max(0, s.fixed) + s.split) + '</p>'
        + (s.penalty < 0 ? '<p>Race/Class penalty: ' + s.penalty + ' (subtracted from Total)</p>' : '') + '</div>';
    });
    $('stat-cards').innerHTML = cards;
    // Note: Base shows the player's own base only (race/class is a
    // separate line, not folded in). Enhance shows the computed total;
    // typing a total back-computes the own enhancement (setEnhTotal),
    // like the rank control sets the displayed rank.
    function listHtml(list, kind) {
      return list.map(function (x, i) {
        return '<li>' + esc(x) + ' <button type="button" onclick="DCC.delNote(\'' + kind + '\',' + i + ')">Remove</button></li>';
      }).join('');
    }
    $('buff-list').innerHTML = listHtml(state.buffs, 'buff');
    $('debuff-list').innerHTML = listHtml(state.debuffs, 'debuff');
    setVal('t-gold', state.gold); setVal('t-pop', state.popularity); setVal('t-favor', state.aiFavor);
    setVal('t-move', state.moveVal); setVal('t-step', state.stepVal);
    if (pruneHotlistRefs()) saveSoon();
    $('hotlist').innerHTML = state.hotlist.map(function (x, i) {
      if (!x || x.type === 'note') return '<div class="card"><span>' + esc(x ? x.name : '') + '</span> <button type="button" onclick="DCC.delHotlist(' + i + ')">Remove</button></div>';
      if (x.type === 'item') {
        var it = state.items.find(function (t) { return t.id === x.id; });
        if (!it) return '';
        return '<div class="card"><span>' + esc(it.name) + ' ×' + getQty(it) + ' (consumable)</span> <button type="button" onclick="DCC.useConsumable(\'' + it.id + '\')">Use</button> <button type="button" onclick="DCC.delHotlist(' + i + ')">Remove</button></div>';
      }
      var card = (x.type === 'skill' ? state.skills : state.spells).find(function (c) { return c.id === x.id; });
      if (!card) return '';
      return '<div class="card"><span>' + esc(card.name) + ' (' + x.type + ', Rank ' + cardRank(card) + ')</span> <button type="button" onclick="DCC.rollCard(\'' + x.type + '\',\'' + card.id + '\')">Roll</button> <button type="button" onclick="DCC.delHotlist(' + i + ')">Remove</button></div>';
    }).join('') || '<p class="hint">Hotlist is empty.</p>';
  }
  function setOwnBase(key, value) {
    state.ownBase[key] = Math.max(1, num(value, 1));
    saveSoon(); renderAll();
  }
  function setOwnEnh(key, value) {
    state.ownEnh[key] = Math.max(0, num(value, 0));
    saveSoon(); renderAll();
  }
  /* The Enhance box shows the computed total (Base + Gear + Race/Class
   * + buffs − penalties). Typing a total back-computes the player's
   * own enhancement, like the rank control sets the displayed rank. */
  function setEnhTotal(key, value) {
    var s = computeStats()[key];
    state.ownEnh[key] = R.ownEnhForTotal(value, state.ownBase[key] || 0, s.gear || 0, s.raceClass || 0, R.statCapFor(state.race, state.class, key));
    saveSoon(); renderAll();
  }

  /* ---------------- rendering: cards ---------------- */
  function rulebookBox(card) {
    var lib = findLib(card.name);
    if (!lib) return '';
    var html = '<div class="rulebook"><strong>Rulebook:</strong> ' + esc(lib.base_effect || '');
    if (lib.base_damage) html += '<br>Damage: ' + esc(lib.base_damage);
    if (lib.mana_cost) html += '<br>Mana: ' + esc(lib.mana_cost);
    if (lib.range) html += '<br>Range: ' + esc(lib.range);
    if (lib.stat) html += '<br>Book stat: ' + esc(lib.stat);
    var bc = bookCheckFor(card.name);
    if (bc && bc.check) html += '<br>Book check: ' + esc(bc.check) + ' (locked)';
    if (card.kind === 'spell') {
      var kw = keywordCache[R.normName(card.name)] || [];
      if (kw.length) html += '<br><span class="keywords">Keywords: ' + esc(kw.join(', ')) + '</span>';
      if (R.normName(card.name) === "nature's breath") {
        html += '<br>Heal at Rank ' + cardRank(card) + ': ' + esc(R.naturesBreathHealFormula(cardRank(card)));
      }
    }
    if (lib.upgrades) {
      var r = cardRank(card);
      ['5', '10', '15'].forEach(function (t) {
        if (lib.upgrades[t]) html += '<br>' + (r >= parseInt(t, 10) ? '✓ ' : '') + 'Rank ' + t + ': ' + esc(lib.upgrades[t]);
      });
    }
    html += '</div>';
    return html;
  }
  /* Both directions of the Damage Effect relation, for the Skills tab:
   * an attack skill's card lists the Damage Effects ranked for it, and
   * a Damage Effect's card names the attack skills it applies to. The
   * condition itself lives in the effect's Rulebook box below. */
  function cardRelationHtml(card) {
    if (card.kind !== 'skill') return '';
    var lib = findLib(card.name);
    if (!lib) return '';
    var parents = R.damageEffectParents(lib.base_effect || '');
    if (parents.length) {
      return '<p><strong>Damage Effect — applies to:</strong> ' + esc(parents.join(', ')) + ' (only when using that attack and meeting its condition).</p>';
    }
    if (R.isAttackSkill(card.name)) return damageEffectsFor(card.name);
    return '';
  }
  function cardHtml(card) {
    // The Rank line shows the trained (own) rank as a note, like the DM
    // inspector does: leveling raises the trained rank, while the Rank
    // shown and edited here is the displayed rank (trained + bonuses).
    var rank = cardRank(card);
    var eff = R.effectiveRank(rank, card, state.race, state.class);
    var group = groupGivenFor(card);
    var lib = findLib(card.name);
    var statLocked = !!(lib && lib.stat);
    var statNoStat = !!(lib && !lib.stat);
    var derivedCheck = bookCheckFor(card.name);
    var checkLocked = !!(derivedCheck && derivedCheck.check);
    var statOptions = R.STAT_KEYS.map(function (k) {
      return '<option value="' + k + '"' + (card.stat === k ? ' selected' : '') + '>' + k.toUpperCase() + '</option>';
    }).join('');
    var rankOptions = '';
    for (var r = 1; r <= 20; r++) rankOptions += '<option value="' + r + '"' + (rank === r ? ' selected' : '') + '>' + r + '</option>';
    var open = !!(state.cardOpen && state.cardOpen[card.id]);
    return '<details class="card"' + (open ? ' open' : '') + ' ontoggle="DCC.setCardOpen(\'' + card.id + '\',this.open)"><summary>' + esc(card.name) + ' — Rank ' + rank + (card.used ? ' (Used)' : '') + '</summary>'
      + '<div class="row"><label>Name <input type="text" value="' + esc(card.name) + '" onchange="DCC.renameCard(\'' + card.kind + '\',\'' + card.id + '\',this.value)"></label>'
      + '<label>Rank <select onchange="DCC.setRank(\'' + card.kind + '\',\'' + card.id + '\',this.value)">' + rankOptions + '</select></label>'
      + '<label>Stat ' + (statNoStat
        ? '<select disabled title="No associated stat in the book (Passive), locked"><option value="">\u2014</option></select>'
        : '<select ' + (statLocked ? 'disabled title="Book stat (see Rulebook box)"' : '') + ' onchange="DCC.setCardStat(\'' + card.kind + '\',\'' + card.id + '\',this.value)">' + statOptions + '</select>') + '</label>'
      + '<label>Check ' + (checkLocked
        ? '<select disabled title="Book check type, locked (Chapter 4)"><option>' + esc(derivedCheck.check) + '</option></select>'
        : '<select onchange="DCC.setCardCheck(\'' + card.kind + '\',\'' + card.id + '\',this.value)">'
        + ['Active Check', 'Contested Check', 'Evade Check', 'Passive Effect'].map(function (c) { return '<option' + (card.checkType === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select>') + '</label>'
      + '<label>Used <input type="checkbox"' + (card.used ? ' checked' : '') + ' onchange="DCC.toggleUsed(\'' + card.kind + '\',\'' + card.id + '\',this.checked)"></label>'
      + '<button type="button" onclick="DCC.rollCard(\'' + card.kind + '\',\'' + card.id + '\')">Roll d20</button>'
      + '<button type="button" onclick="DCC.delCard(\'' + card.kind + '\',\'' + card.id + '\')">Delete</button></div>'
      + '<p>Rank ' + rank + (group ? ' (Group +' + group + ' in rank)' : '') + (backgroundGivenFor(card) ? ' (Background +' + backgroundGivenFor(card) + ' in rank)' : '') + (eff !== rank ? ' — effective Rank ' + eff + ' (Mage −3)' : '') + ' (Trained ' + (parseInt(card.ownRank, 10) || 0) + ')' + '</p>'
      + cardRelationHtml(card)
      + '<label>Notes <input type="text" value="' + esc(card.effect || '') + '" onchange="DCC.setCardEffect(\'' + card.kind + '\',\'' + card.id + '\',this.value)"></label>'
      + rulebookBox(card) + '</details>';
  }
  function renderSkills() {
    if (!cache.skills) { ensureSkills().then(function () { renderAll(); }).catch(function () {}); }
    if (!cache.bookChecks) { ensureBookChecks().then(function () { renderAll(); }).catch(function () {}); }
    $('skill-list').innerHTML = state.skills.filter(function (c) { return cardRank(c) >= 1; }).map(cardHtml).join('') || '<p class="hint">No skills yet. Pick from the rulebook or add a custom skill.</p>';
  }
  function renderSpells() {
    if (!cache.bookChecks) { ensureBookChecks().then(function () { renderAll(); }).catch(function () {}); }
    if (!cache.skills) { ensureSkills().then(function () { renderAll(); }).catch(function () {}); }
    $('spell-list').innerHTML = state.spells.filter(function (c) { return cardRank(c) >= 1; }).map(cardHtml).join('') || '<p class="hint">No spells yet. Pick from the rulebook or add a custom spell.</p>';
  }
  /* ---------------- story tabs ---------------- */
  function story() {
    if (!state.story) state.story = { quests: [], journal: [], pets: [], mounts: [], sponsors: [], faith: { deity: '', tier: 'none', looted: 0, streak: 0, missed: 0, offerings: [], tithes: [] }, crafting: [], bio: { appearance: '', personality: '', backstory: '', notes: '' } };
    if (!state.story.faith) state.story.faith = { deity: '', tier: 'none', looted: 0, streak: 0, missed: 0, offerings: [], tithes: [] };
    ['tier', 'looted', 'streak', 'missed'].forEach(function (k) { if (state.story.faith[k] === undefined) state.story.faith[k] = k === 'tier' ? 'none' : 0; });
    if (!state.story.bio) state.story.bio = { appearance: '', personality: '', backstory: '', notes: '' };
    ['quests', 'journal', 'pets', 'mounts', 'sponsors', 'crafting'].forEach(function (k) { if (!state.story[k]) state.story[k] = []; });
    return state.story;
  }
  function storyStatusOptions(cur) {
    return ['active', 'completed', 'failed'].map(function (s) { return '<option value="' + s + '"' + (cur === s ? ' selected' : '') + '>' + s + '</option>'; }).join('');
  }
  function renderQuests() {
    $('quest-list').innerHTML = story().quests.map(function (q) {
      return '<div class="card"><h4>' + esc(q.name) + '</h4><p>' + esc(q.notes || '') + '</p>'
        + '<div class="row"><label>Status <select onchange="DCC.storySet(\'quests\',\'' + q.id + '\',\'status\',this.value)">' + storyStatusOptions(q.status) + '</select></label>'
        + '<label>Notes <input type="text" value="' + esc(q.notes || '') + '" onchange="DCC.storySet(\'quests\',\'' + q.id + '\',\'notes\',this.value)"></label>'
        + '<button type="button" onclick="DCC.storyDel(\'quests\',\'' + q.id + '\')">Delete</button></div></div>';
    }).join('') || '<p class="hint">No quests yet.</p>';
  }
  function renderJournal() {
    var entries = story().journal.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    $('journal-list').innerHTML = entries.map(function (e) {
      return '<div class="card"><h4>' + esc(e.title || '(untitled)') + ' — ' + esc(e.date || '') + '</h4><p>' + esc(e.text || '') + '</p>'
        + '<button type="button" onclick="DCC.storyDel(\'journal\',\'' + e.id + '\')">Delete</button></div>';
    }).join('') || '<p class="hint">No journal entries yet.</p>';
  }
  function petHpSlots(c) { return Math.min(10, num(c.size, 3) + Math.max(0, num(c.level, 1) - 1)); }
  // Pet Level 1 Special Abilities (book, p.231): five bullets, shown
  // here as six picker entries because the movement bullet (swim or
  // burrow at 30ft, or flight or jump at 50ft) is split into its two
  // halves for picking. Each picked entry still counts as one ability.
  // Level 15 benefits and GM-approved abilities stay possible through
  // the free-text field.
  var PET_ABILITIES = ['Move 60ft', 'Taunt or Catcher (Rank = Floor)', 'Swim or burrow (Move 30ft)', 'Flight or jump (Move 50ft)', 'Heightened Senses', 'Resistance to an uncommon damage type'];
  function petRoleAllowance(role) { return role === 'Tank' ? 1 : role === 'Utility' ? 2 : role === 'Aggressive' ? 0 : null; }
  function renderPets() {
    $('pet-list').innerHTML = story().pets.map(function (c) {
      return '<div class="card"><h4>' + esc(c.name) + (c.kind ? ' — ' + esc(c.kind) : '') + '</h4>'
        + '<p>Level ' + num(c.level, 1) + ' · Attitude: ' + esc(c.attitude || 'Calm') + ' · Role: ' + esc(c.role || 'None') + ' · Health Bar slots: ' + petHpSlots(c) + ' (size ' + sizeLabel(c.size) + ', +1 per level, max 10)</p>'
        + '<div class="row"><label>Level <input type="number" min="1" value="' + num(c.level, 1) + '" onchange="DCC.storySet(\'pets\',\'' + c.id + '\',\'level\',this.value)"></label>'
        + '<label>Size (Table 9) <select onchange="DCC.storySet(\'pets\',\'' + c.id + '\',\'size\',this.value)">' + sizeOptions(num(c.size, 3)) + '</select></label>'
        + '<label>Attitude <select onchange="DCC.storySet(\'pets\',\'' + c.id + '\',\'attitude\',this.value)">'
        + ['Hostile', 'Calm', 'Friendly', 'Bonded'].map(function (a) { return '<option' + ((c.attitude || 'Calm') === a ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select></label>'
        + '<label>Role <select onchange="DCC.storySet(\'pets\',\'' + c.id + '\',\'role\',this.value)">'
        + ['None', 'Tank', 'Aggressive', 'Utility'].map(function (a) { return '<option' + ((c.role || 'None') === a ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select></label></div>'
        + '<label>Notes <input type="text" value="' + esc(c.notes || '') + '" onchange="DCC.storySet(\'pets\',\'' + c.id + '\',\'notes\',this.value)"></label>'
        + '<p><strong>Attacks / Spells / Abilities (Rank = Floor ' + state.floor + '):</strong> ' + (c.skills || []).map(function (s) { return esc(s.name); }).join(', ') + '</p>'
        + '<p><strong>Special Abilities:</strong> ' + (c.abilities || []).join(', ') + '</p>'
        + (function () {
          var allow = petRoleAllowance(c.role), extra = num(c.level, 1) >= 15 ? 1 : 0, total = allow === null ? null : allow + extra;
          var line = '';
          if (c.role === 'Tank') line += '<p>Tank: DR = Floor (' + state.floor + ')</p>';
          if (c.role === 'Aggressive') line += '<p>Aggressive: Back Claw and Bite (Rank = Floor ' + state.floor + '), +' + state.floor + ' damage to all Animal Attacks, no Special Abilities</p>';
          if (total !== null) {
            line += '<p>Abilities allowed: ' + total + ' (' + allow + ' for ' + esc(c.role) + (extra ? ' + 1 Level 15 benefit' : '') + '), listed: ' + (c.abilities || []).length
              + ((c.abilities || []).length > total ? ' — over the role allowance' : '') + '</p>';
          }
          return line;
        })()
        + '<div class="row"><label>Skill / Attack / Spell <input type="text" id="comp-skill-name-' + c.id + '" placeholder="Name"></label>'
        + '<button type="button" onclick="DCC.compSkillAdd(\'pets\',\'' + c.id + '\')">Add</button>'
        + '<label>Special Ability <select id="comp-ability-select-' + c.id + '">' + PET_ABILITIES.map(function (a) { return '<option>' + esc(a) + '</option>'; }).join('') + '</select></label>'
        + '<button type="button" onclick="DCC.compSelectAdd(\'pets\',\'' + c.id + '\',\'abilities\',\'comp-ability-select-\')">Add ability</button>'
        + '<label>Custom ability <input type="text" id="comp-ability-' + c.id + '" placeholder="e.g. Level 15 benefit"></label>'
        + '<button type="button" onclick="DCC.compListAdd(\'pets\',\'' + c.id + '\',\'abilities\',\'comp-ability-\')">Add custom</button>'
        + '<button type="button" onclick="DCC.storyDel(\'pets\',\'' + c.id + '\')">Delete pet</button></div>'
        + (c.skills || []).map(function (s) { return '<p>' + esc(s.name) + ' — Rank = Floor ' + state.floor + ' <button type="button" onclick="DCC.compSkillDel(\'pets\',\'' + c.id + '\',\'' + s.id + '\')">Remove</button></p>'; }).join('')
        + (c.abilities || []).map(function (a, ai) { return '<p>' + esc(a) + ' <button type="button" onclick="DCC.compListDel(\'pets\',\'' + c.id + '\',\'abilities\',' + ai + ')">Remove</button></p>'; }).join('')
        + '</div>';
    }).join('') || '<p class="hint">No pets yet.</p>';
  }
  function renderMounts() {
    $('mount-list').innerHTML = story().mounts.map(function (c) {
      var size = num(c.size, 5), move = num(c.move, 30);
      var ups = c.upgrades || [];
      var moveBonus = 0, drBonus = 0, sizeBonus = 0, trample = false;
      ups.forEach(function (u) {
        if (u === '+5ft Move') moveBonus += 5;
        if (u === '+1 DR') drBonus += 1;
        if (u === '+1 Size') sizeBonus += 1;
        if (u === 'Trample') trample = true;
      });
      var effSize = size + sizeBonus;
      return '<div class="card"><h4>' + esc(c.name) + (c.kind ? ' — ' + esc(c.kind) : '') + '</h4>'
        + '<p>Size ' + sizeLabel(effSize) + ' · Move ' + (move + moveBonus) + 'ft · Step ' + num(c.step, 10) + 'ft · Health Bar slots: ' + effSize + ' (mounts do not level) · DR bonus: +' + drBonus + (trample ? ' · Trample: Rank = Floor ' + state.floor + ', ' + effSize + 'd6 Bludgeoning vs prone foes' : '') + '</p>'
        + '<div class="row"><label>Size (Table 9) <select onchange="DCC.storySet(\'mounts\',\'' + c.id + '\',\'size\',this.value)">' + sizeOptions(size) + '</select></label>'
        + '<label>Move (ft) <input type="number" min="0" value="' + move + '" onchange="DCC.storySet(\'mounts\',\'' + c.id + '\',\'move\',this.value)"></label>'
        + '<label>Step (ft) <input type="number" min="0" value="' + num(c.step, 10) + '" onchange="DCC.storySet(\'mounts\',\'' + c.id + '\',\'step\',this.value)"></label>'
        + '<label>Attitude <select onchange="DCC.storySet(\'mounts\',\'' + c.id + '\',\'attitude\',this.value)">'
        + ['Hostile', 'Calm', 'Friendly', 'Bonded'].map(function (a) { return '<option' + ((c.attitude || 'Calm') === a ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select></label></div>'
        + '<label>Notes <input type="text" value="' + esc(c.notes || '') + '" onchange="DCC.storySet(\'mounts\',\'' + c.id + '\',\'notes\',this.value)"></label>'
        + '<p><strong>Upgrades (5,000 gold each; non-attack upgrades stack):</strong> ' + ups.join(', ') + '</p>'
        + '<div class="row"><label>Upgrade <select id="comp-upgrade-' + c.id + '"><option>+5ft Move</option><option>+1 DR</option><option>+1 Size</option><option>Trample</option></select></label>'
        + '<button type="button" onclick="DCC.compSelectAdd(\'mounts\',\'' + c.id + '\',\'upgrades\',\'comp-upgrade-\')">Add upgrade</button>'
        + '<button type="button" onclick="DCC.storyDel(\'mounts\',\'' + c.id + '\')">Delete mount</button></div>'
        + ups.map(function (u, ui) { return '<p>' + esc(u) + ' <button type="button" onclick="DCC.compListDel(\'mounts\',\'' + c.id + '\',\'upgrades\',' + ui + ')">Remove</button></p>'; }).join('')
        + '</div>';
    }).join('') || '<p class="hint">No mounts yet.</p>';
  }
  function renderSponsors() {
    $('sponsor-list').innerHTML = story().sponsors.map(function (s) {
      return '<div class="card"><h4>' + esc(s.name) + '</h4><p>' + esc(s.notes || '') + '</p>'
        + '<p>Banner Count: <strong>' + s.banners + '</strong></p>'
        + '<div class="row"><button type="button" onclick="DCC.sponsorSend(\'' + s.id + '\')">Send Sponsor Banner</button>'
        + '<button type="button" onclick="DCC.sponsorBanner(\'' + s.id + '\',-1)">−1</button>'
        + '<button type="button" onclick="DCC.sponsorBanner(\'' + s.id + '\',1)">+1</button>'
        + '<button type="button" onclick="DCC.storyDel(\'sponsors\',\'' + s.id + '\')">Delete</button></div></div>';
    }).join('') || '<p class="hint">No sponsors yet.</p>';
  }
  var FAITH_TITHE = { none: 0, acolyte: 0.05, devotee: 0.10, zealot: 0.20 };
  // Table 9: Creature Size (book). No per-creature stat table exists;
  // size is the number behind pet/mount Health Bar slots and Trample dice.
  var CREATURE_SIZES = [
    { v: 1, name: 'Tiny', ex: 'Scatterer, Rat' },
    { v: 2, name: 'Small', ex: 'Cat, Raccoon' },
    { v: 3, name: 'Petite', ex: 'Goblin, Boar' },
    { v: 4, name: 'Medium', ex: 'Human, Wolf' },
    { v: 5, name: 'Large', ex: 'Horse, Mantaur' },
    { v: 6, name: 'Huge', ex: 'Elephant, Rhino' },
    { v: 7, name: 'Colossal', ex: 'Dinosaur, Dragon' },
    { v: 8, name: 'Gargantuan', ex: 'Kaiju' }
  ];
  function sizeEntry(v) { return CREATURE_SIZES.find(function (s) { return s.v === num(v, 0); }); }
  function sizeLabel(v) { var s = sizeEntry(v); return s ? s.v + ' — ' + s.name + ' (' + s.ex + ')' : 'Size ' + num(v, 0); }
  function sizeOptions(selected) {
    var opts = CREATURE_SIZES.map(function (s) { return '<option value="' + s.v + '"' + (num(selected, 0) === s.v ? ' selected' : '') + '>' + s.v + ' — ' + s.name + ' (' + s.ex + ')</option>'; }).join('');
    if (!sizeEntry(selected)) opts = '<option value="' + num(selected, 0) + '" selected>Custom (' + num(selected, 0) + ')</option>' + opts;
    return opts;
  }
  var CRAFT_SKILL = { 'Damage Resistance': 'Smithing', 'Explosives': 'Explosives Handling or Goblin Explosives', 'Potions': 'Alchemy', 'Scrolls': 'Calligraphy', 'Spells': 'Arcane', 'Tattoos': 'Tattoo Artistry', 'Other': '—' };
  function renderFaith() {
    var f = story().faith;
    $('faith-deity').value = f.deity || '';
    $('faith-tier').value = f.tier || 'none';
    $('faith-looted').value = num(f.looted, 0);
    var rate = FAITH_TITHE[f.tier] || 0;
    var due = Math.floor(rate * num(f.looted, 0));
    var tithed = (f.tithes || []).reduce(function (a, t) { return a + num(t.amount, 0); }, 0);
    var owed = Math.max(0, due - tithed);
    var missed = num(f.missed, 0), streak = num(f.streak, 0);
    var consequence = missed === 0 ? 'Benefits active.' : missed === 1 ? 'Benefits lost until you make the offering the next day.' : missed === 2 ? 'Divine Debuff gained.' : 'Fallen from Grace: you cannot worship any deities, and there is a 50% chance of being smote.';
    $('faith-status').innerHTML = 'Tithe rate: <strong>' + Math.round(rate * 100) + '%</strong> · Tithe due: <strong>' + due + ' gold</strong> · Tithed: <strong>' + tithed + ' gold</strong> · Still owed: <strong>' + owed + ' gold</strong><br>'
      + 'Consecutive days of worship: <strong>' + streak + '</strong> (a Boon every 5 days: <strong>' + Math.floor(streak / 5) + '</strong> earned) · Days missed: <strong>' + missed + '</strong> · ' + consequence;
    $('offering-list').innerHTML = (f.offerings || []).map(function (o) {
      return '<div class="card"><h4>' + esc(o.name) + (o.date ? ' — ' + esc(o.date) : '') + '</h4><p>' + esc(o.notes || '') + '</p>'
        + '<button type="button" onclick="DCC.faithDel(\'offerings\',\'' + o.id + '\')">Delete</button></div>';
    }).join('') || '<p class="hint">No offerings yet.</p>';
    $('tithe-list').innerHTML = (f.tithes || []).map(function (t) {
      return '<div class="card"><h4>' + t.amount + ' gold</h4><p>' + esc(t.notes || '') + '</p>'
        + '<button type="button" onclick="DCC.faithDel(\'tithes\',\'' + t.id + '\')">Delete</button></div>';
    }).join('') || '<p class="hint">No tithes yet.</p>';
    $('tithe-total').innerHTML = 'Total tithed: <strong>' + tithed + ' gold</strong>';
  }
  function renderCrafting() {
    $('craft-list').innerHTML = story().crafting.map(function (c) {
      return '<div class="card"><h4>' + esc(c.name) + '</h4>'
        + '<p>Table: ' + esc(c.tableType || 'Other') + ' (tier ' + num(c.tableTier, 1) + ', +' + num(c.tableTier, 1) + ' to the Skill Check) · Effect: ' + esc(c.effect || 'Other') + ' · Skill needed: ' + esc(CRAFT_SKILL[c.effect] || '—') + '</p>'
        + '<p><strong>Enchantments (no property twice):</strong> ' + (c.enchantments || []).join(', ') + '</p>'
        + '<div class="row"><label>Status <select onchange="DCC.storySet(\'crafting\',\'' + c.id + '\',\'status\',this.value)">'
        + ['planned', 'in-progress', 'done'].map(function (s) { return '<option value="' + s + '"' + (c.status === s ? ' selected' : '') + '>' + s + '</option>'; }).join('')
        + '</select></label>'
        + '<label>Table tier <input type="number" min="1" max="10" value="' + num(c.tableTier, 1) + '" onchange="DCC.storySet(\'crafting\',\'' + c.id + '\',\'tableTier\',this.value)"></label>'
        + '<label>Notes <input type="text" value="' + esc(c.notes || '') + '" onchange="DCC.storySet(\'crafting\',\'' + c.id + '\',\'notes\',this.value)"></label>'
        + '<label>Enchantment <input type="text" id="craft-ench-' + c.id + '" placeholder="e.g. +1 Strength"></label>'
        + '<button type="button" onclick="DCC.compListAdd(\'crafting\',\'' + c.id + '\',\'enchantments\',\'craft-ench-\')">Add enchantment</button>'
        + '<button type="button" onclick="DCC.storyDel(\'crafting\',\'' + c.id + '\')">Delete</button></div>'
        + (c.enchantments || []).map(function (e, ei) { return '<p>' + esc(e) + ' <button type="button" onclick="DCC.compListDel(\'crafting\',\'' + c.id + '\',\'enchantments\',' + ei + ')">Remove</button></p>'; }).join('')
        + '</div>';
    }).join('') || '<p class="hint">No crafting projects yet.</p>';
  }
  function renderBio() {
    var b = story().bio;
    $('bio-appearance').value = b.appearance || '';
    $('bio-personality').value = b.personality || '';
    $('bio-backstory').value = b.backstory || '';
    $('bio-notes').value = b.notes || '';
    // Creation background, as chosen in the wizard: category, background
    // name, the two skills picked from it and their starting rank, plus
    // the combat choice (Unarmed Combat Rank 3 and any weapon/spell
    // Rank 3). This is a record of the choices, not editable here —
    // re-running the wizard changes it.
    var bg = state.backgrounds;
    var el = $('bio-background');
    if (el) {
      if (!bg) {
        el.innerHTML = '<p class="hint">No background choices recorded yet. They appear here after you finish the guided creation wizard.</p>';
      } else {
        var cats = [
          { id: 'childhood', label: 'Childhood', rank: 1 },
          { id: 'adolescence', label: 'Adolescence', rank: 1 },
          { id: 'career', label: 'Career', rank: 3 },
          { id: 'hobby', label: 'Hobby', rank: 2 }
        ];
        var html = cats.map(function (cat) {
          var sel = bg[cat.id] || {};
          var skills = (sel.skills || []).join(', ') || '—';
          return '<p><strong>' + cat.label + ':</strong> ' + esc(sel.bg || '—') + ' — ' + esc(skills) + ' (Rank ' + cat.rank + ')</p>';
        }).join('');
        var combat = bg.combat || {};
        var combatLine = 'Unarmed Combat (Rank 3)';
        if (combat.type === 'weapon' && combat.name) combatLine += ' + ' + combat.name + ' (Rank 3)';
        else if (combat.type === 'spell' && combat.name) combatLine += ' + ' + combat.name + ' spell (Rank 3)';
        html += '<p><strong>Combat:</strong> ' + esc(combatLine) + '</p>';
        el.innerHTML = html;
      }
    }
  }
  /* Derived attacks: every ranked skill whose Chapter 4 Type line says
   * "Melee Attack" or "Ranged Attack", and every ranked spell whose
   * Chapter 4 keywords include "Attack", appears in the Attacks tab
   * automatically. These are not separate attacks to edit or delete
   * here — change the rank or stat on the Skills/Spells tab and this
   * list follows. A name already present as one of your own attacks
   * is shown once, as your own attack, never twice. (UNARMED COMBAT
   * is never a manual attack: it is derived from its skill card, so
   * it appears here and nowhere else.) Custom skills/spells have no
   * Type line or keyword list, so
   * they never appear here on their own; add them as your own attacks
   * instead. Hand-to-hand Damage Effects (Choke Out, Smush, etc.) are
   * Passive, not Melee/Ranged Attack, so they never appear here. */
  function isAttackCard(card) {
    if (card.kind === 'skill') return R.isAttackSkill(card.name);
    if (card.kind === 'spell') return R.isAttackSpell(keywordCache[R.normName(card.name)] || []);
    return false;
  }
  /* Ranked Damage Effects that apply to this attack, if any. A Damage
   * Effect is conditional on its parent attack and its own condition,
   * so it is shown here, under the attack it modifies, with its full
   * book condition text — never as an attack of its own. */
  function damageEffectsFor(attackName) {
    var key = R.normName(attackName);
    var found = state.skills.filter(function (c) {
      if (cardRank(c) < 1) return false;
      var lib = findLib(c.name);
      if (!lib) return false;
      return R.damageEffectParents(lib.base_effect || '').some(function (p) { return R.normName(p) === key; });
    });
    // Available effects: every library Damage Effect whose parents
    // include this attack, even if you have not ranked it yet. Without
    // this, an attack card only ever showed effects you already had —
    // Wrasslin' showed nothing about Choke Out / Dirty Fighting /
    // Toss until you happened to rank one of them.
    var rankedNames = {};
    found.forEach(function (c) { rankedNames[R.normName(c.name)] = true; });
    var available = (cache.skills || []).filter(function (e) {
      if (rankedNames[R.normName(e.name)]) return false;
      return R.damageEffectParents(e.base_effect || '').some(function (p) { return R.normName(p) === key; });
    });
    var out = '';
    if (found.length) {
      out += '<p><strong>Damage Effects you have ranked for this attack:</strong> ' + found.map(function (c) {
        var lib = findLib(c.name);
        return esc(c.name) + ' (Rank ' + cardRank(c) + ') — ' + esc(lib.base_effect || '');
      }).join('; ') + '</p>';
    }
    if (available.length) {
      out += '<p><strong>Damage Effects available for this attack:</strong> ' + available.map(function (e) { return esc(e.name); }).join(', ') + ' — add them on the Skills tab to use them.</p>';
    }
    return out;
  }
  /* ---- Damage Effect use flow ----
   * Rolling an attack skill that has Damage Effects first asks which
   * effect, if any, to use (the book says choose before rolling).
   * With no effect chosen, the roll is just a roll. With one chosen,
   * the sheet then asks whether it passed the DM's check — the sheet
   * cannot know the target's threshold, so the player confirms it.
   * On a pass: a Rank 0 effect becomes Rank 1; a Rank 1+ effect is
   * marked Used (for levelling later); and the modified damage is
   * held as pending damage on the Attacks tab, where it can be
   * rolled (which resets it) or cleared manually (reference only). */
  function closeModalEl(el) { if (el && el.parentNode) el.parentNode.removeChild(el); }
  function openOverlay(title, bodyHtml, buttons) {
    var overlay = document.createElement('div');
    overlay.className = 'overlay';
    var modal = document.createElement('div');
    modal.className = 'modal wide';
    var h = document.createElement('h2');
    h.textContent = title;
    modal.appendChild(h);
    var body = document.createElement('div');
    body.innerHTML = bodyHtml;
    modal.appendChild(body);
    var row = document.createElement('div');
    row.className = 'btn-row';
    buttons.forEach(function (b) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b.label;
      btn.addEventListener('click', function () { closeModalEl(overlay); b.onClick(); });
      row.appendChild(btn);
    });
    modal.appendChild(row);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    return overlay;
  }
  function effectsForAttack(attackName) {
    var key = R.normName(attackName);
    return (cache.skills || []).filter(function (e) {
      return R.damageEffectParents(e.base_effect || '').some(function (p) { return R.normName(p) === key; });
    });
  }
  function effectCardRank(name) {
    var card = state.skills.find(function (c) { return c.kind === 'skill' && R.normName(c.name) === R.normName(name); });
    return card ? cardRank(card) : 0;
  }
  function promptEffectThenRoll(attackName, statKey, statMod, parentInfo) {
    ensureSkills().then(function () {
      var effects = effectsForAttack(attackName);
      if (!effects.length) { rollD20Check(attackName + ' — to hit', statMod); return; }
      var overlay = openOverlay('Roll ' + attackName + ' — use a Damage Effect?', '', []);
      var body = overlay.querySelector('.modal > div');
      var html = '<p class="hint">Choose before rolling, as the book requires. Picking an effect does not use it yet — it only applies if the attack then passes.</p>';
      html += '<label><input type="radio" name="eff-choice" value="" checked> No Damage Effect</label><br>';
      effects.forEach(function (e, i) {
        html += '<label><input type="radio" name="eff-choice" value="' + i + '"> ' + esc(e.name) + ' (Rank ' + effectCardRank(e.name) + ') — ' + esc(e.base_effect || '') + '</label><br>';
      });
      body.innerHTML = html;
      var row = document.createElement('div');
      row.className = 'btn-row';
      var rollBtn = document.createElement('button');
      rollBtn.type = 'button';
      rollBtn.textContent = 'Roll to hit';
      rollBtn.addEventListener('click', function () {
        var sel = overlay.querySelector('input[name="eff-choice"]:checked');
        var chosen = sel && sel.value !== '' ? effects[parseInt(sel.value, 10)].name : null;
        closeModalEl(overlay);
        rollD20Check(attackName + ' — to hit', statMod);
        if (chosen) promptSuccess(attackName, statKey, statMod, chosen, parentInfo);
      });
      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', function () { closeModalEl(overlay); });
      row.appendChild(rollBtn);
      row.appendChild(cancelBtn);
      overlay.querySelector('.modal').appendChild(row);
    }).catch(function () { rollD20Check(attackName + ' — to hit', statMod); });
  }
  function promptSuccess(attackName, statKey, statMod, effectName, parentInfo) {
    openOverlay('Did ' + attackName + ' hit?', '<p>' + esc(lastRollText) + '</p><p class="hint">The sheet does not know the DM\'s check threshold, so confirm the result yourself. A miss changes nothing — the effect is not used, ranked, or marked.</p>', [
      { label: 'Yes, it hit', onClick: function () { applyEffectSuccess(attackName, statKey, statMod, effectName, parentInfo); } },
      { label: 'No, it missed', onClick: function () {} }
    ]);
  }
  function applyEffectSuccess(attackName, statKey, statMod, effectName, parentInfo) {
    var effectLib = findLib(effectName);
    var card = state.skills.find(function (c) { return c.kind === 'skill' && R.normName(c.name) === R.normName(effectName); });
    var wasRank = card ? cardRank(card) : 0;
    if (!card) {
      card = { id: uid(), name: effectLib ? effectLib.name : effectName, kind: 'skill', ownRank: 1, stat: effectLib && effectLib.stat ? effectLib.stat.toLowerCase() : 'str', checkType: 'Passive Effect', effect: '', used: false, gearGrants: {} };
      state.skills.push(card);
    } else if (wasRank < 1) {
      card.ownRank = R.ownRankForTotal(1, gearGivenFor(card), raceGivenFor(card), groupGivenFor(card), backgroundGivenFor(card));
    } else {
      card.used = true;
    }
    var newRank = cardRank(card);
    var parentCard = state.skills.find(function (c) { return c.kind === 'skill' && R.normName(c.name) === R.normName(attackName); });
    var parentLib = findLib(attackName);
    var parentRank = parentCard ? cardRank(parentCard) : (parentInfo && parentInfo.rank ? parentInfo.rank : 1);
    var calc = R.effectDamage(parentLib, parentRank, effectLib, newRank);
    if (parentInfo && parentInfo.manualDamage && !parentLib) {
      // A manual attack with no library entry: run the same damage
      // maths against its typed damage string instead of returning
      // an unrollable formula.
      calc = R.effectDamage({ base_damage: parentInfo.manualDamage, upgrades: {} }, 1, effectLib, newRank);
    }
    // Damage modifier is the DAMAGE stat's mod, not the to-hit mod:
    // Pugilism hits with DEX but damages with STR, Noggin Nocker
    // hits with STR but damages with CON. Fall back to the to-hit
    // mod only when the damage text names no stat.
    var dmgStat = R.damageStatFromText(parentLib ? parentLib.base_damage : (parentInfo && parentInfo.manualDamage ? parentInfo.manualDamage : ''));
    var dmgStats = computeStats();
    var dmgMod = (dmgStat && dmgStats[dmgStat]) ? dmgStats[dmgStat].mod : statMod;
    state.pendingDamage = {
      attackName: attackName, effectName: effectLib ? effectLib.name : effectName, effectRank: newRank,
      dice: calc.dice, flat: calc.flat, statMod: dmgMod, statLabel: dmgStat ? dmgStat.toUpperCase() : statKey.toUpperCase(),
      multiplier: calc.multiplier, diceMultiplier: calc.diceMultiplier,
      formula: calc.formula, note: calc.note || ''
    };
    saveSoon(); renderAll();
    showRoll((wasRank < 1 ? effectName + ' is now Rank 1' : effectName + ' marked Used') + ' — damage ready on the Attacks tab: ' + calc.formula);
  }
  function pendingDamageHtml() {
    var p = state.pendingDamage;
    if (!p) return '';
    return '<div class="card"><h4>Damage ready: ' + esc(p.attackName) + ' + ' + esc(p.effectName) + ' (Rank ' + p.effectRank + ')</h4>'
      + '<p><strong>' + esc(p.formula) + '</strong></p>'
      + (p.note ? '<p class="hint">' + esc(p.note) + '</p>' : '')
      + '<p class="hint">Roll it to get the result — rolling resets the formula to the attack\'s normal damage. Or Clear it to use the formula as reference only.</p>'
      + '<button type="button" onclick="DCC.rollPendingDamage()">Roll damage</button>'
      + '<button type="button" onclick="DCC.clearPendingDamage()">Clear</button></div>';
  }
  function renderAttacks() {
    // The library is needed to tell Attack Skills from other skills, and
    // it is only loaded on demand — fetch it on first visit to this tab
    // (after a reload the cards are loaded but the library is not yet)
    // and re-render once it arrives, rather than showing an empty list.
    if (!cache.skills) { ensureSkills().then(function () { renderAll(); }).catch(function () {}); }
    var stats = computeStats();
    var manual = state.attacks.map(function (a) {
      var override = R.attackDamageStat(a.name, state.race, state.class);
      var mod = stats[a.toHitStat] ? stats[a.toHitStat].mod : 0;
      return '<div class="card"><h4>' + esc(a.name) + '</h4>'
        + '<p>To hit: d20 + ' + a.toHitStat.toUpperCase() + ' Mod (+' + mod + ')</p>'
        + '<p>Damage: ' + esc(a.damage) + (override ? ' — damage uses ' + override.toUpperCase() + ' Mod instead (race/class override; to-hit unchanged)' : '') + '</p>'
        + damageEffectsFor(a.name)
        + '<p>' + esc(a.notes || '') + '</p>'
        + '<button type="button" onclick="DCC.rollAttack(\'' + a.id + '\')">Roll to hit</button>'
        + '<button type="button" onclick="DCC.delAttack(\'' + a.id + '\')">Delete</button></div>';
    }).join('') || '<p class="hint">No attacks of your own yet. Add one below, or rank an attack skill or spell and it will appear under "Attack skills &amp; spells".</p>';
    var manualNames = {};
    state.attacks.forEach(function (a) { manualNames[R.normName(a.name)] = true; });
    var derived = state.skills.concat(state.spells).filter(function (c) {
      return cardRank(c) >= 1 && isAttackCard(c) && !manualNames[R.normName(c.name)];
    }).map(function (c) {
      var lib = findLib(c.name);
      var mod = stats[c.stat] ? stats[c.stat].mod : 0;
      var override = R.attackDamageStat(c.name, state.race, state.class);
      var adj = lib ? R.adjustedDamage(lib.base_damage, lib.upgrades, cardRank(c)) : { damage: '—', additions: [] };
      var adjNote = adj.additions.length ? ' (includes ' + adj.additions.map(function (a) { return '+' + a.count + 'd' + a.sides + ' at Rank ' + a.tier; }).join(', ') + ')' : '';
      return '<div class="card"><h4>' + esc(c.name) + '</h4>'
        + '<p>' + (c.kind === 'spell' ? 'Attack spell' : esc(R.skillAttackType(c.name) || 'Attack skill')) + ' — Rank ' + cardRank(c) + '</p>'
        + '<p>To hit: d20 + ' + c.stat.toUpperCase() + ' Mod (+' + mod + ')</p>'
        + '<p>Damage: ' + esc(adj.damage) + adjNote + (override ? ' — damage uses ' + override.toUpperCase() + ' Mod instead (race/class override; to-hit unchanged)' : '')
        + ((lib && lib.mana_cost) ? ' — Mana: ' + esc(lib.mana_cost) : '') + '</p>'
        + (c.kind === 'skill' ? damageEffectsFor(c.name) : '')
        + '<p class="hint">From your ' + (c.kind === 'spell' ? 'Spells' : 'Skills') + ' tab — edit rank or stat there.</p>'
        + '<button type="button" onclick="DCC.rollCard(\'' + c.kind + '\',\'' + c.id + '\')">Roll to hit</button></div>';
    }).join('');
    $('attack-list').innerHTML = pendingDamageHtml() + manual
      + '<h3>Attack skills &amp; spells</h3>'
      + '<p class="hint">Every skill you have ranks in whose Type line says Melee Attack or Ranged Attack, and every spell with the Attack keyword, listed automatically. Damage Effects do not appear here — they are Passive, not attacks.</p>'
      + (derived || '<p class="hint">No ranked attack skills or attack spells yet.</p>');
  }
  function bonusRowHtml(item, bi) {
    var b = item.bonuses[bi];
    return '<div class="bonus-row"><select onchange="DCC.setBonusType(\'' + item.id + '\',' + bi + ',this.value)">'
      + ['stat', 'grant', 'dr', 'evade'].map(function (t) { return '<option value="' + t + '"' + (b.type === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select>'
      + (b.type === 'stat' ? '<select onchange="DCC.setBonusStat(\'' + item.id + '\',' + bi + ',this.value)">' + R.STAT_KEYS.map(function (k) { return '<option value="' + k + '"' + (b.stat === k ? ' selected' : '') + '>' + k.toUpperCase() + '</option>'; }).join('') + '</select>' : '')
      + (b.type === 'grant' ? '<input type="text" placeholder="Skill/spell name" value="' + esc(b.skillName || '') + '" onchange="DCC.setBonusSkill(\'' + item.id + '\',' + bi + ',this.value)">'
        + '<select onchange="DCC.setBonusKind(\'' + item.id + '\',' + bi + ',this.value)"><option value="skill"' + ((b.kind || 'skill') === 'skill' ? ' selected' : '') + '>skill</option><option value="spell"' + (b.kind === 'spell' ? ' selected' : '') + '>spell</option></select>' : '')
      + '<label>Amount <input type="number" value="' + num(b.amount, 0) + '" onchange="DCC.setBonusAmount(\'' + item.id + '\',' + bi + ',this.value)"></label>'
      + '<button type="button" onclick="DCC.delBonus(\'' + item.id + '\',' + bi + ')">Remove bonus</button></div>';
  }
  function kindLabel(kind) {
    return kind === 'gear' ? 'Gear' : kind === 'consumable' ? 'Consumable' : kind === 'coupon' ? 'Coupon' : 'Material/Misc';
  }
  function bonusSummary(it) {
    return (it.bonuses || []).map(function (b) {
      if (b.type === 'stat') return '+' + num(b.amount, 0) + ' ' + String(b.stat || 'str').toUpperCase();
      if (b.type === 'grant') return esc(b.skillName || '') + ' +' + num(b.amount, 0);
      if (b.type === 'dr') return '+' + num(b.amount, 0) + ' DR';
      if (b.type === 'evade') return '+' + num(b.amount, 0) + ' Evade';
      return '';
    }).filter(Boolean).join(', ');
  }
  /* Consumable use fields in the Inventory editor: quantity plus the
   * subtype-specific details the use flow reads. */
  function consumableUseFieldsHtml(it) {
    var use = it.use || {};
    var set = function (field) { return 'DCC.setItemUseField(\'' + it.id + '\',\'' + field + '\',this.value)'; };
    var html = '<label>Qty <input type="number" min="1" value="' + getQty(it) + '" onchange="' + set('qty') + '"></label>';
    if (it.subtype === 'Scroll' || it.subtype === 'Spellbook') {
      html += '<label>Spell <input type="text" value="' + esc(use.spell || '') + '" placeholder="e.g. Fireball" onchange="' + set('spell') + '"></label>'
        + '<label>Rank <input type="number" min="1" value="' + Math.max(1, num(use.spellRank, 1)) + '" onchange="' + set('spellRank') + '"></label>';
    } else if (it.subtype === 'Potion') {
      var pkOpts = [['heal', 'Heal slots'], ['manaFull', 'Restore mana fully'], ['manaOverTime', 'Mana over time'], ['skillBoost', 'Skill boost'], ['healPet', 'Heal pet'], ['removeDebuff', 'Remove debuff'], ['food', 'Food'], ['other', 'Other']];
      html += '<label>Potion effect <select onchange="' + set('potionKind') + '"><option value="">Choose an effect…</option>' + pkOpts.map(function (o) { return '<option value="' + o[0] + '"' + (use.potionKind === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>';
      if (use.potionKind === 'heal' || use.potionKind === 'manaOverTime' || use.potionKind === 'skillBoost') html += '<label>Amount <input type="number" min="0" value="' + num(use.potionAmount, 0) + '" onchange="' + set('potionAmount') + '"></label>';
      if (use.potionKind === 'manaOverTime') html += '<label>Rounds <input type="number" min="1" value="' + Math.max(1, num(use.potionRounds, 1)) + '" onchange="' + set('potionRounds') + '"></label>';
      if (use.potionKind === 'skillBoost') html += '<label>Skill (optional) <input type="text" value="' + esc(use.potionSkill || '') + '" placeholder="Blank = choose when used" onchange="' + set('potionSkill') + '"></label>';
      if (use.potionKind === 'removeDebuff') html += '<label>Debuff it removes <input type="text" value="' + esc(use.potionMatch || '') + '" placeholder="e.g. poison" onchange="' + set('potionMatch') + '"></label>';
      if (use.potionKind === 'heal') html += '<label>Note <input type="text" value="' + esc(use.potionNote || '') + '" placeholder="e.g. Mends one Minor Injury" onchange="' + set('potionNote') + '"></label>';
    } else if (it.subtype === 'Explosive') {
      html += '<label>Damage formula <input type="text" value="' + esc(use.damage || '') + '" placeholder="e.g. 2d6" onchange="' + set('damage') + '"></label>'
        + '<label>Damage type <input type="text" value="' + esc(use.damageType || '') + '" placeholder="e.g. Bludgeoning" onchange="' + set('damageType') + '"></label>'
        + '<label>Blast radius <input type="text" value="' + esc(use.blast || '') + '" placeholder="e.g. 5ft" onchange="' + set('blast') + '"></label>'
        + '<label>Splash <input type="text" value="' + esc(use.splash || '') + '" placeholder="e.g. +5ft" onchange="' + set('splash') + '"></label>';
    }
    return html;
  }
  function itemHtml(it) {
    var lib = null;
    if (cache.items) {
      var n = R.normName(it.name);
      lib = cache.items.find(function (e) { return R.normName(e.name) === n; }) || null;
    }
    var meta = kindLabel(it.kind)
      + (it.kind === 'gear' && it.slot ? ' · ' + it.slot : '')
      + (it.kind === 'gear' && !it.slot ? ' · No slot assigned' : '')
      + (it.kind === 'consumable' && it.subtype ? ' · ' + it.subtype : '')
      + ((it.kind === 'coupon' || it.kind === 'material') && it.subtype ? ' · ' + it.subtype : '');
    var kindOpts = [['gear', 'Gear'], ['consumable', 'Consumable'], ['coupon', 'Coupon'], ['material', 'Material/Misc']];
    var html = '<div class="card"><h4>' + esc(it.name) + (it.kind === 'consumable' ? ' ×' + getQty(it) : '') + (it.equipped ? ' — EQUIPPED' + (it.placement ? ' (' + it.placement + ')' : '') : '') + '</h4>'
      + '<p>' + esc(it.effect || '') + '</p>'
      + '<p class="hint">' + esc(meta) + '</p>'
      + '<div class="row"><label>Name <input type="text" value="' + esc(it.name) + '" onchange="DCC.renameItem(\'' + it.id + '\',this.value)"></label>'
      + '<label>Category <select onchange="DCC.setItemKind(\'' + it.id + '\',this.value)">'
      + kindOpts.map(function (k) { return '<option value="' + k[0] + '"' + (it.kind === k[0] ? ' selected' : '') + '>' + k[1] + '</option>'; }).join('') + '</select></label>'
      + (it.kind === 'gear'
        ? '<label>Slot <select onchange="DCC.setItemSlot(\'' + it.id + '\',this.value)">'
          + '<option value="">Choose a slot…</option>'
          + R.GEAR_SLOT_LABELS.map(function (s) { return '<option' + (it.slot === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>'
        : '')
      + (it.kind === 'consumable'
        ? '<label>Type <select onchange="DCC.setItemSubtype(\'' + it.id + '\',this.value)">'
          + '<option value="">Choose a type…</option>'
          + R.CONSUMABLE_SUBTYPES.map(function (s) { return '<option' + (it.subtype === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>'
        : '')
      + ((it.kind === 'coupon' || it.kind === 'material')
        ? '<label>Type <input type="text" value="' + esc(it.subtype || '') + '" placeholder="Free form, e.g. Tavern coupon" onchange="DCC.setItemSubtype(\'' + it.id + '\',this.value)"></label>'
        : '')
      + (it.kind === 'consumable' ? consumableUseFieldsHtml(it) : '')
      + (it.kind === 'gear'
        ? (it.equipped
          ? '<button type="button" onclick="DCC.setEquipped(\'' + it.id + '\',false)">Unequip</button>'
          : '<button type="button" onclick="DCC.setEquipped(\'' + it.id + '\',true)">Equip</button>')
        : '')
      + (it.kind === 'consumable' ? '<button type="button" onclick="DCC.useConsumable(\'' + it.id + '\')">Use</button>' : '')
      + '<button type="button" onclick="DCC.delItem(\'' + it.id + '\')">Delete</button></div>';
    if (lib) html += '<div class="rulebook"><strong>Rulebook:</strong> ' + esc(lib.effect || '') + (lib.source ? ' — ' + esc(lib.source) : '') + (lib.source_book_page ? ' (p.' + lib.source_book_page + ')' : '') + '</div>';
    html += '<p><strong>Bonuses (apply only while equipped, up to 5):</strong></p>'
      + (it.bonuses || []).map(function (b, bi) { return bonusRowHtml(it, bi); }).join('')
      + ((it.bonuses || []).length < 5 ? '<button type="button" onclick="DCC.addBonus(\'' + it.id + '\')">Add bonus</button>' : '')
      + '</div>';
    return html;
  }
  var invKindFilter = 'all';
  function renderItems() {
    var filters = [['all', 'All'], ['gear', 'Gear'], ['consumable', 'Consumables'], ['coupon', 'Coupons'], ['material', 'Material/Misc']];
    $('item-filters').innerHTML = filters.map(function (f) {
      return '<button type="button"' + (invKindFilter === f[0] ? ' class="active-filter"' : '') + ' onclick="DCC.setInvKindFilter(\'' + f[0] + '\')">' + f[1] + '</button>';
    }).join('');
    var list = state.items.filter(function (it) { return invKindFilter === 'all' || it.kind === invKindFilter; });
    $('item-list').innerHTML = list.map(itemHtml).join('') || '<p class="hint">Nothing in this category yet.</p>';
  }
  /* ---------------- Gear tab: loadouts, slot board, bonuses, catalog ---------------- */
  function clearActiveLoadout() { state.activeLoadoutId = null; }
  function gearOptionsCount(slotLabel) {
    return state.items.filter(function (it) {
      if (it.kind !== 'gear' || it.equipped) return false;
      if (slotLabel === 'Hands/Holding') return R.slotFamily(it.slot) === 'Hands/Holding';
      return it.slot === slotLabel;
    }).length;
  }
  function gearSlotBox(placement, label, placed, occupantOverride) {
    var occupant = occupantOverride || null;
    if (!occupant) Object.keys(placed).forEach(function (id) { if (placed[id] === placement) occupant = state.items.find(function (it) { return it.id === id; }); });
    var fam = R.placementFamily(placement);
    var opts = gearOptionsCount(fam);
    var html = '<div class="gear-slot' + (occupant ? ' filled' : '') + '"><div class="gear-slot-head"><strong>' + label.toUpperCase() + '</strong><span class="hint">' + opts + ' options</span></div>';
    if (occupant) {
      html += '<p>' + esc(occupant.name) + (placed[occupant.id] === 'Both Hands' ? ' — 2 Hand' : '') + '</p><button type="button" onclick="DCC.setEquipped(\'' + occupant.id + '\',false)">Unequip</button>';
    } else {
      html += '<button type="button" onclick="DCC.openSlotPicker(\'' + placement + '\')">+ Equip ' + label + '</button>';
    }
    return html + '</div>';
  }
  function gearBoardHtml(placed) {
    var eqCount = state.items.filter(function (it) { return it.equipped; }).length;
    var accFree = 10 - R.slotOccupants(state.items, 'Accessories').length;
    var overflow = state.items.filter(function (it) { return it.equipped && !placed[it.id]; });
    var center = state.avatarUrl
      ? '<img src="' + esc(state.avatarUrl) + '" alt="Crawler avatar">'
      : '<div class="avatar-placeholder">?</div>';
    // A 2 Hand weapon shows in BOTH hand boxes (it occupies both).
    var rightItem = null, leftItem = null, bothHandsItem = null;
    Object.keys(placed).forEach(function (id) {
      var it = state.items.find(function (x) { return x.id === id; });
      if (!it) return;
      if (placed[id] === 'Both Hands') bothHandsItem = it;
      else if (placed[id] === 'Right Hand') rightItem = it;
      else if (placed[id] === 'Left Hand') leftItem = it;
    });
    var html = '<div class="gear-head"><div><strong>Active Loadout</strong><br><span class="hint">' + eqCount + ' equipped · ' + accFree + ' accessory slots free</span></div></div>'
      + '<div class="gear-board"><div class="gear-col">'
      + gearSlotBox('Head', 'Head', placed) + gearSlotBox('Arms', 'Arms', placed) + gearSlotBox('Right Hand', 'Right Hand', placed, rightItem || bothHandsItem) + gearSlotBox('Legs', 'Legs', placed)
      + '</div><div class="gear-center">' + center + '<p><strong>' + esc(state.name || 'Unnamed Crawler') + '</strong></p></div><div class="gear-col">'
      + gearSlotBox('Torso', 'Torso', placed) + gearSlotBox('Hands/Gloves', 'Hands / Gloves', placed) + gearSlotBox('Left Hand', 'Left Hand', placed, leftItem || bothHandsItem) + gearSlotBox('Feet', 'Feet', placed)
      + '</div></div>';
    html += '<div class="gear-acc-head"><strong>Accessories</strong><span class="hint">' + (10 - accFree) + ' / 10 equipped</span></div><div class="gear-acc-grid">';
    for (var i = 1; i <= 10; i++) html += gearSlotBox('Accessory ' + i, 'Accessory ' + i, placed);
    html += '</div>';
    if (overflow.length) {
      html += '<div class="gear-overflow"><strong>Equipped, no slot to show:</strong><span class="hint"> These keep their bonuses until unequipped. Give each one a slot in Inventory (or unequip it) to place it on the board.</span>'
        + overflow.map(function (it) { return '<div class="cloud-row"><span>' + esc(it.name) + ' — ' + esc(kindLabel(it.kind)) + (it.slot ? ' · ' + it.slot : ' · No slot') + '</span><span><button type="button" onclick="DCC.setEquipped(\'' + it.id + '\',false)">Unequip</button></span></div>'; }).join('') + '</div>';
    }
    return html;
  }
  function gearBonusesHtml(stats) {
    var rows = R.STAT_KEYS.map(function (k) {
      var s = stats[k];
      var before = R.statTotal(s.derived, s.ownEnh, 0, s.raceClass, R.statCapFor(state.race, state.class, k));
      var after = s.total;
      var delta = after - before;
      return '<div class="gear-bonus-stat"><strong>' + k.toUpperCase() + '</strong><br>' + before + ' → ' + after + (delta ? ' (+' + delta + ')' : '') + '</div>';
    }).join('');
    var eb = equippedBonuses();
    var grants = {};
    state.items.forEach(function (it) {
      if (!it.equipped) return;
      (it.bonuses || []).forEach(function (b) {
        if (b.type === 'grant' && b.skillName) grants[b.skillName + '|' + (b.kind || 'skill')] = (grants[b.skillName + '|' + (b.kind || 'skill')] || 0) + num(b.amount, 0);
      });
    });
    var extra = [];
    if (eb.dr) extra.push('Damage Resistance +' + eb.dr);
    if (eb.evade) extra.push('Evade +' + eb.evade);
    Object.keys(grants).forEach(function (key) { extra.push(key.split('|')[0] + ' +' + grants[key]); });
    return '<h3>Gear Bonuses</h3><p class="hint">Stats with equipped gear applied (before → after). Only equipped gear counts.</p>'
      + '<div class="gear-bonus-grid">' + rows + '</div>'
      + (extra.length ? '<p>' + esc(extra.join(' · ')) + '</p>' : '');
  }
  function gearCatalogHtml() {
    var fams = ['Head', 'Torso', 'Arms', 'Hands/Gloves', 'Hands/Holding', 'Legs', 'Feet', 'Accessories'];
    return '<h3>Gear Catalog</h3><p class="hint">Browse compatible inventory by equipment slot. Search and sort inside each slot; Equip puts the item in the first free place for that slot.</p>'
      + fams.map(function (fam) {
        var rows = state.items.filter(function (it) {
          if (it.kind !== 'gear' || it.equipped) return false;
          if (fam === 'Hands/Holding') return R.slotFamily(it.slot) === 'Hands/Holding';
          return it.slot === fam;
        });
        var rowsHtml = rows.map(function (it) {
          return '<div class="catalog-row" data-name="' + esc(it.name.toLowerCase()) + '" data-bonus="' + (it.bonuses || []).length + '"><span>' + esc(it.name) + (bonusSummary(it) ? ' — <span class="hint">' + esc(bonusSummary(it)) + '</span>' : '') + '</span><button type="button" onclick="DCC.equipFirstFree(\'' + it.id + '\')">Equip</button></div>';
        }).join('') || '<p class="hint">Empty</p>';
        return '<div class="catalog-slot" data-slot="' + esc(fam) + '"><div class="catalog-slot-head"><strong>' + fam.toUpperCase() + '</strong><span class="hint">' + rows.length + ' items</span></div>'
          + '<div class="row"><input type="text" placeholder="Search this slot…" oninput="DCC.catalogSearch(this)"><select onchange="DCC.catalogSort(this)"><option value="name">Sort: Name</option><option value="bonus">Sort: Most bonuses</option></select></div>'
          + '<div class="catalog-rows">' + rowsHtml + '</div></div>';
      }).join('');
  }
  function loadoutBarHtml() {
    var chips = (state.loadouts || []).map(function (l) {
      var active = state.activeLoadoutId === l.id;
      return '<span class="loadout-chip' + (active ? ' active' : '') + '"><input type="text" value="' + esc(l.name) + '" onchange="DCC.renameLoadout(\'' + l.id + '\',this.value)">'
        + '<button type="button" onclick="DCC.applyLoadout(\'' + l.id + '\')">Apply</button>'
        + '<button type="button" onclick="DCC.saveLoadout(\'' + l.id + '\')">Save current</button>'
        + ((state.loadouts || []).length > 1 ? '<button type="button" onclick="DCC.delLoadout(\'' + l.id + '\')">×</button>' : '')
        + (active ? ' <span class="hint">active</span>' : '') + '</span>';
    }).join('');
    return '<div class="loadout-bar">' + chips
      + ((state.loadouts || []).length < 5 ? '<button type="button" onclick="DCC.addLoadout()">+ Add loadout</button>' : '')
      + '<span class="hint">Apply swaps your whole arrangement at once. Save current stores what is equipped right now into that loadout.</span></div>';
  }
  function renderGear() {
    var stats = computeStats();
    var placed = R.derivePlacements(state.items);
    $('loadout-bar').innerHTML = loadoutBarHtml();
    $('gear-board').innerHTML = gearBoardHtml(placed);
    $('gear-bonuses').innerHTML = gearBonusesHtml(stats);
    $('gear-catalog').innerHTML = gearCatalogHtml();
  }
  function renderChoices() {
    var sections = choiceSections();
    var btn = $('choices-tab-btn');
    btn.hidden = sections.length === 0;
    if (activeTab === 'choices' && sections.length === 0) showTab('vitals');
    $('choices-content').innerHTML = sections.map(function (s) {
      if (s.type === 'split') {
        var rows = s.pool.stats.map(function (k) {
          var v = num((s.cur.split || {})[k], 0);
          return '<p>' + k.toUpperCase() + ': <button type="button" onclick="DCC.setSplit(\'' + s.cid + '\',\'' + k + '\',-1,' + s.pool.pool + ')">−</button> ' + v + ' <button type="button" onclick="DCC.setSplit(\'' + s.cid + '\',\'' + k + '\',1,' + s.pool.pool + ')">+</button></p>';
        }).join('');
        return '<div class="card"><strong>Source: ' + esc(s.entry.name) + ' (' + s.kind + ') — +' + s.pool.pool + ' split between ' + s.pool.stats.map(function (k) { return k.toUpperCase(); }).join(', ') + '</strong><p>Assigned ' + s.total + ' / ' + s.pool.pool + '.</p>' + rows + '</div>';
      }
      var cur = s.cur;
      return '<div class="card"><strong>Source: ' + esc(s.entry.name) + ' (' + s.kind + ') — +' + s.grant.amount + ' ' + esc(s.grant.label) + '</strong><br>'
        + '<button type="button" onclick="DCC.openChoicePicker(\'' + s.cid + '\',\'' + s.kind + '\',\'' + esc(s.entry.name) + '\',' + s.grant.amount + ',\'' + s.grant.category + '\')">Pick from rulebook</button> '
        + '<input type="text" placeholder="or custom name" value="' + esc(cur && cur.name ? cur.name : '') + '" onchange="DCC.pickChoice(\'' + s.cid + '\',\'' + s.kind + '\',\'' + esc(s.entry.name) + '\',' + s.grant.amount + ',\'' + s.grant.category + '\',this.value)">'
        + (cur && cur.name ? ' <button type="button" onclick="DCC.pickChoice(\'' + s.cid + '\',\'' + s.kind + '\',\'' + esc(s.entry.name) + '\',' + s.grant.amount + ',\'' + s.grant.category + '\',\'\')">Clear pick</button>' : '')
        + '</div>';
    }).join('') || '<p class="hint">No choices right now.</p>';
  }
  function renderAllPanel(stats) {
    var html = '<p><strong>' + esc(state.name || 'Unnamed Crawler') + '</strong> — Level ' + state.level + ', Floor ' + state.floor + ', ' + esc(state.race || 'no race') + ' / ' + esc(state.class || 'no class') + '</p>';
    html += '<p>Stats: ' + R.STAT_KEYS.map(function (k) { return k.toUpperCase() + ' ' + stats[k].total + ' (+' + stats[k].mod + ')'; }).join(', ') + '</p>';
    html += '<p>Skills: ' + state.skills.filter(function (c) { return cardRank(c) >= 1; }).map(function (c) { return esc(c.name) + ' ' + cardRank(c); }).join(', ') + '</p>';
    html += '<p>Spells: ' + state.spells.filter(function (c) { return cardRank(c) >= 1; }).map(function (c) { return esc(c.name) + ' ' + cardRank(c); }).join(', ') + '</p>';
    html += '<p>Equipped: ' + state.items.filter(function (i) { return i.equipped; }).map(function (i) { return esc(i.name); }).join(', ') + '</p>';
    var st = story();
    html += '<p>Quests active: ' + st.quests.filter(function (q) { return q.status === 'active'; }).length + ' of ' + st.quests.length
      + ' · Journal entries: ' + st.journal.length + ' · Pets: ' + st.pets.length + ' · Mounts: ' + st.mounts.length
      + ' · Sponsors: ' + st.sponsors.length + ' · Crafting: ' + st.crafting.length + '</p>';
    $('all-content').innerHTML = html;
  }

  /* Rank 0 cards are never shown in the Skills/Spells lists: a skill
   * or spell only becomes visible there once it reaches Rank 1. That
   * is why Damage Effects are not listed in Skills at Rank 0 — they
   * first appear there when a successful use raises one to Rank 1.
   * Until then they are offered only in the roll prompt and in the
   * "available" line on attack cards. */
  /* ---------------- item taxonomy migration ----------------
   * One-shot, idempotent: old sheets carry pre-taxonomy kinds
   * (mundane/other/map) and slot labels (Hands, Accessory, Weapon,
   * Other). New sheets already match, so later runs are no-ops.
   * Non-gear items carry no slot; gear with no mappable slot stays
   * unassigned (grandfathered bonuses still apply while equipped,
   * but it cannot be newly equipped until a slot is picked). */
  function migrateItems() {
    var changed = false;
    if (!Array.isArray(state.loadouts)) {
      state.loadouts = [{ id: 'loadout-1', name: 'Loadout 1', placements: {} }, { id: 'loadout-2', name: 'Loadout 2', placements: {} }];
      changed = true;
    }
    if (state.activeLoadoutId && !state.loadouts.some(function (l) { return l.id === state.activeLoadoutId; })) { state.activeLoadoutId = null; changed = true; }
    (state.items || []).forEach(function (it) {
      if (!it.id) { it.id = uid(); changed = true; }
      var nk = R.normalizeKind(it.kind);
      if (it.kind !== nk) { it.kind = nk; changed = true; }
      if (nk !== 'gear') {
        if (it.slot) { it.slot = null; changed = true; }
      } else {
        var ns = R.normalizeSlot(it.slot);
        if (it.slot !== ns) { it.slot = ns; changed = true; }
      }
      if (it.subtype === undefined) { it.subtype = null; changed = true; }
      if (it.placement === undefined) { it.placement = null; changed = true; }
      if (it.use === undefined) { it.use = {}; changed = true; }
    });
    return changed;
  }
  /* Old hotlist entries were plain strings; new entries are refs
   * ({type:'item'|'skill'|'spell', id, name}) or notes. Strings
   * migrate to notes (display-only) so nothing is lost. */
  function migrateHotlist() {
    var changed = false;
    (state.hotlist || []).forEach(function (x, i) {
      if (typeof x === 'string') { state.hotlist[i] = { type: 'note', name: x }; changed = true; }
    });
    return changed;
  }
  function getQty(it) {
    if (!it || it.kind !== 'consumable') return 1;
    var q = it.use ? num(it.use.qty, 1) : 1;
    return Math.max(1, q);
  }
  function pruneHotlistRefs() {
    var before = state.hotlist.length;
    state.hotlist = (state.hotlist || []).filter(function (x) {
      if (!x || x.type === 'note') return true;
      if (x.type === 'item') return state.items.some(function (it) { return it.id === x.id; });
      if (x.type === 'skill') return state.skills.some(function (c) { return c.id === x.id; });
      if (x.type === 'spell') return state.spells.some(function (c) { return c.id === x.id; });
      return true;
    });
    return state.hotlist.length !== before;
  }
  /* Consume one unit: quantity down, or the item leaves the sheet
   * at zero (and its hotlist entry goes with it). */
  function consumeOne(id) {
    var it = state.items.find(function (i) { return i.id === id; });
    if (!it) return;
    var q = getQty(it) - 1;
    if (q <= 0) {
      state.items = state.items.filter(function (i) { return i.id !== id; });
      state.hotlist = (state.hotlist || []).filter(function (x) { return !(x.type === 'item' && x.id === id); });
    } else {
      it.use = it.use || {};
      it.use.qty = q;
    }
    saveSoon(); renderAll();
  }

  /* ---------------- render orchestration ---------------- */
  function renderAll() {
    var mig = migrateItems();
    mig = migrateHotlist() || mig;
    if (mig) saveSoon();
    var stats = computeStats();
    renderSidebar();
    renderCounters(stats);
    // Keywords are needed for Lifebringer's Heal group bonus; load them
    // lazily on first render and re-render once they arrive.
    if (cache.keywords === null) {
      ensureKeywords().then(function (kw) { keywordCache = kw; renderAll(); }).catch(function () {});
    }
    // The race/class library is needed for EVERY derived race/class
    // effect (fixed stats like Human +2 all, split pools, race/class DR,
    // Evade dice, fixed skill bonuses, Choices) — but nothing loaded it
    // on render. Previously it was only loaded when a picker was opened,
    // so on a fresh load of a sheet whose race was already Human, every
    // derived benefit silently computed as zero until a picker was
    // opened. The original sheet could never do this: its library was
    // embedded in the single file. Load it here, same lazy pattern.
    if (cache.races === null) {
      ensureRaces().then(function () { renderAll(); }).catch(function () {});
    }
    if (activeTab === 'vitals') renderVitals(stats);
    else if (activeTab === 'attacks') renderAttacks();
    else if (activeTab === 'gear') renderGear();
    else if (activeTab === 'skills') renderSkills();
    else if (activeTab === 'spells') renderSpells();
    else if (activeTab === 'inventory') renderItems();
    else if (activeTab === 'quests') renderQuests();
    else if (activeTab === 'journal') renderJournal();
    else if (activeTab === 'pets') renderPets();
    else if (activeTab === 'mounts') renderMounts();
    else if (activeTab === 'sponsors') renderSponsors();
    else if (activeTab === 'faith') renderFaith();
    else if (activeTab === 'crafting') renderCrafting();
    else if (activeTab === 'bio') renderBio();
    else if (activeTab === 'choices') renderChoices();
    else if (activeTab === 'all') renderAllPanel(stats);
    renderChoices(); // keeps the Choices tab button visibility current
    // Keep Choices button in sync even when another tab is active.
    var btn = $('choices-tab-btn');
    if (choiceSections().length === 0 && activeTab === 'choices') { /* renderChoices already fell back */ }
    // Deceased lock: a dead crawler's sheet is view-only for its player.
    // Tabs live outside .panel/.sidebar, so they stay clickable and the
    // player can cycle through and see the character; every control that
    // would change it is deadened by CSS instead, and the DM edits
    // through the Inspector. DM mode never locks (the DM has no sheet).
    var deadLocked = !!state.dead && !(window.Cloud && window.Cloud.isDm());
    document.body.classList.toggle('dead-lock', deadLocked);
    var stamp = $('dead-stamp'); if (stamp) stamp.hidden = !deadLocked;
  }
  function showTab(tab) {
    // Tab guards, ported from the original sheet: DM-only tabs fall back to
    // Vitals for non-DMs, and in DM mode every character-sheet tab falls
    // back to the DM Dashboard (DM tabs are dm/manage/inspect/sendbox/
    // sendach, plus Messages, which both sides use; the player Campaign
    // tab is replaced by Management for DMs, and Dead Party member is a
    // player-only tab). The cloud layer refreshes tab content via onTabShown.
    if (window.Cloud) {
      if ((tab === 'dm' || tab === 'manage' || tab === 'inspect' || tab === 'sendbox' || tab === 'sendach') && !window.Cloud.isDm()) tab = 'vitals';
      else if (window.Cloud.isDm() && ['dm', 'manage', 'inspect', 'sendbox', 'sendach', 'messages'].indexOf(tab) === -1) tab = 'dm';
      if (typeof window.Cloud.onTabShown === 'function') window.Cloud.onTabShown(tab);
    }
    activeTab = tab;
    state.activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === tab); });
    document.querySelectorAll('.panel').forEach(function (p) { p.classList.toggle('active', p.id === 'panel-' + tab); });
    saveSoon();
    renderAll();
  }

  /* ---------------- pickers & info modal ---------------- */
  var pickerMode = null; // {type, onPick}
  var pendingUseConfirm = null;
  function openUseConfirm(title, bodyHtml, extraHtml, onConfirm) {
    $('use-confirm-title').textContent = title;
    $('use-confirm-body').innerHTML = bodyHtml;
    $('use-confirm-extra').innerHTML = extraHtml || '';
    pendingUseConfirm = onConfirm;
    $('use-confirm-modal').hidden = false;
  }
  /* Permanent trained-rank increase (skill potions). Unknown skills
   * become known at the boosted rank. */
  function applySkillBoost(skill, bump) {
    var lib = findLib(skill);
    var card = state.skills.find(function (c) { return R.normName(c.name) === R.normName(skill); });
    if (!card) {
      card = { id: uid(), name: lib ? lib.name : skill, kind: 'skill', ownRank: bump, stat: lib && lib.stat ? lib.stat.toLowerCase() : 'str', checkType: 'Active Check', effect: '', used: false, gearGrants: {} };
      state.skills.push(card);
    } else card.ownRank += bump;
  }
  function openPicker(title, candidates, onPick) {
    pickerMode = { onPick: onPick };
    $('picker-title').textContent = title;
    $('picker-search').value = '';
    renderPickerList(candidates);
    $('picker-modal').hidden = false;
    $('picker-search').focus();
  }
  function renderPickerList(candidates) {
    var q = R.normName($('picker-search').value);
    var list = candidates.filter(function (c) {
      return !q || R.normName(c.name).indexOf(q) >= 0 || (c.effect && R.normName(c.effect).indexOf(q) >= 0) || (c.benefits && R.normName(c.benefits).indexOf(q) >= 0);
    });
    $('picker-list').innerHTML = list.map(function (c, i) {
      var idx = candidates.indexOf(c);
      return '<button type="button" class="picker-item" onclick="DCC.pickerPick(' + idx + ')"><strong>' + esc(c.name) + '</strong><small>' + esc(c.kind || '') + (c.source ? ' · ' + c.source : '') + (c.source_book_page ? ' · p.' + c.source_book_page : '') + '</small><small>' + esc((c.base_effect || c.effect || c.benefits || '').slice(0, 160)) + '</small></button>';
    }).join('') || '<p class="hint">No matches.</p>';
    pickerMode.candidates = candidates;
  }
  function pickerPick(idx) {
    var c = pickerMode.candidates[idx];
    $('picker-modal').hidden = true;
    if (pickerMode.onPick) pickerMode.onPick(c);
  }
  function showInfo(title, bodyHtml) {
    $('info-title').textContent = title;
    $('info-body').innerHTML = bodyHtml;
    $('info-modal').hidden = false;
  }
  async function openSkillPicker(kind) {
    var list = await ensureSkills();
    try { await ensureBookChecks(); } catch (e) {}
    var cands = list.filter(function (e) { return kind === 'spell' ? e.kind === 'spell' : e.kind !== 'spell'; });
    openPicker(kind === 'spell' ? 'Pick a spell' : 'Pick a skill', cands, function (c) {
      var list = kind === 'spell' ? state.spells : state.skills;
      var existing = list.find(function (x) { return R.normName(x.name) === R.normName(c.name); });
      if (existing && cardRank(existing) < 1) {
        existing.ownRank = R.ownRankForTotal(1, gearGivenFor(existing), raceGivenFor(existing), groupGivenFor(existing), backgroundGivenFor(existing));
      } else {
        var bc = bookCheckFor(c.name);
        var card = { id: uid(), name: c.name, kind: kind === 'spell' ? 'spell' : 'skill', ownRank: 1, stat: c.stat ? c.stat.toLowerCase() : (kind === 'spell' ? 'int' : 'str'), checkType: (bc && bc.check) || 'Active Check', effect: '', used: false, gearGrants: {} };
        list.push(card);
      }
      saveSoon(); renderAll(); refreshWizard();
    });
  }
  async function openItemPicker() {
    var list = await ensureItems();
    var skills = [];
    try { skills = await ensureSkills(); } catch (e) { skills = []; }
    openPicker('Pick an item', list, function (c) {
      var kind = R.normalizeKind(c.kind);
      var pick = kind === 'consumable' ? R.consumablePickFor(c.name) : null;
      state.items.push({ id: uid(), name: c.name, kind: kind, source: c.source, slot: kind === 'gear' ? R.normalizeSlot(c.gear_slot) : null, subtype: pick ? pick.subtype : null, placement: null, effect: c.effect || '', bonuses: R.parseItemBonuses(c.effect || '', skills), use: pick ? pick.use : {}, equipped: false });
      saveSoon(); renderAll(); refreshWizard();
    });
  }
  /* Custom item creation is a form, not an instant blank row, because
   * kind is required and gear needs a slot / consumables need a type:
   * the form refuses to create until those are chosen. */
  function openItemCreate() {
    $('item-create-name').value = '';
    $('item-create-kind').value = '';
    $('item-create-slot').value = '';
    $('item-create-subtype').value = '';
    $('item-create-freetype').value = '';
    $('item-create-effect').value = '';
    $('item-create-qty').value = '1';
    $('item-create-spell').value = '';
    $('item-create-spellrank').value = '1';
    $('item-create-potionkind').value = 'heal';
    $('item-create-potionamount').value = '';
    $('item-create-potionrounds').value = '';
    $('item-create-potionskill').value = '';
    $('item-create-potionmatch').value = '';
    $('item-create-potionnote').value = '';
    $('item-create-damage').value = '';
    $('item-create-damagetype').value = '';
    $('item-create-blast').value = '';
    $('item-create-splash').value = '';
    $('item-create-bonuses').innerHTML = '';
    syncCreateBonusAdd();
    $('item-create-error').hidden = true;
    syncItemCreateFields();
    $('item-create-modal').hidden = false;
    $('item-create-name').focus();
  }
  /* Bonus rows on the creation form mirror the Inventory bonus
   * editor (same four types, same shapes), collected on Create. */
  function syncCreateBonusRow(row) {
    var type = row.querySelector('.create-bonus-type').value;
    row.querySelector('.create-bonus-stat').style.display = type === 'stat' ? '' : 'none';
    row.querySelector('.create-bonus-skill').style.display = type === 'grant' ? '' : 'none';
    row.querySelector('.create-bonus-kind').style.display = type === 'grant' ? '' : 'none';
  }
  function syncCreateBonusAdd() {
    var btn = $('item-create-bonus-add');
    if (btn) btn.hidden = document.querySelectorAll('#item-create-bonuses .create-bonus-row').length >= 5;
  }
  function addCreateBonusRow() {
    var box = $('item-create-bonuses');
    if (box.querySelectorAll('.create-bonus-row').length >= 5) return;
    var row = document.createElement('div');
    row.className = 'bonus-row create-bonus-row';
    row.innerHTML = '<select class="create-bonus-type"><option value="stat">Stat bonus</option><option value="grant">Skill grant</option><option value="dr">Damage Resistance</option><option value="evade">Evade</option></select>'
      + '<select class="create-bonus-stat">' + R.STAT_KEYS.map(function (k) { return '<option value="' + k + '">' + k.toUpperCase() + '</option>'; }).join('') + '</select>'
      + '<input type="text" class="create-bonus-skill" placeholder="Skill/spell name" style="display:none">'
      + '<select class="create-bonus-kind" style="display:none"><option value="skill">skill</option><option value="spell">spell</option></select>'
      + '<label>Amount <input type="number" class="create-bonus-amount" value="0"></label>'
      + '<button type="button" class="create-bonus-remove">Remove bonus</button>';
    row.querySelector('.create-bonus-type').addEventListener('change', function () { syncCreateBonusRow(row); });
    row.querySelector('.create-bonus-remove').addEventListener('click', function () { row.remove(); syncCreateBonusAdd(); });
    box.appendChild(row);
    syncCreateBonusRow(row);
    syncCreateBonusAdd();
  }
  function syncItemCreateFields() {
    var k = $('item-create-kind').value;
    var sub = $('item-create-subtype').value;
    $('item-create-gear').hidden = k !== 'gear';
    $('item-create-consumable').hidden = k !== 'consumable';
    $('item-create-freetype').hidden = !(k === 'coupon' || k === 'material');
    var cons = k === 'consumable';
    $('item-create-qtygroup').hidden = !cons;
    $('item-create-spellgroup').hidden = !(cons && (sub === 'Scroll' || sub === 'Spellbook'));
    $('item-create-potiongroup').hidden = !(cons && sub === 'Potion');
    $('item-create-damagegroup').hidden = !(cons && sub === 'Explosive');
    if (cons && sub === 'Potion') {
      var pk = $('item-create-potionkind').value;
      $('item-create-potionamount-wrap').hidden = !(pk === 'heal' || pk === 'manaOverTime' || pk === 'skillBoost');
      $('item-create-potionrounds-wrap').hidden = pk !== 'manaOverTime';
      $('item-create-potionskill-wrap').hidden = pk !== 'skillBoost';
      $('item-create-potionmatch-wrap').hidden = pk !== 'removeDebuff';
      $('item-create-potionnote-wrap').hidden = pk !== 'heal';
    }
  }
  function createCustomItem() {
    var name = $('item-create-name').value.trim();
    var kind = $('item-create-kind').value;
    var err = $('item-create-error');
    function fail(msg) { err.textContent = msg; err.hidden = false; }
    if (!name) return fail('Give the item a name first.');
    if (!kind) return fail('Choose a category: Gear, Consumable, Coupon, or Material/Misc.');
    var slot = null, subtype = null;
    if (kind === 'gear') {
      slot = $('item-create-slot').value || null;
      if (!slot) return fail('Gear needs a slot: Head, Torso, Arms, Hands/Gloves, Hands/Holding, Weapon 1 Hand, Weapon 2 Hand, Legs, Feet, or Accessories.');
    } else if (kind === 'consumable') {
      /* Subtype is optional: blank means a general consumable (e.g.
       * bandages), used from its effect text. The subtypes that need
       * data validate their fields below. */
      subtype = $('item-create-subtype').value || null;
    } else {
      subtype = $('item-create-freetype').value.trim() || null;
    }
    var bonuses = [];
    var bonusErr = null;
    document.querySelectorAll('#item-create-bonuses .create-bonus-row').forEach(function (row) {
      if (bonusErr) return;
      var type = row.querySelector('.create-bonus-type').value;
      var amount = num(row.querySelector('.create-bonus-amount').value, 0);
      if (type === 'stat') bonuses.push({ type: 'stat', stat: row.querySelector('.create-bonus-stat').value, amount: amount });
      else if (type === 'grant') {
        var skill = row.querySelector('.create-bonus-skill').value.trim();
        if (!skill) { bonusErr = 'Give the skill grant a skill/spell name.'; return; }
        bonuses.push({ type: 'grant', skillName: skill, kind: row.querySelector('.create-bonus-kind').value, amount: amount });
      }
      else if (type === 'dr') bonuses.push({ type: 'dr', amount: amount });
      else if (type === 'evade') bonuses.push({ type: 'evade', amount: amount });
    });
    if (bonusErr) return fail(bonusErr);
    var use = {};
    if (kind === 'consumable') {
      use.qty = Math.max(1, num($('item-create-qty').value, 1));
      if (subtype === 'Scroll' || subtype === 'Spellbook') {
        var spell = $('item-create-spell').value.trim();
        if (!spell) return fail('Scrolls and spellbooks need a designated spell.');
        use.spell = spell;
        use.spellRank = Math.max(1, num($('item-create-spellrank').value, 1));
      } else if (subtype === 'Potion') {
        var pk = $('item-create-potionkind').value;
        use.potionKind = pk;
        if (pk === 'heal' || pk === 'manaOverTime' || pk === 'skillBoost') {
          var amt = $('item-create-potionamount').value.trim();
          if (amt === '' || num(amt, 0) < 0) return fail('Give this potion an amount.');
          use.potionAmount = num(amt, 0);
        }
        if (pk === 'manaOverTime') {
          var rnd = $('item-create-potionrounds').value.trim();
          if (rnd === '' || num(rnd, 0) < 1) return fail('Give this potion a number of rounds.');
          use.potionRounds = num(rnd, 1);
        }
        if (pk === 'skillBoost') use.potionSkill = $('item-create-potionskill').value.trim() || null;
        if (pk === 'removeDebuff') {
          var m = $('item-create-potionmatch').value.trim();
          if (!m) return fail('Say which debuff this potion removes, e.g. poison.');
          use.potionMatch = m;
        }
        if (pk === 'heal') use.potionNote = $('item-create-potionnote').value.trim() || null;
      } else if (subtype === 'Explosive') {
        var dmg = $('item-create-damage').value.trim();
        if (!dmg) return fail('Explosives need a damage formula, e.g. 2d6.');
        use.damage = dmg;
        use.damageType = $('item-create-damagetype').value.trim() || null;
        use.blast = $('item-create-blast').value.trim() || null;
        use.splash = $('item-create-splash').value.trim() || null;
      }
    }
    state.items.push({ id: uid(), name: name, kind: kind, slot: slot, subtype: subtype, effect: $('item-create-effect').value.trim(), bonuses: bonuses, use: use, equipped: false, placement: null });
    $('item-create-modal').hidden = true;
    saveSoon(); renderAll(); showTab('inventory');
  }
  async function openRaceClassPicker(kind) {
    var list = await ensureRaces();
    openPicker(kind === 'race' ? 'Pick a race' : 'Pick a class', list.filter(function (e) { return e.kind === kind; }), function (c) {
      setRaceClass(kind, c.name);
    });
  }
  async function showRaceClassInfo(kind) {
    var name = kind === 'race' ? state.race : state.class;
    if (!name) { alert('No ' + kind + ' selected yet.'); return; }
    var list = await ensureRaces();
    var entry = list.find(function (e) { return e.kind === kind && R.normName(e.name) === R.normName(name); });
    if (!entry) { alert('No rulebook entry found for ' + name + '.'); return; }
    showInfo(entry.name + ' (' + kind + ')', '<p>' + esc(entry.benefits || '') + '</p>'
      + (entry.prerequisites ? '<p><strong>Prerequisites:</strong> ' + esc(entry.prerequisites) + '</p>' : '')
      + (entry.source_book_page ? '<p>Book p.' + entry.source_book_page + '</p>' : '')
      + '<p class="hint">Text shown here is book text for reference. Only the auto-applied effects listed in the README are applied automatically; everything else is shown, not auto-applied.</p>');
  }
  var choiceGrantByCid = {};
  function openChoicePicker(cid, kind, sourceName, amount, category) {
    var grant = choiceGrantByCid[cid];
    ensureSkills().then(function (list) {
      var cands;
      if (grant && grant.options) {
        cands = grant.options.map(function (n) {
          var lib = findLib(n);
          return lib || { name: n, kind: category === 'spell' ? 'spell' : 'utility', base_effect: 'Custom / choice option (not a Chapter 4 library entry, or matched by name).' };
        });
      } else if (category === 'spell') {
        cands = list.filter(function (e) { return e.kind === 'spell'; });
      } else if (category === 'weapon') {
        cands = list.filter(function (e) { return e.kind === 'attack'; });
      } else {
        cands = list.filter(function (e) { return e.kind !== 'spell'; });
      }
      openPicker('Pick a choice for ' + sourceName, cands, function (c) {
        setChoice(cid, kind, sourceName, grant || { amount: amount, category: category }, 0, c.name);
      });
    });
  }

  /* ---------------- distribute dialog ---------------- */
  var distAlloc = { str: 0, con: 0, dex: 0, int: 0, cha: 0 };
  function openDistribute() {
    distAlloc = { str: 0, con: 0, dex: 0, int: 0, cha: 0 };
    renderDistribute();
    $('distribute-modal').hidden = false;
  }
  function renderDistribute() {
    var bank = R.statBank(state.level, state.statPointsSpent);
    var used = 0;
    R.STAT_KEYS.forEach(function (k) { used += distAlloc[k]; });
    $('dist-remaining').textContent = bank - used;
    $('dist-rows').innerHTML = R.STAT_KEYS.map(function (k) {
      return '<p>' + k.toUpperCase() + ' (own base ' + state.ownBase[k] + '): <button type="button" onclick="DCC.distStep(\'' + k + '\',-1)">−</button> ' + distAlloc[k] + ' <button type="button" onclick="DCC.distStep(\'' + k + '\',1)">+</button></p>';
    }).join('');
  }
  function distStep(key, delta) {
    var bank = R.statBank(state.level, state.statPointsSpent);
    var used = 0;
    R.STAT_KEYS.forEach(function (k) { used += distAlloc[k]; });
    if (delta > 0 && used >= bank) return;
    distAlloc[key] = Math.max(0, distAlloc[key] + delta);
    renderDistribute();
  }

  /* ---------------- dice + rest ---------------- */
  var lastRollText = '';
  function showRoll(text) {
    lastRollText = text;
    var el = $('roll-result');
    if (el) el.textContent = text;
    // The Dice Tray lives on the Vitals tab, so a roll made from the
    // Skills, Spells, or Attacks tab used to show nothing at all until
    // the player switched back to Vitals — which reads as a dead
    // button. Show the result immediately, on whatever tab is open,
    // as a dismissible toast; the Dice Tray keeps the same result for
    // later, and Copy result still copies it from there.
    var toast = $('roll-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'roll-toast';
      toast.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#141414;color:#f2f2ec;padding:10px 16px;border:1px solid #a855f7;border-radius:8px;z-index:9999;max-width:92vw;text-align:center;';
      document.body.appendChild(toast);
    }
    toast.innerHTML = '';
    var span = document.createElement('span');
    span.textContent = text;
    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Dismiss';
    close.style.marginLeft = '12px';
    close.addEventListener('click', function () { if (toast.parentNode) toast.parentNode.removeChild(toast); });
    toast.appendChild(span);
    toast.appendChild(close);
  }
  function rollD20Check(label, mod) {
    var die = R.rollDie(20);
    showRoll(label + ': d20 + ' + mod + ' = ' + die + ' + ' + mod + ' = ' + (die + mod));
  }
  function doRest(type, label) {
    var maxMana = R.maxMana(computeStats().int.total);
    var beforeHp = state.hpCurrent, beforeMana = state.manaCurrent, beforeDebuffs = state.debuffs.slice();
    var res = R.applyRest(type, state.hpCurrent, state.manaCurrent, maxMana, state.debuffs);
    state.hpCurrent = res.hp; state.manaCurrent = res.mana; state.debuffs = res.debuffs;
    var ended = beforeDebuffs.filter(function (d) { return res.debuffs.indexOf(d) < 0; });
    var msg = label + ': Health ' + beforeHp + ' → ' + res.hp + ' slots, Mana ' + beforeMana + ' → ' + res.mana
      + (ended.length ? ', ended: ' + ended.join(', ') : ', no injuries ended');
    var el = $('rest-result');
    if (el) el.textContent = msg;
    saveSoon(); renderAll();
    if (el) el.textContent = msg; // renderAll rebuilds Vitals text, not this line, but keep it safe
  }

  /* ---------------- public API (used by inline handlers & wizard) ---------------- */
  window.DCC = {
    getState: function () { return state; },
    baseTotal: function () { var st = computeStats(); return R.STAT_KEYS.reduce(function (a, k) { return a + st[k].derived; }, 0); },
    syncGearGrants: syncGearGrants, ensureUnarmed: ensureUnarmed,
    setState: function (s) { state = s; },
    blankState: blankState,
    renderAll: renderAll, showTab: showTab, saveNow: saveNow, saveSoon: saveSoon,
    ensureSkills: ensureSkills, ensureItems: ensureItems, ensureRaces: ensureRaces, ensureKeywords: ensureKeywords,
    findLib: findLib, cardRank: cardRank, remoteCardRank: remoteCardRank, setRaceClass: setRaceClass, choiceSections: choiceSections,
    getExportData: getExportData,
    openSkillPicker: openSkillPicker, openItemPicker: openItemPicker, openRaceClassPicker: openRaceClassPicker,
    showRaceClassInfo: showRaceClassInfo, openChoicePicker: openChoicePicker, pickerPick: pickerPick,
    setOwnBase: setOwnBase, setOwnEnh: setOwnEnh, setEnhTotal: setEnhTotal,
    setCardOpen: function (id, open) {
      // Collapsed by default; a card the user opened stays open on reload.
      // No re-render here: re-rendering would rebuild the element mid-toggle.
      state.cardOpen = state.cardOpen || {};
      if (open) state.cardOpen[id] = true; else delete state.cardOpen[id];
      saveSoon();
    },
    levelDelta: function (delta) {
      state.level = Math.max(1, Math.min(250, state.level + delta));
      saveSoon(); renderAll();
    },
    floorDelta: function (delta) {
      state.floor = Math.max(1, state.floor + delta);
      saveSoon(); renderAll();
    },
    killDelta: function (which, delta) {
      // Boss/Player kills are raised one at a time (a kill is an event,
      // not a number to type); the number input stays for corrections.
      if (which === 'boss') state.bossKills = Math.max(0, state.bossKills + delta);
      else state.pkKills = Math.max(0, state.pkKills + delta);
      saveSoon(); renderAll();
    },
    setRank: function (kind, id, value) {
      var list = kind === 'spell' ? state.spells : state.skills;
      var card = list.find(function (c) { return c.id === id; });
      if (!card) return;
      card.ownRank = R.ownRankForTotal(num(value, 1), gearGivenFor(card), raceGivenFor(card), groupGivenFor(card), backgroundGivenFor(card));
      saveSoon(); renderAll();
    },
    setCardStat: function (kind, id, value) {
      var list = kind === 'spell' ? state.spells : state.skills;
      var card = list.find(function (c) { return c.id === id; });
      if (card) { card.stat = value; saveSoon(); renderAll(); }
    },
    setCardCheck: function (kind, id, value) {
      var list = kind === 'spell' ? state.spells : state.skills;
      var card = list.find(function (c) { return c.id === id; });
      if (card) { card.checkType = value; saveSoon(); renderAll(); }
    },
    setCardEffect: function (kind, id, value) {
      var list = kind === 'spell' ? state.spells : state.skills;
      var card = list.find(function (c) { return c.id === id; });
      if (card) { card.effect = value; saveSoon(); }
    },
    renameCard: function (kind, id, value) {
      var list = kind === 'spell' ? state.spells : state.skills;
      var card = list.find(function (c) { return c.id === id; });
      if (card && value.trim()) { card.name = value.trim(); saveSoon(); renderAll(); }
    },
    toggleUsed: function (kind, id, checked) {
      var list = kind === 'spell' ? state.spells : state.skills;
      var card = list.find(function (c) { return c.id === id; });
      // Re-render like every other card control: the (Used) suffix in the
      // card header is only recomputed on render, so without this it
      // stayed hidden until the next reload.
      if (card) { card.used = checked; saveSoon(); renderAll(); }
    },
    delCard: function (kind, id) {
      // Manual delete is blocked while a source still gives the card:
      // a bonus-granted card is removed by removing its source, not here.
      var list = kind === 'spell' ? state.spells : state.skills;
      var card = list.find(function (c) { return c.id === id; });
      if (!card) return;
      if (cardFloor(card) > 0) { alert('This card is granted by a background, race, class, choice, or equipped item. Remove that source (or unequip the item) to remove the card.'); return; }
      if (kind === 'spell') state.spells = state.spells.filter(function (c) { return c.id !== id; });
      else state.skills = state.skills.filter(function (c) { return c.id !== id; });
      saveSoon(); renderAll();
    },
    delAttack: function (id) { state.attacks = state.attacks.filter(function (a) { return a.id !== id; }); saveSoon(); renderAll(); },
    addLootItem: function (item, qty) {
      var n = Math.max(1, parseInt(qty, 10) || 1);
      var bonuses = (item.bonuses || []).map(function (b) {
        var amount = parseInt(b.amount, 10) || 0;
        if (b.type === 'stat') return { type: 'stat', stat: (b.stat || 'str').toLowerCase(), amount: amount };
        if (b.type === 'grant') return { type: 'grant', skillName: b.skill || '', kind: 'skill', amount: amount };
        if (b.type === 'dr') return { type: 'dr', amount: amount };
        if (b.type === 'evade') return { type: 'evade', amount: amount };
        return { type: 'stat', stat: 'str', amount: amount };
      }).slice(0, 5);
      // DM-sent items now carry the same taxonomy as player-created
      // ones (kind/slot/subtype/use from the Send Box form); loot rows
      // sent before that change have none and arrive as Material/Misc.
      var lootKind = item.kind ? R.normalizeKind(item.kind) : 'material';
      if (lootKind === 'consumable') {
        // Consumables stack: one entry carrying the quantity, so
        // using it can count down and remove it at zero.
        var useIn = item.use || {};
        state.items.push({ id: uid(), name: item.name, kind: 'consumable', slot: null, subtype: item.subtype || null, placement: null, effect: item.notes || '', bonuses: JSON.parse(JSON.stringify(bonuses)), use: Object.assign({}, useIn, { qty: n }), equipped: false });
      } else {
        for (var i = 0; i < n; i++) state.items.push({ id: uid(), name: item.name, kind: lootKind, slot: lootKind === 'gear' ? (item.slot ? R.normalizeSlot(item.slot) : null) : null, subtype: item.subtype || null, placement: null, effect: item.notes || '', bonuses: JSON.parse(JSON.stringify(bonuses)), use: {}, equipped: false });
      }
      syncGearGrants(); saveSoon(); renderAll();
    },
    delItem: function (id) {
      var doomed = state.items.find(function (i) { return i.id === id; });
      if (doomed && doomed.equipped) clearActiveLoadout();
      state.items = state.items.filter(function (i) { return i.id !== id; });
      syncGearGrants(); saveSoon(); renderAll();
    },
    renameItem: function (id, value) {
      var it = state.items.find(function (i) { return i.id === id; });
      if (it && value.trim()) { it.name = value.trim(); syncGearGrants(); saveSoon(); renderAll(); }
    },
    setItemKind: function (id, value) {
      var it = state.items.find(function (i) { return i.id === id; });
      if (!it) return;
      it.kind = value;
      if (value !== 'gear') {
        it.slot = null;
        if (it.equipped) { R.unequip(state.items, id); clearActiveLoadout(); }
      }
      syncGearGrants(); saveSoon(); renderAll();
    },
    setItemSlot: function (id, value) {
      var it = state.items.find(function (i) { return i.id === id; });
      if (!it) return;
      var nv = value || null;
      // Changing the slot of an equipped item unequips it: its old
      // placement no longer means anything, and silently keeping it
      // equipped could break another slot's limit.
      if (it.equipped && it.slot !== nv) { R.unequip(state.items, id); clearActiveLoadout(); }
      it.slot = nv;
      syncGearGrants(); saveSoon(); renderAll();
    },
    setItemSubtype: function (id, value) {
      var it = state.items.find(function (i) { return i.id === id; });
      if (it) { it.subtype = value || null; saveSoon(); renderAll(); }
    },
    setInvKindFilter: function (k) { invKindFilter = k; renderAll(); },
    setEquipped: function (id, on) {
      if (on) { this.equipFirstFree(id); return; }
      R.unequip(state.items, id);
      clearActiveLoadout();
      syncGearGrants(); saveSoon(); renderAll();
    },
    equipFirstFree: function (id) {
      var it = state.items.find(function (i) { return i.id === id; });
      if (!it) return;
      if (it.kind !== 'gear') { alert('Only gear can be equipped.'); return; }
      if (!it.slot) { alert('Assign a slot to this gear first (Inventory).'); return; }
      var free = R.freePlacement(state.items, it.slot);
      if (!free) { alert(it.slot === 'Weapon 2 Hand' ? 'A 2 Hand weapon needs both hands free.' : it.slot + ' is full. Unequip something there first, or use a loadout.'); return; }
      this.equipIntoPlacement(id, free);
    },
    equipIntoPlacement: function (id, placement) {
      var err = R.equipInto(state.items, id, placement);
      if (err) { alert(err); return; }
      clearActiveLoadout();
      syncGearGrants(); saveSoon(); renderAll();
    },
    openSlotPicker: function (placement) {
      var fam = R.placementFamily(placement);
      var placed = R.derivePlacements(state.items);
      var cands = state.items.filter(function (it) {
        if (it.kind !== 'gear' || it.equipped) return false;
        if (fam === 'Hands/Holding') {
          if (R.slotFamily(it.slot) !== 'Hands/Holding') return false;
          // A 2 Hand weapon needs both hands free: if the other hand
          // is taken, it cannot be picked from this box.
          if (it.slot === 'Weapon 2 Hand') {
            var other = placement === 'Right Hand' ? 'Left Hand' : 'Right Hand';
            var otherTaken = Object.keys(placed).some(function (id) { return placed[id] === other || placed[id] === 'Both Hands'; });
            if (otherTaken) return false;
          }
          return true;
        }
        return it.slot === fam;
      });
      if (!cands.length) { alert('Nothing in your inventory fits ' + fam + '. Add or pick an item with that slot first.'); return; }
      openPicker('Equip ' + placement, cands, function (c) {
        // Picking a 2 Hand weapon from a hand box equips it across both hands.
        if (c.slot === 'Weapon 2 Hand') this.equipIntoPlacement(c.id, 'Both Hands');
        else this.equipIntoPlacement(c.id, placement);
      }.bind(this));
    },
    catalogSearch: function (input) {
      var block = input.closest('.catalog-slot');
      if (!block) return;
      var q = input.value.trim().toLowerCase();
      block.querySelectorAll('.catalog-row').forEach(function (row) {
        row.hidden = !!q && row.getAttribute('data-name').indexOf(q) < 0;
      });
    },
    catalogSort: function (select) {
      var block = select.closest('.catalog-slot');
      if (!block) return;
      var box = block.querySelector('.catalog-rows');
      var rows = Array.prototype.slice.call(box.querySelectorAll('.catalog-row'));
      rows.sort(function (a, b) {
        if (select.value === 'bonus') {
          var d = parseInt(b.getAttribute('data-bonus'), 10) - parseInt(a.getAttribute('data-bonus'), 10);
          if (d) return d;
        }
        return a.getAttribute('data-name').localeCompare(b.getAttribute('data-name'));
      });
      rows.forEach(function (r) { box.appendChild(r); });
      var input = block.querySelector('input[type="text"]');
      if (input) this.catalogSearch(input);
    },
    applyLoadout: function (id) {
      var l = (state.loadouts || []).find(function (x) { return x.id === id; });
      if (!l) return;
      state.items.forEach(function (it) { it.equipped = false; it.placement = null; });
      var skipped = 0;
      Object.keys(l.placements || {}).forEach(function (placement) {
        var it = state.items.find(function (x) { return x.id === l.placements[placement]; });
        if (!it || it.kind !== 'gear' || !R.placementFitsItem(placement, it.slot)) { skipped++; return; }
        it.equipped = true; it.placement = placement;
      });
      state.activeLoadoutId = id;
      syncGearGrants(); saveSoon(); renderAll();
      if (skipped) alert('Loadout applied. ' + skipped + ' item(s) skipped (no longer in inventory, or their slot changed).');
    },
    saveLoadout: function (id) {
      var l = (state.loadouts || []).find(function (x) { return x.id === id; });
      if (!l) return;
      var placed = R.derivePlacements(state.items);
      var map = {};
      Object.keys(placed).forEach(function (itemId) { if (placed[itemId]) map[placed[itemId]] = itemId; });
      l.placements = map;
      state.activeLoadoutId = id;
      saveSoon(); renderAll();
    },
    renameLoadout: function (id, value) {
      var l = (state.loadouts || []).find(function (x) { return x.id === id; });
      if (l && value.trim()) { l.name = value.trim(); saveSoon(); renderAll(); }
    },
    delLoadout: function (id) {
      state.loadouts = (state.loadouts || []).filter(function (x) { return x.id !== id; });
      if (state.activeLoadoutId === id) state.activeLoadoutId = null;
      saveSoon(); renderAll();
    },
    addLoadout: function () {
      if ((state.loadouts || []).length >= 5) { alert('Up to 5 loadouts.'); return; }
      state.loadouts.push({ id: uid(), name: 'Loadout ' + ((state.loadouts || []).length + 1), placements: {} });
      saveSoon(); renderAll();
    },
    addBonus: function (id) {
      var it = state.items.find(function (i) { return i.id === id; });
      if (it && (it.bonuses || []).length < 5) { it.bonuses.push({ type: 'stat', stat: 'str', amount: 0 }); saveSoon(); renderAll(); }
    },
    delBonus: function (id, bi) {
      var it = state.items.find(function (i) { return i.id === id; });
      if (it) { it.bonuses.splice(bi, 1); syncGearGrants(); saveSoon(); renderAll(); }
    },
    setBonusType: function (id, bi, v) {
      var it = state.items.find(function (i) { return i.id === id; });
      if (it && it.bonuses[bi]) { it.bonuses[bi].type = v; syncGearGrants(); saveSoon(); renderAll(); }
    },
    setBonusStat: function (id, bi, v) {
      var it = state.items.find(function (i) { return i.id === id; });
      if (it && it.bonuses[bi]) { it.bonuses[bi].stat = v; saveSoon(); renderAll(); }
    },
    setBonusSkill: function (id, bi, v) {
      var it = state.items.find(function (i) { return i.id === id; });
      if (it && it.bonuses[bi]) { it.bonuses[bi].skillName = v; syncGearGrants(); saveSoon(); renderAll(); }
    },
    setBonusKind: function (id, bi, v) {
      var it = state.items.find(function (i) { return i.id === id; });
      if (it && it.bonuses[bi]) { it.bonuses[bi].kind = v; syncGearGrants(); saveSoon(); renderAll(); }
    },
    setBonusAmount: function (id, bi, v) {
      var it = state.items.find(function (i) { return i.id === id; });
      if (it && it.bonuses[bi]) { it.bonuses[bi].amount = num(v, 0); syncGearGrants(); saveSoon(); renderAll(); }
    },
    setSplit: setSplit,
    pickChoice: function (cid, kind, sourceName, amount, category, name) {
      var grant = choiceGrantByCid[cid] || { amount: amount, category: category };
      setChoice(cid, kind, sourceName, grant, 0, name);
    },
    delNote: function (kind, i) {
      if (kind === 'buff') state.buffs.splice(i, 1); else state.debuffs.splice(i, 1);
      saveSoon(); renderAll();
    },
    delHotlist: function (i) { state.hotlist.splice(i, 1); saveSoon(); renderAll(); },
    openHotlistPicker: function (type) {
      var cands = [];
      var title = '';
      if (type === 'item') { cands = state.items.filter(function (it) { return it.kind === 'consumable'; }); title = 'Add a consumable to the hotlist'; }
      else if (type === 'skill') { cands = state.skills.filter(function (c) { return cardRank(c) >= 1; }); title = 'Add a skill to the hotlist'; }
      else { cands = state.spells.filter(function (c) { return cardRank(c) >= 1; }); title = 'Add a spell to the hotlist'; }
      if (!cands.length) { alert(type === 'item' ? 'No consumables in your inventory.' : 'No known ' + type + 's yet.'); return; }
      openPicker(title, cands, function (c) {
        if (state.hotlist.length >= 10) { alert('Hotlist holds up to 10 entries.'); return; }
        if (state.hotlist.some(function (x) { return x.type === type && x.id === c.id; })) { alert('Already on the hotlist.'); return; }
        state.hotlist.push({ type: type, id: c.id, name: c.name });
        saveSoon(); renderAll();
      });
    },
    setItemUseField: function (id, field, value) {
      var it = state.items.find(function (i) { return i.id === id; });
      if (!it) return;
      it.use = it.use || {};
      if (field === 'qty') it.use.qty = Math.max(1, num(value, 1));
      else if (field === 'spellRank') it.use.spellRank = Math.max(1, num(value, 1));
      else if (field === 'potionAmount') it.use.potionAmount = Math.max(0, num(value, 0));
      else if (field === 'potionRounds') it.use.potionRounds = Math.max(1, num(value, 1));
      else it.use[field] = (typeof value === 'string' ? value.trim() : value) || null;
      saveSoon(); renderAll();
    },
    /* Using a consumable: a confirmation window shows the effect
     * being applied first; confirming applies it, then drops the
     * quantity by one (removing the item at zero). */
    useConsumable: function (id) {
      var it = state.items.find(function (i) { return i.id === id; });
      if (!it) return;
      if (it.kind !== 'consumable') { alert('Only consumables can be used.'); return; }
      var use = it.use || {};
      var qtyNote = getQty(it) > 1 ? ' (' + getQty(it) + ' in inventory; one will be used)' : '';
      function done() { consumeOne(id); }
      /* Spellbook: the spell joins the known Spells at the book's rank. */
      if (it.subtype === 'Spellbook' && use.spell) {
        var rank = Math.max(1, num(use.spellRank, 1));
        var known = state.spells.find(function (c) { return R.normName(c.name) === R.normName(use.spell); });
        if (known && known.ownRank >= rank) { alert(use.spell + ' is already known at Rank ' + known.ownRank + ' or higher, so this book would teach nothing new.'); return; }
        var lib = findLib(use.spell);
        openUseConfirm('Use ' + it.name, '<p><strong>' + esc(use.spell) + ' learned at Rank ' + rank + '.</strong> The spell joins your known Spells; the book is consumed.' + qtyNote + '</p>' + (lib ? '<p class="hint">' + esc(lib.base_effect || lib.effect || '') + '</p>' : ''), '', function () {
          var card = state.spells.find(function (c) { return R.normName(c.name) === R.normName(use.spell); });
          if (!card) {
            card = { id: uid(), name: lib ? lib.name : use.spell, kind: 'spell', ownRank: rank, stat: lib && lib.stat ? lib.stat.toLowerCase() : 'int', checkType: 'Active Check', effect: '', used: false, gearGrants: {} };
            state.spells.push(card);
          } else if (card.ownRank < rank) card.ownRank = rank;
          done();
        });
        return;
      }
      /* Scroll: one-shot cast, no Mana, spell NOT learned (book: the
       * scroll turns to dust after use). */
      if (it.subtype === 'Scroll' && use.spell) {
        var srank = Math.max(1, num(use.spellRank, 1));
        var slib = findLib(use.spell);
        openUseConfirm('Use ' + it.name, '<p><strong>' + esc(use.spell) + ' (Rank ' + srank + ') cast.</strong> One-shot, no Mana cost; the spell is NOT added to your known Spells. The scroll turns to dust.' + qtyNote + '</p>' + (slib ? '<p class="hint">' + esc(slib.base_effect || slib.effect || '') + '</p>' : ''), '', done);
        return;
      }
      /* Potions: what the sheet can apply mechanically, it does. */
      if (it.subtype === 'Potion' && use.potionKind) {
        var pk = use.potionKind;
        if (pk === 'heal') {
          var n = Math.max(0, num(use.potionAmount, 0));
          var before = state.hpCurrent;
          var after = Math.min(10, before + n);
          openUseConfirm('Use ' + it.name, '<p><strong>Heals ' + n + ' Health Bar slots (' + before + ' → ' + after + ').</strong>' + qtyNote + '</p>' + (use.potionNote ? '<p>' + esc(use.potionNote) + ' — apply that part with your DM.</p>' : ''), '', function () { state.hpCurrent = after; done(); });
          return;
        }
        if (pk === 'manaFull') {
          var maxM = R.maxMana(computeStats().int.total);
          openUseConfirm('Use ' + it.name, '<p><strong>Fully restores Mana (' + state.manaCurrent + ' → ' + maxM + ').</strong>' + qtyNote + '</p>', '', function () { state.manaCurrent = maxM; done(); });
          return;
        }
        if (pk === 'manaOverTime') {
          var amt = Math.max(0, num(use.potionAmount, 0));
          var rounds = Math.max(1, num(use.potionRounds, 1));
          openUseConfirm('Use ' + it.name, '<p><strong>Restores ' + amt + ' Mana per round for ' + rounds + ' rounds.</strong> Added to your Buffs — track the rounds with your DM.' + qtyNote + '</p>', '', function () { state.buffs.push('Mana Refill: +' + amt + ' Mana/round for ' + rounds + ' rounds'); done(); });
          return;
        }
        if (pk === 'skillBoost') {
          var bump = Math.max(0, num(use.potionAmount, 0));
          var skill = (use.potionSkill || '').trim();
          if (skill) {
            var sc = state.skills.find(function (c) { return R.normName(c.name) === R.normName(skill); });
            var newRank = (sc ? sc.ownRank : 0) + bump;
            openUseConfirm('Use ' + it.name, '<p><strong>' + esc(skill) + ' permanently +' + bump + ' (trained rank ' + (sc ? sc.ownRank : 0) + ' → ' + newRank + ').</strong>' + qtyNote + '</p>', '', function () { applySkillBoost(skill, bump); done(); });
          } else {
            var knownSkills = state.skills.filter(function (c) { return cardRank(c) >= 1; });
            var extra = knownSkills.length
              ? '<label>Skill <select id="use-confirm-skill">' + knownSkills.map(function (c) { return '<option>' + esc(c.name) + '</option>'; }).join('') + '</select></label>'
              : '<label>Skill <input type="text" id="use-confirm-skill" placeholder="Skill name"></label>';
            openUseConfirm('Use ' + it.name, '<p><strong>One Skill permanently +' + bump + '.</strong> Pick which one.' + qtyNote + '</p>', extra, function () {
              var chosen = $('use-confirm-skill') ? $('use-confirm-skill').value.trim() : '';
              if (!chosen) { alert('Pick a skill first.'); return; }
              applySkillBoost(chosen, bump); done();
            });
          }
          return;
        }
        if (pk === 'healPet') {
          openUseConfirm('Use ' + it.name, '<p><strong>Heals ' + Math.max(0, num(use.potionAmount, 0)) + ' Health Bar slots on a pet.</strong> Pets do not track current HP on this sheet, so apply it to the pet with your DM.' + qtyNote + '</p>', '', done);
          return;
        }
        if (pk === 'removeDebuff') {
          var match = (use.potionMatch || '').trim();
          if (!match) { alert('This potion does not say which debuff it removes. Set it in Inventory first.'); return; }
          openUseConfirm('Use ' + it.name, '<p><strong>Removes debuffs mentioning "' + esc(match) + '".</strong>' + qtyNote + '</p>', '', function () {
            var ml = match.toLowerCase();
            state.debuffs = state.debuffs.filter(function (d) { return String(d).toLowerCase().indexOf(ml) < 0; });
            done();
          });
          return;
        }
        if (pk === 'food') {
          openUseConfirm('Use ' + it.name, '<p><strong>Eaten.</strong> Food for crawlers; no mechanical effect on the sheet.' + qtyNote + '</p>' + (it.effect ? '<p class="hint">' + esc(it.effect) + '</p>' : ''), '', done);
          return;
        }
        /* potionKind 'other': falls through to the generic confirmation. */
      }
      /* Explosives: show the damage formula (book area rules: the
       * blast area takes full damage, the splash zone takes half). */
      if (it.subtype === 'Explosive' && use.damage) {
        var dmgLine = '<strong>' + esc(use.damage) + (use.damageType ? ' ' + esc(use.damageType) : '') + ' damage</strong>';
        if (use.blast) dmgLine += ' · Blast ' + esc(use.blast) + ' (full damage)';
        if (use.splash) dmgLine += ' · Splash ' + esc(use.splash) + ' (half damage)';
        openUseConfirm('Use ' + it.name, '<p>' + dmgLine + '.</p>' + (it.effect ? '<p class="hint">' + esc(it.effect) + '</p>' : '') + '<p class="hint">Area attacks: the blast area takes full damage, the splash zone takes half.' + qtyNote + '</p>', '', done);
        return;
      }
      /* Standalone debuff removal (e.g. Bandages) and anything else:
       * show the effect, consume one. */
      if (use.removeDebuff) {
        var mm = use.removeDebuff;
        openUseConfirm('Use ' + it.name, '<p><strong>Removes debuffs mentioning "' + esc(mm) + '".</strong>' + qtyNote + '</p>', '', function () {
          var ml2 = String(mm).toLowerCase();
          state.debuffs = state.debuffs.filter(function (d) { return String(d).toLowerCase().indexOf(ml2) < 0; });
          done();
        });
        return;
      }
      openUseConfirm('Use ' + it.name, '<p>' + esc(it.effect || 'Consumable used.') + '</p><p class="hint">No mechanical effect the sheet can apply — apply the rest with your DM.' + qtyNote + '</p>', '', done);
    },
    rollCard: function (kind, id) {
      var list = kind === 'spell' ? state.spells : state.skills;
      var card = list.find(function (c) { return c.id === id; });
      if (!card) return;
      var stats = computeStats();
      var lib = findLib(card.name);
      var mod = (lib && !lib.stat) ? 0 : (stats[card.stat] ? stats[card.stat].mod : 0);
      if (kind === 'skill' && R.isAttackSkill(card.name)) {
        promptEffectThenRoll(card.name, card.stat, mod, null);
      } else {
        rollD20Check(card.name + ' — ' + card.checkType, mod);
      }
    },
    rollAttack: function (id) {
      var a = state.attacks.find(function (x) { return x.id === id; });
      if (!a) return;
      var stats = computeStats();
      var mod = stats[a.toHitStat] ? stats[a.toHitStat].mod : 0;
      if (R.isAttackSkill(a.name)) {
        promptEffectThenRoll(a.name, a.toHitStat, mod, { rank: 1, manualDamage: a.damage });
      } else {
        rollD20Check(a.name + ' — to hit', mod);
      }
    },
    rollPendingDamage: function () {
      var p = state.pendingDamage;
      if (!p) return;
      var rolls = [];
      (p.dice || []).forEach(function (d) { for (var i = 0; i < d.count; i++) rolls.push(R.rollDie(d.sides)); });
      var diceSum = rolls.reduce(function (a, b) { return a + b; }, 0);
      var total = diceSum * (p.diceMultiplier || 1) + (p.flat || 0) + (p.statMod || 0);
      total = total * (p.multiplier || 1);
      showRoll(p.attackName + ' + ' + p.effectName + ' damage: [' + rolls.join(', ') + ']' + (p.flat ? ' + ' + p.flat : '') + ' + ' + (p.statLabel || 'STR') + ' Mod (+' + (p.statMod || 0) + ')' + (p.diceMultiplier > 1 ? ' (dice ×' + p.diceMultiplier + ')' : '') + (p.multiplier > 1 ? ' (×' + p.multiplier + ' total)' : '') + ' = ' + total);
      state.pendingDamage = null;
      saveSoon(); renderAll();
    },
    clearPendingDamage: function () {
      state.pendingDamage = null;
      saveSoon(); renderAll();
    },
    storySet: function (type, id, field, value) {
      var item = story()[type].find(function (x) { return x.id === id; });
      if (item) { item[field] = value; saveSoon(); renderAll(); }
    },
    storyDel: function (type, id) {
      story()[type] = story()[type].filter(function (x) { return x.id !== id; });
      saveSoon(); renderAll();
    },
    compSkillAdd: function (type, id) {
      // Pet attack/spell ranks equal the current Floor (book, p.231);
      // no rank is stored, so the rendered rank always follows the Floor.
      var comp = story()[type].find(function (x) { return x.id === id; });
      if (!comp) return;
      var nameEl = $('comp-skill-name-' + id);
      var name = nameEl ? nameEl.value.trim() : '';
      if (!name) return;
      if (!comp.skills) comp.skills = [];
      comp.skills.push({ id: uid(), name: name });
      saveSoon(); renderAll();
    },
    compListAdd: function (type, id, field, prefix) {
      var comp = story()[type].find(function (x) { return x.id === id; });
      if (!comp) return;
      var el = $(prefix + id);
      var v = el ? el.value.trim() : '';
      if (!v) return;
      if (!comp[field]) comp[field] = [];
      comp[field].push(v);
      saveSoon(); renderAll();
    },
    compListDel: function (type, id, field, index) {
      var comp = story()[type].find(function (x) { return x.id === id; });
      if (comp && comp[field]) comp[field].splice(index, 1);
      saveSoon(); renderAll();
    },
    compSelectAdd: function (type, id, field, prefix) {
      var comp = story()[type].find(function (x) { return x.id === id; });
      if (!comp) return;
      var el = $(prefix + id);
      var v = el ? el.value : '';
      if (!v) return;
      if (!comp[field]) comp[field] = [];
      comp[field].push(v);
      saveSoon(); renderAll();
    },
    faithSet: function (field, value) {
      story().faith[field] = value;
      saveSoon(); renderAll();
    },
    faithOffered: function () {
      var f = story().faith;
      f.offerings.push({ id: uid(), name: 'Daily offering', date: new Date().toISOString().slice(0, 10), notes: '' });
      f.missed = 0; f.streak = num(f.streak, 0) + 1;
      saveSoon(); renderAll();
    },
    faithMissed: function () {
      var f = story().faith;
      f.missed = num(f.missed, 0) + 1; f.streak = 0;
      saveSoon(); renderAll();
    },
    compSkillDel: function (type, compId, skillId) {
      var comp = story()[type].find(function (x) { return x.id === compId; });
      if (comp && comp.skills) comp.skills = comp.skills.filter(function (s) { return s.id !== skillId; });
      saveSoon(); renderAll();
    },
    sponsorBanner: function (id, delta) {
      var s = story().sponsors.find(function (x) { return x.id === id; });
      if (s) { s.banners = Math.max(0, num(s.banners, 0) + delta); saveSoon(); renderAll(); }
    },
    sponsorSend: function (id) {
      var s = story().sponsors.find(function (x) { return x.id === id; });
      if (s) { s.banners = num(s.banners, 0) + 1; saveSoon(); renderAll(); showRoll(s.name + ': Sponsor Banner sent. Banner Count is now ' + s.banners + '.'); }
    },
    faithDel: function (kind, id) {
      var f = story().faith;
      f[kind] = (f[kind] || []).filter(function (x) { return x.id !== id; });
      saveSoon(); renderAll();
    },
    bioSet: function (field, value) {
      story().bio[field] = value;
      saveSoon();
    },
    rollQuick: function (sides) {
      showRoll('d' + sides + ': rolled ' + R.rollDie(sides));
    },
    rollEvade: function () {
      var stats = computeStats();
      var dice = R.evadeDiceCount(raceEntry(), classEntry());
      var modTotal = stats.dex.mod + state.evadeBuffs + equippedBonuses().evade + skillEvadeTotal();
      var d20 = R.rollDie(20), d4s = [];
      for (var i = 0; i < dice; i++) d4s.push(R.rollDie(4));
      var parts = [d20].concat(d4s);
      var total = parts.reduce(function (a, b) { return a + b; }, 0) + modTotal;
      var formula = 'd20' + (dice ? ' + ' + dice + 'd4' : '') + ' + ' + modTotal;
      showRoll('Evade: ' + formula + ' = ' + parts.concat([modTotal]).join(' + ') + ' = ' + total);
    },
    distStep: distStep,
    renderPickerList: renderPickerList
  };
  // Keep the choice-grant map current for the picker.
  var origRenderChoices = renderChoices;
  renderChoices = function () {
    choiceGrantByCid = {};
    choiceSections().forEach(function (s) { if (s.type === 'grant') choiceGrantByCid[s.cid] = s.grant; });
    origRenderChoices();
  };

  /* ---------------- static wiring & init ---------------- */
  function bind() {
    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.addEventListener('click', function () { showTab(b.dataset.tab); });
    });
    function onChange(id, fn) { var el = $(id); if (el) el.addEventListener('change', function () { fn(el.value); saveSoon(); renderAll(); }); }
    onChange('f-name', function (v) { state.name = v; });
    onChange('f-number', function (v) { state.number = v; });
    onChange('f-level', function (v) { state.level = Math.max(1, Math.min(250, num(v, 1))); });
    onChange('f-floor', function (v) { state.floor = Math.max(1, num(v, 1)); });
    onChange('f-armor', function (v) { state.ownArmor = Math.max(0, num(v, 0)); });
    onChange('f-evade-buffs', function (v) { state.evadeBuffs = num(v, 0); });
    onChange('f-dr-buffs', function (v) { state.drBuffs = num(v, 0); });
    onChange('t-gold', function (v) { state.gold = num(v, 0); });
    onChange('t-pop', function (v) { state.popularity = num(v, 0); });
    onChange('t-favor', function (v) { state.aiFavor = num(v, 0); });
    onChange('t-move', function (v) { state.moveVal = Math.max(0, num(v, 20)); });
    onChange('t-step', function (v) { state.stepVal = Math.max(0, num(v, 10)); });
    function click(id, fn) { var el = $(id); if (el) el.addEventListener('click', fn); }
    click('btn-export', exportJSON);
    click('btn-export-orig', exportOriginalJSON);
    click('btn-import', function () { $('import-file').click(); });
    click('btn-clear', function () {
      if (!confirm('Clear the current sheet? Export a backup first if you want to keep it.')) return;
      state = blankState();
      ensureUnarmed();
      saveNow();
      $('gateway').hidden = false;
      renderAll();
    });
    click('btn-new', function () { $('gateway').hidden = false; });
    click('btn-start-screen', function () { if (window.Cloud) window.Cloud.showLanding(); else $('gateway').hidden = false; });
    click('gw-close', function () { $('gateway').hidden = true; });
    click('gw-blank', function () {
      if ((state.name || state.skills.length || state.spells.length) && !confirm('Start a blank sheet? This replaces the current sheet.')) return;
      state = blankState(); ensureUnarmed(); saveNow();
      $('gateway').hidden = true; renderAll();
    });
    click('gw-import', function () { $('import-file').click(); });
    click('gw-guided', function () {
      if ((state.name || state.skills.length || state.spells.length) && !confirm('Start guided creation? This replaces the current sheet with a blank one for the wizard.')) return;
      state = blankState(); ensureUnarmed(); saveNow();
      $('gateway').hidden = true;
      if (window.Wizard) window.Wizard.start();
      renderAll();
    });
    click('race-pick', function () { openRaceClassPicker('race'); });
    click('class-pick', function () { openRaceClassPicker('class'); });
    click('race-info', function () { showRaceClassInfo('race'); });
    click('class-info', function () { showRaceClassInfo('class'); });
    click('race-clear', function () { setRaceClass('race', ''); });
    click('class-clear', function () { setRaceClass('class', ''); });
    click('picker-close', function () { $('picker-modal').hidden = true; });
    click('info-close', function () { $('info-modal').hidden = true; });
    click('hp-minus', function () { state.hpCurrent = Math.max(0, state.hpCurrent - 1); saveSoon(); renderAll(); });
    click('hp-plus', function () { state.hpCurrent = Math.min(10, state.hpCurrent + 1); saveSoon(); renderAll(); });
    click('hp-full', function () { state.hpCurrent = 10; saveSoon(); renderAll(); });
    click('mana-minus', function () { state.manaCurrent = Math.max(0, state.manaCurrent - 1); saveSoon(); renderAll(); });
    click('mana-plus', function () { state.manaCurrent = state.manaCurrent + 1; saveSoon(); renderAll(); });
    click('mana-full', function () { state.manaCurrent = R.maxMana(computeStats().int.total); saveSoon(); renderAll(); });
    click('rest-short', function () { doRest('short', 'Short Rest'); });
    click('rest-long', function () { doRest('long', 'Long Rest'); });
    click('rest-fullday', function () { doRest('fullday', "Full Day's Rest"); });
    click('rest-mend', function () { doRest('mend', 'Mend'); });
    click('dice-evade', function () { window.DCC.rollEvade(); });
    click('dice-roll', function () {
      var v = $('dice-formula') ? $('dice-formula').value : '';
      var res = R.rollFormula(v);
      if (!res) { showRoll("That formula didn't parse — try e.g. 2d6+3 (up to 20 dice)."); return; }
      var f = res.count + 'd' + res.sides + (res.mod ? (res.mod > 0 ? '+' : '') + res.mod : '');
      showRoll(f + ': rolled [' + res.rolls.join(', ') + ']' + (res.mod ? ' + ' + res.mod : '') + ' = ' + res.total);
    });
    click('roll-copy', function () {
      var btn = $('roll-copy');
      if (!lastRollText || !navigator.clipboard) return;
      navigator.clipboard.writeText(lastRollText).then(function () {
        btn.textContent = 'Copied!';
        setTimeout(function () { btn.textContent = 'Copy result'; }, 2000);
      }).catch(function () {});
    });
    click('quest-add', function () {
      var v = $('quest-name').value.trim(); if (!v) return;
      story().quests.push({ id: uid(), name: v, status: 'active', notes: $('quest-notes').value.trim() });
      $('quest-name').value = ''; $('quest-notes').value = ''; saveSoon(); renderAll();
    });
    click('journal-add', function () {
      var t = $('journal-title').value.trim(), x = $('journal-text').value.trim(); if (!t && !x) return;
      story().journal.push({ id: uid(), date: $('journal-date').value || new Date().toISOString().slice(0, 10), title: t, text: x });
      $('journal-title').value = ''; $('journal-text').value = ''; saveSoon(); renderAll();
    });
    click('pet-add', function () {
      var v = $('pet-name').value.trim(); if (!v) return;
      story().pets.push({ id: uid(), name: v, kind: $('pet-kind').value.trim(), notes: '', level: 1, size: 3, attitude: 'Calm', role: 'None', skills: [], abilities: [] });
      $('pet-name').value = ''; $('pet-kind').value = ''; saveSoon(); renderAll();
    });
    click('mount-add', function () {
      var v = $('mount-name').value.trim(); if (!v) return;
      story().mounts.push({ id: uid(), name: v, kind: $('mount-kind').value.trim(), notes: '', size: 5, move: 30, step: 10, attitude: 'Calm', upgrades: [] });
      $('mount-name').value = ''; $('mount-kind').value = ''; saveSoon(); renderAll();
    });
    click('sponsor-add', function () {
      var v = $('sponsor-name').value.trim(); if (!v) return;
      story().sponsors.push({ id: uid(), name: v, banners: 0, notes: $('sponsor-notes').value.trim() });
      $('sponsor-name').value = ''; $('sponsor-notes').value = ''; saveSoon(); renderAll();
    });
    click('offering-add', function () {
      var v = $('offering-name').value.trim(); if (!v) return;
      story().faith.offerings.push({ id: uid(), name: v, date: $('offering-date').value || new Date().toISOString().slice(0, 10), notes: $('offering-notes').value.trim() });
      $('offering-name').value = ''; $('offering-notes').value = ''; saveSoon(); renderAll();
    });
    click('tithe-add', function () {
      story().faith.tithes.push({ id: uid(), amount: Math.max(0, num($('tithe-amount').value, 0)), notes: $('tithe-notes').value.trim() });
      $('tithe-amount').value = '0'; $('tithe-notes').value = ''; saveSoon(); renderAll();
    });
    click('craft-add', function () {
      var v = $('craft-name').value.trim(); if (!v) return;
      story().crafting.push({ id: uid(), name: v, status: 'planned', tableType: $('craft-table').value, tableTier: Math.min(10, Math.max(1, num($('craft-tier').value, 1))), effect: $('craft-effect').value, notes: $('craft-notes').value.trim(), enchantments: [] });
      $('craft-name').value = ''; $('craft-notes').value = ''; saveSoon(); renderAll();
    });
    (function () {
      var deity = $('faith-deity');
      if (deity) deity.addEventListener('change', function () { story().faith.deity = deity.value.trim(); saveSoon(); });
      var tier = $('faith-tier');
      if (tier) tier.addEventListener('change', function () { window.DCC.faithSet('tier', tier.value); });
      var looted = $('faith-looted');
      if (looted) looted.addEventListener('change', function () { window.DCC.faithSet('looted', Math.max(0, num(looted.value, 0))); });
      click('faith-offered', function () { window.DCC.faithOffered(); });
      click('faith-missed', function () { window.DCC.faithMissed(); });
      ['appearance', 'personality', 'backstory', 'notes'].forEach(function (f) {
        var el = $('bio-' + f);
        if (el) el.addEventListener('change', function () { window.DCC.bioSet(f, el.value); });
      });
      var jd = $('journal-date');
      if (jd && !jd.value) jd.value = new Date().toISOString().slice(0, 10);
      var od = $('offering-date');
      if (od && !od.value) od.value = new Date().toISOString().slice(0, 10);
    })();
    click('buff-add', function () { var v = $('buff-name').value.trim(); if (v) { state.buffs.push(v); $('buff-name').value = ''; saveSoon(); renderAll(); } });
    click('debuff-add', function () { var v = $('debuff-name').value.trim(); if (v) { state.debuffs.push(v); $('debuff-name').value = ''; saveSoon(); renderAll(); } });
    click('hotlist-add-item', function () { DCC.openHotlistPicker('item'); });
    click('hotlist-add-skill', function () { DCC.openHotlistPicker('skill'); });
    click('hotlist-add-spell', function () { DCC.openHotlistPicker('spell'); });
    click('btn-distribute', openDistribute);
    click('dist-cancel', function () { $('distribute-modal').hidden = true; });
    click('dist-apply', function () {
      var total = 0;
      R.STAT_KEYS.forEach(function (k) { total += distAlloc[k]; state.ownBase[k] += distAlloc[k]; });
      state.statPointsSpent += total;
      $('distribute-modal').hidden = true;
      saveSoon(); renderAll();
    });
    click('skill-pick', function () { openSkillPicker('skill'); });
    click('spell-pick', function () { openSkillPicker('spell'); });
    click('item-pick', openItemPicker);
    click('skill-add', function () {
      state.skills.push({ id: uid(), name: 'New Skill', kind: 'skill', ownRank: 1, stat: 'str', checkType: 'Active Check', effect: '', used: false, gearGrants: {} });
      saveSoon(); renderAll(); showTab('skills');
    });
    click('spell-add', function () {
      state.spells.push({ id: uid(), name: 'New Spell', kind: 'spell', ownRank: 1, stat: 'int', checkType: 'Active Check', effect: '', used: false, gearGrants: {} });
      saveSoon(); renderAll(); showTab('spells');
    });
    click('item-add', function () { openItemCreate(); });
    click('item-create-save', function () { createCustomItem(); });
    click('item-create-cancel', function () { $('item-create-modal').hidden = true; });
    click('item-create-bonus-add', function () { addCreateBonusRow(); });
    (function () { var k = $('item-create-kind'); if (k) k.addEventListener('change', syncItemCreateFields); })();
    (function () { var s = $('item-create-subtype'); if (s) s.addEventListener('change', syncItemCreateFields); })();
    (function () { var p = $('item-create-potionkind'); if (p) p.addEventListener('change', syncItemCreateFields); })();
    click('use-confirm-ok', function () { var fn = pendingUseConfirm; pendingUseConfirm = null; $('use-confirm-modal').hidden = true; if (fn) fn(); });
    click('use-confirm-cancel', function () { pendingUseConfirm = null; $('use-confirm-modal').hidden = true; });
    click('atk-add', function () {
      var name = $('atk-name').value.trim();
      if (!name) { alert('Give the attack a name first.'); return; }
      state.attacks.push({ id: uid(), name: name, toHitStat: $('atk-stat').value, damage: $('atk-damage').value, notes: $('atk-notes').value });
      $('atk-name').value = ''; $('atk-damage').value = ''; $('atk-notes').value = '';
      saveSoon(); renderAll();
    });
    var imp = $('import-file');
    if (imp) imp.addEventListener('change', function () { if (imp.files[0]) importFile(imp.files[0]); imp.value = ''; });
    var av = $('avatar-file');
    var avBox = $('avatar-box');
    if (av && avBox) {
      avBox.addEventListener('click', function () { av.click(); });
      avBox.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); av.click(); }
      });
    }
    if (av) av.addEventListener('change', function () {
      var f = av.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { state.avatarUrl = rd.result; saveSoon(); renderAll(); };
      rd.readAsDataURL(f);
    });
    click('avatar-remove', function () { state.avatarUrl = ''; saveSoon(); renderAll(); });
    var ps = $('picker-search');
    if (ps) ps.addEventListener('input', function () { if (pickerMode) renderPickerList(pickerMode.candidates); });
    document.querySelectorAll('.overlay').forEach(function (ov) {
      ov.addEventListener('click', function (e) { if (e.target === ov) ov.hidden = true; });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var had = loadSaved();
    ensureUnarmed();
    bind();
    if (had) {
      if (state.activeTab) showTab(state.activeTab); else renderAll();
      // Keep any bonus-created cards consistent with current sources.
      syncGearGrants();
      renderAll();
    } else {
      state.manaCurrent = 1;
      renderAll();
      $('gateway').hidden = false;
    }
  });
})();
