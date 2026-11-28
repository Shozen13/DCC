/* Node test for js/rules.js (pure functions only — no DOM, no app state).
 * Run: node tests/test_rules.js
 */
const R = require('../js/rules.js');
let pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log('PASS', label); }
  else { fail++; console.log('FAIL', label, '| got', JSON.stringify(actual), '| want', JSON.stringify(expected)); }
}

// Modifier bands
[[1, 1], [2, 1], [3, 2], [5, 2], [6, 3], [9, 3], [10, 4], [19, 4], [20, 5], [49, 5]].forEach(([v, want]) => eq(R.getModifier(v), want, 'modifier ' + v));
// Rank damage dice, Table 37
[[1, '+1'], [2, '1d2'], [3, '1d2'], [4, '1d4'], [5, '1d4'], [6, '1d6'], [8, '1d8'], [10, '1d10'], [12, '1d12'], [14, '1d8 + 1d6'], [16, '2d8'], [18, '1d10 + 1d8'], [20, '2d10']].forEach(([v, want]) => eq(R.rankDamageDie(v), want, 'rank die ' + v));
// Nature's Breath heal (cumulative upgrade bonus)
eq(R.naturesBreathHealFormula(3), '1d2 slots', 'NB rank 3');
eq(R.naturesBreathHealFormula(5), '1d4 + 1 slots', 'NB rank 5');
eq(R.naturesBreathHealFormula(10), '1d10 + 2 slots', 'NB rank 10');
eq(R.naturesBreathHealFormula(15), '1d8 + 1d6 + 3 slots', 'NB rank 15');
// Stat bank
eq(R.statBank(1, 0), 0, 'bank level 1');
eq(R.statBank(10, 0), 27, 'bank level 10 (book example)');
eq(R.statBank(4, 5), 4, 'bank level 4 spent 5');
// Stored base is own base only (derivedBase); the DISPLAYED Base adds
// the race/class term (displayedBase, ?v=53). Enhanced Total =
// displayed Base + Enhance + Gear, minimum Total 1
eq(R.derivedBase({ str: 5, con: 5, dex: 5, int: 5, cha: 5 }),
  { str: 5, con: 5, dex: 5, int: 5, cha: 5 }, 'derived base is own base only');
eq(R.derivedBase({ str: 0, con: 3, dex: 1, int: 1, cha: 1 }),
  { str: 1, con: 3, dex: 1, int: 1, cha: 1 }, 'derived base minimum 1');
eq(R.statTotal(5, 0, 0, -4, null), 1, 'total minimum 1 with -4 penalty on base 5? (5-4=1)');
eq(R.statTotal(10, 0, 0, 0, 10), 10, 'cap applied');
eq(R.statTotal(5, 0, 0, 3, null), 8, 'race/class +3 adds to total');
eq(R.statTotal(5, 2, 1, 2, null), 10, 'total = base + enh + gear + race/class');
eq(R.statTotal(8, 0, 0, 5, 10), 10, 'total capped');
// Enhance back-compute: typing a total sets ownEnh (like displayed rank)
eq(R.ownEnhForTotal(10, 5, 1, 2, null), 2, 'enh back-compute 10 - 5 - 1 - 2 = 2');
eq(R.ownEnhForTotal(3, 5, 0, 0, null), 0, 'enh cannot go below base');
eq(R.ownEnhForTotal(20, 5, 0, 0, 10), 5, 'enh back-compute respects cap');
eq(R.ownEnhForTotal(10, 5, 1, -1, null), 5, 'enh back-compute with penalty');
// Displayed Base (?v=53, DM ruling 2026-11-27): Base shown = own base
// + race/class term; typing a displayed Base back-computes own base.
eq(R.displayedBase(41, 6), 47, 'Tony INT displayed base 41 + 6 = 47');
eq(R.displayedBase(10, 2), 12, 'Tony CON displayed base 10 + 2 = 12');
eq(R.displayedBase(10, 1), 11, 'Tony DEX displayed base 10 + 1 = 11');
eq(R.displayedBase(3, 2), 5, 'Human displayed base own + 2');
eq(R.displayedBase(5, -1), 4, 'negative race/class term lowers displayed base');
eq(R.displayedBase(1, -1), 1, 'displayed base minimum 1 (Primal own 1, -1)');
eq(R.ownBaseForDisplayed(47, 6), 41, 'base back-compute 47 - 6 = 41');
eq(R.ownBaseForDisplayed(12, 2), 10, 'base back-compute 12 - 2 = 10');
eq(R.ownBaseForDisplayed(4, -1), 5, 'base back-compute with penalty 4 - (-1) = 5');
eq(R.ownBaseForDisplayed(1, -1), 2, 'base back-compute clamp edge: displayed 1 with -1 stores 2');
eq(R.statCapFor('Hobgoblin', '', 'cha'), 10, 'Hobgoblin CHA cap');
eq(R.statCapFor('Pocket Kuma', '', 'str'), 10, 'Pocket Kuma STR cap');
eq(R.statCapFor('Human', '', 'cha'), null, 'no cap for Human');
// Rank floor / removal model: rank = own + gear + race + group
const card = { ownRank: 1 };
eq(R.displayRank(card, 0, 2, 1), 4, 'display rank 1 trained + 2 fixed + 1 group = 4');
eq(R.combinedFloor(0, 2, 1), 3, 'combined floor = sum of given');
eq(R.ownRankForTotal(2, 0, 2, 1), 0, 'manual lowering below floor snaps to floor (own 0)');
eq(R.ownRankForTotal(5, 0, 2, 1), 2, 'manual rank 5 with given 3 -> own 2');
eq(R.shouldRemoveCard({ ownRank: 0 }, 0, 0, 0), true, 'bonus-only card removed when all given amounts go');
eq(R.shouldRemoveCard({ ownRank: 1 }, 0, 0, 0), false, 'trained card survives removal of all given amounts');
eq(R.shouldRemoveCard({ ownRank: 0 }, 0, 0, 0, 0, true), false, 'Rank-0 card held by a race/class record survives prune (?v=47.7)');
eq(R.shouldRemoveCard({ ownRank: 0 }, 0, 0, 0, 0, false), true, 'Rank-0 card with no record is still pruned (?v=47.7)');
// Group bonuses
const healCard = { name: "NATURE'S BREATH", kind: 'spell', stat: '' };
eq(R.groupBonusFor(healCard, 'Lifebringer', '', null, ['Heal', 'Interrupt', 'Passive']), 1, 'Lifebringer Heal via keywords');
eq(R.groupBonusFor({ name: 'Running', kind: 'skill', stat: 'str' }, 'Shotgun Messenger', '', null, []), 1, 'Shotgun Messenger muscle movement');
eq(R.groupBonusFor({ name: 'Running', kind: 'skill', stat: 'str' }, 'Human', '', null, []), 0, 'no group bonus for Human');
eq(R.magePenalty({ name: 'Dagger', kind: 'skill', stat: 'dex' }, '', 'Boring Ol\u2019 Mage'), 3, 'Mage -3 DEX skill');
eq(R.effectiveRank(4, { name: 'Dagger', kind: 'skill', stat: 'dex' }, '', 'Boring Ol\u2019 Mage'), 1, 'Mage effective rank min 1');
// Parsers
eq(R.parseRaceClassStats({ name: 'Human', benefits: '' }), { str: 2, con: 2, dex: 2, int: 2, cha: 2 }, 'Human +2 all');
eq(R.parseRaceClassSplit({ name: 'Elf, City', benefits: '+6 split as you please between Intelligence, Dexterity, and Charisma' }),
  [{ pool: 6, stats: ['int', 'dex', 'cha'] }], 'Elf City split');
eq(R.parseRaceClassSplit({ name: 'Professional Roadie', benefits: 'Gains +8 split between Strength, Constitution, and Charisma' }),
  [{ pool: 8, stats: ['str', 'con', 'cha'] }], 'Roadie split');
const lib = (n) => {
  const map = { 'first aid': { name: 'First Aid', kind: 'utility' }, 'pathfinder': { name: 'Pathfinder', kind: 'utility' }, 'regeneration': { name: 'Regeneration', kind: 'utility' }, 'survival': { name: 'Survival', kind: 'utility' }, "nature's breath": { name: "NATURE'S BREATH", kind: 'spell' } };
  return map[n.toLowerCase()] || null;
};
eq(R.parseFixedSkillBonuses({ name: 'Lifebringer', benefits: 'Gains +2 Constitution and +1 Intelligence, +2 First Aid, Pathfinder, Regeneration, and Survival, +2 Nature\'s Breath Spell, and +1 Rank in all Spells with the Heal keyword.' }, lib),
  [{ name: 'First Aid', kind: 'utility', amount: 2 }, { name: 'Pathfinder', kind: 'utility', amount: 2 }, { name: 'Regeneration', kind: 'utility', amount: 2 }, { name: 'Survival', kind: 'utility', amount: 2 }, { name: "NATURE'S BREATH", kind: 'spell', amount: 2 }],
  'Lifebringer fixed parse (no bogus Rank-in-all / stat cards)');
eq(R.parseChoiceGrants({ name: 'Obsidian Butterfly', benefits: '+2 in a Spell of your choice.' }),
  [{ amount: 2, count: 1, category: 'spell', label: 'Spell', options: null }], 'choice grant: spell of choice');
eq(R.tigranMoveBonus('Tigran', ''), 10, 'Tigran Move +10');
eq(R.attackDamageStat('Slice Attack', 'Cat Girl/Cat Boy', ''), 'cha', 'Cat Girl Slice CHA damage');
eq(R.attackDamageStat('Bite', 'Rat Hooligan', ''), 'dex', 'Rat Hooligan Bite DEX damage');
eq(R.totalDR(5, 2, 1), 8, 'DR = Armor + Buffs + Race/Class');
eq(R.evadeString(3, 1, 0, 0), 'd20 + 1d4 + 3', 'evade string with 1d4');
eq(R.totalHp(4), 40, 'HP = 10 slots x mod 4');

// Item slot normalisation + rulebook bonus parsing (live-test fixes)
eq(R.normalizeSlot('Hand/Holding'), 'Hands/Holding', 'buckler slot Hand/Holding -> Hands/Holding');
eq(R.normalizeSlot('Hands/Holding'), 'Hands/Holding', 'slot Hands/Holding stays');
eq(R.normalizeSlot('Head'), 'Head', 'slot Head unchanged');
eq(R.normalizeSlot('Mystery Slot'), null, 'unknown slot -> unassigned');
eq(R.parseItemBonuses('Grants +1 Shield Block Skill and +3 Damage Resistance. Listed Gear Slot is Hands/Holding;', []),
  [{ type: 'dr', amount: 3 }], 'buckler: DR 3 only when the library is empty (grant needs a library entry)');
eq(R.parseItemBonuses('+2 Strength and +1 First Aid Skill', [{ name: 'FIRST AID', kind: 'skill' }]),
  [{ type: 'stat', stat: 'str', amount: 2 }, { type: 'grant', skillName: 'FIRST AID', kind: 'skill', amount: 1 }], 'item stat + grant parse');
