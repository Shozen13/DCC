# Merged sheet — build report

One character sheet app with ALL features of both existing sheets. Local
build only: nothing here has been pushed to GitHub and no live site has
been touched. A human reviews this directory and approves any push
separately. A pre-merge copy of both sources is kept in
`~/workspace/backups/pre-merge-2026-11-03/` in case the merge is reversed.

## Sources

- **Base architecture: the new sheet at v=15** (`~/workspace/new-crawler-sheet/`,
  copied verbatim as the starting point, then modified): modular vanilla
  HTML/CSS/JS, no build step, no paid APIs. Local save key `dcc-sheet-v2`.
- **Features ported from the original sheet** (`~/workspace/crawler-rpg/index.html`,
  single 503 KB file, live head `afcc278b`, read-only): Supabase cloud
  layer, loot/achievements, book lock, original-format JSON, header
  counters, stat bank, hotlist-in-Vitals. The original's Supabase SQL files
  are copied under `supabase/` for reference (the project already has
  schema + fix1 + fix2 + realtime + leave + loot v1–v3 applied).

## What was built

- `index.html` — new-sheet shell plus: preserved title/favicon/banner/
  scrolling background (below), Campaign / DM Dashboard / Send Box /
  Send Achievement / Loot Boxes / Achievements tabs and panels, start
  screen overlay, loot + achievement popups, Supabase CDN script.
- `css/style.css` — v=15 pearlescent theme untouched except additions:
  scrolling-background rules, banner sizing, DM-mode tab/panel hiding,
  cloud rows, modal overlays, DM item groups.
- `js/app.js` — new sheet, plus five small hooks only: `saveNow` calls
  `Cloud.onLocalSave` (cloud autosave); `showTab` enforces the original's
  tab guards (DM-only tabs fall back to Vitals for non-DMs; in DM mode
  every character-sheet tab falls back to the DM Dashboard) and calls
  `Cloud.onTabShown` (per-tab refreshes); Start screen button opens the
  cloud start screen; `window.DCC` gains `baseTotal`, `syncGearGrants`,
  `ensureUnarmed`, `addLootItem`; full book lock in `cardHtml`
  (below); original-format import/export wiring.
- `js/cloud.js` (new, ~1,150 lines) — the whole ported cloud layer,
  kept isolated here: auth, start screen, cloud save/load/delete,
  campaigns, parties, DM tools, DM dashboard, realtime, loot boxes,
  achievements, DM send forms, gold hints, sounds. Classic script with
  global functions so the ported markup can call them with `onclick`,
  exactly as the original did.
- `js/convert.js` (new) — pure original-format <-> merged-state
  conversion, usable in browser and node.
- `js/rules.js`, `js/wizard.js` — unchanged except one wizard hook:
  finishing (or skipping) the wizard calls `Cloud.onWizardFinished`.
- `data/book_checks.json` — copy of the original's
  `book_check_derivation.json` (168 entries).
- Assets fetched read-only from the Shozen13/DCC repo root:
  `DCC_Banner.png` (83,596 B), `Zev_icon.png` (11,577 B),
  `DCC_GN_Cover.jpg` (233,480 B), `DCC_Cover.jpg` (340,683 B),
  `DCC_Cover_0.jpg` (406,827 B), `new_achievement.mp3` (42,675 B),
  `sultrynewachievement.mp3` (57,124 B). The mp3 sizes match the known
  repo sizes exactly.
- `tests/test_convert.js`, `tests/test_bookchecks.js` (new) alongside
  the existing `tests/test_rules.js`.

## Design decisions (as specified)

- **Rank model: the NEW recomputed model everywhere.** Displayed rank =
  `ownRank + gear + race/class + group`, recomputed from live records on
  every render. The original's in-place rank bookkeeping
  (`gearGrants`/`groupBonus`/`raceClassSkillApplied` deltas) is NOT used
  for display. No old saves are migrated: the user recreates characters.
  The merged save shape is the new sheet's state shape; old
  original-format saves are not required to load as local/cloud saves.
