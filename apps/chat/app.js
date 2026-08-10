// Sage Chat — the sage-canton chat-feed visual, re-wired onto the Sage/Monad
// demo stack (M14). The run lifecycle is rendered as a conversation: you give
// a brief, the orchestrator proposes an explicit plan you approve, agents and
// evaluators "speak" as SSE events land, settlement bubbles carry Monadscan
// links. Transport: worker-gateway `?chain=monad` endpoints + the orchestrator
// SSE stream (no polling — events push).
const GATEWAY = 'https://sage-gateway.a-t-somnia.workers.dev';
const CHAIN = 'monad';
const EXPLORER = 'https://testnet.monadscan.com';
const DECIMALS = 18n; // WMON
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const hhmm = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const short = (a) => (a && a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : a || '');

// Raw viem/orchestrator errors carry full calldata — useless as a chat bubble.
// Keep the first meaningful line (≤180 chars), tuck the rest into <details>.
function shortErr(msg) {
  const s = String(msg || 'failed');
  const cut = s.split(/Contract Call:|Docs:|Version: viem/)[0].trim();
  const head = cut.length > 180 ? cut.slice(0, 180) + '…' : cut;
  const hint = /reverted/i.test(s) && /createTask/.test(s)
    ? ' <span class="sub">likely cause: sponsor WMON balance below the step price — top up and retry.</span>' : '';
  const details = s.length > head.length + 40
    ? `<details class="more"><summary>full error</summary><div class="answer">${esc(s.slice(0, 2500))}</div></details>` : '';
  return `<span class="neg">${esc(head)}</span>${hint}${details}`;
}

// WMON base units (18 dec) → "1.950 WMON"
function fmtW(units) {
  try {
    const v = BigInt(String(units));
    const neg = v < 0n ? '-' : '';
    const abs = v < 0n ? -v : v;
    const pow = 10n ** DECIMALS;
    const frac = (abs % pow).toString().padStart(Number(DECIMALS), '0').slice(0, 3);
    return `${neg}${abs / pow}.${frac}`;
  } catch { return String(units); }
}
const wmon = (u) => `<span class="cc">${esc(fmtW(u))} WMON</span>`;

// capability → persona. Unknown capabilities fall back to a shortened address.
const PERSONA = {
  copywrite: ['✍️', 'Copywriter'],
  'build-website': ['🏗️', 'Builder'],
  'qa-website': ['🧪', 'QA evaluator'],
  'package-archive': ['📦', 'Packager'],
  'web-search': ['🔎', 'Searcher'],
  'extract-content': ['📥', 'Extractor'],
  'synthesize-report': ['🧠', 'Synthesizer'],
  'fact-check': ['⚖️', 'Fact-checker'],
};
let capByAddr = {}; // lowercased executor address -> capability (from the live registry)
let agentsList = []; // [{address, capabilities:[{name, price}]}] — live V2 registry
const personaFor = (addr) => {
  const cap = capByAddr[(addr || '').toLowerCase()];
  return PERSONA[cap] || ['🤖', short(addr) || 'Agent'];
};

// "0.4" WMON → "400000000000000000" base units (18 dec), null on garbage.
function toUnits(dec) {
  const m = String(dec).trim().match(/^(\d+)(?:\.(\d{0,18}))?$/);
  if (!m) return null;
  return (BigInt(m[1]) * 10n ** DECIMALS + BigInt((m[2] || '').padEnd(18, '0'))).toString();
}

// ── state ──────────────────────────────────────────────────────────────────
let mode = 'website'; // 'website' | 'research'
let runs = [];        // [{ id, brief, mode, failure, when, plan, state, runtimes, bubbles[], runId, explorer, totals }]
let ACTIONS = [];
let seq = 0;

// ── plumbing ───────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${GATEWAY}${path}${sep}chain=${CHAIN}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || json.error || `${method} ${path} ${res.status}`);
  return json;
}

