/* convert.js — JSON conversion between the original sheet's export format
 * ({format:'crawler-sheet', version:1}) and the merged sheet's state shape.
 * Pure functions, no DOM: usable from the app and from node tests.
 *
 * Rank conversion is the heart of it. An original card stores the DISPLAYED
 * rank (trained + givens, edited in place) plus side records: gearGrants
 * (item -> amount), raceClassSkillApplied (race/class fixed amounts) and
 * groupBonus. The merged card stores only ownRank (trained), and givens
 * are recomputed from live records on every render. So:
 *   ownRank = max(0, displayedRank - gearFloor - raceFloor - groupBonus)
 * and the race/class applied records are carried over so the givens
 * re-apply on top of ownRank, reproducing the original displayed rank.
 * In the other direction, displayed rank = ownRank + gear + race + group
 * (supplied by the caller, which owns the live computation).
 *
 * Best-effort gaps (fields with no counterpart, documented not hidden):
 * - Original hotlistState is a map of select-element ids -> names; the
 *   merged hotlist is a plain name list, so values are carried over and
 *   order/selection state is not.
 * - Original backgrounds/story do not exist; merged backgrounds/story are
 *   dropped on export to the original format (the caller keeps them in the
 *   merged save; only the exported file loses them).
 * - raceClassSkillApplied.ownRankBefore cannot be recovered exactly after
 *   later training, so on export it is set to the card's current ownRank.
 * - Original evade/DR buff inputs have no merged counterpart fields beyond
 *   evadeBuffs/drBuffs, which the original did not save under those names;
 *   they default to 0 on import.
 */