- **Supabase: only the publishable key from the original sheet is
  embedded** (in `js/cloud.js`; it is designed to ship in client code).
  No service_role/secret key and no database password is used, stored,
  or reproduced anywhere in this build. Project: "Dungeon Crawler World
  - Earth". Table/column/RPC names are unchanged
  (`characters`, `campaigns`, `campaign_characters`, `parties`,
  `party_members`, `loot_boxes`, `join_campaign_by_code`,
  `party_roster`, `leave_campaign_by_character`).
- **Wizard vs creation prompt: the wizard wins.** Fresh/guest characters
  use the new sheet's guided wizard (via the existing gateway). A
  signed-in player with no existing crawler gets the wizard directly
  (not a blocking modal); when the wizard finishes or is skipped,
  `onWizardFinished` saves the fresh character to the cloud if the
  pending-create flag is set. DM login and players with existing
  crawlers never get a creation prompt: DM goes to the DM Dashboard,
  one crawler auto-loads silently, several crawlers go to the Campaign
  tab to pick. Returning players on reload see their local sheet (as in
  the original); auto-load runs only right after a player login.
- **Cloud loads do not reload the page.** The original reloaded after
  every cloud load; the merged app swaps state live via
  `DCC.setState` + `renderAll` (same visible result, no lost UI state).
  Remote realtime updates apply the same way, guarded by the original's
  `applyingRemote` flag and own-autosave echo suppression.

## Ported behaviour, item by item

- Start screen: signed-out sets (Continue as Guest, Sign up, Log in as
  Player, Log in as DM, plus Back to sheet when a mode is set);
  signed-in sets (Continue as Player / Continue as DM / Sign out, or
  Switch to the other view / Sign out). Guest is a standalone sheet.
- Cloud Save / Save as new / Load (with replace confirm) / Delete
  (with confirm), My Crawlers list, Refresh.
- Campaigns: create (6-char code, 5 attempts on collision), join by
  code (saves first if no cloud character yet), select, list with
  DM/Member roles, campaign detail, My parties (name/level/HP slots,
  leader crown, leader rename input), DM tools in the Campaign tab
  (HP/mana ±1, buff/debuff add, party creation with tick boxes and
  base-total leader, party list with recalculate-leader and delete).
- Party leader: highest combined derived base total (own + positive
  race/class fixed + splits), computed in `cloud.js` from the member's
  stored state with the same parsing rules as the sheet; the party name
  is kept when the leader changes.
- DM Dashboard: DM campaigns with select, players with HP/mana,
  select-one-to-alter with HP/mana buttons and buff/debuff add,
  parties with crowned leaders, campaign delete.
- Campaign delete / leave: same confirms and messages as the original;
  leaving removes the crawler from the campaign and its parties but
  never deletes the crawler.
- Realtime: `postgres_changes` on `loot_boxes` INSERT (player inbox
  refresh + status line) and `characters` UPDATE (player's own row
  applied live; DM dashboard refresh). Player autosave debounced
  800 ms, only in player mode with a cloud character loaded.
- Loot Boxes: waiting list in grade order (Bronze → Celestial), Open
  all boxes popup one at a time with Next/Finish, sound clip playback,
  items added to Inventory (one item per quantity unit, bonuses mapped
  onto the merged item shape, max 5), box marked opened, then the
  unviewed-achievement check runs.
- Send Box / Send Achievement: multi-player checkboxes, rulebook item
  picker (grouped by source, from the same items data), item name /
  description / quantity-per-player, up to 5 bonuses per item
  (stat / skill grant / DR / evade, with the stat-vs-skill field
  visibility rule), gold roll hint per grade (Bronze 1d10, Silver
  1d10×100, Gold 1d6×1,000, Platinum 2d6×1,000, Legendary 1d10×10,000,
  Celestial no gold — "almost always", roll on open, never auto-added).
- Achievements: player list (newest first, NEW badge while unviewed),
  message-only "No loot box" achievements land directly as opened
  rows; unviewed popup with Got it (marks viewed, plays a no-box
  sound if one was chosen).