eq(R.parseItemBonuses('A plain cloak with no numbers.', []), [], 'item with no bonuses parses to empty');
// Resting (book Ch.2 p.94, injuries p.96)
eq(R.applyRest('mend', 5, 3, 10, []), { hp: 6, mana: 8, debuffs: [] }, 'mend: +1 slot, +5 mana');
eq(R.applyRest('mend', 10, 10, 10, []), { hp: 10, mana: 10, debuffs: [] }, 'mend capped at full');
eq(R.applyRest('short', 2, 1, 10, ['Minor Injury', 'Long-term Minor Injury', 'Fatigued']),
  { hp: 7, mana: 6, debuffs: ['Long-term Minor Injury', 'Fatigued'] }, 'short rest: +5 slots, +half mana, plain Minor ends only');
eq(R.applyRest('long', 0, 0, 7, ['Fatigued', 'Minor Injury', 'Long-term Minor Injury', 'Major Injury', 'Long-term Major Injury', 'Blessed']),
  { hp: 10, mana: 7, debuffs: ['Long-term Major Injury', 'Blessed'] }, 'long rest: full, long-term Major survives');
eq(R.applyRest('fullday', 0, 0, 7, ['Fatigued', 'Long-term Major Injury']),
  { hp: 10, mana: 7, debuffs: [] }, 'full day rest: full, all injuries end');
// Dice (deterministic rng stubs)
eq(R.rollDie(20, () => 0), 1, 'die roll rng 0 -> 1');
eq(R.rollDie(20, () => 0.999), 20, 'die roll rng ~1 -> max');
eq(R.parseDiceFormula('1d20+5'), { count: 1, sides: 20, mod: 5 }, 'parse 1d20+5');
eq(R.parseDiceFormula('d6'), { count: 1, sides: 6, mod: 0 }, 'parse bare d6');
eq(R.parseDiceFormula('2d6 - 1'), { count: 2, sides: 6, mod: -1 }, 'parse 2d6-1 with spaces');
eq(R.parseDiceFormula('banana'), null, 'parse rejects non-dice text');
eq(R.parseDiceFormula('0d20'), null, 'parse rejects 0 dice');
eq(R.rollFormula('2d6+1', () => 0.5), { count: 2, sides: 6, mod: 1, rolls: [4, 4], total: 9 }, 'roll 2d6+1 with fixed rng');
// Attacks tab: only skills whose Type line says Melee/Ranged Attack count
eq(R.skillAttackType('Club'), 'Melee Attack', 'Club is Melee Attack');
eq(R.skillAttackType('Shuriken'), 'Ranged Attack', 'Shuriken is Ranged Attack');
eq(R.isAttackSkill('Club'), true, 'Melee Attack skill counts');
eq(R.isAttackSkill('Smush'), false, 'Smush is a Damage Effect, Passive — not an attack');
eq(R.isAttackSkill('Choke Out'), false, 'Choke Out is a Damage Effect, Passive — not an attack');
eq(R.isAttackSkill('Cooking'), false, 'utility skill does not count');
eq(R.isAttackSkill('Made Up Skill'), false, 'custom skill (no Type line) does not count');
eq(R.damageEffectParents('Foot Soldier Damage Effect, Passive. Only applies to targets with 20% Health Bar or less.'), ['Foot Soldier'], 'Smush parents: Foot Soldier');
eq(R.damageEffectParents('Foot Soldier, Noggin Nocker, or Pugilism Damage Effect, Passive. Cooldown: 30 hours.'), ['Foot Soldier', 'Noggin Nocker', 'Pugilism'], 'Powerful Strike parents: three attacks');
eq(R.damageEffectParents('Pugilism or Wrasslin’ Damage Effect, Passive.'), ['Pugilism', "Wrasslin'"], 'Dirty Fighting parents, curly apostrophe normalised');
eq(R.damageEffectParents('Wrasslin’ Damage Effect, Passive.'), ["Wrasslin'"], 'Choke Out/Toss parent: Wrasslin');
eq(R.damageEffectParents('Pugilism Damage Effect, Passive.'), ['Pugilism'], 'Iron Punch parent: Pugilism');
eq(R.damageEffectParents('Noggin Nocker Damage Effect, Passive.'), ['Noggin Nocker'], 'Skullcracker parent: Noggin Nocker');
// All 7 Damage Effects from the real data, each with at least one parent
const fs2 = require('fs');
const libAll2 = JSON.parse(fs2.readFileSync(__dirname + '/../data/skills_spells.json', 'utf8'));
const de = libAll2.filter(e => R.damageEffectParents(e.base_effect).length > 0);
// Rank-adjusted damage: additive "+NdX base damage" upgrades only
const wras = libAll2.find(e => e.name === "WRASSLIN'");
eq(R.adjustedDamage(wras.base_damage, wras.upgrades, 4).damage, '1d4 + Str Bludgeoning', 'Wrasslin Rank 4: base only');
eq(R.adjustedDamage(wras.base_damage, wras.upgrades, 10).damage, '2d4 + Str Bludgeoning', 'Wrasslin Rank 10: 1d4 + 1d4 (R10 only; R5 is Held, not damage)');
eq(R.adjustedDamage(wras.base_damage, wras.upgrades, 15).damage, '3d4 + Str Bludgeoning', 'Wrasslin Rank 15: 3d4');
const un = libAll2.find(e => e.name === 'UNARMED COMBAT');
eq(R.adjustedDamage(un.base_damage, un.upgrades, 15).damage, '5d4 + Str Bludgeoning', 'Unarmed Rank 15: 1d4 + 1d4 + 1d4 + 2d4');
const fb = libAll2.find(e => e.name === 'FIREBALL');
eq(R.adjustedDamage(fb.base_damage, fb.upgrades, 5).damage, '2d12 + Int Fire, 10ft Blast radius', 'Fireball Rank 5: blast radius suffix preserved');
eq(R.adjustedDamage('1d4 + Int Necrotic', libAll2.find(e => e.name === 'SOUL COLLECTOR').upgrades, 10).damage, '3d4 + Int Necrotic', 'Soul Collector Rank 10: 3d4');
// Available Damage Effects for Wrasslin' come from the same parent map
eq(de.filter(e => R.damageEffectParents(e.base_effect).some(p => p === "Wrasslin'")).map(e => e.name).sort(), ['CHOKE OUT', 'DIRTY FIGHTING', 'TOSS'], 'Wrasslin available Damage Effects');
// Effect damage: Pugilism + Iron Punch at Rank 1 is the user's example
const pug = libAll2.find(e => e.name === 'PUGILISM');
const iron = libAll2.find(e => e.name === 'IRON PUNCH');
eq(R.effectDamage(pug, 1, iron, 1).formula, '2d2 + Str Bludgeoning', 'Pugilism + Iron Punch Rank 1: 1d2 + 1d2');
eq(R.effectDamage(pug, 1, iron, 5).formula, '2d2 + 1d4 + Str Bludgeoning', 'Iron Punch Rank 5: +1d2 base + 1 Rank damage die (1d4 at Rank 5)');
const foot = libAll2.find(e => e.name === 'FOOT SOLDIER');
const smush = libAll2.find(e => e.name === 'SMUSH');
eq(R.effectDamage(foot, 1, smush, 1).multiplier, 2, 'Smush Rank 1: x2 total');
eq(R.effectDamage(foot, 1, smush, 15).multiplier, 4, 'Smush Rank 15: x4 total');
const ps = libAll2.find(e => e.name === 'POWERFUL STRIKE');
eq(R.effectDamage(foot, 1, ps, 3).diceMultiplier, 3, 'Powerful Strike Rank 3: dice x3');
const dirty = libAll2.find(e => e.name === 'DIRTY FIGHTING');
eq(R.effectDamage(pug, 1, dirty, 1).formula, '1d2 + Str Bludgeoning', 'Dirty Fighting: no damage change');
// Damage stat vs to-hit stat: Pugilism hits DEX, damages STR; Noggin Nocker hits STR, damages CON
eq(R.damageStatFromText(pug.base_damage), 'str', 'Pugilism damage stat is STR');
eq(libAll2.find(e => e.name === 'PUGILISM').stat, 'DEX', 'Pugilism to-hit stat is DEX (book data)');
eq(R.damageStatFromText(libAll2.find(e => e.name === 'NOGGIN NOCKER').base_damage), 'con', 'Noggin Nocker damage stat is CON');
eq(R.damageStatFromText('1d4 Piercing'), null, 'No stat word in damage: null');
eq(de.map(e => e.name).sort(), ['ASSASSINATE', 'CHOKE OUT', 'DIRTY FIGHTING', 'GOLDEN GUN', 'IRON PUNCH', 'POWERFUL STRIKE', 'REND', 'SKULLCRACKER', 'SMUSH', 'TOSS'], 'exactly 10 Damage Effects in the library (7 book + 3 homebrew: REND, GOLDEN GUN, ASSASSINATE)');
eq(de.every(e => R.damageEffectParents(e.base_effect).length >= 1), true, 'every Damage Effect names a parent attack');
eq(R.damageEffectParents('Melee bashing weapon attack with no additional base effect stated.'), [], 'Club is not a Damage Effect');
eq(R.normalizeKeywordMap({ 'FIREBALL': ['Attack', 'Fire'] }), { 'fireball': ['Attack', 'Fire'] }, 'keyword map keys normalised to lowercase');
eq(R.isAttackSpell(['Attack', 'Fire']), true, 'Attack-keyword spell counts');
eq(R.isAttackSpell(['Heal', 'Passive']), false, 'Heal spell does not count');
eq(R.isAttackSpell([]), false, 'spell with no keywords does not count');
// Backgrounds data (book Tables 12-15): shape + every skill in the library
const fs = require('fs');
const bg = JSON.parse(fs.readFileSync(__dirname + '/../data/backgrounds.json', 'utf8'));
const libAll = JSON.parse(fs.readFileSync(__dirname + '/../data/skills_spells.json', 'utf8'));
const libNames = new Set(libAll.map(e => e.name.toUpperCase()));
eq(bg.categories.length, 4, 'backgrounds: 4 categories');
eq(bg.categories.map(c => c.backgrounds.length), [12, 12, 12, 12], 'backgrounds: 12 per category');
eq(bg.categories.map(c => c.rank), [1, 1, 3, 2], 'background ranks 1/1/3/2');
let bgBad = [];
bg.categories.forEach(c => c.backgrounds.forEach(b => {
  if (b.skills.length !== 3) bgBad.push(b.name);
  b.skills.forEach(sk => { if (!libNames.has(sk.name.toUpperCase())) bgBad.push(sk.name); });
}));
eq(bgBad, [], 'backgrounds: every skill in Chapter 4 library');
eq(bg.combat_weapons.every(w => libNames.has(w.toUpperCase())), true, 'background combat weapons in library');

