/* cloud.js — Supabase auth, cloud sync, campaigns, parties, DM tools,
 * loot boxes and achievements, ported from the original sheet
 * (Shozen13/DCC, live head afcc278b) onto the merged sheet's state shape.
 *
 * The original sheet's character object is NOT reused: the merged app saves
 * the new sheet's state shape (ownRank-based recomputed ranks) to
 * characters.data, and the user recreates characters rather than migrating
 * old saves. What is reused verbatim where possible: the Supabase project,
 * table/column names, RPC names, status/grade orderings, and user-visible
 * behaviour (start-screen sets, DM tools, loot popup order, gold hints).
 *
 * Security: only the publishable key from the original sheet is embedded
 * here (it is designed to ship in client code). No service_role/secret key
 * and no database password is used anywhere in this app.
 *
 * This file is a classic script, not a module: its functions are globals so
 * the ported panel markup can call them with onclick="...", exactly as the
 * original did. Hooks the sheet calls: window.Cloud = { showLanding,
 * isDm, onLocalSave (cloud autosave), onWizardFinished, onTabShown }.
 */
var SUPABASE_URL = 'https://pcogpowectjamqwppzgq.supabase.co';
var SUPABASE_KEY = 'sb_publishable_cRw8dcqNcT8SAtbCEdme6A_3VYkJl1h';
var sb = null;
var cloudUser = null;
var cloudCharacterId = localStorage.getItem('crawler_cloud_id') || null;
var cloudCampaignId = localStorage.getItem('cloud_campaign_id') || null;
var cloudCampaignsCache = [];
var crawlerMode = localStorage.getItem('crawler_mode') || null;
var pendingRole = null;
var signupWithoutRole = false;
var realtimeChannel = null;
var applyingRemote = false;
var autosaveTimer = null;
var lastOwnAutosaveAt = null;

function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function $(id) { return document.getElementById(id); }
function cloudStatus(msg, section) {
  var el = $(section ? ('cloud-status-' + section) : 'cloud-status');
  if (el) el.innerText = msg || '';
  // Party/DM actions in the management tab report to 'focus' (the old
  // Campaign-tab block, hidden for DMs) -- mirror them visibly there.
  if (section === 'focus' && crawlerMode === 'dm') {
    var m = $('manage-status'); if (m) m.innerText = msg || '';
  }
}
function dmStatus(msg) { var el = $('dm-status'); if (el) el.innerText = msg || ''; }
function landingStatus(msg) { var el = $('landing-status'); if (el) el.innerText = msg || ''; }
function achStatus(msg) { var el = $('ach-status'); if (el) el.innerText = msg || ''; }
function lootStatus(msg) { var el = $('loot-status'); if (el) el.innerText = msg || ''; }
function boxStatus(msg) { var el = $('box-status'); if (el) el.innerText = msg || ''; }

/* The merged state keeps its own localStorage key (dcc-sheet-v2); the cloud
 * layer only needs a deep copy of it for upload, and applies downloaded
 * states through the sheet's own setState/renderAll. */
function getSheetCopy() {
  try { return JSON.parse(JSON.stringify(window.DCC.getState())); } catch (e) { return null; }
}
function hpSlotsText(d) {
  if (!d) return '?';
  return (d.hpCurrent === null || d.hpCurrent === undefined ? '?' : d.hpCurrent) + ' / 10 slots';
}
function needLogin() {
  if (!sb) { cloudStatus('Supabase library failed to load. Check your connection and reload the page.'); return false; }
  if (!cloudUser) { cloudStatus('Log in first, in the Account section above.'); return false; }
  return true;
}
function applyModeClass() {
  document.body.classList.toggle('dm-mode', crawlerMode === 'dm');
}
function setMode(mode) {
  crawlerMode = mode;
  localStorage.setItem('crawler_mode', mode);
  applyModeClass();
  renderAccountSection();
}
function renderAccountSection() {
  var out = $('cloud-signedout-box'), inn = $('cloud-signedin-box');
  if (!out || !inn) return;
  var signedIn = !!cloudUser;
  out.hidden = signedIn;
  inn.hidden = !signedIn;
  if (signedIn) {
    $('cloud-signedin-email').textContent = cloudUser.email;
    var sw = $('cloud-switch-btn');
    if (sw) sw.textContent = crawlerMode === 'dm' ? 'Switch to Player view' : 'Switch to DM view';
  }
  renderCampaignLayout();
}
/* Campaign tab layout: only the step the user is on is shown. Signed
 * out, only Account. Signed in, crawlers + join + campaign list. With a
 * campaign selected, its detail/parties/DM tools move to the top of the
 * tab, above Account, so the player/DM never scrolls past setup to reach
 * the campaign they are actually in. */
function renderJoinButton() {
  var btn = $('cloud-join-btn'); if (!btn) return;
  var st = null;
  try { st = window.DCC.getState(); } catch (e) {}
  var name = (st && st.name) ? st.name : 'Unnamed Crawler';
  btn.textContent = 'Join campaign as ' + name;
  var hint = $('cloud-join-hint');
  if (hint) hint.textContent = cloudCharacterId ? '' : 'This sheet is not saved to the cloud yet - joining will save it first.';
}
function renderCampaignLayout() {
  var signedIn = !!cloudUser;
  var show = function (id, on) { var el = $(id); if (el) el.hidden = !on; };
  show('cloud-crawlers-section', signedIn);
  show('cloud-join-section', signedIn);
  show('cloud-campaigns-section', signedIn);
  var intro = $('cloud-intro-hint'); if (intro) intro.hidden = signedIn;
  var focus = $('cloud-focus-wrap');
  var list = $('cloud-campaigns-section');
  if (focus) {
    focus.hidden = !signedIn || !cloudCampaignId;
    if (signedIn && cloudCampaignId) {
      var panel = $('panel-campaign');
      var acct = $('cloud-account-section');
      if (panel && acct && focus.parentNode !== panel) panel.insertBefore(focus, acct);
    } else if (list && focus.parentNode !== list) {
      list.appendChild(focus);
    }
  }
  renderJoinButton();
}
function switchMode() {
  // Same switch the start screen offers, from the Campaign tab itself.
  if (!cloudUser) { cloudStatus('Log in first, in the Account section above.'); return; }
  chooseRole(crawlerMode === 'dm' ? 'player' : 'dm');
}

/* Party leader = highest combined BASE stat total. Base here is the
 * derived base (own + positive race/class fixed + splits), recomputed from
 * the member's stored state with the same rules the sheet itself uses. */
var racesCache = null;
function racesData() {
  if (racesCache) return Promise.resolve(racesCache);
  return fetch('data/races_classes.json').then(function (r) { return r.json(); }).then(function (list) {
    racesCache = list; return list;
  });
}
function baseStatTotalAsync(d) {
  if (!d) return Promise.resolve(0);
  if (typeof d.baseTotal === 'number') return Promise.resolve(d.baseTotal);
  var own = d.ownBase || {};
  var ownSum = ['str', 'con', 'dex', 'int', 'cha'].reduce(function (a, k) { return a + (parseInt(own[k], 10) || 0); }, 0);
  return racesData().then(function (list) {
    var R = window.DCCRules;
    var fixed = { str: 0, con: 0, dex: 0, int: 0, cha: 0 };
    [d.race, d.class].forEach(function (name, i) {
      if (!name) return;
      var kind = i === 0 ? 'race' : 'class';
      var entry = list.find(function (e) { return e.kind === kind && R.normName(e.name) === R.normName(name); });
      if (!entry) return;
      var s = R.parseRaceClassStats(entry);
      R.STAT_KEYS.forEach(function (k) { fixed[k] += s[k]; });
    });
    var splits = { str: 0, con: 0, dex: 0, int: 0, cha: 0 };
    Object.keys(d.raceClassChoices || {}).forEach(function (cid) {
      var parts = cid.split(':');
      if (parts.length < 3) return;
      var cur = parts[0] === 'race' ? d.race : d.class;
      if (parts[1] !== cur) return;
      var ch = d.raceClassChoices[cid];
      if (ch && ch.split) R.STAT_KEYS.forEach(function (k) { splits[k] += parseInt(ch.split[k], 10) || 0; });
    });
    return R.STAT_KEYS.reduce(function (a, k) { return a + Math.max(0, own[k] + Math.max(0, fixed[k]) + splits[k]); }, 0);
  }).catch(function () { return ownSum; });
}
/* Synchronous approximation used only where an async total is impractical
 * (it is replaced by baseStatTotalAsync wherever a leader is chosen). */
function baseStatTotal(d) {
  if (!d) return 0;
  if (typeof d.baseTotal === 'number') return d.baseTotal;
  var own = d.ownBase || {};
  return ['str', 'con', 'dex', 'int', 'cha'].reduce(function (a, k) { return a + (parseInt(own[k], 10) || 0); }, 0);
}

/* ---------------- DM campaign management, character inspector,
   dead crawlers (2026-11-03) ---------------- */
/* The DM is an admin account, not a player: DM views never load a
 * character, never list the DM's own characters as players (NPCs excepted),
 * and the DM's work happens in the Management and Inspector tabs plus
 * Send Box / Send Achievement. Character death is a flag on the
 * character row's data object (data.dead); the player's sheet stamps
 * itself DECEASED and locks while it is true. */
var manageCampaignId = localStorage.getItem('manage_campaign_id') || null;
function manageStatus(msg) { var el = $('manage-status'); if (el) el.innerText = msg || ''; }
function selectManageCampaign(id) {
  manageCampaignId = id;
  localStorage.setItem('manage_campaign_id', id);
  cloudCampaignId = id;
  localStorage.setItem('cloud_campaign_id', id);
  refreshManageTab();
}
async function refreshManageTab() {
  var box = $('manage-content'); if (!box) return;
  if (!cloudUser || crawlerMode !== 'dm') { box.innerHTML = '<p class="hint">Log in as DM first.</p>'; return; }
  var res = await sb.from('campaigns').select('id, name, code').eq('dm_id', cloudUser.id).order('created_at');
  if (res.error) { box.innerHTML = '<p class="hint">Could not list campaigns: ' + esc(res.error.message) + '</p>'; return; }
  var list = res.data || [];
  var html = '<div class="cloud-subhead">Create a campaign</div>'
    + '<div><label>New campaign name <input type="text" id="manage-new-campaign" placeholder="e.g. Floor 1 - The Beginning"></label></div>'
    + '<div class="btn-row"><button type="button" onclick="createCampaign(\'manage-new-campaign\')">Create campaign</button></div>';
  if (!list.length) { box.innerHTML = html + '<p class="hint">No campaigns yet. Create one above.</p>'; return; }
  if (!manageCampaignId || !list.some(function (c) { return c.id === manageCampaignId; })) {
    manageCampaignId = list[0].id;
    localStorage.setItem('manage_campaign_id', manageCampaignId);
  }
  cloudCampaignId = manageCampaignId;
  localStorage.setItem('cloud_campaign_id', manageCampaignId);
  var camp = list.find(function (c) { return c.id === manageCampaignId; });
  html += '<div class="cloud-subhead">Your campaigns</div>' + list.map(function (c) {
    return '<button type="button" onclick="selectManageCampaign(\'' + c.id + '\')">' + esc(c.name) + (c.id === manageCampaignId ? ' (selected)' : '') + '</button> ';
  }).join('');
  html += '<div class="cloud-subhead">' + esc(camp.name) + ' - Code ' + esc(camp.code) + ' <button type="button" onclick="deleteCampaign(\'' + camp.id + '\')">Delete campaign</button></div>';
  var mem = await fetchCampaignMembers(camp.id);
  var members = mem.members || [];
  html += '<div class="cloud-subhead">Players in this campaign</div><p class="hint">Tick members to make a party, then Confirm party below. Inspect opens the full character.</p>' + (members.length ? members.map(function (m) {
    var d = m.data || {};
    return '<div class="cloud-row"><span><input type="checkbox" class="party-check" value="' + m.id + '"> ' + esc(m.name) + (d.npc ? ' (NPC)' : '') + (d.dead ? ' - DECEASED' : '') + ' - Level ' + esc(m.level) + ' - HP ' + hpSlotsText(d) + ' - Mana ' + (d.manaCurrent === null || d.manaCurrent === undefined ? '?' : d.manaCurrent) + '</span><span><button type="button" onclick="inspectCharacter(\'' + m.id + '\')">Inspect</button></span></div>';
  }).join('') : '<p class="hint">No players in this campaign yet. Share the code with your players.</p>');
  html += '<div class="cloud-subhead">Create a non-player character</div><p class="hint">NPCs belong to this campaign and can be inspected, edited, and marked deceased like players, but they are never a loaded player sheet.</p>'
    + '<div><label>NPC name <input type="text" id="npc-name" placeholder="e.g. Barkeep Bruna"></label></div>'
    + '<div><label>Level <input type="number" id="npc-level" min="1" value="1"></label></div>'
    + '<div class="btn-row"><button type="button" onclick="createNpc()">Create NPC</button></div>';
  var partiesRes = await sb.from('parties').select('id, name, leader_character_id').eq('campaign_id', camp.id).order('created_at');
  var parties = partiesRes.data || [];
  html += '<div class="cloud-subhead">Parties</div>';
  if (!parties.length) html += '<p class="hint">No parties yet. Tick members above, then confirm.</p>';
  else {
    html += parties.map(function (pp) {
      var leader = members.find(function (m) { return m.id === pp.leader_character_id; });
      return '<div class="cloud-row"><span>' + esc(pp.name) + (leader ? ' - Leader: ' + esc(leader.name) + ' 👑' : ' - No leader yet') + '</span><span><button type="button" onclick="recalcLeader(\'' + pp.id + '\')">Recalculate leader</button> <button type="button" onclick="deleteParty(\'' + pp.id + '\')">Delete</button></span></div>';
    }).join('');
  }
  html += '<div class="btn-row"><button type="button" onclick="createParty()">Confirm party</button></div>';
  box.innerHTML = html;
}
async function createNpc() {
  if (!needLogin() || crawlerMode !== 'dm') return manageStatus('DM only.');
  var name = $('npc-name') ? $('npc-name').value.trim() : '';
  var level = $('npc-level') ? (parseInt($('npc-level').value, 10) || 1) : 1;
  if (!manageCampaignId) return manageStatus('Select a campaign first.');
  if (!name) return manageStatus('Give the NPC a name first.');
  var d = window.DCC.blankState();
  d.name = name; d.level = level; d.npc = true;
  var res = await sb.from('characters').insert({ owner_id: cloudUser.id, name: name, level: level, data: d, campaign_id: manageCampaignId }).select('id').single();
  if (res.error) return manageStatus('NPC creation failed: ' + res.error.message);
  var cc = await sb.from('campaign_characters').insert({ campaign_id: manageCampaignId, character_id: res.data.id });
  if (cc.error) return manageStatus('NPC created, but adding it to the campaign failed: ' + cc.error.message);
  if ($('npc-name')) $('npc-name').value = '';
  manageStatus('NPC created: ' + name);
  refreshManageTab();
}

