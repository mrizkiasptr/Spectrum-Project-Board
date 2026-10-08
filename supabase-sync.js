/* SPEctrum × Supabase: sign-in gate + persistence for the prototype's in-memory stores.
   The board keeps all its data in top-level stores (tasks, BACKLOG, SPR, ...). Each store is one row
   in public.spectrum_board_state. On boot the rows replace the seed data; after that every change is
   detected by comparing each store's JSON with what was last saved, and only changed stores are written.
   Changes made by other people arrive over Realtime and re-render the board.
   Loaded before the main script; it reads the main script's stores lazily, so declaration order is fine. */
(function () {
  const CFG = window.SPX_CONFIG || {};

  /* [row key, getter, setter for primitives]. Objects, arrays and Sets are refilled in place, so any
     reference the board already holds stays valid. UI-only fields are listed in OMIT and never saved. */
  const STORES = () => [
    ["MD", () => MD], ["TEAM", () => TEAM],
    ["DIVISIONS", () => DIVISIONS], ["DEPARTMENTS", () => DEPARTMENTS], ["POSITIONS", () => POSITIONS],
    ["ACCESS_ROLES", () => ACCESS_ROLES], ["POSITION_ROLES", () => POSITION_ROLES],
    ["COLS", () => COLS], ["colSeq", () => colSeq, v => { colSeq = v; }],
    ["BACKLOG", () => BACKLOG], ["tasks", () => tasks], ["seq", () => seq, v => { seq = v; }],
    ["SPRINTS", () => SPRINTS], ["SBL", () => SBL], ["SPR", () => SPR], ["SDOC", () => SDOC],
    ["MT_DATA", () => MT_DATA], ["mtSeq", () => mtSeq, v => { mtSeq = v; }],
    ["EMP_DIVISIONS", () => EMP_DIVISIONS], ["EMP_JOBPOS", () => EMP_JOBPOS],
    ["EMP_DEPARTMENTS", () => EMP_DEPARTMENTS], ["DEPT_MAP", () => DEPT_MAP], ["EMPLOYEES", () => EMPLOYEES],
    ["PLANNED", () => PLANNED], ["INVENTORY", () => INVENTORY], ["blSeq", () => blSeq, v => { blSeq = v; }],
    ["CARRY_TASKS", () => CARRY_TASKS], ["DRAFTS", () => DRAFTS], ["TRAIL", () => TRAIL],
    ["LABELS", () => LABELS], ["INC", () => INC], ["SPT", () => SPT], ["SBL_EXTRA", () => SBL_EXTRA],
    ["tSeq", () => tSeq, v => { tSeq = v; }]
  ];
  const OMIT = { MD: ["open"], SDOC: ["cat", "q", "form"] };

  /* ---------- JSON with Sets and Dates ---------- */
  function enc(key, v) {
    const omit = OMIT[key];
    return JSON.stringify(v, function (k, x) {
      if (omit && this === v && omit.includes(k)) return undefined;
      const raw = this[k];
      if (raw instanceof Set) return { $set: [...raw] };
      if (raw instanceof Date) return { $date: raw.toISOString() };
      return x;
    });
  }
  const dec = s => JSON.parse(s, (k, x) => {
    if (x && typeof x === "object" && !Array.isArray(x)) {
      const ks = Object.keys(x);
      if (ks.length === 1 && ks[0] === "$set" && Array.isArray(x.$set)) return new Set(x.$set);
      if (ks.length === 1 && ks[0] === "$date") return new Date(x.$date);
    }
    return x;
  });
  function fill(key, target, v, set) {
    if (set) { set(v); return; }
    if (target instanceof Set) { target.clear(); v.forEach(x => target.add(x)); return; }
    if (Array.isArray(target)) { target.length = 0; target.push(...v); return; }
    const omit = OMIT[key] || [];
    Object.keys(target).forEach(k => { if (!omit.includes(k)) delete target[k]; });
    Object.assign(target, v);
  }

  /* ---------- Gate, account chip, styles ----------
     Split layout based on the Figma login page (Spectrum V.2, node 505:7032), scaled down to sit
     comfortably on a laptop screen: brand top-left, headline + form centred in the left half,
     a compact product preview centred in the right half. Every pre-board screen (sign in, create
     account, reset password, "which one is you") renders in the left half. */
  const css = `
.spx-gate{position:fixed;inset:0;z-index:9999;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);overflow:auto;background:var(--surface,#fff);color:var(--text,#2d2d2d);font-family:var(--f-ui,system-ui,sans-serif);--spx-p:#0c6ef9;--spx-mute:var(--placeholder,#777e92);--spx-line:var(--border,#e7e7e9)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .spx-gate{--spx-p:#4c93ff}}
:root[data-theme="dark"] .spx-gate{--spx-p:#4c93ff}
.spx-left{display:flex;flex-direction:column;min-height:100vh;padding:28px 40px}
.spx-logo{display:flex;align-items:center;gap:10px}
.spx-logo b{font:700 18px/24px "Plus Jakarta Sans",var(--f-ui,system-ui,sans-serif);color:var(--spx-p)}
.spx-main{width:100%;max-width:400px;margin:auto;padding:32px 0}
.spx-hero{margin-bottom:32px}
.spx-hero h1{font:700 30px/38px var(--f-ui,system-ui,sans-serif);letter-spacing:-.01em;margin:0 0 12px;color:var(--text,#2d2d2d)}
.spx-hero p{font:400 15px/24px var(--f-ui,system-ui,sans-serif);margin:0;color:var(--spx-mute)}
.spx-foot{text-align:center;font-size:13px;line-height:20px;color:var(--spx-mute)}
.spx-card{width:100%}
.spx-card h1,.spx-h2{font:700 24px/32px var(--f-ui,system-ui,sans-serif);margin:0 0 6px}
.spx-card p.spx-note,.spx-card>p{margin:0 0 20px;color:var(--spx-mute);font-size:14px;line-height:22px}
.spx-ms{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:44px;padding:0 16px;border:1px solid var(--spx-line);border-radius:8px;background:var(--surface,#fff);color:var(--text,#2d2d2d);font:590 15px/20px var(--f-ui,system-ui,sans-serif);cursor:pointer}
.spx-ms svg{width:20px;height:20px}
.spx-ms:hover{background:var(--surface-muted,#f9f9f9)}
.spx-or{display:flex;align-items:center;gap:16px;margin:20px 0;color:var(--spx-mute);font-size:13px;line-height:20px;white-space:nowrap}
.spx-or::before,.spx-or::after{content:"";flex:1;height:1px;background:var(--spx-line)}
.spx-fields{display:flex;flex-direction:column;gap:16px}
.spx-field{position:relative;display:flex;align-items:center;gap:8px;height:44px;padding:0 12px;border:1.5px solid var(--spx-line);border-radius:8px;background:var(--surface,#fff);color:var(--spx-mute)}
.spx-field:focus-within{border-color:var(--spx-p)}
.spx-field svg{flex-shrink:0;width:18px;height:18px}
.spx-field input{flex:1;min-width:0;width:auto;height:100%;margin:0;padding:0;border:0;outline:0;background:transparent;color:var(--text,#2d2d2d);font:400 15px/20px var(--f-ui,system-ui,sans-serif)}
.spx-field input:focus,.spx-field input:focus-visible{outline:0!important;box-shadow:none}
.spx-field input::placeholder{color:var(--spx-mute);opacity:1}
.spx-eye{display:inline-flex;padding:2px;border-radius:4px;color:var(--spx-mute);cursor:pointer}
.spx-eye:hover{color:var(--text,#2d2d2d)}
.spx-card>.spx-field{margin-bottom:16px}
.spx-card input:not([type="radio"]):not(.spx-fi),.spx-card select{width:100%;height:44px;padding:0 12px;border:1.5px solid var(--spx-line);border-radius:8px;background:var(--surface,#fff);color:inherit;font:400 15px/20px var(--f-ui,system-ui,sans-serif);margin-bottom:14px}
.spx-card input:focus-visible,.spx-card select:focus-visible{outline:2px solid var(--spx-p);outline-offset:-1px}
.spx-card label{display:block;font-size:13px;font-weight:600;margin:0 0 6px}
.sr-only-spx{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.spx-actions{margin-top:24px}
.spx-primary{display:block;width:100%;height:44px;border-radius:8px;background:var(--spx-p)!important;color:#fff!important;font:590 15px/20px var(--f-ui,system-ui,sans-serif);cursor:pointer}
.spx-primary:hover{filter:brightness(.94)}
.spx-primary[disabled]{opacity:.6;cursor:progress}
.spx-help{margin:16px 0 0;font-size:14px;line-height:20px;color:var(--spx-mute)}
.spx-help+.spx-help{margin-top:8px}
.spx-switch{margin-top:16px;text-align:center;font-size:14px;color:var(--spx-mute)}
.spx-link,.spx-switch button{color:var(--spx-p);font-weight:590;cursor:pointer}
.spx-link,.spx-switch button{font-size:14px}
.spx-msg{font-size:13px;line-height:20px;border-radius:8px;padding:9px 12px;margin:0 0 14px}
.spx-msg.err{background:var(--red-50,#FEECEC);color:var(--red-900,#870808)}
.spx-msg.ok{background:var(--green-50,#F1F9F5);color:var(--green-700,#2D7753)}
.spx-msg:empty{display:none}
.spx-loading{display:flex;align-items:center;gap:10px;font-size:14px;color:var(--spx-mute)}
.spx-spin{width:18px;height:18px;border-radius:50%;border:2px solid var(--border,#e6e6e6);border-top-color:var(--spx-p);animation:spxspin .8s linear infinite}
@keyframes spxspin{to{transform:rotate(360deg)}}
.spx-right{position:sticky;top:0;align-self:start;height:100vh;display:flex;align-items:center;justify-content:center;padding:32px;overflow:hidden;border-left:1px solid var(--spx-line);background:color-mix(in srgb,var(--spx-p) 4%,var(--surface,#fff))}
.spx-stack{width:100%;max-width:340px;display:flex;flex-direction:column;gap:16px}
.spx-pcard,.spx-evcard,.spx-tt{padding:16px;border:1px solid var(--border,#dddfe2);border-radius:12px;background:var(--surface,#fff);box-shadow:0 1px 2px rgba(16,24,40,.04),0 8px 24px rgba(16,24,40,.05)}
.spx-pcard{display:flex;flex-direction:column;gap:10px}
.spx-pt{display:flex;gap:4px;align-items:baseline;font-size:14px;line-height:20px;white-space:nowrap}
.spx-lbl{font:590 11px/16px var(--f-ui,system-ui,sans-serif);color:var(--spx-mute)}
.spx-goal{margin:0;font-size:12px;line-height:16px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.spx-prog{display:flex;align-items:baseline;gap:6px}
.spx-prog .big{font:600 20px/24px "Plus Jakarta Sans",var(--f-ui,system-ui,sans-serif)}
.spx-prog .sm{font-size:13px;line-height:20px;margin-left:-3px}
.spx-prog .spx-cap{font-size:11px;line-height:16px;color:var(--spx-mute);white-space:nowrap}
.spx-prog b{margin-left:auto;font:700 12px/16px "Plus Jakarta Sans",var(--f-ui,system-ui,sans-serif)}
.spx-track{height:4px;border-radius:999px;background:var(--border,#dddfe2)}
.spx-track i{display:block;height:4px;border-radius:999px;background:var(--green-500,#46b881)}
.spx-meta{display:flex;flex-direction:column;align-items:flex-start;gap:8px;font-size:11px;line-height:16px;color:var(--spx-mute)}
.spx-meta b{display:block;margin-top:2px;font-weight:600;color:var(--text,#2d2d2d);white-space:nowrap}
.spx-chips{display:flex;gap:6px}
.spx-chips span{padding:4px 10px;border-radius:999px;background:#801fff;color:#fff;font:590 11px/14px var(--f-ui,system-ui,sans-serif);white-space:nowrap}
.spx-evcard{display:flex;flex-direction:column;gap:12px}
.spx-evh b{display:block;font:700 14px/20px "Plus Jakarta Sans",var(--f-ui,system-ui,sans-serif)}
.spx-evh span{display:block;font:500 12px/16px "Plus Jakarta Sans",var(--f-ui,system-ui,sans-serif);color:var(--spx-mute)}
.spx-evs{display:flex;flex-direction:column;gap:8px}
.spx-ev{display:flex;gap:8px;align-items:center;padding:8px 10px 8px 8px;border-radius:8px;background:color-mix(in srgb,var(--c) var(--t),var(--surface,#fff))}
.spx-ev>i{align-self:stretch;width:3px;border-radius:4px;background:var(--c);flex:none}
.spx-evbody{flex:1;min-width:0}
.spx-evbody b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:590 12px/16px var(--f-ui,system-ui,sans-serif)}
.spx-evmeta{display:flex;align-items:center;gap:8px;margin-top:2px;font-size:11px;line-height:16px;color:var(--spx-mute)}
.spx-avs{display:flex}
.spx-avs span{width:16px;height:16px;margin-right:-6px;border:1.5px solid var(--surface,#fff);border-radius:50%}
.spx-avs span:last-child{margin-right:0}
.spx-join{flex:none;padding:3px 10px;border:1px solid var(--spx-line);border-radius:6px;background:var(--surface,#fff);font:590 11px/16px var(--f-ui,system-ui,sans-serif)}
.spx-more{display:flex;gap:6px;align-items:center;justify-content:center;padding:5px 12px;border:1px solid var(--spx-p);border-radius:6px;color:var(--spx-p);font:590 12px/16px var(--f-ui,system-ui,sans-serif)}
.spx-more svg{width:14px;height:14px}
.spx-tt{display:flex;align-items:center;gap:10px}
.spx-tt b{font:700 24px/28px var(--f-ui,system-ui,sans-serif)}
.spx-tt span{font-size:13px;line-height:20px;color:var(--spx-mute)}
.spx-tt svg{margin-left:auto;flex:none}
.spx-acct{display:flex;align-items:center;gap:8px;padding:10px 16px 0;font-size:12px;color:var(--text-2,#455162);min-width:0}
.spx-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;background:var(--green-500,#46B881)}
.spx-dot[data-s="saving"]{background:var(--orange-500,#FFAD0D)}
.spx-dot[data-s="error"]{background:var(--red-500,#F54B4B)}
.spx-email{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.spx-out{padding:4px;border-radius:6px;color:var(--text-2,#455162);display:inline-flex}
.spx-out:hover{background:var(--surface-muted,#f9f9f9);color:var(--text,#2d2d2d)}
.app.collapsed .spx-email{display:none}
.app.collapsed .spx-acct{flex-direction:column;padding:10px 0 0}
.spx-list{display:flex;flex-direction:column;gap:6px;margin:0 0 14px;max-height:min(46vh,340px);overflow:auto;padding:2px}
.spx-card .spx-opt{display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--border,#e6e6e6);border-radius:8px;cursor:pointer;font-weight:400!important;margin:0!important}
.spx-opt:has(input:checked){border-color:var(--spx-p);background:var(--primary-soft,#EFF6FF)}
.spx-opt:has(input:disabled){cursor:not-allowed;opacity:.55}
.spx-opt input{width:16px!important;height:16px!important;margin:0!important;flex-shrink:0;accent-color:var(--spx-p)}
.spx-av{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:11px;font-weight:600;flex-shrink:0}
.spx-who{display:flex;flex-direction:column;min-width:0;font-size:13px;line-height:1.35}
.spx-who b{font-weight:600}
.spx-who small{color:var(--text-2,#455162);font-size:12px}
.spx-new{display:grid;gap:0;margin:0 0 6px}
@media (max-height:760px){.spx-tt,.spx-ev:nth-child(3){display:none}}
@media (max-height:600px){.spx-evcard{display:none}}
@media (max-width:1000px){
  .spx-gate{grid-template-columns:minmax(0,1fr)}
  .spx-right{display:none}
  .spx-left{padding:24px}
}
@media (max-width:600px){
  .spx-hero{margin-bottom:24px}
  .spx-hero h1{font-size:26px;line-height:34px}
  .spx-main{padding:24px 0}
}`;

  let gate, client, user, started = false;
  const last = {};
  const $g = s => gate.querySelector(s);
  const escH = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* Icons, drawn inline (the Figma asset files can't be fetched from the build sandbox). */
  const svg = (p, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const ICON = {
    mail: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7.5l8.5 6 8.5-6"/>'),
    lock: svg('<rect x="5" y="10.5" width="14" height="9.5" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>'),
    eye: svg('<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', 18),
    eyeOff: svg('<path d="M3 3l18 18"/><path d="M10.6 6.1A10 10 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.5 7.6A16.6 16.6 0 0 0 2 12s3.6 6 10 6a9.8 9.8 0 0 0 4.1-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>', 18),
    arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    ms: '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="9.5" height="9.5" fill="#F25022"/><rect x="12.5" y="2" width="9.5" height="9.5" fill="#7FBA00"/><rect x="2" y="12.5" width="9.5" height="9.5" fill="#00A4EF"/><rect x="12.5" y="12.5" width="9.5" height="9.5" fill="#FFB900"/></svg>'
  };
  /* One input row: icon, placeholder-as-label (with a hidden real label), optional show/hide eye. */
  function field({ id, type = "text", ph, icon, auto, value = "", eye = false }) {
    return `<div class="spx-field"><label for="${id}" class="sr-only-spx">${escH(ph)}</label>${ICON[icon]}
      <input class="spx-fi" id="${id}" type="${type}" placeholder="${escH(ph)}" autocomplete="${auto}" ${type === "password" ? 'minlength="6"' : ""} required value="${escH(value)}">
      ${eye ? `<button type="button" class="spx-eye" id="spxEye" aria-label="Show password" aria-pressed="false">${ICON.eyeOff}</button>` : ""}</div>`;
  }
  function bindEye() {
    const b = $g("#spxEye"); if (!b) return;
    b.onclick = () => {
      const i = $g("#spxPw"), show = i.type === "password";
      i.type = show ? "text" : "password";
      b.setAttribute("aria-pressed", show); b.setAttribute("aria-label", show ? "Hide password" : "Show password");
      b.innerHTML = show ? ICON.eye : ICON.eyeOff;
    };
  }

  /* Decorative product preview. Static sample content, hidden from assistive tech. */
  function previewHTML() {
    const d = new Date();
    const today = `${d.toLocaleDateString("en-US", { weekday: "long" })}, ${String(d.getDate()).padStart(2, "0")} ${d.toLocaleDateString("en-US", { month: "short" })} ${d.getFullYear()}`;
    const avs = a => `<div class="spx-avs">${a.map(c => `<span style="background:${c}"></span>`).join("")}</div>`;
    const ev = (c, t, title, time, a) => `<div class="spx-ev" style="--c:${c};--t:${t}%"><i></i><div class="spx-evbody"><b>${title}</b><div class="spx-evmeta"><span>${time}</span>${avs(a)}</div></div><span class="spx-join">Join</span></div>`;
    return `<div class="spx-stack">
      <div class="spx-pcard">
        <div class="spx-pt"><b>E Collection</b><span>-</span><span>Sprint 5_2025</span></div>
        <div><div class="spx-lbl">Sprint Goals</div>
          <p class="spx-goal">Meningkatkan keandalan dan visibilitas proses SFTP melalui finalisasi konfigurasi, logging, dan skema resend untuk mendukung monitoring system yang ada</p></div>
        <div><div class="spx-lbl">Sprint Progress</div>
          <div class="spx-prog"><span class="big">12</span><span class="sm">/24</span><span class="spx-cap">Total of task</span><b>50%</b></div></div>
        <div class="spx-track"><i style="width:50%"></i></div>
        <div class="spx-meta"><div>Timebox<b>Sept 21 - Sept 25, 2022</b></div><div class="spx-chips"><span>10 Days Timebox</span><span>4 Days Left</span></div></div>
      </div>
      <div class="spx-evcard">
        <div class="spx-evh"><b>Today’s Event</b><span>${today}</span></div>
        <div class="spx-evs">
          ${ev("#0c6ef9", 8, "Daily scrum - Spectrum Sprint 12", "09.00 - 09.15", ["#0779E4", "#7c3aed", "#db2777"])}
          ${ev("#ffad0d", 8, "Weekly UI/UX", "11.00 - 12.00", ["#f59e0b", "#0891b2", "#64748b"])}
          ${ev("#a865ff", 12, "Qrisan - Sprint Review &amp; Retro", "13.00 - 15.00", ["#059669", "#b45309", "#0779E4"])}
        </div>
        <div class="spx-more">See More ${ICON.arrow}</div>
      </div>
      <div class="spx-tt"><b>20</b><span>Total Task</span>
        <svg width="40" height="40" viewBox="0 0 100 100" aria-hidden="true"><path d="M8 62 38 18l50 10 8 52-46 16z" fill="color-mix(in srgb,#0c6ef9 12%,var(--surface,#fff))"/><rect x="36" y="38" width="30" height="38" rx="5" fill="#0c6ef9"/><rect x="43" y="33" width="16" height="9" rx="3" fill="#0c6ef9" stroke="var(--surface,#fff)" stroke-width="2"/><path d="M43 52h16M43 60h16M43 68h10" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg></div>
    </div>`;
  }

  function mountGate() {
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    gate = document.createElement("div"); gate.className = "spx-gate"; gate.setAttribute("role", "dialog");
    gate.setAttribute("aria-modal", "true"); gate.setAttribute("aria-labelledby", "spxTitle");
    gate.innerHTML = `<section class="spx-left">
        <div class="spx-logo"><div class="logo-mark">S</div><b>SPEctrum</b></div>
        <div class="spx-main">
          <div class="spx-hero" id="spxHero" hidden><h1 id="spxHeroTitle">Simplify Work, Collaborate Better, Deliver More</h1>
            <p>Organize tasks, monitor progress, and ensure every project stays on track — effortlessly and efficiently.</p></div>
          <div class="spx-body" id="spxBody"></div>
        </div>
        <div class="spx-foot">Powered by SPE Solution 2025</div>
      </section>
      <aside class="spx-right" aria-hidden="true">${previewHTML()}</aside>`;
    document.body.appendChild(gate);
    document.getElementById("app")?.setAttribute("aria-hidden", "true");
  }
  /* Every pre-board screen renders into the left column through here. A form tagged data-hero also shows the headline. */
  const stage = {
    set html(h) {
      $g("#spxBody").innerHTML = h;
      const hero = /data-hero/.test(h);
      $g("#spxHero").hidden = !hero;
      gate.setAttribute("aria-labelledby", hero ? "spxHeroTitle" : "spxTitle");
    }
  };
  function loading(text) {
    stage.html = `<div class="spx-loading" role="status"><span class="spx-spin" aria-hidden="true"></span>${escH(text)}</div>`;
  }
  function fatal(text, retry) {
    stage.html = `<div class="spx-card"><h1 id="spxTitle">Can't load the board</h1><div class="spx-msg err" role="alert">${escH(text)}</div>
      <button type="button" class="spx-primary" id="spxRetry">Try again</button></div>`;
    $g("#spxRetry").onclick = retry;
  }
  function showLogin(mode = "in", msg = "", ok = false) {
    const up = mode === "up";
    stage.html = `<form class="spx-card" data-hero novalidate>
      ${up
        ? `<h2 class="spx-h2" id="spxFormTitle">Create your account</h2><p class="spx-note">Use your work email. You can start right away, no confirmation email needed.</p>`
        : `<button type="button" class="spx-ms" id="spxMs">${ICON.ms}<span>Sign in with Microsoft</span></button><div class="spx-or" role="separator">or sign in with</div>`}
      <div class="spx-msg ${ok ? "ok" : "err"}" role="${ok ? "status" : "alert"}">${escH(msg)}</div>
      <div class="spx-fields">
        ${field({ id: "spxEmail", type: "email", ph: "Email", icon: "mail", auto: "email" })}
        ${field({ id: "spxPw", type: "password", ph: "Password", icon: "lock", auto: up ? "new-password" : "current-password", eye: true })}
      </div>
      <div class="spx-actions">
        <button type="submit" class="spx-primary">${up ? "Create account" : "Sign In"}</button>
        ${up
          ? `<p class="spx-help">Already have an account? <button type="button" class="spx-link" id="spxMode">Sign in</button></p>`
          : `<p class="spx-help">Having trouble signing in? <button type="button" class="spx-link" id="spxForgot">Reset your password</button></p>
             <p class="spx-help">New to SPEctrum? <button type="button" class="spx-link" id="spxMode">Create an account</button></p>`}
      </div>
    </form>`;
    $g("#spxEmail").focus();
    bindEye();
    $g("#spxMode").onclick = () => showLogin(up ? "in" : "up");
    if (!up) {
      $g("#spxForgot").onclick = () => showForgot($g("#spxEmail").value.trim());
      $g("#spxMs").onclick = async () => {
        const m = $g(".spx-msg"); m.className = "spx-msg err";
        if (!CFG.microsoft) { m.textContent = "Sign in with Microsoft isn't set up for this project yet. Use your email and password."; return; }
        const { error } = await client.auth.signInWithOAuth({ provider: "azure", options: { scopes: "email", redirectTo: location.origin + location.pathname } });
        if (error) m.textContent = error.message;
      };
    }
    $g("form").onsubmit = async e => {
      e.preventDefault();
      const email = $g("#spxEmail").value.trim(), password = $g("#spxPw").value, btn = $g(".spx-primary"), m = $g(".spx-msg");
      if (!email || !password) { m.className = "spx-msg err"; m.textContent = "Enter your email and password."; return; }
      if (up && password.length < 6) { m.className = "spx-msg err"; m.textContent = "Use at least 6 characters for your password."; return; }
      btn.disabled = true; btn.textContent = up ? "Creating account…" : "Signing in…";
      if (up) {
        /* The signup Edge Function creates the account already confirmed, then we sign in as usual. */
        const { error } = await client.functions.invoke("signup", { body: { email, password } });
        if (error) {
          let t = "Couldn't create the account. Check your connection and try again.";
          try { const j = await error.context.json(); if (j && j.error) t = j.error; } catch (_) {}
          showLogin("up", t); $g("#spxEmail").value = email; return;
        }
      }
      const res = await client.auth.signInWithPassword({ email, password });
      if (res.error) {
        const t = /invalid login/i.test(res.error.message) ? "That email and password don't match. Check them and try again."
          : /not confirmed/i.test(res.error.message) ? "Confirm your email first: open the link we sent you, then sign in."
          : res.error.message;
        showLogin(mode, t); $g("#spxEmail").value = email; return;
      }
      enter(res.data.session);
    };
  }

  /* ---------- Who am I on the team ----------
     The board shows "my" tasks, timers and assignments for one team member (ME). Each account claims
     one member, kept in the MEMBER_CLAIMS row as {memberKey: {uid, email}}. A person who isn't in the
     team list adds themselves, which also adds them to Team & Capacity. */
  const CLAIMS = "MEMBER_CLAIMS";
  let claims = {}, meKey = null;
  const ROLE_POS = { fe: "dev_fe", se: "dev_be", qa: "qa_eng" };
  const NEW_COLORS = ["#0779E4", "#7c3aed", "#db2777", "#059669", "#0891b2", "#b45309", "#64748b", "#dc2626", "#4f46e5", "#0d9488"];
  const initials = n => String(n).trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase();
  function syncPeople() {
    Object.entries(TEAM).forEach(([k, p]) => { PEOPLE[k] = { name: p.short, ini: initials(p.name), c: p.c }; });
  }
  async function readClaims() {
    const { data, error } = await client.from(CFG.table).select("data").eq("key", CLAIMS).maybeSingle();
    if (error) throw error;
    claims = data && typeof data.data === "string" ? JSON.parse(data.data) : {};
  }
  async function writeClaims() {
    const s = JSON.stringify(claims);
    const { error } = await client.from(CFG.table).upsert({ key: CLAIMS, data: s });
    if (error) throw error;
    last[CLAIMS] = s;
  }
  const myClaim = () => Object.keys(claims).find(k => claims[k] && claims[k].uid === user.id && TEAM[k]);
  function pickMember() {
    return new Promise(resolve => {
      const taken = k => claims[k] && claims[k].uid !== user.id;
      const opts = Object.entries(TEAM).map(([k, p]) => `<label class="spx-opt"><input type="radio" name="spxMe" value="${escH(k)}" ${taken(k) ? "disabled" : ""}>
          <span class="spx-av" style="background:${escH(p.c)}" aria-hidden="true">${escH(initials(p.name))}</span>
          <span class="spx-who"><b>${escH(p.name)}</b><small>${escH(ROLES[p.role] || p.role)}${taken(k) ? ` · linked to ${escH(claims[k].email || "another account")}` : ""}</small></span></label>`).join("");
      stage.html = `<form class="spx-card wide" novalidate>
        <h1 id="spxTitle">Which one is you?</h1>
        <p>Pick your name so My Task, your timer and "assigned to me" show your own work. You only do this once.</p>
        <div class="spx-msg err" role="alert"></div>
        <fieldset style="border:0;padding:0;margin:0"><legend class="sr-only" style="position:absolute;left:-9999px">Team member</legend>
        <div class="spx-list">${opts}
          <label class="spx-opt"><input type="radio" name="spxMe" value="__new"><span class="spx-who"><b>I'm not on this list</b><small>Add yourself to the team</small></span></label>
        </div></fieldset>
        <div class="spx-new" hidden>
          <label for="spxName">Full name</label><input id="spxName" autocomplete="name">
          <label for="spxRole">Role</label><select id="spxRole">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${escH(v)}</option>`).join("")}</select>
        </div>
        <button type="submit" class="spx-primary">Continue</button>
      </form>`;
      const f = $g("form"), msg = $g(".spx-msg"), nw = $g(".spx-new");
      f.addEventListener("change", () => { nw.hidden = f.spxMe.value !== "__new"; if (!nw.hidden) $g("#spxName").focus(); });
      f.onsubmit = async e => {
        e.preventDefault();
        const v = f.spxMe.value, btn = $g(".spx-primary");
        if (!v) { msg.textContent = "Pick your name, or choose \"I'm not on this list\"."; return; }
        let key = v;
        if (v === "__new") {
          const name = $g("#spxName").value.trim();
          if (!name) { msg.textContent = "Enter your full name."; $g("#spxName").focus(); return; }
          key = "m" + Math.random().toString(36).slice(2, 8);
          TEAM[key] = { name, short: name.split(/\s+/)[0], role: $g("#spxRole").value, c: NEW_COLORS[Object.keys(TEAM).length % NEW_COLORS.length], done: 0, total: 0, w: 0, hrs: 0, leave: 0 };
        }
        btn.disabled = true; btn.textContent = "Saving…";
        try {
          await readClaims(); /* someone may have claimed it a moment ago */
          if (claims[key] && claims[key].uid !== user.id) { if (v === "__new") delete TEAM[key]; msg.textContent = "Someone just linked that name to their account. Pick another one."; btn.disabled = false; btn.textContent = "Continue"; return pickMember().then(resolve); }
          Object.keys(claims).forEach(k => { if (claims[k].uid === user.id) delete claims[k]; });
          claims[key] = { uid: user.id, email: user.email || "" };
          await writeClaims();
        } catch (err) {
          console.error(err); if (v === "__new") delete TEAM[key];
          msg.textContent = "Couldn't save your choice. Check your connection and try again."; btn.disabled = false; btn.textContent = "Continue"; return;
        }
        resolve(key);
      };
    });
  }
  function becomeMember(key) {
    meKey = key; ME = key; syncPeople();
    const pos = ROLE_POS[TEAM[key].role]; if (pos && POSITIONS[pos]) CUR_POS = pos;
  }

  function showForgot(email = "", msg = "", ok = false) {
    stage.html = `<form class="spx-card" novalidate>
      <h1 id="spxTitle">Reset your password</h1>
      <p>Enter the email you sign in with. We'll send you a link to set a new password.</p>
      <div class="spx-msg ${ok ? "ok" : "err"}" role="${ok ? "status" : "alert"}">${escH(msg)}</div>
      ${field({ id: "spxEmail", type: "email", ph: "Email", icon: "mail", auto: "email", value: email })}
      <button type="submit" class="spx-primary">Send reset link</button>
      <div class="spx-switch"><button type="button" id="spxBack">Back to sign in</button></div>
    </form>`;
    $g("#spxEmail").focus();
    $g("#spxBack").onclick = () => showLogin();
    $g("form").onsubmit = async e => {
      e.preventDefault();
      const em = $g("#spxEmail").value.trim(), btn = $g(".spx-primary");
      if (!em) { showForgot("", "Enter your email."); return; }
      btn.disabled = true; btn.textContent = "Sending…";
      const { error } = await client.auth.resetPasswordForEmail(em, { redirectTo: location.origin + location.pathname });
      if (error) { showForgot(em, /rate limit|too many/i.test(error.message) ? "Too many attempts. Wait a minute, then try again." : error.message); return; }
      showForgot(em, `If ${em} has an account, a reset link is on its way. Open it on this device.`, true);
    };
  }
  let pwShown = false;
  function showNewPassword(session, msg = "") {
    pwShown = true;
    stage.html = `<form class="spx-card" novalidate>
      <h1 id="spxTitle">Set a new password</h1>
      <p>For ${escH(session.user.email || "your account")}. Use at least 6 characters.</p>
      <div class="spx-msg err" role="alert">${escH(msg)}</div>
      ${field({ id: "spxPw", type: "password", ph: "New password", icon: "lock", auto: "new-password", eye: true })}
      <button type="submit" class="spx-primary">Save and sign in</button>
    </form>`;
    $g("#spxPw").focus(); bindEye();
    $g("form").onsubmit = async e => {
      e.preventDefault();
      const pw = $g("#spxPw").value, btn = $g(".spx-primary");
      if (pw.length < 6) { showNewPassword(session, "Use at least 6 characters."); return; }
      btn.disabled = true; btn.textContent = "Saving…";
      const { error } = await client.auth.updateUser({ password: pw });
      if (error) { showNewPassword(session, error.message); return; }
      recovering = false; enter(session);
    };
  }

  function mountAccount() {
    const side = document.querySelector(".side"), role = document.getElementById("sideRole");
    if (!side || !role) return;
    const el = document.createElement("div"); el.className = "spx-acct"; el.id = "spxAcct";
    el.innerHTML = `<span class="spx-dot" id="spxDot" data-s="saved" role="status" aria-label="All changes saved" title="All changes saved"></span>
      <span class="spx-email" title="${escH((TEAM[meKey] ? TEAM[meKey].name + " · " : "") + (user.email || ""))}">${escH(TEAM[meKey] ? TEAM[meKey].name : user.email || "Signed in")}</span>
      <button type="button" class="spx-out" id="spxOut" aria-label="Sign out" title="Sign out"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/></svg></button>`;
    side.insertBefore(el, role);
    el.querySelector("#spxOut").onclick = async () => { await flush(); await client.auth.signOut(); location.reload(); };
  }
  function status(s) {
    const d = document.getElementById("spxDot"); if (!d) return;
    const t = { saved: "All changes saved", saving: "Saving changes…", error: "Couldn't save. Retrying automatically." }[s];
    d.dataset.s = s; d.title = t; d.setAttribute("aria-label", t);
  }

  /* ---------- Load, save, realtime ---------- */
  async function load() {
    const { data, error } = await client.from(CFG.table).select("key,data");
    if (error) throw error;
    const rows = Object.fromEntries(data.map(r => [r.key, r.data]));
    try { claims = typeof rows[CLAIMS] === "string" ? JSON.parse(rows[CLAIMS]) : {}; } catch (_) { claims = {}; }
    STORES().forEach(([k, get, set]) => {
      if (typeof rows[k] === "string") {
        try { fill(k, get(), dec(rows[k]), set); } catch (e) { console.warn("SPEctrum: skipped store", k, e); return; }
        last[k] = enc(k, get());
      }
      /* Stores with no row yet keep their seed data; the first save writes them. */
    });
  }

  let saving = false, again = false, timer = 0;
  async function flush() {
    if (!started) return;
    if (saving) { again = true; return; }
    const rows = [];
    STORES().forEach(([k, get]) => { const s = enc(k, get()); if (s !== last[k]) rows.push({ key: k, data: s }); });
    if (!rows.length) return;
    saving = true; status("saving");
    const { error } = await client.from(CFG.table).upsert(rows);
    saving = false;
    if (error) { console.warn("SPEctrum: save failed", error); status("error"); return; }
    rows.forEach(r => { last[r.key] = r.data; });
    status("saved");
    if (again) { again = false; flush(); }
  }
  const soon = () => { clearTimeout(timer); timer = setTimeout(flush, 700); };

  const queued = new Map();
  const typing = () => { const a = document.activeElement; return !!a && (a.matches("input,textarea,select") || a.isContentEditable); };
  function applyRemote() {
    if (!queued.size || typing() || document.querySelector(".dragging,[data-dragging]")) return;
    const map = Object.fromEntries(STORES().map(e => [e[0], e]));
    let changed = false;
    queued.forEach((s, k) => {
      if (k === CLAIMS) { try { claims = JSON.parse(s); last[CLAIMS] = s; } catch (_) {} return; }
      const e = map[k]; if (!e) return;
      const cur = enc(k, e[1]());
      if (cur !== last[k]) return; /* I have unsaved edits to this store: mine are saved next and win. */
      try { fill(k, e[1](), dec(s), e[2]); last[k] = enc(k, e[1]()); changed = true; } catch (err) { console.warn(err); }
    });
    queued.clear();
    if (changed) { syncPeople(); if (typeof render === "function") render(); }
  }
  function subscribe() {
    client.channel("spectrum-board")
      .on("postgres_changes", { event: "*", schema: "public", table: CFG.table }, p => {
        const r = p.new; if (!r || typeof r.data !== "string" || r.data === last[r.key]) return;
        queued.set(r.key, r.data); applyRemote();
      })
      .subscribe();
    document.addEventListener("focusout", () => setTimeout(applyRemote, 50));
  }

  function watch() {
    ["click", "input", "change", "submit", "drop", "dragend", "keyup"].forEach(t => document.addEventListener(t, soon, true));
    setInterval(flush, 5000);
    setInterval(applyRemote, 3000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
    window.addEventListener("beforeunload", e => { if (saving || STORES().some(([k, g]) => enc(k, g()) !== last[k])) { flush(); e.preventDefault(); } });
  }

  let startApp, entering = false;
  /* A password-reset link signs the person in; ask for the new password before opening the board. */
  let recovering = /type=recovery/.test(location.hash);
  async function enter(session) {
    if (started || entering || !session) return;
    entering = true; user = session.user; loading("Loading your board…");
    try { await load(); }
    catch (e) { console.error(e); entering = false; fatal("We couldn't reach the server. Check your connection and try again.", () => enter(session)); return; }
    becomeMember(myClaim() || await pickMember());
    gate.remove(); document.getElementById("app")?.removeAttribute("aria-hidden");
    started = true;
    startApp();
    mountAccount(); watch(); subscribe(); flush();
  }

  window.SPX = {
    boot(start) {
      startApp = start;
      if (!CFG.url || !CFG.key || !window.supabase) { console.warn("SPEctrum: Supabase not configured, running offline with seed data."); start(); return; }
      client = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      mountGate(); loading("Checking your sign-in…");
      client.auth.onAuthStateChange((ev, session) => {
        if (ev === "PASSWORD_RECOVERY" && session) { recovering = true; if (!started && !pwShown) showNewPassword(session); }
        else if (ev === "SIGNED_OUT" && started) location.reload();
        else if (session && !started && !recovering) setTimeout(() => enter(session), 0);
      });
      client.auth.getSession().then(({ data }) => {
        if (data.session) { if (recovering) { if (!pwShown) showNewPassword(data.session); } else enter(data.session); }
        else if (!started) showLogin("in", recovering ? "That reset link has expired or was already used. Use \"Forgot password?\" to get a new one." : "");
      });
    },
    flush
  };
})();