// Background given source (merged fix 2026-11-03)
eq(R.displayRank({ ownRank: 1 }, 0, 0, 0, 3), 4, 'display rank trained 1 + background 3 = 4');
eq(R.combinedFloor(0, 0, 0, 3), 3, 'background floor 3 alone');
eq(R.ownRankForTotal(2, 0, 0, 0, 3), 0, 'lowering below background floor snaps to floor (own 0, display 3)');
eq(R.ownRankForTotal(5, 0, 0, 0, 3), 2, 'rank 5 with background 3 -> own 2');
eq(R.shouldRemoveCard({ ownRank: 0 }, 0, 0, 0, 3), false, 'background-only card survives while background gives it');
eq(R.shouldRemoveCard({ ownRank: 0, backgroundRank: 3 }, 0, 0, 0, 0), false, 'Rank-0 card with a background floor survives prune (?v=47.7)');
(function () {
  var c = R.foldBackgroundRank({ background: true, backgroundRank: 3, ownRank: 0 });
  eq(c.ownRank, 3, 'fold: background 3 becomes trained 3');
  eq(c.backgroundRank, 3, 'fold keeps backgroundRank as the protection floor');
  eq(c.bgFolded, true, 'fold marks the card folded');
  eq(R.displayRank(c, 0, 0, 0, 0), 3, 'folded card still displays 3');
  var legacy = R.foldBackgroundRank({ background: true, backgroundRank: 3, ownRank: 3 });
  eq(legacy.ownRank, 3, 'fold repairs old double-count (own 3 + bg 3 -> trained 3, not 6)');
  var trained = R.foldBackgroundRank({ background: true, backgroundRank: 3, ownRank: 2, bgSplit: true });
  eq(trained.ownRank, 5, 'fold keeps trained ranks: own 2 + background 3 -> trained 5');
  var twice = R.foldBackgroundRank(c);
  eq(twice.ownRank, 3, 'fold is idempotent (no second add)');
  var rec = R.foldBackgroundRank({ background: true, backgroundRank: 0, ownRank: 3, bgSplit: true, name: 'Cooking' }, { career: { bg: 'Chef', skills: ['First Aid'] } });
  eq(rec.backgroundRank, 0, 'fold does not invent a floor for a skill outside the saved backgrounds');
  var rec2 = R.foldBackgroundRank({ background: true, backgroundRank: 0, ownRank: 3, bgSplit: true, name: 'First Aid' }, { career: { bg: 'Chef', skills: ['First Aid'] } });
  eq(rec2.backgroundRank, 3, 'fold recovers a cleared backgroundRank from the saved career pick');
  var rec3 = R.foldBackgroundRank({ background: true, backgroundRank: 0, ownRank: 3, bgSplit: true, name: 'UNARMED COMBAT' }, { combat: { type: 'weapon', name: 'Longsword' } });
  eq(rec3.backgroundRank, 3, 'fold recovers the combat background rank for Unarmed Combat');
})();

// Race/class grants are trained ranks (?v=47.5): foldRaceClassRank folds
// the granted amounts into ownRank once, keeping the entries as the
// reversal/protection record.
(function () {
  var applied = [
    { source: 'race', sourceName: 'Elf, High', skillName: 'Dodge', kind: 'skill', amount: 2 },
    { source: 'class', sourceName: 'Artist Alley Mogul', skillName: 'Dodge', kind: 'skill', amount: 1 },
    { source: 'race', sourceName: 'Elf, High', skillName: 'Heal Others', kind: 'spell', amount: 1 }
  ];
  var c = R.foldRaceClassRank({ name: 'Dodge', kind: 'skill', ownRank: 0 }, applied);
  eq(c.ownRank, 3, 'fold: race 2 + class 1 become trained 3');
  eq(c.rcFolded, true, 'fold marks the card folded');
  eq(R.displayRank(c, 0, 0, 0, 0), 3, 'folded card displays 3 with no race term');
  var twice = R.foldRaceClassRank(c, applied);
  eq(twice.ownRank, 3, 'fold is idempotent (no second add)');
  var trained = R.foldRaceClassRank({ name: 'Dodge', kind: 'skill', ownRank: 3 }, applied);
  eq(trained.ownRank, 6, 'fold keeps trained ranks: own 3 + grants 3 -> trained 6');
  var spell = R.foldRaceClassRank({ name: 'Heal Others', kind: 'spell', ownRank: 0 }, applied);
  eq(spell.ownRank, 1, 'fold matches kind: spell grant does not touch a skill card');
  var other = R.foldRaceClassRank({ name: 'First Aid', kind: 'skill', ownRank: 2 }, applied);
  eq(other.ownRank, 2, 'fold ignores entries for other skills');
  var none = R.foldRaceClassRank({ name: 'Dodge', kind: 'skill', ownRank: 2 }, []);
  eq(none.ownRank, 2, 'fold with no entries leaves ownRank alone but still marks folded');
  eq(none.rcFolded, true, 'fold marks folded even with no entries');
  // Negative grants (?v=47.6): a penalty folds off the trained rank,
  // clamped at 0, and the fold is idempotent like the positive one.
  var neg = R.foldRaceClassRank({ name: 'UNARMED COMBAT', kind: 'skill', ownRank: 4 },
    [{ source: 'class', sourceName: 'Spellforge Smith', skillName: 'UNARMED COMBAT', kind: 'skill', amount: -2 }]);
  eq(neg.ownRank, 2, 'fold: -2 penalty on own 4 -> trained 2');
  var negClamp = R.foldRaceClassRank({ name: 'UNARMED COMBAT', kind: 'skill', ownRank: 1 },
    [{ source: 'class', sourceName: 'Spellforge Smith', skillName: 'UNARMED COMBAT', kind: 'skill', amount: -2 }]);
  eq(negClamp.ownRank, 0, 'fold: -2 penalty on own 1 clamps at 0');
  eq(R.foldRaceClassRank(neg, [{ source: 'class', sourceName: 'Spellforge Smith', skillName: 'UNARMED COMBAT', kind: 'skill', amount: -2 }]).ownRank, 2,
    'fold: negative fold is idempotent (no second take)');
})();

// ?v=47.6: Spellforge Smith INT group (floor-gated) and Lizardfolk.
// The INT group is +1 for INT-stat skills AND spells from Floor 6,
// 0 below Floor 6, and never applies to floor-driven attacks.
(function () {
  var rc = require('../data/races_classes.json');
  var libData = require('../data/skills_spells.json');
  var byName = {};
  libData.forEach(function (e) { byName[e.name.toLowerCase()] = e; });
  var realLib = function (n) { return byName[(n || '').toLowerCase()] || null; };
  var sf = rc.find(function (e) { return e.name === 'Spellforge Smith'; });
  var lz = rc.find(function (e) { return e.name === 'Lizardfolk'; });
  // Spellforge Smith parses
  eq(R.parseRaceClassStats(sf), { str: 0, con: 0, dex: 1, int: 2, cha: 0 }, 'Spellforge Smith: +2 INT, +1 DEX');
  eq(R.parseFixedSkillBonuses(sf, realLib).map(function (g) { return g.name + ':' + g.amount; }),
    ['Smithing:2', 'FIREBALL:1', 'MAGIC MISSILE:1', 'Arcane:1', 'Engineering:1', 'UNARMED COMBAT:-2'],
    'Spellforge Smith: fixed grants incl. -2 Unarmed Combat, no bogus INT-group card');
  eq(R.parseChoiceGrants(sf), [], 'Spellforge Smith: no choice grants');
  eq(R.parseCapGrants(sf, realLib).map(function (r) { return r.name; }), ['Smithing'], 'Spellforge Smith: Smithing to Rank 20');
  eq(R.capForCard({ name: 'Smithing', kind: 'skill' }, R.parseCapGrants(sf, realLib), []), 20, 'cap: Smithing 20 under Spellforge Smith');
  // INT group, floor-gated
  eq(R.groupBonusFor({ name: 'FIREBALL', kind: 'spell', stat: 'int' }, '', 'Spellforge Smith', realLib('FIREBALL'), [], 3), 0, 'INT group: 0 below Floor 6 (spell)');
  eq(R.groupBonusFor({ name: 'FIREBALL', kind: 'spell', stat: 'int' }, '', 'Spellforge Smith', realLib('FIREBALL'), [], 6), 1, 'INT group: +1 from Floor 6 (spell)');
  eq(R.groupBonusFor({ name: 'Arcane', kind: 'skill', stat: 'int' }, '', 'Spellforge Smith', realLib('Arcane'), [], 6), 1, 'INT group: +1 from Floor 6 (skill)');
  eq(R.groupBonusFor({ name: 'Arcane', kind: 'skill', stat: 'int' }, '', 'Spellforge Smith', realLib('Arcane'), [], 5), 0, 'INT group: 0 at Floor 5');
  eq(R.groupBonusFor({ name: 'Arcane', kind: 'skill', stat: 'int' }, '', 'Spellforge Smith', realLib('Arcane'), []), 0, 'INT group: 0 when floor is unknown');
  eq(R.groupBonusFor({ name: 'Smithing', kind: 'skill', stat: 'str' }, '', 'Spellforge Smith', realLib('Smithing'), [], 6), 0, 'INT group: 0 for a STR skill');
  eq(R.groupBonusFor({ name: 'HANDGUN', kind: 'skill', stat: 'dex' }, '', 'Spellforge Smith', realLib('HANDGUN'), [], 6), 0, 'INT group: 0 for a DEX skill');
  eq(R.groupBonusFor({ name: 'TENDRILS', kind: 'skill', stat: 'int' }, 'Symbiote: Anti Venom', 'Spellforge Smith', realLib('TENDRILS'), [], 6), 0, 'INT group: TENDRILS excluded at any floor');
  eq(R.groupBonusFor({ name: 'TONGUE LASH', kind: 'skill', stat: 'dex' }, 'Lizardfolk', 'Spellforge Smith', realLib('TONGUE LASH'), [], 6), 0, 'INT group: TONGUE LASH excluded at any floor');
  eq(R.groupBonusFor({ name: 'Arcane', kind: 'skill', stat: 'int' }, '', 'Human', realLib('Arcane'), [], 6), 0, 'INT group: 0 without Spellforge Smith');
  // Lizardfolk parses
  eq(R.parseRaceClassStats(lz), { str: 0, con: 0, dex: 3, int: 0, cha: 0 }, 'Lizardfolk: +3 DEX');
  eq(R.parseFixedSkillBonuses(lz, realLib).map(function (g) { return g.name + ':' + g.amount; }), ['Stealth:2'],
    'Lizardfolk: +2 Stealth only (Tongue Lash is floor-driven, not a grant)');
  eq(R.parseChoiceGrants(lz), [], 'Lizardfolk: no choice grants');
  eq(R.parseCapGrants(lz, realLib), [], 'Lizardfolk: no Rank 20 clause');
  eq(R.raceClassMoveBonus('Lizardfolk', ''), { move: 5, step: 5 }, 'Lizardfolk: +5 Move, +5 Step');
  eq(R.raceClassMoveBonus('Tigran', ''), { move: 10, step: 0 }, 'Tigran: still +10 Move, no Step');
  eq(R.raceClassMoveBonus('Obsidian Butterfly', ''), { move: 0, step: 0 }, 'Obsidian Butterfly: conditional +20ft Move (flying) is not applied');
  eq(lz.benefits.indexOf('Custom race by Dukeofdoom.') >= 0, true, 'Lizardfolk carries the Dukeofdoom credit');
  // TONGUE LASH data entry
  var tl = realLib('TONGUE LASH');
  eq(tl.kind, 'attack', 'TONGUE LASH kind is attack');
  eq(tl.stat, 'DEX', 'TONGUE LASH stat is DEX');
  eq(tl.base_damage, '1d6 + Dex Bludgeoning', 'TONGUE LASH damage is 1d6 + Dex Bludgeoning');
  eq(tl.range, 'Melee', 'TONGUE LASH range is Melee');
  eq(tl.upgrades, { 5: '+1d6 base damage', 10: '+1d6 base damage', 15: '+1d6 base damage' }, 'TONGUE LASH upgrades add +1d6 at 5/10/15');
  eq(R.isAttackSkill('TONGUE LASH'), true, 'TONGUE LASH counts as an attack skill');
  // Negative grants across the whole data file: only Spellforge Smith.
  var negs = [];
  rc.forEach(function (e) {
    R.parseFixedSkillBonuses(e, realLib).forEach(function (g) { if (g.amount < 0) negs.push(e.name + ':' + g.name); });
  });
  eq(negs, ['Spellforge Smith:UNARMED COMBAT'], 'only Spellforge Smith has a negative grant in the whole file');
})();