- Book lock: a matching Chapter 4 card shows its book stat disabled;
  a no-stat Passive shows a disabled dash; the check select is
  disabled where the derivation has one (114/168 entries) and stays
  editable for the other 54; custom names stay editable; rulebook
  boxes show the derived book check; a no-stat Passive counts no stat
  mod on rolls; fresh rulebook picks start with the derived check.
- JSON: Export Crawler (merged `dcc-sheet-v2` format, unchanged) plus
  Export original format (`crawler-sheet` v1). Import accepts both:
  original-format files are converted (see `js/convert.js`); merged
  files load as before; invalid files change nothing.
- Header counters / stat bank / hotlist-in-Vitals: unchanged from the
  new sheet (which already had all three); counters stay solid yellow.

## Verification (no live browser test was possible)

The browser host cannot reach VM localhost and this subagent cannot
operate a live browser, so nothing below is claimed as a live test.
What was actually run:

- `node --check` on all five JS files: pass.
- `node tests/test_rules.js`: 120 passed, 0 failed (unchanged).
- `node tests/test_convert.js`: 19 passed, 0 failed, including the
  Lifebringer example (stored 4 = trained 1 + fixed 2 + group 1, and
  back), gear-grant floors, over-grant clamping, choice-id mapping
  (split ids gain `-0`, grant ids identical), and a merged→original→
  merged rank round trip.
- `node tests/test_bookchecks.js`: 5 passed (168 entries, all names in
  the library, 114 locked / 54 editable, only the four check types).
- Static HTML/JS audit script: 246 element ids, no duplicates; every
  `$(...)` / `getElementById` id in app/cloud/wizard exists in
  `index.html` except `roll-toast`, which app.js creates dynamically
  (verified at its creation site); all 24 inline `onclick` handlers
  resolve to a defined function.
- Preserved-element greps (exact output):
  - `<title>Dungeon Crawler World - Earth</title>`
  - `<link rel="icon" type="image/png" href="Zev_icon.png">`
  - `<img src="DCC_Banner.png" alt="Dungeon Crawler Carl Roleplaying Game">`
  - `animation:scrollTrack 20s linear infinite` in `css/style.css`
    (plus `.bg-slider` / `#bgTrack` in `index.html`, images duplicated
    in `setupBackgroundSlider`, same as the original)
  - `.counters strong { color:var(--yellow); }` — counters solid yellow
  - `@property --pearl-x` + `pearl-x-shift` 8s animation on `body` —
    the uniform pearlescent wave is intact
  - `.panel` / `.main` centering rules untouched (panels centered in
    the main column; centering could not be visually confirmed without
    a browser — see below)

## Campaign tab optimizations (2026-11-03, ?v=25, built locally)

Antony asked for the Campaign tab optimizations. Built, all five:

1. **Show only the step you are on** (`renderCampaignLayout`): the
   tab is now grouped into Account / My Crawlers / Campaign-join /
   campaign-list sections plus a focus block (detail + parties + DM
   tools). Signed out, only Account shows. Signed in, crawlers +
   join + list show. With a campaign selected, the focus block moves
   to the top of the tab, above Account, and is hidden entirely when
   no campaign is selected (no more "Select a campaign above" noise).
   The long intro hint hides once signed in. Layout re-runs on
   auth/mode changes, every cloud refresh, campaign select/leave/
   delete, and whenever the Campaign tab itself is opened.
2. **Feedback where you clicked** (`cloudStatus(msg, section)`):
   separate status lines under Crawlers, under Join, under the
   campaign list, and at the top of the focus block. Save/load/
   delete messages go to Crawlers, create/join to Join, leave/delete
   to the campaign list, party/DM/buff actions to the focus block.
   Account and global auth messages still use the original top line.
