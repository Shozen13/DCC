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
// Base is own base only (race/class NOT folded in); Total = Base +
// Enhance + Gear + Race/Class, minimum Total 1
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
eq(de.map(e => e.name).sort(), ['CHOKE OUT', 'DIRTY FIGHTING', 'IRON PUNCH', 'POWERFUL STRIKE', 'SKULLCRACKER', 'SMUSH', 'TOSS'], 'exactly 7 Damage Effects in the library');
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
(function () {
  var c = R.foldBackgroundRank({ background: true, backgroundRank: 3, ownRank: 0 });
  eq(c.ownRank, 3, 'fold: background 3 becomes trained 3');
  eq(c.backgroundRank, 0, 'fold clears backgroundRank');
  eq(R.displayRank(c, 0, 0, 0, 0), 3, 'folded card still displays 3');
  var legacy = R.foldBackgroundRank({ background: true, backgroundRank: 3, ownRank: 3 });
  eq(legacy.ownRank, 3, 'fold repairs old double-count (own 3 + bg 3 -> trained 3, not 6)');
  var trained = R.foldBackgroundRank({ background: true, backgroundRank: 3, ownRank: 2, bgSplit: true });
  eq(trained.ownRank, 5, 'fold keeps trained ranks: own 2 + background 3 -> trained 5');
  var twice = R.foldBackgroundRank(c);
  eq(twice.ownRank, 3, 'fold is idempotent');
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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