// ?v=47.10: Cardboard Hoarder class by Dukeofdoom (30/30, no detriments).
// Class Type and flavor text pending from Dukeofdoom; Bulk Bomb / Bulk
// Barricade are Dukeofdoom's real spell definitions (?v=52 — Barricade was
// renamed from Bulk Barrier at Antony's confirmation).
(function () {
  var rc = require('../data/races_classes.json');
  var libData = require('../data/skills_spells.json');
  var byName = {};
  libData.forEach(function (e) { byName[e.name.toLowerCase()] = e; });
  var realLib = function (n) { return byName[(n || '').toLowerCase()] || null; };
  var ch = rc.find(function (e) { return e.name === 'Cardboard Hoarder'; });
  eq(ch.kind, 'class', 'Cardboard Hoarder is a class');
  eq(ch.class_type, null, 'Cardboard Hoarder: no Class Type yet (pending from Dukeofdoom)');
  eq(ch.prerequisites, null, 'Cardboard Hoarder: no prerequisites');
  eq(R.parseRaceClassStats(ch), { str: 0, con: 0, dex: 0, int: 5, cha: 0 }, 'Cardboard Hoarder: +5 INT');
  eq(R.parseFixedSkillBonuses(ch, realLib).map(function (g) { return g.name + ':' + g.kind + ':' + g.amount; }),
    ['Tactics:utility:3', 'BULK BOMB:spell:2', 'BULK BARRICADE:spell:2'],
    'Cardboard Hoarder: +3 Tactics, +2 Bulk Bomb, +2 Bulk Barricade, nothing else');
  eq(R.parseFixedSkillBonuses(ch, realLib).map(function (g) { return g.kind === 'spell' ? 'spell' : 'skill'; }),
    ['skill', 'spell', 'spell'],
    'Cardboard Hoarder: Tactics lands as a skill card, Bulk Bomb/Barricade as spell cards');
  eq(R.parseChoiceGrants(ch), [], 'Cardboard Hoarder: no choice grants');
  eq(R.parseCapGrants(ch, realLib), [], 'Cardboard Hoarder: no Rank 20 clause');
  eq(R.groupBonusFor({ name: 'Tactics', kind: 'skill', stat: 'int' }, '', 'Cardboard Hoarder', realLib('Tactics'), [], 6), 0, 'Cardboard Hoarder: no group bonus');
  eq(R.raceClassMoveBonus('', 'Cardboard Hoarder'), { move: 0, step: 0 }, 'Cardboard Hoarder: no Move/Step bonus');
  eq(ch.benefits.indexOf('Custom class by Dukeofdoom.') >= 0, true, 'Cardboard Hoarder carries the Dukeofdoom credit');
  eq(ch.benefits.indexOf('null') >= 0, false, 'Cardboard Hoarder benefits contain no literal "null"');
  // Real spell definitions from Dukeofdoom (?v=52)
  var bb = realLib('BULK BOMB');
  var bbar = realLib('BULK BARRICADE');
  eq(realLib('BULK BARRIER'), null, 'BULK BARRIER is gone (renamed to Bulk Barricade)');
  eq(bb.kind, 'spell', 'BULK BOMB kind is spell');
  eq(bbar.kind, 'spell', 'BULK BARRICADE kind is spell');
  eq(bb.stat, 'INT', 'BULK BOMB stat is INT');
  eq(bbar.stat, 'INT', 'BULK BARRICADE stat is INT');
  eq(bb.uncertain, false, 'BULK BOMB is no longer uncertain (real definition)');
  eq(bbar.uncertain, false, 'BULK BARRICADE is no longer uncertain (real definition)');
  eq(bb.mana_cost, 5, 'BULK BOMB mana 5');
  eq(bbar.mana_cost, 8, 'BULK BARRICADE mana 8');
  eq(bb.range, '100 feet', 'BULK BOMB range 100 feet');
  eq(bbar.range, null, 'BULK BARRICADE has no range (none given)');
  eq(bb.base_damage, '1d6', 'BULK BOMB damage 1d6');
  eq(bbar.base_damage, null, 'BULK BARRICADE has no base damage');
  eq(bb.base_effect.indexOf('draft chaff') >= 0, true, 'BULK BOMB effect mentions draft chaff');
  eq(bb.base_effect.indexOf('25% chance to find a Rare') >= 0, true, 'BULK BOMB effect has the Rare chance');
  eq(bb.upgrades['15'].indexOf('Foil') >= 0, true, 'BULK BOMB Rank 15 mentions Foil');
  eq(bbar.base_effect.indexOf('10 foot wide wall') >= 0, true, 'BULK BARRICADE effect is a 10 foot wide wall');
  eq(bbar.base_effect.indexOf('Lasts until destroyed') >= 0, true, 'BULK BARRICADE lasts until destroyed');
  eq(bbar.upgrades['15'].indexOf('11 Health Bar Slots') >= 0, true, 'BULK BARRICADE Rank 15 has 11 Health Bar Slots');
})();



// Gear taxonomy (2026-11-03): kinds, slots, placements, equip limits
eq(R.normalizeSlot('Hand/Holding'), 'Hands/Holding', 'slot Hand/Holding');
eq(R.normalizeSlot('Accessory'), 'Accessories', 'slot Accessory -> Accessories');
eq(R.normalizeSlot('Weapon'), 'Hands/Holding', 'slot Weapon -> held');
eq(R.normalizeSlot('Other'), null, 'slot Other -> unassigned');
eq(R.normalizeSlot(null), null, 'slot null -> null');
eq(R.normalizeSlot('Hands/Gloves'), 'Hands/Gloves', 'slot Hands/Gloves');
eq(R.normalizeSlot('Arms'), 'Arms', 'slot Arms');
eq(R.normalizeKind('mundane'), 'material', 'kind mundane -> material');
eq(R.normalizeKind('map'), 'material', 'kind map -> material');
eq(R.normalizeKind('other'), 'material', 'kind other -> material');
eq(R.normalizeKind(undefined), 'material', 'kind missing -> material');
eq(R.normalizeKind('gear'), 'gear', 'kind gear stays');
eq(R.normalizeKind('consumable'), 'consumable', 'kind consumable stays');
eq(R.SLOT_LIMITS['Head'], 1, 'Head limit 1');
eq(R.SLOT_LIMITS['Hands/Holding'], 2, 'Hands/Holding limit 2');
eq(R.SLOT_LIMITS['Accessories'], 10, 'Accessories limit 10');
eq(R.placementFamily('Left Hand'), 'Hands/Holding', 'placement Left Hand family');
eq(R.placementFamily('Accessory 3'), 'Accessories', 'placement Accessory 3 family');
eq(R.placementFamily('Head'), 'Head', 'placement Head family');
// Equip limits, enforced, never replacing
(function () {
  const items = [
    { id: 'a', name: 'Helm', kind: 'gear', slot: 'Head', equipped: false, placement: null },
    { id: 'b', name: 'Crown', kind: 'gear', slot: 'Head', equipped: false, placement: null },
    { id: 's', name: 'Sword', kind: 'gear', slot: 'Hands/Holding', equipped: false, placement: null },
    { id: 'd', name: 'Dagger', kind: 'gear', slot: 'Hands/Holding', equipped: false, placement: null },
    { id: 'e', name: 'Mace', kind: 'gear', slot: 'Hands/Holding', equipped: false, placement: null },
    { id: 'p', name: 'Potion', kind: 'consumable', slot: null, equipped: false, placement: null },
  ];
  eq(R.equipInto(items, 'a', 'Head'), null, 'equip Head ok');
  eq(R.equipInto(items, 'b', 'Head'), 'Head is full (Helm is equipped there). Unequip that first, or use a loadout.', 'second Head refused');
  eq(R.equipInto(items, 's', 'Right Hand'), null, 'equip Right Hand ok');
  eq(R.equipInto(items, 'd', 'Left Hand'), null, 'equip Left Hand ok');
  eq(R.equipInto(items, 'e', 'Right Hand'), 'Hands/Holding is full (Sword is equipped there). Unequip that first, or use a loadout.', 'third holding refused');
  eq(R.equipInto(items, 'p', 'Head'), 'Only gear can be equipped.', 'consumable cannot equip');
  eq(R.equipInto(items, 's', 'Head'), 'This gear goes in Hands/Holding, not Head.', 'wrong slot refused');
  eq(R.freePlacement(items, 'Hands/Holding'), null, 'holding full -> no free placement');
  R.unequip(items, 's');
  eq(R.freePlacement(items, 'Hands/Holding'), 'Right Hand', 'free hand after unequip');
  eq(R.slotOccupants(items, 'Head').length, 1, 'Head has 1 occupant');
})();
// Accessories: 10 ok, 11th refused
(function () {
  const items = [];
  for (let i = 0; i < 11; i++) items.push({ id: 'r' + i, name: 'Ring ' + i, kind: 'gear', slot: 'Accessories', equipped: false, placement: null });
  for (let i = 0; i < 10; i++) eq(R.equipInto(items, 'r' + i, 'Accessory ' + (i + 1)), null, 'equip accessory ' + (i + 1));
  eq(R.equipInto(items, 'r10', 'Accessory 1'), 'Accessories is full (Ring 0 is equipped there). Unequip that first, or use a loadout.', '11th accessory refused');
})();
// Legacy equipped items (boolean, no placement) derive placements in order
(function () {
  const items = [
    { id: 'h', name: 'Helm', kind: 'gear', slot: 'Head', equipped: true, placement: null },
    { id: 's', name: 'Sword', kind: 'gear', slot: 'Hands/Holding', equipped: true, placement: null },
    { id: 'x', name: 'Mystery', kind: 'gear', slot: null, equipped: true, placement: null },
  ];
  const m = R.derivePlacements(items);
  eq(m.h, 'Head', 'legacy Head derives Head');
  eq(m.s, 'Right Hand', 'legacy holding derives Right Hand');
  eq(m.x, null, 'legacy unassigned slot derives nothing');
})();