let toastTimer;
function toast(msg, err = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), err ? 15000 : 4200);
}
$('toast').onclick = async () => {
  try { await navigator.clipboard.writeText($('toast').textContent); toast('copied'); } catch { $('toast').className = 'toast'; }
};

let sponsorBalance = null; // parsed WMON float from /health — approve pre-check
async function health() {
  try {
    const h = await api('GET', '/health');
    const b = parseFloat(h.sponsor?.balanceUsdc);
    sponsorBalance = Number.isFinite(b) ? b : null;
    $('net').classList.add('ok');
    $('net').innerHTML = `<span class="dot"></span> ${esc(h.chainName || 'Monad Testnet')}`;
    if (h.sponsor?.balanceUsdc) {
      $('sponsor').innerHTML = `sponsor <b>${esc(h.sponsor.balanceUsdc)} ${esc(h.sponsor.settlementSymbol || 'WMON')}</b>${h.sponsor.accepting === false ? ' · <span style="color:var(--amber)">paused</span>' : ''}`;
    }
  } catch {
    $('net').classList.remove('ok');
    $('net').innerHTML = `<span class="dot"></span> backend offline`;
  }
}

async function loadAgents() {
  try {
    const res = await api('GET', '/api/demo/composite/agents');
    agentsList = res.agents || [];
    for (const a of agentsList) {
      const cap = a.capabilities?.[0]?.name;
      if (a.address && cap) capByAddr[a.address.toLowerCase()] = cap;
    }
  } catch { /* best-effort — personas fall back to addresses */ }
}

// ── feed rendering ─────────────────────────────────────────────────────────
const evt = (cls, icon, name, ref, when, msg, extra = '') => `
  <div class="evt ${cls}">
    <div class="who">${icon}</div>
    <div class="body">
      <div class="line1"><span class="name">${esc(name)}</span><span class="eref">${esc(ref)}</span><span class="when">${when ? esc(when) : ''}</span></div>
      <div class="msg">${msg}</div>${extra}
    </div>
  </div>`;
const chip = (label, primary, fn) => { ACTIONS.push(fn); return `<button class="tiny ${primary ? 'primary' : ''}" data-i="${ACTIONS.length - 1}">${label}</button>`; };
const chips = (arr) => (arr.length ? `<div class="chips">${arr.join('')}</div>` : '');
const linkChip = (label, url) => `<a class="tiny" href="${esc(url)}" target="_blank" rel="noopener">${label}</a>`;

function hero() {
  return `<div class="hero">
    <div class="big">🌿</div>
    <h2>Give AI agents a paid task — and see every step before it runs</h2>
    <p>No endless revision loop, no forgotten context: the orchestrator turns your brief into an
    <b>explicit plan</b> you approve, specialist agents execute it step by step,<br/>an independent
    evaluator verifies the result — and only verified work gets paid, in WMON escrow on Monad testnet.</p>
    <div class="trust">
      <span>🧩 <b>Explicit</b> — every step visible &amp; priced upfront</span>
      <span>⚖️ <b>Verified</b> — evaluators gate every payment</span>
      <span>💸 <b>On-chain</b> — real escrow, real refunds</span>
    </div>
  </div>`;
}

function welcome() {
  const ex = mode === 'website'
    ? ['a specialty coffee bar in Lisbon — warm tone, English copy', 'a portfolio site for a freelance product designer — minimal, dark']
    : ['What is the Monad Validator Delegation Program?', 'Compare optimistic and zk rollup exit games'];
  return evt('sage', '🌿', 'Sage', '', '',
    `Pick a pipeline below and describe the job — the orchestrator proposes a plan, <b>you approve it</b>, and the agents settle each step on Monad testnet.`,
    `<div class="steps">
      <div>🌐 <b>Website</b> — copywriter → builder → QA evaluator (Lighthouse + screenshot) → packager · live preview at the end</div>
      <div>🔬 <b>Research</b> — searcher → 4× extractor → synthesizer → fact-checker re-resolves every citation on the live web</div>
      <div class="tips">⚠️ In research mode you can stage a <b>failed</b> run — fabricated quotes get caught and the escrow is refunded on-chain.</div>
    </div>
    <div class="sub">Try one:</div>` +
    chips(ex.map((x) => chip(esc(x), false, () => { const b = $('brief'); b.value = x; b.focus(); }))));
}