/* Character Inspector tab (DM only). Shows one character completely and
 * edits everything except name and number, which the DM may never alter.
 * Every edit writes the whole data object back to that character's row,
 * so the player's own sheet picks it up live through realtime. */
var dmInspectId = null;
function inspectStatus(msg) { var el = $('inspect-status'); if (el) el.innerText = msg || ''; }
function inspectCharacter(id) { dmInspectId = id; window.DCC.showTab('inspect'); }
function inspInt(id, def) { var el = $(id); if (!el) return def; var v = parseInt(el.value, 10); return isNaN(v) ? def : v; }
async function dmUpdateCharacter(id, mutate, msg) {
  if (!needLogin() || crawlerMode !== 'dm') return inspectStatus('DM only.');
  var row = await sb.from('characters').select('id, name, level, data').eq('id', id).single();
  if (row.error) return inspectStatus('Could not load that character: ' + row.error.message);
  var d = row.data.data || {};
  mutate(d);
  var res = await sb.from('characters').update({ data: d, level: parseInt(d.level, 10) || 1, updated_at: new Date().toISOString() }).eq('id', id);
  if (res.error) return inspectStatus('Update failed: ' + res.error.message);
  if (msg) inspectStatus(msg);
  renderInspector();
  refreshDmDashboard();
  refreshManageTab();
}
function dmBonusText(b) {
  if (!b) return '';
  if (typeof b === 'string') return b;
  var parts = [];
  if (b.type) parts.push(b.type);
  if (b.stat) parts.push(String(b.stat).toUpperCase());
  if (b.skill) parts.push(b.skill);
  if (b.amount !== undefined && b.amount !== '' && b.amount !== 0) parts.push('+' + b.amount);
  return parts.join(' ') || JSON.stringify(b);
}
function dmInspSaveVitals() {
  if (!dmInspectId) return;
  dmUpdateCharacter(dmInspectId, function (d) {
    d.hpCurrent = Math.max(0, Math.min(10, inspInt('insp-hp', d.hpCurrent || 0)));
    d.manaCurrent = Math.max(0, inspInt('insp-mana', d.manaCurrent || 0));
    d.gold = inspInt('insp-gold', d.gold || 0);
    d.popularity = inspInt('insp-pop', d.popularity || 0);
    d.aiFavor = inspInt('insp-aifavor', d.aiFavor || 0);
    d.moveVal = inspInt('insp-move', d.moveVal || 20);
    d.stepVal = inspInt('insp-step', d.stepVal || 10);
    d.bossKills = Math.max(0, inspInt('insp-boss', d.bossKills || 0));
    d.pkKills = Math.max(0, inspInt('insp-pk', d.pkKills || 0));
    d.level = Math.max(1, inspInt('insp-level', d.level || 1));
    d.floor = Math.max(1, inspInt('insp-floor', d.floor || 1));
  }, 'Vitals saved.');
}
function dmInspSaveStats() {
  if (!dmInspectId) return;
  dmUpdateCharacter(dmInspectId, function (d) {
    ['str', 'con', 'dex', 'int', 'cha'].forEach(function (k) {
      d.ownBase = d.ownBase || {};
      d.ownEnh = d.ownEnh || {};
      d.ownBase[k] = inspInt('insp-base-' + k, d.ownBase[k] || 1);
      d.ownEnh[k] = inspInt('insp-enh-' + k, d.ownEnh[k] || 0);
    });
    d.ownArmor = inspInt('insp-armor', d.ownArmor || 0);
  }, 'Stats saved.');
}
function dmInspAddCond(kind) {
  if (!dmInspectId) return;
  var inputId = kind === 'buff' ? 'insp-buff-new' : 'insp-debuff-new';
  var el = $(inputId); var name = el ? el.value.trim() : '';
  if (!name) return inspectStatus('Type a buff or debuff name first.');
  dmUpdateCharacter(dmInspectId, function (d) {
    var key = kind === 'buff' ? 'buffs' : 'debuffs';
    if (!Array.isArray(d[key])) d[key] = [];
    d[key].push(name);
  }, 'Added ' + kind + ': ' + name);
}
function dmInspDelCond(kind, idx) {
  if (!dmInspectId) return;
  dmUpdateCharacter(dmInspectId, function (d) {
    var key = kind === 'buff' ? 'buffs' : 'debuffs';
    if (Array.isArray(d[key])) d[key].splice(idx, 1);
  }, 'Removed.');
}
function dmInspSetRank(list, idx, val) {
  if (!dmInspectId) return;
  var rank = Math.max(0, parseInt(val, 10) || 0);
  dmUpdateCharacter(dmInspectId, function (d) {
    if (Array.isArray(d[list]) && d[list][idx]) d[list][idx].ownRank = rank;
  }, 'Rank saved.');
}
function dmInspDelCard(list, idx) {
  if (!dmInspectId) return;
  dmUpdateCharacter(dmInspectId, function (d) {
    if (Array.isArray(d[list])) d[list].splice(idx, 1);
  }, 'Removed.');
}
function dmInspAddCard(list) {
  if (!dmInspectId) return;
  var pfx = list === 'skills' ? 'skill' : 'spell';
  var nameEl = $('insp-add-' + pfx + '-name');
  var statEl = $('insp-add-' + pfx + '-stat');
  var rankEl = $('insp-add-' + pfx + '-rank');
  var name = nameEl ? nameEl.value.trim() : '';
  if (!name) return inspectStatus('Give the ' + pfx + ' a name first.');
  var card = { id: 'dm-' + Date.now() + '-' + Math.floor(Math.random() * 1000000000), name: name, kind: list === 'skills' ? 'skill' : 'spell', ownRank: Math.max(0, parseInt(rankEl ? rankEl.value : '1', 10) || 0), stat: statEl ? statEl.value : (list === 'skills' ? 'str' : 'int'), checkType: 'Active Check', effect: '', used: false, gearGrants: {} };
  dmUpdateCharacter(dmInspectId, function (d) {
    if (!Array.isArray(d[list])) d[list] = [];
    d[list].push(card);
  }, 'Added ' + name + '.');
}
function dmInspDelAttack(idx) {
  if (!dmInspectId) return;
  dmUpdateCharacter(dmInspectId, function (d) {
    if (Array.isArray(d.attacks)) d.attacks.splice(idx, 1);
  }, 'Attack removed.');
}
function dmInspAddAttack() {
  if (!dmInspectId) return;
  var name = $('insp-atk-name') ? $('insp-atk-name').value.trim() : '';
  if (!name) return inspectStatus('Give the attack a name first.');
  var atk = { id: 'dm-' + Date.now() + '-' + Math.floor(Math.random() * 1000000000), name: name, toHitStat: $('insp-atk-stat') ? $('insp-atk-stat').value : 'str', damage: $('insp-atk-damage') ? $('insp-atk-damage').value : '', notes: $('insp-atk-notes') ? $('insp-atk-notes').value : '' };
  dmUpdateCharacter(dmInspectId, function (d) {
    if (!Array.isArray(d.attacks)) d.attacks = [];
    d.attacks.push(atk);
  }, 'Attack added.');
}
function dmInspToggleEquip(idx) {
  if (!dmInspectId) return;
  dmUpdateCharacter(dmInspectId, function (d) {
    if (Array.isArray(d.items) && d.items[idx]) d.items[idx].equipped = !d.items[idx].equipped;
  }, 'Equipment changed.');
}
function dmInspDelItem(idx) {
  if (!dmInspectId) return;
  dmUpdateCharacter(dmInspectId, function (d) {
    if (Array.isArray(d.items)) d.items.splice(idx, 1);
  }, 'Item removed.');
}
function dmInspAddItem() {
  if (!dmInspectId) return;
  var name = $('insp-item-name') ? $('insp-item-name').value.trim() : '';
  if (!name) return inspectStatus('Give the item a name first.');
  dmUpdateCharacter(dmInspectId, function (d) {
    if (!Array.isArray(d.items)) d.items = [];
    d.items.push({ name: name, bonuses: [], equipped: false });
  }, 'Item added (unequipped, no bonuses).');
}
async function successionForCharacter(charId) {
  // When a party leader dies, leadership passes to the next LIVING member
  // with the highest combined base stat total (the same rule party
  // creation uses). Runs on the DM client, which can read full rows.
  var pm = await sb.from('party_members').select('party_id').eq('character_id', charId);
  if (pm.error) return;
  for (var i = 0; i < (pm.data || []).length; i++) {
    var pid = pm.data[i].party_id;
    var party = await sb.from('parties').select('id, leader_character_id').eq('id', pid).single();
    if (party.error || !party.data || party.data.leader_character_id !== charId) continue;
    var mem = await sb.from('party_members').select('character_id').eq('party_id', pid);
    var ids = (mem.data || []).map(function (r) { return r.character_id; }).filter(function (id) { return id !== charId; });
    if (!ids.length) { await sb.from('parties').update({ leader_character_id: null }).eq('id', pid); continue; }
    var rows = await sb.from('characters').select('id, data').in('id', ids);
    var living = (rows.data || []).filter(function (r) { return !(r.data && r.data.dead); });
    if (!living.length) { await sb.from('parties').update({ leader_character_id: null }).eq('id', pid); continue; }
    var totals = await Promise.all(living.map(function (r) { return baseStatTotalAsync(r.data); }));
    var best = -1, bestId = living[0].id;
    living.forEach(function (r, j) { if (totals[j] > best) { best = totals[j]; bestId = r.id; } });
    await sb.from('parties').update({ leader_character_id: bestId }).eq('id', pid);
  }
}
async function dmInspToggleDead() {
  if (!dmInspectId) return;
  var row = await sb.from('characters').select('id, data').eq('id', dmInspectId).single();
  if (row.error) return inspectStatus('Could not load that character: ' + row.error.message);
  var d = row.data.data || {};
  var nowDead = !d.dead;
  d.dead = nowDead;
  var res = await sb.from('characters').update({ data: d, updated_at: new Date().toISOString() }).eq('id', dmInspectId);
  if (res.error) return inspectStatus('Update failed: ' + res.error.message);
  inspectStatus(nowDead ? 'Marked as deceased. The player now sees the DECEASED stamp and cannot change this character.' : 'Revived. The player can change this character again.');
  if (nowDead) await successionForCharacter(dmInspectId);
  renderInspector();
  refreshDmDashboard();
  refreshManageTab();
}
async function renderInspector() {
  var box = $('inspect-content'); if (!box) return;
  if (!cloudUser || crawlerMode !== 'dm') { box.innerHTML = '<p class="hint">Log in as DM first.</p>'; return; }
  if (!dmInspectId) { box.innerHTML = '<p class="hint">Pick a player from the DM Dashboard or Campaign Management tab, then Inspect.</p>'; return; }
  var row = await sb.from('characters').select('id, name, level, data, owner_id').eq('id', dmInspectId).single();
  if (row.error) { box.innerHTML = '<p class="hint">Could not load that character: ' + esc(row.error.message) + '</p>'; return; }
  var d = row.data.data || {};
  var base = d.ownBase || { str: 1, con: 1, dex: 1, int: 1, cha: 1 };
  var enh = d.ownEnh || { str: 0, con: 0, dex: 0, int: 0, cha: 0 };
  var num = function (id, val, min) { return '<input type="number" id="' + id + '" value="' + val + '"' + (min !== undefined ? ' min="' + min + '"' : '') + ' style="width:72px">'; };
  var statOpts = ['str', 'con', 'dex', 'int', 'cha'].map(function (k) { return '<option value="' + k + '">' + k.toUpperCase() + '</option>'; }).join('');
  var html = '<p><strong>' + esc(d.name || row.data.name || 'Unnamed Crawler') + '</strong>'
    + (d.npc ? ' (NPC)' : '') + (d.dead ? ' - <strong>DECEASED</strong>' : '')
    + ' - ' + esc(d.race || 'no race') + ' / ' + esc(d.class || 'no class')
    + ' - Level ' + esc(d.level || 1) + ' - Floor ' + esc(d.floor || 1) + '</p>';
  if (d.avatarUrl) html += '<p><img src="' + esc(d.avatarUrl) + '" alt="Crawler avatar" style="width:96px;height:96px;object-fit:cover;border-radius:8px"></p>';
  html += '<p class="hint">Name and number cannot be changed by the DM. Everything else below can. Changes save to the cloud at once and the player sees them live.</p>';
  html += '<div class="cloud-subhead">Status</div><div class="btn-row"><button type="button" onclick="dmInspToggleDead()">' + (d.dead ? 'Revive crawler' : 'Mark as deceased') + '</button></div>';
  html += '<div class="cloud-subhead">Vitals</div>'
    + '<div><label>Health slots (0-10) ' + num('insp-hp', d.hpCurrent === undefined ? 10 : d.hpCurrent, 0) + '</label> '
    + '<label>Mana ' + num('insp-mana', d.manaCurrent === undefined ? 0 : d.manaCurrent, 0) + '</label> '
    + '<label>Gold ' + num('insp-gold', d.gold || 0) + '</label></div>'
    + '<div><label>Popularity ' + num('insp-pop', d.popularity || 0) + '</label> '
    + '<label>AI Favor ' + num('insp-aifavor', d.aiFavor || 0) + '</label> '
    + '<label>Move ' + num('insp-move', d.moveVal === undefined ? 20 : d.moveVal) + '</label> '
    + '<label>Step ' + num('insp-step', d.stepVal === undefined ? 10 : d.stepVal) + '</label></div>'
    + '<div><label>Boss kills ' + num('insp-boss', d.bossKills || 0, 0) + '</label> '
    + '<label>Player kills ' + num('insp-pk', d.pkKills || 0, 0) + '</label> '
    + '<label>Level ' + num('insp-level', d.level || 1, 1) + '</label> '
    + '<label>Floor ' + num('insp-floor', d.floor || 1, 1) + '</label></div>'
    + '<div class="btn-row"><button type="button" onclick="dmInspSaveVitals()">Save vitals</button></div>';
  html += '<div class="cloud-subhead">Stats (base / enhance / armor)</div>';
  ['str', 'con', 'dex', 'int', 'cha'].forEach(function (k) {
    html += '<div><label>' + k.toUpperCase() + ' base ' + num('insp-base-' + k, base[k] === undefined ? 1 : base[k]) + '</label> '
      + '<label>enhance ' + num('insp-enh-' + k, enh[k] || 0) + '</label></div>';
  });
  html += '<div><label>Own armor ' + num('insp-armor', d.ownArmor || 0) + '</label></div>'
    + '<div class="btn-row"><button type="button" onclick="dmInspSaveStats()">Save stats</button></div>';
  var condList = function (kind, arr) {
    return (arr || []).map(function (c, i) {
      return '<div class="cloud-row"><span>' + esc(typeof c === 'string' ? c : (c.name || JSON.stringify(c))) + '</span><span><button type="button" onclick="dmInspDelCond(\'' + kind + '\', ' + i + ')">Remove</button></span></div>';
    }).join('') || '<p class="hint">None.</p>';
  };
  html += '<div class="cloud-subhead">Buffs</div>' + condList('buff', d.buffs)
    + '<div><label>Add buff <input type="text" id="insp-buff-new" placeholder="e.g. Blessed"></label> <button type="button" onclick="dmInspAddCond(\'buff\')">Add buff</button></div>';
  html += '<div class="cloud-subhead">Debuffs</div>' + condList('debuff', d.debuffs)
    + '<div><label>Add debuff <input type="text" id="insp-debuff-new" placeholder="e.g. Poisoned"></label> <button type="button" onclick="dmInspAddCond(\'debuff\')">Add debuff</button></div>';
  var cardRows = function (list, arr) {
    return (arr || []).map(function (c, i) {
      return '<div class="cloud-row"><span>' + esc(c.name) + ' - ' + esc((c.stat || '').toUpperCase()) + ' - Trained rank <input type="number" min="0" value="' + (parseInt(c.ownRank, 10) || 0) + '" onchange="dmInspSetRank(\'' + list + '\', ' + i + ', this.value)" style="width:64px"></span><span><button type="button" onclick="dmInspDelCard(\'' + list + '\', ' + i + ')">Remove</button></span></div>';
    }).join('') || '<p class="hint">None.</p>';
  };
  var addCard = function (list, pfx) {
    return '<div><label>Name <input type="text" id="insp-add-' + pfx + '-name"></label> <label>Stat <select id="insp-add-' + pfx + '-stat">' + statOpts + '</select></label> <label>Rank <input type="number" id="insp-add-' + pfx + '-rank" min="0" value="1" style="width:64px"></label> <button type="button" onclick="dmInspAddCard(\'' + list + '\')">Add</button></div>';
  };
  html += '<div class="cloud-subhead">Skills</div>' + cardRows('skills', d.skills) + addCard('skills', 'skill');
  html += '<div class="cloud-subhead">Spells</div>' + cardRows('spells', d.spells) + addCard('spells', 'spell');
  html += '<div class="cloud-subhead">Attacks (stored ones; derived attacks come from skills)</div>' + ((d.attacks || []).map(function (a, i) {
    return '<div class="cloud-row"><span>' + esc(a.name) + ' - to-hit ' + esc((a.toHitStat || '').toUpperCase()) + ' - ' + esc(a.damage || '') + (a.notes ? ' - ' + esc(a.notes) : '') + '</span><span><button type="button" onclick="dmInspDelAttack(' + i + ')">Remove</button></span></div>';
  }).join('') || '<p class="hint">None stored.</p>')
    + '<div><label>Name <input type="text" id="insp-atk-name"></label> <label>To-hit stat <select id="insp-atk-stat">' + statOpts + '</select></label> <label>Damage <input type="text" id="insp-atk-damage" placeholder="e.g. 1d6 + Str"></label> <label>Notes <input type="text" id="insp-atk-notes"></label> <button type="button" onclick="dmInspAddAttack()">Add attack</button></div>';
  html += '<div class="cloud-subhead">Inventory</div>' + ((d.items || []).map(function (it, i) {
    var bonuses = (it.bonuses || []).map(dmBonusText).filter(Boolean).join(', ');
    return '<div class="cloud-row"><span>' + esc(it.name) + (it.equipped ? ' - EQUIPPED' : '') + (bonuses ? ' - ' + esc(bonuses) : '') + '</span><span><button type="button" onclick="dmInspToggleEquip(' + i + ')">' + (it.equipped ? 'Unequip' : 'Equip') + '</button> <button type="button" onclick="dmInspDelItem(' + i + ')">Remove</button></span></div>';
  }).join('') || '<p class="hint">Inventory is empty.</p>')
    + '<div><label>Item name <input type="text" id="insp-item-name"></label> <button type="button" onclick="dmInspAddItem()">Add item (unequipped, no bonuses)</button></div>';
  var st = d.story || {};
  var bg = d.backgrounds || {};
  var bgText = Object.keys(bg).map(function (cat) {
    var b = bg[cat] || {};
    return cat + ': ' + (b.bg || b.name || '') + ((b.skills || []).length ? ' (' + b.skills.join(', ') + ')' : '');
  }).filter(function (t) { return t.indexOf(': ') > 0; }).join(' · ');
  html += '<div class="cloud-subhead">Story (read-only here)</div>'
    + '<p>Quests: ' + (st.quests || []).map(function (q) { return esc(q.name || 'Quest') + ' (' + esc(q.status || '') + ')'; }).join(', ') + '</p>'
    + '<p>Journal entries: ' + (st.journal || []).length + ' · Pets: ' + (st.pets || []).map(function (pt) { return esc(pt.name || 'Pet'); }).join(', ') + ' · Mounts: ' + (st.mounts || []).map(function (mt) { return esc(mt.name || 'Mount'); }).join(', ') + '</p>'
    + '<p>Sponsors: ' + (st.sponsors || []).map(function (sp) { return esc(sp.name || 'Sponsor'); }).join(', ') + ' · Faith: ' + esc((st.faith && st.faith.deity) || '') + ' ' + esc((st.faith && st.faith.tier) || '') + '</p>'
    + (bgText ? '<p>Backgrounds: ' + esc(bgText) + '</p>' : '')
    + '<p>Bio: ' + esc(((st.bio || {}).appearance || '') + ' ' + ((st.bio || {}).personality || '') + ' ' + ((st.bio || {}).backstory || '') + ' ' + ((st.bio || {}).notes || '')) + '</p>';
  box.innerHTML = html;
}