3. **Auto-select the only campaign**: after the campaign list loads,
   a single campaign is selected automatically (same behaviour the
   DM dashboard already had for its first campaign). Two
   corrections to the original proposal, found while building: the
   crawler list already marked the loaded crawler ("(this sheet)")
   and loading already asked for confirmation, so those were left
   alone, not rebuilt.
4. **Join names the crawler**: the button now reads "Join campaign
   as <name>" (refreshed on tab open and every cloud refresh) with a
   hint when the sheet is not cloud-saved yet. Joining was NOT
   disabled for unsaved sheets, because `joinCampaign` already
   saves the sheet first when there is no cloud crawler — disabling
   it would have been a regression.
5. **One member list, one Leave**: DM party checkboxes now sit on
   the DM member rows themselves (with base totals), and the second
   member list under "create a party" is gone; `createParty` reads
   the same `.party-check` boxes unchanged. The duplicate "Leave
   this campaign (this crawler)" button in the campaign detail is
   removed — the campaign-list row's Leave is the same action with
   the same confirmation.

## Avatar upload via the ? box (2026-11-03, ?v=24, built locally)

Antony's report: no way to add a profile image — only "Remove
avatar" was visible. Root cause: the upload input existed, but its
only trigger was a bare "Avatar" label with no button styling (no
`.file-label` CSS at all), so it read as plain sidebar text and was
easy to miss entirely. Fix, exactly as asked: clicking the avatar
box — the "?" placeholder, or the image once one is set — now opens
the file picker (keyboard: Enter/Space on the focused box, which has
a "Click to upload an avatar" tooltip). The confusing bare label is
gone; the hidden file input and the existing upload handler are
unchanged, so the image still saves with the sheet and "Remove
avatar" clears it. The box keeps its flex-center layout, so the "?"
stays centered.

## Campaign creation hidden from players (2026-11-03, ?v=23, built locally)

Antony's correction: as a player he should not even see the "New
campaign name (DM only)" field. It was only ever a label — the old
code let any signed-in user create a campaign (it checked login, not
mode). Fix, two parts: (1) the field + Create button now live in
`#cloud-create-campaign-box`, hidden by CSS for every non-DM mode
(`body:not(.dm-mode)`), the same gating the DM-only tabs already use
— so players and guests never see it, and DMs do; (2)
`createCampaign` now refuses unless in DM mode, so the action is
blocked even if the controls were somehow shown. Join-with-a-code is
unchanged and stays visible to everyone.

## Campaign tab account section (2026-11-03, ?v=22, built locally)

Antony's report: signed in, yet the Campaign tab still showed Sign up
and Log in, and had no way to switch to DM mode. Root cause: the
Account block was static HTML — only the status hint text ever
changed with auth state — and the only Switch buttons lived in the
start-screen overlay (sidebar "Start screen"), which the Campaign tab
never pointed to. Fix: the Account section now renders by auth state
(`renderAccountSection`, called on session load, every auth change,
log out, and mode change). Signed out: email/password + Sign up /
Log in, as before. Signed in: those hide and the section shows
"Signed in as <email>" + a mode switch ("Switch to DM view", or
"Switch to Player view" in DM mode) + Log out. The switch runs the
same `chooseRole` path as the start screen's Switch button, so DM
switch shows the DM Dashboard tab set and Player switch runs the
existing player auto-load.

## Kill dedup, Level/Floor buttons, stat totals, condensed marks (2026-11-03, ?v=21, built locally)

1. **Kills no longer duplicated in Trackers.** Boss/Player Kills inputs
   and their buttons are removed from the Vitals Trackers grid; the
   sidebar profile rows next to the name are now the only kill
   controls (the header strip still shows the plain numbers, as
   before — that is the persistent header, not the Trackers section).
2. **Level/Floor −/+ buttons in the sidebar**, same clamps as typing
   (Level 1–250, Floor 1+). Level taps bank points by the book rule
   automatically: Stat Bank = (Level−1)×3 − spent, so +1 Level = +3
   banked, spendable in the existing Distribute dialog. No separate
   level-up flow was added; the buttons reuse the typed-input rules.
