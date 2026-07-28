/* Engine verification: worked examples + invariants.
 * Run: node engine.test.js
 * The numbers this prints are the numbers printed in the proposal. */

const E = require("./engine.js");
const { money, pct } = E.fmt;

let failures = 0;
function assert(name, cond, extra) {
  if (cond) { console.log("  PASS  " + name); }
  else { failures++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
}
function h(t) { console.log("\n" + "=".repeat(72) + "\n" + t + "\n" + "=".repeat(72)); }

function report(v) {
  console.log(`  state         : ${v.state}  (${v.state_label})`);
  console.log(`  headline      : ${v.headline}`);
  if (v.recommendation) console.log(`  recommendation: ${v.recommendation.label}  score ${v.recommendation.score}`);
  console.log(`  alternatives  : ${v.alternatives.map(a => a.label + " " + a.score).join(", ") || "none"}`);
  console.log(`  ineligible    : ${v.ineligible.map(i => i.label + " [" + i.blocked_by.map(b => b.id).join(",") + "]").join(" | ") || "none"}`);
  const e = v.economics;
  console.log(`  economics     : ceiling ${pct(e.commission_ceiling)} | CPA ${money(e.cpa_ceiling)} | tier rate ${money(e.tier_rate)}`);
  console.log(`                : capacity fixed ${e.capacity_fixed} / hybrid ${e.capacity_hybrid} / gifting ${e.capacity_gifting}`);
  console.log(`                : pipeline ${e.pipeline_days}d (gifting ${e.pipeline_days_gifting}d) | slack ${e.timeline_slack}d`);
  if (v.warnings.length) console.log(`  warnings      : ${v.warnings.join(" ")}`);
  if (v.remedies.length) v.remedies.forEach(r => console.log(`  remedy        : ${r}`));
}

/* -------------------------------------------------------------------------
 * WORKED EXAMPLE A — DTC skincare, Shopify connected, inventory on hand.
 * Expect: gifting and commission models eligible; fixed-fee blocked on cash.
 * ---------------------------------------------------------------------- */
h("EXAMPLE A — Skincare DTC: $3,000 / 6 weeks / 25 micro creators / 200 units");
const A = {
  objective: "sales", product_type: "physical", budget_cash: 3000, aov: 48,
  gross_margin: 0.68, units_available: 200, cogs_per_unit: 12,
  shipping_cost_per_unit: 7, ships_to_target_geo: true, can_track_conversions: true,
  desired_creator_count: 25, days_until_launch: 42, creator_tier: "micro",
  review_capacity: "medium", content_rights: "organic_only", requires_content_approval: true,
  target_revenue: 30000,
};
const va = E.evaluate(A);
report(va);
assert("A: a recommendation exists", !!va.recommendation);
assert("A: fixed-fee blocked on cash (25 x $250 = $6,250 > $3,000)",
  va.ineligible.some(i => i.model === "fixed_fee" && i.blocked_by.some(b => b.id === "CASH")));
assert("A: commission ceiling is 40.8% -> hard-capped to 40%", va.economics.commission_ceiling === 0.4);
assert("A: gifting eligible (200 units >= 25 creators)", !va.ineligible.some(i => i.model === "gifting"));

/* -------------------------------------------------------------------------
 * WORKED EXAMPLE B — the campaign the system must refuse to flatter.
 * ---------------------------------------------------------------------- */
h("EXAMPLE B — SaaS launch: $500 / 21 days / 50 micro creators / no tracking");
const B = {
  objective: "awareness", product_type: "digital", budget_cash: 500, aov: 29,
  gross_margin: 0.85, units_available: 0, can_track_conversions: false,
  desired_creator_count: 50, days_until_launch: 21, creator_tier: "micro",
  review_capacity: "low", content_rights: "paid_usage", requires_content_approval: true,
};
const vb = E.evaluate(B);
report(vb);
assert("B: verdict is UNREALISTIC", vb.state === "UNREALISTIC");
assert("B: no model survives its gates", vb.recommendation === null);
assert("B: remedies are named and quantified", vb.remedies.length > 0);

/* -------------------------------------------------------------------------
 * EXAMPLE C — same as B but rescoped on the system's own advice.
 * ---------------------------------------------------------------------- */
h("EXAMPLE C — Example B rescoped: tracking connected, 8 creators, 60 days");
const C = Object.assign({}, B, {
  can_track_conversions: true, desired_creator_count: 8, days_until_launch: 60,
  content_rights: "organic_only", budget_cash: 2500, objective: "sales",
});
const vc = E.evaluate(C);
report(vc);
assert("C: rescoping produces a viable campaign", vc.recommendation !== null);
assert("C: gifting stays ineligible for a digital product",
  vc.ineligible.some(i => i.model === "gifting" && i.blocked_by.some(b => b.id === "PHYSICAL")));

/* -------------------------------------------------------------------------
 * EXAMPLE D — missing information outranks every other verdict.
 * ---------------------------------------------------------------------- */
h("EXAMPLE D — incomplete state");
const vd = E.evaluate({ objective: "sales", product_type: "physical", budget_cash: 5000 });
report(vd);
assert("D: verdict is MISSING_CRITICAL_INFO", vd.state === "MISSING_CRITICAL_INFO");
assert("D: every blocking field is named with a reason",
  vd.missing.length >= 4 && vd.missing.every(m => m.why && m.label));

/* -------------------------------------------------------------------------
 * INVARIANTS — property tests over 20,000 randomised states.
 * These are the guarantees the proposal claims; here they are, checked.
 * ---------------------------------------------------------------------- */
h("INVARIANTS — 20,000 randomised campaign states");
const pick = a => a[Math.floor(Math.random() * a.length)];
let checked = 0, iv1 = 0, iv2 = 0, iv3 = 0, iv4 = 0;
for (let i = 0; i < 20000; i++) {
  const st = {
    objective: pick(["sales", "traffic", "awareness", "content_ugc", "launch"]),
    product_type: pick(["physical", "digital", "service", "subscription"]),
    budget_cash: Math.round(Math.random() * 60000),
    aov: Math.round(5 + Math.random() * 400),
    gross_margin: Math.random(),
    units_available: Math.round(Math.random() * 400),
    cogs_per_unit: Math.round(Math.random() * 120),
    shipping_cost_per_unit: Math.round(Math.random() * 40),
    ships_to_target_geo: Math.random() > 0.25,
    can_track_conversions: Math.random() > 0.35,
    desired_creator_count: 1 + Math.round(Math.random() * 120),
    days_until_launch: Math.round(Math.random() * 120),
    creator_tier: pick(["nano", "micro", "mid", "macro"]),
    review_capacity: pick(["low", "medium", "high"]),
    content_rights: pick(["organic_only", "whitelisting", "paid_usage"]),
    requires_content_approval: Math.random() > 0.5,
  };
  const v = E.evaluate(st);
  checked++;

  // I1: a recommended model has passed every one of its own gates.
  if (v.recommendation && !v.gates[v.recommendation.model].every(g => g.pass)) iv1++;

  // I2: no proposed commission ever exceeds the hard cap.
  if (v.negotiation_policy.commission_ceiling > 0.4 + 1e-9) iv2++;

  // I3: the escalation threshold never sits above the ceiling.
  if (v.negotiation_policy.escalate_above > v.negotiation_policy.commission_ceiling + 1e-9) iv3++;

  // I4: any non-READY verdict always tells the brand what to do next.
  if (v.state !== "READY" && v.remedies.length === 0 && v.missing.length === 0) iv4++;
}
assert(`I1  recommended model always passes its own gates (${checked} states)`, iv1 === 0, iv1 + " violations");
assert("I2  commission ceiling never exceeds the 40% hard cap", iv2 === 0, iv2 + " violations");
assert("I3  escalation threshold never exceeds the ceiling", iv3 === 0, iv3 + " violations");
assert("I4  every non-ready verdict names a next action", iv4 === 0, iv4 + " violations");

/* Determinism: same input, same output, always. */
const d1 = JSON.stringify(E.evaluate(A)), d2 = JSON.stringify(E.evaluate(A));
assert("I5  evaluation is deterministic", d1 === d2);

console.log("\n" + "=".repeat(72));
console.log(failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED");
console.log("=".repeat(72));
process.exit(failures ? 1 : 0);