/* Dead Party member tab (players only). Living members of a party with a
 * dead member see the dead crawler's inventory here and can take items;
 * taking removes the item from the dead crawler (even if equipped) and
 * adds it to the taker unequipped. The party leader can also remove a
 * dead crawler from the party. Reads and writes go through the
 * supabase_dead_crawler.sql functions, because party mates have no
 * direct RLS policy on each other's character rows. */
function deadStatus(msg) { var el = $('deadparty-status'); if (el) el.innerText = msg || ''; }
async function refreshDeadPartyTab() {
  var btn = $('deadparty-tab-btn');
  var box = $('deadparty-content');
  if (!box) return;
  if (!cloudUser || crawlerMode !== 'player' || !cloudCharacterId) { if (btn) btn.hidden = true; return; }
  var res = await sb.rpc('dead_party_loot', { p_character_id: cloudCharacterId });
  if (res.error) {
    if (btn) btn.hidden = true;
    box.innerHTML = '<p class="hint">Could not load dead party members: ' + esc(res.error.message) + ' (if this is a new site version, run supabase_dead_crawler.sql in Supabase first.)</p>';
    return;
  }
  var rows = res.data || [];
  if (btn) btn.hidden = rows.length === 0;
  if (!rows.length) {
    box.innerHTML = '<p class="hint">No dead crawlers in your parties.</p>';
    var panel = $('panel-deadparty');
    if (panel && panel.classList.contains('active')) window.DCC.showTab('vitals');
    return;
  }
  box.innerHTML = rows.map(function (r) {
    var items = r.items || [];
    var itemsHtml = items.length ? items.map(function (it, i) {
      return '<div class="cloud-row"><span>' + esc(it.name || 'Item') + '</span><span><button type="button" onclick="takeDeadItem(\'' + r.dead_id + '\', ' + i + ')">Take</button></span></div>';
    }).join('') : '<p class="hint">Nothing left in this inventory.</p>';
    return '<div class="cloud-subhead">Dead: ' + esc(r.dead_name) + ' (party: ' + esc(r.party_name) + ')</div>'
      + itemsHtml
      + (r.caller_is_leader ? '<div class="btn-row"><button type="button" onclick="removeDeadFromParty(\'' + r.party_id + '\', \'' + r.dead_id + '\')">Remove dead crawler from party</button></div>' : '');
  }).join('');
}
async function takeDeadItem(deadId, idx) {
  if (!needLogin()) return;
  var res = await sb.rpc('take_dead_item', { p_dead_id: deadId, p_item_index: idx, p_taker_id: cloudCharacterId });
  if (res.error) return deadStatus('Take failed: ' + res.error.message);
  deadStatus('Took ' + (res.data || 'item') + ' from the dead crawler. It is now in your inventory, unequipped.');
  var row = await sb.from('characters').select('data').eq('id', cloudCharacterId).single();
  if (!row.error && row.data) {
    // Refresh the taker's own sheet without leaving this tab
    // (applyCloudState would jump back to the saved active tab).
    try {
      var st = Object.assign(window.DCC.blankState(), row.data.data || {});
      window.DCC.setState(st);
      window.DCC.ensureUnarmed();
      window.DCC.syncGearGrants();
      window.DCC.saveNow();
      window.DCC.renderAll();
    } catch (e) {}
  }
  refreshDeadPartyTab();
}
async function removeDeadFromParty(partyId, deadId) {
  if (!needLogin()) return;
  if (!confirm('Remove this dead crawler from the party?')) return;
  var res = await sb.rpc('remove_dead_from_party', { p_party_id: partyId, p_dead_id: deadId, p_leader_id: cloudCharacterId });
  if (res.error) return deadStatus('Remove failed: ' + res.error.message);
  deadStatus('Dead crawler removed from the party.');
  refreshDeadPartyTab();
}