function planCard(run) {
  const subs = run.plan.subtasks.map((s) => {
    const [icon, name] = personaFor(s.executor_address);
    const specHead = s.spec.length > 110 ? s.spec.slice(0, 110) + '…' : s.spec;
    return `<div class="prow">
      <div class="pmain"><b>#${s.id} ${esc(s.type)}</b>${s.evaluates !== undefined ? ` <span class="who2">⚖ judges #${s.evaluates}</span>` : ''}<div class="pbrief">${esc(specHead)}</div></div>
      <span class="who2">${icon} ${esc(name)}</span>
      <span class="cc">${esc(fmtW(s.estimated_cost_units))} WMON</span>
    </div>`;
  }).join('');
  return `<div class="card">${subs}
    <div class="pi-foot"><span class="pi-total">total ${esc(fmtW(run.plan.estimated_total_cost_units))} WMON · ~${Math.round((run.plan.estimated_duration_ms || 0) / 1000)}s</span></div>
  </div>`;
}

// Locked-template editor (M13.1.1 semantics): spec / executor / price are
// editable; step order, types and evaluator wiring are the template's.
function executorOptions(type, current) {
  const matching = agentsList.filter((a) => a.capabilities?.some((c) => c.name === type));
  const opts = matching.map((a) => {
    const cap = a.capabilities.find((c) => c.name === type);
    const [icon, name] = personaFor(a.address);
    return `<option value="${esc(a.address)}" ${a.address.toLowerCase() === (current || '').toLowerCase() ? 'selected' : ''}>${icon} ${esc(name)} · ${esc(fmtW(cap.price))} WMON</option>`;
  });
  if (current && !matching.some((a) => a.address.toLowerCase() === current.toLowerCase())) {
    opts.unshift(`<option value="${esc(current)}" selected>${esc(short(current))} (current)</option>`);
  }
  return opts.join('');
}

function planEditorHtml(run) {
  const rows = run.plan.subtasks.map((s, i) => `
    <div class="pi-row" data-idx="${i}">
      <div class="pi-main">
        <div class="pi-head"><b>#${s.id} ${esc(s.type)}</b>${s.evaluates !== undefined ? ` <span class="who2">⚖ judges #${s.evaluates}</span>` : ''}${s.depends_on?.length ? ` <span class="who2">← depends on ${s.depends_on.map((d) => '#' + d).join(', ')}</span>` : ''}</div>
        <textarea class="pi-spec" rows="2">${esc(s.spec)}</textarea>
      </div>
      <div class="pi-side">
        <label>agent<select class="pi-worker">${executorOptions(s.type, s.executor_address)}</select></label>
        <label>WMON<input class="pi-cost" type="number" min="0" step="0.05" value="${esc(fmtW(s.estimated_cost_units))}" /></label>
      </div>
    </div>`).join('');
  return `<div class="card plan-editor">${rows}
    <div class="pi-foot">
      <span class="pi-total">total ${esc(fmtW(run.plan.estimated_total_cost_units))} WMON</span>
      <span class="pi-run-group">
        <button class="pi-cancel tiny">‹ Back</button>
        <button class="pi-save tiny primary">✅ Save plan</button>
      </span>
    </div>
  </div>`;
}

function bindPlanEditor(run) {
  const root = $('feed').querySelector('.plan-editor');
  if (!root) return;
  const updateTotal = () => {
    const total = [...root.querySelectorAll('.pi-cost')].reduce((s, el) => {
      const u = toUnits(el.value);
      return u === null ? s : s + BigInt(u);
    }, 0n);
    root.querySelector('.pi-total').textContent = `total ${fmtW(total.toString())} WMON`;
  };
  root.querySelectorAll('.pi-cost').forEach((el) => el.addEventListener('input', updateTotal));
  const sync = () => {
    let bad = null;
    root.querySelectorAll('.pi-row').forEach((row) => {
      const i = Number(row.dataset.idx);
      const s = run.plan.subtasks[i];
      s.spec = row.querySelector('.pi-spec').value.trim() || s.spec;
      s.executor_address = row.querySelector('.pi-worker').value;
      const u = toUnits(row.querySelector('.pi-cost').value);
      if (u === null || u === '0') bad = `step #${s.id}: bad price`;
      else s.estimated_cost_units = u;
    });
    run.plan.estimated_total_cost_units = run.plan.subtasks
      .reduce((sum, s) => sum + BigInt(s.estimated_cost_units), 0n).toString();
    return bad;
  };
  root.querySelector('.pi-cancel').onclick = () => { run.editMode = false; render(); };
  root.querySelector('.pi-save').onclick = () => {
    const bad = sync();
    if (bad) { toast(bad, true); return; }
    run.editMode = false;
    render();
    toast('plan updated — review and approve');
  };
}