(function (global) {
  'use strict';
  function num(v, fb) { var n = parseInt(v, 10); return isNaN(n) ? fb : n; }
  function normName(s) { return String(s || '').trim().toLowerCase(); }
  function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  var STAT_KEYS = ['str', 'con', 'dex', 'int', 'cha'];

  // Original cards carry no kind field (skills and spells live in separate
  // arrays), so the kind must be passed in by the caller; defaulting to
  // origCard.kind keeps the helper usable with already-tagged cards.
  function cardFloors(origCard, raceApplied, kind) {
    var k = kind || origCard.kind;
    var gear = 0;
    Object.keys(origCard.gearGrants || {}).forEach(function (k2) { gear += num(origCard.gearGrants[k2], 0); });
    var race = 0;
    (raceApplied || []).forEach(function (a) {
      if (a.kind === k && normName(a.skillName) === normName(origCard.name)) race += num(a.amount, 0);
    });
    return { gear: gear, race: race, group: num(origCard.groupBonus, 0) };
  }
  function cardOwnRank(origCard, raceApplied, kind) {
    var f = cardFloors(origCard, raceApplied, kind);
    return Math.max(0, num(origCard.rank, 1) - f.gear - f.race - f.group);
  }
  function mapCard(origCard, kind, raceApplied, uid) {
    var stat = origCard.stat ? String(origCard.stat).toLowerCase() : (kind === 'spell' ? 'int' : 'str');
    return {
      id: uid(), name: origCard.name || '', kind: kind,
      ownRank: cardOwnRank(origCard, raceApplied, kind),
      stat: stat, checkType: origCard.checkType || 'Active Check',
      effect: origCard.effect || '', used: !!origCard.used,
      gearGrants: Object.assign({}, origCard.gearGrants || {})
    };
  }
  function mapBonus(b, isSpellName, normalizeSlot) {
    var amount = num(b.amount, 0);
    if (b.type === 'stat') return { type: 'stat', stat: (b.stat || 'str').toLowerCase(), amount: amount };
    if (b.type === 'grant') return { type: 'grant', skillName: b.skill || '', kind: isSpellName(b.skill) ? 'spell' : 'skill', amount: amount };
    if (b.type === 'dr') return { type: 'dr', amount: amount };
    if (b.type === 'evade') return { type: 'evade', amount: amount };
    return { type: 'stat', stat: 'str', amount: amount };
  }

  /* Original-format character object -> merged state fields. The caller
   * merges the result over blankState() (so story/backgrounds default). */
  function originalToMerged(orig, opts) {
    opts = opts || {};
    var isSpellName = opts.isSpellName || function () { return false; };
    var normalizeSlot = opts.normalizeSlot || function (s) { return s || 'Other'; };
    var uidCounter = 0;
    function uid() { return 'imp' + (Date.now().toString(36)) + (uidCounter++); }
    var raceApplied = (orig.raceClassSkillApplied || []).map(function (a) {
      return { source: a.source, sourceName: a.sourceName, skillName: a.skillName, kind: a.kind, amount: num(a.amount, 0), createdByBonus: !!a.createdByBonus };
    });
    // Choices: original split ids are kind:name:splitN, merged split ids add
    // a '-0' pick suffix; grant ids (kind:name:choiceN-M) are identical.
    var choices = {};
    Object.keys(orig.raceClassChoices || {}).forEach(function (cid) {
      var v = orig.raceClassChoices[cid];
      if (!v) return;
      var parts = cid.split(':');
      if (v.split && parts.length === 3) { choices[cid + '-0'] = { split: v.split }; return; }
      if (v.name) {
        var kind = 'skill';
        raceApplied.forEach(function (a) { if (a.source === 'choice' && a.sourceName === cid) kind = a.kind; });
        choices[cid] = { name: v.name, kind: kind };
      }
    });
    function names(list) {
      return (list || []).map(function (b) { return typeof b === 'string' ? b : (b.name || ''); }).filter(Boolean);
    }
    var hotlist = [];
    if (Array.isArray(orig.hotlist)) hotlist = orig.hotlist.filter(Boolean);
    else if (orig.hotlistState && typeof orig.hotlistState === 'object') {
      Object.keys(orig.hotlistState).forEach(function (k) {
        var val = orig.hotlistState[k];
        if (val && hotlist.indexOf(val) === -1) hotlist.push(val);
      });
    }
    var ownBase = orig.ownBase && STAT_KEYS.every(function (k) { return orig.ownBase[k] !== undefined; })
      ? { str: num(orig.ownBase.str, 1), con: num(orig.ownBase.con, 1), dex: num(orig.ownBase.dex, 1), int: num(orig.ownBase.int, 1), cha: num(orig.ownBase.cha, 1) }
      : { str: num(orig.strBase, 1), con: num(orig.conBase, 1), dex: num(orig.dexBase, 1), int: num(orig.intBase, 1), cha: num(orig.chaBase, 1) };
    var tab = orig.activeTab || 'vitals';
    if (tab === 'items') tab = 'inventory';
    var mergedTabs = ['vitals', 'attacks', 'gear', 'skills', 'spells', 'inventory', 'campaign', 'quests', 'journal', 'pets', 'mounts', 'sponsors', 'faith', 'crafting', 'bio', 'choices', 'dm', 'sendbox', 'sendach', 'loot', 'achievements', 'all'];
    if (mergedTabs.indexOf(tab) === -1) tab = 'vitals';
    return {
      name: orig.name || '', number: orig.number || '', race: orig.race || '', class: orig.class || '',
      level: clampInt(num(orig.level, 1), 1, 250), floor: Math.max(1, num(orig.floor, 1)),
      avatarUrl: orig.avatarUrl || '',
      ownBase: ownBase,
      ownEnh: { str: num(orig.strEnh, 0), con: num(orig.conEnh, 0), dex: num(orig.dexEnh, 0), int: num(orig.intEnh, 0), cha: num(orig.chaEnh, 0) },
      ownArmor: num(orig.armorVal, 0), evadeBuffs: 0, drBuffs: 0,
      hpCurrent: clampInt(num(orig.hpCurrent, 10), 0, 10), manaCurrent: Math.max(0, num(orig.manaCurrent, 1)),
      statPointsSpent: num(orig.statPointsSpent, 0),
      gold: num(orig.gold, 0), popularity: num(orig.popularity, 0), aiFavor: num(orig.aiFavor, 0),
      moveVal: num(orig.moveVal, 20), stepVal: num(orig.stepVal, 10),
      bossKills: Math.max(0, num(orig.bossKills, 0)), pkKills: Math.max(0, num(orig.pkKills, 0)),
      buffs: names(orig.buffs), debuffs: names(orig.debuffs), hotlist: hotlist.slice(0, 10),
      skills: (orig.skills || []).map(function (c) { return mapCard(c, 'skill', raceApplied, uid); }),
      spells: (orig.spells || []).map(function (c) { return mapCard(c, 'spell', raceApplied, uid); }),
      attacks: (orig.attacks || []).map(function (a) {
        return { id: uid(), name: a.name || '', toHitStat: (a.stat || 'str').toLowerCase(), damage: a.damage || '', notes: a.notes || '' };
      }),
      items: (orig.items || []).map(function (it) {
        return {
          id: uid(), name: it.name || '', kind: 'other', slot: normalizeSlot(it.slot),
          effect: it.notes || it.effect || '',
          bonuses: (it.bonuses || []).slice(0, 5).map(function (b) { return mapBonus(b, isSpellName, normalizeSlot); }),
          equipped: !!it.equipped
        };
      }),
      raceClassApplied: raceApplied, raceClassChoices: choices,
      raceClassMoveApplied: orig.raceClassMoveApplied || null,
      activeTab: tab
    };
  }

  /* Merged state -> original-format character object. derived is
   * {str,con,dex,int,cha} derived bases; floorFor(card) returns
   * {rank, gear, race, group} for that card from the live computation. */
  function mergedToOriginal(state, derived, floorFor) {
    function cardOut(card, kind) {
      var f = floorFor(card);
      return {
        name: card.name, rank: f.rank, stat: card.stat, checkType: card.checkType,
        effect: card.effect || '', used: !!card.used,
        gearGrants: Object.assign({}, card.gearGrants || {}), groupBonus: f.group
      };
    }
    var choices = {};
    Object.keys(state.raceClassChoices || {}).forEach(function (cid) {
      var v = state.raceClassChoices[cid];
      if (!v) return;
      // Merged split ids end in '-0'; the original split id has no suffix.
      var origCid = cid;
      var parts = cid.split(':');
      if (v.split && parts.length === 3 && /-0$/.test(cid)) origCid = cid.slice(0, -2);
      choices[origCid] = v.split ? { split: v.split } : { name: v.name };
    });
    var applied = (state.raceClassApplied || []).map(function (a) {
      var card = (a.kind === 'spell' ? state.spells : state.skills).find(function (c) { return c.name === a.skillName; });
      return { source: a.source, sourceName: a.sourceName, skillName: a.skillName, kind: a.kind, amount: a.amount, ownRankBefore: card ? card.ownRank : 0, createdByBonus: !!a.createdByBonus };
    });
    var out = {
      name: state.name, number: state.number, race: state.race, class: state.class,
      level: state.level, floor: state.floor, avatarUrl: state.avatarUrl || '',
      ownBase: state.ownBase, raceClassChoices: choices, raceClassSkillApplied: applied,
      raceClassMoveApplied: state.raceClassMoveApplied || null,
      statPointsSpent: state.statPointsSpent,
      statBank: Math.max(0, (state.level - 1) * 3 - (state.statPointsSpent || 0)),
      gold: state.gold, popularity: state.popularity, aiFavor: state.aiFavor,
      moveVal: state.moveVal, stepVal: state.stepVal,
      bossKills: state.bossKills, pkKills: state.pkKills,
      hpCurrent: state.hpCurrent, manaCurrent: state.manaCurrent, maxHpSlots: 10,
      activeTab: state.activeTab === 'inventory' ? 'items' : state.activeTab,
      buffs: (state.buffs || []).map(function (n) { return { name: n, notes: '' }; }),
      debuffs: (state.debuffs || []).map(function (n) { return { name: n, notes: '' }; }),
      hotlistState: {}, gearState: {},
      skills: (state.skills || []).map(function (c) { return cardOut(c, 'skill'); }),
      spells: (state.spells || []).map(function (c) { return cardOut(c, 'spell'); }),
      attacks: (state.attacks || []).map(function (a) { return { name: a.name, stat: a.toHitStat, damage: a.damage, notes: a.notes || '' }; }),
      items: (state.items || []).map(function (it) {
        return {
          name: it.name, slot: it.slot, notes: it.effect || '', equipped: !!it.equipped,
          bonuses: (it.bonuses || []).map(function (b) {
            return { type: b.type, stat: b.stat, skill: b.skillName || '', amount: b.amount };
          })
        };
      })
    };
    STAT_KEYS.forEach(function (k) {
      out[k + 'Base'] = String(derived[k]);
      out[k + 'Enh'] = String((state.ownEnh && state.ownEnh[k]) || 0);
    });
    out.armorVal = state.ownArmor || 0;
    return out;
  }

  var api = { originalToMerged: originalToMerged, mergedToOriginal: mergedToOriginal, cardOwnRank: cardOwnRank, cardFloors: cardFloors };
  global.Convert = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
