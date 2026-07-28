/* Prototype wiring. Screen 4 and screen 8 call the real engine; every other
   screen is a designed mock of the interface described in the proposal. */
(function () {
  "use strict";
  const E = window.CampaignEngine;
  const { money, pct, round } = E.fmt;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  /* ---------------- navigation ---------------- */
  function go(id) {
    $$(".screen").forEach((s) => s.classList.toggle("on", s.id === id));
    $$(".step").forEach((b) => b.classList.toggle("on", b.dataset.go === id));
    window.scrollTo(0, 0);
    if (id === "s9") drawArchitecture();
    if (location.hash !== "#" + id) history.replaceState(null, "", "#" + id);
  }
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-go]");
    if (t) { e.preventDefault(); go(t.dataset.go); }
  });

  /* ---------------- scenarios ---------------- */
  const SCENARIOS = {
    A: { objective: "sales", product_type: "physical", budget_cash: 3000, aov: 48, gross_margin: 0.68,
         units_available: 200, cogs_per_unit: 12, shipping_cost_per_unit: 7, ships_to_target_geo: true,
         can_track_conversions: true, desired_creator_count: 25, days_until_launch: 42, creator_tier: "micro",
         review_capacity: "medium", content_rights: "organic_only", requires_content_approval: true, target_revenue: 30000 },
    B: { objective: "awareness", product_type: "digital", budget_cash: 500, aov: 29, gross_margin: 0.85,
         units_available: 0, cogs_per_unit: 4, shipping_cost_per_unit: 0, ships_to_target_geo: true,
         can_track_conversions: false, desired_creator_count: 50, days_until_launch: 21, creator_tier: "micro",
         review_capacity: "low", content_rights: "paid_usage", requires_content_approval: true },
    C: { objective: "sales", product_type: "digital", budget_cash: 2500, aov: 29, gross_margin: 0.85,
         units_available: 0, cogs_per_unit: 4, shipping_cost_per_unit: 0, ships_to_target_geo: true,
         can_track_conversions: true, desired_creator_count: 8, days_until_launch: 60, creator_tier: "micro",
         review_capacity: "low", content_rights: "organic_only", requires_content_approval: true },
    D: { objective: "awareness", product_type: "physical", budget_cash: 18000, aov: 1450, gross_margin: 0.42,
         units_available: 12, cogs_per_unit: 780, shipping_cost_per_unit: 210, ships_to_target_geo: true,
         can_track_conversions: true, desired_creator_count: 12, days_until_launch: 75, creator_tier: "mid",
         review_capacity: "high", content_rights: "whitelisting", requires_content_approval: true },
  };

  const INPUTS = ["objective", "product_type", "budget_cash", "desired_creator_count", "aov", "gross_margin",
                  "units_available", "days_until_launch", "creator_tier", "review_capacity", "content_rights",
                  "can_track_conversions", "ships_to_target_geo", "requires_content_approval"];
  let state = Object.assign({}, SCENARIOS.A);

  function writeInputs() {
    INPUTS.forEach((k) => {
      const el = $("#i_" + k); if (!el) return;
      if (el.type === "checkbox") el.checked = !!state[k];
      else if (k === "gross_margin") el.value = Math.round(state[k] * 100);
      else el.value = state[k];
    });
    $("#mv").textContent = Math.round(state.gross_margin * 100) + "%";
  }
  function readInputs() {
    INPUTS.forEach((k) => {
      const el = $("#i_" + k); if (!el) return;
      if (el.type === "checkbox") state[k] = el.checked;
      else if (el.type === "number") state[k] = el.value === "" ? null : Number(el.value);
      else if (k === "gross_margin") state[k] = Number(el.value) / 100;
      else state[k] = el.value;
    });
    // COGS tracks margin unless a scenario pinned it, so the gifting gate stays honest.
    state.cogs_per_unit = Math.round(state.aov * (1 - state.gross_margin));
    $("#mv").textContent = Math.round(state.gross_margin * 100) + "%";
  }

  /* ---------------- screen 4 render ---------------- */
  function render() {
    const v = E.evaluate(state);

    $("#verdictBox").className = "verdict " + v.tone;
    $("#verdictBox").innerHTML =
      `<div class="row"><h2 style="flex:1">${esc(v.state_label)}</h2><span class="chip ${v.tone}">${esc(v.state)}</span></div>
       <div class="hl">${esc(v.headline)}</div>
       <div class="small" style="margin-top:9px"><b>Next:</b> ${esc(v.next_action)}</div>` +
      (v.warnings.length ? `<ul class="small" style="margin:8px 0 0;padding-left:18px">${v.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : "") +
      (v.remedies.length ? `<div class="small" style="margin-top:9px"><b>How to fix it:</b><ul style="margin:4px 0 0;padding-left:18px">${v.remedies.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>` : "") +
      (v.missing.length ? `<div class="small" style="margin-top:9px"><b>Blocking fields:</b><ul style="margin:4px 0 0;padding-left:18px">${v.missing.map((m) => `<li><b>${esc(m.label)}</b> — ${esc(m.why)}</li>`).join("")}</ul></div>` : "");

    // gates, grouped by model
    $("#gatesBox").innerHTML = E.MODELS.map((m) => {
      const gs = v.gates[m], ok = gs.every((g) => g.pass);
      return `<div style="margin-bottom:11px">
        <div class="row" style="margin-bottom:3px"><b style="font-size:12.5px;flex:1">${esc(E.MODEL_LABEL[m])}</b>
        <span class="chip ${ok ? "ok" : "danger"}">${ok ? "eligible" : gs.filter((g) => !g.pass).length + " blocked"}</span></div>
        ${gs.map((g) => `<div class="gate"><span class="pill ${g.pass ? "p" : "f"}">${g.pass ? "PASS" : "FAIL"}</span>
          <div><b>${esc(g.label)}</b><span>${esc(g.detail)}</span></div></div>`).join("")}
      </div>`;
    }).join("");

    // ranked options
    const opts = v.recommendation ? [v.recommendation].concat(v.alternatives) : [];
    $("#optsBox").innerHTML = opts.length
      ? opts.map((o, i) => `<div class="opt ${i === 0 ? "top" : ""}">
          <div class="row"><div style="flex:1"><b style="font-size:13.5px">${esc(o.label)}</b>
            ${i === 0 ? '<span class="chip info" style="margin-left:6px">recommended</span>' : ""}
            <div class="tiny muted">reaches ${o.capacity} of ${state.desired_creator_count} creators</div></div>
            <div class="score">${o.score.toFixed(3)}</div></div>
          <div class="bars">${Object.keys(E.WEIGHTS).map((k) => `<div class="bar"><span>${k.replace(/_/g, " ")} ·${pct(E.WEIGHTS[k])}</span>
            <span class="t"><i style="width:${Math.round(o.signals[k] * 100)}%"></i></span><span>${o.signals[k].toFixed(2)}</span></div>`).join("")}</div>
        </div>`).join("")
      : `<p class="small muted" style="margin:0">No model is scored. ${v.state === "MISSING_CRITICAL_INFO"
          ? "Critical fields are unknown, and a score computed over defaults is a guess wearing a number's clothes."
          : "Every model failed at least one hard gate."}</p>`;

    if (v.ineligible.length)
      $("#optsBox").innerHTML += `<div class="tiny muted" style="border-top:1px dashed var(--line);padding-top:8px">
        <b>Not scored:</b> ${v.ineligible.map((i) => `${esc(i.label)} <span class="mono">(${i.blocked_by.map((b) => b.id).join(", ")})</span>`).join(" · ")}</div>`;

    // economics
    const e = v.economics;
    $("#econBox").innerHTML = `<dl class="kv">
      <dt>Commission ceiling</dt><dd><b>${pct(e.commission_ceiling)}</b> <span class="tiny muted">= margin × (1 − 40% retained), capped at 40%</span></dd>
      <dt>CPA ceiling</dt><dd>${money(e.cpa_ceiling)} <span class="tiny muted">per order</span></dd>
      <dt>Market rate</dt><dd>${money(e.tier_rate)} <span class="tiny muted">${esc(E.TIER_LABEL[state.creator_tier])}</span></dd>
      <dt>Cost of full ask</dt><dd>${money(e.budget_for_full_ask)} <span class="tiny muted">${state.desired_creator_count} × ${money(e.tier_rate)}</span></dd>
      <dt>Creator capacity</dt><dd>fixed <b>${e.capacity_fixed}</b> · hybrid <b>${e.capacity_hybrid}</b> · gifting <b>${e.capacity_gifting}</b></dd>
      <dt>Landed gift cost</dt><dd>${money(e.landed_gift_cost)} <span class="tiny muted">per unit</span></dd>
      <dt>Pipeline</dt><dd>${e.pipeline_days} days <span class="tiny muted">(${e.pipeline_days_gifting} with shipping)</span></dd>
      <dt>Timeline slack</dt><dd style="color:${e.timeline_slack < 0 ? "var(--danger)" : "var(--ok)"}"><b>${e.timeline_slack} days</b></dd>
      ${e.required_conversions ? `<dt>Orders needed</dt><dd>${e.required_conversions.toLocaleString()}</dd>` : ""}
      <dt>Review ceiling</dt><dd>${e.review_limit} creators</dd></dl>`;

    // negotiation policy
    const p = v.negotiation_policy;
    $("#policyBox").innerHTML = `<dl class="kv">
      <dt>Ceiling</dt><dd><b>${pct(p.commission_ceiling)}</b></dd>
      <dt>Floor</dt><dd>${pct(p.commission_floor)}</dd>
      <dt>Auto-approve below</dt><dd>${pct(p.auto_approve_below)}</dd>
      <dt>Max fee / creator</dt><dd>${money(p.max_fee_per_creator)}</dd>
      <dt>Max total</dt><dd>${money(p.max_total_commitment)}</dd></dl>
      <div class="tiny muted" style="margin-top:8px;border-top:1px dashed var(--line);padding-top:7px">
      <b>Never:</b> ${p.hard_never.map(esc).join(" · ")}</div>
      <div class="note tiny" style="margin-top:9px">Derived, not suggested. The negotiation agent receives a <b>reference</b> to this object, never its values — so no reply from a creator can move a limit the agent is not holding.</div>`;

    policy = p;
    renderDeal();
  }

  /* ---------------- screen 8: policy enforcement ---------------- */
  let policy = null;
  function renderDeal() {
    if (!policy || !$("#d_comm")) return;
    const comm = Number($("#d_comm").value) / 100, fee = Number($("#d_fee").value);
    const errs = [], warns = [];
    if (comm > policy.commission_ceiling)
      errs.push(`Commission ${pct(comm)} exceeds the ${pct(policy.commission_ceiling)} ceiling. Refused at write time.`);
    else if (comm > policy.auto_approve_below)
      warns.push(`${pct(comm)} is above the ${pct(policy.auto_approve_below)} auto-approve threshold — escalated to a human approver.`);
    if (fee > policy.max_fee_per_creator)
      errs.push(`Base fee ${money(fee)} exceeds the ${money(policy.max_fee_per_creator)} per-creator cap.`);

    $("#dealMsg").innerHTML = errs.length
      ? `<div class="verdict danger"><b class="small">Rejected — 403 policy_violation</b>${errs.map((x) => `<div class="tiny" style="margin-top:4px">${esc(x)}</div>`).join("")}</div>`
      : warns.length
      ? `<div class="verdict warn"><b class="small">Accepted, pending approval</b>${warns.map((x) => `<div class="tiny" style="margin-top:4px">${esc(x)}</div>`).join("")}</div>`
      : `<div class="verdict ok"><b class="small">Within policy — auto-approved</b><div class="tiny" style="margin-top:4px">The negotiation agent may close this deal without a human.</div></div>`;
    $("#d_save").disabled = errs.length > 0;

    $("#dealJson").innerHTML = errs.length
      ? `<span class="c">// write refused before any row was created</span>
{ <span class="k">"error"</span>: <span class="s">"policy_violation"</span>,
  <span class="k">"checked_against"</span>: <span class="s">"np_7"</span>,
  <span class="k">"enforced_at"</span>: <span class="s">"deal_write"</span> }`
      : `{
  <span class="k">"deal_id"</span>: <span class="s">"d_4471"</span>,
  <span class="k">"creator"</span>: <span class="s">"@mayaskincare"</span>,
  <span class="k">"campaign_version_id"</span>: <span class="s">"cv_7"</span>,   <span class="c">// pinned</span>
  <span class="k">"overrides"</span>: {                    <span class="c">// sparse — only the diff</span>
    <span class="k">"commission"</span>: <span class="n2">${comm.toFixed(2)}</span>,
    <span class="k">"base_fee"</span>: <span class="n2">${fee}</span>
  },
  <span class="k">"resolved_terms"</span>: { <span class="c">/* frozen at signature */</span> },
  <span class="k">"status"</span>: <span class="s">"${warns.length ? "pending_human_approval" : "auto_approved"}"</span>,
  <span class="k">"approved_by"</span>: <span class="s">"${warns.length ? "escalation:head_of_growth" : "policy:np_7"}"</span>
}`;
  }

  /* ---------------- screen 7: view switch ---------------- */
  $$("#viewSwitch button").forEach((b) => b.addEventListener("click", () => {
    $$("#viewSwitch button").forEach((x) => x.classList.toggle("on", x === b));
    ["brand", "creator", "agent"].forEach((v) => { $("#v_" + v).style.display = v === b.dataset.view ? "" : "none"; });
  }));

  /* ---------------- screen 9: architecture ---------------- */
  let archDrawn = false;

  const ARCH = `flowchart LR
  subgraph S1["1 · Input"]
    direction TB
    WEB["Brand website"]
    SHOP["Shopify / Stripe<br/>AOV · margin · inventory · geo"]
    UI["Campaign Canvas<br/>+ co-pilot rail"]
  end

  subgraph S2["2 · Perception — AI, never trusted directly"]
    direction TB
    ING["Ingestion Agent<br/>page → facts + evidence"]
    QAG["Question Agent<br/>phrasing only"]
    SEX["Strategy Explainer<br/>rationale prose"]
    BWR["Brief Writer<br/>state → sections"]
    RFA["Red-Flag Agent<br/>claims · compliance"]
  end

  VAL{{"4-layer validator<br/>schema · grounding · bounds · provenance"}}

  subgraph S3["3 · Deterministic core"]
    direction TB
    RULES["Rules Engine<br/>gates · scoring · economics"]
    QSEL["Question Selector<br/>gain ÷ effort"]
    STATE["Campaign Service<br/>state machine · versioning"]
  end

  PROP[("proposals<br/>AI-writable · agent-unreadable")]
  HUMAN(["Human approval<br/>campaign:approve"])
  VER[("campaign_versions<br/>immutable · audited")]

  subgraph S5["5 · Scoped access"]
    direction TB
    PROJ["Projection<br/>project(campaign, audience)"]
    POL["Policy Enforcer<br/>bounds checked at deal write"]
  end

  DOWN["Sourcing · Outreach · Negotiation<br/>Content review · Payouts"]

  WEB --> ING
  UI --> STATE
  SHOP --> STATE
  ING --> VAL
  QAG --> VAL
  SEX --> VAL
  BWR --> VAL
  RFA --> VAL
  VAL --> PROP
  STATE --> RULES
  STATE --> QSEL
  QSEL --> QAG
  RULES --> SEX
  PROP --> HUMAN
  HUMAN --> VER
  VER --> PROJ
  PROJ --> DOWN
  DOWN --> POL
  POL --> VER

  classDef ai fill:#f5edfc,stroke:#7a3fb8,color:#4a1f6e
  classDef det fill:#eaf0ff,stroke:#2f5bd8,color:#17307a
  classDef hum fill:#e6f5ee,stroke:#1a7f52,color:#0d4a30
  classDef dat fill:#ffffff,stroke:#aab4c0,color:#41505f
  class ING,QAG,SEX,BWR,RFA ai
  class RULES,QSEL,STATE,PROJ,POL,VAL det
  class HUMAN hum
  class WEB,SHOP,UI,DOWN,PROP,VER dat`;

  const BARRIER = `flowchart LR
  A["AI proposes<br/>commission 27%"] --> B{{"Schema"}}
  B -->|invalid| X1["Retry once,<br/>then ask a human"]
  B -->|valid| C{{"Grounded?"}}
  C -->|no source| X2["Dropped.<br/>Never stored."]
  C -->|sourced| D{{"Within derived bounds?"}}
  D -->|27% > 40% ceiling| X3["Rejected before render.<br/>The brand never sees it."]
  D -->|in bounds| E[("proposals<br/>status = pending")]
  E --> F(["Human accepts the diff<br/>campaign:approve"])
  F --> G[("campaign_versions v7<br/>+ audit_log row")]
  G --> H["Downstream agents<br/>read approved only"]
  E -.->|no read path| H

  classDef ai fill:#f5edfc,stroke:#7a3fb8,color:#4a1f6e
  classDef det fill:#eaf0ff,stroke:#2f5bd8,color:#17307a
  classDef hum fill:#e6f5ee,stroke:#1a7f52,color:#0d4a30
  classDef bad fill:#fdeceb,stroke:#b4342c,color:#7d2722
  classDef dat fill:#ffffff,stroke:#aab4c0,color:#41505f
  class A ai
  class B,C,D det
  class X1,X2,X3 bad
  class F hum
  class E,G,H dat`;

  function drawArchitecture() {
    if (archDrawn) return;
    archDrawn = true;
    const fail = '<p class="small muted">Diagram unavailable — see the architecture section of the written proposal.</p>';
    const targets = [["#archDiagram", ARCH, "archSvg"], ["#barrierDiagram", BARRIER, "barSvg"]];
    targets.forEach(([sel]) => { if ($(sel)) $(sel).innerHTML = '<p class="muted small">Rendering diagram…</p>'; });
    const s = document.createElement("script");
    s.src = "mermaid.min.js";
    s.onload = () => {
      window.mermaid.initialize({ startOnLoad: false, theme: "base", flowchart: { curve: "basis", padding: 16, nodeSpacing: 34, rankSpacing: 62 },
        themeVariables: { fontFamily: "-apple-system, Segoe UI, Roboto, sans-serif", fontSize: "14px", lineColor: "#93a0ad" } });
      targets.forEach(([sel, def, id]) => {
        const el = $(sel); if (!el) return;
        window.mermaid.render(id, def).then(({ svg }) => { el.innerHTML = svg; }).catch(() => { el.innerHTML = fail; });
      });
    };
    s.onerror = () => targets.forEach(([sel]) => { if ($(sel)) $(sel).innerHTML = fail; });
    document.body.appendChild(s);
  }

  /* ---------------- bind ---------------- */
  INPUTS.forEach((k) => {
    const el = $("#i_" + k); if (!el) return;
    el.addEventListener("input", () => { readInputs(); render(); });
    el.addEventListener("change", () => { readInputs(); render(); });
  });
  ["#d_comm", "#d_fee"].forEach((s) => $(s) && $(s).addEventListener("input", renderDeal));
  $("#resetBtn").addEventListener("click", () => { state = Object.assign({}, SCENARIOS.A); writeInputs(); render(); });
  $$("[data-scn]").forEach((b) => b.addEventListener("click", () => {
    state = Object.assign({}, SCENARIOS[b.dataset.scn]); writeInputs(); render();
  }));

  writeInputs();
  render();
  if (location.hash && $(location.hash)) go(location.hash.slice(1));
})();
