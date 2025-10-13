// ==UserScript==
// @name         MH MM
// @namespace    http://tampermonkey.net/
// @version      0.1.0
// @description  Mapping Manager (userscript) overlay UI
// @match        https://www.mousehuntgame.com/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

const APP_TITLE = "MH MM";
const PRICE_STEP = 5;
const THANKYOU_TEXT = "Invited and paid, Thank you!";
const DEFAULT_SEARCH_PREFIX = "in:\n map-snipers";
const DEFAULT_MESSAGE_FORMATS = ["<name>: <price>", "<name> <price>", "<name> - <price>"];
const DEFAULT_THANKYOU_MESSAGES = [{ text: THANKYOU_TEXT, enabled: true }];
const DEFAULT_TOGGLE_HOTKEY = "Space";
const HELP_TEXT = `
[Panel toggle shortcut] Press Space (default shortcut) on a non-interactive area to open/close the panel (autoscroll suppressed). Alt + Middle-click forces toggle anywhere, including inside the panel and on buttons/inputs.

[Panel toggle hotkey] You can change the shortcut under User settings → Panel toggle shortcut.
[Detect Map] Visit MouseHunt → Map → Active Maps so the goals list is visible, then click “Detect Map” in this panel. Review the preview window and press “Apply to nodes” to sync Need/Completed flags automatically.
To keep things simple, this version removes a few features.

Mousehunt Mapping Manager (Tampermonkey Web extension version) — User Guide

I. Layout
1) Left “Nodes”: Tree of Region / Subgroup / Enemy with columns: Name / Snipe? / Need? / Done? / Price.
2) Middle-left “Controls + Edit selected + Stats”:
   - Controls: Basic settings and common actions.
   - Edit selected: Edit the selected node’s properties.
   - Stats: Six totals (sum of values).
3) Right two columns:
   - Generated market message: Auto list of targets that require sniping (Need=✓, Requires Snipe=✓, Completed=✗).
   - Todo List: Self-do targets (Need=✓, Requires Snipe=✗, Completed=✗, Price>0).

II. Files & Save
- Import: Load a .json setup (ideally exported from the Python version).
- Export: Save the current setup to a .json file.
- Save: Persist the current snapshot in the browser (most actions also auto-save).
- Undo / Redo: Step backward / forward through recent edits.
- The last filename is remembered inside the extension.

III. Controls
- LF message: First line used when generating LF text.
- Right click search prefix: Prefix copied when you right-click (or middle-click / Ctrl+click) an item in the message list.
- User settings: Configure LF message, right-click search prefix, manage thank-you messages (with multiple options), choose market message formats, toggle sound effects, enable auto-rounding of copied prices, and remap the panel toggle shortcut.
- User Guide: Open this help window.
- Reset run: Clear the Completed checkbox for all items (no other fields are changed).
- Generate LF message: Build the LF list and auto-copy the first 10 lines to the clipboard.
- Copy: Copy the current generated result again (first 10 lines).
- Increase/Decrease unsniped price: Batch price adjust (see Section VI).

IV. Editing Nodes
1) Selecting & Quick toggles:
   - Click a row in the tree to select; the “Edit selected” panel shows that node’s details.
   - Click the “Snipe?” or “Need?” cell directly to toggle ✓ / empty. Changes auto-save and refresh stats/lists.
2) Fields in “Edit selected”:
   - Name: Display name.
   - Override: Alternate display name (used in LF if provided).
   - Need / Completed / Requires Snipe: Three checkboxes controlling inclusion, completion, and sniping.
   - Price: Numeric value (use − / + to nudge).
   - Side notes: Optional notes.
   - Apply: Apply edits to the current node and save.
3) Structure operations (Nodes toolbar):
   - + Region / + Subgroup / + Enemy: Add nodes.
   - Delete: Remove the selected node (and its children).

V. Two Lists
1) Generated market message
   - Inclusion: Need=✓ AND Requires Snipe=✓ AND Completed=✗.
   - Sorting: Price desc, then name asc.
   - Hover: Show details tooltip (region, subgroup, type, notes).
   - Right-click / Middle-click / Ctrl+click: Copy “search prefix + first word of display name/override” for market search.
   - Double-click: Mark as Completed and auto-copy the Thank-you message.
2) Todo List
   - Inclusion: Need=✓ AND Requires Snipe=✗ AND Completed=✗ AND Price>0.
   - Double-click: Mark as Completed and auto-copy the Thank-you message.

VI. Batch Price Rules (aligned with Python)
- Applies to items with Need=✓ AND Requires Snipe=✓ AND Completed=✗ only.
- Increase steps: Price>100 → +5; 50<Price<100 → +3; 5<Price<50 → +2.
- Decrease steps: Price>100 → −5; 50<Price<100 → −3; 5<Price<50 → −2.
- After execution the list and stats refresh and changes are saved.

VII. Stats (six totals)
- All required targets: Sum of Need=✓.
- All snipe targets: Sum of Need=✓ & Requires Snipe=✓.
- All self targets: Sum of Need=✓ & Requires Snipe=✗.
- Remaining targets: Sum of Need=✓ & Completed=✗.
- Remaining snipe targets: Sum of Need=✓ & Requires Snipe=✓ & Completed=✗.
- Remaining self targets: Sum of Need=✓ & Requires Snipe=✗ & Completed=✗.

VIII. Tips
- Generating LF auto-copies the first 10 lines; for longer outputs, generate in parts or copy manually.
- Any state change (including double-click complete, batch price, Apply) refreshes stats and auto-saves.
- Use the userscript menu to quickly toggle the panel or open this guide.
(Press ESC to close this window.)

Author: InterfaceGu — Latest releases: https://github.com/Pyrefall/MappingManager
`;


const GM_KEYS = {
  LAST_SNAPSHOT: "mhmm:last_snapshot",
  LAST_FILENAME: "mhmm:last_filename",
  PANEL_VISIBLE: "mhmm:panel_visible",
  SOUND_ENABLED: "mhmm:sound_enabled",
  TOGGLE_HOTKEY: "mhmm:toggle_hotkey"
};

const ui = {};

function isGroupType(nodeType){
  return nodeType === "region" || nodeType === "subgroup";
}

const HOTKEY_KEY_ALIASES = {
  space: "Space",
  spacebar: "Space",
  esc: "Escape",
  escape: "Escape",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  insert: "Insert",
  ins: "Insert",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pgup: "PageUp",
  pagedown: "PageDown",
  pgdn: "PageDown",
  arrowup: "ArrowUp",
  up: "ArrowUp",
  arrowdown: "ArrowDown",
  down: "ArrowDown",
  arrowleft: "ArrowLeft",
  left: "ArrowLeft",
  arrowright: "ArrowRight",
  right: "ArrowRight",
  capslock: "CapsLock",
  numlock: "NumLock",
  scrolllock: "ScrollLock",
  pause: "Pause",
  break: "Pause",
  printscreen: "PrintScreen",
  contextmenu: "ContextMenu",
  apps: "ContextMenu"
};

function isModifierToken(token){
  const lower = token.toLowerCase();
  return (
    lower === "ctrl" ||
    lower === "control" ||
    lower === "shift" ||
    lower === "alt" ||
    lower === "meta" ||
    lower === "cmd" ||
    lower === "command" ||
    lower === "win"
  );
}

