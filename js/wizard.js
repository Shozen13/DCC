/* wizard.js — guided creation. Edits the live sheet state (via window.DCC)
 * so the Review step is always the real sheet, never a separate draft.
 * The wizard is always skippable: Skip gives a blank sheet, Exit keeps
 * whatever is on the sheet so far. It never traps the user, and it never
 * runs automatically — it only starts from the gateway's Guided button.
 *
 * Steps: 0 Name, 1 Stats, 2 Backgrounds, 3 Race/Class, 4 Starting
 * gear, 5 Review. Backgrounds follow the book's Step 1: one background
 * each for childhood, adolescence, career, and hobby, two of its three
 * skills each (Rank 1 / 1 / 3 / 2), no double-dipping, plus the combat
 * background (Unarmed Combat Rank 3 and a weapon skill or attack spell
 * at Rank 3, or unarmed only). Race/class choice grants (splits and
 * picks) are handled on the sheet's Choices tab, which the Race/Class
 * step links to.
 */
(function () {
  'use strict';
  var R = window.DCCRules;
  var step = 0;
  var statMethod = 'array';
  var rolled = null; // {str,con,dex,int,cha} from the dice step, if any
  var wizStats = null; // manual/array values being edited in this step
  var bgData = null, bgPromise = null;
  var bgSel = null; // {childhood:{bg,skills[]}, adolescence:{...}, career:{...}, hobby:{...}}
  var combatSel = null; // {type:'weapon'|'spell'|'none', name:''}
  function ensureBgData() {
    if (!bgPromise) bgPromise = fetch('data/backgrounds.json?v=10').then(function (r) { return r.json(); }).then(function (d) { bgData = d; return d; });
    return bgPromise;
  }
  function initBgSel() {
    if (bgSel) return;
    var saved = S().backgrounds || {};
    bgSel = {};
    (bgData.categories || []).forEach(function (cat) {
      var sv = saved[cat.id] || {};
      bgSel[cat.id] = { bg: sv.bg || cat.backgrounds[0].name, skills: (sv.skills || []).slice() };
    });
    combatSel = saved.combat ? { type: saved.combat.type || 'none', name: saved.combat.name || '' } : { type: 'none', name: '' };
  }

  function S() { return window.DCC.getState(); }
  function refresh() { window.DCC.renderAll(); }
  function el(id) { return document.getElementById(id); }

  function start() {
    step = 0; statMethod = 'array'; rolled = null; wizStats = null; bgSel = null; combatSel = null;
    el('wizard').hidden = false;
    render();
  }
  function close() { el('wizard').hidden = true; }
  function titles() {
    return ['Name', 'Stats', 'Backgrounds', 'Race & Class', 'Starting gear', 'Review'];
  }
  function render() {
    el('wiz-title').textContent = 'Guided creation — Step ' + (step + 1) + ' of 6: ' + titles()[step];
    var body = el('wiz-body');
    if (step === 0) renderName(body);
    else if (step === 1) renderStats(body);
    else if (step === 2) renderBackgrounds(body);
    else if (step === 3) renderRaceClass(body);
    else if (step === 4) renderGear(body);
    else renderReview(body);
    el('wiz-back').style.visibility = step === 0 ? 'hidden' : 'visible';
    el('wiz-next').textContent = step === 5 ? 'Finish — go to sheet' : 'Continue';
  }
  function err(msg) {
    var e = el('wiz-error');
    if (e) e.textContent = msg;
    else {
      var d = document.createElement('p');
      d.id = 'wiz-error'; d.style.color = '#d97a6a'; d.textContent = msg;
      el('wiz-body').appendChild(d);
    }
  }
  function renderName(body) {
    var s = S();
    body.innerHTML = '<div class="wiz-field"><label>What do they call you?</label>'
      + '<input type="text" id="wiz-name" value="' + String(s.name).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + '" placeholder="e.g. Pip, Marrow, Sable…"></div>'
      + '<p class="hint">Every crawler starts as a fledgling nobody. Race and class come next — in the book, race and class are chosen on the Third Floor, but this sheet lets you pick them now if your campaign starts there.</p>';
    el('wiz-name').addEventListener('change', function () { s.name = el('wiz-name').value.trim(); window.DCC.saveSoon(); });
  }
  function currentStats() {
    if (!wizStats) wizStats = { str: 1, con: 1, dex: 1, int: 1, cha: 1 };
    return wizStats;
  }
  function renderStats(body) {
    if (statMethod === 'array' && !wizStats) wizStats = { str: 6, int: 5, con: 4, dex: 3, cha: 2 };
    var st = currentStats();
    var rows = R.STAT_KEYS.map(function (k) {
      if (statMethod === 'array') {
        var opts = [2, 3, 4, 5, 6].map(function (v) { return '<option value="' + v + '"' + (st[k] === v ? ' selected' : '') + '>' + v + '</option>'; }).join('');
        return '<p>' + k.toUpperCase() + ': <select data-wiz-stat="' + k + '">' + opts + '</select> (mod +' + R.getModifier(st[k]) + ')</p>';
      }
      return '<p>' + k.toUpperCase() + ': <input type="number" min="1" data-wiz-stat="' + k + '" value="' + st[k] + '"> (mod +' + R.getModifier(st[k]) + ')</p>';
    }).join('');
    body.innerHTML = '<p>Five numbers define your crawler.</p>'
      + '<div class="btn-row">'
      + '<button type="button" id="wiz-m-array">Standard array (2 · 3 · 4 · 5 · 6)</button>'
      + '<button type="button" id="wiz-m-roll">Roll dice</button>'
      + '<button type="button" id="wiz-m-manual">Enter your own</button></div>'
      + (statMethod === 'roll' ? '<button type="button" id="wiz-roll">Roll five dice (1s are re-rolled)</button><p class="hint">Each die is a d6; a 1 is re-rolled, so results are 2–6.</p>' : '')
      + (statMethod === 'array' ? '<p class="hint">Standard array: use each of 2, 3, 4, 5, 6 exactly once.</p>' : '')
      + rows;
    el('wiz-m-array').addEventListener('click', function () { statMethod = 'array'; wizStats = { str: 6, int: 5, con: 4, dex: 3, cha: 2 }; render(); });
    el('wiz-m-roll').addEventListener('click', function () { statMethod = 'roll'; render(); });
    el('wiz-m-manual').addEventListener('click', function () { statMethod = 'manual'; render(); });
    var rb = el('wiz-roll');
    if (rb) rb.addEventListener('click', function () {
      rolled = {};
      R.STAT_KEYS.forEach(function (k) {
        var v = 1;
        while (v === 1) v = 1 + Math.floor(Math.random() * 6);
        rolled[k] = v;
      });
      wizStats = Object.assign({}, rolled);
      render();
    });
    body.querySelectorAll('[data-wiz-stat]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        wizStats[inp.dataset.wizStat] = Math.max(1, parseInt(inp.value, 10) || 1);
        render();
      });
    });
  }
  function renderRaceClass(body) {
    var s = S();
    body.innerHTML = '<p>Race: <strong>' + (s.race || '—') + '</strong> <button type="button" id="wiz-race">Pick race</button> '
      + '<button type="button" id="wiz-race-info">?</button> <button type="button" id="wiz-race-clear">Clear</button></p>'
      + '<p>Class: <strong>' + (s.class || '—') + '</strong> <button type="button" id="wiz-class">Pick class</button> '
      + '<button type="button" id="wiz-class-info">?</button> <button type="button" id="wiz-class-clear">Clear</button></p>'
      + '<p class="hint">Picking a race or class applies its fixed bonuses, split pools, and fixed skill/spell bonuses automatically. Split pools and choice picks live on the Choices tab after you finish — or open it from the sheet at any time. Full rulebook text is behind the ? button, never shown all at once.</p>'
      + '<p class="hint">You may leave race and class blank and pick them later on the sheet.</p>';
    el('wiz-race').addEventListener('click', function () { window.DCC.openRaceClassPicker('race'); });
    el('wiz-class').addEventListener('click', function () { window.DCC.openRaceClassPicker('class'); });
    el('wiz-race-info').addEventListener('click', function () { window.DCC.showRaceClassInfo('race'); });
    el('wiz-class-info').addEventListener('click', function () { window.DCC.showRaceClassInfo('class'); });
    el('wiz-race-clear').addEventListener('click', function () { window.DCC.setRaceClass('race', ''); render(); });
    el('wiz-class-clear').addEventListener('click', function () { window.DCC.setRaceClass('class', ''); render(); });
  }
  function pickedSkillNames(exceptCat) {
    var out = {};
    Object.keys(bgSel).forEach(function (cid) {
      if (cid === exceptCat) return;
      (bgSel[cid].skills || []).forEach(function (n) { out[n.toLowerCase()] = true; });
    });
    return out;
  }
  function renderBackgrounds(body) {
    var s = S();
    body.innerHTML = '<p class="hint">Book Step 1: pick one background for each stage of life, then two of its three skills. No double-dipping — a skill picked from one background cannot be picked from another. Ranks: childhood 1, adolescence 1, career 3, hobby 2.</p><p>Loading backgrounds…</p>';
    ensureBgData().then(function () {
      initBgSel();
      var html = '<p class="hint">Book Step 1: pick one background for each stage of life, then two of its three skills. No double-dipping — a skill picked from one background cannot be picked from another.</p>';
      bgData.categories.forEach(function (cat) {
        var sel = bgSel[cat.id];
        var bg = cat.backgrounds.find(function (b) { return b.name === sel.bg; }) || cat.backgrounds[0];
        var others = pickedSkillNames(cat.id);
        html += '<div class="card"><h3>' + cat.label + ' — skills start at Rank ' + cat.rank + '</h3><p>' + cat.note + '</p>'
          + '<label>Background <select data-bg-cat="' + cat.id + '">' + cat.backgrounds.map(function (b) { return '<option' + (b.name === sel.bg ? ' selected' : '') + '>' + b.name + '</option>'; }).join('') + '</select></label> '
          + '<button type="button" data-bg-roll="' + cat.id + '">Roll 1d12</button>'
          + '<p>' + bg.skills.map(function (sk) {
            var checked = sel.skills.indexOf(sk.name) >= 0;
            var disabled = (!checked && sel.skills.length >= 2) || (!checked && others[sk.name.toLowerCase()]);
            var why = others[sk.name.toLowerCase()] ? ' (already picked from another background)' : (sel.skills.length >= 2 && !checked ? ' (pick two only)' : '');
            return '<label><input type="checkbox" data-bg-skill="' + cat.id + '" value="' + sk.name + '"' + (checked ? ' checked' : '') + (disabled ? ' disabled' : '') + '> ' + sk.name + ' (' + (sk.stat || 'no stat') + ')' + why + '</label>';
          }).join('<br>') + '</p></div>';
      });
      // Combat background (book Step 2, folded into this step so the
      // wizard's skill list is complete before Race/Class).
      html += '<div class="card"><h3>Combat background</h3>'
        + '<p class="hint">Human crawlers start with Unarmed Combat at Rank 3. Your second combat skill is the weapon you bring into the dungeon (Rank 3), or a low-mana Attack Spell at Rank 3 (needs INT 4+), or unarmed only.</p>'
        + '<label><input type="radio" name="wiz-combat-type" value="weapon"' + (combatSel.type === 'weapon' ? ' checked' : '') + '> Weapon skill</label> '
        + '<label><input type="radio" name="wiz-combat-type" value="spell"' + (combatSel.type === 'spell' ? ' checked' : '') + '> Attack spell</label> '
        + '<label><input type="radio" name="wiz-combat-type" value="none"' + (combatSel.type === 'none' ? ' checked' : '') + '> Unarmed only</label><br>'
        + (combatSel.type === 'weapon' ? '<label>Weapon <select id="wiz-combat-name">' + bgData.combat_weapons.map(function (w) { return '<option' + (combatSel.name === w ? ' selected' : '') + '>' + w + '</option>'; }).join('') + '</select></label>' : '')
        + (combatSel.type === 'spell' ? '<label>Spell <select id="wiz-combat-name"></select></label><p class="hint">Attack spells are loaded from the rulebook library; pick one with a damage line.</p>' : '')
        + '</div>';
      body.innerHTML = html;
      body.querySelectorAll('[data-bg-cat]').forEach(function (selEl) {
        selEl.addEventListener('change', function () { bgSel[selEl.dataset.bgCat].bg = selEl.value; bgSel[selEl.dataset.bgCat].skills = []; render(); });
      });
      body.querySelectorAll('[data-bg-roll]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var cat = bgData.categories.find(function (c) { return c.id === btn.dataset.bgRoll; });
          bgSel[cat.id].bg = cat.backgrounds[Math.floor(Math.random() * cat.backgrounds.length)].name;
          bgSel[cat.id].skills = [];
          render();
        });
      });
      body.querySelectorAll('[data-bg-skill]').forEach(function (cb) {
        cb.addEventListener('change', function () {
          var list = bgSel[cb.dataset.bgSkill].skills;
          if (cb.checked) { if (list.indexOf(cb.value) < 0) list.push(cb.value); }
          else { var i = list.indexOf(cb.value); if (i >= 0) list.splice(i, 1); }
          render();
        });
      });
      body.querySelectorAll('input[name="wiz-combat-type"]').forEach(function (r) {
        r.addEventListener('change', function () { combatSel.type = r.value; combatSel.name = ''; render(); });
      });
      var cn = el('wiz-combat-name');
      if (cn && combatSel.type === 'spell') {
        window.DCC.ensureSkills().then(function (list) {
          var spells = list.filter(function (e) { return e.kind === 'spell' && e.base_damage; });
          cn.innerHTML = spells.map(function (e) { return '<option' + (combatSel.name === e.name ? ' selected' : '') + '>' + e.name + '</option>'; }).join('');
          if (!combatSel.name && spells.length) combatSel.name = spells[0].name;
          cn.addEventListener('change', function () { combatSel.name = cn.value; });
        });
      } else if (cn) {
        if (!combatSel.name) combatSel.name = bgData.combat_weapons[0];
        cn.addEventListener('change', function () { combatSel.name = cn.value; });
      }
      var cats = bgData.categories;
      var preview = '<div class="card"><h3>Skills this gives you (10 in total)</h3><p>'
        + cats.map(function (cat) { return cat.label + ': ' + (bgSel[cat.id].skills.join(', ') || '— pick two') + ' (Rank ' + cat.rank + ')'; }).join('<br>')
        + '<br>Combat: Unarmed Combat (Rank 3)' + (combatSel.type === 'none' ? '' : ' + ' + (combatSel.name || '—') + ' (Rank 3)') + '</p></div>';
      body.insertAdjacentHTML('beforeend', preview);
    }).catch(function () {
      body.innerHTML = '<p>Could not load the backgrounds data. You can still add skills by hand on the Skills tab after finishing.</p>';
    });
  }
  function applyBackgrounds() {
    // Validate first.
    var ok = true;
    bgData.categories.forEach(function (cat) {
      if ((bgSel[cat.id].skills || []).length !== 2) { err(cat.label + ': pick exactly two skills.'); ok = false; }
    });
    if (combatSel.type !== 'none' && !combatSel.name) { err('Pick a combat weapon/spell, or choose Unarmed only.'); ok = false; }
    if (combatSel.type === 'spell' && S().ownBase.int < 4) { err('An attack spell needs INT 4 or higher (book Step 2). Raise INT on the Stats step, or pick a weapon instead.'); ok = false; }
    if (!ok) return false;
    var s = S();
    // Remove old background-flagged cards that are no longer selected
    // and were never trained beyond their background rank; keep a card
    // the player trained past that rank (it became theirs, not the
    // background's), and keep cards with other given amounts.
    var wanted = {};
    bgData.categories.forEach(function (cat) {
      bgSel[cat.id].skills.forEach(function (n) { wanted[n.toLowerCase()] = cat.rank; });
    });
    function prune(list) {
      return list.filter(function (c) {
        if (!c.background) return true;
        if (wanted[c.name.toLowerCase()] !== undefined) return true;
        // Split model: ownRank is the trained part only, so any trained
        // rank (or a live gear grant) means the card is the player's now.
        return c.ownRank > 0 || Object.keys(c.gearGrants || {}).length > 0;
      });
    }
    s.skills = prune(s.skills); s.spells = prune(s.spells);
    // Apply each background skill: never stack ranks for a duplicate
    // (no double-dipping) — the card keeps the higher rank.
    var libByName = {};
    bgData.categories.forEach(function (cat) {
      cat.backgrounds.forEach(function (bg) { bg.skills.forEach(function (sk) { libByName[sk.name.toLowerCase()] = sk; }); });
    });
    bgData.categories.forEach(function (cat) {
      bgSel[cat.id].skills.forEach(function (name) {
        var rank = cat.rank;
        var bgSk = libByName[name.toLowerCase()] || {};
        var list = s.skills;
        var card = list.find(function (c) { return c.name.toLowerCase() === name.toLowerCase(); });
        if (card) {
          // Trained rank untouched; the background rank is a given floor.
          card.background = true; card.backgroundRank = Math.max(card.backgroundRank || 0, rank); card.bgSplit = true;
        } else {
          var lib = window.DCC.findLib(name);
          list.push({ id: 'id' + Date.now() + Math.random().toString(36).slice(2), name: name, kind: 'skill', ownRank: 0, stat: (bgSk.stat || (lib && lib.stat) || 'STR').toLowerCase(), checkType: 'Active Check', effect: '', used: false, gearGrants: {}, background: true, backgroundRank: rank, bgSplit: true });
        }
      });
    });
    // Combat background: Unarmed Combat Rank 3, plus weapon/spell Rank 3.
    function addCombat(name, kind) {
      var list = kind === 'spell' ? s.spells : s.skills;
      var card = list.find(function (c) { return c.name.toLowerCase() === name.toLowerCase(); });
      if (card) { card.background = true; card.backgroundRank = Math.max(card.backgroundRank || 0, 3); card.bgSplit = true; }
      else {
        var lib = window.DCC.findLib(name);
        list.push({ id: 'id' + Date.now() + Math.random().toString(36).slice(2), name: name, kind: kind, ownRank: 0, stat: (lib && lib.stat ? lib.stat : (kind === 'spell' ? 'INT' : 'STR')).toLowerCase(), checkType: 'Active Check', effect: '', used: false, gearGrants: {}, background: true, backgroundRank: 3, bgSplit: true });
      }
    }
    addCombat('UNARMED COMBAT', 'skill');
    if (combatSel.type === 'weapon' && combatSel.name) addCombat(combatSel.name, 'skill');
    if (combatSel.type === 'spell' && combatSel.name) addCombat(combatSel.name, 'spell');
    // No manual UNARMED COMBAT attack is created here: the Attacks tab
    // derives it from the skill card above, like any other attack skill.
    s.backgrounds = { childhood: bgSel.childhood, adolescence: bgSel.adolescence, career: bgSel.career, hobby: bgSel.hobby, combat: combatSel };
    window.DCC.saveSoon(); refresh();
    return true;
  }
  function renderGear(body) {
    var s = S();
    body.innerHTML = '<p>Starting gear. Pick from the rulebook or add a custom item; equip it on the Gear tab after finishing.</p>'
      + '<div class="btn-row"><button type="button" id="wiz-item-pick">Pick from rulebook</button>'
      + '<button type="button" id="wiz-item-add">Add custom item</button></div>'
      + '<ul>' + s.items.map(function (i) { return '<li>' + String(i.name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + ' <button type="button" data-wiz-del-item="' + i.id + '">Remove</button></li>'; }).join('') + '</ul>';
    el('wiz-item-pick').addEventListener('click', function () { window.DCC.openItemPicker(); });
    el('wiz-item-add').addEventListener('click', function () {
      var name = prompt('Custom item name:');
      if (name && name.trim()) { s.items.push({ id: 'id' + Date.now(), name: name.trim(), kind: 'other', slot: 'Other', effect: '', bonuses: [], equipped: false }); window.DCC.saveSoon(); render(); }
    });
    body.querySelectorAll('[data-wiz-del-item]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-wiz-del-item');
        var st = S();
        st.items = st.items.filter(function (i) { return i.id !== id; });
        window.DCC.saveSoon(); render();
      });
    });
  }
  function renderReview(body) {
    var s = S();
    refresh();
    // Derived numbers are read from the live sheet after refresh.
    var hpText = el('hp-text') ? el('hp-text').textContent : '';
    var manaText = el('mana-text') ? el('mana-text').textContent : '';
    var evadeText = el('evade-disp') ? el('evade-disp').textContent : '';
    body.innerHTML = '<ul>'
      + '<li>Name set: ' + (s.name || '— (empty)') + '</li>'
      + '<li>Stats: ' + R.STAT_KEYS.map(function (k) { return k.toUpperCase() + ' ' + s.ownBase[k]; }).join(', ') + ' (own base, before race/class bonuses)</li>'
      + '<li>Race: ' + (s.race || '—') + ' · Class: ' + (s.class || '—') + '</li>'
      + '<li>Skills: ' + s.skills.length + ' · Spells: ' + s.spells.length + ' · Items: ' + s.items.length + '</li>'
      + '<li>Health: ' + hpText + ' · Mana: ' + manaText + ' · Evade: ' + evadeText + '</li>'
      + '<li>Level ' + s.level + ', Floor ' + s.floor + ', Stat Bank ' + R.statBank(s.level, s.statPointsSpent) + '</li>'
      + '</ul><p class="hint">Check everything, go Back to change anything, or Finish to go to the sheet. Nothing here is final — the sheet stays fully editable.</p>';
  }
  function applyStatsStep() {
    if (statMethod === 'array') {
      var st = currentStats();
      var vals = R.STAT_KEYS.map(function (k) { return st[k]; }).sort(function (a, b) { return a - b; });
      if (vals.join(',') !== '2,3,4,5,6') { err('Standard array: use each of 2, 3, 4, 5, 6 exactly once.'); return false; }
    }
    var s = S();
    var st2 = currentStats();
    R.STAT_KEYS.forEach(function (k) { s.ownBase[k] = Math.max(1, st2[k]); });
    // A new crawler starts full: 10 HP slots, mana = INT total.
    s.hpCurrent = 10;
    window.DCC.saveSoon();
    refresh();
    return true;
  }
  function next() {
    if (step === 0) {
      var s = S();
      var v = el('wiz-name') ? el('wiz-name').value.trim() : s.name;
      if (!v) { err('Give your crawler a name first — or use Skip wizard to leave the sheet blank.'); return; }
      s.name = v;
    }
    if (step === 1 && !applyStatsStep()) return;
    if (step === 2) {
      if (!bgData) { err('Backgrounds are still loading — wait a moment and try again.'); return; }
      initBgSel();
      if (!applyBackgrounds()) return;
    }
    if (step === 5) { close(); if (window.Cloud && window.Cloud.onWizardFinished) window.Cloud.onWizardFinished(); window.DCC.showTab('vitals'); return; }
    step++;
    render();
  }
  function back() { if (step > 0) { step--; render(); } }

  document.addEventListener('DOMContentLoaded', function () {
    var nb = el('wiz-next'), bb = el('wiz-back'), sb = el('wiz-skip'), xb = el('wiz-exit');
    if (nb) nb.addEventListener('click', next);
    if (bb) bb.addEventListener('click', back);
    if (sb) sb.addEventListener('click', function () { close(); if (window.Cloud && window.Cloud.onWizardFinished) window.Cloud.onWizardFinished(); window.DCC.showTab('vitals'); });
    if (xb) xb.addEventListener('click', close);
  });

  window.Wizard = { start: start, close: close, render: render };
})();