function progressCard(run) {
  const rows = run.plan.subtasks.map((s) => {
    const r = run.runtimes[s.id] || { status: 'waiting', txHashes: [] };
    const [icon, name] = personaFor(s.executor_address);
    const ok = r.status === 'paid';
    const bad = r.status === 'refunded' || r.status === 'errored';
    const runing = !ok && !bad && r.status !== 'waiting';
    const mark = ok ? '✓' : bad ? '✗' : runing ? '⋯' : '·';
    const tx = r.txHashes?.length ? `<a href="${esc(EXPLORER)}/tx/${esc(r.txHashes[r.txHashes.length - 1])}" target="_blank" rel="noopener">tx ↗</a>` : '';
    return `<div class="subrow ${ok ? 'ok' : bad ? 'bad' : runing ? 'run' : ''}"><span class="ck">${mark}</span><b>#${s.id} ${esc(s.type)}</b><span class="who2">${icon} ${esc(name)} · ${esc(r.status)}${r.taskId ? ` · task #${esc(r.taskId)}` : ''}</span><span class="cc">${ok ? esc(fmtW(s.estimated_cost_units)) + ' WMON' : bad ? 'not paid' : ''}</span>${tx}</div>`;
  }).join('');
  return `<div class="card">${rows}</div>`;
}

function runEvents(run) {
  const out = [];
  const failNote = run.failure ? ' <span class="neg">(staged failure)</span>' : '';
  out.push(evt('me', '🧑', 'You', run.mode, hhmm(run.when),
    `${run.mode === 'website' ? '🌐' : '🔬'} “${esc(run.brief)}”${failNote}`));

  if (run.state === 'planning') {
    out.push(evt('orch', '🧩', 'Orchestrator', '', '', `<span class="spin"></span> Decomposing the brief into priced steps…`));
    return out;
  }
  if (run.state === 'plan') {
    if (run.editMode) {
      out.push(evt('orch', '🧩', 'Orchestrator', '', '',
        `Edit the plan — spec, executor, price per step. The template structure (order, evaluator wiring) stays fixed.`,
        planEditorHtml(run)));
    } else {
      out.push(evt('orch', '🧩', 'Orchestrator', '', '',
        `Proposed an explicit plan — <b>${run.plan.subtasks.length} steps, this is what you'll pay for</b>. Nothing runs until you approve.`,
        planCard(run) + chips([
          chip(`✅ Approve · execute (${fmtW(run.plan.estimated_total_cost_units)} WMON)`, true, () => approve(run)),
          chip('✏️ Edit plan', false, () => { run.editMode = true; render(); }),
          chip('✖ Discard', false, () => { runs = runs.filter((r) => r !== run); render(); }),
        ])));
    }
    return out;
  }

  // executing / done: live progress card + accumulated bubbles
  out.push(evt('orch', '🧩', 'Orchestrator', run.runId ? `run ${run.runId.slice(0, 8)}` : '', '',
    run.state === 'executing'
      ? `<span class="spin"></span> Executing on Monad — each step is its own WMON escrow; evaluators gate the payouts.`
      : run.state === 'done'
        ? `Plan settled — every paid step below was verified first.`
        : `Run ended: ${shortErr(run.error)}${run.failReason === 'dispute_refunded' ? ' — verification failed, the escrow came back. The protocol said no.' : ''}`,
    progressCard(run)));
  out.push(...run.bubbles);
  return out;
}