/* ---------------- background slider (original, verbatim behaviour) ---------------- */
var bgImages = ['DCC_GN_Cover.jpg', 'DCC_Cover.jpg', 'DCC_Cover_0.jpg'];
function setupBackgroundSlider() {
  var track = $('bgTrack');
  if (!track) return;
  var fullSet = bgImages.concat(bgImages); // duplicated so the loop repeats seamlessly
  track.innerHTML = fullSet.map(function (src) { return '<img src="' + src + '" alt="Background Cover">'; }).join('');
}

/* ---------------- auth + start screen (original simplified sets) ---------------- */
function initCloud() {
  if (!window.supabase || !window.supabase.createClient) {
    cloudStatus('Supabase library failed to load. Check your connection and reload the page.');
    if (!crawlerMode) showLanding();
    return;
  }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  sb.auth.getSession().then(function (res) {
    cloudUser = res.data && res.data.session ? res.data.session.user : null;
    cloudStatus(cloudUser ? ('Signed in as ' + cloudUser.email) : 'Not signed in. The sheet still works offline without an account.');
    renderAccountSection();
    if (cloudUser) {
      refreshCloudAll(); startRealtime();
      applyModeClass();
      if (crawlerMode === 'dm') window.DCC.showTab('dm');
    } else if (!crawlerMode) {
      showLanding();
    }
  });
  sb.auth.onAuthStateChange(function (_event, session) {
    cloudUser = session ? session.user : null;
    cloudStatus(cloudUser ? ('Signed in as ' + cloudUser.email) : 'Signed out.');
    renderAccountSection();
    if (cloudUser) { refreshCloudAll(); startRealtime(); }
  });
}
function hideLanding() { var el = $('landing-screen'); if (el) el.style.display = 'none'; }
function renderSignedInButtons() {
  var box = $('landing-signedin-btns');
  if (!box) return;
  var signOut = '<button type="button" onclick="landingSignOut()">Sign out</button>';
  if (crawlerMode === 'player') {
    box.innerHTML = '<button type="button" onclick="chooseRole(\'dm\')">Switch to DM</button> ' + signOut;
  } else if (crawlerMode === 'dm') {
    box.innerHTML = '<button type="button" onclick="chooseRole(\'player\')">Switch to Player</button> ' + signOut;
  } else {
    box.innerHTML = '<button type="button" onclick="chooseRole(\'player\')">Continue as Player</button> <button type="button" onclick="chooseRole(\'dm\')">Continue as DM</button> ' + signOut;
  }
}
function showLanding() {
  var el = $('landing-screen');
  if (!el) return;
  el.style.display = 'flex';
  var gw = $('gateway'); if (gw) gw.hidden = true;
  $('landing-auth').style.display = 'none';
  if (cloudUser) {
    $('landing-choices').style.display = 'none';
    $('landing-signedin-text').innerText = 'Signed in as ' + cloudUser.email;
    renderSignedInButtons();
    $('landing-signedin').style.display = 'block';
  } else {
    $('landing-choices').style.display = 'block';
    $('landing-signedin').style.display = 'none';
  }
  $('landing-close-wrap').style.display = crawlerMode ? 'block' : 'none';
}
function chooseGuest() {
  setMode('guest');
  hideLanding();
  // Fresh guest sheet: the gateway (with guided creation) is the entry
  // point, exactly as the sheet already behaves with no saved sheet.
  if (!localStorage.getItem('dcc-sheet-v2')) { var gw = $('gateway'); if (gw) gw.hidden = false; }
}
function chooseSignUp() {
  signupWithoutRole = true;
  pendingRole = null;
  $('landing-choices').style.display = 'none';
  $('landing-signedin').style.display = 'none';
  $('landing-auth').style.display = 'block';
  landingStatus('Create an account, then pick Player or DM.');
}
function chooseRole(role) {
  signupWithoutRole = false;
  pendingRole = role;
  if (cloudUser) { afterRoleLogin(role); return; }
  $('landing-choices').style.display = 'none';
  $('landing-signedin').style.display = 'none';
  $('landing-auth').style.display = 'block';
  landingStatus('Log in as ' + (role === 'dm' ? 'DM' : 'player') + ', or sign up if you do not have an account yet.');
}
function landingBack() { signupWithoutRole = false; showLanding(); }
async function landingSignUp() {
  if (!sb) return landingStatus('Supabase library failed to load. Reload the page and try again.');
  var email = $('landing-email').value.trim();
  var password = $('landing-password').value;
  if (!email || !password) return landingStatus('Enter an email and a password first.');
  var res = await sb.auth.signUp({ email: email, password: password });
  if (res.error) return landingStatus('Sign up failed: ' + res.error.message);
  if (!res.data.session) return landingStatus('Account created. Check your email to confirm it, then log in.');
  cloudUser = res.data.session.user;
  if (signupWithoutRole) { signupWithoutRole = false; showLanding(); return; }
  afterRoleLogin(pendingRole || 'player');
}
async function landingLogIn() {
  if (!sb) return landingStatus('Supabase library failed to load. Reload the page and try again.');
  var email = $('landing-email').value.trim();
  var password = $('landing-password').value;
  if (!email || !password) return landingStatus('Enter an email and a password first.');
  var res = await sb.auth.signInWithPassword({ email: email, password: password });
  if (res.error) return landingStatus('Log in failed: ' + res.error.message);
  cloudUser = res.data.session.user;
  if (signupWithoutRole) { signupWithoutRole = false; showLanding(); return; }
  afterRoleLogin(pendingRole || 'player');
}
async function landingSignOut() {
  if (sb) await sb.auth.signOut();
  cloudUser = null;
  localStorage.removeItem('crawler_mode');
  crawlerMode = null;
  applyModeClass();
  showLanding();
}
async function afterRoleLogin(role) {
  setMode(role);
  hideLanding();
  startRealtime();
  if (role === 'dm') {
    // A DM is an admin account, not a player: no character is loaded in.
    // (Switching back to Player re-loads that account's characters.)
    cloudCharacterId = null;
    localStorage.removeItem('crawler_cloud_id');
    refreshCloudAll(); window.DCC.showTab('dm'); return;
  }
  await playerAutoLoad();
}
async function cloudSignUp() {
  if (!sb) return cloudStatus('Supabase library failed to load. Reload the page and try again.');
  var email = $('cloud-email').value.trim();
  var password = $('cloud-password').value;
  if (!email || !password) return cloudStatus('Enter an email and a password first.');
  var res = await sb.auth.signUp({ email: email, password: password });
  if (res.error) return cloudStatus('Sign up failed: ' + res.error.message);
  cloudStatus(res.data.session ? ('Signed in as ' + email) : 'Account created. Check your email to confirm it, then log in.');
}
async function cloudLogIn() {
  if (!sb) return cloudStatus('Supabase library failed to load. Reload the page and try again.');
  var email = $('cloud-email').value.trim();
  var password = $('cloud-password').value;
  if (!email || !password) return cloudStatus('Enter an email and a password first.');
  var res = await sb.auth.signInWithPassword({ email: email, password: password });
  if (res.error) return cloudStatus('Log in failed: ' + res.error.message);
  cloudStatus('Signed in as ' + email);
}
async function cloudLogOut() {
  if (sb) await sb.auth.signOut();
  cloudUser = null;
  renderAccountSection();
  ['cloud-crawlers', 'cloud-campaigns', 'cloud-campaign-detail', 'cloud-parties', 'cloud-dm-tools'].forEach(function (id) {
    var el = $(id); if (el) el.innerHTML = '';
  });
  cloudStatus('Signed out.');
}

/* ---------------- cloud save / load / delete ---------------- */
/* Apply a downloaded merged state to the sheet without a page reload
 * (the original reloaded the page; the merged sheet can swap state live). */
function applyCloudState(data) {
  var st = Object.assign(window.DCC.blankState(), data || {});
  window.DCC.setState(st);
  window.DCC.ensureUnarmed();
  window.DCC.syncGearGrants();
  window.DCC.saveNow();
  window.DCC.showTab((data && data.activeTab) || 'vitals');
  window.DCC.renderAll();
}
async function cloudSave() {
  if (!needLogin()) return null;
  var data = getSheetCopy();
  if (!data) return cloudStatus('Nothing to save yet. Fill in your crawler first.', 'crawlers');
  if (data.dead) return cloudStatus('This crawler is deceased and cannot be changed.', 'crawlers');
  var name = data.name || 'Unnamed Crawler';
  var level = parseInt(data.level, 10) || 1;
  var res;
  if (cloudCharacterId) {
    res = await sb.from('characters').update({ name: name, level: level, data: data, updated_at: new Date().toISOString() }).eq('id', cloudCharacterId).select('id').single();
  } else {
    res = await sb.from('characters').insert({ owner_id: cloudUser.id, name: name, level: level, data: data }).select('id').single();
  }
  if (res.error) return cloudStatus('Cloud save failed: ' + res.error.message, 'crawlers');
  cloudCharacterId = res.data.id;
  localStorage.setItem('crawler_cloud_id', cloudCharacterId);
  cloudStatus('Saved to cloud: ' + name, 'crawlers');
  refreshCloudAll();
  return cloudCharacterId;
}
async function cloudSaveAsNew() {
  cloudCharacterId = null;
  localStorage.removeItem('crawler_cloud_id');
  return cloudSave();
}
async function cloudLoad(id) {
  if (!needLogin()) return;
  if (!confirm('Loading will replace the sheet on this device with the cloud version. Continue?')) return;
  var res = await sb.from('characters').select('id, campaign_id, data').eq('id', id).single();
  if (res.error) return cloudStatus('Cloud load failed: ' + res.error.message, 'crawlers');
  localStorage.setItem('crawler_cloud_id', res.data.id);
  cloudCharacterId = res.data.id;
  // The Campaign tab always reflects the LOADED crawler: sync the
  // selection to this crawler's campaign, clearing a stale selection
  // left by a different crawler (which used to leak its campaign,
  // members and parties into this crawler's view).
  cloudCampaignId = res.data.campaign_id || null;
  if (cloudCampaignId) localStorage.setItem('cloud_campaign_id', cloudCampaignId);
  else localStorage.removeItem('cloud_campaign_id');
  applyCloudState(res.data.data);
  refreshCloudAll(); refreshLoot(); refreshAchPlayerList();
}
async function cloudLoadSilent(id) {
  var res = await sb.from('characters').select('id, campaign_id, data').eq('id', id).single();
  if (res.error) { cloudStatus('Cloud load failed: ' + res.error.message); return; }
  localStorage.setItem('crawler_cloud_id', res.data.id);
  cloudCharacterId = res.data.id;
  // The Campaign tab always reflects the LOADED crawler: sync the
  // selection to this crawler's campaign, clearing a stale selection
  // left by a different crawler (which used to leak its campaign,
  // members and parties into this crawler's view).
  cloudCampaignId = res.data.campaign_id || null;
  if (cloudCampaignId) localStorage.setItem('cloud_campaign_id', cloudCampaignId);
  else localStorage.removeItem('cloud_campaign_id');
  applyCloudState(res.data.data);
}
async function cloudDelete(id) {
  if (!needLogin()) return;
  if (!confirm('Delete this crawler from the cloud? This cannot be undone.')) return;
  var res = await sb.from('characters').delete().eq('id', id);
  if (res.error) return cloudStatus('Delete failed: ' + res.error.message, 'crawlers');
  if (id === cloudCharacterId) {
    cloudCharacterId = null;
    localStorage.removeItem('crawler_cloud_id');
  }
  cloudStatus('Crawler deleted from the cloud.', 'crawlers');
  refreshCloudAll();
}
async function playerAutoLoad() {
  if (!needLogin()) return;
  var res = await sb.from('characters').select('id, name, level, updated_at').eq('owner_id', cloudUser.id).order('updated_at', { ascending: false });
  if (res.error) { cloudStatus('Could not list crawlers: ' + res.error.message); window.DCC.showTab('campaign'); return; }
  if (!res.data.length) {
    // No crawler yet: the wizard (not a blocking modal) is the creation
    // path. When it finishes, onWizardFinished saves the fresh character.
    localStorage.removeItem('dcc-sheet-v2');
    localStorage.removeItem('crawler_cloud_id');
    localStorage.removeItem('cloud_campaign_id');
    cloudCharacterId = null; cloudCampaignId = null;
    localStorage.setItem('player_autoload_pending', 'create');
    window.DCC.setState(window.DCC.blankState());
    window.DCC.ensureUnarmed();
    window.DCC.saveNow();
    var gw = $('gateway'); if (gw) gw.hidden = true;
    if (window.Wizard) window.Wizard.start();
    window.DCC.renderAll();
    return;
  }
  if (res.data.length === 1) { cloudLoadSilent(res.data[0].id); return; }
  // Several crawlers, none picked yet: nothing is loaded, so neither
  // the character pointer nor a campaign selection may survive from a
  // previous session to leak another crawler's campaign into this view.
  cloudCharacterId = null; localStorage.removeItem('crawler_cloud_id');
  cloudCampaignId = null; localStorage.removeItem('cloud_campaign_id');
  refreshCloudAll();
  window.DCC.showTab('campaign');
  cloudStatus('You have ' + res.data.length + ' crawlers. Pick one to load in My Crawlers.');
}
function onWizardFinished() {
  if (localStorage.getItem('player_autoload_pending') === 'create' && cloudUser && crawlerMode === 'player') {
    localStorage.removeItem('player_autoload_pending');
    cloudSave();
  }
}

