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
const HELP_TEXT = `
[Middle-click toggle] Middle-click on a non-interactive area to open/close the panel (autoscroll suppressed). Alt + Middle-click forces toggle anywhere, including inside the panel and on buttons/inputs.

[Recommendation] I suggest configuring a map in the Python desktop version first, then exporting its .json and importing it here. 
[Import tip] In the Python app, use “Import ingame map” and copy goals from the MouseHunt Active Maps → Goals panel (start at the first “Missing …” and drag to the last mouse name) before pasting. 
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
- Thank-you message: Auto-copied when you mark an item as completed (for quick reply).
- User Guide: Open this help window.
- Reset run: Clear the Completed checkbox for all items (no other fields are changed).
- Generate LF message: Build the LF list and auto-copy the first 10 lines to the clipboard.
- Copy: Copy the current generated result again (first 10 lines).
- Increase/Decrease all unsniped price: Batch price adjust (see Section VI).

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
`;


const GM_KEYS = {
  LAST_SNAPSHOT: "mhmm:last_snapshot",
  LAST_FILENAME: "mhmm:last_filename",
  PANEL_VISIBLE: "mhmm:panel_visible"
};

const ui = {};

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
    sidenotes: ""
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
function playBeep(){
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
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
}
function isInteractiveElement(el){
  return !!(el && el.closest('a, button, input, textarea, select, summary, [contenteditable]'));
}
const App = {
  data: {
    intro_line: "LF Snipers: (Overnight OK)",
    regions: [],
    search_prefix: DEFAULT_SEARCH_PREFIX,
    thankyou_text: THANKYOU_TEXT
  },
  undoStack: [],
  redoStack: [],
  MAX_UNDO: 20,
  suspendHistory: false,
  lastMessageText: "",
  msgItemsData: [],
  todoItemsData: [],
  currentFilename: GM_getValue(GM_KEYS.LAST_FILENAME, "mapping_manager.json")
};
function recordUndo(){
  if(App.suspendHistory) return;
  const snap = {
    data: deepClone(App.data),
    intro: App.data.intro_line,
    selectionId: getSelectedRowId()
  };
  App.undoStack.push(snap);
  if(App.undoStack.length > App.MAX_UNDO) App.undoStack.shift();
  App.redoStack = [];
}
function restoreSnapshot(snap){
  App.suspendHistory = true;
  try{
    App.data = deepClone(snap.data);
    refreshTree();
    updateTodoList();
    setControlInputs(App.data.intro_line, App.data.search_prefix, App.data.thankyou_text);
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
  const cur = { data: deepClone(App.data), intro: App.data.intro_line, selectionId: getSelectedRowId() };
  App.redoStack.push(cur);
  const snap = App.undoStack.pop();
  restoreSnapshot(snap);
}
function redo(){
  if(!App.redoStack.length) return;
  const cur = { data: deepClone(App.data), intro: App.data.intro_line, selectionId: getSelectedRowId() };
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
.mhmm-col-name{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
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
          <div class="mhmm-grid">
            <div>
              <label class="mhmm-small">LF message</label>
              <input id="mhmm-intro" type="text" />
            </div>
            <div>
              <label class="mhmm-small">Right click search prefix</label>
              <input id="mhmm-prefix" type="text" />
            </div>
			<div>
              <label class="mhmm-small">Thank-you message</label>
              <input id="mhmm-thanks" type="text" />
            </div>
          </div>
          <div class="mhmm-btns-row" style="margin-top:8px;">
            <button id="mhmm-btn-save">Save</button>
            <button id="mhmm-btn-export">Export</button>
            <button id="mhmm-btn-import">Import</button>
            <button id="mhmm-btn-undo">Undo</button>
            <button id="mhmm-btn-redo">Redo</button>
          </div>
		  <div class="mhmm-btns-row" style="margin-top:6px;">
			<button id="mhmm-btn-help">User Guide</button>
			<button id="mhmm-btn-reset">Reset run</button>
			<button id="mhmm-btn-gen">Generate LF message</button>
			<button id="mhmm-copy">Copy</button>
		  </div>
          <div class="mhmm-btns-row" style="margin-top:6px;">
            <button id="mhmm-btn-inc">Increase all unsniped price</button>
            <button id="mhmm-btn-dec">Decrease all unsniped price</button>
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

  ui.intro = document.getElementById("mhmm-intro");
  ui.prefix = document.getElementById("mhmm-prefix");
  ui.btnSave = document.getElementById("mhmm-btn-save");
  ui.btnExport = document.getElementById("mhmm-btn-export");
  ui.btnImport = document.getElementById("mhmm-btn-import");
  ui.btnReset = document.getElementById("mhmm-btn-reset");
  ui.btnGen = document.getElementById("mhmm-btn-gen");
  ui.btnUndo = document.getElementById("mhmm-btn-undo");
  ui.btnRedo = document.getElementById("mhmm-btn-redo");
  ui.btnInc = document.getElementById("mhmm-btn-inc");
  ui.btnDec = document.getElementById("mhmm-btn-dec");
  ui.thanks = document.getElementById("mhmm-thanks");
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
  ui.btnInc.addEventListener("click", onIncreasePrice);
  ui.btnDec.addEventListener("click", onDecreasePrice);
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

  ui.intro.addEventListener("input", ()=>{ App.data.intro_line = ui.intro.value; persistAuto(); });
  ui.prefix.addEventListener("input", ()=>{ App.data.search_prefix = ui.prefix.value; persistAuto(); });
  ui.thanks.addEventListener("input", ()=>{ App.data.thankyou_text = ui.thanks.value; persistAuto(); });

  document.addEventListener("keydown", (e)=>{
    if(!panelVisible()) return;
    if(e.ctrlKey && !e.shiftKey && e.key.toLowerCase()==="z"){ e.preventDefault(); undo(); }
    if((e.ctrlKey && e.key.toLowerCase()==="y") || (e.ctrlKey && e.shiftKey && e.key.toLowerCase()==="z")){
      e.preventDefault(); redo();
    }
  });

  const last = GM_getValue(GM_KEYS.LAST_SNAPSHOT, null);
  if(last){ try{ App.data = JSON.parse(last); }catch(_){} }
  if(!App.data.thankyou_text) App.data.thankyou_text = THANKYOU_TEXT;
  setControlInputs(App.data.intro_line, App.data.search_prefix, App.data.thankyou_text);
  refreshTree();
  updateTodoList();
  onGenerateMessage(false);
  updateStats();
  if(GM_getValue(GM_KEYS.PANEL_VISIBLE, false)) setPanelVisible(true);
  GM_registerMenuCommand("Toggle MH MM Panel", ()=> setPanelVisible(!panelVisible()));
  GM_registerMenuCommand("Open MH MM User Guide", ()=> showHelp());
}

function onMiddleToggleDown(e){
  const isMiddle = (e.button === 1) || (e.which === 2);
  if (!isMiddle) return;

  if (!ui || !ui.panel) return;

  const force = e.altKey;                         
  const onInteractive = isInteractiveElement(e.target); 

  if (force || !onInteractive) {
    e.preventDefault();
    e.stopPropagation();
    setPanelVisible(!panelVisible());
  }
}

document.addEventListener('mousedown', onMiddleToggleDown, { capture: true, passive: false });


function setControlInputs(intro, prefix, thanks){
  ui.intro.value = intro || "";
  ui.prefix.value = prefix || DEFAULT_SEARCH_PREFIX;
  ui.thanks.value = (thanks == null ? THANKYOU_TEXT : thanks);
}

function panelVisible(){ return ui.panel.classList.contains("show"); }
function setPanelVisible(v){
  if(v) ui.panel.classList.add("show"); else ui.panel.classList.remove("show");
  GM_setValue(GM_KEYS.PANEL_VISIBLE, !!v);
}

let _selectedId = null;
function refreshTree(){
  ui.tree.innerHTML = "";
  const rows = [];
  (function visit(nodes, depth){
    for(const n of (nodes||[])){
      rows.push({ node:n, depth });
      if(n.children && n.children.length) visit(n.children, depth+1);
    }
  })(App.data.regions||[], 0);

  for(const {node:n, depth} of rows){
  const row = document.createElement("div");
  row.className = "mhmm-row";
  row.dataset.id = n.id;
  if(_selectedId === n.id) row.classList.add("selected");
  const pad = "&nbsp;".repeat(depth*3);

  const mark = (v)=> v ? "✓" : "&#8203;";  

  row.innerHTML = `
    <div class="mhmm-col-name">${pad}${escapeHtml(n.name||"")}</div>
    <div class="mhmm-col-center">${mark(!!n.needs_snipe)}</div>
    <div class="mhmm-col-center">${mark(!!n.include)}</div>
    <div class="mhmm-col-center">${mark(!!n.completed)}</div>
    <div class="mhmm-col-center">${Number(n.price||0)}</div>
  `;
    row.addEventListener("click", ()=> selectRow(n.id));
	const snipeCell = row.children[1]; 
    const needCell  = row.children[2]; 

  if (snipeCell) {
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
  }

  if (needCell) {
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
  }
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
  ui.edName.value = node.name || "";
  ui.edInclude.checked = !!node.include;
  ui.edCompleted.checked = !!node.completed;
  ui.edOverride.value = node.override_message || "";
  ui.edSnipe.checked = !!node.needs_snipe;
  ui.edPrice.value = Number(node.price||0);
  ui.edNotes.value = node.sidenotes || "";
}
function clearEditor(){
  ui.edName.value = "";
  ui.edInclude.checked = true;
  ui.edCompleted.checked = false;
  ui.edOverride.value = "";
  ui.edSnipe.checked = false;
  ui.edPrice.value = 0;
  ui.edNotes.value = "";
}
function bumpPrice(delta){
  const [node] = findNodeAndParentList(App.data.regions, _selectedId);
  if(!node) return;
  recordUndo();
  const cur = Number(node.price||0);
  node.price = cur + delta;
  ui.edPrice.value = node.price;
  refreshTree(); updateTodoList(); onGenerateMessage(false);
  copyText(App.data.thankyou_text || THANKYOU_TEXT); persistAuto();
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
  const p = parseInt(ui.edPrice.value, 10);
  node.price = isNaN(p) ? 0 : p;
  refreshTree(); updateTodoList(); onGenerateMessage(false);
  persistAuto(); flashTitle("Applied"); playBeep();
}

function onAddRegion(){
  recordUndo();
  App.data.regions.push(defaultNode("New Region", "region"));
  refreshTree(); updateTodoList(); persistAuto();playBeep();
}
function onAddSubgroup(){
  const [node] = findNodeAndParentList(App.data.regions, _selectedId);
  if(!node){ alert("Select a Region or Subgroup to add under it."); return; }
  if(node.type!=="region" && node.type!=="subgroup"){ alert("Only under Region or Subgroup."); return; }
  recordUndo();
  node.children.push(defaultNode("New Subgroup", "subgroup"));
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

function onResetRun(){
  if(!confirm(`Set all 'Completed' flags to unchecked?`)) return;
  recordUndo();
  for(const n of preorderIter(App.data.regions)) n.completed = false;
  refreshTree(); updateTodoList(); persistAuto();playBeep();
}
function onGenerateMessage(autoCopy){
  const intro = (App.data.intro_line||"").trim();
  const lines = intro ? [intro] : [];
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
  for(const [price, name, id] of entries){
    const line = `${name}: ${price}`;
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
        copyText(App.data.thankyou_text || THANKYOU_TEXT); flashTitle(`Completed: ${name}`);
        persistAuto();
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
  const lines = (App.lastMessageText || "").split(/\r?\n/);
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
      copyText(App.data.thankyou_text || THANKYOU_TEXT); flashTitle(`Completed: ${name}`);
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

function persistAuto(){ GM_setValue(GM_KEYS.LAST_SNAPSHOT, JSON.stringify(App.data)); }
function onSave(){ persistAuto(); onGenerateMessage(false); flashTitle("Saved"); playBeep(); }
function onExport(){
  const name = App.currentFilename || "mapping_manager.json";
  App.data.intro_line = ui.intro.value;
  App.data.search_prefix = ui.prefix.value || DEFAULT_SEARCH_PREFIX;
  App.data.thankyou_text = ui.thanks.value || THANKYOU_TEXT; 
  downloadText(name, JSON.stringify(App.data, null, 2));
}
async function onImport(){
  try{
    const {data, name} = await uploadJSONFile();
    if(!data || !Array.isArray(data.regions)){ alert("Invalid file format."); return; }
    recordUndo();
    App.data = {
      intro_line: data.intro_line || "LF Snipers: (Overnight OK)",
      regions: data.regions,
      search_prefix: data.search_prefix || DEFAULT_SEARCH_PREFIX,
	  thankyou_text: data.thankyou_text || THANKYOU_TEXT
    };
    App.currentFilename = name || "mapping_manager.json";
    GM_setValue(GM_KEYS.LAST_FILENAME, App.currentFilename);
    setControlInputs(App.data.intro_line, App.data.search_prefix, App.data.thankyou_text);
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