function render() {
  const feed = $('feed');
  const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 140;
  ACTIONS = [];
  let html = '';
  if (!runs.length) {
    html = hero() + welcome();
  } else {
    html = `<div class="daysep">sage chat · monad testnet · every payment below is a real on-chain escrow</div>`;
    runs.forEach((run, i) => {
      const inner = runEvents(run).join('');
      html += i === runs.length - 1
        ? `${runs.length > 1 ? '<div class="daysep cur">⚡ current task</div>' : ''}<div class="tgroup now">${inner}</div>`
        : `<div class="tgroup old">${inner}</div>`;
    });
  }
  feed.innerHTML = html;
  feed.querySelectorAll('button[data-i]').forEach((b) => {
    const fn = ACTIONS[Number(b.dataset.i)];
    if (fn) b.onclick = async () => { b.disabled = true; try { await fn(); } finally { b.disabled = false; } };
  });
  const editing = runs.find((r) => r.state === 'plan' && r.editMode);
  if (editing) bindPlanEditor(editing);
  if (nearBottom) feed.scrollTop = feed.scrollHeight;
}

// ── result decoding (artifact links for the final bubble) ──────────────────
function decodeUri(uri) {
  if (!uri || !uri.startsWith('data:')) return null;
  const comma = uri.indexOf(',');
  if (comma < 0) return null;
  try { return decodeURIComponent(uri.slice(comma + 1)); } catch { return null; }
}
function artifactLinks(run) {
  const links = [];
  for (const s of run.plan.subtasks) {
    const r = run.runtimes[s.id];
    const text = decodeUri(r?.resultUri);
    if (!text) continue;
    try {
      const j = JSON.parse(text);
      if (j.previewUrl) links.push(linkChip('🔗 Live site preview', j.previewUrl));
      const sha = j.artifact?.sha256;
      if (sha && s.type === 'synthesize-report') links.push(linkChip('📄 Read the report', `${GATEWAY}/report/${sha}`));
      if (sha && s.type === 'package-archive') links.push(linkChip('⬇ site.zip', `${GATEWAY}/api/artifacts/${sha}`));
    } catch { /* plain-text result — nothing to link */ }
  }
  return links;
}

// ── flow: plan → approve → SSE ─────────────────────────────────────────────
async function planIt(brief, failure) {
  const run = { id: ++seq, brief, mode, failure, when: Date.now(), state: 'planning', runtimes: {}, bubbles: [] };
  runs.push(run);
  render();
  try {
    const path = mode === 'website' ? '/api/demo/composite/website-plan' : '/api/demo/composite/research-plan';
    const res = await api('POST', path, { brief, ...(failure ? { variant: 'failure-demo' } : {}) });
    const c = res.classification;
    run.plan = {
      brief,
      decomposability: c.decomposability,
      stakes: c.stakes,
      subtasks: c.proposed_plan,
      estimated_total_cost_units: c.estimated_total_cost_units,
      estimated_duration_ms: c.estimated_duration_ms,
    };
    run.state = 'plan';
  } catch (e) {
    runs = runs.filter((r) => r !== run);
    toast(e.message, true);
  }
  render();
}

