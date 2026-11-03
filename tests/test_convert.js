/* Node tests for js/convert.js (original <-> merged format conversion).
 * Run: node tests/test_convert.js
 */
const C = require('../js/convert.js');
let pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log('PASS', label); }
  else { fail++; console.log('FAIL', label, '| got', JSON.stringify(actual), '| want', JSON.stringify(expected)); }
}

// Lifebringer example, original bookkeeping -> recomputed model:
// Nature's Breath stored rank 4 = trained 1 + fixed 2 + group 1.
const raceApplied = [{ source: 'class', sourceName: 'Lifebringer', skillName: "Nature's Breath", kind: 'spell', amount: 2, createdByBonus: false }];
eq(C.cardOwnRank({ name: "Nature's Breath", kind: 'spell', rank: 4, gearGrants: {}, groupBonus: 1 }, raceApplied), 1, 'NB ownRank 4-2-1=1');
eq(C.cardOwnRank({ name: "Nature's Breath", kind: 'spell', rank: 3, gearGrants: {}, groupBonus: 1 }, raceApplied), 0, 'NB at floor 3 -> ownRank 0');
eq(C.cardOwnRank({ name: 'Foot Soldier', kind: 'skill', rank: 5, gearGrants: { item1: 2 }, groupBonus: 0 }, []), 3, 'gear grant floor subtracted');
// Floor clamps at zero, never negative.
eq(C.cardOwnRank({ name: 'X', kind: 'skill', rank: 1, gearGrants: { a: 5 }, groupBonus: 0 }, []), 0, 'over-granted clamps to 0');

const orig = {
  name: 'Test', number: '7', race: 'Human', class: 'Lifebringer', level: 3, floor: 2,
  strBase: '8', conBase: '6', dexBase: '5', intBase: '7', chaBase: '4',
  strEnh: '1', conEnh: '0', dexEnh: '0', intEnh: '0', chaEnh: '0',
  hpCurrent: 8, manaCurrent: 5, gold: 50, popularity: 2, aiFavor: 1, moveVal: 20, stepVal: 10,
  bossKills: 1, pkKills: 0, statPointsSpent: 3,
  buffs: [{ name: 'Blessed', notes: '' }], debuffs: ['Poisoned'],
  hotlistState: { 'hotlist-select-0': 'Fireball', 'hotlist-select-1': '' },
  skills: [{ name: 'First Aid', rank: 4, stat: 'INT', checkType: 'Active Check', effect: '', used: false, gearGrants: {}, groupBonus: 0 }],
  spells: [{ name: "Nature's Breath", rank: 4, stat: 'INT', checkType: 'Active Check', effect: '', used: false, gearGrants: {}, groupBonus: 1 }],
  attacks: [{ name: 'Club', stat: 'STR', damage: '1d6 + Str Bludgeoning', notes: '' }],
  items: [{ name: 'Test Buckler', slot: 'Hands', notes: 'Sturdy', equipped: true, bonuses: [{ type: 'dr', amount: 3 }, { type: 'grant', skill: 'Shield Block', amount: 1 }] }],
  raceClassSkillApplied: raceApplied,
  raceClassChoices: { 'race:Elf, City:split0': { split: { int: 3, dex: 3 } } },
  activeTab: 'items'
};
const merged = C.originalToMerged(orig, { isSpellName: (n) => n === "Nature's Breath", normalizeSlot: (s) => s || 'Other' });
eq(merged.ownBase, { str: 8, con: 6, dex: 5, int: 7, cha: 4 }, 'ownBase from *Base strings');
eq(merged.spells[0].ownRank, 1, 'converted NB ownRank');
eq(merged.skills[0].ownRank, 4, 'unbonused skill keeps rank as ownRank');
eq(merged.hotlist, ['Fireball'], 'hotlistState values carried over');
eq(merged.buffs, ['Blessed'], 'buff objects -> names');
eq(merged.activeTab, 'inventory', 'items tab maps to inventory');
eq(merged.raceClassChoices['race:Elf, City:split0-0'].split, { int: 3, dex: 3 }, 'split choice id gains -0 suffix');
eq(merged.items[0].bonuses, [{ type: 'dr', amount: 3 }, { type: 'grant', skillName: 'Shield Block', kind: 'skill', amount: 1 }], 'item bonuses mapped');
eq(merged.items[0].equipped, true, 'equipped preserved');

// Round trip: merged -> original preserves displayed ranks.
const derived = { str: 8, con: 6, dex: 5, int: 7, cha: 4 };
function floorFor(card) {
  const gear = Object.values(card.gearGrants || {}).reduce((a, b) => a + b, 0);
  let race = 0, group = 0;
  if (card.name === "Nature's Breath") { race = 2; group = 1; }
  return { rank: card.ownRank + gear + race + group, gear, race, group };
}
const back = C.mergedToOriginal(Object.assign(merged, { ownEnh: { str: 1, con: 0, dex: 0, int: 0, cha: 0 }, ownArmor: 0, raceClassMoveApplied: null, avatarUrl: '' }), derived, floorFor);
eq(back.spells[0].rank, 4, 'round trip NB rank 4');
eq(back.spells[0].groupBonus, 1, 'round trip NB groupBonus 1');
eq(back.skills[0].rank, 4, 'round trip skill rank 4');
eq(back.strBase, '8', 'round trip strBase from derived');
eq(back.raceClassChoices['race:Elf, City:split0'].split, { int: 3, dex: 3 }, 'split choice id loses -0 suffix on export');
eq(back.items[0].bonuses[1], { type: 'grant', stat: undefined, skill: 'Shield Block', amount: 1 }, 'grant bonus back to original shape');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