// Weapons: 1 Hand takes one hand, 2 Hand takes both
eq(R.normalizeSlot('Weapon 1 Hand'), 'Weapon 1 Hand', 'slot Weapon 1 Hand');
eq(R.normalizeSlot('Weapon 2 Hand'), 'Weapon 2 Hand', 'slot Weapon 2 Hand');
eq(R.slotFamily('Weapon 1 Hand'), 'Hands/Holding', 'Weapon 1 Hand family is hands');
eq(R.slotFamily('Weapon 2 Hand'), 'Hands/Holding', 'Weapon 2 Hand family is hands');
eq(R.slotFamily('Head'), 'Head', 'Head family is itself');
eq(R.placementFitsItem('Both Hands', 'Weapon 2 Hand'), true, 'Both Hands fits 2 Hand weapon');
eq(R.placementFitsItem('Both Hands', 'Weapon 1 Hand'), false, 'Both Hands does not fit 1 Hand weapon');
eq(R.placementFitsItem('Right Hand', 'Weapon 1 Hand'), true, 'Right Hand fits 1 Hand weapon');
eq(R.placementFitsItem('Right Hand', 'Weapon 2 Hand'), false, 'Right Hand does not fit 2 Hand weapon');
eq(R.placementFitsItem('Right Hand', 'Hands/Holding'), true, 'Right Hand fits held gear');
(function () {
  const items = [
    { id: 's', name: 'Sword', kind: 'gear', slot: 'Weapon 1 Hand', equipped: false, placement: null },
    { id: 'd', name: 'Dagger', kind: 'gear', slot: 'Weapon 1 Hand', equipped: false, placement: null },
    { id: 'g', name: 'Greatsword', kind: 'gear', slot: 'Weapon 2 Hand', equipped: false, placement: null },
    { id: 'h', name: 'Shield', kind: 'gear', slot: 'Hands/Holding', equipped: false, placement: null },
  ];
  eq(R.equipInto(items, 's', 'Right Hand'), null, 'equip 1 Hand sword');
  eq(R.equipInto(items, 'd', 'Left Hand'), null, 'equip 1 Hand dagger in other hand');
  eq(R.equipInto(items, 'g', 'Both Hands'), 'Hands/Holding is full (Sword is equipped there). Unequip that first, or use a loadout.', '2 Hand refused while hands taken');
  eq(R.freePlacement(items, 'Weapon 2 Hand'), null, 'no Both Hands placement while hands taken');
  R.unequip(items, 's'); R.unequip(items, 'd');
  eq(R.equipInto(items, 'g', 'Both Hands'), null, 'equip 2 Hand weapon with hands free');
  eq(R.handUsed(items), 2, '2 Hand weapon uses both hands');
  eq(R.equipInto(items, 'h', 'Right Hand'), 'Hands/Holding is full (Greatsword is equipped there). Unequip that first, or use a loadout.', 'held item refused while 2 Hand equipped');
  eq(R.freePlacement(items, 'Weapon 1 Hand'), null, 'no free hand while 2 Hand equipped');
  R.unequip(items, 'g');
  eq(R.equipInto(items, 'h', 'Right Hand'), null, 'held item ok after 2 Hand unequipped');
  eq(R.equipInto(items, 'g', 'Right Hand'), 'This is a 2 Hand weapon: it takes both hands.', '2 Hand cannot go in one hand');
})();
// Legacy 2 Hand weapon derives Both Hands only when both hands are free
(function () {
  const items = [
    { id: 'g', name: 'Greatsword', kind: 'gear', slot: 'Weapon 2 Hand', equipped: true, placement: null },
    { id: 's', name: 'Sword', kind: 'gear', slot: 'Weapon 1 Hand', equipped: true, placement: null },
  ];
  const m = R.derivePlacements(items);
  eq(m.g, 'Both Hands', 'legacy 2 Hand derives Both Hands first');
  eq(m.s, null, 'legacy 1 Hand after 2 Hand derives nothing');
})();

// Consumable rulebook picks (book loot list, pp.216-218)
(function () {
  var p = R.consumablePickFor('Healing Potion');
  eq(p.subtype, 'Potion', 'healing potion subtype');
  eq(p.use.potionKind, 'heal', 'healing potion effect');
  eq(p.use.potionAmount, 5, 'healing potion heals 5');
  var g = R.consumablePickFor('Gold Standard Healing Potion');
  eq(g.use.potionAmount, 7, 'gold standard heals 7');
  eq(g.use.potionNote, 'Mends one Minor Injury', 'gold standard mends minor');
  var m = R.consumablePickFor('Mana Potion');
  eq(m.use.potionKind, 'manaFull', 'mana potion restores fully');
  var r = R.consumablePickFor('Good Mana Refill Potion');
  eq(r.use.potionKind, 'manaOverTime', 'mana refill over time');
  eq(r.use.potionAmount, 15, 'mana refill 15 per round');
  eq(r.use.potionRounds, 10, 'mana refill 10 rounds');
  var s = R.consumablePickFor('Potion of +3 Skill');
  eq(s.use.potionKind, 'skillBoost', 'skill potion boosts');
  eq(s.use.potionAmount, 3, 'skill potion +3');
  var d = R.consumablePickFor('Stick of Good Goblin Dynamite');
  eq(d.subtype, 'Explosive', 'dynamite subtype');
  eq(d.use.damage, '2d6', 'good dynamite 2d6');
  eq(d.use.blast, '5ft', 'good dynamite blast 5ft');
  eq(d.use.splash, '+5ft', 'good dynamite splash +5ft');
  var b = R.consumablePickFor('Bandages');
  eq(b.subtype, null, 'bandages have no potion subtype');
  eq(b.use.removeDebuff, 'blood trail', 'bandages remove blood trail');
  var sc = R.consumablePickFor('Spell Scroll');
  eq(sc.subtype, 'Scroll', 'spell scroll subtype');
  eq(sc.use.spell, undefined, 'scroll spell designated later');
  eq(R.consumablePickFor('Something Unlisted'), null, 'unlisted consumable has no pick');
})();

// Evade Buffs granted by ranked skills/spells (e.g. Dodge, book p.190)
(function () {
  eq(R.evadeBuffsInText('Passive. You gain a +1 Evade Buff.'), 1, 'evade buff +1 in text');
  eq(R.evadeBuffsInText('Gain a +1 Evade Buff, and +2 Evade Buff.'), 3, 'evade buffs sum in text');
  eq(R.evadeBuffsInText('No evade here.'), 0, 'evade buff none in text');
  eq(R.evadeBuffsInText('+1 Evade with no Buff word'), 0, 'plain +N Evade does not count');
  var dodge = { base_effect: 'Passive. You gain a +1 Evade Buff.', upgrades: { 5: 'Gain a +1 Evade Buff, and you may Step an additional 5 feet when you perform the Evade Action.', 10: 'Gain a +2 Evade Buff, and roll Evade with Advantage vs. Spells and Ranged Attacks.', 15: 'Gain a +2 Evade Buff, and you may perform the Evade Action without spending an Action in combat.' } };
  eq(R.skillEvadeBuff(dodge, 1), 1, 'Dodge rank 1 = +1');
  eq(R.skillEvadeBuff(dodge, 4), 1, 'Dodge rank 4 = +1');
  eq(R.skillEvadeBuff(dodge, 5), 2, 'Dodge rank 5 = +2');
  eq(R.skillEvadeBuff(dodge, 9), 2, 'Dodge rank 9 = +2');
  eq(R.skillEvadeBuff(dodge, 10), 4, 'Dodge rank 10 = +4');
  eq(R.skillEvadeBuff(dodge, 15), 6, 'Dodge rank 15 = +6');
  var rapier = { base_effect: 'Melee edged weapon attack.', upgrades: { 10: '+1d6 base damage, and you gain a +1 Evade Buff.', 15: '+1d6 base damage, and you gain a +1 Evade Buff.' } };
  eq(R.skillEvadeBuff(rapier, 9), 0, 'Rapier rank 9 = +0');
  eq(R.skillEvadeBuff(rapier, 10), 1, 'Rapier rank 10 = +1');
  eq(R.skillEvadeBuff(rapier, 15), 2, 'Rapier rank 15 = +2');
  eq(R.skillEvadeBuff(null, 3, 'You gain a +2 Evade Buff.'), 2, 'custom skill effect counts');
  eq(R.skillEvadeBuff(null, 3, null), 0, 'no lib and no effect = +0');
})();

// Rank-20 cap clauses, parsed from the real race/class data
(function () {
  var rc = require('../data/races_classes.json');
  var libData = require('../data/skills_spells.json');
  var byName = {};
  libData.forEach(function (e) { byName[e.name.toLowerCase()] = e; });
  var realLib = function (n) { return byName[(n || '').toLowerCase()] || null; };
  var caps = {};
  rc.forEach(function (e) {
    var rules = R.parseCapGrants(e, realLib);
    if (rules.length) caps[e.name] = rules;
  });
  eq(Object.keys(caps).length, 75, 'cap clauses: 75 race/class entries have a Rank 20 clause (23 book/custom + 52 homebrew)');
  eq(caps['Gun Bunny'].map(function (r) { return r.type; }), ['firearm'], 'v50b: Gun Bunny: firearm cap');
  eq(caps['Dwarf, Classic'].map(function (r) { return r.type; }), ['crafting'], 'Dwarf: all crafting skills');
  eq(caps['Elf, High'][0].category, 'cha', 'Elf, High: two CHA skills (choice)');
  eq(caps['Elf, High'][0].count, 2, 'Elf, High: pick two');
  eq(caps['Elf, Night'].map(function (r) { return r.type; }).sort(), ['choice', 'fixed'], 'Elf, Night: fixed Hide in Shadows + crafting choice');
  eq(caps['Primal'][0].type, 'all', 'Primal: all skills');
  eq(caps['Hobgoblin'][0].type, 'explosiveTrap', 'Hobgoblin: explosives + trap-making');
  eq(caps['Caprid'].map(function (r) { return r.name; }).sort(), ['Find Crawler', 'Persuasion'], 'Caprid: two fixed skills');
  eq(caps['Fire Spiritualist'].map(function (r) { return r.name; }), ['HEAL OTHERS'], 'Fire Spiritualist: only Heal Others (not the earlier list)');
  eq(caps['Prizefighter'].map(function (r) { return r.name; }), ['PUGILISM'], 'Prizefighter: only Pugilism');
  eq(caps['Spirit Healer'].map(function (r) { return r.name; }), ['HEAL OTHERS'], 'Spirit Healer: only Heal Others');
  eq(caps['Douchy Wizard School Wand-Maker'].map(function (r) { return r.name; }), ['Arcane'], 'Wand-Maker: Arcanist text resolves to the Arcane skill');
  eq(caps['Swashbuckler'][0].options, ['RAPIER', 'LONGSWORD'], 'Swashbuckler: Rapier or Longsword choice');
  eq(caps['Spellforge Smith'].map(function (r) { return r.name; }), ['Smithing'], 'Spellforge Smith: Smithing to Rank 20');
  eq(R.capForCard({ name: 'Dodge', kind: 'skill' }, caps['Artist Alley Mogul'], []), 20, 'cap: fixed named skill');
  eq(R.capForCard({ name: 'Alchemy', kind: 'skill' }, caps['Dwarf, Classic'], []), 20, 'cap: crafting skill under Dwarf');
  eq(R.capForCard({ name: 'Cooking', kind: 'skill' }, caps['Dwarf, Classic'], []), 15, 'cap: Cooking has no crafting table, stays 15');
  eq(R.capForCard({ name: 'Trap Engineer', kind: 'skill' }, caps['Hobgoblin'], []), 20, 'cap: trap skill under Hobgoblin');
  eq(R.capForCard({ name: 'Dodge', kind: 'skill' }, caps['Hobgoblin'], []), 15, 'cap: unrelated skill under Hobgoblin stays 15');
  eq(R.capForCard({ name: 'Pugilism', kind: 'skill' }, caps['Primal'], []), 20, 'cap: Primal lifts all skills');
  eq(R.capForCard({ name: 'Fireball', kind: 'spell' }, caps['Primal'], []), 15, 'cap: Primal "All Skills" does not lift spells');
  eq(R.capForCard({ name: 'Heal Others', kind: 'spell' }, caps['Fire Spiritualist'], []), 20, 'cap: fixed spell');
  eq(R.capForCard({ name: 'Longsword', kind: 'skill' }, [], [{ name: 'Longsword', kind: 'skill', cap: 20 }]), 20, 'cap: picked cap choice lifts the skill');
  eq(R.capForCard({ name: 'Longsword', kind: 'skill' }, [], [{ name: 'Rapier', kind: 'skill', cap: 20 }]), 15, 'cap: a different pick does not lift it');
})();

