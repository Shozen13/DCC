/* rules.js — pure Dungeon Crawler Carl calculations. No DOM, no network.
 * Every function here is deterministic and unit-testable. The app layer
 * (app.js) owns state and rendering; this file owns arithmetic and
 * rulebook-text parsing.
 *
 * Sources, all verified against the old sheet's live behaviour and the
 * rulebook extracts in data/:
 *  - Modifier bands: book stat-modifier table, as implemented in the old
 *    sheet (bands continue past 49; the task brief lists only up to 49).
 *  - Rank damage dice: book Chapter 4, Table 37, p.176.
 *  - Nature's Breath heal: book p.209; upgrade bonus is cumulative
 *    (+1 at Rank 5, +2 at Rank 10, +3 at Rank 15), flagged as correctable
 *    if the book means +1 total.
 *  - Race/class fixed-stat parsing: regex over the benefits text, with
 *    Human (+2 all) and Primal (-1 all) as special cases.
 *  - Fixed skill/spell parsing: each "+N ..." segment ends at the next
 *    "+", "." or ";", and a name is kept ONLY if it matches a Chapter 4
 *    library entry (case-insensitive). Segments mentioning a choice are
 *    skipped here — they belong in the Choices tab, not as fixed bonuses.
 */
(function (global) {
  'use strict';

  var STAT_KEYS = ['str', 'con', 'dex', 'int', 'cha'];
  var STAT_NAMES = { str: 'Strength', con: 'Constitution', dex: 'Dexterity', int: 'Intelligence', cha: 'Charisma' };
  var STAT_ABBR = { Strength: 'str', Dexterity: 'dex', Constitution: 'con', Intelligence: 'int', Charisma: 'cha' };

  function clampInt(v, fallback) {
    var n = parseInt(v, 10);
    return isNaN(n) ? fallback : n;
  }

  /* Modifier bands. 1-2 -> +1, 3-5 -> +2, 6-9 -> +3, 10-19 -> +4,
   * 20-49 -> +5, then +1 per further band as in the old sheet. */
  function getModifier(statValue) {
    var v = clampInt(statValue, 1);
    if (v < 1) return 0;
    if (v <= 2) return 1;
    if (v <= 5) return 2;
    if (v <= 9) return 3;
    if (v <= 19) return 4;
    if (v <= 49) return 5;
    if (v <= 99) return 6;
    if (v <= 149) return 7;
    if (v <= 199) return 8;
    if (v <= 299) return 9;
    return 10;
  }

  /* Stored own base, clamped to a minimum of 1 per stat. This is NOT
   * the Base the player sees: the displayed Base adds the race/class
   * term on top (displayedBase, ?v=53). Race/class penalties were
   * never in the stored base either. */
  function derivedBase(ownBase) {
    var out = {};
    STAT_KEYS.forEach(function (k) {
      out[k] = Math.max(1, clampInt(ownBase[k], 1));
    });
    return out;
  }

  /* Displayed Base (?v=53, DM ruling 2026-11-27, relayed by Antony):
   * the Base the player sees is their own base PLUS the race/class
   * stat term (fixed + split, may be negative), minimum 1. The stored
   * own base is unchanged — this is a display merge, not a fold, so
   * removing a race/class still takes its bonus back off the Base.
   * The Total is unchanged: displayed Base + ownEnh + Gear = Total
   * (before the minimum-1 and cap clamps). */
  function displayedBase(ownBase, raceClass) {
    return Math.max(1, Math.max(1, clampInt(ownBase, 1)) + (raceClass || 0));
  }

  /* Back-compute the stored own base from a typed displayed Base:
   * ownBase = displayed − race/class, minimum 1. Mirrors
   * ownEnhForTotal. Clamp edge: when the displayed Base was itself
   * clamped at 1 (own base 1 with a −1 race/class term), typing 1
   * stores own base 2 — the Total stays 1 either way. */
  function ownBaseForDisplayed(displayed, raceClass) {
    return Math.max(1, clampInt(displayed, 1) - (raceClass || 0));
  }

  /* Back-compute the player's own enhancement from a typed Enhance
   * total: total = base + ownEnh + gear + race/class, clamped to
   * [1, cap]. Mirrors ownRankForTotal for the rank control. */
  function ownEnhForTotal(target, ownBase, gear, raceClass, cap) {
    var t = Math.max(1, clampInt(target, 1));
    if (cap !== null && cap !== undefined && t > cap) t = cap;
    return Math.max(0, t - Math.max(1, clampInt(ownBase, 1)) - (gear || 0) - (raceClass || 0));
  }

  /* Total = Base + Enhance + Gear + extra, minimum 1, then the
   * race/class cap if any. `extra` is the race/class contribution
   * (fixed + split, which may be negative for penalties). */
  function statTotal(derived, enh, gear, extra, cap) {
    var total = Math.max(1, derived + enh + gear + extra);
    if (cap !== null && cap !== undefined && total > cap) total = cap;
    return total;
  }

  function statCapFor(raceName, className, statKey) {
    if (raceName === 'Hobgoblin' && statKey === 'cha') return 10;
    if (raceName === 'Pocket Kuma' && statKey === 'str') return 10;
    return null;
  }

  /* Stat bank: (Level - 1) * 3 points earned, minus points spent. */
  function statBank(level, spent) {
    return (Math.max(1, clampInt(level, 1)) - 1) * 3 - clampInt(spent, 0);
  }

  /* Health bar: always 10 slots. Each slot is worth the Health Bar mod
   * (CON mod, or CHA mod for Obsidian Butterfly). Total HP = 10 * mod.
   * Mana maximum = INT Total (old sheet behaviour, NOT CrawlerCo's
   * HP 20 / Mana 5 formulas). */
  function maxHpSlots() { return 10; }
  function totalHp(hbMod) { return 10 * hbMod; }
  function maxMana(intTotal) { return intTotal; }

  function evadeString(dexMod, evadeDiceCount, buffs, gear) {
    var total = dexMod + buffs + gear;
    var dice = evadeDiceCount > 0 ? evadeDiceCount + 'd4' : '';
    return 'd20 + ' + (dice ? dice + ' + ' : '') + total;
  }

  /* DR = Armor (own + gear DR) + Buffs + Race/Class DR. Gear DR is
   * already inside Armor, so it is not added a second time. */
  function totalDR(armor, buffs, raceClassDR) {
    return armor + buffs + raceClassDR;
  }

  /* Evade Buffs granted by ranked skills/spells (book Ch.4): the base
   * effect plus each rank upgrade reached may grant "+N Evade Buff"
   * (e.g. Dodge, p.190: +1 base, +1 at Rank 5, +2 at Rank 10, +2 at
   * Rank 15 = +6 at Rank 15). Upgrades are cumulative additional
   * grants, like other rank upgrades. The phrasing is always "Evade
   * Buff" in the book, so plain "+N Evade" without "Buff" does not
   * count here. A custom effect replaces the library base text for
   * the card; library rank upgrades still apply on top of it. */
  function evadeBuffsInText(text) {
    var total = 0, m, re = /\+(\d+)\s+Evade Buff/gi;
    if (!text) return 0;
    while ((m = re.exec(text))) total += parseInt(m[1], 10);
    return total;
  }
  function skillEvadeBuff(lib, rank, customEffect) {
    if (!lib && !customEffect) return 0;
    var total = evadeBuffsInText(customEffect || (lib && lib.base_effect) || '');
    if (lib && lib.upgrades) {
      Object.keys(lib.upgrades).forEach(function (t) {
        if (rank >= parseInt(t, 10)) total += evadeBuffsInText(lib.upgrades[t]);
      });
    }
    return total;
  }

  /* Rank damage dice, book Table 37, p.176. */
  function rankDamageDie(rank) {
    var r = clampInt(rank, 1);
    if (r <= 1) return '+1';
    if (r <= 3) return '1d2';
    if (r <= 5) return '1d4';
    if (r <= 7) return '1d6';
    if (r <= 9) return '1d8';
    if (r <= 11) return '1d10';
    if (r <= 13) return '1d12';
    if (r <= 15) return '1d8 + 1d6';
    if (r <= 17) return '2d8';
    if (r <= 19) return '1d10 + 1d8';
    return '2d10';
  }

  function naturesBreathHealFormula(rank) {
    var die = rankDamageDie(rank);
    var bonus = 0;
    if (rank >= 5) bonus += 1;
    if (rank >= 10) bonus += 1;
    if (rank >= 15) bonus += 1;
    if (die === '+1') return bonus ? ('+' + (1 + bonus) + ' slots') : '+1 slot';
    return bonus ? (die + ' + ' + bonus + ' slots') : (die + ' slots');
  }

  /* ---- Rank / given-amount model ------------------------------------
   * A card's displayed Rank = ownRank + gearGiven + raceGiven + groupGiven
   * + backgroundGiven. ownRank is what the player trained. Given amounts
   * are what sources provide. The combined floor = the sum of all givens.
   * Manual lowering can never go below that floor (so ownRank >= 0).
   * Background ranks are a given source exactly like race/class: a
   * background skill at Rank 3, Unarmed Combat at Rank 3, and a combat
   * weapon/spell at Rank 3 all floor their cards at 3. On removal of a
   * source, its given amount simply stops counting: rank = trained total
   * minus given, and a card with ownRank 0 and no remaining given amounts
   * is removed. This is the model the user specified; it is much simpler
   * than the old sheet's delta bookkeeping and cannot double-count,
   * because given amounts are recomputed from live records on every
   * render instead of being added/subtracted. */
  function displayRank(card, gearGiven, raceGiven, groupGiven, backgroundGiven) {
    return (card.ownRank || 0) + gearGiven + raceGiven + groupGiven + (backgroundGiven || 0);
  }
  function combinedFloor(gearGiven, raceGiven, groupGiven, backgroundGiven) {
    return gearGiven + raceGiven + groupGiven + (backgroundGiven || 0);
  }
  function ownRankForTotal(total, gearGiven, raceGiven, groupGiven, backgroundGiven) {
    var floor = combinedFloor(gearGiven, raceGiven, groupGiven, backgroundGiven);
    var t = Math.max(1, clampInt(total, 1));
    if (t < floor) t = floor;
    return t - floor;
  }
  function shouldRemoveCard(card, gearGiven, raceGiven, groupGiven, backgroundGiven, heldByRaceClass) {
    // A card still held by a race/class record must survive: a negative
    // grant can fold its trained rank to 0 while held, and the record is
    // the only way those ranks come back when the race/class leaves
    // (?v=47.7: Unarmed Combat 1 folded to 0 by Spellforge Smith was
    // pruned here, so clearing the class had no card to restore into).
    // A card with a background protection floor is held the same way.
    // Only a card with nothing holding it goes.
    if (heldByRaceClass || (card.backgroundRank || 0) > 0) return false;
    return (card.ownRank || 0) <= 0 && combinedFloor(gearGiven, raceGiven, groupGiven, backgroundGiven) <= 0;
  }
  /* Background ranks are trained ranks, and backgroundRank is the
   * protection floor: the rank the card came with at creation, which the
   * trained rank can never drop below and which blocks deleting the card.
   * It is never added to the displayed rank (backgroundGivenFor is 0) —
   * it is already inside ownRank. Fold any stored backgroundRank into
   * ownRank once (bgFolded), keeping backgroundRank as the floor record.
   * First repairs the old double-count shape (ownRank 3 with
   * backgroundRank 3) the same way the old split did, so the fold cannot
   * inflate a rank. Cards folded by ?v=43 had backgroundRank cleared;
   * recover the grant from the saved background picks (backgrounds:
   * {childhood, adolescence, career, hobby} with skills lists, ranks
   * 1/1/3/2, plus combat at 3). New wizard cards are created folded. */
  function foldBackgroundRank(card, backgrounds) {
    if (!card.background || card.bgFolded) return card;
    if ((card.backgroundRank || 0) > 0) {
      if (!card.bgSplit) card.ownRank = Math.max(0, (card.ownRank || 0) - card.backgroundRank);
      card.ownRank = (card.ownRank || 0) + card.backgroundRank;
    } else if (backgrounds) {
      var rec = backgroundGrantRank(card, backgrounds);
      if (rec > 0) card.backgroundRank = rec;
    }
    card.bgSplit = true;
    card.bgFolded = true;
    return card;
  }
  function backgroundGrantRank(card, backgrounds) {
    if (!backgrounds) return 0;
    var key = normName(card.name);
    var ranks = { childhood: 1, adolescence: 1, career: 3, hobby: 2 };
    var catIds = ['childhood', 'adolescence', 'career', 'hobby'];
    for (var i = 0; i < catIds.length; i++) {
      var sel = backgrounds[catIds[i]];
      if (sel && (sel.skills || []).some(function (n) { return normName(n) === key; })) return ranks[catIds[i]];
    }
    var combat = backgrounds.combat;
    if (combat && (key === 'unarmed combat' || normName(combat.name || '') === key)) return 3;
    return 0;
  }
  /* Race/class fixed grants are trained ranks too (?v=47.5): the granted
   * amount is folded into ownRank once (rcFolded), and the raceClassApplied
   * entries stay as the record — how much to take back off when the
   * race/class leaves, and the floor the trained rank cannot drop below
   * while the race/class is held. Unlike the background fold there is no
   * double-count shape to repair: under the old model ownRank never
   * included the grant, so a straight add is exact. New grants are
   * created folded by applyFixedBonus. */
  function foldRaceClassRank(card, applied) {
    if (!card || card.rcFolded) return card;
    var total = 0, key = normName(card.name);
    (applied || []).forEach(function (a) {
      if (a.kind === card.kind && normName(a.skillName) === key) total += parseInt(a.amount, 10) || 0;
    });
    // A negative total is a folded penalty (Spellforge Smith -2 Unarmed
    // Combat): it comes off the trained rank the same way, never below 0.
    if (total !== 0) card.ownRank = Math.max(0, (card.ownRank || 0) + total);
    card.rcFolded = true;
    return card;
  }

  /* ---- Race/class text parsing (data-driven, benefits text only) ---- */
  function parseRaceClassStats(entry) {
    var out = { str: 0, con: 0, dex: 0, int: 0, cha: 0 };
    if (!entry) return out;
    if (entry.name === 'Human') { STAT_KEYS.forEach(function (k) { out[k] += 2; }); return out; }
    if (entry.name === 'Primal') { STAT_KEYS.forEach(function (k) { out[k] -= 1; }); return out; }
    var b = entry.benefits || '';
    var re = /([+-])(\d+) (Strength|Dexterity|Constitution|Intelligence|Charisma)\b/g;
    var m;
    while ((m = re.exec(b)) !== null) {
      out[STAT_ABBR[m[3]]] += (m[1] === '+' ? 1 : -1) * parseInt(m[2], 10);
    }
    return out;
  }

  function parseRaceClassSplit(entry) {
    if (!entry) return [];
    var b = entry.benefits || '';
    var out = [];
    var re = /\+(\d+) split (?:as you please )?between ([A-Z][a-z]+(?:, [A-Z][a-z]+)*(?:,? and [A-Z][a-z]+)?)/g;
    var m;
    while ((m = re.exec(b)) !== null) {
      var parts = m[2].split(/,| and /).map(function (s) { return s.trim(); }).filter(Boolean);
      var stats = parts.map(function (p) { return STAT_ABBR[p]; }).filter(Boolean);
      if (stats.length) out.push({ pool: parseInt(m[1], 10), stats: stats });
    }
    return out;
  }

  function parseRaceClassDR(entry) {
    if (!entry) return 0;
    var b = entry.benefits || '';
    var total = 0;
    var re = /\+(\d+) DR(?: Buff)?\b/g;
    var m;
    while ((m = re.exec(b)) !== null) {
      var after = b.slice(m.index, m.index + 40);
      if (/DR Upgrade/.test(after) || /breastplate/.test(b.slice(0, m.index + 60))) continue;
      total += parseInt(m[1], 10);
    }
    if (entry.name === 'Grulke') total = Math.max(0, total - 2); // breastplate item, not flat DR
    if (entry.name === 'Cat Girl/Cat Boy') total = Math.max(0, total - 5); // Catcher upgrade for allies, not flat DR
    return total;
  }

  function evadeDiceCount(raceEntry, classEntry) {
    var count = 0;
    [raceEntry, classEntry].forEach(function (e) {
      if (e && /add 1d4 to your Evade/i.test(e.benefits || '')) count += 1;
    });
    return count;
  }

  function healthBarUsesCha(raceEntry, classEntry) {
    return [raceEntry, classEntry].some(function (e) {
      return e && /Cha Mod instead of Con Mod in your Health Bar/i.test(e.benefits || '');
    });
  }

  function normName(s) { return (s || '').trim().toLowerCase(); }

  /* findLib(name) must return a library entry or null (case-insensitive).
   * Aliases: Intimidation -> Intimidate, Smite -> Paladin's Smite. */
  function parseFixedSkillBonuses(entry, findLib) {
    var out = [];
    if (!entry || !findLib) return out;
    var b = (entry.benefits || '').replace(/Rise, Dead Minion!/g, 'RISEDEADMINION');
    function pushNames(segment, amt) {
      if (/choice|chosen/i.test(segment)) return; // choice grants live in Choices, not here
      var txt = segment.replace(/\bSkills?\b|\bSpells?\b/gi, '').trim().replace(/,$/, '').trim().replace(/\s+and\s*$/, '').trim();
      if (!txt) return;
      txt.split(/,|\s+and\s+/).forEach(function (raw) {
        var name = raw.trim().replace(/\([^)]*\)/g, '').trim();
        name = name.replace(/^\+?\d+\s*/, '').trim();
        name = name.replace(/^(a |an |the |one |in )/i, '').trim();
        name = name.replace(/\s+with\s+.*$/i, '').trim();
        if (name === 'RISEDEADMINION') name = 'Rise, Dead Minion!';
        if (name.toLowerCase() === 'intimidation') name = 'Intimidate';
        if (name.toLowerCase() === 'smite') name = "Paladin's Smite";
        if (!name) return;
        var lib = findLib(name);
        if (!lib) return; // library-only: stats, DR, group wording never become cards
        out.push({ name: lib.name, kind: lib.kind, amount: amt });
      });
    }
    var re = /\+(\d+)\s+([^.;+]+)/g;
    var m;
    while ((m = re.exec(b)) !== null) {
      pushNames(m[2], parseInt(m[1], 10));
    }
    /* Negative grants (detriments): "-2 Unarmed Combat" (Spellforge
     * Smith). Same segment rules as the positive pass, with the amount
     * stored negative so applyFixedBonus folds the penalty into
     * ownRank and reverseSource restores it. Names are library-
     * validated, so prose like "-4 Charisma" (Tigran) or "-1" check
     * penalties never become grants. */
    var nre = /-(\d+)\s+([^.;+\-]+)/g;
    while ((m = nre.exec(b)) !== null) {
      pushNames(m[2], -parseInt(m[1], 10));
    }
    return out;
  }

  /* Choice grants: "+N in a/one/two Spell(s)/Skill(s) of your choice",
   * "+N in a weapon skill of choice", and "+N to two chosen skills from
   * A, B, or C". Returns [{amount, count, category, label, options}].
   * category: 'spell' | 'weapon' | 'crafting' | 'skill'. */
  function parseChoiceGrants(entry) {
    var out = [];
    if (!entry) return out;
    var b = entry.benefits || '';
    var seen = {};
    function push(amount, count, category, label, options) {
      // ?v=49: the dedupe key includes the label, so two distinct choices
      // with the same amount/count/category (e.g. Fomorian's two "+1 in
      // one skill from ..." picks) both reach the Choices tab. Identical
      // grants (same label) still dedupe — Yautja's four identical
      // "+1 to a single Skill" picks stay one choice by design.
      var key = amount + '|' + count + '|' + category + '|' + label + '|' + (options || []).join(',');
      if (seen[key]) return;
      seen[key] = true;
      out.push({ amount: amount, count: count, category: category, label: label, options: options || null });
    }
    function countWord(w) {
      w = (w || '').toLowerCase();
      if (w === 'two') return 2;
      if (w === 'three') return 3;
      return 1;
    }
    function categoryOf(text) {
      var t = text.toLowerCase();
      if (t.indexOf('spell') >= 0) return 'spell';
      if (t.indexOf('weapon') >= 0) return 'weapon';
      if (t.indexOf('crafting') >= 0) return 'crafting';
      return 'skill';
    }
    var re1 = /\+(\d+)\s+in\s+(one|two|three|a|an)\s+([^.;]+?)\s+of (?:your )?choice/gi;
    var m;
    while ((m = re1.exec(b)) !== null) {
      var cat = categoryOf(m[3]);
      push(parseInt(m[1], 10), countWord(m[2]), cat, m[3].trim(), null);
    }
    var re2 = /\+(\d+)\s+(?:in|to)\s+(two|three)\s+chosen\s+skills?\s+from\s+([^.;]+)/gi;
    while ((m = re2.exec(b)) !== null) {
      var opts = m[3].split(/,|\s+or\s+|\s+and\s+/).map(function (s) { return s.trim(); }).filter(Boolean);
      push(parseInt(m[1], 10), countWord(m[2]), 'skill', 'chosen skills', opts);
    }
    return out;
  }

  /* Rank-20 cap clauses: "X can be raised to Rank 20" / "X raisable to
   * Rank 20". Returns [{type, name, kind, category, count, options,
   * label}]. type: 'fixed' (a named skill/spell), 'all' (all skills),
   * 'crafting' (all crafting skills), 'explosiveTrap' (explosives and
   * trap-making skills), 'firearm' (all firearm skills), 'choice' (the
   * player picks: category 'weapon' | 'crafting' | 'cha' | 'skill' with
   * options). A clause can hold
   * both a fixed name and a choice ("Hide in Shadows and one crafting
   * Skill of your choice"), so choice patterns are extracted first and
   * the fixed-name scan runs on what is left. Names are validated
   * against the library, so ordinary words in a long clause never
   * become caps. */
  function parseCapGrants(entry, findLib) {
    var out = [];
    if (!entry || !entry.benefits) return out;
    var b = entry.benefits;
    var re = /can be raised to rank 20|raisable to rank 20/gi;
    var m;
    while ((m = re.exec(b)) !== null) {
      var j = m.index - 1;
      while (j >= 0 && b[j] !== '.' && b[j] !== ';' && b[j] !== '\n' && b[j] !== '•') j--;
      var frag = b.slice(j + 1, re.lastIndex);
      // "with X raisable to Rank 20": the cap applies only to X, not to
      // an earlier list in the same sentence (e.g. "+2 Holy Aura, Hot
      // Stuff Aura, Heal Others, and Intimate Touches Spells, with Heal
      // Others raisable to Rank 20" raises only Heal Others).
      var withIdx = frag.toLowerCase().lastIndexOf(' with ');
      if (withIdx >= 0) frag = frag.slice(withIdx + 1);
      parseCapFragment(frag, findLib, out);
    }
    return out;
  }
  function parseCapFragment(frag, findLib, out) {
    var seen = {};
    function push(rule) {
      var key = rule.type + '|' + (rule.name || '') + '|' + (rule.category || '') + '|' + (rule.options || []).join(',');
      if (seen[key]) return;
      seen[key] = true;
      out.push(rule);
    }
    var f = frag;
    var low = f.toLowerCase();
    var skipFixed = false;
    if (/all crafting skills/.test(low)) { push({ type: 'crafting', label: 'all crafting Skills' }); skipFixed = true; }
    else if (/all skills/.test(low)) { push({ type: 'all', label: 'all Skills' }); skipFixed = true; }
    if (/all explosives and trap-making skills/.test(low)) { push({ type: 'explosiveTrap', label: 'all explosives and trap-making Skills' }); skipFixed = true; }
    if (/firearm/.test(low)) { push({ type: 'firearm', label: 'all One-handed Firearm Skills' }); skipFixed = true; }
    // Choice patterns; each removes its phrase so the fixed scan below
    // does not re-read it.
    [{ re: /two different charisma-based skills?/i, category: 'cha', count: 2, label: 'two different Charisma-based Skills' },
     { re: /one weapon skills?/i, category: 'weapon', count: 1, label: 'one Weapon Skill' },
     { re: /one crafting skills?/i, category: 'crafting', count: 1, label: 'one crafting Skill' }].forEach(function (c) {
      if (c.re.test(f)) {
        push({ type: 'choice', category: c.category, count: c.count, label: c.label, options: null });
        f = f.replace(c.re, ' ');
      }
    });
    // "Rapier or Longsword Skill (raisable to Rank 20)".
    var orM = /([A-Z][A-Za-z'’\- ]+?)\s+or\s+([A-Z][A-Za-z'’\- ]+?)\s+(?:skill|spell)/i.exec(f);
    if (orM) {
      var opts = [orM[1], orM[2]].map(function (n) { return cleanCapName(n, findLib); });
      if (opts[0] && opts[1]) {
        push({ type: 'choice', category: 'skill', count: 1, label: opts.join(' or '), options: opts });
        f = f.replace(orM[0], ' ');
        skipFixed = true;
      }
    }
    if (skipFixed) return;
    var rest = f.replace(/can be raised to rank 20|raisable to rank 20/gi, ' ');
    rest.split(/,|\s+and\s+/i).forEach(function (part) {
      var name = cleanCapName(part, findLib);
      if (!name) return;
      var lib = findLib(name);
      push({ type: 'fixed', name: lib.name, kind: lib.kind, label: lib.name });
    });
  }
  /* Strip grant phrasing around a skill/spell name ("with Heal Others",
   * "The Smush Skill", "+5 Arcane") and resolve it against the library.
   * Returns the library name or null. The book text says "Arcanist
   * skill" for the Douchy Wizard School Wand-Maker, but the Chapter 4
   * skill is "Arcane" — that alias is handled here. */
  function cleanCapName(part, findLib) {
    if (!findLib) return null;
    var n = String(part || '').trim()
      .replace(/^\s*(\+?\d+\s+|the\s+|a\s+|an\s+|with\s+|gains?\s+|gain\s+|and\s+|or\s+|of\s+|you\s+|your\s+)+/i, '')
      .replace(/\s+(skills?|spells?)\s*$/i, '')
      .replace(/^\s*(the\s+|a\s+|an\s+|with\s+|and\s+|or\s+|of\s+)+/i, '')
      .trim();
    if (!n) return null;
    var lib = findLib(n);
    if (lib) return lib.name;
    if (normName(n) === 'arcanist') { var arc = findLib('Arcane'); if (arc) return arc.name; }
    return null;
  }

  /* The rank cap for one card: 15 normally, 20 when a parsed cap rule
   * or a picked cap choice covers it. 'all' covers skills only (the
   * book's "All Skills"; spells are "Spells"). rules are the parsed
   * cap grants from the character's race + class; capPicks are the
   * player's picked cap choices ({name, cap: 20}). */
  function capForCard(card, rules, capPicks) {
    var cap = 15;
    var key = normName(card.name);
    (rules || []).forEach(function (g) {
      if (!g) return;
      if (g.type === 'all' && card.kind === 'skill') cap = 20;
      else if (g.type === 'crafting' && CRAFTING_SKILLS.indexOf(key) >= 0) cap = 20;
      else if (g.type === 'explosiveTrap' && (TRAP_SKILLS.indexOf(key) >= 0 || EXPLOSIVE_SKILLS.indexOf(key) >= 0)) cap = 20;
      else if (g.type === 'firearm' && FIREARM_SKILLS.indexOf(key) >= 0) cap = 20;
      else if (g.type === 'fixed' && normName(g.name) === key) cap = 20;
    });
    (capPicks || []).forEach(function (p) {
      if (p && p.cap === 20 && p.name && normName(p.name) === key) cap = 20;
    });
    return cap;
  }

  /* Skill sets for rank-cap and group-bonus rules. The trap/explosive
   * lists are the Hobgoblin group-bonus sets; the crafting list is the
   * set of skills with a crafting table (Table 44 types Alchemy,
   * Arcanist, Armorer, Engineering, Metalworking, Sapper's, Writing
   * map to Alchemy, Arcane, Smithing, Engineering, Explosives
   * Handling, Goblin Explosives, Calligraphy) plus Tattoo Artistry
   * (Table 45 Tattoos). Cooking has no crafting table. */
  var TRAP_SKILLS = ['trap engineer', 'find trap', 'detect trap'];
  var EXPLOSIVE_SKILLS = ['bomb surgeon', 'improvised explosive device', 'explosives handling', 'goblin explosives', 'incendiary device handling'];
  var CRAFTING_SKILLS = ['alchemy', 'arcane', 'calligraphy', 'engineering', 'explosives handling', 'goblin explosives', 'smithing', 'tattoo artistry'];

  /* Firearm skills (?v=50, Antony 2026-11-22): Gun Bunny's "All
   * One-handed Firearm Skills can be raised to Rank 20" covers ANY
   * skill involving a firearm — Handgun, Shotgun, anything like that.
   * The "one-handed" qualifier is overridden: Shotgun is two-handed
   * (book p.182, "Requires two hands to wield") and is included.
   * Pistol Whip is a melee attack made with a pistol, so it is in.
   * Closed by name, not by text matching. EXCLUDED: AIMING (utility,
   * p.184 — general ranged-attack support), Double Tap (utility,
   * p.190 — any weapon or Spell, not firearm-specific), GOLDEN GUN
   * (a "Handgun Damage Effect, Passive", not a firearm skill),
   * SLINGSHOT (attack, but not a firearm). */
  var FIREARM_SKILLS = ['handgun', 'shotgun', 'combat rifle', 'sniper rifle', 'long guns', 'smg', 'pistol whip'];

  /* Floor-driven natural attacks (see app.js FLOOR_ATTACKS): their
   * rank is the floor, never a trained rank, so no group bonus applies
   * to them. Keep in step with the app.js table. */
  var FLOOR_ATTACK_NAMES = ['tendrils', 'tongue lash',
    'black bear claw', 'claw', 'slam', 'bite', 'trash panda bite', 'hoden bite',
    'elemental breath', 'hand claw', 'horn gore', 'ursine claw', 'vampyr bite',
    'vampiric bite', 'hellfire spittle', 'wilting breath', 'bladed arms',
    'beak', 'shadow claws'];

  /* Descent-driven skills (?v=50, Antony 2026-11-22): HIJACK (granted
   * +3 by the Wannabe class) and FLASH CRAFTING (granted +3 by the Elf,
   * Christmas race) are granted at Rank 3 and rank up one level
   * whenever the crawler goes down a floor. The +3 fixed grant stays a
   * trained rank; the descent bump adds +1 to ownRank per floor
   * descended (app.js syncDescentSkillRanks, capped at the card's rank
   * cap). A card only counts when a raceClassApplied record ties it to
   * the granting race/class — a manually added HIJACK card does not
   * bump, and its rank stays freely editable. `applied` is the
   * state.raceClassApplied array: entries {source: 'race'|'class',
   * sourceName, skillName, kind, amount}. */
  var DESCENT_SKILLS = [
    { name: 'HIJACK', sourceKind: 'class', sourceName: 'Wannabe' },
    { name: 'FLASH CRAFTING', sourceKind: 'race', sourceName: 'Elf, Christmas' }
  ];
  function descentSkillSpec(name, applied) {
    var key = normName(name);
    for (var i = 0; i < DESCENT_SKILLS.length; i++) {
      var spec = DESCENT_SKILLS[i];
      if (normName(spec.name) !== key) continue;
      var tied = (applied || []).some(function (a) {
        return a.source === spec.sourceKind &&
          normName(a.sourceName) === normName(spec.sourceName) &&
          normName(a.skillName) === key;
      });
      if (tied) return spec;
    }
    return null;
  }
  function isDescentSkill(name, applied) { return !!descentSkillSpec(name, applied); }

  /* Group bonuses, as Rank adjustments. lib is the Chapter 4 entry for
   * the card (or null for custom cards); keywords is the spell's
   * keyword list (or []). floor is the character's current floor
   * (missing floor counts as 0, so a floor-gated group stays off).
   * Returns the total group amount. */
  function groupBonusFor(card, raceName, className, lib, keywords, floor) {
    var key = normName(card.name);
    // Floor-driven natural attacks (TENDRILS, TONGUE LASH) own their
    // rank from the floor: no group bonus ever applies to them, or a
    // Spellforge Smith's INT group would lift TENDRILS off its floor.
    if (FLOOR_ATTACK_NAMES.indexOf(key) >= 0) return 0;
    var statKey = card.stat || '';
    var isTrap = TRAP_SKILLS.indexOf(key) >= 0;
    var isExplosive = EXPLOSIVE_SKILLS.indexOf(key) >= 0;
    var isEdged = card.kind === 'skill' && lib && lib.kind === 'attack' &&
      (((lib.base_damage || '').indexOf('Slashing') >= 0) || ['dagger', 'rapier'].indexOf(key) >= 0);
    var isMuscleMove = ['running', 'climbing', 'swimming', 'jumping'].indexOf(key) >= 0;
    var isEfiSpell = card.kind === 'spell' && lib && /Electric|Fire|Ice/.test((lib.base_damage || '') + ' ' + (lib.effect || ''));
    var isHealSpell = card.kind === 'spell' && (keywords || []).some(function (k) { return k.toLowerCase() === 'heal'; });
    var isInt = (lib && lib.stat === 'INT') || statKey === 'int';
    var total = 0;
    [raceName, className].forEach(function (name) {
      if (!name) return;
      if (name === 'Tetrakai' && isEdged) total += 1;
      if (name === 'Skyfowl' && statKey === 'cha') total += 2;
      if (name === 'Hobgoblin' && (isTrap || isExplosive)) total += 3;
      if (name === 'Bomb Squad Tech' && isExplosive) total += 2;
      if (name === 'Shotgun Messenger' && isMuscleMove) total += 1;
      if ((name === 'Boring Ol\u2019 Monk' || name === 'Street Monk') && card.kind === 'skill' && lib && lib.kind === 'attack' && statKey === 'dex') total += 1;
      if (name === 'Elemental Monk' && isEfiSpell) total += 1;
      if (name === 'Lifebringer' && isHealSpell) total += 1;
      // Spellforge Smith: +1 to all Intelligence-based Skills, skills
      // AND spells (same as the Lifebringer Heal group), but only from
      // the 6th Floor — the master's eye sharpens once the forge is
      // proven. Below Floor 6 the group is 0.
      if (name === 'Spellforge Smith' && isInt && (floor == null ? 0 : floor) >= 6) total += 1;
    });
    return total;
  }

  /* Boring Ol' Mage: -3 effective Ranks in DEX/STR skills, min effective 1.
   * The Rank field itself never changes. */
  function magePenalty(card, raceName, className) {
    var isMage = raceName === 'Boring Ol\u2019 Mage' || className === 'Boring Ol\u2019 Mage';
    return (isMage && (card.stat === 'dex' || card.stat === 'str')) ? 3 : 0;
  }
  function effectiveRank(displayRankVal, card, raceName, className) {
    return Math.max(1, displayRankVal - magePenalty(card, raceName, className));
  }

  /* Attack damage-stat overrides (to-hit stat unchanged):
   * Cat Girl/Cat Boy Slice Attack damage uses CHA; Rat Hooligan Bite
   * damage uses DEX. Applies only when that race/class is selected. */
  function attackDamageStat(cardName, raceName, className) {
    var key = normName(cardName);
    if (key.indexOf('slice') >= 0 && (raceName === 'Cat Girl/Cat Boy' || className === 'Cat Girl/Cat Boy')) return 'cha';
    if (key.indexOf('bite') >= 0 && (raceName === 'Rat Hooligan' || className === 'Rat Hooligan')) return 'dex';
    return null;
  }

  function tigranMoveBonus(raceName, className) {
    return raceClassMoveBonus(raceName, className).move;
  }

  /* Flat Move/Step bonuses from a race/class (Tigran +10 Move;
   * Lizardfolk +5 Move, +5 Step). Hardcoded by name on purpose: the
   * benefits text also carries conditional Move ("+20ft Move when
   * flying", Obsidian Butterfly), so a text parser would over-apply.
   * ?v=49 adds the homebrew flat bonuses below. Conditional ones stay
   * text-only: Bear, Black / Bear, Dreadmaw / Mantaur quadruped Move,
   * Capoeirista (Amazing Success), Tursips (under water), Combat Medic
   * (Seconds Matter), Mad Chemist (while Enraged). */
  function raceClassMoveBonus(raceName, className) {
    var out = { move: 0, step: 0 };
    [raceName, className].forEach(function (name) {
      if (!name) return;
      if (name === 'Tigran') out.move += 10;
      if (name === 'Lizardfolk') { out.move += 5; out.step += 5; }
      // ?v=49 homebrew (flat, unconditional bonuses only)
      if (name === 'Blue-Spined Goblin') out.move += 15;
      if (name === 'Goblin') out.move += 5;
      if (name === 'Kobold, Draconic') out.step += 5;
      if (name === 'Kobold, Hoden') out.move += 5;
      if (name === 'Manbearpig') out.move += 5;
      if (name === 'Pazuzu') out.move += 5;
      if (name === 'Society Human, Gold') out.move += 5;
      if (name === 'Post-Nuclear Centaur') out.step += 5;
      if (name === 'Wraith, Gloom') out.step += 5;
      if (name === 'Ultimate Body Builder') out.step += 5;
      if (name === 'Dog, Working') out.move += 5;
      if (name === 'Slasher') out.step += 5;
      if (name === 'Handy Man') out.step += 5;
      if (name === 'Day Walker') out.move += 5;
      if (name === 'Brownie (Quickling)') out.step += 15;
      if (name === 'Nuckelavee') out.move += 10;
      if (name === 'Dwarf of Icecloak') out.move -= 5;
      if (name === 'Aerial Avenger') out.move += 10;
      if (name === 'Scared Paladin') out.step += 5;
      if (name === 'Orc (Syndicate)') out.step += 5;
      if (name === 'Operatics') out.step -= 5;
      if (name === 'Mantis (Female)') out.move += 5;
      if (name === 'Cassowary') out.move += 10;
      if (name === 'Glacial') out.step += 5;
    });
    return out;
  }


  /* ---- Resting (book Chapter 2, p.94; injuries p.96) --------------------
   * Short Rest (2 hours): heal 5 Health Bar slots, regain half total Mana
   * (floor of the maximum), rounded down; a Minor Injury ends, unless it
   * is long-term. Long Rest (8 hours): full Health and Mana, ends all
   * Fatigued, all Minor Injuries, and non-long-term Major Injuries.
   * Full Day's Rest (30 hours): full Health and Mana, ends all injuries
   * including long-term ones. Mending (1 full hour outside combat or
   * stress): +1 Health Bar slot, +5 Mana. Debuffs are plain strings, so
   * an injury is recognised by its wording: "Fatigued", "Minor Injury",
   * "Major Injury", with "long-term" marking the long-term kind.
   * External Buffs are deliberately untouched: the book lets them change
   * during a short rest, but that is the player's call, not an automatic
   * effect. "Used" flags are also untouched: they mark this turn, not
   * this day, so a rest must not clear them. */
  function injuryKind(s) {
    var t = (s || '').toLowerCase();
    var longTerm = /long[- ]?term/.test(t);
    if (/fatigued/.test(t)) return { kind: 'fatigued', longTerm: longTerm };
    if (/minor injury/.test(t)) return { kind: 'minor', longTerm: longTerm };
    if (/major injury/.test(t)) return { kind: 'major', longTerm: longTerm };
    return null;
  }
  function applyRest(type, hpSlots, mana, maxMana, debuffs) {
    var hp = clampInt(hpSlots, 0), mn = clampInt(mana, 0), mx = clampInt(maxMana, 0);
    var out = { hp: hp, mana: mn, debuffs: (debuffs || []).slice() };
    if (type === 'mend') {
      out.hp = Math.min(10, hp + 1);
      out.mana = Math.min(mx, mn + 5);
      return out;
    }
    if (type === 'short') {
      out.hp = Math.min(10, hp + 5);
      out.mana = Math.min(mx, mn + Math.floor(mx / 2));
      out.debuffs = out.debuffs.filter(function (d) {
        var k = injuryKind(d);
        return !(k && k.kind === 'minor' && !k.longTerm);
      });
      return out;
    }
    if (type === 'long' || type === 'fullday') {
      out.hp = 10;
      out.mana = mx;
      out.debuffs = out.debuffs.filter(function (d) {
        var k = injuryKind(d);
        if (!k) return true;
        if (k.kind === 'fatigued' || k.kind === 'minor') return false;
        if (k.kind === 'major') return type === 'long' ? k.longTerm : false;
        return true;
      });
      return out;
    }
    return out;
  }

  /* Attacks tab: a skill counts ONLY if its Chapter 4 Type line says
   * "Melee Attack" or "Ranged Attack" (book pp.177-183). That is 26
   * skills, not the 33 entries in the Attack Skills section: the 7
   * hand-to-hand Damage Effects on pp.180-181 (Choke Out, Dirty
   * Fighting, Iron Punch, Powerful Strike, Skullcracker, Smush, Toss)
   * are "X Damage Effect, Passive", not attacks, and must not appear
   * as attacks. A spell counts if its Chapter 4 keywords include
   * "Attack". Custom cards have no Type line or keyword list, so they
   * never count on their own. */
  var SKILL_ATTACK_TYPES = {
    'BITE': 'Melee Attack', 'BACK CLAW': 'Melee Attack', 'SLICE ATTACK': 'Melee Attack',
    'CLUB': 'Melee Attack', 'IMPROVISED WEAPONS': 'Melee Attack', 'WARHAMMER': 'Melee Attack',
    'AXE': 'Melee Attack', 'DAGGER': 'Melee Attack', 'LONGSWORD': 'Melee Attack', 'RAPIER': 'Melee Attack',
    'FOOT SOLDIER': 'Melee Attack', 'NOGGIN NOCKER': 'Melee Attack', 'PUGILISM': 'Melee Attack',
    'UNARMED COMBAT': 'Melee Attack', "WRASSLIN'": 'Melee Attack',
    'HERDING WEAPONS': 'Melee Attack', 'LANCE': 'Melee Attack', 'POLEARM': 'Melee Attack', 'QUARTERSTAFF': 'Melee Attack',
    'TENDRILS': 'Melee Attack',
    'TONGUE LASH': 'Melee Attack',
    // ?v=49 homebrew floor-driven natural attacks (see app.js
    // FLOOR_ATTACKS) and the Chakram weapon skill. BEAK has no stat in
    // its library entry — its card rolls d20 + rank with no stat mod.
    'BLACK BEAR CLAW': 'Melee Attack', 'CLAW': 'Melee Attack', 'SLAM': 'Melee Attack',
    'TRASH PANDA BITE': 'Melee Attack', 'HODEN BITE': 'Melee Attack',
    'HAND CLAW': 'Melee Attack', 'HORN GORE': 'Melee Attack', 'URSINE CLAW': 'Melee Attack',
    'VAMPYR BITE': 'Melee Attack', 'VAMPIRIC BITE': 'Melee Attack',
    'BLADED ARMS': 'Melee Attack', 'BEAK': 'Melee Attack', 'SHADOW CLAWS': 'Melee Attack',
    // ?v=50: PISTOL WHIP is a granted attack (Gun Bunny "+2 Pistol Whip"),
    // not floor-driven — it needs the type here or a granted card never
    // appears in the Attacks tab (skillAttackType returned null before).
    'PISTOL WHIP': 'Melee Attack',
    'ELEMENTAL BREATH': 'Ranged Attack', 'HELLFIRE SPITTLE': 'Ranged Attack',
    'WILTING BREATH': 'Ranged Attack', 'CHAKRAM': 'Ranged Attack',
    'BOW': 'Ranged Attack', 'CROSSBOW': 'Ranged Attack', 'HANDGUN': 'Ranged Attack', 'JAVELIN': 'Ranged Attack',
    'SHOTGUN': 'Ranged Attack', 'SHURIKEN': 'Ranged Attack', 'SLINGSHOT': 'Ranged Attack'
  };
  function skillAttackType(name) { return SKILL_ATTACK_TYPES[(name || '').trim().toUpperCase()] || null; }
  /* Damage Effects are conditional, not attacks: a Damage Effect only
   * applies when you use one of its parent attack skills and meet its
   * condition (e.g. Smush only with Foot Soldier, only against a
   * target at 20% Health Bar or less, once per round, x2 total
   * damage). Its library effect text names its parents up front:
   * "Foot Soldier Damage Effect, Passive. ..." or "Pugilism or
   * Wrasslin' Damage Effect, Passive. ...". This returns those parent
   * attack names, or [] for anything that is not a Damage Effect. */
  function damageEffectParents(effect) {
    var m = /^(.+?) Damage Effect, Passive/.exec((effect || '').replace(/[’‘]/g, "'"));
    if (!m) return [];
    return m[1].split(/,|\s+or\s+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  /* Spell keyword lookup keys are stored UPPERCASE in the data file
   * but looked up lowercased, so normalise the map on load — otherwise
   * every spell keyword lookup (Attack included) silently misses. */
  function normalizeKeywordMap(map) {
    var out = {};
    Object.keys(map || {}).forEach(function (k) { out[normName(k)] = map[k]; });
    return out;
  }
  /* Rank-adjusted damage for a derived attack card. The Attacks tab
   * used to show only base_damage, so ranking a skill up changed
   * nothing there even when the book adds dice at Rank 5/10/15
   * (Wrasslin' Rank 10: 1d4 + 1d4 at Rank 10 = 2d4 + Str Bludgeoning;
   * its Rank 5 upgrade is Held-related, not damage).
   * Only "+NdX base damage" upgrades are added — deliberately
   * conservative: multiplier upgrades ("base damage x3", "x2 the base
   * damage dice") and non-base-damage dice are left out, not guessed. */
  function adjustedDamage(base, upgrades, rank) {
    if (!base) return { damage: '—', additions: [] };
    var m = /^(\d+)d(\d+)(.*)$/.exec((base || '').trim());
    if (!m) return { damage: base, additions: [] };
    var additions = [];
    ['5', '10', '15'].forEach(function (t) {
      if (rank < parseInt(t, 10)) return;
      var u = (upgrades || {})[t] || '';
      var dm;
      var re = /\+(\d+)d(\d+) base damage/g;
      while ((dm = re.exec(u)) !== null) additions.push({ tier: parseInt(t, 10), count: parseInt(dm[1], 10), sides: parseInt(dm[2], 10) });
    });
    if (!additions.length) return { damage: base, additions: [] };
    var baseCount = parseInt(m[1], 10), baseSides = parseInt(m[2], 10), suffix = m[3] || '';
    var counts = {};
    counts[baseSides] = baseCount;
    additions.forEach(function (a) { counts[a.sides] = (counts[a.sides] || 0) + a.count; });
    var parts = [];
    Object.keys(counts).sort(function (a, b) { return (parseInt(a, 10) === baseSides ? -1 : parseInt(b, 10) === baseSides ? 1 : parseInt(a, 10) - parseInt(b, 10)); }).forEach(function (s) { parts.push(counts[s] + 'd' + s); });
    return { damage: parts.join(' + ') + suffix, additions: additions };
  }
  /* Damage calculation for a parent attack used with a Damage Effect.
   * Parent damage is first rank-adjusted (adjustedDamage), then the
   * effect's own dice are added: "+NdX base damage" in its base text
   * and in upgrades unlocked at its rank, plus "Add 1 Rank damage
   * die" upgrades (Table 37 die at the effect's rank). Multipliers
   * are kept separate from dice: Smush/Choke Out multiply the total
   * (last xN stated in base text or an unlocked upgrade wins),
   * Powerful Strike multiplies only the dice result, by its rank.
   * Effects with no damage change (Dirty Fighting) return the parent
   * damage unchanged. Returns dice parts, flat, suffix, multipliers
   * and a printable formula, so the app can roll it and then clear it. */
  function effectDamage(parentLib, parentRank, effectLib, effectRank) {
    var parentAdj = parentLib ? adjustedDamage(parentLib.base_damage, parentLib.upgrades, parentRank) : { damage: '—', additions: [] };
    var base = parentAdj.damage || '—';
    var terms = base.split(' + ');
    var dice = [], suffix = '';
    var i = 0;
    while (i < terms.length && /^\d+d\d+$/.test(terms[i])) { var dm = /^(\d+)d(\d+)$/.exec(terms[i]); dice.push({ count: parseInt(dm[1], 10), sides: parseInt(dm[2], 10) }); i++; }
    if (i < terms.length) suffix = ' + ' + terms.slice(i).join(' + ');
    if (!dice.length) return { dice: [], flat: 0, suffix: '', multiplier: 1, diceMultiplier: 1, formula: base, note: 'Damage has no dice to modify.' };
    var flat = 0, note = '';
    function addDice(count, sides) {
      var found = null;
      dice.forEach(function (d) { if (d.sides === sides) found = d; });
      if (found) found.count += count; else dice.push({ count: count, sides: sides });
    }
    function scanDice(text) {
      var re = /\+(\d+)d(\d+) base damage/g, m;
      while ((m = re.exec(text)) !== null) addDice(parseInt(m[1], 10), parseInt(m[2], 10));
      if (/Add 1 Rank damage die/.test(text)) {
        var die = rankDamageDie(effectRank);
        if (die === '+1') flat += 1;
        else die.split(' + ').forEach(function (t) { var p = /^(\d+)d(\d+)$/.exec(t); if (p) addDice(parseInt(p[1], 10), parseInt(p[2], 10)); });
      }
    }
    var effText = (effectLib && effectLib.base_effect) || '';
    scanDice(effText);
    ['5', '10', '15'].forEach(function (t) {
      if (effectRank >= parseInt(t, 10) && effectLib && effectLib.upgrades) scanDice(effectLib.upgrades[t] || '');
    });
    var multiplier = 1;
    var multTexts = [effText];
    ['5', '10', '15'].forEach(function (t) {
      if (effectRank >= parseInt(t, 10) && effectLib && effectLib.upgrades) multTexts.push(effectLib.upgrades[t] || '');
    });
    multTexts.forEach(function (tx) {
      var mm = /(?:x|deals x)(\d+)(?: the)? total damage/.exec(tx) || /deals x(\d+)/.exec(tx);
      if (mm) multiplier = parseInt(mm[1], 10);
    });
    var diceMultiplier = /Multiply your base damage dice result by your Rank/.test(effText) ? Math.max(1, effectRank) : 1;
    if (/same size as you/.test(effText)) note = 'Only if the target is the same size as you.';
    var formula = dice.map(function (d) { return d.count + 'd' + d.sides; }).join(' + ') + (flat ? ' + ' + flat : '') + suffix;
    if (multiplier > 1) formula += ' ×' + multiplier + ' total';
    if (diceMultiplier > 1) formula += ' (dice ×' + diceMultiplier + ')';
    return { dice: dice, flat: flat, suffix: suffix, multiplier: multiplier, diceMultiplier: diceMultiplier, formula: formula, note: note };
  }
  /* The stat a damage string is modified by, e.g. "1d2 + Str
   * Bludgeoning" -> 'str'. To-hit stat and damage stat are not
   * always the same: Pugilism is DEX to hit but STR damage, Noggin
   * Nocker is STR to hit but CON damage. Pending damage must use
   * this mod, not the to-hit mod. */
  function damageStatFromText(text) {
    var m = /\b(Str|Dex|Con|Int|Cha)\b/.exec(text || '');
    return m ? m[1].toLowerCase() : null;
  }
  function isAttackSkill(name) { return !!skillAttackType(name); }
  function isAttackSpell(keywords) {
    return (keywords || []).some(function (k) { return String(k).toLowerCase() === 'attack'; });
  }

  /* ---- Dice (plain Math.random; this is a tabletop aid, not a
   * cryptographic roller) ---------------------------------------------- */
  function rollDie(sides, rng) {
    var r = rng || Math.random;
    return Math.floor(r() * Math.max(1, clampInt(sides, 20))) + 1;
  }
  function parseDiceFormula(text) {
    var m = /^\s*(\d*)\s*d\s*(\d+)\s*([+-]\s*\d+)?\s*$/i.exec(text || '');
    if (!m) return null;
    var count = m[1] ? parseInt(m[1], 10) : 1;
    var sides = parseInt(m[2], 10);
    var mod = m[3] ? parseInt(m[3].replace(/\s+/g, ''), 10) : 0;
    if (count < 1 || count > 20 || sides < 2 || sides > 1000) return null;
    return { count: count, sides: sides, mod: mod };
  }
  function rollFormula(text, rng) {
    var f = parseDiceFormula(text);
    if (!f) return null;
    var rolls = [];
    for (var i = 0; i < f.count; i++) rolls.push(rollDie(f.sides, rng));
    var total = rolls.reduce(function (a, b) { return a + b; }, 0) + f.mod;
    return { count: f.count, sides: f.sides, mod: f.mod, rolls: rolls, total: total };
  }

  /* Conservative rulebook-item bonus parsing, run ONLY when a rulebook
   * item is picked (never on load, never on custom items). Only clear,
   * numeric patterns become structured bonuses the sheet can apply while
   * equipped; everything else stays as book text for the player to add by
   * hand. Skill grants only count when the named skill/spell is in the
   * Chapter 4 library, so a phrase naming something outside the library
   * stays text-only instead of inventing a card. At most 5 bonuses,
   * matching the sheet's per-item limit. */
  function parseItemBonuses(effect, libraryEntries) {
    var out = [];
    if (!effect) return out;
    var byName = {};
    (libraryEntries || []).forEach(function (e) { byName[normName(e.name)] = e; });
    function add(b) {
      for (var i = 0; i < out.length; i++) {
        var o = out[i];
        if (o.type === b.type && o.stat === b.stat && normName(o.skillName || '') === normName(b.skillName || '')) {
          o.amount += b.amount; return;
        }
      }
      if (out.length < 5) out.push(b);
    }
    var m, re;
    re = /\+(\d+)\s+(?:Damage Resistance|DR)(?![A-Za-z])/gi;
    while ((m = re.exec(effect))) add({ type: 'dr', amount: parseInt(m[1], 10) });
    re = /\+(\d+)\s+Evade(?![A-Za-z])/gi;
    while ((m = re.exec(effect))) add({ type: 'evade', amount: parseInt(m[1], 10) });
    var statMap = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', charisma: 'cha' };
    re = /\+(\d+)\s+(Strength|Dexterity|Constitution|Intelligence|Charisma)(?![- ]based)/gi;
    while ((m = re.exec(effect))) add({ type: 'stat', stat: statMap[m[2].toLowerCase()], amount: parseInt(m[1], 10) });
    re = /\+(\d+)\s+([A-Za-z][A-Za-z' \-]+?)\s+Skill\b/gi;
    while ((m = re.exec(effect))) {
      var lib = byName[normName(m[2].trim())];
      if (lib) add({ type: 'grant', skillName: lib.name, kind: lib.kind, amount: parseInt(m[1], 10) });
    }
    return out;
  }

  /* ---------------- gear taxonomy, slots, placements ----------------
   * Item taxonomy (Antony, 2026-11-03): every item has a required
   * kind — Gear, Consumable, Coupon, or Material/Misc. Gear names one
   * of eight slots; consumables name one of four subtypes; coupons
   * and material/misc take free-form text. Equip limits: 1 per single
   * slot, 2 for Hands/Holding (left + right), 10 for Accessories.
   * Placements are display strings: singles use their slot label,
   * holding uses 'Left Hand' / 'Right Hand', accessories use
   * 'Accessory 1'..'Accessory 10'. An equipped item's placement is
   * stored on the item; legacy equipped items (boolean true, no
   * placement) get one derived at render time. Bonuses still apply
   * from any truthy equipped flag, so grandfathered over-limit items
   * keep working until unequipped; new equips are refused when full. */
  var GEAR_SLOT_LABELS = ['Head', 'Torso', 'Arms', 'Hands/Gloves', 'Hands/Holding', 'Weapon 1 Hand', 'Weapon 2 Hand', 'Legs', 'Feet', 'Accessories'];
  var SLOT_LIMITS = { 'Head': 1, 'Torso': 1, 'Arms': 1, 'Hands/Gloves': 1, 'Hands/Holding': 2, 'Legs': 1, 'Feet': 1, 'Accessories': 10 };
  var CONSUMABLE_SUBTYPES = ['Potion', 'Scroll', 'Explosive', 'Spellbook'];
  function placementFamily(placement) {
    if (!placement) return null;
    if (placement === 'Left Hand' || placement === 'Right Hand' || placement === 'Both Hands') return 'Hands/Holding';
    if (/^Accessory \d+$/.test(placement)) return 'Accessories';
    return GEAR_SLOT_LABELS.indexOf(placement) >= 0 ? placement : null;
  }
  // Weapons live in the hands: a 1 Hand weapon takes one hand slot,
  // a 2 Hand weapon takes both (placement 'Both Hands').
  function slotFamily(slot) {
    if (slot === 'Weapon 1 Hand' || slot === 'Weapon 2 Hand') return 'Hands/Holding';
    return GEAR_SLOT_LABELS.indexOf(slot) >= 0 ? slot : null;
  }
  function placementFitsItem(placement, slot) {
    if (placement === 'Both Hands') return slot === 'Weapon 2 Hand';
    var fam = placementFamily(placement);
    if (fam === 'Hands/Holding') return slotFamily(slot) === 'Hands/Holding' && slot !== 'Weapon 2 Hand';
    if (fam === 'Accessories') return slot === 'Accessories';
    return slot === placement;
  }
  function normalizeKind(raw) {
    var v = String(raw || '').trim().toLowerCase();
    if (v === 'gear') return 'gear';
    if (v === 'consumable' || v === 'consumables') return 'consumable';
    if (v === 'coupon' || v === 'coupons') return 'coupon';
    if (v === 'material' || v === 'material/misc' || v === 'misc') return 'material';
    return 'material'; // mundane, other, map, missing: the anything-else bucket
  }
  // Canonical slot labels are the eight gear slots; anything else
  // (including the old 'Other' bucket) maps to null (unassigned — a
  // gear item with no slot cannot be equipped until the player picks
  // one), except weapons, which are held, so they map to
  // Hands/Holding. Non-gear items carry no slot at all.
  function normalizeSlot(raw) {
    if (!raw) return null;
    var v = String(raw).trim().toLowerCase();
    if (v === 'head') return 'Head';
    if (v === 'torso' || v === 'body' || v === 'chest') return 'Torso';
    if (v === 'arms' || v === 'arm') return 'Arms';
    if (v === 'hands/gloves' || v === 'gloves' || v === 'glove') return 'Hands/Gloves';
    if (v === 'weapon 1 hand' || v === 'weapon 1-hand' || v === 'weapon 1hand') return 'Weapon 1 Hand';
    if (v === 'weapon 2 hand' || v === 'weapon 2-hand' || v === 'weapon 2hand' || v === 'weapon 2 hands') return 'Weapon 2 Hand';
    if (v === 'hand' || v === 'hands' || v === 'hand/holding' || v === 'hands/holding' || v === 'holding' || v === 'weapon') return 'Hands/Holding';
    if (v === 'legs' || v === 'leg') return 'Legs';
    if (v === 'feet' || v === 'foot') return 'Feet';
    if (v === 'accessory' || v === 'accessories') return 'Accessories';
    return null;
  }
  function slotOccupants(items, familyLabel) {
    return (items || []).filter(function (it) {
      if (!it.equipped) return false;
      if (it.placement) return placementFamily(it.placement) === familyLabel;
      return slotFamily(it.slot) === familyLabel;
    });
  }
  // Hands count by capacity, not by item: a 2 Hand weapon fills both.
  function handUsed(items) {
    var n = 0;
    slotOccupants(items, 'Hands/Holding').forEach(function (it) {
      n += it.placement === 'Both Hands' ? 2 : 1;
    });
    return n;
  }
  function freePlacement(items, slotLabel) {
    var fam = slotFamily(slotLabel) || slotLabel;
    if (fam === 'Hands/Holding') {
      if (slotLabel === 'Weapon 2 Hand') return handUsed(items) === 0 ? 'Both Hands' : null;
      var occ = slotOccupants(items, 'Hands/Holding').map(function (it) { return it.placement; });
      if (occ.indexOf('Both Hands') >= 0) return null;
      if (occ.indexOf('Right Hand') < 0) return 'Right Hand';
      if (occ.indexOf('Left Hand') < 0) return 'Left Hand';
      return null;
    }
    if (fam === 'Accessories') {
      var occA = slotOccupants(items, 'Accessories').map(function (it) { return it.placement; });
      for (var i = 1; i <= 10; i++) if (occA.indexOf('Accessory ' + i) < 0) return 'Accessory ' + i;
      return null;
    }
    var occS = slotOccupants(items, fam);
    return occS.length === 0 ? fam : null;
  }
  function derivePlacements(items) {
    var map = {};
    var placed = [];
    (items || []).forEach(function (it) {
      if (it.equipped && it.placement && placementFamily(it.placement)) { map[it.id] = it.placement; placed.push(it.placement); }
    });
    (items || []).forEach(function (it) {
      if (!it.equipped || map[it.id]) return;
      if (!it.slot) { map[it.id] = null; return; }
      var fam = slotFamily(it.slot);
      var free = null;
      if (fam === 'Hands/Holding') {
        if (it.slot === 'Weapon 2 Hand') {
          if (placed.indexOf('Right Hand') < 0 && placed.indexOf('Left Hand') < 0 && placed.indexOf('Both Hands') < 0) free = 'Both Hands';
        } else if (placed.indexOf('Both Hands') < 0) {
          if (placed.indexOf('Right Hand') < 0) free = 'Right Hand';
          else if (placed.indexOf('Left Hand') < 0) free = 'Left Hand';
        }
      } else if (fam === 'Accessories') {
        for (var i = 1; i <= 10; i++) if (placed.indexOf('Accessory ' + i) < 0) { free = 'Accessory ' + i; break; }
      } else if (fam && placed.indexOf(it.slot) < 0) free = it.slot;
      map[it.id] = free;
      if (free) placed.push(free);
    });
    return map;
  }
  function equipInto(items, id, placement) {
    var it = (items || []).find(function (x) { return x.id === id; });
    if (!it) return 'Item not found.';
    if (it.kind !== 'gear') return 'Only gear can be equipped.';
    if (!it.slot) return 'Assign a slot to this gear first (Inventory).';
    var fam = placementFamily(placement);
    if (!fam) return 'Unknown slot.';
    if (!placementFitsItem(placement, it.slot)) {
      if (it.slot === 'Weapon 2 Hand') return 'This is a 2 Hand weapon: it takes both hands.';
      return 'This gear goes in ' + it.slot + ', not ' + fam + '.';
    }
    var occ = slotOccupants(items, fam);
    var alreadyThere = occ.some(function (o) { return o.id === id; });
    var fullMsg = function () { return fam + ' is full' + (occ[0] ? ' (' + occ[0].name + ' is equipped there)' : '') + '. Unequip that first, or use a loadout.'; };
    if (fam === 'Hands/Holding') {
      if (it.slot === 'Weapon 2 Hand') {
        if (!alreadyThere && occ.length > 0) return fullMsg();
      } else {
        if (!alreadyThere && handUsed(items) >= 2) return fullMsg();
        var taken = occ.some(function (o) { return o.placement === placement; });
        if (taken && !alreadyThere) return placement + ' is already taken.';
      }
    } else if (fam === 'Accessories') {
      if (!alreadyThere && occ.length >= 10) return fullMsg();
      var takenAcc = occ.some(function (o) { return o.placement === placement; });
      if (takenAcc && !alreadyThere) return placement + ' is already taken.';
    } else {
      if (!alreadyThere && occ.length >= 1) return fullMsg();
    }
    it.equipped = true;
    it.placement = placement || it.slot;
    return null;
  }
  function unequip(items, id) {
    var it = (items || []).find(function (x) { return x.id === id; });
    if (!it) return;
    it.equipped = false;
    it.placement = null;
  }

  /* ---------------- consumable picks (book loot list, pp.216-218) ----
   * Rulebook consumables mapped to the use payload the sheet needs:
   * potions by effect, dynamites by damage, scrolls/spellbooks by
   * subtype (the spell itself is designated by the player/DM, since
   * the book lists them generically). Bandages carry a standalone
   * debuff removal. Anything unlisted arrives generic: confirmation
   * shows its effect text and one unit is consumed. There is no
   * general explosives table in the book — the two dynamites below
   * are the listed explosives, each with its own damage, blast, and
   * splash; area rules (blast full, splash half) are applied as text. */
  var CONSUMABLE_PICK = {
    'Healing Potion': { subtype: 'Potion', use: { potionKind: 'heal', potionAmount: 5 } },
    'Good Healing Potion': { subtype: 'Potion', use: { potionKind: 'heal', potionAmount: 6 } },
    'Gold Standard Healing Potion': { subtype: 'Potion', use: { potionKind: 'heal', potionAmount: 7, potionNote: 'Mends one Minor Injury' } },
    'Supreme Healing Potion': { subtype: 'Potion', use: { potionKind: 'heal', potionAmount: 8, potionNote: 'Mends one Minor or Major Injury, or deals 8d8 Holy damage to an undead Mob' } },
    'Heal Severe Injury Potion': { subtype: 'Potion', use: { potionKind: 'heal', potionAmount: 9, potionNote: 'Mends all Injuries' } },
    'Mana Potion': { subtype: 'Potion', use: { potionKind: 'manaFull' } },
    'Good Mana Refill Potion': { subtype: 'Potion', use: { potionKind: 'manaOverTime', potionAmount: 15, potionRounds: 10 } },
    'Heal Pet Potion': { subtype: 'Potion', use: { potionKind: 'healPet', potionAmount: 5 } },
    'Poison Antidote': { subtype: 'Potion', use: { potionKind: 'removeDebuff', potionMatch: 'poison' } },
    'Crawler Biscuits': { subtype: 'Potion', use: { potionKind: 'food' } },
    'Potion of +1 Skill': { subtype: 'Potion', use: { potionKind: 'skillBoost', potionAmount: 1 } },
    'Potion of +2 Skill': { subtype: 'Potion', use: { potionKind: 'skillBoost', potionAmount: 2 } },
    'Potion of +3 Skill': { subtype: 'Potion', use: { potionKind: 'skillBoost', potionAmount: 3 } },
    'Potion of +5 Skill': { subtype: 'Potion', use: { potionKind: 'skillBoost', potionAmount: 5 } },
    'Bandages': { subtype: null, use: { removeDebuff: 'blood trail' } },
    'Stick of Basic Dynamite': { subtype: 'Explosive', use: { damage: '1d6', damageType: 'Bludgeoning', blast: '0ft', splash: '+5ft' } },
    'Stick of Good Goblin Dynamite': { subtype: 'Explosive', use: { damage: '2d6', damageType: 'Bludgeoning', blast: '5ft', splash: '+5ft' } },
    'Spell Scroll': { subtype: 'Scroll', use: {} },
    'Rare Spell Scroll': { subtype: 'Scroll', use: {} },
    'Magic Tome': { subtype: 'Spellbook', use: {} },
    'Spellbook': { subtype: 'Spellbook', use: {} },
    'Rare Spellbook': { subtype: 'Spellbook', use: {} },
    'Scroll of Upgrade': { subtype: 'Scroll', use: {} }
  };
  function consumablePickFor(name) {
    if (!name) return null;
    var key = Object.keys(CONSUMABLE_PICK).find(function (k) { return normName(k) === normName(name); });
    if (!key) return null;
    var p = CONSUMABLE_PICK[key];
    return { subtype: p.subtype, use: Object.assign({}, p.use) };
  }

  /* ---- Floor-3 race/class prerequisites (?v=48) ----------------------
   * A race/class entry's `prerequisites` prose is free text. parsePrereqs
   * recognises only the mechanical forms below; anything else is returned
   * as a display-only note and NEVER blocks a pick. Achievements are
   * never checks (Antony, 2026-11-09): any mention of an achievement is
   * display-only, as are gender and anything else unrecognised.
   * Recognised forms (case-insensitive):
   *  - Popularity: "Popularity 3+", "Popularity 3 or higher", "3 or more Popularity"
   *  - Named skill rank: "Rank 5+ in the Smush Skill"; an "or" list
   *    ("Rank 5+ in the Jumping or Light on Your Feet Skill") is one
   *    check satisfied by any one of the named skills.
   *  - Stat-based skill: "at least one Strength or Dexterity-based Skill at Rank 5+"
   *  - Category: "Rank 5+ with any Edged Weapon", "any Trap-based Skill"
   *  - Stat minimum: "Strength 5+"
   *  - Player Kills: "3 Player Kills", "must have killed a crawler" (min 1)
   *  - Club: a name from the sheet's club set (below)
   *  - Deity: "worship the Armorer", "must worship a deity" (any deity set)
   *  - DM approval: "DM approval", "DM's approval" (satisfied by a checkbox)
   *  - Race: "already a Cat", "cat-based Races, such as Cat, Cat Girl, and Tigran"
   * checkPrereqs(checks, ctx) evaluates the parsed checks against a
   * context the app builds from the live sheet:
   *   { stats: {str,con,dex,int,cha} (displayed totals),
   *     skills: [{name, rank, stat, isEdged, isTrap, isExplosive}],
   *     popularity, pkKills, clubs: [names], deity, race, dmApproved }
   * Skill ranks are the DISPLAYED rank (what the sheet shows). */
  var CLUBS = ['Desperado Club', 'Club Vanquisher', 'Dungeon Book of the Floor Club'];
  var STAT_WORDS = ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Charisma'];

  function prereqLabel(type, parts) {
    if (type === 'popularity') return 'Popularity ' + parts.min + '+';
    if (type === 'skill') return parts.name + ' Rank ' + parts.min + '+';
    if (type === 'skillOr') return parts.names.join(' or ') + ' Rank ' + parts.min + '+ (any one)';
    if (type === 'statSkill') return 'any ' + parts.stats.map(function (s) { return STAT_NAMES[s]; }).join('/') + '-based Skill Rank ' + parts.min + '+';
    if (type === 'category') return 'any ' + (parts.category === 'edged' ? 'Edged Weapon' : parts.category === 'trap' ? 'Trap-based Skill' : 'Explosive Skill') + ' Rank ' + parts.min + '+';
    if (type === 'stat') return STAT_NAMES[parts.stat] + ' ' + parts.min + '+';
    if (type === 'pk') return 'Player Kills ' + parts.min + '+';
    if (type === 'club') return 'Member of ' + parts.name;
    if (type === 'deity') return parts.name ? 'Worships ' + parts.name : 'Worships a deity';
    if (type === 'dmApproval') return 'DM approval (tick the box)';
    if (type === 'race') return 'Race: ' + parts.names.join(' or ');
    return '';
  }
  function prereqCheck(type, parts) {
    var c = { type: type, label: prereqLabel(type, parts) };
    Object.keys(parts).forEach(function (k) { c[k] = parts[k]; });
    return c;
  }
  function parsePrereqs(text) {
    var out = { checks: [], display: [] };
    var raw = (text || '').trim();
    if (!raw) return out;
    function dedupeKey(c) {
      return c.type + '|' + (c.name || '') + '|' + (c.names || []).join(',') + '|' + (c.stat || '') + '|' + (c.stats || []).join(',') + '|' + (c.category || '') + '|' + (c.min || '');
    }
    var seen = {};
    function push(c) { var k = dedupeKey(c); if (!seen[k]) { seen[k] = true; out.checks.push(c); } }
    function cleanName(n) {
      return (n || '').replace(/^(the|a|an)\s+/i, '').replace(/[\s,.;]+$/g, '').trim();
    }
    function splitNames(s) {
      return (s || '').split(/,|\s+and\s+|\s+or\s+/).map(cleanName).filter(function (n) { return n.length > 0; });
    }
    raw.split(/[.;]\s*/).forEach(function (sentence) {
      var s = sentence.trim();
      if (!s) return;
      // Strip the boilerplate lead-in; what is left is the requirement.
      s = s.replace(/^\s*this limited (race|class) is only available to crawlers who('ve)?\s+/i, '')
        .replace(/^\s*this limited (race|class) is only available to\s+/i, '')
        .replace(/^\s*must have\s+/i, '')
        .replace(/\s*,?\s*to take this (class|race)\s*$/i, '');
      if (!s) return;
      var before = out.checks.length;
      var work = ' ' + s + ' ';
      var rankInSentence = null;
      var rm = work.match(/rank\s+(\d+)\+?/i);
      if (rm) rankInSentence = parseInt(rm[1], 10);
      function cut(re) {
        var m = work.match(re);
        if (!m) return null;
        work = work.replace(m[0], ' ');
        return m;
      }
      // 1. Stat-based skill ("at least one Strength or Dexterity-based Skill at Rank 5+").
      var m = cut(/at least one ((?:strength|dexterity|constitution|intelligence|charisma)(?:\s+or\s+(?:strength|dexterity|constitution|intelligence|charisma))*)-based skills?\s+at\s+rank\s+(\d+)\+?/i);
      if (m) {
        push(prereqCheck('statSkill', { stats: m[1].split(/\s+or\s+/).map(function (w) { return STAT_ABBR[w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()]; }).filter(Boolean), min: parseInt(m[2], 10) }));
      }
      // 2. Named skill ranks, possibly an "or" list ("Rank 5+ in the Jumping or Light on Your Feet Skill").
      var nm;
      while ((nm = cut(/rank\s+(\d+)\+?\s+in\s+(?:the\s+)?(.+?)\s+skill/i))) {
        var names = splitNames(nm[2]);
        if (names.length > 1) push(prereqCheck('skillOr', { names: names, min: parseInt(nm[1], 10) }));
        else if (names.length === 1) push(prereqCheck('skill', { name: names[0], min: parseInt(nm[1], 10) }));
      }
      // 3. Categories ("Rank 5+ with any Edged Weapon", "any Trap-based Skill").
      m = cut(/rank\s+(\d+)\+?\s+with\s+any\s+edged\s+weapon/i);
      if (m) push(prereqCheck('category', { category: 'edged', min: parseInt(m[1], 10) }));
      if (/any\s+trap-based\s+skill/i.test(work)) {
        cut(/any\s+trap-based\s+skill/i);
        if (rankInSentence) push(prereqCheck('category', { category: 'trap', min: rankInSentence }));
      }
      if (/any\s+explosive[a-z ]*skill/i.test(work)) {
        cut(/any\s+explosive[a-z ]*skill/i);
        if (rankInSentence) push(prereqCheck('category', { category: 'explosive', min: rankInSentence }));
      }
      // 4. Popularity.
      m = cut(/popularity\s+(\d+)\s*(?:\+|or\s+(?:higher|more|greater))/i) || cut(/(\d+)\s+or more popularity/i);
      if (m) push(prereqCheck('popularity', { min: parseInt(m[1], 10) }));
      // 5. Plain stat minimum ("Strength 5+"). Runs after the stat-skill
      // form above so "-based Skill" never false-positives here.
      m = cut(/\b(strength|dexterity|constitution|intelligence|charisma)\s+(\d+)\+/i);
      if (m) push(prereqCheck('stat', { stat: STAT_ABBR[m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()], min: parseInt(m[2], 10) }));
      // 6. Player Kills.
      m = cut(/(\d+)\s+player kills?/i) || cut(/killed\s+(\d+)\s+crawlers?/i);
      if (m) push(prereqCheck('pk', { min: parseInt(m[1], 10) }));
      else if (cut(/must have killed\s+(?:a|an|one)\s+crawler/i) || cut(/kill(?:ed|ing)?\s+(?:a\s+|an\s+)?crawler/i)) push(prereqCheck('pk', { min: 1 }));
      // 7. Club membership (a club name in the prerequisites).
      CLUBS.forEach(function (club) {
        if (new RegExp(club.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(work)) {
          work = work.replace(new RegExp(club.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
          push(prereqCheck('club', { name: club }));
        }
      });
      // 8. Deity.
      m = cut(/worship(?:s|ping)?\s+(?:the\s+)?([A-Z][A-Za-z'’\-]+(?:\s+[A-Z][A-Za-z'’\-]+)*)/);
      if (m) push(prereqCheck('deity', { name: cleanName(m[1]) }));
      else if (cut(/must worship a deity/i)) push(prereqCheck('deity', { name: null }));
      // 9. DM approval.
      if (cut(/dm'?s?\s+approval/i) || cut(/dungeon master'?s?\s+approval/i)) push(prereqCheck('dmApproval', {}));
      // 10. Race ("already a Cat", "cat-based Races, such as Cat, Cat Girl, and Tigran").
      // ?v=49: case-insensitive "already" — a prereq that OPENS with
      // "Already a X" (sentence-initial capital) must parse like the
      // mid-sentence "already a X" the book entries use.
      m = cut(/already a\s+([A-Z][A-Za-z'’\/ ]+?)(?:\.|,|\s+and\s+|$)/i);
      if (m) push(prereqCheck('race', { names: [cleanName(m[1])] }));
      m = cut(/races?,?\s+such as\s+(.+?)(?:\.|$)/i);
      if (m) {
        var rnames = splitNames(m[1]);
        if (rnames.length) push(prereqCheck('race', { names: rnames }));
      }
      // Whatever is left, after stripping connectors, is display-only.
      var got = out.checks.length - before;
      if (!got) {
        // No mechanical check came out of this sentence: show the
        // requirement itself, verbatim (minus boilerplate), as a note.
        var verbatim = s.replace(/^(only\s+)?available to\s+/i, '').replace(/\s*,?\s*to take this (class|race)\s*$/i, '').trim();
        if (verbatim.length >= 4) out.display.push(verbatim);
      } else {
        var stop = /^(and|or|with|who|have|has|earn|earned|earning|attained|receiving|to|a|an|the|only|available|limited|cat|based|crawlers?|must|be|is|are|in|of|on|for|at|by|this|that|it|also|take|least)$/i;
        var rest = work.replace(/[^A-Za-z0-9'’! ]+/g, ' ').split(/\s+/).filter(function (w) { return w && !stop.test(w); }).join(' ').trim();
        if (rest.length >= 4) out.display.push(rest);
      }
    });
    return out;
  }
  function checkPrereqs(checks, ctx) {
    var c = ctx || {};
    var skills = c.skills || [];
    function skillByName(name) {
      var key = normName(name);
      for (var i = 0; i < skills.length; i++) if (normName(skills[i].name) === key) return skills[i];
      return null;
    }
    function raceMatches(want) {
      var cur = normName(c.race || '');
      if (!cur) return false;
      // "Cat Girl" matches the "Cat Girl/Cat Boy" entry (slash segments),
      // but "Cat" must NOT match "Cat Girl/Cat Boy".
      return cur.split('/').some(function (seg) { return normName(seg) === normName(want); });
    }
    // Deity names compare with a leading "The" ignored, so a stored
    // "The Armorer" matches a parsed "worship the Armorer".
    function deityKey(s) { return normName((s || '').replace(/^the\s+/i, '')); }
    var results = (checks || []).map(function (ch) {
      var pass = false;
      if (ch.type === 'popularity') pass = (c.popularity || 0) >= ch.min;
      else if (ch.type === 'skill') { var sk = skillByName(ch.name); pass = !!sk && (sk.rank || 0) >= ch.min; }
      else if (ch.type === 'skillOr') pass = ch.names.some(function (n) { var sk2 = skillByName(n); return !!sk2 && (sk2.rank || 0) >= ch.min; });
      else if (ch.type === 'statSkill') pass = skills.some(function (sk3) { return ch.stats.indexOf((sk3.stat || '').toLowerCase()) >= 0 && (sk3.rank || 0) >= ch.min; });
      else if (ch.type === 'category') pass = skills.some(function (sk4) {
        return (sk4.rank || 0) >= ch.min && ((ch.category === 'edged' && sk4.isEdged) || (ch.category === 'trap' && sk4.isTrap) || (ch.category === 'explosive' && sk4.isExplosive));
      });
      else if (ch.type === 'stat') pass = ((c.stats || {})[ch.stat] || 0) >= ch.min;
      else if (ch.type === 'pk') pass = (c.pkKills || 0) >= ch.min;
      else if (ch.type === 'club') pass = (c.clubs || []).some(function (cl) { return normName(cl) === normName(ch.name); });
      else if (ch.type === 'deity') pass = ch.name ? deityKey(c.deity) === deityKey(ch.name) : !!(c.deity || '');
      else if (ch.type === 'dmApproval') pass = !!c.dmApproved;
      else if (ch.type === 'race') pass = ch.names.some(function (n) { return raceMatches(n); });
      return { check: ch, label: ch.label, pass: pass };
    });
    return { results: results, pass: results.every(function (r) { return r.pass; }) };
  }

  /* Category flags for prereq checks: same classification as
   * groupBonusFor's isEdged/isTrap/isExplosive (an edged weapon is an
   * attack skill whose damage is Slashing, plus Dagger and Rapier). */
  function prereqSkillFlags(card, lib) {
    var key = normName(card.name);
    return {
      isEdged: card.kind === 'skill' && lib && lib.kind === 'attack' &&
        (((lib.base_damage || '').indexOf('Slashing') >= 0) || ['dagger', 'rapier'].indexOf(key) >= 0),
      isTrap: TRAP_SKILLS.indexOf(key) >= 0,
      isExplosive: EXPLOSIVE_SKILLS.indexOf(key) >= 0
    };
  }

  /* Floor-3 confirmation requirement (?v=48): the race/class
   * confirmation is outstanding while the crawler is on floor 3 or
   * higher and has not confirmed. Pure, so the node suite can test it. */
  function floor3Required(floor, confirmed) {
    return (floor || 0) >= 3 && !confirmed;
  }

  var api = {
    STAT_KEYS: STAT_KEYS, STAT_NAMES: STAT_NAMES, STAT_ABBR: STAT_ABBR,
    getModifier: getModifier, derivedBase: derivedBase, displayedBase: displayedBase, ownBaseForDisplayed: ownBaseForDisplayed, statTotal: statTotal,
    ownEnhForTotal: ownEnhForTotal,
    statCapFor: statCapFor, statBank: statBank,
    maxHpSlots: maxHpSlots, totalHp: totalHp, maxMana: maxMana,
    evadeString: evadeString, totalDR: totalDR,
    evadeBuffsInText: evadeBuffsInText, skillEvadeBuff: skillEvadeBuff,
    rankDamageDie: rankDamageDie, naturesBreathHealFormula: naturesBreathHealFormula,
    displayRank: displayRank, combinedFloor: combinedFloor,
    ownRankForTotal: ownRankForTotal, shouldRemoveCard: shouldRemoveCard,
    foldBackgroundRank: foldBackgroundRank, foldRaceClassRank: foldRaceClassRank,
    parseRaceClassStats: parseRaceClassStats, parseRaceClassSplit: parseRaceClassSplit,
    parseRaceClassDR: parseRaceClassDR, evadeDiceCount: evadeDiceCount,
    healthBarUsesCha: healthBarUsesCha, parseFixedSkillBonuses: parseFixedSkillBonuses,
    parseChoiceGrants: parseChoiceGrants, groupBonusFor: groupBonusFor,
    parseCapGrants: parseCapGrants, capForCard: capForCard, CRAFTING_SKILLS: CRAFTING_SKILLS,
    TRAP_SKILLS: TRAP_SKILLS, EXPLOSIVE_SKILLS: EXPLOSIVE_SKILLS, FIREARM_SKILLS: FIREARM_SKILLS,
    CLUBS: CLUBS, parsePrereqs: parsePrereqs, checkPrereqs: checkPrereqs, prereqSkillFlags: prereqSkillFlags,
    floor3Required: floor3Required,
    magePenalty: magePenalty, effectiveRank: effectiveRank,
    attackDamageStat: attackDamageStat, tigranMoveBonus: tigranMoveBonus, raceClassMoveBonus: raceClassMoveBonus,
    FLOOR_ATTACK_NAMES: FLOOR_ATTACK_NAMES,
    DESCENT_SKILLS: DESCENT_SKILLS, descentSkillSpec: descentSkillSpec, isDescentSkill: isDescentSkill,
    normName: normName, clampInt: clampInt, normalizeSlot: normalizeSlot, parseItemBonuses: parseItemBonuses,
    GEAR_SLOT_LABELS: GEAR_SLOT_LABELS, SLOT_LIMITS: SLOT_LIMITS, CONSUMABLE_SUBTYPES: CONSUMABLE_SUBTYPES,
    placementFamily: placementFamily, normalizeKind: normalizeKind,
    slotFamily: slotFamily, placementFitsItem: placementFitsItem, handUsed: handUsed,
    consumablePickFor: consumablePickFor,
    slotOccupants: slotOccupants, freePlacement: freePlacement, derivePlacements: derivePlacements,
    equipInto: equipInto, unequip: unequip,
    applyRest: applyRest, rollDie: rollDie, parseDiceFormula: parseDiceFormula, rollFormula: rollFormula,
    isAttackSkill: isAttackSkill, skillAttackType: skillAttackType, isAttackSpell: isAttackSpell,
    damageEffectParents: damageEffectParents, normalizeKeywordMap: normalizeKeywordMap, adjustedDamage: adjustedDamage, effectDamage: effectDamage, damageStatFromText: damageStatFromText
  };
  global.DCCRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