3. **Stat Total/Modifier directly under the stat name** on each stat
   card (order now: name, Total/Modifier, Base input, Derived Base,
   Enhance, Gear/Race, penalty).
4. **Condensed kill marks in the sidebar rows.** Every 5 marks combine
   into one bigger shining mark: big = floor(n/5), small = n%5. Player
   kills: big skull shining red, small skull white — 23 kills shows a
   big red skull ×4 and a small white skull ×3. Boss kills: big star
   glowing gold, small star yellow — 47 kills shows a big glowing star
   ×9 and a small yellow star ×2. Zero still shows "No marks"/"No
   stars"; exactly 5 shows one big mark and no small one.

## Profile crawler number (2026-11-03, ?v=20, built locally)

Under the name in the sidebar profile header, a "Crawler #N" line from
the sheet's Number field (a leading "#" in the field is stripped, so
"#1" and "1" both display as "Crawler #1"; blank sheets show
"Crawler #—"). Order under the name: name, Crawler #N, then the
Race • Class • Floor line.

## Profile class line (2026-11-03, ?v=19, built locally)

Antony's correction to the v18 profile header: the line under the name
now reads "Race • Class • Floor N", with "Unassigned" when no class is
picked (e.g. "Human • Unassigned • Floor 1" on his current sheet, and
"— • Unassigned • Floor 1" on a blank sheet). Race still shows "—"
when none is picked.

## Profile + readability pass (2026-11-03, ?v=18, built locally)

From Antony's screenshots of his sheet vs CrawlerCo:

1. **Skills/Spells cards are collapsible, collapsed by default.** Each
   card is now a `<details>` element whose summary shows name + rank
   (+ Used); expanding reveals the rank/stat/check controls, Roll,
   notes, and Rulebook box. A card the user opens stays open across
   reloads (`state.cardOpen`, saved on toggle, no re-render mid-toggle).
2. **Stat card Total/Modifier are prominent.** The Total/Modifier line
   moved up to directly under Derived Base (it used to sit last, like a
   footnote) and renders at 1.3rem with the numbers in solid yellow.
3. **Evade/DR formulas in words, under the values.** Evade and DR now
   have their own formula line beneath the value, e.g. "Evade = d20 +
   1d4 (Race/Class) + DEX modifier (+2) + Buffs (+0)" and "Damage
   Resistance = Armor (3) + Buffs (+0) + Race/Class (+0)", in normal
   text size instead of the old muted inline sub-text.
4. **Mana is a bar.** A teal fill bar under the "X / Y Mana" text,
   width = current/max; the numerical text is unchanged.
5. **Sidebar profile closer to CrawlerCo.** The sidebar now opens with
   avatar beside a large uppercase name and a "Race • Floor N" line
   (e.g. "Human • Floor 1"), followed by Player Killer and Boss Kills
   rows with −/count/+ and "No marks"/"No stars" text at zero (the same
   kill state as the Vitals Trackers buttons, not a second copy of it).
   Name/Number/Level/Floor inputs and Race/Class pickers stay below, as
   before. Rest buttons were deliberately NOT duplicated into the
   sidebar — they already live in the Vitals Rest section.

## Post-launch fix (2026-11-03, ?v=17, built locally)

Three reports from live use of the merged site, all fixed here:

1. **Background ranks are now a true given floor.** Root cause: the wizard
   stored the background rank inside `ownRank` and `cardRank`/`cardFloor`
   ignored `backgroundRank`, so a background skill, Unarmed Combat Rank 3,
   or a combat weapon/spell Rank 3 could be lowered to 1. Fix: `rules.js`
   rank functions take a fifth `backgroundGiven` amount; `app.js` supplies
   it from `card.backgroundRank`; the wizard now creates background cards
   split (`ownRank` = trained only, `backgroundRank` = given); `loadSaved`
   runs the one-time idempotent `splitBackgroundRank` migration, which
   also repairs cards already lowered below their given rank (ownRank 1 +
   backgroundRank 3 displays 3 again). Cards show "(Background +N in
   rank)" and the delete guard mentions backgrounds. Tests: 130 passed
   (10 new background assertions).