// ?v=48: floor-3 race/class prerequisites (parser + evaluation)
(function () {
  var rc = require('../data/races_classes.json');
  var libData = require('../data/skills_spells.json');
  var byName = {};
  libData.forEach(function (e) { byName[e.name.toLowerCase()] = e; });
  var realLib = function (n) { return byName[(n || '').toLowerCase()] || null; };
  function parsed(name) {
    var e = rc.find(function (x) { return x.name === name; });
    return R.parsePrereqs(e && e.prerequisites);
  }
  function types(p) { return p.checks.map(function (c) { return c.type; }); }
  function labels(p) { return p.checks.map(function (c) { return c.label; }); }
  // Every entry with prerequisites in the live library, parsed as expected.
  eq(types(parsed('Amazonian')), ['statSkill'], 'Amazonian: STR/DEX skill Rank 5+');
  eq(labels(parsed('Amazonian')), ['any Strength/Dexterity-based Skill Rank 5+'], 'Amazonian label');
  eq(types(parsed('Cat')), ['race'], 'Cat: already a Cat');
  eq(labels(parsed('Cat')), ['Race: Cat'], 'Cat label');
  eq(types(parsed('Obsidian Butterfly')), ['category'], 'Obsidian Butterfly: any Edged Weapon');
  eq(types(parsed('Sasquatch')), ['skill'], 'Sasquatch: Smush 5+');
  eq(types(parsed('Bune')), ['popularity'], 'Bune: Popularity 3+');
  eq(types(parsed('Grulke')), ['skillOr'], 'Grulke: Jumping or Light on Your Feet');
  eq(types(parsed('Hobgoblin')), ['skill', 'category'], 'Hobgoblin: Explosives Handling + any Trap-based Skill');
  eq(types(parsed('Feral Cat Berserker')), ['race'], 'Feral Cat Berserker: cat-based races');
  eq(labels(parsed('Feral Cat Berserker')), ['Race: Cat or Cat Girl or Tigran'], 'Feral Cat Berserker label');
  eq(types(parsed('Monster Truck Driver')), ['skill'], 'Monster Truck Driver: Driving 5+');
  eq(types(parsed('Prizefighter')), ['skill'], 'Prizefighter: Pugilism 5+');
  eq(types(parsed('Compensated Anarchist')), ['skill', 'popularity'], 'Compensated Anarchist: Explosives Handling + Popularity');
  // Achievements and gender are display-only, never blocking checks.
  eq(types(parsed('Shieldmaiden')), [], 'Shieldmaiden: female-only is display-only');
  eq(parsed('Shieldmaiden').display.length, 1, 'Shieldmaiden: display note kept');
  eq(types(parsed('Bomb Squad Tech')), [], 'Bomb Squad Tech: Boom! achievement is display-only');
  eq(types(parsed('Former Child Actor')), ['popularity'], 'Former Child Actor: only Popularity is a check');
  eq(parsed('Former Child Actor').display.join(' ').indexOf('Cut!') >= 0, true, 'Former Child Actor: Cut! kept as a display note');
  // Synthetic forms the current library does not have yet.
  eq(types(R.parsePrereqs('Strength 5+')), ['stat'], 'synthetic: stat minimum');
  eq(labels(R.parsePrereqs('Strength 5+')), ['Strength 5+'], 'synthetic: stat label');
  eq(types(R.parsePrereqs('Must have killed a crawler')), ['pk'], 'synthetic: killed a crawler = 1 PK');
  eq(labels(R.parsePrereqs('Must have killed a crawler')), ['Player Kills 1+'], 'synthetic: PK label');
  eq(types(R.parsePrereqs('3 Player Kills')), ['pk'], 'synthetic: 3 Player Kills');
  eq(types(R.parsePrereqs('Must be a member of the Desperado Club')), ['club'], 'synthetic: club membership');
  eq(labels(R.parsePrereqs('Must be a member of the Desperado Club')), ['Member of Desperado Club'], 'synthetic: club label');
  eq(types(R.parsePrereqs('Must worship the Armorer')), ['deity'], 'synthetic: named deity');
  eq(types(R.parsePrereqs('Must worship a deity')), ['deity'], 'synthetic: any deity');
  eq(types(R.parsePrereqs('Only with the DM approval')), ['dmApproval'], 'synthetic: DM approval');
  eq(types(R.parsePrereqs('Only available to crawlers who have Rank 5+ in the Smush Skill')), ['skill'], 'synthetic: boilerplate stripped, Smush 5+');
  eq(types(R.parsePrereqs('')), [], 'empty prerequisites: no checks');
  eq(types(R.parsePrereqs(null)), [], 'null prerequisites: no checks');
  var unparsed = R.parsePrereqs('Must be truly, deeply, spiritually committed to the cause');
  eq(unparsed.checks.length, 0, 'unparseable text: no checks');
  eq(unparsed.display.length, 1, 'unparseable text: kept as a display note');
  // Evaluation against a context.
  function ctx(over) {
    var base = { stats: { str: 6, con: 4, dex: 3, int: 3, cha: 2 }, popularity: 3, pkKills: 1,
      clubs: ['Desperado Club'], deity: 'The Armorer', race: 'Cat', dmApproved: false,
      skills: [
        { name: 'Smush', rank: 5, stat: 'str', isEdged: false, isTrap: false, isExplosive: false },
        { name: 'Dodge', rank: 5, stat: 'dex', isEdged: false, isTrap: false, isExplosive: false },
        { name: 'Longsword', rank: 5, stat: 'str', isEdged: true, isTrap: false, isExplosive: false },
        { name: 'Trap Engineer', rank: 4, stat: 'int', isEdged: false, isTrap: true, isExplosive: false },
        { name: 'Explosives Handling', rank: 5, stat: 'int', isEdged: false, isTrap: false, isExplosive: true }
      ] };
    Object.keys(over || {}).forEach(function (k) { base[k] = over[k]; });
    return base;
  }
  function checkPass(text, c) { return R.checkPrereqs(R.parsePrereqs(text).checks, c).pass; }
  eq(checkPass('Popularity 3+', ctx()), true, 'eval: Popularity 3 meets 3+');
  eq(checkPass('Popularity 3+', ctx({ popularity: 2 })), false, 'eval: Popularity 2 fails 3+');
  eq(checkPass('Rank 5+ in the Smush Skill', ctx()), true, 'eval: Smush 5 meets 5+');
  eq(checkPass('Rank 5+ in the Smush Skill', ctx({ skills: [] })), false, 'eval: missing skill fails');
  eq(checkPass('Rank 5+ in the Jumping or Light on Your Feet Skill', ctx()), false, 'eval: neither of an or-list fails');
  eq(checkPass('at least one Strength or Dexterity-based Skill at Rank 5+', ctx()), true, 'eval: DEX Dodge 5 meets the stat-skill check');
  eq(checkPass('Rank 5+ with any Edged Weapon', ctx()), true, 'eval: Longsword 5 is an edged weapon');
  eq(checkPass('Rank 5+ with any Edged Weapon', ctx({ skills: [{ name: 'Dodge', rank: 5, stat: 'dex', isEdged: false, isTrap: false, isExplosive: false }] })), false, 'eval: no edged weapon fails');
  eq(checkPass('Rank 5+ in the Explosives Handling Skill and any Trap-based Skill', ctx()), false, 'eval: Trap Engineer 4 fails the trap half');
  eq(checkPass('Rank 5+ in the Explosives Handling Skill and any Trap-based Skill', ctx({ skills: [{ name: 'Explosives Handling', rank: 5, stat: 'int', isEdged: false, isTrap: false, isExplosive: true }, { name: 'Trap Engineer', rank: 5, stat: 'int', isEdged: false, isTrap: true, isExplosive: false }] })), true, 'eval: both halves pass');
  eq(checkPass('Strength 5+', ctx()), true, 'eval: STR 6 meets 5+');
  eq(checkPass('Strength 5+', ctx({ stats: { str: 4, con: 4, dex: 3, int: 3, cha: 2 } })), false, 'eval: STR 4 fails 5+');
  eq(checkPass('3 Player Kills', ctx()), false, 'eval: 1 PK fails 3');
  eq(checkPass('3 Player Kills', ctx({ pkKills: 3 })), true, 'eval: 3 PK meets 3');
  eq(checkPass('Must be a member of the Desperado Club', ctx()), true, 'eval: Desperado Club member passes');
  eq(checkPass('Must be a member of the Desperado Club', ctx({ clubs: [] })), false, 'eval: no club fails');
  eq(checkPass('Must worship the Armorer', ctx()), true, 'eval: named deity matches');
  eq(checkPass('Must worship the Armorer', ctx({ deity: '' })), false, 'eval: no deity fails');
  eq(checkPass('Must worship a deity', ctx({ deity: 'The Armorer' })), true, 'eval: any deity set passes');
  eq(checkPass('Only with the DM approval', ctx()), false, 'eval: DM approval unchecked fails');
  eq(checkPass('Only with the DM approval', ctx({ dmApproved: true })), true, 'eval: DM approval ticked passes');
  eq(checkPass('already a Cat', ctx()), true, 'eval: race Cat passes');
  eq(checkPass('already a Cat', ctx({ race: 'Human' })), false, 'eval: race Human fails a Cat prereq');
  eq(checkPass('already a Cat', ctx({ race: 'Cat Girl/Cat Boy' })), false, 'eval: Cat does not match Cat Girl/Cat Boy');
  eq(checkPass('cat-based Races, such as Cat, Cat Girl, and Tigran', ctx({ race: 'Tigran' })), true, 'eval: Tigran is in the cat-based list');
  // Category flags.
  var ls = R.prereqSkillFlags({ name: 'Longsword', kind: 'skill' }, realLib('Longsword'));
  eq(ls.isEdged, true, 'flags: Longsword is edged (Slashing damage)');
  var dg = R.prereqSkillFlags({ name: 'Dodge', kind: 'skill' }, realLib('Dodge'));
  eq(dg.isEdged, false, 'flags: Dodge is not edged');
  var te = R.prereqSkillFlags({ name: 'Trap Engineer', kind: 'skill' }, realLib('Trap Engineer'));
  eq(te.isTrap, true, 'flags: Trap Engineer is a trap skill');
  var eh = R.prereqSkillFlags({ name: 'Explosives Handling', kind: 'skill' }, realLib('Explosives Handling'));
  eq(eh.isExplosive, true, 'flags: Explosives Handling is explosive');
  // Banked stat points: (Level - 1) * 3 - spent.
  eq(R.statBank(1, 0), 0, 'bank: level 1 has none');
  eq(R.statBank(5, 0), 12, 'bank: level 5, nothing spent');
  eq(R.statBank(5, 7), 5, 'bank: level 5, 7 spent');
  eq(R.statBank(19, 54), 0, 'bank: level 19, all 54 spent');
  // Confirmation-state rule (the pure part; the app stores the flag).
  eq(R.floor3Required(2, false), false, 'floor3: floor 2 never requires it');
  eq(R.floor3Required(3, false), true, 'floor3: floor 3 unconfirmed requires it');
  eq(R.floor3Required(3, true), false, 'floor3: floor 3 confirmed does not');
  eq(R.floor3Required(5, false), true, 'floor3: floor 5 unconfirmed requires it');
  eq(R.floor3Required(1, false), false, 'floor3: floor 1 never requires it');
  // Club set.
  eq(R.CLUBS, ['Desperado Club', 'Club Vanquisher', 'Dungeon Book of the Floor Club'], 'club set: the three clubs');
})();