function normalizeKeyToken(token){
  if(!token) return "";
  const trimmed = token.trim();
  if(!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if(HOTKEY_KEY_ALIASES[lower]) return HOTKEY_KEY_ALIASES[lower];
  if(/^f\d{1,2}$/i.test(trimmed)) return trimmed.toUpperCase();
  if(trimmed.length === 1){
    if(/[a-z]/i.test(trimmed)) return trimmed.toUpperCase();
    return trimmed;
  }
  if(/^\d$/.test(trimmed)) return trimmed;
  // Preserve camel-case arrow names etc.
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function parseHotkeyString(str){
  if(str == null) return { valid: false };
  const raw = String(str).trim();
  if(!raw) return { valid: false };
  if(raw.toLowerCase() === "mousemiddle") return { valid: true, special: "MouseMiddle" };
  const parts = raw.split("+").map((p)=>p.trim()).filter(Boolean);
  if(!parts.length) return { valid: false };
  let ctrl=false, alt=false, shift=false, meta=false;
  let key=null;
  for(const part of parts){
    const lower = part.toLowerCase();
    if(lower === "ctrl" || lower === "control"){ ctrl = true; continue; }
    if(lower === "shift"){ shift = true; continue; }
    if(lower === "alt"){ alt = true; continue; }
    if(lower === "meta" || lower === "cmd" || lower === "command" || lower === "win"){ meta = true; continue; }
    const normalizedKey = normalizeKeyToken(part);
    if(!normalizedKey) return { valid:false };
    if(isModifierToken(normalizedKey)) return { valid:false };
    if(key) return { valid:false };
    key = normalizedKey;
  }
  if(!key) return { valid:false };
  return { valid:true, ctrl, alt, shift, meta, key };
}

function normalizeHotkeyString(str){
  if(str == null) return DEFAULT_TOGGLE_HOTKEY;
  const raw = String(str).trim();
  if(!raw) return DEFAULT_TOGGLE_HOTKEY;
  const parsed = parseHotkeyString(raw);
  if(!parsed.valid){
    return null;
  }
  if(parsed.special === "MouseMiddle") return "MouseMiddle";
  const parts = [];
  if(parsed.ctrl) parts.push("Ctrl");
  if(parsed.alt) parts.push("Alt");
  if(parsed.shift) parts.push("Shift");
  if(parsed.meta) parts.push("Meta");
  parts.push(parsed.key);
  return parts.join("+");
}

function normalizeEventKey(key){
  if(!key) return "";
  if(key === " ") key = "Space";
  const trimmed = key.trim();
  if(!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if(HOTKEY_KEY_ALIASES[lower]) return HOTKEY_KEY_ALIASES[lower];
  if(/^f\d{1,2}$/i.test(trimmed)) return trimmed.toUpperCase();
  if(trimmed.length === 1){
    if(/[a-z]/i.test(trimmed)) return trimmed.toUpperCase();
    return trimmed;
  }
  return trimmed;
}

function hotkeyFromEvent(event){
  if(!event || typeof event.key === "undefined") return null;
  const keyName = normalizeEventKey(event.key);
  if(!keyName || isModifierToken(keyName)) return null;
  const parts = [];
  if(event.ctrlKey) parts.push("Ctrl");
  if(event.altKey) parts.push("Alt");
  if(event.shiftKey) parts.push("Shift");
  if(event.metaKey) parts.push("Meta");
  parts.push(keyName);
  return parts.join("+");
}

function eventMatchesStoredHotkey(event, stored){
  if(!stored || stored === "MouseMiddle") return false;
  const parsed = parseHotkeyString(stored);
  if(!parsed.valid || parsed.special === "MouseMiddle") return false;
  const keyName = normalizeEventKey(event.key);
  if(!keyName) return false;
  if(event.ctrlKey !== !!parsed.ctrl) return false;
  if(event.altKey !== !!parsed.alt) return false;
  if(event.shiftKey !== !!parsed.shift) return false;
  if(event.metaKey !== !!parsed.meta) return false;
  return keyName === parsed.key;
}

function ensureNodeDefaults(node){
  if(!node || typeof node !== "object") return;
  if(!node.id) node.id = uuid();
  if(!Array.isArray(node.children)) node.children = [];
  if(isGroupType(node.type)){
    if(node.must_contains_all === undefined) node.must_contains_all = true;
    if(node.auto_collapse === undefined) node.auto_collapse = false;
    if(!App.collapseState[node.id] && App.collapseState[node.id] !== false){
      App.collapseState[node.id] = !!node.auto_collapse;
    }
  }else if(node.id && App.collapseState[node.id] !== undefined){
    delete App.collapseState[node.id];
  }
  node.children.forEach(ensureNodeDefaults);
}

function ensureTreeDefaults(listNodes){
  (listNodes || []).forEach(ensureNodeDefaults);
}

function getNodeCollapseState(node){
  if(!node || !isGroupType(node.type)) return false;
  if(App.collapseState[node.id] === undefined){
    App.collapseState[node.id] = !!node.auto_collapse;
  }
  return !!App.collapseState[node.id];
}

function setNodeCollapseState(nodeId, collapsed){
  if(!nodeId) return;
  App.collapseState[nodeId] = !!collapsed;
}

function registerCollapseStateFor(node){
  ensureNodeDefaults(node);
  if(node && node.id && isGroupType(node.type)){
    App.collapseState[node.id] = !!node.auto_collapse;
  }
}

function pruneCollapseStateFor(node){
  if(!node || typeof node !== "object") return;
  if(node.id) delete App.collapseState[node.id];
  (node.children || []).forEach(pruneCollapseStateFor);
}

function uuid(){
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c=>{
    const r = Math.random()*16|0, v = c==="x"? r : (r&0x3|0x8);
    return v.toString(16);
  });
}
function deepClone(o){ return JSON.parse(JSON.stringify(o)); }
function preorderIter(listNodes){
  const out = [];
  (function visit(nodes){
    for(const n of (nodes||[])){
      out.push(n);
      if(n.children && n.children.length) visit(n.children);
    }
  })(listNodes||[]);
  return out;
}

function detectMapFromPage(){
  const anchors = document.querySelectorAll('.treasureMapView-goals-group-goal');
  if (!anchors.length) {
    return null;
  }
  const missing = [];
  const found = [];
  anchors.forEach(anchor => {
    const nameNode = anchor.querySelector('.treasureMapView-goals-group-goal-name span');
    const name = nameNode ? nameNode.textContent.trim() : '';
    if (!name) {
      return;
    }
    if (anchor.classList.contains('complete')) {
      found.push(name);
    } else {
      missing.push(name);
    }
  });
  if (!missing.length && !found.length) {
    return null;
  }
  return { missing, found };
}

function onDetectFromPage(){
  try {
    const result = detectMapFromPage();
    if (!result) {
      alert('Unable to detect map status on this page. Click the “Map” button (main page, between “Friends” and “Kingdom”), then open the “Active Maps” view to use this feature.');
      return;
    }
    handleDetectedGoals(result);
  } catch (err) {
    console.error('Detect map failed', err);
    alert('An error occurred while detecting the map goals. Check the console for details.');
  }
}

function handleDetectedGoals(res){
  const catalog = preorderIter(App.data.regions).
    filter(n => n.type === 'enemy' || n.type === 'subgroup' || n.type === 'region');
  const missingMatches = [];
  const missingUnmatched = [];
  const foundMatches = [];
  const foundUnmatched = [];

  (res.missing || []).forEach(name => {
    const match = findBestMatch(name, catalog);
    if (match) {
      missingMatches.push({ source: name, target: match });
    } else {
      missingUnmatched.push(name);
    }
  });

  (res.found || []).forEach(name => {
    const match = findBestMatch(name, catalog);
    if (match) {
      foundMatches.push({ source: name, target: match });
    } else {
      foundUnmatched.push(name);
    }
  });

  if (!missingMatches.length && !missingUnmatched.length && !foundMatches.length && !foundUnmatched.length) {
    alert('No goals detected from the page.');
    return;
  }

  showDetectionModal({ missingMatches, missingUnmatched, foundMatches, foundUnmatched });
}

function showDetectionModal(groups){
  const existing = document.getElementById('mhmm-detect-modal');
  if (existing) existing.remove();

  const wrap = document.createElement('div');
  wrap.id = 'mhmm-detect-modal';
  wrap.className = 'mhmm-modal';
  wrap.innerHTML = `
    <div class="mhmm-modal-inner" role="dialog" aria-modal="true" aria-label="Detected Map Goals">
      <div class="mhmm-modal-head">
        <span>Detected Map Goals</span>
        <div class="mhmm-detect-controls">
          <button type="button" id="mhmm-detect-cancel">Cancel</button>
          <button type="button" id="mhmm-detect-confirm" class="mhmm-primary">Apply to nodes</button>
        </div>
      </div>
      <div class="mhmm-modal-body mhmm-detect-body">
        <div class="mhmm-detect-col">
          <div class="mhmm-detect-heading">Missing — unmatched</div>
          <div class="mhmm-detect-list" id="mhmm-detect-missing-unmatch"></div>
        </div>
        <div class="mhmm-detect-col">
          <div class="mhmm-detect-heading">Found — unmatched</div>
          <div class="mhmm-detect-list" id="mhmm-detect-found-unmatch"></div>
        </div>
        <div class="mhmm-detect-col">
          <div class="mhmm-detect-heading">Missing — matched</div>
          <div class="mhmm-detect-list" id="mhmm-detect-missing-match"></div>
        </div>
        <div class="mhmm-detect-col">
          <div class="mhmm-detect-heading">Found — matched</div>
          <div class="mhmm-detect-list" id="mhmm-detect-found-match"></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  populateDetectionList(
    wrap.querySelector('#mhmm-detect-missing-unmatch'),
    groups.missingUnmatched
  );
  populateDetectionList(
    wrap.querySelector('#mhmm-detect-found-unmatch'),
    groups.foundUnmatched
  );
  populateDetectionList(
    wrap.querySelector('#mhmm-detect-missing-match'),
    groups.missingMatches.map(item => `${item.source} → ${(item.target.name || '').trim()}`)
  );
  populateDetectionList(
    wrap.querySelector('#mhmm-detect-found-match'),
    groups.foundMatches.map(item => `${item.source} → ${(item.target.name || '').trim()}`)
  );

  wrap.addEventListener('click', (ev)=>{
    if (ev.target === wrap) wrap.remove();
  });
  const btnCancel = wrap.querySelector('#mhmm-detect-cancel');
  if (btnCancel) btnCancel.addEventListener('click', ()=> wrap.remove());
  wrap.querySelector('#mhmm-detect-confirm').addEventListener('click', ()=>{
    applyDetectionGroups(groups);
    wrap.remove();
  });
}

function populateDetectionList(el, items){
  el.innerHTML = '';
  if (!items || !items.length) {
    const empty = document.createElement('div');
    empty.className = 'mhmm-detect-empty';
    empty.textContent = '(none)';
    el.appendChild(empty);
    return;
  }
  items.forEach(text => {
    const div = document.createElement('div');
    div.className = 'mhmm-detect-item';
    div.textContent = text;
    el.appendChild(div);
  });
}

function applyDetectionGroups(groups){
  recordUndo();

  resetNeedAndCompleted();

  groups.missingMatches.forEach(({ target }) => {
    if (!target) return;
    target.include = true;
    target.completed = false;
  });

  groups.foundMatches.forEach(({ target }) => {
    if (!target) return;
    target.include = true;
    target.completed = true;
  });

  applyGroupRules();

  refreshTree();
  updateTodoList();
  onGenerateMessage(false);
  persistAuto();
  flashTitle('Detection applied');
}

function defaultThankyouMessages(){
  return DEFAULT_THANKYOU_MESSAGES.map((item)=> ({ text: item.text, enabled: item.enabled }));
}

function normalizeThankyouMessages(list){
  const normalized = [];
  if (Array.isArray(list)){
    list.forEach(entry => {
      let text = '';
      let enabled = true;
      if (typeof entry === 'string'){
        text = entry.trim();
      } else if (entry && typeof entry === 'object'){
        text = (entry.text || entry.message || '').trim();
        if (entry.enabled !== undefined) enabled = !!entry.enabled;
      }
      if (text && !normalized.some(item => item.text === text)){
        normalized.push({ text, enabled });
      }
    });
  }
  if (!normalized.length){
    return defaultThankyouMessages();
  }
  return normalized;
}

function getThankyouMessages(){
  App.data.thankyou_messages = normalizeThankyouMessages(App.data.thankyou_messages);
  return App.data.thankyou_messages;
}

function pickThankyouText(){
  const messages = getThankyouMessages();
  const enabled = messages.filter(item => item.enabled && item.text);
  const pool = enabled.length ? enabled : messages;
  const choice = pool[Math.floor(Math.random() * pool.length)];
  const text = choice && choice.text ? choice.text : THANKYOU_TEXT;
  App.data.thankyou_text = text;
  return text;
}

function normalizeMessageFormats(list){
  const seen = new Set();
  const normalized = [];
  if (Array.isArray(list)){
    list.forEach(entry => {
      let text = '';
      if (typeof entry === 'string'){
        text = entry.trim();
      } else if (entry && typeof entry === 'object'){
        text = (entry.text || '').trim();
      }
      if (text && text.includes('<name>') && text.includes('<price>') && !seen.has(text)){
        seen.add(text);
        normalized.push(text);
      }
    });
  }
  if (!normalized.length){
    DEFAULT_MESSAGE_FORMATS.forEach(text => {
      if (!seen.has(text)){
        seen.add(text);
        normalized.push(text);
      }
    });
  }
  return normalized;
}

function getMessageFormats(){
  App.data.message_formats = normalizeMessageFormats(App.data.message_formats);
  return App.data.message_formats;
}

function getSelectedMessageFormat(){
  const formats = getMessageFormats();
  let selected = App.data.selected_message_format;
  if (!selected || !formats.includes(selected)){
    selected = formats[0];
    App.data.selected_message_format = selected;
  }
  return selected;
}

function shouldAutoRoundPrices(){
  return !!App.data.auto_round_prices;
}

function roundPriceForCopy(price){
  let value = Number(price || 0);
  if (!Number.isFinite(value)) value = 0;
  value = Math.trunc(value);
  if (value < 5) return 5;
  const remainder = value % 5;
  if (remainder === 1 || remainder === 2) return value - remainder;
  if (remainder === 4) return value + (5 - remainder);
  return value;
}

function formatMessageLine(name, price, applyRound){
  const format = getSelectedMessageFormat() || DEFAULT_MESSAGE_FORMATS[0];
  const safeName = (name || '').trim();
  let safePrice = Number(price || 0);
  if (!Number.isFinite(safePrice)) safePrice = 0;
  if (applyRound) {
    safePrice = roundPriceForCopy(safePrice);
  }
  if (!format.includes('<name>') || !format.includes('<price>')){
    return `${safeName}: ${safePrice}`;
  }
  return format.replace(/<name>/g, safeName).replace(/<price>/g, String(safePrice));
}

function copyRandomThankyou(){
  const text = pickThankyouText();
  copyText(text);
  persistAuto();
  return text;
}

function showUserSettings(){
  const existing = document.getElementById('mhmm-settings-modal');
  if (existing) existing.remove();

  const wrap = document.createElement('div');
  wrap.id = 'mhmm-settings-modal';
  wrap.className = 'mhmm-modal';
  wrap.innerHTML = `
    <div class="mhmm-modal-inner mhmm-modal-settings" role="dialog" aria-modal="true" aria-label="User Settings">
      <div class="mhmm-modal-head">
        <span>User Settings</span>
        <div class="mhmm-detect-controls">
          <button type="button" id="mhmm-settings-cancel">Cancel</button>
          <button type="button" id="mhmm-settings-save" class="mhmm-primary">Save</button>
        </div>
      </div>
      <div class="mhmm-modal-body mhmm-settings-body">
        <div class="mhmm-settings-section">
          <div class="mhmm-settings-header">
            <span>Thank-you messages</span>
            <button type="button" id="mhmm-settings-add-thanks" class="mhmm-settings-add">Add message</button>
          </div>
          <div id="mhmm-settings-thanks-list" class="mhmm-settings-list"></div>
        </div>

        <div class="mhmm-settings-section">
          <div class="mhmm-settings-header">
            <span>Market message formats</span>
            <button type="button" id="mhmm-settings-add-format" class="mhmm-settings-add">Add format</button>
          </div>
          <div id="mhmm-settings-format-list" class="mhmm-settings-list"></div>
        </div>

        <div class="mhmm-settings-field">
          <label class="mhmm-small">LF message</label>
          <input id="mhmm-settings-intro" type="text" class="mhmm-input" />
        </div>

        <div class="mhmm-settings-field">
          <label class="mhmm-small">Right click search prefix</label>
          <input id="mhmm-settings-prefix" type="text" class="mhmm-input" />
        </div>

        <div class="mhmm-settings-field">
          <label class="mhmm-small">Sound effects</label>
          <label class="mhmm-inline-check"><input id="mhmm-settings-sound" type="checkbox" /> Enable notification sounds</label>
        </div>

        <div class="mhmm-settings-field">
          <label class="mhmm-small">Copied price rounding</label>
          <label class="mhmm-inline-check"><input id="mhmm-settings-round" type="checkbox" /> Auto-round copied prices</label>
        </div>

        <div class="mhmm-settings-field">
          <label class="mhmm-small">Panel toggle shortcut</label>
          <div class="mhmm-settings-row">
            <input id="mhmm-settings-hotkey" type="text" class="mhmm-input" placeholder="Space" />
            <button type="button" id="mhmm-settings-hotkey-record">Record</button>
            <button type="button" id="mhmm-settings-hotkey-clear">Clear</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  const introInput = wrap.querySelector('#mhmm-settings-intro');
  const prefixInput = wrap.querySelector('#mhmm-settings-prefix');
  const soundToggle = wrap.querySelector('#mhmm-settings-sound');
  const roundToggle = wrap.querySelector('#mhmm-settings-round');
  const hotkeyInput = wrap.querySelector('#mhmm-settings-hotkey');
  const hotkeyRecordBtn = wrap.querySelector('#mhmm-settings-hotkey-record');
  const hotkeyClearBtn = wrap.querySelector('#mhmm-settings-hotkey-clear');
  introInput.value = App.data.intro_line || '';
  prefixInput.value = App.data.search_prefix || DEFAULT_SEARCH_PREFIX;
  if(soundToggle) soundToggle.checked = App.soundEnabled;
  if(roundToggle) roundToggle.checked = shouldAutoRoundPrices();
  if(hotkeyInput){
    hotkeyInput.value = App.toggleHotkey || DEFAULT_TOGGLE_HOTKEY;
  }

  const thanksListEl = wrap.querySelector('#mhmm-settings-thanks-list');
  const addThanksBtn = wrap.querySelector('#mhmm-settings-add-thanks');
  const formatListEl = wrap.querySelector('#mhmm-settings-format-list');
  const addFormatBtn = wrap.querySelector('#mhmm-settings-add-format');

  let thanksState = getThankyouMessages().map(item => ({ id: uuid(), text: item.text || '', enabled: !!item.enabled }));
  if (!thanksState.length) {
    thanksState = defaultThankyouMessages().map(item => ({ id: uuid(), text: item.text, enabled: !!item.enabled }));
  }

  let formatState = getMessageFormats().map(text => ({ id: uuid(), text }));
  if (!formatState.length) {
    formatState = DEFAULT_MESSAGE_FORMATS.map(text => ({ id: uuid(), text }));
  }
  let selectedFormatId = (() => {
    const selectedText = getSelectedMessageFormat();
    const match = formatState.find(entry => entry.text === selectedText);
    return match ? match.id : formatState[0].id;
  })();

  function renderThanks(){
    if (!thanksState.length) {
      thanksState.push({ id: uuid(), text: '', enabled: true });
    }
    thanksListEl.innerHTML = '';
    thanksState.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'mhmm-settings-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = item.enabled;
      checkbox.addEventListener('change', () => { item.enabled = checkbox.checked; });

      const input = document.createElement('input');
      input.type = 'text';
      input.value = item.text;
      input.placeholder = 'Thank-you message';
      input.className = 'mhmm-input';
      input.addEventListener('input', () => { item.text = input.value; });

      const del = document.createElement('button');
      del.textContent = 'Delete';
      del.type = 'button';
      del.disabled = thanksState.length <= 1;
      del.addEventListener('click', () => {
        if (thanksState.length <= 1) return;
        thanksState = thanksState.filter(entry => entry.id !== item.id);
        renderThanks();
      });

      row.append(checkbox, input, del);
      thanksListEl.appendChild(row);
    });
  }

  function renderFormats(){
    if (!formatState.length) {
      formatState.push({ id: uuid(), text: DEFAULT_MESSAGE_FORMATS[0] });
      selectedFormatId = formatState[0].id;
    }
    formatListEl.innerHTML = '';
    formatState.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'mhmm-settings-row';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'mhmm-settings-format';
      radio.checked = (item.id === selectedFormatId);
      radio.addEventListener('change', () => {
        selectedFormatId = item.id;
      });

      const input = document.createElement('input');
      input.type = 'text';
      input.value = item.text;
      input.placeholder = '<name>: <price>';
      input.className = 'mhmm-input';
      input.addEventListener('input', () => { item.text = input.value; });

      const del = document.createElement('button');
      del.textContent = 'Delete';
      del.type = 'button';
      del.disabled = formatState.length <= 1;
      del.addEventListener('click', () => {
        if (formatState.length <= 1) return;
        formatState = formatState.filter(entry => entry.id !== item.id);
        if (selectedFormatId === item.id && formatState.length) {
          selectedFormatId = formatState[0].id;
        }
        renderFormats();
      });

      row.append(radio, input, del);
      formatListEl.appendChild(row);
    });
  }

  addThanksBtn.addEventListener('click', () => {
    thanksState.push({ id: uuid(), text: '', enabled: true });
    renderThanks();
  });

  addFormatBtn.addEventListener('click', () => {
    const template = DEFAULT_MESSAGE_FORMATS[0];
    formatState.push({ id: uuid(), text: template });
    renderFormats();
  });

  renderThanks();
  renderFormats();

  let hotkeyCaptureHandler = null;
  function stopHotkeyCapture(){
    if(hotkeyCaptureHandler){
      document.removeEventListener('keydown', hotkeyCaptureHandler, true);
      hotkeyCaptureHandler = null;
    }
    if(hotkeyRecordBtn){
      hotkeyRecordBtn.textContent = "Record";
      hotkeyRecordBtn.disabled = false;
    }
  }

  function closeModal(){
    stopHotkeyCapture();
    wrap.remove();
    document.removeEventListener('keydown', onKey);
  }

  function onKey(ev){
    if (ev.key === 'Escape'){
      ev.preventDefault();
      closeModal();
    }
  }

  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (ev)=>{ if (ev.target === wrap) closeModal(); });
  const cancelBtn = wrap.querySelector('#mhmm-settings-cancel');
  const saveBtn = wrap.querySelector('#mhmm-settings-save');
  cancelBtn.addEventListener('click', closeModal);
  saveBtn.dataset.skipAutoBeep = "1";
  if(hotkeyRecordBtn) hotkeyRecordBtn.dataset.skipAutoBeep = "1";
  if(hotkeyClearBtn) hotkeyClearBtn.dataset.skipAutoBeep = "1";

  if(hotkeyRecordBtn){
    hotkeyRecordBtn.addEventListener('click', ()=>{
      if(hotkeyCaptureHandler) return;
      hotkeyRecordBtn.textContent = "Press key...";
      hotkeyRecordBtn.disabled = true;
      const handler = (event)=>{
        event.preventDefault();
        event.stopPropagation();
        const captured = hotkeyFromEvent(event);
        if(captured){
          hotkeyInput.value = captured;
        }
        stopHotkeyCapture();
      };
      hotkeyCaptureHandler = handler;
      document.addEventListener('keydown', handler, true);
    });
  }

  if(hotkeyClearBtn){
    hotkeyClearBtn.addEventListener('click', ()=>{
      if(hotkeyInput){
        hotkeyInput.value = DEFAULT_TOGGLE_HOTKEY;
      }
      stopHotkeyCapture();
    });
  }

  saveBtn.addEventListener('click', ()=>{
    stopHotkeyCapture();
    const intro = introInput.value;
    const prefix = prefixInput.value || DEFAULT_SEARCH_PREFIX;

    const thanksPayload = thanksState
      .map(entry => ({ text: (entry.text || '').trim(), enabled: !!entry.enabled }))
      .filter(entry => entry.text);
    if (!thanksPayload.length) {
      alert('Please provide at least one thank-you message.');
      return;
    }

    const formatPayload = formatState
      .map(entry => (entry.text || '').trim())
      .filter(text => text);
    if (!formatPayload.length) {
      alert('Please provide at least one market message format.');
      return;
    }
    if (formatPayload.some(text => !text.includes('<name>') || !text.includes('<price>'))){
      alert('Each market message format must include both <name> and <price>.');
      return;
    }

    const selectedEntry = formatState.find(entry => entry.id === selectedFormatId);
    let selectedFormatText = selectedEntry ? (selectedEntry.text || '').trim() : '';
    if (!selectedFormatText || !formatPayload.includes(selectedFormatText)) {
      selectedFormatText = formatPayload[0];
    }

    App.data.intro_line = intro;
    App.data.search_prefix = prefix;
    App.data.thankyou_messages = normalizeThankyouMessages(thanksPayload);
    App.data.thankyou_text = App.data.thankyou_messages[0].text || THANKYOU_TEXT;
    App.data.message_formats = normalizeMessageFormats(formatPayload);
    App.data.selected_message_format = selectedFormatText;
    App.data.auto_round_prices = roundToggle ? !!roundToggle.checked : false;
    setSoundEnabled(soundToggle ? soundToggle.checked : App.soundEnabled);
    if(hotkeyInput){
      const normalizedHotkey = normalizeHotkeyString(hotkeyInput.value);
      if(normalizedHotkey == null){
        alert('Please enter a valid panel toggle shortcut (e.g. F8, Ctrl+Shift+P, MouseMiddle).');
        return;
      }
      App.toggleHotkey = normalizedHotkey;
      hotkeyInput.value = normalizedHotkey;
    }else{
      App.toggleHotkey = DEFAULT_TOGGLE_HOTKEY;
    }
    GM_setValue(GM_KEYS.TOGGLE_HOTKEY, App.toggleHotkey);

    setControlInputs(
      App.data.intro_line,
      App.data.search_prefix,
      App.data.thankyou_text,
      App.data.message_formats,
      App.data.selected_message_format,
      App.data.thankyou_messages
    );

    persistAuto();
    onGenerateMessage(false);
    flashTitle('Settings updated');
    playBeep();
    closeModal();
  });
}