/* ---------------- campaigns, parties, DM tools ---------------- */
async function refreshMyCrawlers() {
  if (!cloudUser || crawlerMode === 'dm') return;
  var res = await sb.from('characters').select('id, name, level, updated_at').eq('owner_id', cloudUser.id).order('updated_at', { ascending: false });
  var box = $('cloud-crawlers');
  if (!box) return;
  if (res.error) { box.innerHTML = '<p class="hint">Could not list crawlers: ' + esc(res.error.message) + '</p>'; return; }
  if (!res.data.length) { box.innerHTML = '<p class="hint">No crawlers in the cloud yet. Save this sheet to cloud to create one.</p>'; return; }
  box.innerHTML = res.data.map(function (c) {
    var mark = c.id === cloudCharacterId ? ' (this sheet)' : '';
    return '<div class="cloud-row"><span>' + esc(c.name) + ' - Level ' + esc(c.level) + esc(mark) + '</span><span><button type="button" onclick="cloudLoad(\'' + c.id + '\')">Load</button> <button type="button" onclick="cloudDelete(\'' + c.id + '\')">Delete</button></span></div>';
  }).join('');
}
function makeCode() {
  var chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var out = '';
  for (var i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
async function createCampaign(inputId) {
  if (!needLogin()) return;
  if (crawlerMode !== 'dm') return cloudStatus('Campaign creation is DM only. Switch to DM view to create a campaign.', 'join');
  var field = $(inputId || 'cloud-new-campaign');
  var name = field ? field.value.trim() : '';
  if (!name) return cloudStatus('Give the campaign a name first.', 'join');
  var res = null;
  for (var attempt = 0; attempt < 5; attempt++) {
    res = await sb.from('campaigns').insert({ name: name, code: makeCode(), dm_id: cloudUser.id }).select('id, code').single();
    if (!res.error) break;
  }
  if (res.error) return cloudStatus('Campaign creation failed: ' + res.error.message, 'join');
  cloudCampaignId = res.data.id;
  localStorage.setItem('cloud_campaign_id', cloudCampaignId);
  cloudStatus('Campaign created. Share this code with your players: ' + res.data.code, 'join');
  if (field) field.value = '';
  if (crawlerMode === 'dm') { manageCampaignId = res.data.id; localStorage.setItem('manage_campaign_id', manageCampaignId); }
  refreshCloudAll();
}
async function joinCampaign() {
  if (!needLogin()) return;
  var code = $('cloud-join-code').value.trim().toUpperCase();
  if (!code) return cloudStatus('Enter a campaign code first.', 'join');
  var id = cloudCharacterId;
  if (!id) {
    id = await cloudSave();
    if (!id) return;
  }
  // One campaign per crawler: refuse here, naming the campaign when it
  // can be read, instead of silently stacking memberships. The server
  // function enforces the same rule, so this is the friendly message
  // for a rule the database also holds.
  var memberOf = null;
  var already = await sb.from('characters').select('campaign_id').eq('id', id).single();
  if (!already.error && already.data && already.data.campaign_id) memberOf = already.data.campaign_id;
  if (!memberOf) {
    var ccRows = await sb.from('campaign_characters').select('campaign_id').eq('character_id', id).limit(1);
    if (!ccRows.error && ccRows.data && ccRows.data.length) memberOf = ccRows.data[0].campaign_id;
  }
  if (memberOf) {
    var campName = null;
    var campRow = await sb.from('campaigns').select('name').eq('id', memberOf).single();
    if (!campRow.error && campRow.data) campName = campRow.data.name;
    return cloudStatus('This crawler is already in a campaign' + (campName ? ' (' + campName + ')' : '') + '. Leave that campaign first, then join another.', 'join');
  }
  var res = await sb.rpc('join_campaign_by_code', { p_code: code, p_character_id: id });
  if (res.error) return cloudStatus('Join failed: ' + res.error.message, 'join');
  cloudCampaignId = res.data;
  localStorage.setItem('cloud_campaign_id', cloudCampaignId);
  cloudStatus('Joined the campaign. Your DM can now see and edit this crawler.', 'join');
  refreshCloudAll();
}
async function loadMyCampaigns() {
  if (!cloudUser) return;
  var list = [];
  if (crawlerMode === 'dm') {
    // DM mode keeps the old behaviour (own campaigns); the player
    // Campaign tab is hidden for DMs anyway.
    var dmRes = await sb.from('campaigns').select('id, name, code, dm_id').eq('dm_id', cloudUser.id);
    list = dmRes.data || [];
  } else if (cloudCharacterId) {
    // One campaign per crawler, and the tab shows ONLY the loaded
    // crawler's campaign: other crawlers' campaigns, members and
    // parties must never leak into this crawler's view.
    var cc = await sb.from('campaign_characters').select('campaign_id').eq('character_id', cloudCharacterId);
    var ids = Array.from(new Set((cc.data || []).map(function (r) { return r.campaign_id; })));
    if (ids.length) {
      var camp = await sb.from('campaigns').select('id, name, code, dm_id').in('id', ids);
      list = camp.data || [];
    }
  }
  // Drop a stale selection that no longer belongs to the loaded crawler.
  if (crawlerMode !== 'dm' && cloudCampaignId && !list.some(function (c) { return c.id === cloudCampaignId; })) {
    cloudCampaignId = null;
    localStorage.removeItem('cloud_campaign_id');
  }
  cloudCampaignsCache = list;
  if (list.length === 1 && cloudCampaignId !== list[0].id) {
    cloudCampaignId = list[0].id;
    localStorage.setItem('cloud_campaign_id', cloudCampaignId);
  }
  var box = $('cloud-campaigns');
  if (!box) return;
  if (!list.length) { box.innerHTML = '<p class="hint">No campaigns yet. Create one as DM, or join one with a code.</p>'; return; }
  box.innerHTML = list.map(function (c) {
    var role = c.dm_id === cloudUser.id ? 'DM' : 'Member';
    var sel = c.id === cloudCampaignId ? ' (selected)' : '';
    var delBtn = c.dm_id === cloudUser.id ? ' <button type="button" onclick="deleteCampaign(\'' + c.id + '\')">Delete</button>' : ' <button type="button" onclick="leaveCampaign(\'' + c.id + '\')">Leave</button>';
    return '<div class="cloud-row"><span>' + esc(c.name) + ' - ' + role + ' - Code ' + esc(c.code) + esc(sel) + '</span><span><button type="button" onclick="selectCampaign(\'' + c.id + '\')">Select</button>' + delBtn + '</span></div>';
  }).join('');
}
function selectCampaign(id) {
  cloudCampaignId = id;
  localStorage.setItem('cloud_campaign_id', id);
  refreshCampaign();
  renderCampaignLayout();
}
async function fetchCampaignMembers(campaignId) {
  var cc = await sb.from('campaign_characters').select('character_id, characters(id, name, level, data, owner_id)').eq('campaign_id', campaignId);
  if (cc.error) return { error: cc.error };
  var members = (cc.data || []).map(function (r) { return r.characters; }).filter(Boolean);
  if (crawlerMode === 'dm' && cloudUser) {
    members = members.filter(function (m) { return m.owner_id !== cloudUser.id || (m.data && m.data.npc); });
  }
  return { members: members };;
}
async function refreshCampaign() {
  if (crawlerMode === 'dm') return;
  var detail = $('cloud-campaign-detail');
  var partiesBox = $('cloud-parties');
  var dmBox = $('cloud-dm-tools');
  if (!detail) return;
  detail.innerHTML = ''; partiesBox.innerHTML = ''; dmBox.innerHTML = '';
  if (!cloudUser || !cloudCampaignId) {
    detail.innerHTML = '<p class="hint">Select a campaign above to see its parties and members.</p>';
    return;
  }
  var camp = cloudCampaignsCache.find(function (c) { return c.id === cloudCampaignId; });
  var isDm = camp && camp.dm_id === cloudUser.id;
  detail.innerHTML = '<p><strong>' + esc(camp ? camp.name : 'Campaign') + '</strong> - ' + (isDm ? 'You are the DM' : 'Member') + (camp ? ' - Code ' + esc(camp.code) : '') + '</p>';
  var mem = await fetchCampaignMembers(cloudCampaignId);
  if (mem.error) { detail.innerHTML += '<p class="hint">Could not load members: ' + esc(mem.error.message) + '</p>'; return; }
  var members = mem.members;
  var partiesRes = await sb.from('parties').select('id, name, leader_character_id').eq('campaign_id', cloudCampaignId).order('created_at');
  var parties = partiesRes.data || [];
  var myPartyIds = [];
  if (cloudCharacterId) {
    var pm = await sb.from('party_members').select('party_id').eq('character_id', cloudCharacterId);
    (pm.data || []).forEach(function (r) { myPartyIds.push(r.party_id); });
  }
  var myParties = parties.filter(function (p) { return myPartyIds.indexOf(p.id) !== -1; });
  if (myParties.length) {
    var html = '<div class="cloud-subhead">My parties</div>';
    for (var pi = 0; pi < myParties.length; pi++) {
      var p = myParties[pi];
      var rosterRes = await sb.rpc('party_roster', { p_party_id: p.id });
      var roster = (rosterRes.data || []).map(function (r) { return { id: r.character_id, name: r.name, level: r.level, data: { hpCurrent: r.hp_slots, manaCurrent: r.mana_current } }; });
      var leader = roster.find(function (m) { return m.id === p.leader_character_id; });
      var iAmLeader = p.leader_character_id === cloudCharacterId;
      html += '<p><strong>' + esc(p.name) + '</strong>' + (leader ? ' - Leader: ' + esc(leader.name) + (iAmLeader ? ' 👑 (you)' : ' 👑') : '') + '</p>';
      html += roster.map(function (m) {
        return '<div class="cloud-row"><span>' + esc(m.name) + ' - Level ' + esc(m.level) + ' - HP ' + esc(hpSlotsText(m.data)) + (m.id === p.leader_character_id ? ' 👑' : '') + '</span></div>';
      }).join('');
      if (iAmLeader) {
        html += '<div><label>Party name (you are the leader, you can change it)</label><input type="text" id="party-name-' + p.id + '" value="' + esc(p.name) + '"></div><button type="button" onclick="renameParty(\'' + p.id + '\')">Save party name</button>';
      }
    }
    partiesBox.innerHTML = html;
  } else {
    partiesBox.innerHTML = '<p class="hint">You are not in a party in this campaign yet. Your DM will put you in one.</p>';
  }
  if (isDm) {
    var dmHtml = '<div class="cloud-subhead">DM tools - members</div><p class="hint">Damage and healing change health slots. Buffs and debuffs are added to that crawler and show when they load it from the cloud.</p>';
    dmHtml += members.map(function (m) {
      return '<div class="cloud-row"><span><input type="checkbox" class="party-check" value="' + m.id + '"> ' + esc(m.name) + ' - Level ' + esc(m.level) + ' - HP ' + esc(hpSlotsText(m.data)) + ' - Mana ' + esc(m.data && m.data.manaCurrent !== undefined ? m.data.manaCurrent : '?') + ' (base total ' + baseStatTotal(m.data) + ')</span></div>' +
        '<div class="btn-row" style="margin-bottom: 6px;"><button type="button" onclick="dmAdjust(\'' + m.id + '\', \'hp\', -1)">HP -1</button><button type="button" onclick="dmAdjust(\'' + m.id + '\', \'hp\', 1)">HP +1</button><button type="button" onclick="dmAdjust(\'' + m.id + '\', \'mana\', -1)">Mana -1</button><button type="button" onclick="dmAdjust(\'' + m.id + '\', \'mana\', 1)">Mana +1</button></div>' +
        '<div><label>Buff / debuff for ' + esc(m.name) + '</label><input type="text" id="dm-cond-' + m.id + '" placeholder="e.g. Blessed, Poisoned"></div>' +
        '<div class="btn-row" style="margin-bottom: 12px;"><button type="button" onclick="dmAddCondition(\'' + m.id + '\', \'buff\')">Add buff</button><button type="button" onclick="dmAddCondition(\'' + m.id + '\', \'debuff\')">Add debuff</button></div>';
    }).join('');
    dmHtml += '<div class="cloud-subhead">DM tools - create a party</div><p class="hint">Tick the players above, then confirm. The leader is the player with the highest combined base stat total, and the party name stays even if the leader later changes.</p>';
    dmHtml += '<div style="margin-top: 8px;"><button type="button" onclick="createParty()">Confirm party</button></div>';
    dmHtml += '<div class="cloud-subhead">DM tools - parties</div>';
    dmHtml += parties.map(function (p) {
      var leader = members.find(function (m) { return m.id === p.leader_character_id; });
      return '<div class="cloud-row"><span>' + esc(p.name) + (leader ? ' - Leader: ' + esc(leader.name) + ' 👑' : ' - No leader yet') + '</span><span><button type="button" onclick="recalcLeader(\'' + p.id + '\')">Recalculate leader</button> <button type="button" onclick="deleteParty(\'' + p.id + '\')">Delete</button></span></div>';
    }).join('') || '<p class="hint">No parties yet.</p>';
    dmBox.innerHTML = dmHtml;
  }
}
async function renameParty(partyId) {
  var name = $('party-name-' + partyId).value.trim();
  if (!name) return cloudStatus('Give the party a name first.', 'focus');
  var res = await sb.from('parties').update({ name: name }).eq('id', partyId);
  if (res.error) return cloudStatus('Rename failed: ' + res.error.message, 'focus');
  cloudStatus('Party renamed to ' + name, 'focus');
  refreshCampaign();
}
async function createParty() {
  if (!needLogin() || !cloudCampaignId) return cloudStatus('Select a campaign first.', 'focus');
  var ids = Array.from(document.querySelectorAll('.party-check:checked')).map(function (c) { return c.value; });
  if (!ids.length) return cloudStatus('Tick at least one player for the party.', 'focus');
  var res = await sb.from('characters').select('id, data').in('id', ids);
  if (res.error) return cloudStatus('Could not read party members: ' + res.error.message, 'focus');
  var totals = await Promise.all(res.data.map(function (c) { return baseStatTotalAsync(c.data); }));
  var leaderId = ids[0]; var best = -1;
  res.data.forEach(function (c, i) {
    if (totals[i] > best) { best = totals[i]; leaderId = c.id; }
  });
  var party = await sb.from('parties').insert({ campaign_id: cloudCampaignId, name: 'Unnamed Party', leader_character_id: leaderId }).select('id').single();
  if (party.error) return cloudStatus('Party creation failed: ' + party.error.message, 'focus');
  var rows = ids.map(function (id) { return { party_id: party.data.id, character_id: id }; });
  var pm = await sb.from('party_members').insert(rows);
  if (pm.error) return cloudStatus('Party created, but adding members failed: ' + pm.error.message, 'focus');
  cloudStatus('Party created. Its leader is prompted to name it in their own Campaign panel.', 'focus');
  refreshCampaign();
  refreshManageTab();
}
async function recalcLeader(partyId) {
  var pm = await sb.from('party_members').select('character_id, characters(id, data)').eq('party_id', partyId);
  if (pm.error) return cloudStatus('Could not read party: ' + pm.error.message, 'focus');
  var totals = await Promise.all((pm.data || []).map(function (r) { return r.characters ? baseStatTotalAsync(r.characters.data) : Promise.resolve(-1); }));
  var leaderId = null; var best = -1;
  (pm.data || []).forEach(function (r, i) {
    if (!r.characters) return;
    if (totals[i] > best) { best = totals[i]; leaderId = r.characters.id; }
  });
  if (!leaderId) return cloudStatus('Party has no members to choose a leader from.', 'focus');
  var res = await sb.from('parties').update({ leader_character_id: leaderId }).eq('id', partyId);
  if (res.error) return cloudStatus('Leader update failed: ' + res.error.message, 'focus');
  cloudStatus('Leader recalculated. The party name stays as it was; the new leader can change it.', 'focus');
  refreshCampaign();
  refreshManageTab();
}
async function deleteParty(partyId) {
  if (!confirm('Delete this party? Its members stay in the campaign.')) return;
  await sb.from('party_members').delete().eq('party_id', partyId);
  var res = await sb.from('parties').delete().eq('id', partyId);
  if (res.error) return cloudStatus('Delete failed: ' + res.error.message, 'focus');
  refreshCampaign();
  refreshManageTab();
}
async function dmAdjust(characterId, field, delta) {
  var row = await sb.from('characters').select('id, data').eq('id', characterId).single();
  if (row.error) return cloudStatus('Could not load that crawler: ' + row.error.message, 'focus');
  var d = row.data.data || {};
  if (field === 'hp') d.hpCurrent = Math.max(0, Math.min(10, (parseInt(d.hpCurrent, 10) || 0) + delta));
  else d.manaCurrent = Math.max(0, (parseInt(d.manaCurrent, 10) || 0) + delta);
  var res = await sb.from('characters').update({ data: d, updated_at: new Date().toISOString() }).eq('id', characterId);
  if (res.error) return cloudStatus('Update failed: ' + res.error.message, 'focus');
  refreshCampaign();
  try { refreshDmDashboard(); } catch (e) {}
  refreshManageTab();
}
async function dmAddCondition(characterId, kind, inputId) {
  var input = $(inputId || ('dm-cond-' + characterId));
  var name = input ? input.value.trim() : '';
  if (!name) return cloudStatus('Type a buff or debuff name first.', 'focus');
  var row = await sb.from('characters').select('id, data').eq('id', characterId).single();
  if (row.error) return cloudStatus('Could not load that crawler: ' + row.error.message, 'focus');
  var d = row.data.data || {};
  var key = kind === 'buff' ? 'buffs' : 'debuffs';
  if (!Array.isArray(d[key])) d[key] = [];
  // Merged buffs/debuffs are plain name strings (the sheet renders them
  // with esc(x)); the original pushed {name, notes} objects, which would
  // render as "[object Object]" here.
  d[key].push(name);
  var res = await sb.from('characters').update({ data: d, updated_at: new Date().toISOString() }).eq('id', characterId);
  if (res.error) return cloudStatus('Update failed: ' + res.error.message, 'focus');
  if (input) input.value = '';
  refreshCampaign();
  try { refreshDmDashboard(); } catch (e) {}
  refreshManageTab();
}
async function refreshCloudAll() {
  if (!cloudUser) return;
  if (crawlerMode === 'dm') { refreshDmDashboard(); refreshManageTab(); return; }
  await refreshMyCrawlers();
  await loadMyCampaigns();
  await refreshCampaign();
  renderCampaignLayout();
  refreshDeadPartyTab();
}
async function leaveCampaign(campaignId) {
  if (!needLogin()) return;
  var id = campaignId || cloudCampaignId;
  if (!id) return cloudStatus('Select a campaign first.', 'campaign');
  if (!cloudCharacterId) return cloudStatus('Load a crawler first, then leave with that crawler.', 'campaign');
  if (!confirm('Remove this crawler from the campaign? Your crawler will NOT be deleted, and it will also leave any parties in this campaign. You can rejoin later with the campaign code.')) return;
  var res = await sb.rpc('leave_campaign_by_character', { p_campaign_id: id, p_character_id: cloudCharacterId });
  if (res.error) return cloudStatus('Leave failed: ' + res.error.message + ' (if this is a new site version, run supabase_leave_campaign.sql in Supabase first.)', 'campaign');
  if (id === cloudCampaignId) {
    cloudCampaignId = null;
    localStorage.removeItem('cloud_campaign_id');
  }
  cloudStatus('Left the campaign. Your crawler was not deleted.', 'campaign');
  loadMyCampaigns();
  refreshCampaign();
  renderCampaignLayout();
}
async function deleteCampaign(id) {
  if (!needLogin()) return;
  if (!confirm('Delete this campaign? Players will be removed from the campaign, but their crawlers will NOT be deleted. Parties in this campaign will be removed. This cannot be undone.')) return;
  var res = await sb.from('campaigns').delete().eq('id', id);
  if (res.error) { dmStatus('Delete failed: ' + res.error.message); return cloudStatus('Delete failed: ' + res.error.message, 'campaign'); }
  if (id === cloudCampaignId) {
    cloudCampaignId = null;
    localStorage.removeItem('cloud_campaign_id');
  }
  dmStatus('Campaign deleted. Players were removed from it, their crawlers were not deleted.');
  refreshDmDashboard();
  loadMyCampaigns();
  refreshCampaign();
  renderCampaignLayout();
  refreshManageTab();
}

/* ---------------- DM dashboard ---------------- */
var dmSelectedCampaignId = localStorage.getItem('dm_selected_campaign') || null;
var dmSelectedPlayerId = null;
var dmMembersCache = [];
function selectDmCampaign(id) {
  dmSelectedCampaignId = id;
  localStorage.setItem('dm_selected_campaign', id);
  dmSelectedPlayerId = null;
  refreshDmDashboard();
}
function selectDmPlayer(id) {
  dmSelectedPlayerId = id;
  refreshDmDashboard();
}
async function refreshDmDashboard() {
  var box = $('dm-dashboard');
  if (!box) return;
  if (!cloudUser) { box.innerHTML = '<p class="hint">Log in as DM from the start screen first.</p>'; return; }
  var res = await sb.from('campaigns').select('id, name, code').eq('dm_id', cloudUser.id).order('created_at');
  if (res.error) { box.innerHTML = '<p class="hint">Could not list campaigns: ' + esc(res.error.message) + '</p>'; return; }
  if (!res.data.length) { box.innerHTML = '<p class="hint">No campaigns you control yet. Create one in the Campaign tab.</p>'; return; }
  if (!dmSelectedCampaignId || !res.data.some(function (c) { return c.id === dmSelectedCampaignId; })) {
    dmSelectedCampaignId = res.data[0].id;
    localStorage.setItem('dm_selected_campaign', dmSelectedCampaignId);
  }
  var camp = res.data.find(function (c) { return c.id === dmSelectedCampaignId; });
  var htmlOut = '<div class="cloud-subhead">Your campaigns</div>' + res.data.map(function (c) {
    return '<button type="button" onclick="selectDmCampaign(\'' + c.id + '\')">' + esc(c.name) + (c.id === dmSelectedCampaignId ? ' (selected)' : '') + '</button> ';
  }).join('');
  htmlOut += '<div class="cloud-subhead">' + esc(camp.name) + ' - Code ' + esc(camp.code) + ' <button type="button" onclick="deleteCampaign(\'' + camp.id + '\')">Delete campaign</button></div>';
  var mem = await fetchCampaignMembers(camp.id);
  var members = mem.members || [];
  dmMembersCache = members;
  if (!dmSelectedPlayerId || !members.some(function (m) { return m.id === dmSelectedPlayerId; })) dmSelectedPlayerId = members.length ? members[0].id : null;
  var partiesRes = await sb.from('parties').select('id, name, leader_character_id').eq('campaign_id', camp.id).order('created_at');
  var parties = partiesRes.data || [];
  var partyHtml = '<p class="hint">No parties yet. Create parties in the Campaign tab.</p>';
  if (parties.length) {
    var pmAll = await sb.from('party_members').select('party_id, character_id').in('party_id', parties.map(function (p) { return p.id; }));
    var pmMap = {};
    (pmAll.data || []).forEach(function (r) { (pmMap[r.party_id] = pmMap[r.party_id] || []).push(r.character_id); });
    partyHtml = parties.map(function (p) {
      var names = (pmMap[p.id] || []).map(function (id) {
        var m = members.find(function (x) { return x.id === id; });
        return m ? esc(m.name) + (id === p.leader_character_id ? ' 👑' : '') : 'Unknown';
      }).join(', ');
      return '<div class="cloud-row"><span><strong>' + esc(p.name) + '</strong> - ' + names + '</span></div>';
    }).join('');
  }
  htmlOut += '<div class="cloud-subhead">Players (select one to alter)</div>' + (members.length ? members.map(function (m) {
    var d = m.data || {};
    return '<div class="cloud-row"><span>' + esc(m.name) + (d.npc ? ' (NPC)' : '') + (d.dead ? ' - DECEASED' : '') + ' - Level ' + esc(m.level) + ' - HP ' + hpSlotsText(d) + ' - Mana ' + (d.manaCurrent === null || d.manaCurrent === undefined ? '?' : d.manaCurrent) + '</span><span><button type="button" onclick="selectDmPlayer(\'' + m.id + '\')">' + (m.id === dmSelectedPlayerId ? 'Selected' : 'Select') + '</button> <button type="button" onclick="inspectCharacter(\'' + m.id + '\')">Inspect</button></span></div>';
  }).join('') : '<p class="hint">No players in this campaign yet.</p>');
  var sel = members.find(function (m) { return m.id === dmSelectedPlayerId; });
  if (sel) {
    var d = sel.data || {};
    htmlOut += '<div class="cloud-subhead">Alter selected player: ' + esc(sel.name) + '</div>';
    htmlOut += '<div class="cloud-row"><span>HP ' + hpSlotsText(d) + ' - Mana ' + (d.manaCurrent === null || d.manaCurrent === undefined ? '?' : d.manaCurrent) + '</span><span><button type="button" onclick="dmAdjust(\'' + sel.id + '\', \'hp\', -1)">HP -1</button> <button type="button" onclick="dmAdjust(\'' + sel.id + '\', \'hp\', 1)">HP +1</button> <button type="button" onclick="dmAdjust(\'' + sel.id + '\', \'mana\', -1)">Mana -1</button> <button type="button" onclick="dmAdjust(\'' + sel.id + '\', \'mana\', 1)">Mana +1</button></span></div>';
    htmlOut += '<div><label>Buff or debuff name</label><input type="text" id="dm-dash-cond" placeholder="e.g. Blessed"></div><div class="btn-row"><button type="button" onclick="dmAddCondition(\'' + sel.id + '\', \'buff\', \'dm-dash-cond\')">Add buff</button><button type="button" onclick="dmAddCondition(\'' + sel.id + '\', \'debuff\', \'dm-dash-cond\')">Add debuff</button></div>';
  }
  htmlOut += '<div class="cloud-subhead">Parties</div>' + partyHtml;
  box.innerHTML = htmlOut;
}

/* ---------------- realtime + autosave ---------------- */
function onLocalSave() {
  if (!cloudUser || crawlerMode !== 'player' || !cloudCharacterId || applyingRemote) return;
  try { if (window.DCC.getState().dead) return; } catch (e) {}
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async function () {
    try {
      var data = getSheetCopy();
      if (!data) return;
      var sentAt = new Date().toISOString();
      lastOwnAutosaveAt = Date.parse(sentAt);
      await sb.from('characters').update({ name: data.name || 'Unnamed Crawler', level: parseInt(data.level, 10) || 1, data: data, updated_at: sentAt }).eq('id', cloudCharacterId);
    } catch (e) {}
  }, 800);
}
function startRealtime() {
  if (!sb || !cloudUser) return;
  if (realtimeChannel) { try { sb.removeChannel(realtimeChannel); } catch (e) {} }
  realtimeChannel = sb.channel('crawler-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'loot_boxes' }, function (payload) {
      if (crawlerMode === 'player' && payload.new && payload.new.recipient_character_id === cloudCharacterId) {
        lootStatus(payload.new.status === 'opened' && payload.new.is_achievement ? 'New achievement received!' : 'New loot box received!');
        refreshLoot();
        refreshAchPlayerList();
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'characters' }, function (payload) {
      var row = payload.new;
      if (!row) return;
      if (crawlerMode === 'player' && cloudCharacterId && row.id === cloudCharacterId && !applyingRemote) {
        if (lastOwnAutosaveAt && row.updated_at && Date.parse(row.updated_at) === lastOwnAutosaveAt) {
          lastOwnAutosaveAt = null;
          return;
        }
        // Joining or leaving a campaign updates this row's campaign_id
        // but NOT its sheet data, and a partial realtime payload can
        // arrive with data missing entirely. Either way the sheet must
        // never be replaced by a blank: skip empty payloads, and skip
        // when the incoming data is identical to the sheet on screen
        // (a membership-only change). Only a real, different sheet
        // (a DM edit) replaces the local one.
        var incoming = row.data;
        if (!incoming || typeof incoming !== 'object' || !Object.keys(incoming).length) return;
        try {
          var current = window.DCC.getState ? JSON.stringify(window.DCC.getState()) : '';
          if (current && JSON.stringify(incoming) === current) return;
        } catch (e) {}
        applyingRemote = true;
        try {
          var st = Object.assign(window.DCC.blankState(), incoming);
          window.DCC.setState(st);
          window.DCC.ensureUnarmed();
          window.DCC.syncGearGrants();
          window.DCC.saveNow();
          window.DCC.renderAll();
          refreshDeadPartyTab();
        } finally { applyingRemote = false; }
      } else if (crawlerMode === 'dm') {
        refreshDmDashboard();
      }
    })
    .subscribe();
}
function onTabShown(tab) {
  if (tab === 'dm') refreshDmDashboard();
  if (tab === 'manage') refreshManageTab();
  if (tab === 'inspect') renderInspector();
  if (tab === 'deadparty') refreshDeadPartyTab();
  if (tab === 'loot') refreshLoot();
  if (tab === 'sendbox' || tab === 'sendach') refreshAchCampaigns();
  if (tab === 'achievements') { refreshAchPlayerList(); checkUnviewedAchievements(); }
}

/* Hooks the sheet calls (defined here so app.js can reference window.Cloud
 * even before initCloud runs). */
window.Cloud = {
  showLanding: showLanding,
  isDm: function () { return crawlerMode === 'dm'; },
  onLocalSave: onLocalSave,
  onWizardFinished: onWizardFinished,
  onTabShown: onTabShown
};

document.addEventListener('DOMContentLoaded', function () {
  setupBackgroundSlider();
  applyModeClass();
  initCloud();
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-tab="campaign"]') : null;
    if (t) renderCampaignLayout();
  });
});