// ?v=49: homebrew library (209 entries) + parser fixes
(function () {
  var rc = require('../data/races_classes.json');
  var libData = require('../data/skills_spells.json');
  var byName = {};
  libData.forEach(function (e) { byName[e.name.toLowerCase()] = e; });
  var realLib = function (n) { return byName[(n || '').toLowerCase()] || null; };
  eq(rc.length, 295, 'v49: 86 live + 209 homebrew races/classes');
  eq(libData.length, 289, 'v50: 172 live + 117 homebrew skills/spells (PISTOL dropped)');
  // Choice-grant dedupe fix: distinct same-amount choices both parse.
  var fom = rc.find(function (e) { return e.name === 'Fomorian'; });
  eq(R.parseChoiceGrants(fom).length, 2, 'v49 dedupe: Fomorian keeps both +1 skill choices');
  eq(R.parseChoiceGrants(fom).map(function (g) { return g.label; }),
    ['skill from Bite, Back Claw, or Ice Blast', 'skill from Riding, Animal Handling, Smithing, or Intimidate'], 'v49 dedupe: Fomorian labels differ');
  var sen = rc.find(function (e) { return e.name === 'Sentai Ranger'; });
  eq(R.parseChoiceGrants(sen).length, 3, 'v49 dedupe: Sentai Ranger keeps all three +3 choices');
  eq(R.parseChoiceGrants({ name: 'X', benefits: '+1 in one skill of your choice. +1 in one skill of your choice.' }).length, 1,
    'v49 dedupe: identical choices still collapse to one');
  // Minotaur (confirmed by Antony 2026-11-22): +3 Pathfinder + weapon choice.
  var mn = rc.find(function (e) { return e.name === 'Minotaur'; });
  eq(R.parseFixedSkillBonuses(mn, realLib), [{ name: 'Pathfinder', kind: 'utility', amount: 3 }], 'Minotaur: +3 Pathfinder');
  eq(R.parseChoiceGrants(mn), [{ amount: 3, count: 1, category: 'weapon', label: 'weapon Skill', options: null }], 'Minotaur: +3 weapon choice');
  eq(mn.uncertain, false, 'Minotaur: split confirmed, no longer uncertain');
  // Antony's 2026-11-22 corrections.
  eq(rc.some(function (e) { return e.name === 'Incubus/Succubus'; }), true, 'Incubus/Succubus spelling');
  eq(rc.some(function (e) { return e.name === 'Incubus/Sucubus'; }), false, 'old Sucubus spelling gone');
  var af = rc.find(function (e) { return e.name === 'Aura Farmer'; });
  eq(af.benefits.indexOf('Must worship Dagda.') >= 0, true, 'Aura Farmer worships Dagda');
  eq(R.parsePrereqs('Must worship Dagda.').checks[0].type, 'deity', 'Dagda parses as a deity check');
  var hd = rc.find(function (e) { return e.name === 'Half-Djinns'; });
  eq(hd.benefits.indexOf('Choose a natural attack related to the forest creature you are an offshoot from.') >= 0, true, 'Half-Djinns: natural attack is a player choice');
  // Goliath heritage grants (merge fix-up): the "+N bonus to X" wording
  // the parser drops is rewritten so the grants land.
  var go = rc.find(function (e) { return e.name === 'Goliath'; });
  eq(R.parseFixedSkillBonuses(go, realLib).map(function (g) { return g.name; }).sort(),
    ['Determine Value', 'EMBIGGEN', 'Iron Stomach', 'Regeneration'], 'Goliath: heritage grants land');
  // Bear, Black: stats + Perception grant; the claw is floor-driven, not a grant.
  var bb = rc.find(function (e) { return e.name === 'Bear, Black'; });
  eq(R.parseRaceClassStats(bb), { str: 0, con: 6, dex: 0, int: 0, cha: 0 }, 'Bear, Black: +6 CON');
  eq(R.parseFixedSkillBonuses(bb, realLib), [{ name: 'Perception', kind: 'utility', amount: 1 }], 'Bear, Black: only +1 Perception (claw is floor-driven)');
  // Lord of the Night: sentence-initial "Already a Vampyr." parses as a
  // race check (?v=49 parser fix — the race regex is case-insensitive now).
  var lotn = rc.find(function (e) { return e.name === 'Lord of the Night'; });
  eq(R.parsePrereqs(lotn.prerequisites).checks.map(function (c) { return c.type; }), ['race'], 'Lord of the Night: Already a Vampyr is a race check');
  eq(R.parsePrereqs(lotn.prerequisites).checks[0].names, ['Vampyr'], 'Lord of the Night: race is Vampyr');
  eq(R.parsePrereqs('This limited Race is only available to crawlers who are already a Cat').checks.map(function (c) { return c.type; }), ['race'], 'Cat prereq still parses');
  // Floor-attack library entries: all in SKILL_ATTACK_TYPES, all in the
  // group-bonus exclusion list.
  ['BLACK BEAR CLAW', 'CLAW', 'SLAM', 'TRASH PANDA BITE', 'HODEN BITE', 'HAND CLAW', 'HORN GORE',
   'URSINE CLAW', 'VAMPYR BITE', 'VAMPIRIC BITE', 'BLADED ARMS', 'BEAK', 'SHADOW CLAWS'].forEach(function (n) {
    eq(R.skillAttackType(n), 'Melee Attack', n + ' is Melee Attack');
  });
  ['ELEMENTAL BREATH', 'HELLFIRE SPITTLE', 'WILTING BREATH', 'CHAKRAM'].forEach(function (n) {
    eq(R.skillAttackType(n), 'Ranged Attack', n + ' is Ranged Attack');
  });
  eq(R.isAttackSkill('BEAK'), true, 'BEAK counts as an attack');
  eq(realLib('BEAK').stat, null, 'BEAK has no stat');
  eq(R.FLOOR_ATTACK_NAMES.indexOf('black bear claw') >= 0, true, 'floor list: black bear claw');
  eq(R.FLOOR_ATTACK_NAMES.indexOf('claw') >= 0, true, 'floor list: claw');
  eq(R.FLOOR_ATTACK_NAMES.indexOf('bite') >= 0, true, 'floor list: bite');
  eq(R.FLOOR_ATTACK_NAMES.indexOf('beak') >= 0, true, 'floor list: beak');
  eq(R.FLOOR_ATTACK_NAMES.indexOf('shadow claws') >= 0, true, 'floor list: shadow claws');
  eq(R.FLOOR_ATTACK_NAMES.length, 19, 'floor list: 2 book + 17 homebrew');
  // Floor attacks are excluded from group bonuses (Spellforge INT group).
  eq(R.groupBonusFor({ name: 'BLACK BEAR CLAW', kind: 'skill', stat: 'str' }, 'Bear, Black', 'Spellforge Smith', realLib('BLACK BEAR CLAW'), [], 6), 0, 'group: Black Bear Claw excluded');
  eq(R.groupBonusFor({ name: 'BEAK', kind: 'skill', stat: '' }, 'Vulturans', 'Spellforge Smith', realLib('BEAK'), [], 6), 0, 'group: BEAK excluded');
  // Damage Effects: REND/GOLDEN GUN/ASSASSINATE are kind attack, stat null,
  // and their parents resolve from the base_effect.
  eq(realLib('REND').kind, 'attack', 'REND kind is attack');
  eq(realLib('REND').stat, null, 'REND stat is null');
  eq(R.damageEffectParents(realLib('REND').base_effect), ['Claw'], 'REND parent: Claw');
  eq(R.damageEffectParents(realLib('GOLDEN GUN').base_effect), ['Handgun'], 'GOLDEN GUN parent: Handgun');
  eq(R.damageEffectParents(realLib('ASSASSINATE').base_effect), ['Dagger'], 'ASSASSINATE parent: Dagger');
  // DISINTEGRATION: full Skybreaker-doc definition.
  var dis = realLib('DISINTEGRATION');
  eq(dis.kind, 'spell', 'DISINTEGRATION kind is spell');
  eq(dis.mana_cost, 20, 'DISINTEGRATION mana 20');
  eq(dis.base_damage, '1d12 + Int Fire', 'DISINTEGRATION damage');
  eq(dis.uncertain, false, 'DISINTEGRATION no longer uncertain');
  // Move/Step table: flat homebrew bonuses apply, conditional ones do not.
  eq(R.raceClassMoveBonus('Blue-Spined Goblin', ''), { move: 15, step: 0 }, 'Blue-Spined Goblin +15 Move');
  eq(R.raceClassMoveBonus('Brownie (Quickling)', ''), { move: 0, step: 15 }, 'Brownie +15 Step');
  eq(R.raceClassMoveBonus('Dwarf of Icecloak', ''), { move: -5, step: 0 }, 'Dwarf of Icecloak -5 Move');
  eq(R.raceClassMoveBonus('Operatics', ''), { move: 0, step: -5 }, 'Operatics -5 Step');
  eq(R.raceClassMoveBonus('Glacial', ''), { move: 0, step: 5 }, 'Glacial +5 Step');
  eq(R.raceClassMoveBonus('Mantis (Female)', ''), { move: 5, step: 0 }, 'Mantis +5 Move');
  eq(R.raceClassMoveBonus('Cassowary', ''), { move: 10, step: 0 }, 'Cassowary +10 Move');
  eq(R.raceClassMoveBonus('Aerial Avenger', ''), { move: 10, step: 0 }, 'Aerial Avenger +10 Move');
  eq(R.raceClassMoveBonus('Dog, Working', ''), { move: 5, step: 0 }, 'Dog, Working +5 Move');
  eq(R.raceClassMoveBonus('Bear, Black', ''), { move: 0, step: 0 }, 'Bear, Black: quadruped Move is conditional, not applied');
  eq(R.raceClassMoveBonus('Mantaur', ''), { move: 0, step: 0 }, 'Mantaur: quadruped Move is conditional, not applied');
  eq(R.raceClassMoveBonus('Capoeirista', ''), { move: 0, step: 0 }, 'Capoeirista: Amazing-Success Step is conditional, not applied');
  eq(R.raceClassMoveBonus('Lizardfolk', ''), { move: 5, step: 5 }, 'Lizardfolk unchanged');
  eq(R.raceClassMoveBonus('Tigran', ''), { move: 10, step: 0 }, 'Tigran unchanged');
})();