async function approve(run) {
  // Pre-flight: a plan pricier than the sponsor's WMON balance dies mid-run
  // with a stranded step (observed live, run 4f02a12c) — refuse upfront.
  const total = Number(fmtW(run.plan.estimated_total_cost_units));
  if (sponsorBalance !== null && total > sponsorBalance) {
    toast(`sponsor holds ${sponsorBalance} WMON, the plan needs ${total} — the operator has to top up (wrap MON) first`, true);
    return;
  }
  run.state = 'executing';
  run.plan.subtasks.forEach((s) => (run.runtimes[s.id] = { status: 'waiting', txHashes: [] }));
  render();
  try {
    const res = await api('POST', '/api/demo/composite/execute', { ...run.plan, reviewMode: false, analyticsConsent: false });
    run.runId = res.runId;
    run.explorer = res.explorerUrl || EXPLORER;
    attachStream(run, res.streamUrl);
    toast('▶ executing — agents woke up, escrows are being funded');
  } catch (e) {
    run.state = 'failed';
    run.error = e.message;
    toast(e.message, true);
  }
  render();
}

function bubble(run, cls, icon, name, msg, extra = '') {
  run.bubbles.push(evt(cls, icon, name, '', hhmm(Date.now()), msg, extra));
  render();
}

function attachStream(run, streamUrl) {
  const base = streamUrl.startsWith('http') ? streamUrl : GATEWAY + streamUrl;
  const url = base + (base.includes('?') ? '&' : '?') + 'chain=' + CHAIN;
  const es = new EventSource(url);
  const rt = (subId) => (run.runtimes[subId] ||= { status: 'waiting', txHashes: [] });
  const sub = (subId) => run.plan.subtasks.find((s) => s.id === subId);
  const persona = (subId) => personaFor(sub(subId)?.executor_address);

  const on = (name, fn) => es.addEventListener(name, (ev) => {
    let data = {};
    try { data = JSON.parse(ev.data); } catch { /* keep {} */ }
    fn(data);
    render();
  });

  on('subtask_created', (d) => { const r = rt(d.subId); r.status = 'created'; if (d.taskId != null) r.taskId = String(d.taskId); });
  on('subtask_accepted', (d) => {
    rt(d.subId).status = 'accepted';
    const [icon, name] = persona(d.subId);
    bubble(run, 'agent', icon, name, `Accepted step <b>#${d.subId}</b> — working…`);
  });
  on('subtask_completed', (d) => {
    const r = rt(d.subId); r.status = 'completed'; if (d.resultUri) r.resultUri = d.resultUri;
  });
  on('subtask_paid', (d) => {
    const r = rt(d.subId); r.status = 'paid'; if (d.txHash) r.txHashes.push(d.txHash);
    const s = sub(d.subId); const [icon, name] = persona(d.subId);
    bubble(run, 'money', '💸', 'Settlement',
      `${icon} ${esc(name)} paid ${wmon(s?.estimated_cost_units ?? '0')} for step <b>#${d.subId}</b> — escrow released on-chain.${d.txHash ? ` <a href="${esc(EXPLORER)}/tx/${esc(d.txHash)}" target="_blank" rel="noopener">tx ↗</a>` : ''}`);
  });
  on('subtask_verdict', (d) => {
    const judged = sub(d.subId); const [jIcon, jName] = persona(d.subId);
    const evName = d.evaluatorSubId != null ? persona(d.evaluatorSubId) : ['⚖️', 'Evaluator'];
    const shot = d.screenshot?.url ? `<a href="${esc(d.screenshot.url)}" target="_blank" rel="noopener"><img class="shot" src="${esc(d.screenshot.url)}" alt="rendered screenshot"/></a>` : '';
    const reasons = (d.reasons || []).slice(0, 3).map((x) => `<div class="sub">· ${esc(x)}</div>`).join('');
    if (d.degraded) {
      bubble(run, 'gray', '⚠️', 'Evaluator', `Verdict degraded for step #${d.subId} — harness unavailable, falling back to legacy approve.`);
    } else {
      bubble(run, 'checker', evName[0], evName[1],
        d.pass
          ? `Verdict on ${jIcon} ${esc(jName)}'s step <b>#${d.subId}</b>: <b>PASS</b>${d.score != null ? ` · score ${d.score}` : ''} — payment can release.`
          : `Verdict on ${jIcon} ${esc(jName)}'s step <b>#${d.subId}</b>: <span class="neg">FAIL</span>${d.score != null ? ` · score ${d.score}` : ''} — payment blocked.`,
        reasons + shot);
    }
  });
  on('subtask_retrying', (d) => {
    const r = rt(d.subId); r.status = 'waiting'; delete r.resultUri;
    bubble(run, 'orch', '🧩', 'Orchestrator', `Step <b>#${d.subId}</b> gets one rework — the defect list goes back to the agent.`);
  });
  on('subtask_disputed', (d) => {
    rt(d.subId).status = 'disputed';
    bubble(run, 'checker', '⚖️', 'Dispute', `Step <b>#${d.subId}</b> is contested — escalated to the council (LLM arbiter) for an on-chain ruling.`);
  });
  on('subtask_dispute_resolved', (d) => {
    bubble(run, 'checker', '⚖️', 'Council',
      `Ruling on step <b>#${d.subId}</b>: <b>${esc(d.outcome || '')}</b>.${d.reasoning ? ` <span class="sub">${esc(String(d.reasoning).slice(0, 220))}</span>` : ''}`);
  });
  on('subtask_refunded', (d) => {
    const r = rt(d.subId); r.status = 'refunded'; if (d.txHash) r.txHashes.push(d.txHash);
    bubble(run, 'money', '↩️', 'Settlement',
      `Escrow for step <b>#${d.subId}</b> <span class="neg">refunded to the client</span> — unverified work is not paid.${d.txHash ? ` <a href="${esc(EXPLORER)}/tx/${esc(d.txHash)}" target="_blank" rel="noopener">tx ↗</a>` : ''}`);
  });
  on('subtask_errored', (d) => { const r = rt(d.subId); r.status = 'errored'; r.error = d.error; });
  on('plan_completed', () => {
    run.state = 'done';
    const links = artifactLinks(run);
    bubble(run, 'sage', '🌿', 'Sage', `All steps settled. Verified output below — checkable on-chain, not promised in a chat.`, chips(links));
    es.close();
    health();
  });
  on('plan_failed', (d) => {
    run.state = 'failed';
    run.error = d.error || 'plan failed';
    run.failReason = d.reason;
    bubble(run, 'sage', '🌿', 'Sage',
      d.reason === 'dispute_refunded'
        ? `The run ended in a <b>refund</b> — verification failed and the money came back. That "no" is the product.`
        : `Run failed: ${shortErr(run.error)} <span class="sub">unfinished escrows are reclaimed by deadline.</span>`);
    es.close();
    health();
  });
  on('done', () => es.close());
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED && run.state === 'executing') {
      run.state = 'failed';
      run.error = 'stream lost — the run may still be finishing server-side';
      render();
    }
  };
}

// ── composer ───────────────────────────────────────────────────────────────
$('modeSeg').querySelectorAll('button').forEach((b) => (b.onclick = () => {
  mode = b.dataset.m;
  $('modeSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
  $('failLab').classList.toggle('hidden', mode !== 'research');
  if (!runs.length) render(); // refresh welcome examples
}));
$('failLab').classList.toggle('hidden', mode !== 'research');

$('createBtn').onclick = async () => {
  const brief = $('brief').value.trim();
  if (!brief) { toast('describe the task first', true); $('brief').focus(); return; }
  const btn = $('createBtn'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> planning…';
  try {
    await planIt(brief, mode === 'research' && $('failChk').checked);
    $('brief').value = '';
  } finally { btn.disabled = false; btn.textContent = 'Plan it →'; }
};
$('brief').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('createBtn').click(); });

// ── boot ───────────────────────────────────────────────────────────────────
health();
loadAgents();
render();
setInterval(health, 60_000);