function findBestMatch(name, catalog){
  const targetNorm = (name || '').toLowerCase();
  let best = null;
  let score = null;
  for (const node of catalog) {
    const nodeName = (node.name || '').trim();
    if (!nodeName) continue;
    const nodeNorm = nodeName.toLowerCase();
    let matchKind;
    let distance;
    if (nodeNorm === targetNorm) {
      matchKind = 0;
      distance = 0;
    } else if (nodeNorm.includes(targetNorm)) {
      matchKind = 1;
      distance = nodeNorm.length - targetNorm.length;
    } else if (targetNorm.includes(nodeNorm)) {
      matchKind = 2;
      distance = targetNorm.length - nodeNorm.length;
    } else {
      continue;
    }
    const candidate = [matchKind, distance, nodeNorm.length];
    if (!score || compareScore(candidate, score) < 0) {
      score = candidate;
      best = node;
    }
  }
  return best;
}

function compareScore(a, b){
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    return a[i] - b[i];
  }
  return 0;
}
function defaultNode(name, node_type){
  return {
    id: uuid(),
    type: node_type,
    name,
    include: true,
    completed: false,
    override_message: "",
    needs_snipe: false,
    price: 0,
    children: [],
    sidenotes: "",
    ...(isGroupType(node_type) ? { must_contains_all: true, auto_collapse: false } : {})
  };
}
function findNodeAndParentList(list_nodes, node_id){
  const stack = [{ arr:list_nodes, parent:null }];
  while(stack.length){
    const { arr } = stack.pop();
    for(const n of arr){
      if(n.id===node_id) return [n, arr];
      const ch = n.children||[];
      if(ch.length) stack.push({ arr: ch, parent:n });
    }
  }
  return [null, null];
}
function deleteDeep(list_nodes, node_id){
  for(let i=0;i<list_nodes.length;i++){
    if(list_nodes[i].id===node_id){ list_nodes.splice(i,1); return true; }
    if(deleteDeep(list_nodes[i].children||[], node_id)) return true;
  }
  return false;
}
function getFirstWord(text){
  text = (text||"").trim();
  return text ? text.split(/\s+/)[0] : "";
}
async function copyText(t){
  try{
    await navigator.clipboard.writeText(String(t||""));
    flashTitle("Copied!");
  }catch(e){
    const ta = document.createElement("textarea");
    ta.value = String(t||"");
    document.body.appendChild(ta);
    ta.select();
    try{ document.execCommand("copy"); }catch(_){}
    ta.remove();
  }
}
function downloadText(filename, text){
  const blob = new Blob([text], {type:"application/json;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename || "mapping_manager.json";
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 100);
}
function uploadJSONFile(){
  return new Promise((resolve,reject)=>{
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".json,application/json";
    inp.onchange = ()=>{
      const f = inp.files && inp.files[0];
      if(!f){ reject(new Error("No file selected")); return; }
      const reader = new FileReader();
      reader.onload = ()=>{
        try{ resolve({ data: JSON.parse(reader.result), name: f.name }); }
        catch(e){ reject(e); }
      };
      reader.onerror = ()=>reject(reader.error);
      reader.readAsText(f, "utf-8");
    };
    inp.click();
  });
}
let _lastBeepTs = 0;
function playBeep(){
  if(typeof App === "undefined" || !App.soundEnabled) return;
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if(now - _lastBeepTs < 80) return;
  _lastBeepTs = now;
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = "sine"; o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
    o.start();
    setTimeout(()=>{ g.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime+0.12);
      setTimeout(()=>{ o.stop(); ctx.close(); }, 160);
    }, 40);
  }catch(_){}
}
let _baseTitle = document.title, _titleTimer=null;
function flashTitle(msg, ms=1200){
  if(_titleTimer){ clearTimeout(_titleTimer); _titleTimer=null; }
  document.title = msg;
  _titleTimer = setTimeout(()=>{ document.title = _baseTitle; }, ms);
}
function isInteractiveElement(el){
  return !!(el && el.closest('a, button, input, textarea, select, summary, [contenteditable]'));
}
const App = {
  data: {
    intro_line: "LF Snipers: (Overnight OK)",
    regions: [],
    search_prefix: DEFAULT_SEARCH_PREFIX,
    thankyou_text: THANKYOU_TEXT,
    thankyou_messages: defaultThankyouMessages(),
    message_formats: DEFAULT_MESSAGE_FORMATS.slice(),
    selected_message_format: DEFAULT_MESSAGE_FORMATS[0],
    auto_round_prices: false
  },
  toggleHotkey: normalizeHotkeyString(GM_getValue(GM_KEYS.TOGGLE_HOTKEY, DEFAULT_TOGGLE_HOTKEY)) || DEFAULT_TOGGLE_HOTKEY,
  soundEnabled: GM_getValue(GM_KEYS.SOUND_ENABLED, true),
  collapseState: {},
  undoStack: [],
  redoStack: [],
  MAX_UNDO: 20,
  suspendHistory: false,
  lastMessageText: "",
  msgItemsData: [],
  todoItemsData: [],
  currentFilename: GM_getValue(GM_KEYS.LAST_FILENAME, "mapping_manager.json")
};
function setSoundEnabled(enabled){
  App.soundEnabled = !!enabled;
  GM_setValue(GM_KEYS.SOUND_ENABLED, App.soundEnabled);
}
function recordUndo(){
  if(App.suspendHistory) return;
  const snap = {
    data: deepClone(App.data),
    intro: App.data.intro_line,
    selectionId: getSelectedRowId(),
    collapseState: { ...App.collapseState }
  };
  App.undoStack.push(snap);
  if(App.undoStack.length > App.MAX_UNDO) App.undoStack.shift();
  App.redoStack = [];
}
function restoreSnapshot(snap){
  App.suspendHistory = true;
  try{
    App.data = deepClone(snap.data);
    App.collapseState = snap.collapseState ? { ...snap.collapseState } : {};
    ensureTreeDefaults(App.data.regions);
    refreshTree();
    updateTodoList();
    setControlInputs(
      App.data.intro_line,
      App.data.search_prefix,
      App.data.thankyou_text,
      App.data.message_formats,
      App.data.selected_message_format,
      App.data.thankyou_messages
    );
    if(snap.selectionId && existsRowId(snap.selectionId)){
      selectRow(snap.selectionId); ensureRowVisible(snap.selectionId);
    }else{
      clearEditor();
    }
  }finally{
    App.suspendHistory = false;
  }
}
function undo(){
  if(!App.undoStack.length) return;
  const cur = {
    data: deepClone(App.data),
    intro: App.data.intro_line,
    selectionId: getSelectedRowId(),
    collapseState: { ...App.collapseState }
  };
  App.redoStack.push(cur);
  const snap = App.undoStack.pop();
  restoreSnapshot(snap);
}
function redo(){
  if(!App.redoStack.length) return;
  const cur = {
    data: deepClone(App.data),
    intro: App.data.intro_line,
    selectionId: getSelectedRowId(),
    collapseState: { ...App.collapseState }
  };
  App.undoStack.push(cur);
  const snap = App.redoStack.pop();
  restoreSnapshot(snap);
}