// ?v=50: PISTOL is Handgun, F = Floor, HIJACK / FLASH CRAFTING descent ranks
(function () {
  var rc = require('../data/races_classes.json');
  var libData = require('../data/skills_spells.json');
  var byName = {};
  libData.forEach(function (e) { byName[e.name.toLowerCase()] = e; });
  var realLib = function (n) { return byName[(n || '').toLowerCase()] || null; };
  eq(libData.length, 289, 'v50: 289 skills (PISTOL dropped, PISTOL WHIP kept)');
  eq(realLib('PISTOL'), null, 'v50: PISTOL entry gone');
  eq(realLib('PISTOL WHIP') && realLib('PISTOL WHIP').kind, 'attack', 'v50: PISTOL WHIP stays (distinct attack)');
  eq(realLib('PISTOL WHIP').base_effect, 'Melee attack. [Rank = Floor] + Dex to hit. 1d6 + Dex Bludgeoning.', 'v50: PISTOL WHIP "[Rank=F]" -> "[Rank = Floor]"');
  eq(realLib('HANDGUN') && realLib('HANDGUN').kind, 'attack', 'v50: HANDGUN is the live book skill (attack, DEX, p.181)');
  // Super Earth Super Medic: the grant now reads Handgun and parses.
  var sem = rc.find(function (e) { return e.name === 'Super Earth Super Medic'; });
  eq(sem.benefits.indexOf('+2 First Aid, Nonaddictive Stim, Handgun, and Throwing.') >= 0, true, 'v50: SEM grant reads Handgun');
  eq(sem.benefits.indexOf('you may roll the Handgun skill') >= 0, true, 'v50: Stim Pistol rolls the Handgun skill');
  eq(sem.benefits.indexOf('Pistol, and Throwing') < 0, true, 'v50: no Pistol grant left in SEM');
  eq(R.parseFixedSkillBonuses(sem, realLib).filter(function (g) { return g.name === 'HANDGUN'; }),
    [{ name: 'HANDGUN', kind: 'attack', amount: 2 }], 'v50: SEM grants HANDGUN at Rank 2');
  // F = Floor readings.
  var fom = rc.find(function (e) { return e.name === 'Fomorian'; });
  eq(fom.benefits.indexOf('make an Opposed Con + Floor check against a target within 30ft.') >= 0, true, 'v50: Fomorian "Opposed Con + Floor check"');
  var gb = rc.find(function (e) { return e.name === 'Gun Bunny'; });
  eq(gb.benefits.indexOf('+2 Pistol Whip. Melee attack; [Rank = Floor] + Dex to hit.') >= 0, true, 'v50a: Gun Bunny "+2 Pistol Whip" grant (Antony 2026-11-22)');
  eq(gb.uncertain_reason, null, 'v50a: Gun Bunny uncertain_reason cleared (Pistol Whip rank resolved)');
  eq(gb.uncertain, false, 'v50a: Gun Bunny no longer uncertain');
  eq(R.parseFixedSkillBonuses(gb, realLib).filter(function (g) { return g.name === 'PISTOL WHIP'; }),
    [{ name: 'PISTOL WHIP', kind: 'attack', amount: 2 }], 'v50a: Gun Bunny grants PISTOL WHIP at Rank 2');
  eq(R.skillAttackType('PISTOL WHIP'), 'Melee Attack', 'v50a: PISTOL WHIP is a Melee Attack (SKILL_ATTACK_TYPES)');
  eq(R.isAttackSkill('PISTOL WHIP'), true, 'v50a: isAttackSkill(PISTOL WHIP) true — granted card appears in the Attacks tab');
  // v50b: Gun Bunny's "All One-handed Firearm Skills can be raised to
  // Rank 20" now parses as a firearm cap rule (Antony 2026-11-22: ANY
  // skill involving a firearm — Handgun, Shotgun, anything like that;
  // the "one-handed" qualifier is overridden).
  eq(R.parseCapGrants(gb, realLib), [{ type: 'firearm', label: 'all One-handed Firearm Skills' }], 'v50b: Gun Bunny parses the firearm cap rule');
  eq(R.FIREARM_SKILLS, ['handgun', 'shotgun', 'combat rifle', 'sniper rifle', 'long guns', 'smg', 'pistol whip'], 'v50b: FIREARM_SKILLS set (closed by name)');
  var gbRules = R.parseCapGrants(gb, realLib);
  ['HANDGUN', 'SHOTGUN', 'COMBAT RIFLE', 'SNIPER RIFLE', 'LONG GUNS', 'SMG', 'PISTOL WHIP'].forEach(function (n) {
    eq(R.capForCard({ name: n, kind: 'skill' }, gbRules), 20, 'v50b: ' + n + ' caps at 20 under Gun Bunny');
  });
  eq(R.capForCard({ name: 'Dodge', kind: 'skill' }, gbRules), 15, 'v50b: Dodge stays 15 under Gun Bunny (not a firearm)');
  // Excluded by name: Aiming (general ranged support), Double Tap (any
  // weapon or Spell), GOLDEN GUN (a Handgun Damage Effect, not a skill),
  // SLINGSHOT (not a firearm).
  eq(R.capForCard({ name: 'Aiming', kind: 'skill' }, gbRules), 15, 'v50b: Aiming excluded (general ranged support)');
  eq(R.capForCard({ name: 'Double Tap', kind: 'skill' }, gbRules), 15, 'v50b: Double Tap excluded (any weapon or Spell)');
  eq(R.capForCard({ name: 'GOLDEN GUN', kind: 'skill' }, gbRules), 15, 'v50b: GOLDEN GUN excluded (a Damage Effect, not a firearm skill)');
  eq(R.capForCard({ name: 'SLINGSHOT', kind: 'skill' }, gbRules), 15, 'v50b: SLINGSHOT excluded (not a firearm)');
  var pm = rc.find(function (e) { return e.name === 'Pyre-Mancer'; });
  eq(pm.benefits.indexOf('inflicts 1d4 + Floor mixed fire and necrotic damage') >= 0, true, 'v50: Pyre-Mancer "1d4 + Floor"');
  // v50b: F = Floor for the two BOOK entries (Antony 2026-11-22) — direct
  // port edits of book text; must be carried forward on any rebuild.
  var cd = rc.find(function (e) { return e.name === 'Changbi Demon'; });
  eq(cd.benefits.indexOf('takes 1d4 + Floor Acid') >= 0, true, 'v50b: Changbi Demon "1d4 + Floor Acid"');
  eq(cd.benefits.indexOf('1d4+F') < 0, true, 'v50b: no "1d4+F" left in Changbi Demon');
  var ig = rc.find(function (e) { return e.name === 'Igneous'; });
  eq(ig.benefits.indexOf('deal 1d8 + Floor Fire damage') >= 0, true, 'v50b: Igneous "1d8 + Floor Fire damage"');
  eq(ig.benefits.indexOf('1d8+F') < 0, true, 'v50b: no "1d8+F" left in Igneous');
  eq(rc.some(function (e) { return /1d\d\+F/.test(e.benefits || ''); }), false, 'v50b: no "1dN+F" left in race/class text');
  eq(rc.some(function (e) { return (e.benefits || '').indexOf('[Rank=F]') >= 0; }), false, 'v50: no "[Rank=F]" left in race/class text');
  eq(libData.some(function (e) { return (e.base_effect || '').indexOf('[Rank=F]') >= 0; }), false, 'v50: no "[Rank=F]" left in library text');
  // Descent skills: the +3 grants stand, and the record tie decides.
  var wan = rc.find(function (e) { return e.name === 'Wannabe'; });
  eq(R.parseFixedSkillBonuses(wan, realLib), [{ name: 'HIJACK', kind: 'utility', amount: 3 }], 'v50: Wannabe still grants HIJACK +3');
  var elf = rc.find(function (e) { return e.name === 'Elf, Christmas'; });
  eq(R.parseFixedSkillBonuses(elf, realLib), [{ name: 'FLASH CRAFTING', kind: 'utility', amount: 3 }], 'v50: Elf, Christmas still grants FLASH CRAFTING +3');
  eq(R.DESCENT_SKILLS.length, 2, 'v50: two descent skills');
  var hijackRec = [{ source: 'class', sourceName: 'Wannabe', skillName: 'HIJACK', kind: 'skill', amount: 3 }];
  var flashRec = [{ source: 'race', sourceName: 'Elf, Christmas', skillName: 'FLASH CRAFTING', kind: 'skill', amount: 3 }];
  eq(R.isDescentSkill('HIJACK', hijackRec), true, 'v50: HIJACK tied to Wannabe counts');
  eq(R.isDescentSkill('HIJACK', []), false, 'v50: HIJACK with no record does not count (manual card)');
  eq(R.isDescentSkill('HIJACK', [{ source: 'class', sourceName: 'Wannabe', skillName: 'HANDGUN', kind: 'skill', amount: 2 }]), false, 'v50: record for another skill does not tie HIJACK');
  eq(R.isDescentSkill('HIJACK', [{ source: 'race', sourceName: 'Wannabe', skillName: 'HIJACK', kind: 'skill', amount: 3 }]), false, 'v50: wrong source kind (race vs class) does not tie');
  eq(R.isDescentSkill('FLASH CRAFTING', flashRec), true, 'v50: FLASH CRAFTING tied to Elf, Christmas counts');
  eq(R.isDescentSkill('FLASH CRAFTING', hijackRec), false, 'v50: Wannabe record does not tie FLASH CRAFTING');
  eq(R.isDescentSkill('TENDRILS', hijackRec), false, 'v50: floor attacks are not descent skills');
  eq(R.descentSkillSpec('HIJACK', hijackRec), { name: 'HIJACK', sourceKind: 'class', sourceName: 'Wannabe' }, 'v50: descent spec for HIJACK');
  eq(R.descentSkillSpec('FLASH CRAFTING', flashRec), { name: 'FLASH CRAFTING', sourceKind: 'race', sourceName: 'Elf, Christmas' }, 'v50: descent spec for FLASH CRAFTING');
  eq(R.descentSkillSpec('HIJACK', []), null, 'v50: no spec without a tying record');
  // Caps for the descent bump: HIJACK is 20 while Wannabe is held (its
  // "All Skills" clause); FLASH CRAFTING is 15 (not in the crafting set).
  eq(R.capForCard({ name: 'HIJACK', kind: 'skill' }, R.parseCapGrants(wan, realLib)), 20, 'v50: HIJACK caps at 20 under Wannabe');
  eq(R.capForCard({ name: 'FLASH CRAFTING', kind: 'skill' }, R.parseCapGrants(elf, realLib)), 15, 'v50: FLASH CRAFTING caps at 15 under Elf, Christmas');
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
