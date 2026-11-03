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

  /* Derived Base = own base + positive fixed race/class bonuses + split
   * assignments. Penalties are NOT in Base; they subtract from Total. */
  function derivedBase(ownBase, fixedStats, splitAssignments) {
    var out = {};
    STAT_KEYS.forEach(function (k) {
      var own = Math.max(1, clampInt(ownBase[k], 1));
      var fixed = (fixedStats[k] || 0);
      var split = (splitAssignments[k] || 0);
      out[k] = own + Math.max(0, fixed) + split;
    });
    return out;
  }

  function statTotal(derived, enh, gear, penalty, cap) {
    var total = Math.max(1, derived + enh + gear + penalty);
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
  function shouldRemoveCard(card, gearGiven, raceGiven, groupGiven, backgroundGiven) {
    return (card.ownRank || 0) <= 0 && combinedFloor(gearGiven, raceGiven, groupGiven, backgroundGiven) <= 0;
  }
  /* One-time split for cards created before background ranks became a
   * given source: those cards stored the background rank inside ownRank
   * (e.g. ownRank 3 with backgroundRank 3). Split it out so the display
   * stays identical (ownRank 0 + background 3 = 3) while the floor now
   * protects it. A card a player had wrongly lowered below its given
   * rank (ownRank 1, backgroundRank 3) is repaired by this to display 3.
   * Idempotent via bgSplit; new background cards are created split. */
  function splitBackgroundRank(card) {
    if (card.background && (card.backgroundRank || 0) > 0 && !card.bgSplit) {
      card.ownRank = Math.max(0, (card.ownRank || 0) - card.backgroundRank);
      card.bgSplit = true;
    }
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
    var re = /\+(\d+)\s+([^.;+]+)/g;
    var m;
    while ((m = re.exec(b)) !== null) {
      var segment = m[2];
      if (/choice|chosen/i.test(segment)) continue; // choice grants live in Choices, not here
      var amt = parseInt(m[1], 10);
      var txt = segment.replace(/\bSkills?\b|\bSpells?\b/gi, '').trim().replace(/,$/, '').trim().replace(/\s+and\s*$/, '').trim();
      if (!txt) continue;
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
      var key = amount + '|' + count + '|' + category + '|' + (options || []).join(',');
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

  /* Group bonuses, as Rank adjustments. lib is the Chapter 4 entry for
   * the card (or null for custom cards); keywords is the spell's
   * keyword list (or []). Returns the total group amount. */
  function groupBonusFor(card, raceName, className, lib, keywords) {
    var key = normName(card.name);
    var statKey = card.stat || '';
    var isTrap = ['trap engineer', 'find trap', 'detect trap'].indexOf(key) >= 0;
    var isExplosive = ['bomb surgeon', 'improvised explosive device', 'explosives handling', 'goblin explosives', 'incendiary device handling'].indexOf(key) >= 0;
    var isEdged = card.kind === 'skill' && lib && lib.kind === 'attack' &&
      (((lib.base_damage || '').indexOf('Slashing') >= 0) || ['dagger', 'rapier'].indexOf(key) >= 0);
    var isMuscleMove = ['running', 'climbing', 'swimming', 'jumping'].indexOf(key) >= 0;
    var isEfiSpell = card.kind === 'spell' && lib && /Electric|Fire|Ice/.test((lib.base_damage || '') + ' ' + (lib.effect || ''));
    var isHealSpell = card.kind === 'spell' && (keywords || []).some(function (k) { return k.toLowerCase() === 'heal'; });
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
    return (raceName === 'Tigran' || className === 'Tigran') ? 10 : 0;
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

  /* Item slot normalisation: the rulebook lists slots like "Hands/Holding"
   * or "Hand/Holding"; the sheet's slot set uses "Hands". Unknown slots
   * fall back to "Other" rather than silently landing on the first option
   * of a dropdown (which is how a Hands item once displayed as Head). */
  function normalizeSlot(raw) {
    if (!raw) return 'Other';
    var v = String(raw).trim().toLowerCase();
    if (v === 'hand' || v === 'hands' || v === 'hand/holding' || v === 'hands/holding' || v === 'holding') return 'Hands';
    if (v === 'head') return 'Head';
    if (v === 'torso' || v === 'body' || v === 'chest') return 'Torso';
    if (v === 'legs' || v === 'leg') return 'Legs';
    if (v === 'feet' || v === 'foot') return 'Feet';
    if (v === 'accessory') return 'Accessory';
    if (v === 'weapon') return 'Weapon';
    if (v === 'other') return 'Other';
    return 'Other';
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

  var api = {
    STAT_KEYS: STAT_KEYS, STAT_NAMES: STAT_NAMES, STAT_ABBR: STAT_ABBR,
    getModifier: getModifier, derivedBase: derivedBase, statTotal: statTotal,
    statCapFor: statCapFor, statBank: statBank,
    maxHpSlots: maxHpSlots, totalHp: totalHp, maxMana: maxMana,
    evadeString: evadeString, totalDR: totalDR,
    rankDamageDie: rankDamageDie, naturesBreathHealFormula: naturesBreathHealFormula,
    displayRank: displayRank, combinedFloor: combinedFloor,
    ownRankForTotal: ownRankForTotal, shouldRemoveCard: shouldRemoveCard,
    splitBackgroundRank: splitBackgroundRank,
    parseRaceClassStats: parseRaceClassStats, parseRaceClassSplit: parseRaceClassSplit,
    parseRaceClassDR: parseRaceClassDR, evadeDiceCount: evadeDiceCount,
    healthBarUsesCha: healthBarUsesCha, parseFixedSkillBonuses: parseFixedSkillBonuses,
    parseChoiceGrants: parseChoiceGrants, groupBonusFor: groupBonusFor,
    magePenalty: magePenalty, effectiveRank: effectiveRank,
    attackDamageStat: attackDamageStat, tigranMoveBonus: tigranMoveBonus,
    normName: normName, clampInt: clampInt, normalizeSlot: normalizeSlot, parseItemBonuses: parseItemBonuses,
    applyRest: applyRest, rollDie: rollDie, parseDiceFormula: parseDiceFormula, rollFormula: rollFormula,
    isAttackSkill: isAttackSkill, skillAttackType: skillAttackType, isAttackSpell: isAttackSpell,
    damageEffectParents: damageEffectParents, normalizeKeywordMap: normalizeKeywordMap, adjustedDamage: adjustedDamage, effectDamage: effectDamage, damageStatFromText: damageStatFromText
  };
  global.DCCRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