function injectStyles(){
  GM_addStyle(`
#mhmm-toggle{
  position:fixed; z-index:2147483647; top:5px; right:5px;
  background:#111; color:#fff; border:1px solid #333; padding:4px 8px;
  border-radius:8px; cursor:pointer; font:12px/1 monospace;
}
/* === Help modal === */
.mhmm-modal{
  position:fixed; inset:0; z-index:2147483647;
  background:rgba(0,0,0,.55); display:flex; align-items:center; justify-content:center;
}
.mhmm-modal-inner{
  width:min(820px, 92vw); max-height:80vh; overflow:auto;
  background:#0b0e12; color:#e7e7e7; border:1px solid #2a2f3a; border-radius:12px;
  box-shadow:0 20px 60px rgba(0,0,0,.6);
}
.mhmm-modal-settings{
  max-height:96vh;
}
.mhmm-modal-head{
  display:flex; align-items:center; justify-content:space-between;
  padding:10px 12px; border-bottom:1px solid #1f2937; font-weight:700;
}
.mhmm-modal-body{
  padding:12px; white-space:pre-wrap; font:12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
}
.mhmm-modal-close{
  background:#1e293b; border:1px solid #334155; border-radius:8px; padding:4px 10px; cursor:pointer; font-size:12px;
}
.mhmm-modal-close:hover{ background:#243042; }
.mhmm-input{
  width:100%;
  background:#0f172a;
  color:#e7e7e7;
  border:1px solid #273449;
  border-radius:8px;
  padding:6px 8px;
  font-size:12px;
}
.mhmm-input:focus{
  outline:none;
  border-color:#3b82f6;
}
.mhmm-detect-body{ display:flex; gap:12px; padding:12px; white-space:normal; }
.mhmm-detect-col{ flex:1; display:flex; flex-direction:column; }
.mhmm-detect-heading{ font-weight:600; margin:4px 0; }
.mhmm-detect-list{ display:flex; flex-direction:column; gap:4px; }
.mhmm-detect-item{ background:#151b27; padding:6px 8px; border-radius:6px; line-height:1.4; }
.mhmm-detect-empty{ font-style:italic; color:#8892aa; padding:6px 8px; }
.mhmm-detect-controls{ display:flex; gap:8px; }
.mhmm-detect-controls button{
  background:#1e293b; border:1px solid #334155; border-radius:8px; padding:4px 10px;
  color:#e7e7e7; cursor:pointer; font-size:12px;
}
.mhmm-detect-controls button:hover{ background:#243042; }
.mhmm-settings-body{ display:flex; flex-direction:column; gap:16px; white-space:normal; }
.mhmm-settings-section{ background:#111827; border:1px solid #273449; border-radius:10px; padding:10px; display:flex; flex-direction:column; gap:6px; }
.mhmm-settings-header{ display:flex; align-items:center; justify-content:space-between; gap:8px; }
.mhmm-settings-add{ background:#1e293b; border:1px solid #334155; border-radius:6px; padding:4px 8px; color:#e7e7e7; cursor:pointer; font-size:12px; }
.mhmm-settings-add:hover{ background:#243042; }
.mhmm-settings-list{ display:flex; flex-direction:column; gap:6px; }
.mhmm-settings-row{ display:flex; align-items:center; gap:8px; }
.mhmm-settings-row .mhmm-input{ flex:1; }
.mhmm-settings-row button{ background:#1e293b; border:1px solid #334155; border-radius:6px; padding:4px 8px; color:#e7e7e7; cursor:pointer; font-size:12px; }
.mhmm-settings-row button:disabled{ opacity:0.5; cursor:default; }
.mhmm-settings-row button:hover:not(:disabled){ background:#243042; }
.mhmm-settings-row input[type="checkbox"],
.mhmm-settings-row input[type="radio"]{ accent-color:#3b82f6; }
.mhmm-settings-field{ display:flex; flex-direction:column; gap:4px; }
.mhmm-settings-field label{ color:#e7e7e7; }
.mhmm-inline-check{ display:flex; align-items:center; gap:6px; font-size:12px; color:#e7e7e7; }
.mhmm-stats-row{
  display:flex; align-items:center; justify-content:space-between;
  padding:4px 2px; border-bottom:1px dotted #223; font-size:12px;
}
#mhmm-stats strong{ font-weight:700; }
#mhmm-controls .mhmm-btns-row{
  display:flex;
  gap:6px;
  flex-wrap:wrap;
}
#mhmm-controls .mhmm-btns-row button{
  background:#1e293b !important;
  color:#e7e7eb !important;
  border:1px solid #334155 !important;
  border-radius:8px;
  padding:4px 8px;
  cursor:pointer;
  font-size:12px;
}
#mhmm-controls .mhmm-btns-row button:hover{
  background:#243042 !important;
}

#mhmm-editor .mhmm-price-row{
  display:flex;
  align-items:center;
  gap:6px;
  flex-wrap:nowrap;
}
#mhmm-editor .mhmm-price-row input{ width:110px; }
#mhmm-panel #ed-price-minus,
#mhmm-panel #ed-price-plus {
  background:#1e293b !important;
  color:#e7e7eb !important;
  border:1px solid #334155 !important;
  border-radius:6px;
  padding:2px 6px;
  cursor:pointer;
  font-size:12px;
}
#mhmm-panel #ed-price-minus:hover,
#mhmm-panel #ed-price-plus:hover {
  background:#243042 !important;
}

#mhmm-panel{
  position:fixed; z-index:2147483647; top:40px; right:20px;
  width:1500px; height:780px;
  background:#0f1216ee; color:#e7e7e7;
  border:1px solid #2a2f3a; border-radius:12px; display:none;
  backdrop-filter:blur(6px);
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Noto Sans";
}
@media (max-width:1100px){
  #mhmm-panel{ left:20px; right:20px; width:auto; height: calc(100vh - 100px); }
}
#mhmm-panel.show{ display:block; }
#mhmm-panel, #mhmm-panel * { color:#e7e7e7 !important; }

#mhmm-controls label.mhmm-small,
#mhmm-editor label.mhmm-small,
.mhmm-h { color:#cfd6e3 !important; }

#mhmm-panel input, #mhmm-panel textarea {
  color:#dfe3ea !important;
  background:#0b0e12 !important;
}

#mhmm-panel ::placeholder { color:#9aa4b2; opacity:1; }

#mhmm-panel input:-webkit-autofill,
#mhmm-panel textarea:-webkit-autofill {
  -webkit-text-fill-color:#dfe3ea !important;
  -webkit-box-shadow:0 0 0 1000px #0b0e12 inset !important;
  transition: background-color 9999s ease-out 0s;
}

#mhmm-panel button#ed-apply,
#mhmm-panel button#mhmm-copy{
  background:#1e293b !important;
  color:#e7e7eb !important;
  border:1px solid #334155 !important;
  border-radius:8px;
  padding:4px 8px;
  cursor:pointer;
}
#mhmm-panel button#ed-apply:hover,
#mhmm-panel button#mhmm-copy:hover{
  background:#243042 !important;
}

#mhmm-main{
  height: 97.5%;
  display:grid;
  grid-template-columns: 1.1fr 1.2fr 1fr 1fr;
  gap:8px; padding:8px;
}

.mhmm-card{ background:#0b0e12; border:1px solid #1f2937; border-radius:10px; padding:8px; display:flex; flex-direction:column; gap:8px; min-height:0; }
.mhmm-h{ font-weight:700; font-size:13px; color:#cfd6e3; display:flex; align-items:center; justify-content:space-between; }
.mhmm-small{ font-size:12px; opacity:.9; }
.mhmm-toolbar{ display:flex; gap:6px; flex-wrap:wrap; }
.mhmm-toolbar button{ background:#111827; border:1px solid #374151; color:#e5e7eb; border-radius:8px; padding:3px 6px; font-size:12px; }

#mhmm-treewrap{ flex:1; overflow:auto; border:1px dashed #2a2f3a; border-radius:8px; padding:4px; }
.mhmm-row{ font-size:12px; display:grid; grid-template-columns: 1fr 36px 36px 44px 56px; gap:6px; padding:3px 4px; border-bottom:1px dotted #223; cursor:pointer; align-items:center; }
.mhmm-row.selected{ background:#111826; }
.mhmm-col-head{ font-weight:600; opacity:.85; }
.mhmm-col-name{
  display:flex;
  align-items:center;
  gap:6px;
  min-width:0;
}
.mhmm-name-wrap{
  display:flex;
  align-items:center;
  gap:6px;
  min-width:0;
  flex:1;
}
.mhmm-name-text{
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  min-width:0;
}
.mhmm-toggle{
  width:14px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  cursor:pointer;
  color:#94a3b8;
  user-select:none;
}
.mhmm-toggle:hover{ color:#e2e8f0; }
.mhmm-toggle:focus{
  outline:1px solid #3b82f6;
  border-radius:4px;
}
.mhmm-col-center{ text-align:center; }

#mhmm-controls input[type="text"]{
  background:#0b0e12; color:#dfe3ea; border:1px solid #2a2f3a; border-radius:8px; padding:4px 6px; font-size:12px; width:100%;
}
#mhmm-controls .mhmm-grid{
  display:grid; grid-template-columns: 1fr; gap:8px;
}

.mhmm-box{ background:#0b0e12; border:1px solid #1f2937; border-radius:8px; padding:8px; display:flex; flex-direction:column; min-height:0; }
.mhmm-box.flex{ flex:1; }

#mhmm-editor{
  display:grid; grid-template-columns: 90px 1fr 120px; gap:8px;
}
#mhmm-editor input[type="text"], #mhmm-editor input[type="number"], #mhmm-editor textarea{
  background:#0b0e12; color:#dfe3ea; border:1px solid #2a2f3a; border-radius:8px; padding:4px 6px; font-size:12px;
}
#mhmm-editor textarea{ resize:vertical; min-height:64px; }
#mhmm-editor .mhmm-checks-row{
  grid-column: 1 / -1;
  display:flex; align-items:center; gap:18px;
}
#mhmm-editor .mhmm-checks-row label{
  display:flex; align-items:center; gap:6px; font-size:12px;
}
#mhmm-editor input[type="checkbox"]{
  width:16px; height:16px; accent-color:#3b82f6;
}

#mhmm-msg, #mhmm-todo{ flex:1; overflow:auto; border:1px dashed #2a2f3a; border-radius:8px; padding:6px; font-size:12px; }
.mhmm-list-item{ padding:5px 6px; border-bottom:1px dotted #223; cursor:default; white-space:pre-wrap; }
.mhmm-list-item:hover{ background:#111826; }

.mhmm-tooltip{
  position:fixed; z-index:2147483647; background:#111827; color:#fff;
  border:1px solid #374151; border-radius:8px; padding:6px 8px; max-width:320px;
  box-shadow:0 10px 24px rgba(0,0,0,.4); pointer-events:none; white-space:pre-wrap; font-size:12px;
}
`);
}