2. **Boss/Player Kills get −/+ buttons.** The number inputs already
   existed in Vitals Trackers but were buried below Dice/Buffs and
   typing-only. Trackers now has −/+ buttons (`DCC.killDelta`) that
   clamp at 0, update the header counters, and save; the number input
   stays for corrections.
3. **Bio shows the creation background.** The Bio tab now renders the
   wizard record (`state.backgrounds`): Childhood/Adolescence/Career/
   Hobby background name + the two skills picked + starting rank
   (1/1/3/2), and the combat choice (Unarmed Combat Rank 3 + any
   weapon/spell Rank 3). Sheets with no wizard record show a note
   instead. Backgrounds data has no prose descriptions in the book
   extraction, so the record is names + skills + ranks, not flavour text.
4. **Race/class benefits missing on fresh load (Human +2).** Root cause:
   race/class benefits are derived from the library, but `renderAll`
   never loaded the library — it was only fetched when a picker was
   opened. So on a fresh load of a sheet whose race was already Human,
   `findRaceClass` returned null and every derived benefit (fixed
   stats, DR, Evade dice, Choices) silently computed as zero. The
   original sheet could never do this because its library was embedded
   in the single file. Fix: `renderAll` now lazy-loads the races file
   on first render and re-renders when it arrives, mirroring the
   existing keywords pattern. Verified at logic level: Human parses to
   +2 all stats and derived Base adds it (own 4 → derived 6).

## Known-unfinished / uncertain (human review should cover these)

1. **No live test has been run.** The app cannot be verified in a
   browser from this environment. Before any push, a live pass must
   check: start-screen sets, guest flow, player login + auto-load (0 /
   1 / many crawlers), wizard → cloud create, DM dashboard, party
   creation + leader + rename, DM HP/mana/buff edits appearing on the
   player sheet, loot popup order + sounds, achievement popup + NEW
   badge, book-lock selects, both export formats, and panel centering.
   The first load after a push may serve the previous build (Pages lag
   ran ~3–4 min on recent pushes); reload after a wait before calling
   anything failed.
2. **DM buff/debuff shape changed deliberately.** The original pushed
   `{name, notes}` objects into a member's buffs/debuffs; the merged
   sheet renders buffs as plain name strings, so `dmAddCondition`
   pushes the name string. A member's old `{name, notes}` buff entries
   from the original sheet would render as "[object Object]" if such a
   cloud character were loaded — but old saves are not loaded by
   design (characters are recreated), so this only matters if someone
   hand-imports an original cloud row.
3. **Original-format conversion is best-effort, not lossless.**
   Dropped on original-format export: backgrounds, story tabs
   (quests/journal/pets/mounts/sponsors/faith/crafting/bio), and
   hotlist selection state (values are carried as a name list on
   import; `hotlistState` exports as `{}`). `ownRankBefore` on export
   is set to the card's current ownRank. Imported original cards keep
   their displayed ranks exactly (ownRank = rank − gear − race −
   group floors, with givens re-applied from carried-over applied
   records), but a card whose original side records were already
   wrong will import with that error baked into ownRank.
4. **Two behaviour changes vs the original, both intentional:** cloud
   loads swap state live instead of reloading the page; and the
   start screen appears on first load when no mode is set (the new
   sheet showed the gateway instead) — the gateway is still reachable
   via New / Import, and Guest with no saved sheet still lands on it.
5. **Subresource versions stay `?v=15`** (same as the v=15 base) for
   all scripts including the new `cloud.js`/`convert.js`. Bump on the
   first real release push if the reviewer wants cache separation from
   the new sheet's v=15.
6. **DM-mode tab set mirrors the original exactly** (DM sees only
   campaign / DM / send / achievements tabs plus choices; loot is
   hidden in DM mode, as in the original). If the reviewer wants DMs
   to see Loot Boxes too, that is a one-line CSS + guard change.
