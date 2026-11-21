/* Node tests for data/book_checks.json (the book lock derivation).
 * Run: node tests/test_bookchecks.js
 * Checks: 170 entries (one per Chapter 4 skill/spell, plus the two
 * custom floor-driven attacks TENDRILS and TONGUE LASH), every name
 * exists in the library, and the locked-check count matches the
 * original build plus those two (116 locked, 54 editable).
 */
const checks = require('../data/book_checks.json');
const lib = require('../data/skills_spells.json');
let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('PASS', label); }
  else { fail++; console.log('FAIL', label); }
}
const norm = (s) => String(s || '').trim().toLowerCase();
const libNames = new Set(lib.map((e) => norm(e.name)));
ok(checks.length === 170, 'book checks has 170 entries (got ' + checks.length + ')');
ok(checks.every((e) => libNames.has(norm(e.name))), 'every check entry name is in the library');
const locked = checks.filter((e) => e.check);
ok(locked.length === 116, '116 entries have a derived (locked) check (got ' + locked.length + ')');
ok(checks.filter((e) => !e.check).length === 54, '54 entries keep an editable check');
ok(locked.every((e) => ['Active Check', 'Contested Check', 'Evade Check', 'Passive Effect'].includes(e.check)), 'locked checks use only the four check types');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
