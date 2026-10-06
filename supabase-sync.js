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

  /* ---------- Gate, account chip, styles ---------- */
  const css = `
.spx-gate{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:16px;background:var(--surface-muted,#f9f9f9);font-family:var(--f-ui,system-ui,sans-serif);color:var(--text,#2d2d2d)}
.spx-card{width:100%;max-width:380px;background:var(--surface,#fff);border:1px solid var(--border,#e6e6e6);border-radius:12px;padding:28px 24px;box-shadow:0 8px 24px rgba(0,0,0,.06)}
.spx-brand{display:flex;align-items:center;gap:10px;margin-bottom:20px}
.spx-brand .logo-mark{flex-shrink:0}
.spx-brand b{font-family:var(--f-head,inherit);font-size:18px}
.spx-card h1{font:600 20px/1.3 var(--f-head,inherit);margin:0 0 4px}
.spx-card p{margin:0 0 18px;color:var(--text-2,#455162);font-size:13px;line-height:1.5}
.spx-card label{display:block;font-size:13px;font-weight:600;margin:0 0 6px}
.spx-card input{width:100%;height:40px;padding:0 12px;border:1px solid var(--border-strong,#c7c8d2);border-radius:8px;background:var(--surface,#fff);color:inherit;font:inherit;margin-bottom:14px}
.spx-card input:focus{outline:2px solid var(--primary,#0779E4);outline-offset:-1px;border-color:transparent}
.spx-primary{width:100%;height:40px;border-radius:8px;background:var(--primary,#0779E4)!important;color:#fff!important;font-weight:600}
.spx-primary[disabled]{opacity:.6;cursor:progress}
.spx-switch{margin-top:14px;text-align:center;font-size:13px;color:var(--text-2,#455162)}
.spx-switch button{color:var(--primary,#0779E4);font-weight:600}
.spx-msg{font-size:13px;line-height:1.5;border-radius:8px;padding:10px 12px;margin:0 0 14px}
.spx-msg.err{background:var(--red-50,#FEECEC);color:var(--red-900,#870808)}
.spx-msg.ok{background:var(--green-50,#F1F9F5);color:var(--green-700,#2D7753)}
.spx-msg:empty{display:none}
.spx-loading{display:flex;align-items:center;gap:10px;font-size:14px;color:var(--text-2,#455162)}
.spx-spin{width:18px;height:18px;border-radius:50%;border:2px solid var(--border,#e6e6e6);border-top-color:var(--primary,#0779E4);animation:spxspin .8s linear infinite}
@keyframes spxspin{to{transform:rotate(360deg)}}
.spx-acct{display:flex;align-items:center;gap:8px;padding:10px 16px 0;font-size:12px;color:var(--text-2,#455162);min-width:0}
.spx-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;background:var(--green-500,#46B881)}
.spx-dot[data-s="saving"]{background:var(--orange-500,#FFAD0D)}
.spx-dot[data-s="error"]{background:var(--red-500,#F54B4B)}
.spx-email{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.spx-out{padding:4px;border-radius:6px;color:var(--text-2,#455162);display:inline-flex}
.spx-out:hover{background:var(--surface-muted,#f9f9f9);color:var(--text,#2d2d2d)}
.app.collapsed .spx-email{display:none}
.spx-card.wide{max-width:440px}
.spx-list{display:flex;flex-direction:column;gap:6px;margin:0 0 14px;max-height:min(46vh,360px);overflow:auto;padding:2px}
.spx-card .spx-opt{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border,#e6e6e6);border-radius:8px;cursor:pointer;font-weight:400!important;margin:0!important}
.spx-opt:has(input:checked){border-color:var(--primary,#0779E4);background:var(--primary-soft,#EFF6FF)}
.spx-opt:has(input:disabled){cursor:not-allowed;opacity:.55}
.spx-opt input{width:16px;height:16px;margin:0;flex-shrink:0;accent-color:var(--primary,#0779E4)}
.spx-av{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:11px;font-weight:600;flex-shrink:0}
.spx-who{display:flex;flex-direction:column;min-width:0;font-size:13px;line-height:1.35}
.spx-who b{font-weight:600}
.spx-who small{color:var(--text-2,#455162);font-size:12px}
.spx-new{display:grid;gap:0;margin:0 0 6px}
.spx-new[hidden]{display:none}
.spx-card select{width:100%;height:40px;padding:0 10px;border:1px solid var(--border-strong,#c7c8d2);border-radius:8px;background:var(--surface,#fff);color:inherit;font:inherit;margin-bottom:14px}
.app.collapsed .spx-acct{flex-direction:column;padding:10px 0 0}`;

  let gate, client, user, started = false;
  const last = {};
  const $g = s => gate.querySelector(s);
  const escH = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function mountGate() {
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    gate = document.createElement("div"); gate.className = "spx-gate"; gate.setAttribute("role", "dialog");
    gate.setAttribute("aria-modal", "true"); gate.setAttribute("aria-labelledby", "spxTitle");
    document.body.appendChild(gate);
    document.getElementById("app")?.setAttribute("aria-hidden", "true");
  }
  function loading(text) {
    gate.innerHTML = `<div class="spx-loading" role="status"><span class="spx-spin" aria-hidden="true"></span>${escH(text)}</div>`;
  }
  function fatal(text, retry) {
    gate.innerHTML = `<div class="spx-card"><h1 id="spxTitle">Can't load the board</h1><p class="spx-msg err" role="alert">${escH(text)}</p>
      <button type="button" class="spx-primary" id="spxRetry">Try again</button></div>`;
    $g("#spxRetry").onclick = retry;
  }
  function showLogin(mode = "in", msg = "", ok = false) {
    const up = mode === "up";
    gate.innerHTML = `<form class="spx-card" novalidate>
      <div class="spx-brand"><div class="logo-mark">S</div><b>SPEctrum</b></div>
      <h1 id="spxTitle">${up ? "Create your account" : "Sign in"}</h1>
      <p>${up ? "Use your work email. We'll send a link to confirm it." : "Sign in to see and update your team's sprint board."}</p>
      <div class="spx-msg ${ok ? "ok" : "err"}" role="${ok ? "status" : "alert"}">${escH(msg)}</div>
      <label for="spxEmail">Email</label>
      <input id="spxEmail" type="email" autocomplete="email" required>
      <label for="spxPw">Password</label>
      <input id="spxPw" type="password" autocomplete="${up ? "new-password" : "current-password"}" minlength="6" required>
      <button type="submit" class="spx-primary">${up ? "Create account" : "Sign in"}</button>
      <div class="spx-switch">${up ? "Already have an account?" : "New to SPEctrum?"} <button type="button" id="spxMode">${up ? "Sign in" : "Create an account"}</button></div>
    </form>`;
    $g("#spxEmail").focus();
    $g("#spxMode").onclick = () => showLogin(up ? "in" : "up");
    $g("form").onsubmit = async e => {
      e.preventDefault();
      const email = $g("#spxEmail").value.trim(), password = $g("#spxPw").value, btn = $g(".spx-primary"), m = $g(".spx-msg");
      if (!email || !password) { m.className = "spx-msg err"; m.textContent = "Enter your email and password."; return; }
      if (up && password.length < 6) { m.className = "spx-msg err"; m.textContent = "Use at least 6 characters for your password."; return; }
      btn.disabled = true; btn.textContent = up ? "Creating account…" : "Signing in…";
      const res = up
        ? await client.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } })
        : await client.auth.signInWithPassword({ email, password });
      if (res.error) {
        const t = /invalid login/i.test(res.error.message) ? "That email and password don't match. Check them and try again."
          : /not confirmed/i.test(res.error.message) ? "Confirm your email first: open the link we sent you, then sign in."
          : res.error.message;
        showLogin(mode, t); $g("#spxEmail").value = email; return;
      }
      if (up && !res.data.session) { showLogin("in", `Check ${email} for a confirmation link, then sign in here.`, true); return; }
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
      gate.innerHTML = `<form class="spx-card wide" novalidate>
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
        if (ev === "SIGNED_OUT" && started) location.reload();
        else if (session && !started) setTimeout(() => enter(session), 0);
      });
      client.auth.getSession().then(({ data }) => { if (data.session) enter(data.session); else if (!started) showLogin(); });
    },
    flush
  };
})();