/* ---------------- loot boxes + achievements (Phase 3) ---------------- */
var LOOT_GRADES = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Legendary', 'Celestial'];
var lootOpening = [];
var lootOpeningIndex = 0;
var achUnviewedIds = [];
var dmItemCounter = 0;

// Gold in a loot box, book Chapter 4 sample loot (pp.216-218, "almost
// always" in each box): the player rolls this when the box is opened.
// A roll to show the DM, not a fixed amount and not auto-added.
var LOOT_GOLD_ROLL = {
  'Bronze': 'Roll 1d10 gold',
  'Silver': 'Roll 1d10 × 100 gold',
  'Gold': 'Roll 1d6 × 1,000 gold',
  'Platinum': 'Roll 2d6 × 1,000 gold',
  'Legendary': 'Roll 1d10 × 10,000 gold',
  'Celestial': 'No gold in the box'
};
function updateBoxGoldHint(gradeId, hintId) {
  var gradeEl = $(gradeId);
  var hintEl = $(hintId);
  if (!gradeEl || !hintEl) return;
  var roll = LOOT_GOLD_ROLL[gradeEl.value];
  if (!roll) { hintEl.style.display = 'none'; hintEl.innerText = ''; return; }
  hintEl.style.display = '';
  hintEl.innerText = 'Gold in this box: ' + roll + ' (almost always, per the book; roll when the player opens the box, not auto-added).';
}
function playLootSound(key) {
  if (!key) return;
  if (String(key).endsWith('.mp3')) { try { new Audio(key).play().catch(function () {}); } catch (e) {} return; }
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var tunes = {
      fanfare: [523, 659, 784, 1047],
      chime: [1319, 1568, 2093],
      epic: [262, 392, 523, 784],
      mystic: [440, 554, 659, 880],
      victory: [523, 587, 659, 784, 1047]
    };
    var notes = tunes[key] || tunes.fanfare;
    notes.forEach(function (freq, i) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.35);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18); osc.stop(ctx.currentTime + i * 0.18 + 0.4);
    });
  } catch (e) {}
}
/* DM item/skill pickers draw on the same lazy data the sheet uses. */
var dmItemsCache = null;
var dmSkillsCache = null;
function itemOptions() {
  var out = '<option value="">-- Custom / pick from book --</option>';
  var order = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Legendary', 'Celestial', 'Iconic', 'Loot (general)'];
  var list = dmItemsCache || [];
  order.forEach(function (source) {
    var items = list.filter(function (e) { return e.source === source; });
    if (!items.length) return;
    out += '<optgroup label="' + esc(source) + '">';
    items.forEach(function (e) { out += '<option value="' + esc(e.name) + '">' + esc(e.name) + '</option>'; });
    out += '</optgroup>';
  });
  var rest = list.filter(function (e) { return order.indexOf(e.source) === -1; });
  if (rest.length) {
    out += '<optgroup label="Other">';
    rest.forEach(function (e) { out += '<option value="' + esc(e.name) + '">' + esc(e.name) + '</option>'; });
    out += '</optgroup>';
  }
  return out;
}
function findItemEntry(name) {
  if (!name) return null;
  var key = name.trim().toLowerCase();
  return (dmItemsCache || []).find(function (e) { return e.name.toLowerCase() === key; }) || null;
}
function grantSkillOptions() {
  var out = '<option value="">-- Pick skill / spell --</option>';
  var groups = [['attack', 'Attack Skills'], ['utility', 'Utility Skills'], ['spell', 'Spells']];
  groups.forEach(function (g) {
    var items = (dmSkillsCache || []).filter(function (e) { return e.kind === g[0]; });
    if (!items.length) return;
    out += '<optgroup label="' + g[1] + '">';
    items.forEach(function (e) { out += '<option value="' + esc(e.name) + '">' + esc(e.name) + '</option>'; });
    out += '</optgroup>';
  });
  return out;
}
function fillDmItemSelects() {
  document.querySelectorAll('.dm-item-rulebook').forEach(function (sel) {
    var cur = sel.value;
    sel.innerHTML = itemOptions();
    if (cur) sel.value = cur;
  });
}
function fillDmSkillSelects() {
  document.querySelectorAll('.bonus-skill').forEach(function (sel) {
    var cur = sel.value;
    sel.innerHTML = grantSkillOptions();
    if (cur) sel.value = cur;
  });
}
function ensureDmData() {
  if (!dmItemsCache && window.DCC && window.DCC.ensureItems) {
    window.DCC.ensureItems().then(function (list) { dmItemsCache = list; fillDmItemSelects(); }).catch(function () {});
  }
  if (!dmSkillsCache && window.DCC && window.DCC.ensureSkills) {
    window.DCC.ensureSkills().then(function (list) { dmSkillsCache = list; fillDmSkillSelects(); }).catch(function () {});
  }
}
function dmItemApply(sel) {
  var group = sel.closest('.dm-item-group');
  if (!group || !sel.value) return;
  var entry = findItemEntry(sel.value);
  if (!entry) return;
  var nameEl = group.querySelector('.dm-item-name');
  var notesEl = group.querySelector('.dm-item-notes');
  if (nameEl) nameEl.value = entry.name;
  if (notesEl && !notesEl.value.trim() && entry.effect) notesEl.value = entry.effect;
}
function updateBonusEntryVisibility(entry) {
  var type = entry.querySelector('.bonus-type') ? entry.querySelector('.bonus-type').value : 'stat';
  var statEl = entry.querySelector('.bonus-stat');
  var skillEl = entry.querySelector('.bonus-skill');
  var labelEl = entry.querySelector('.bonus-amount-label');
  if (statEl) statEl.style.display = type === 'stat' ? '' : 'none';
  if (skillEl) skillEl.style.display = type === 'grant' ? '' : 'none';
  if (labelEl) labelEl.innerText = type === 'grant' ? 'Rank' : 'Amount';
}
function onBonusTypeChange(select) {
  var entry = select.closest('.bonus-entry');
  if (entry) updateBonusEntryVisibility(entry);
}
function addDmBonusRow(group) {
  var bonuses = group.querySelector('.dm-item-bonuses');
  if (bonuses.querySelectorAll('.bonus-entry').length >= 5) return;
  var entry = document.createElement('div');
  entry.className = 'bonus-entry';
  entry.innerHTML = '<select class="bonus-type" onchange="onBonusTypeChange(this)"><option value="stat">Stat bonus</option><option value="grant">Skill grant</option><option value="dr">Damage Resistance</option><option value="evade">Evade</option></select>'
    + '<select class="bonus-stat"><option value="str">STR</option><option value="con">CON</option><option value="dex">DEX</option><option value="int">INT</option><option value="cha">CHA</option></select>'
    + '<select class="bonus-skill">' + grantSkillOptions() + '</select>'
    + '<span class="bonus-amount-label">Amount</span>'
    + '<input type="number" class="bonus-amount" value="0">';
  var removeBtn = document.createElement('button');
  removeBtn.type = 'button'; removeBtn.innerText = '✕';
  removeBtn.onclick = function () { entry.remove(); };
  entry.appendChild(removeBtn);
  bonuses.appendChild(entry);
  updateBonusEntryVisibility(entry);
  ensureDmData();
}
function addDmItemRow(containerId) {
  dmItemCounter++;
  var box = $(containerId);
  if (!box) return;
  var group = document.createElement('div');
  group.className = 'dm-item-group';
  group.innerHTML = '<div><label>Rulebook item</label><select class="dm-item-rulebook" onchange="dmItemApply(this)">' + itemOptions() + '</select></div>'
    + '<div><label>Item name</label><input type="text" class="dm-item-name" placeholder="e.g. Health Potion"></div>'
    + '<div><label>Description</label><textarea class="dm-item-notes" placeholder="Describe stats, effects, duration, weight, or charges..."></textarea></div>'
    + '<div><label>Quantity (each player gets this many)</label><input type="number" class="dm-item-qty" value="1" min="1"></div>'
    + '<div class="cloud-subhead">Bonuses (only when equipped, max 5)</div><div class="dm-item-bonuses"></div>'
    + '<div class="btn-row"><button type="button" onclick="addDmBonusRow(this.closest(\'.dm-item-group\'))">Add bonus</button><button type="button" onclick="this.closest(\'.dm-item-group\').remove()">Remove item</button></div>';
  box.appendChild(group);
  ensureDmData();
}
function collectDmItems(containerId) {
  var items = [];
  document.querySelectorAll('#' + containerId + ' .dm-item-group').forEach(function (group) {
    var name = group.querySelector('.dm-item-name').value.trim();
    if (!name) return;
    var bonuses = [];
    group.querySelectorAll('.bonus-entry').forEach(function (entry) {
      bonuses.push({
        type: entry.querySelector('.bonus-type').value,
        stat: entry.querySelector('.bonus-stat').value,
        skill: entry.querySelector('.bonus-skill').value.trim(),
        amount: entry.querySelector('.bonus-amount').value || 0
      });
    });
    items.push({ name: name, qty: group.querySelector('.dm-item-qty').value || 1, notes: group.querySelector('.dm-item-notes').value, bonuses: bonuses });
  });
  return items;
}
function selectedPlayers(checkClass) {
  return Array.from(document.querySelectorAll('.' + checkClass + ':checked')).map(function (c) { return c.value; });
}
async function insertLootBoxes(campaignId, playerIds, row) {
  for (var i = 0; i < playerIds.length; i++) {
    var res = await sb.from('loot_boxes').insert(Object.assign({}, row, { campaign_id: campaignId, recipient_character_id: playerIds[i] }));
    if (res.error) return res.error;
  }
  return null;
}
async function refreshAchCampaigns() {
  if (!cloudUser) return;
  var res = await sb.from('campaigns').select('id, name, code').eq('dm_id', cloudUser.id).order('created_at');
  var list = res.data || [];
  ['box-campaign', 'ach-campaign'].forEach(function (id) {
    var sel = $(id);
    if (sel) sel.innerHTML = list.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + ' - ' + esc(c.code) + '</option>'; }).join('');
  });
  if (list.length) { refreshBoxPlayers(); refreshAchPlayers(); }
  if ($('box-items') && !$('box-items').children.length) addDmItemRow('box-items');
  if ($('ach-items') && !$('ach-items').children.length) addDmItemRow('ach-items');
  ensureDmData();
}
async function renderPlayerChecks(campId, containerId, checkClass) {
  var box = $(containerId);
  if (!box) return;
  if (!campId) { box.innerHTML = ''; return; }
  var mem = await fetchCampaignMembers(campId);
  box.innerHTML = (mem.members || []).map(function (m) {
    return '<label class="player-check-label"><input type="checkbox" class="' + checkClass + '" value="' + m.id + '"> ' + esc(m.name) + ' - Level ' + esc(m.level) + '</label>';
  }).join('') || '<p class="hint">No players in this campaign yet.</p>';
}
function refreshBoxPlayers() { renderPlayerChecks($('box-campaign') ? $('box-campaign').value : '', 'box-players', 'box-player-check'); }
function refreshAchPlayers() { renderPlayerChecks($('ach-campaign') ? $('ach-campaign').value : '', 'ach-players', 'ach-player-check'); }
async function sendBoxOnly() {
  if (!needLogin()) return;
  var campaignId = $('box-campaign').value;
  var playerIds = selectedPlayers('box-player-check');
  var boxName = $('box-name').value.trim();
  var boxGrade = $('box-grade').value;
  var items = collectDmItems('box-items');
  if (!campaignId || !playerIds.length) return boxStatus('Pick a campaign and at least one player first.');
  if (!boxName) return boxStatus('Loot Box Name is required.');
  if (!boxGrade) return boxStatus('Loot Box Grade is required.');
  var err = await insertLootBoxes(campaignId, playerIds, { dm_id: cloudUser.id, achievement_name: null, message: null, loot_box_name: boxName, loot_box_grade: boxGrade, sound_clip: null, items: items, status: 'pending', is_achievement: false });
  if (err) return boxStatus('Send failed: ' + err.message + ' (if this is a new site version, run supabase_loot_v2.sql in Supabase first.)');
  boxStatus('Loot box sent to ' + playerIds.length + ' player(s).');
}
function toggleAchBoxFields() {
  var noBox = $('ach-no-box').checked;
  var fields = $('ach-box-fields');
  if (fields) fields.style.display = noBox ? 'none' : '';
}
async function sendAchievement() {
  if (!needLogin()) return;
  var campaignId = $('ach-campaign').value;
  var playerIds = selectedPlayers('ach-player-check');
  var name = $('ach-name').value.trim();
  var message = $('ach-message').value.trim();
  var sound = $('ach-sound').value;
  var noBox = $('ach-no-box').checked;
  var boxName = noBox ? '' : $('ach-box-name').value.trim();
  var boxGrade = noBox ? '' : $('ach-box-grade').value;
  var items = noBox ? [] : collectDmItems('ach-items');
  if (!name) return achStatus('Achievement name is required.');
  if (!message) return achStatus('Message is required.');
  if (!campaignId || !playerIds.length) return achStatus('Pick a campaign and at least one player first.');
  if (!noBox && !boxName) return achStatus('Loot Box Name is required.');
  if (!noBox && !boxGrade) return achStatus('Loot Box Grade is required.');
  var err = await insertLootBoxes(campaignId, playerIds, { dm_id: cloudUser.id, achievement_name: name, message: message, loot_box_name: boxName, loot_box_grade: boxGrade, sound_clip: sound || null, items: items, status: noBox ? 'opened' : 'pending', is_achievement: true });
  if (err) return achStatus('Send failed: ' + err.message + ' (if this is a new site version, run supabase_loot_v2.sql in Supabase first.)');
  achStatus('Achievement sent to ' + playerIds.length + ' player(s).' + (noBox ? ' It appears directly in their Achievements tab, with no loot box.' : ''));
  $('ach-name').value = '';
  $('ach-message').value = '';
}
async function checkUnviewedAchievements() {
  if (!cloudUser || !cloudCharacterId || crawlerMode !== 'player') return;
  var res = await sb.from('loot_boxes').select('*').eq('recipient_character_id', cloudCharacterId).eq('status', 'opened').eq('is_achievement', true).eq('viewed', false);
  if (res.error || !(res.data || []).length) return;
  achUnviewedIds = (res.data || []).map(function (b) { return b.id; });
  var noBoxSound = (res.data || []).find(function (b) { return !b.loot_box_name && b.sound_clip; });
  if (noBoxSound) playLootSound(noBoxSound.sound_clip);
  var modal = $('achModal');
  var content = $('ach-modal-content');
  content.innerHTML = '<h3>New achievements!</h3>'
    + (res.data || []).map(function (b) {
      return '<div style="margin-bottom: 12px;"><strong>' + esc(b.achievement_name) + '</strong>'
        + (b.loot_box_name ? ' - ' + esc(b.loot_box_name) + ' (' + esc(b.loot_box_grade) + ')' : '')
        + '<p>' + esc(b.message || '') + '</p></div>';
    }).join('')
    + '<div class="btn-row"><button type="button" onclick="dismissAchModal()">Got it</button></div>';
  modal.style.display = 'flex';
}
async function dismissAchModal() {
  $('achModal').style.display = 'none';
  if (achUnviewedIds.length) {
    await sb.from('loot_boxes').update({ viewed: true }).in('id', achUnviewedIds);
    achUnviewedIds = [];
  }
  refreshAchPlayerList();
}
async function refreshAchPlayerList() {
  var box = $('ach-player-items');
  if (!box) return;
  if (!cloudUser) { box.innerHTML = '<p class="hint">Log in as a player to see your achievements.</p>'; return; }
  if (!cloudCharacterId) { box.innerHTML = '<p class="hint">Load a cloud crawler first, then achievements for that crawler will show here.</p>'; return; }
  var res = await sb.from('loot_boxes').select('*').eq('recipient_character_id', cloudCharacterId).eq('status', 'opened').eq('is_achievement', true).order('created_at', { ascending: false });
  if (res.error) { box.innerHTML = '<p class="hint">Could not list achievements: ' + esc(res.error.message) + '</p>'; return; }
  box.innerHTML = (res.data || []).length ? (res.data || []).map(function (b) {
    return '<details style="margin-bottom: 10px;"><summary><strong>' + esc(b.achievement_name) + '</strong>' + (b.viewed === false ? ' <span style="color: #ffe600;">NEW</span>' : '') + (b.loot_box_name ? ' - ' + esc(b.loot_box_name) + ' (' + esc(b.loot_box_grade) + ')' : '') + '</summary><p>' + esc(b.message || '') + '</p>' + ((b.items || []).length ? '<p>Items: ' + esc((b.items || []).map(function (it) { return typeof it === 'string' ? it : it.name; }).join(', ')) + '</p>' : '') + '</details>';
  }).join('') : '<p class="hint">No achievements yet. Open a loot box with an achievement to see it here.</p>';
}
async function fetchLootPending() {
  if (!cloudUser || !cloudCharacterId) return [];
  var res = await sb.from('loot_boxes').select('*').eq('recipient_character_id', cloudCharacterId).eq('status', 'pending').order('created_at', { ascending: true });
  if (res.error) { lootStatus('Could not list loot: ' + res.error.message + ' (if this is a new site version, run supabase_loot.sql in Supabase first.)'); return []; }
  var order = {};
  LOOT_GRADES.forEach(function (g, i) { order[g] = i; });
  return (res.data || []).sort(function (a, b) {
    var ga = order[a.loot_box_grade] === undefined ? 99 : order[a.loot_box_grade];
    var gb = order[b.loot_box_grade] === undefined ? 99 : order[b.loot_box_grade];
    return ga - gb;
  });
}
async function refreshLoot() {
  var pendingBox = $('loot-pending');
  var openedBox = $('loot-opened');
  if (!pendingBox) return;
  if (!cloudUser) { pendingBox.innerHTML = '<p class="hint">Log in as a player to receive loot boxes.</p>'; return; }
  if (!cloudCharacterId) { pendingBox.innerHTML = '<p class="hint">Load a cloud crawler first, then loot boxes for that crawler will show here.</p>'; return; }
  var pending = await fetchLootPending();
  pendingBox.innerHTML = pending.length
    ? '<div class="cloud-subhead">Waiting boxes (' + pending.length + ')</div>' + pending.map(function (b) {
      return '<div class="cloud-row"><span><strong>' + esc(b.loot_box_name) + '</strong> - ' + esc(b.loot_box_grade) + ' - ' + esc(b.achievement_name) + '</span></div>';
    }).join('')
    : '<p class="hint">No loot boxes waiting.</p>';
  if (openedBox) openedBox.innerHTML = '';
}
async function openAllLoot() {
  var pending = await fetchLootPending();
  if (!pending.length) { lootStatus('No loot boxes waiting.'); return; }
  lootOpening = pending; lootOpeningIndex = 0;
  revealLootBox();
}
async function revealLootBox() {
  var modal = $('lootModal');
  var content = $('loot-modal-content');
  var box = lootOpening[lootOpeningIndex];
  if (!box) {
    modal.style.display = 'none';
    refreshLoot();
    checkUnviewedAchievements();
    return;
  }
  playLootSound(box.sound_clip);
  content.innerHTML = '<h3>' + esc(box.loot_box_name) + ' - ' + esc(box.loot_box_grade) + '</h3>'
    + (box.achievement_name ? '<p><strong>' + esc(box.achievement_name) + '</strong></p>' : '')
    + (box.message ? '<p>' + esc(box.message) + '</p>' : '')
    + '<p>Items: ' + esc((box.items || []).map(function (it) { return typeof it === 'string' ? it : it.name; }).join(', ') || 'No items') + '</p>'
    + '<div class="btn-row"><button type="button" onclick="nextLootBox()">' + (lootOpeningIndex + 1 < lootOpening.length ? 'Next box' : 'Finish') + '</button></div>';
  modal.style.display = 'flex';
  (box.items || []).forEach(function (item) {
    try { window.DCC.addLootItem(typeof item === 'string' ? { name: item } : item, item.qty || 1); } catch (e) {}
  });
  try { window.DCC.saveNow(); } catch (e) {}
  await sb.from('loot_boxes').update({ status: 'opened' }).eq('id', box.id);
}
async function nextLootBox() {
  lootOpeningIndex++;
  revealLootBox();
}