function buildPanel(){
  const toggle = document.createElement("button");
  toggle.id = "mhmm-toggle";
  toggle.textContent = "MH-MM";
  toggle.title = APP_TITLE;
  toggle.addEventListener("click", ()=> setPanelVisible(!panelVisible()));
  document.body.appendChild(toggle);

  const panel = document.createElement("div");
  panel.id = "mhmm-panel";
  panel.innerHTML = `
    <div id="mhmm-main">
      <div id="col-nodes" class="mhmm-card">
        <div class="mhmm-h">
          <span>Nodes</span>
          <div class="mhmm-toolbar">
            <button id="mhmm-add-region">+ Region</button>
            <button id="mhmm-add-subgroup">+ Subgroup</button>
            <button id="mhmm-add-enemy">+ Enemy</button>
            <button id="mhmm-del">Delete</button>
          </div>
        </div>
        <div id="mhmm-treewrap">
          <div class="mhmm-row">
            <div class="mhmm-col-head">Name</div>
            <div class="mhmm-col-head mhmm-col-center">Snipe?</div>
            <div class="mhmm-col-head mhmm-col-center">Need?</div>
            <div class="mhmm-col-head mhmm-col-center">Done?</div>
            <div class="mhmm-col-head mhmm-col-center">Price</div>
          </div>
          <div id="mhmm-tree"></div>
        </div>
      </div>

      <div id="col-edit" class="mhmm-card">
        <div class="mhmm-h">Controls</div>
        <div id="mhmm-controls" class="mhmm-box">
          <div class="mhmm-btns-row" style="margin-top:8px;">
            <button id="mhmm-btn-save">Save</button>
            <button id="mhmm-btn-export">Export</button>
            <button id="mhmm-btn-import">Import</button>
            <button id="mhmm-btn-undo">Undo</button>
            <button id="mhmm-btn-redo">Redo</button>
            <button id="mhmm-btn-detect">Detect Map</button>
          </div>
		  <div class="mhmm-btns-row" style="margin-top:6px;">
			<button id="mhmm-btn-help">User Guide</button>
			<button id="mhmm-btn-reset">Reset run</button>
			<button id="mhmm-btn-gen">Generate LF message</button>
			<button id="mhmm-copy">Copy</button>
		  </div>
          <div class="mhmm-btns-row" style="margin-top:6px;">
            <button id="mhmm-btn-inc">Increase unsniped price</button>
            <button id="mhmm-btn-dec">Decrease unsniped price</button>
            <button id="mhmm-btn-settings">User settings</button>
          </div>
        </div>

        <div class="mhmm-h">Edit selected</div>
        <div id="mhmm-editor" class="mhmm-box">
          <label class="mhmm-small">Name:</label><input id="ed-name" type="text" />
          <div></div>

          <label class="mhmm-small">Override:</label><input id="ed-override" type="text" />
          <div></div>

          <div class="mhmm-checks-row">
            <label><input id="ed-include" type="checkbox"> Need</label>
            <label><input id="ed-completed" type="checkbox"> Completed</label>
            <label><input id="ed-snipe" type="checkbox"> Requires Snipe</label>
          </div>

          <div class="mhmm-checks-row">
            <label><input id="ed-must-all" type="checkbox"> Must Contains All</label>
            <label><input id="ed-auto-collapse" type="checkbox"> Auto Collapse</label>
          </div>

          <label class="mhmm-small" style="justify-self:start;">Price:</label>
          <div class="mhmm-price-row">
            <input id="ed-price" type="number" />
            <button id="ed-price-minus" title="-5">−</button>
            <button id="ed-price-plus" title="+5">+</button>
          </div>

          <div></div>

          <label class="mhmm-small">Side notes:</label><textarea id="ed-notes" style="grid-column: span 2;"></textarea>

          <div style="grid-column: 1 / -1; display:flex; gap:8px;">
            <button id="ed-apply">Apply</button>
          </div>
        </div>
		
		<div class="mhmm-h">Stats</div>
        <div id="mhmm-stats" class="mhmm-box">
          <div class="mhmm-stats-row"><span>All required targets</span><strong id="stat-need-all">0</strong></div>
          <div class="mhmm-stats-row"><span>All snipe targets</span><strong id="stat-need-snipe-all">0</strong></div>
          <div class="mhmm-stats-row"><span>All self targets</span><strong id="stat-need-self-all">0</strong></div>
          <div class="mhmm-stats-row"><span>Remaining targets</span><strong id="stat-remaining-all">0</strong></div>
          <div class="mhmm-stats-row"><span>Remaining snipe targets</span><strong id="stat-remaining-snipe">0</strong></div>
          <div class="mhmm-stats-row"><span>Remaining self targets</span><strong id="stat-remaining-self">0</strong></div>
        </div>
		
      </div>

      <div id="col-msg" class="mhmm-card">
        <div class="mhmm-h">Generated market message</div>
        <div id="mhmm-msg" class="mhmm-box flex"></div>
      </div>

      <div id="col-todo" class="mhmm-card">
        <div class="mhmm-h">Todo List (Double Click To Complete)</div>
        <div id="mhmm-todo" class="mhmm-box flex"></div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  ui.panel = panel; ui.toggle = document.getElementById("mhmm-toggle");

  ui.btnSave = document.getElementById("mhmm-btn-save");
  ui.btnExport = document.getElementById("mhmm-btn-export");
  ui.btnImport = document.getElementById("mhmm-btn-import");
  ui.btnReset = document.getElementById("mhmm-btn-reset");
  ui.btnGen = document.getElementById("mhmm-btn-gen");
  ui.btnUndo = document.getElementById("mhmm-btn-undo");
  ui.btnRedo = document.getElementById("mhmm-btn-redo");
  ui.btnDetect = document.getElementById("mhmm-btn-detect");
  ui.btnInc = document.getElementById("mhmm-btn-inc");
  ui.btnDec = document.getElementById("mhmm-btn-dec");
  ui.btnSettings = document.getElementById("mhmm-btn-settings");
  ui.btnHelp = document.getElementById("mhmm-btn-help");

  ui.btnAddRegion = document.getElementById("mhmm-add-region");
  ui.btnAddSub = document.getElementById("mhmm-add-subgroup");
  ui.btnAddEnemy = document.getElementById("mhmm-add-enemy");
  ui.btnDel = document.getElementById("mhmm-del");

  ui.tree = document.getElementById("mhmm-tree");
  ui.msg = document.getElementById("mhmm-msg");
  ui.todo = document.getElementById("mhmm-todo");

  ui.edName = document.getElementById("ed-name");
  ui.edInclude = document.getElementById("ed-include");
  ui.edCompleted = document.getElementById("ed-completed");
  ui.edOverride = document.getElementById("ed-override");
  ui.edSnipe = document.getElementById("ed-snipe");
  ui.edMustAll = document.getElementById("ed-must-all");
  ui.edAutoCollapse = document.getElementById("ed-auto-collapse");
  ui.edPrice = document.getElementById("ed-price");
  ui.edPriceMinus = document.getElementById("ed-price-minus");
  ui.edPricePlus = document.getElementById("ed-price-plus");
  ui.edNotes = document.getElementById("ed-notes");
  ui.edApply = document.getElementById("ed-apply");
  ui.btnCopy = document.getElementById("mhmm-copy");
    // Stats handles
  ui.statNeedAll        = document.getElementById("stat-need-all");
  ui.statNeedSnipeAll   = document.getElementById("stat-need-snipe-all");
  ui.statNeedSelfAll    = document.getElementById("stat-need-self-all");
  ui.statRemainingAll   = document.getElementById("stat-remaining-all");
  ui.statRemainingSnipe = document.getElementById("stat-remaining-snipe");
  ui.statRemainingSelf  = document.getElementById("stat-remaining-self");

  ui.btnSave.addEventListener("click", onSave);
  ui.btnExport.addEventListener("click", onExport);
  ui.btnImport.addEventListener("click", onImport);
  ui.btnReset.addEventListener("click", onResetRun);
  ui.btnGen.addEventListener("click", ()=>onGenerateMessage(true));
  ui.btnUndo.addEventListener("click", ()=>undo());
  ui.btnRedo.addEventListener("click", ()=>redo());
  ui.btnDetect.addEventListener("click", onDetectFromPage);
  ui.btnInc.addEventListener("click", onIncreasePrice);
  ui.btnDec.addEventListener("click", onDecreasePrice);
  ui.btnSettings.addEventListener("click", showUserSettings);
  ui.btnHelp.addEventListener("click", showHelp);


  ui.btnAddRegion.addEventListener("click", onAddRegion);
  ui.btnAddSub.addEventListener("click", onAddSubgroup);
  ui.btnAddEnemy.addEventListener("click", onAddEnemy);
  ui.btnDel.addEventListener("click", onDeleteSelected);

  ui.edPriceMinus.addEventListener("click", ()=> bumpPrice(-PRICE_STEP));
  ui.edPricePlus.addEventListener("click", ()=> bumpPrice(+PRICE_STEP));
  ui.edApply.addEventListener("click", applyToSelected);
  ui.btnCopy.addEventListener("click", ()=> copyMessage(true));

  ui.edInclude.addEventListener("change", ()=> applyToSelected());
  ui.edCompleted.addEventListener("change", ()=> applyToSelected());
  ui.edSnipe.addEventListener("change", ()=> applyToSelected());
  ui.edMustAll.addEventListener("change", ()=> applyToSelected());
  ui.edAutoCollapse.addEventListener("change", ()=> applyToSelected());

  document.addEventListener("keydown", (e)=>{
    if(!panelVisible()) return;
    if(e.ctrlKey && !e.shiftKey && e.key.toLowerCase()==="z"){ e.preventDefault(); undo(); }
    if((e.ctrlKey && e.key.toLowerCase()==="y") || (e.ctrlKey && e.shiftKey && e.key.toLowerCase()==="z")){
      e.preventDefault(); redo();
    }
  });

  const last = GM_getValue(GM_KEYS.LAST_SNAPSHOT, null);
  if(last){ try{ App.data = JSON.parse(last); }catch(_){} }
  if(typeof App.data.auto_round_prices !== "boolean") App.data.auto_round_prices = false;
  if(typeof App.toggleHotkey !== "string" || !App.toggleHotkey){
    App.toggleHotkey = DEFAULT_TOGGLE_HOTKEY;
  }
  if(App.data && Object.prototype.hasOwnProperty.call(App.data, "toggle_hotkey")){
    const legacyHotkey = normalizeHotkeyString(App.data.toggle_hotkey);
    if(legacyHotkey){
      App.toggleHotkey = legacyHotkey;
      GM_setValue(GM_KEYS.TOGGLE_HOTKEY, App.toggleHotkey);
    }
    delete App.data.toggle_hotkey;
  }
  GM_setValue(GM_KEYS.TOGGLE_HOTKEY, App.toggleHotkey);
  if(!App.data.thankyou_text) App.data.thankyou_text = THANKYOU_TEXT;
  if(!Array.isArray(App.data.thankyou_messages)) App.data.thankyou_messages = defaultThankyouMessages();
  if(!Array.isArray(App.data.message_formats)) App.data.message_formats = DEFAULT_MESSAGE_FORMATS.slice();
  if(!App.data.selected_message_format) App.data.selected_message_format = App.data.message_formats[0];
  setControlInputs(
    App.data.intro_line,
    App.data.search_prefix,
    App.data.thankyou_text,
    App.data.message_formats,
    App.data.selected_message_format,
    App.data.thankyou_messages
  );
  App.collapseState = {};
  ensureTreeDefaults(App.data.regions);
  refreshTree();
  updateTodoList();
  onGenerateMessage(false);
  updateStats();
  if(GM_getValue(GM_KEYS.PANEL_VISIBLE, false)) setPanelVisible(true);
  GM_registerMenuCommand("Toggle MH MM Panel", ()=> setPanelVisible(!panelVisible()));
  GM_registerMenuCommand("Open MH MM User Guide", ()=> showHelp());
  GM_registerMenuCommand("Open MH MM User Settings", ()=> showUserSettings());
}

function onMiddleToggleDown(e){
  const isMiddle = (e.button === 1) || (e.which === 2);
  if (!isMiddle) return;

  if (!ui || !ui.panel) return;

  const configuredHotkey = App.toggleHotkey || DEFAULT_TOGGLE_HOTKEY;
  if(configuredHotkey !== "MouseMiddle" && !e.altKey){
    return;
  }

  const force = e.altKey;                         
  const onInteractive = isInteractiveElement(e.target); 

  if (force || !onInteractive) {
    e.preventDefault();
    e.stopPropagation();
    setPanelVisible(!panelVisible());
  }
}

document.addEventListener('mousedown', onMiddleToggleDown, { capture: true, passive: false });

function onGlobalToggleKeyDown(event){
  if(event.repeat) return;
  if(isInteractiveElement(event.target)) return;
  const storedHotkey = App.toggleHotkey || DEFAULT_TOGGLE_HOTKEY;
  if(eventMatchesStoredHotkey(event, storedHotkey)){
    event.preventDefault();
    event.stopPropagation();
    setPanelVisible(!panelVisible());
  }
}
document.addEventListener('keydown', onGlobalToggleKeyDown);

document.addEventListener('click', (ev)=>{
  const btn = ev.target.closest('button');
  if(!btn) return;
  if(btn.disabled) return;
  if(btn.dataset.skipAutoBeep === "1") return;
  playBeep();
});


function setControlInputs(intro, prefix, thanks, formats, selectedFormat, thanksList){
  App.data.intro_line = intro == null ? "" : intro;
  App.data.search_prefix = prefix == null ? DEFAULT_SEARCH_PREFIX : prefix;
  if (thanks !== undefined && thanks !== null) {
    App.data.thankyou_text = thanks;
  }
  if (formats !== undefined) {
    App.data.message_formats = normalizeMessageFormats(formats);
  } else {
    getMessageFormats();
  }
  if (selectedFormat !== undefined) {
    App.data.selected_message_format = selectedFormat;
  }
  getSelectedMessageFormat();
  if (thanksList !== undefined) {
    App.data.thankyou_messages = normalizeThankyouMessages(thanksList);
  } else {
    getThankyouMessages();
  }
  const list = getThankyouMessages();
  App.data.thankyou_text = list[0].text || THANKYOU_TEXT;
  App.data.selected_message_format = getSelectedMessageFormat();
}

function panelVisible(){ return ui.panel.classList.contains("show"); }
function setPanelVisible(v){
  if(v) ui.panel.classList.add("show"); else ui.panel.classList.remove("show");
  GM_setValue(GM_KEYS.PANEL_VISIBLE, !!v);
}

let _selectedId = null;
function refreshTree(){
  ensureTreeDefaults(App.data.regions);
  ui.tree.innerHTML = "";
  const rows = [];
  (function visit(nodes, depth){
    for(const n of (nodes||[])){
      const hasChildren = !!(n.children && n.children.length);
      const collapsed = hasChildren && getNodeCollapseState(n);
      rows.push({ node:n, depth, hasChildren, collapsed });
      if(hasChildren && !collapsed){
        visit(n.children, depth+1);
      }
    }
  })(App.data.regions||[], 0);

  const mark = (v)=> v ? "✓" : "\u00A0";

  for(const { node:n, depth, hasChildren, collapsed } of rows){
    const row = document.createElement("div");
    row.className = "mhmm-row";
    row.dataset.id = n.id;
    if(_selectedId === n.id) row.classList.add("selected");

    const nameCell = document.createElement("div");
    nameCell.className = "mhmm-col-name";
    nameCell.style.paddingLeft = `${depth * 16}px`;

    const nameWrap = document.createElement("div");
    nameWrap.className = "mhmm-name-wrap";

    if(hasChildren){
      const toggle = document.createElement("span");
      toggle.className = "mhmm-toggle";
      toggle.textContent = collapsed ? "▸" : "▾";
      toggle.title = collapsed ? "Expand" : "Collapse";
      toggle.tabIndex = 0;
      toggle.setAttribute("role", "button");
      const toggleHandler = (ev)=>{
        ev.preventDefault();
        ev.stopPropagation();
        setNodeCollapseState(n.id, !collapsed);
        refreshTree();
        ensureRowVisible(n.id);
      };
      toggle.addEventListener("click", toggleHandler);
      toggle.addEventListener("keydown", (ev)=>{
        if(ev.key === "Enter" || ev.key === " "){
          toggleHandler(ev);
        }
      });
      nameWrap.appendChild(toggle);
    }

    const nameText = document.createElement("span");
    nameText.className = "mhmm-name-text";
    nameText.textContent = n.name || "";
    nameWrap.appendChild(nameText);

    nameCell.appendChild(nameWrap);
    row.appendChild(nameCell);

    const snipeCell = document.createElement("div");
    snipeCell.className = "mhmm-col-center";
    snipeCell.textContent = mark(!!n.needs_snipe);
    row.appendChild(snipeCell);

    const needCell = document.createElement("div");
    needCell.className = "mhmm-col-center";
    needCell.textContent = mark(!!n.include);
    row.appendChild(needCell);

    const doneCell = document.createElement("div");
    doneCell.className = "mhmm-col-center";
    doneCell.textContent = mark(!!n.completed);
    row.appendChild(doneCell);

    const priceCell = document.createElement("div");
    priceCell.className = "mhmm-col-center";
    priceCell.textContent = Number(n.price||0);
    row.appendChild(priceCell);

    row.addEventListener("click", ()=> selectRow(n.id));

    snipeCell.style.cursor = "pointer";
    snipeCell.title = "Toggle Requires Snipe";
    snipeCell.addEventListener("click", (ev) => {
      ev.stopPropagation();
      recordUndo();
      n.needs_snipe = !n.needs_snipe;

      if (_selectedId === n.id) ui.edSnipe.checked = n.needs_snipe;

      const keepId = n.id;
      refreshTree();
      selectRow(keepId);
      updateTodoList();
      onGenerateMessage(false);
      persistAuto();
      playBeep();
      flashTitle(n.needs_snipe ? "Marked as Snipe" : "Unmarked Snipe");
    });

    needCell.style.cursor = "pointer";
    needCell.title = "Toggle Need";
    needCell.addEventListener("click", (ev) => {
      ev.stopPropagation();
      recordUndo();
      n.include = !n.include;
      if (_selectedId === n.id) ui.edInclude.checked = n.include;

      const keepId = n.id;
      refreshTree();
      selectRow(keepId);
      updateTodoList();
      onGenerateMessage(false);
      persistAuto();
      playBeep();
      flashTitle(n.include ? "Included for this run" : "Excluded from this run");
    });

    ui.tree.appendChild(row);
  }
}
function existsRowId(id){ return !!ui.tree.querySelector(`.mhmm-row[data-id="${CSS.escape(id)}"]`); }
function getSelectedRowId(){ return _selectedId; }
function selectRow(id){
  _selectedId = id;
  ui.tree.querySelectorAll(".mhmm-row").forEach(el=> el.classList.remove("selected"));
  const row = ui.tree.querySelector(`.mhmm-row[data-id="${CSS.escape(id)}"]`);
  if(row) row.classList.add("selected");
  reflectEditor();
}
function ensureRowVisible(id){
  const row = ui.tree.querySelector(`.mhmm-row[data-id="${CSS.escape(id)}"]`);
  if(row){
    const rect = row.getBoundingClientRect();
    const wrapRect = ui.tree.getBoundingClientRect();
    if(rect.top < wrapRect.top || rect.bottom > wrapRect.bottom) row.scrollIntoView({ block:"center" });
  }
}

function reflectEditor(){
  const [node] = findNodeAndParentList(App.data.regions, _selectedId);
  if(!node){ clearEditor(); return; }
  ensureNodeDefaults(node);
  ui.edName.value = node.name || "";
  ui.edInclude.checked = !!node.include;
  ui.edCompleted.checked = !!node.completed;
  ui.edOverride.value = node.override_message || "";
  ui.edSnipe.checked = !!node.needs_snipe;
  ui.edPrice.value = Number(node.price||0);
  ui.edNotes.value = node.sidenotes || "";
  if(isGroupType(node.type)){
    ui.edMustAll.checked = node.must_contains_all !== false;
    ui.edAutoCollapse.checked = !!node.auto_collapse;
    ui.edMustAll.disabled = false;
    ui.edAutoCollapse.disabled = false;
  }else{
    ui.edMustAll.checked = true;
    ui.edAutoCollapse.checked = false;
    ui.edMustAll.disabled = true;
    ui.edAutoCollapse.disabled = true;
  }
}
function clearEditor(){
  ui.edName.value = "";
  ui.edInclude.checked = true;
  ui.edCompleted.checked = false;
  ui.edOverride.value = "";
  ui.edSnipe.checked = false;
  ui.edPrice.value = 0;
  ui.edNotes.value = "";
  ui.edMustAll.checked = true;
  ui.edAutoCollapse.checked = false;
  ui.edMustAll.disabled = true;
  ui.edAutoCollapse.disabled = true;
}
function bumpPrice(delta){
  const [node] = findNodeAndParentList(App.data.regions, _selectedId);
  if(!node) return;
  recordUndo();
  const cur = Number(node.price||0);
  node.price = cur + delta;
  ui.edPrice.value = node.price;
  refreshTree(); updateTodoList(); onGenerateMessage(false);
  copyRandomThankyou();
}
function applyToSelected(){
  const [node] = findNodeAndParentList(App.data.regions, _selectedId);
  if(!node) return;
  recordUndo();
  const name = (ui.edName.value||"").trim();
  if(name) node.name = name;
  node.include = !!ui.edInclude.checked;
  node.completed = !!ui.edCompleted.checked;
  node.override_message = (ui.edOverride.value||"").trim();
  node.needs_snipe = !!ui.edSnipe.checked;
  node.sidenotes = ui.edNotes.value || "";
  if(isGroupType(node.type)){
    node.must_contains_all = !!ui.edMustAll.checked;
    node.auto_collapse = !!ui.edAutoCollapse.checked;
    setNodeCollapseState(node.id, !!node.auto_collapse);
  }
  const p = parseInt(ui.edPrice.value, 10);
  node.price = isNaN(p) ? 0 : p;
  refreshTree(); updateTodoList(); onGenerateMessage(false);
  persistAuto(); flashTitle("Applied"); playBeep();
}

function onAddRegion(){
  recordUndo();
  const newNode = defaultNode("New Region", "region");
  App.data.regions.push(newNode);
  registerCollapseStateFor(newNode);
  refreshTree(); updateTodoList(); persistAuto();playBeep();
}
function onAddSubgroup(){
  const [node] = findNodeAndParentList(App.data.regions, _selectedId);
  if(!node){ alert("Select a Region or Subgroup to add under it."); return; }
  if(node.type!=="region" && node.type!=="subgroup"){ alert("Only under Region or Subgroup."); return; }
  recordUndo();
  const newNode = defaultNode("New Subgroup", "subgroup");
  node.children.push(newNode);
  registerCollapseStateFor(newNode);
  refreshTree(); persistAuto();playBeep();
}
function onAddEnemy(){
  const [node] = findNodeAndParentList(App.data.regions, _selectedId);
  if(!node){ alert("Select a Region, Subgroup, or an existing Enemy."); return; }
  recordUndo();
  let parent = null;
  if(node.type==="region" || node.type==="subgroup"){ parent = node; }
  else if(node.type==="enemy"){
    function findParentHolder(nodes){
      for(const n of nodes){
        if(n.children && n.children.some(ch=> ch.id===node.id)) return n;
        const r = findParentHolder(n.children||[]); if(r) return r;
      }
      return null;
    }
    parent = findParentHolder(App.data.regions);
  }
  if(!parent){ alert("Cannot determine where to place the new Enemy."); return; }
  parent.children.push(defaultNode("New Enemy", "enemy"));
  refreshTree(); persistAuto();
}
function onDeleteSelected(){
  const [node] = findNodeAndParentList(App.data.regions, _selectedId);
  if(!node) return;
  if(!confirm(`Delete: ${node.name||"(unnamed)"} ?`)) return;
  recordUndo();
  pruneCollapseStateFor(node);
  deleteDeep(App.data.regions, node.id);
  _selectedId = null;
  refreshTree(); clearEditor(); updateTodoList(); persistAuto();playBeep();
}

function onIncreasePrice(){
  recordUndo();
  let changed = 0;

  for (const n of preorderIter(App.data.regions)) {
    if (n.include && n.needs_snipe && !n.completed) {
      let p = Number(n.price || 0);
      let delta = 0;
      if (p > 100)           delta = +5;
      else if (p > 50 && p < 100) delta = +3;
      else if (p > 5  && p < 50)  delta = +2; 

      if (delta !== 0) {
        n.price = p + delta;
        changed++;
      }
    }
  }

  if (changed > 0) {
    refreshTree();
    updateTodoList();
    onGenerateMessage(false);
    persistAuto();
    flashTitle(`Increased prices on ${changed} item(s) & saved`);
    playBeep();
  } else {
    flashTitle("No eligible items to increase");
  }
}

function onDecreasePrice(){
  recordUndo();
  let changed = 0;

  for (const n of preorderIter(App.data.regions)) {
    if (n.include && n.needs_snipe && !n.completed) {
      let p = Number(n.price || 0);
      let delta = 0;
      if (p > 100)           delta = -5;
      else if (p > 50 && p < 100) delta = -3; 
      else if (p > 5  && p < 50)  delta = -2; 

      if (delta !== 0) {
        n.price = p + delta;
        changed++;
      }
    }
  }

  if (changed > 0) {
    refreshTree();
    updateTodoList();
    onGenerateMessage(false);
    persistAuto();
    flashTitle(`Decreased prices on ${changed} item(s) & saved`);
    playBeep();
  } else {
    flashTitle("No eligible items to decrease");
  }
}

function resetNeedAndCompleted(){
  for (const n of preorderIter(App.data.regions)){
    n.include = false;
    n.completed = false;
  }
}

function applyGroupRules(){
  ensureTreeDefaults(App.data.regions);
  const touched = new Set();
  const collect = (arr)=> (arr || []).forEach(id => { if(id) touched.add(id); });
  collect(applyGroupRuleForType("subgroup"));
  collect(applyGroupRuleForType("region"));
  return Array.from(touched);
}

function applyGroupRuleForType(nodeType){
  const affected = [];
  for(const node of preorderIter(App.data.regions)){
    if(node.type !== nodeType) continue;

    if(nodeType === "region"){
      const priceVal = Number(node.price || 0);
      if(!priceVal) continue;
    }

    const children = Array.isArray(node.children) ? node.children : [];
    if(!children.length) continue;

    const mustAll = node.must_contains_all !== undefined ? !!node.must_contains_all : true;
    if(mustAll){
      if(children.every(child => !!child.include)){
        const anyIncomplete = children.some(child => !child.completed);
        children.forEach(child => {
          if(child.include || child.completed){
            if(child.id) affected.push(child.id);
          }
          child.include = false;
          child.completed = false;
        });
        node.include = true;
        node.completed = !anyIncomplete;
        if(node.id) affected.push(node.id);
      }
    }else{
      const includedChildren = children.filter(child => !!child.include);
      if(includedChildren.length){
        const allCompleted = includedChildren.every(child => !!child.completed);
        children.forEach(child => {
          if(child.include || child.completed){
            if(child.id) affected.push(child.id);
          }
          child.include = false;
          child.completed = false;
        });
        node.include = true;
        node.completed = allCompleted;
        if(node.id) affected.push(node.id);
      }
    }
  }
  return affected;
}

function onResetRun(){
  if(!confirm(`Set all targets to Need = No and Completed = No (Keeps Requires Snipe untouched)?`)) return;
  recordUndo();
  resetNeedAndCompleted();
  refreshTree(); updateTodoList(); onGenerateMessage(false); persistAuto(); playBeep();
}
function buildMessageLines(applyRound){
  const lines = [];
  const intro = (App.data.intro_line || "").trim();
  if(intro) lines.push(intro);
  if(!Array.isArray(App.msgItemsData)) return lines;
  const useRound = applyRound && shouldAutoRoundPrices();
  for(const [price, name] of App.msgItemsData){
    lines.push(formatMessageLine(name, price, useRound));
  }
  return lines;
}
function onGenerateMessage(autoCopy){
  const intro = (App.data.intro_line||"").trim();
  const entries = [];
  for(const n of preorderIter(App.data.regions)){
    if(!n.include) continue;
    if(n.completed) continue;
    if(!n.needs_snipe) continue;
    const name = (n.override_message || n.name || "").trim();
    if(!name) continue;
    const price = Number(n.price||0);
    entries.push([price, name, n.id]);
  }
  entries.sort((a,b)=> b[0]-a[0] || a[1].toLowerCase().localeCompare(b[1].toLowerCase()));
  App.msgItemsData = entries.slice();

  ui.msg.innerHTML = "";
  const lines = intro ? [intro] : [];
  for(const [price, name, id] of entries){
    const line = formatMessageLine(name, price, false);
    lines.push(line);
    const div = document.createElement("div");
    div.className = "mhmm-list-item";
    div.textContent = line;

    div.addEventListener("mousemove", (ev)=> showMsgTooltipFor(id, name, price, ev.clientX+12, ev.clientY+12));
    div.addEventListener("mouseleave", hideTooltip);

    div.addEventListener("contextmenu", (ev)=>{
      ev.preventDefault();
      const first = getFirstWord(name);
      const prefix = App.data.search_prefix || DEFAULT_SEARCH_PREFIX;
      copyText(`${prefix} ${first}`); playBeep(); flashTitle("Copied market search message");
    });
    div.addEventListener("auxclick", (ev)=>{ if(ev.button===1){ ev.preventDefault(); const first=getFirstWord(name); copyText(`${App.data.search_prefix} ${first}`); }});
    div.addEventListener("click", (ev)=>{ if(ev.ctrlKey){ const first=getFirstWord(name); copyText(`${App.data.search_prefix} ${first}`); }});
    div.addEventListener("dblclick", ()=>{
      recordUndo();
      const [node] = findNodeAndParentList(App.data.regions, id);
      if(node){
        node.completed = true;
        if(_selectedId===id) ui.edCompleted.checked = true;
        refreshTree(); updateTodoList(); onGenerateMessage(false);
        copyRandomThankyou(); flashTitle(`Completed: ${name}`);
        persistAuto();
        playBeep();
      }
    });
    ui.msg.appendChild(div);
  }
  App.lastMessageText = lines.join("\n");
  if(autoCopy) copyMessage(false);
  flashTitle(autoCopy? "Generated market message (copied)" : "Generated market message");
}
function copyMessage(updateFirst){
  if(updateFirst) onGenerateMessage(false);
  let lines = buildMessageLines(true);
  if(!lines.length){
    lines = (App.lastMessageText || "").split(/\r?\n/).filter(Boolean);
  }
  if(!lines.length) return;
  const limited = lines.slice(0, 10).join("\n");
  copyText(limited);playBeep();
}
function computeTotals(){
  let total_need_all = 0;
  let total_need_snipe_all = 0;
  let total_need_self_all = 0;
  let total_participate = 0;
  let total_snipe = 0;
  let total_self = 0;

  for (const n of preorderIter(App.data.regions)) {
    const p = Number(n.price || 0);
    const include = !!n.include;
    const completed = !!n.completed;
    const snipe = !!n.needs_snipe;

    if (include) {
      total_need_all += p;
      if (snipe) total_need_snipe_all += p; else total_need_self_all += p;

      if (!completed) {
        total_participate += p;
        if (snipe) total_snipe += p; else total_self += p;
      }
    }
  }

  return {
    total_need_all,
    total_need_snipe_all,
    total_need_self_all,
    total_participate,
    total_snipe,
    total_self
  };
}

function updateStats(){
  const t = computeTotals();
  if (ui.statNeedAll)        ui.statNeedAll.textContent        = String(t.total_need_all);
  if (ui.statNeedSnipeAll)   ui.statNeedSnipeAll.textContent   = String(t.total_need_snipe_all);
  if (ui.statNeedSelfAll)    ui.statNeedSelfAll.textContent    = String(t.total_need_self_all);
  if (ui.statRemainingAll)   ui.statRemainingAll.textContent   = String(t.total_participate);
  if (ui.statRemainingSnipe) ui.statRemainingSnipe.textContent = String(t.total_snipe);
  if (ui.statRemainingSelf)  ui.statRemainingSelf.textContent  = String(t.total_self);
}

function computeTodoItems(){
  const items = [];
  for(const n of preorderIter(App.data.regions)){
    if(!n.include) continue;
    if(n.completed) continue;
    if(n.needs_snipe) continue;
    const p = Number(n.price||0);
    if(p<=0) continue;
    const name = (n.name||"").trim();
    if(!name) continue;
    items.push([p, name, n.id]);
  }
  items.sort((a,b)=> b[0]-a[0] || a[1].toLowerCase().localeCompare(b[1].toLowerCase()));
  return items;
}
function updateTodoList(){
  App.todoItemsData = computeTodoItems();
  ui.todo.innerHTML = "";
  for(const [price, name, node_id] of App.todoItemsData){
    const div = document.createElement("div");
    div.className = "mhmm-list-item";
    div.textContent = name;
    div.addEventListener("mousemove", (ev)=>{
      const info = buildTodoInfoText(node_id, name, price);
      if(info) showTooltip(info, ev.clientX+12, ev.clientY+12);
    });
    div.addEventListener("mouseleave", hideTooltip);
    div.addEventListener("dblclick", ()=>{
      hideTooltip();
      recordUndo();
      const [node] = findNodeAndParentList(App.data.regions, node_id);
      if(!node) return;
      node.completed = true;
      if(_selectedId===node_id) ui.edCompleted.checked = true;
      refreshTree(); updateTodoList(); onGenerateMessage(false);
      copyRandomThankyou(); flashTitle(`Completed: ${name}`);
      persistAuto();playBeep();
    });
    ui.todo.appendChild(div);
  }
  updateStats();
}
function buildTodoInfoText(node_id, name, price){
  const path = findPathToNode(App.data.regions, node_id);
  if(!path) return null;
  const node = path[path.length-1];
  const type = (node.type||"").slice(0,1).toUpperCase() + (node.type||"").slice(1);
  let regionName=null, subgroupName=null;
  for(const p of path){
    if(p.type==="region" && regionName===null) regionName = p.name||"";
    if(p.type==="subgroup" && subgroupName===null) subgroupName = p.name||"";
  }
  const lines = [`${name} : ${price}sb+`, `Type: ${type}`];
  if(regionName) lines.push(`Region: ${regionName}`);
  if(subgroupName) lines.push(`Subgroup: ${subgroupName}`);
  const notes = (node.sidenotes||"").trim();
  if(notes) lines.push(`Notes: ${notes}`);
  return lines.join("\n");
}
function findPathToNode(nodes, target_id){
  const stack = [{ nodes, path:[] }];
  while(stack.length){
    const {nodes:arr, path} = stack.pop();
    for(const n of arr){
      const newPath = path.concat([n]);
      if(n.id===target_id) return newPath;
      const ch = n.children||[];
      if(ch.length) stack.push({nodes:ch, path:newPath});
    }
  }
  return null;
}

function persistAuto(){
  GM_setValue(GM_KEYS.LAST_SNAPSHOT, JSON.stringify(App.data));
  GM_setValue(GM_KEYS.SOUND_ENABLED, App.soundEnabled);
  GM_setValue(GM_KEYS.TOGGLE_HOTKEY, App.toggleHotkey || DEFAULT_TOGGLE_HOTKEY);
}
function onSave(){ persistAuto(); onGenerateMessage(false); flashTitle("Saved"); playBeep(); }
function onExport(){
  const name = App.currentFilename || "mapping_manager.json";
  downloadText(name, JSON.stringify(App.data, null, 2));
}
async function onImport(){
  try{
    const {data, name} = await uploadJSONFile();
    if(!data || !Array.isArray(data.regions)){ alert("Invalid file format."); return; }
    recordUndo();
    App.data.intro_line = data.intro_line || "LF Snipers: (Overnight OK)";
    App.data.regions = data.regions;
    App.data.search_prefix = data.search_prefix || DEFAULT_SEARCH_PREFIX;
    App.data.thankyou_text = data.thankyou_text || THANKYOU_TEXT;
    App.data.thankyou_messages = Array.isArray(data.thankyou_messages)
      ? data.thankyou_messages
      : defaultThankyouMessages();
    App.data.message_formats = Array.isArray(data.message_formats)
      ? data.message_formats.slice()
      : DEFAULT_MESSAGE_FORMATS.slice();
    App.data.selected_message_format = data.selected_message_format || App.data.message_formats[0];
    App.data.auto_round_prices = !!data.auto_round_prices;
    const importedHotkey = normalizeHotkeyString(data.toggle_hotkey);
    if(importedHotkey){
      App.toggleHotkey = importedHotkey;
      GM_setValue(GM_KEYS.TOGGLE_HOTKEY, App.toggleHotkey);
    }
    App.currentFilename = name || "mapping_manager.json";
    GM_setValue(GM_KEYS.LAST_FILENAME, App.currentFilename);
    App.collapseState = {};
    ensureTreeDefaults(App.data.regions);
    setControlInputs(
      App.data.intro_line,
      App.data.search_prefix,
      App.data.thankyou_text,
      App.data.message_formats,
      App.data.selected_message_format,
      App.data.thankyou_messages
    );
    refreshTree(); clearEditor(); ui.msg.innerHTML=""; App.lastMessageText="";
    updateTodoList(); persistAuto(); onGenerateMessage(false);
    flashTitle(`Loaded: ${App.currentFilename}`); playBeep();
  }catch(e){
    console.error(e); alert("Load failed: " + e.message);
  }
}

let _tooltipEl = null;
function showMsgTooltipFor(nodeId, displayName, price, x, y){
  const info = buildTodoInfoText(nodeId, displayName, price);
  if(!info) return hideTooltip();
  showTooltip(info, x, y);
}
function showTooltip(text, x, y){
  hideTooltip();
  const tip = document.createElement("div");
  tip.className = "mhmm-tooltip";
  tip.textContent = text;
  tip.style.left = x+"px"; tip.style.top = y+"px";
  document.body.appendChild(tip);
  _tooltipEl = tip;
}
function hideTooltip(){ if(_tooltipEl){ _tooltipEl.remove(); _tooltipEl=null; } }

function showHelp(){
  const old = document.getElementById("mhmm-help-modal");
  if (old) old.remove();

  const wrap = document.createElement("div");
  wrap.id = "mhmm-help-modal";
  wrap.className = "mhmm-modal";
  wrap.innerHTML = `
    <div class="mhmm-modal-inner" role="dialog" aria-modal="true" aria-label="User Guide">
      <div class="mhmm-modal-head">
        <span>User Guide</span>
        <button class="mhmm-modal-close" id="mhmm-help-close">Close</button>
      </div>
      <div class="mhmm-modal-body" id="mhmm-help-body"></div>
    </div>
  `;
  document.body.appendChild(wrap);

  const body = wrap.querySelector("#mhmm-help-body");
  body.textContent = HELP_TEXT;

  wrap.addEventListener("click", (e)=>{
    if(e.target === wrap) closeHelp();
  });
  wrap.querySelector("#mhmm-help-close").addEventListener("click", closeHelp);

  function onKey(e){
    if(e.key === "Escape"){ e.preventDefault(); closeHelp(); }
  }
  document.addEventListener("keydown", onKey, { once:true });

}

function closeHelp(){
  const modal = document.getElementById("mhmm-help-modal");
  if(modal) modal.remove();
}

(function init(){
  injectStyles();
  buildPanel();
})();
