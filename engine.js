/* =============================================================================
 * Campaign Feasibility & Recommendation Engine
 * -----------------------------------------------------------------------------
 * Deterministic. Pure functions. No network, no model calls, no randomness.
 *
 * This file is the single source of truth for campaign logic. The written
 * proposal quotes these exact formulas, and the prototype UI calls this exact
 * file. Document and prototype therefore cannot drift.
 *
 * Design rule enforced throughout:
 *   The engine produces the NUMBERS and the VERDICT.
 *   A language model may only produce the PROSE that explains them.
 * ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CampaignEngine = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ---------------------------------------------------------------------------
   * 1. CONSTANTS — every magic number lives here, named and sourced.
   *    Tunable per-tenant later; global defaults for v1.
   * ------------------------------------------------------------------------ */

  const MODELS = ["affiliate", "performance_affiliate", "gifting", "fixed_fee", "hybrid"];

  const MODEL_LABEL = {
    affiliate: "Affiliate",
    performance_affiliate: "Performance Affiliate",
    gifting: "Gifting",
    fixed_fee: "Fixed Fee",
    hybrid: "Hybrid",
  };

  // Blended market rate for one creator's standard deliverable set (2 posts +
  // usage), by audience tier. Used for cash-feasibility gates and capacity math.
  const TIER_RATE = { nano: 75, micro: 250, mid: 900, macro: 3000 };
  const TIER_LABEL = { nano: "Nano (1–10k)", micro: "Micro (10–100k)", mid: "Mid (100–500k)", macro: "Macro (500k+)" };

  // A hybrid deal's guaranteed cash leg, as a share of the full fixed rate.
  const HYBRID_BASE_SHARE = 0.35;

  // Share of per-order contribution the brand keeps after paying commission.
  const RETAINED_MARGIN_TARGET = 0.4;

  // Hard cap on any commission the system will ever propose.
  const COMMISSION_HARD_CAP = 0.4;

  // A creator will not work an affiliate deal for a trivial per-order payout.
  const MIN_CREATOR_PAYOUT_PER_ORDER = 5;

  // Gifting only motivates when the product's retail value is meaningful.
  const MIN_GIFT_RETAIL_VALUE = 25;

  // Above this landed cost, gifting a unit costs more than paying a nano fee.
  const MAX_GIFT_LANDED_COST = 150;

  // Affiliate needs margin room to fund a commission at all.
  const MIN_MARGIN_FOR_COMMISSION = 0.25;

  // A performance bonus pool needs real cash behind it.
  const MIN_BONUS_POOL = 500;

  // How many creators a brand can realistically review/approve per campaign.
  const REVIEW_CAPACITY_LIMIT = { low: 10, medium: 40, high: 150 };

  // Pipeline lead times in days, per stage. Summed to test timeline feasibility.
  const PIPELINE_DAYS = {
    sourcing: 7,
    outreach_negotiation: 10,
    contracting: 4,
    production: 14,
    approval_loop: 5, // only when the brand requires content approval
    shipping: 7,      // only for gifting
  };

  // Fit-scoring weights. Sum to 1.00. Deliberately few and deliberately visible.
  const WEIGHTS = {
    objective_fit: 0.3,
    budget_efficiency: 0.2,
    deliverable_certainty: 0.15,
    economic_headroom: 0.15,
    timeline_fit: 0.12,
    ops_burden: 0.08,
  };

  // How well each model serves each campaign objective. Hand-set, reviewable,
  // and the one table a growth team would actually want to argue about.
  const OBJECTIVE_FIT = {
    sales:       { affiliate: 0.95, performance_affiliate: 1.0,  gifting: 0.35, fixed_fee: 0.55, hybrid: 0.9 },
    traffic:     { affiliate: 0.8,  performance_affiliate: 0.85, gifting: 0.45, fixed_fee: 0.7,  hybrid: 0.85 },
    awareness:   { affiliate: 0.35, performance_affiliate: 0.45, gifting: 0.75, fixed_fee: 0.95, hybrid: 0.8 },
    content_ugc: { affiliate: 0.25, performance_affiliate: 0.3,  gifting: 0.85, fixed_fee: 1.0,  hybrid: 0.75 },
    launch:      { affiliate: 0.45, performance_affiliate: 0.6,  gifting: 0.8,  fixed_fee: 0.9,  hybrid: 0.95 },
  };

  // How reliably each model yields the deliverables the brand asked for.
  const DELIVERABLE_CERTAINTY = {
    affiliate: 0.35, performance_affiliate: 0.5, gifting: 0.3, fixed_fee: 1.0, hybrid: 0.85,
  };

  // Operational burden each model puts on the brand (1 = heaviest).
  const OPS_BURDEN = {
    affiliate: 0.25, performance_affiliate: 0.45, gifting: 0.8, fixed_fee: 0.7, hybrid: 0.75,
  };

  // Fields without which no verdict can be computed honestly.
  const CRITICAL_FIELDS = [
    ["objective", "Campaign objective", "Selects the objective-fit row for every model."],
    ["product_type", "Product type", "Gates gifting: only physical goods can be shipped."],
    ["budget_cash", "Cash budget", "Gates fixed-fee and hybrid; drives creator capacity."],
    ["aov", "Average order value", "Drives commission ceiling, CPA ceiling and gift-value gate."],
    ["gross_margin", "Gross margin", "Sets the commission ceiling. Without it no rate is safe to propose."],
    ["can_track_conversions", "Conversion tracking", "Hard gate on all commission-bearing models."],
    ["desired_creator_count", "Target creator count", "Drives capacity, inventory and review-capacity gates."],
    ["days_until_launch", "Days until launch", "Tests the campaign against real pipeline lead time."],
  ];

  const round = (n, d = 2) => { const f = Math.pow(10, d); return Math.round(n * f) / f; };
  const clamp01 = (n) => Math.max(0, Math.min(1, n));
  const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
  const pct = (n) => Math.round(n * 100) + "%";

  /* ---------------------------------------------------------------------------
   * 2. NORMALISATION — an explicit, inspectable default for every input.
   * ------------------------------------------------------------------------ */

  function normalise(raw) {
    const s = Object.assign({}, raw);
    s.objective = s.objective || "sales";
    s.product_type = s.product_type || "physical";
    s.creator_tier = s.creator_tier || "micro";
    s.review_capacity = s.review_capacity || "medium";
    s.content_rights = s.content_rights || "organic_only"; // organic_only | whitelisting | paid_usage
    s.retained_margin_target = s.retained_margin_target ?? RETAINED_MARGIN_TARGET;
    s.requires_content_approval = s.requires_content_approval ?? true;
    s.units_available = s.units_available ?? 0;
    s.cogs_per_unit = s.cogs_per_unit ?? (s.aov ? round(s.aov * (1 - (s.gross_margin ?? 0.5)), 2) : 0);
    s.shipping_cost_per_unit = s.shipping_cost_per_unit ?? 8;
    s.ships_to_target_geo = s.ships_to_target_geo ?? true;
    s.target_revenue = s.target_revenue ?? null;
    return s;
  }

  /* ---------------------------------------------------------------------------
   * 3. DERIVED ECONOMICS — arithmetic only. Never inferred, never generated.
   * ------------------------------------------------------------------------ */

  function deriveEconomics(s) {
    const rate = TIER_RATE[s.creator_tier];

    // The brand keeps `retained_margin_target` of per-order contribution;
    // everything else is available to pay a creator.
    const commission_ceiling = Math.min(
      COMMISSION_HARD_CAP,
      Math.max(0, (s.gross_margin ?? 0) * (1 - s.retained_margin_target))
    );

    const cpa_ceiling = (s.aov ?? 0) * commission_ceiling;
    const creator_payout_per_order = cpa_ceiling;
    const landed_gift_cost = (s.cogs_per_unit ?? 0) + (s.shipping_cost_per_unit ?? 0);
    const desired = s.desired_creator_count ?? 0;

    const capacity_fixed = rate > 0 ? Math.floor((s.budget_cash ?? 0) / rate) : 0;
    const capacity_hybrid = rate > 0 ? Math.floor((s.budget_cash ?? 0) / (rate * HYBRID_BASE_SHARE)) : 0;
    const capacity_gifting = Math.min(
      s.units_available ?? 0,
      landed_gift_cost > 0 ? Math.floor(((s.budget_cash ?? 0) || Infinity) / landed_gift_cost) : Infinity
    );

    let pipeline_days = PIPELINE_DAYS.sourcing + PIPELINE_DAYS.outreach_negotiation +
                        PIPELINE_DAYS.contracting + PIPELINE_DAYS.production;
    if (s.requires_content_approval) pipeline_days += PIPELINE_DAYS.approval_loop;
    const pipeline_days_gifting = pipeline_days + PIPELINE_DAYS.shipping;

    const required_conversions = s.target_revenue && s.aov ? Math.ceil(s.target_revenue / s.aov) : null;

    return {
      tier_rate: rate,
      commission_ceiling,
      commission_ceiling_pct: pct(commission_ceiling),
      cpa_ceiling: round(cpa_ceiling, 2),
      creator_payout_per_order: round(creator_payout_per_order, 2),
      landed_gift_cost: round(landed_gift_cost, 2),
      total_gift_cost: round(landed_gift_cost * Math.min(desired, s.units_available ?? 0), 2),
      capacity_fixed,
      capacity_hybrid,
      capacity_gifting: capacity_gifting === Infinity ? (s.units_available ?? 0) : capacity_gifting,
      pipeline_days,
      pipeline_days_gifting,
      timeline_slack: (s.days_until_launch ?? 0) - pipeline_days,
      timeline_slack_gifting: (s.days_until_launch ?? 0) - pipeline_days_gifting,
      required_conversions,
      budget_for_full_ask: round(rate * desired, 2),
      review_limit: REVIEW_CAPACITY_LIMIT[s.review_capacity],
    };
  }

  /* ---------------------------------------------------------------------------
   * 4. ELIGIBILITY GATES — hard booleans. A failed gate is disqualifying and
   *    individually explainable. No score can rescue a failed gate.
   * ------------------------------------------------------------------------ */

  function gate(id, label, pass, detail) { return { id, label, pass: !!pass, detail }; }

  function evaluateGates(s, e) {
    const desired = s.desired_creator_count ?? 0;
    const g = {};

    const trackGate = () => gate("TRACK", "Conversion tracking connected",
      s.can_track_conversions,
      s.can_track_conversions
        ? "Shopify/Stripe attribution is live, so commission can be measured and paid."
        : "No attribution source. A commission that cannot be measured cannot be owed.");

    const marginGate = () => gate("MARGIN", "Margin funds a commission",
      (s.gross_margin ?? 0) >= MIN_MARGIN_FOR_COMMISSION,
      `Gross margin ${pct(s.gross_margin ?? 0)} vs. ${pct(MIN_MARGIN_FOR_COMMISSION)} minimum.`);

    const payoutGate = () => gate("PAYOUT", "Creator payout clears the floor",
      e.creator_payout_per_order >= MIN_CREATOR_PAYOUT_PER_ORDER,
      `${money(e.creator_payout_per_order)} per order at the ${e.commission_ceiling_pct} ceiling vs. a ${money(MIN_CREATOR_PAYOUT_PER_ORDER)} floor.`);

    const rightsGate = () => gate("RIGHTS", "Requested rights are purchasable",
      s.content_rights !== "paid_usage",
      s.content_rights === "paid_usage"
        ? "Paid usage rights require a cash fee. No-cash models cannot buy them."
        : "Organic or whitelisted usage is obtainable without a cash fee.");

    g.affiliate = [trackGate(), marginGate(), payoutGate(), rightsGate()];

    g.performance_affiliate = [
      trackGate(), marginGate(), payoutGate(),
      gate("BONUS_POOL", "Bonus pool is funded",
        (s.budget_cash ?? 0) >= MIN_BONUS_POOL,
        `${money(s.budget_cash ?? 0)} cash vs. ${money(MIN_BONUS_POOL)} minimum to make a milestone bonus credible.`),
    ];

    g.gifting = [
      gate("PHYSICAL", "Product is physically shippable",
        s.product_type === "physical",
        s.product_type === "physical" ? "Physical goods can be gifted." : `A ${s.product_type} product cannot be shipped as a gift.`),
      gate("INVENTORY", "Inventory covers the creator target",
        (s.units_available ?? 0) >= desired,
        `${s.units_available ?? 0} units available vs. ${desired} creators targeted.`),
      gate("SHIPPING", "Shipping reaches the target geography",
        s.ships_to_target_geo,
        s.ships_to_target_geo ? "Target markets are inside the shipping footprint." : "Target markets sit outside the current shipping footprint."),
      gate("GIFT_VALUE", "Gift is worth a creator's time",
        (s.aov ?? 0) >= MIN_GIFT_RETAIL_VALUE,
        `${money(s.aov ?? 0)} retail value vs. a ${money(MIN_GIFT_RETAIL_VALUE)} floor below which creators decline.`),
      gate("GIFT_COST", "Gifting is cheaper than paying",
        e.landed_gift_cost <= MAX_GIFT_LANDED_COST,
        `${money(e.landed_gift_cost)} landed cost per unit vs. a ${money(MAX_GIFT_LANDED_COST)} ceiling.`),
    ];

    g.fixed_fee = [
      gate("CASH", "Cash covers the creator target at market rate",
        (s.budget_cash ?? 0) >= e.tier_rate * desired,
        `${money(s.budget_cash ?? 0)} vs. ${money(e.tier_rate * desired)} needed (${desired} × ${money(e.tier_rate)} ${TIER_LABEL[s.creator_tier]}).`),
      gate("REVIEW", "Brand can review this many creators",
        desired <= e.review_limit,
        `${desired} creators vs. a ${e.review_limit}-creator ceiling at ${s.review_capacity} review capacity.`),
    ];

    g.hybrid = [
      trackGate(), marginGate(),
      gate("BASE_CASH", "Cash covers the guaranteed base leg",
        (s.budget_cash ?? 0) >= e.tier_rate * HYBRID_BASE_SHARE * desired,
        `${money(s.budget_cash ?? 0)} vs. ${money(e.tier_rate * HYBRID_BASE_SHARE * desired)} needed for a ${pct(HYBRID_BASE_SHARE)} base across ${desired} creators.`),
      gate("REVIEW", "Brand can review this many creators",
        desired <= e.review_limit,
        `${desired} creators vs. a ${e.review_limit}-creator ceiling at ${s.review_capacity} review capacity.`),
    ];

    return g;
  }

  /* ---------------------------------------------------------------------------
   * 5. FIT SCORING — runs only over models that survived their gates.
   *    Six visible signals, fixed weights, fully reproducible.
   * ------------------------------------------------------------------------ */

  function scoreModel(model, s, e) {
    const desired = s.desired_creator_count ?? 0;

    const capacity =
      model === "fixed_fee" ? e.capacity_fixed :
      model === "hybrid" ? e.capacity_hybrid :
      model === "gifting" ? e.capacity_gifting :
      desired; // commission-only models are not cash-capped on volume

    const slack = model === "gifting" ? e.timeline_slack_gifting : e.timeline_slack;

    const signals = {
      objective_fit: OBJECTIVE_FIT[s.objective][model],
      budget_efficiency: desired > 0 ? clamp01(capacity / desired) : 1,
      deliverable_certainty: DELIVERABLE_CERTAINTY[model],
      economic_headroom:
        model === "gifting"
          ? clamp01(1 - e.landed_gift_cost / MAX_GIFT_LANDED_COST)
          : model === "fixed_fee"
          ? clamp01((s.budget_cash ?? 0) / Math.max(1, e.tier_rate * desired) - 0.5)
          : clamp01(e.commission_ceiling / COMMISSION_HARD_CAP),
      timeline_fit: clamp01(0.5 + slack / 40),
      ops_burden: 1 - OPS_BURDEN[model],
    };

    let score = 0;
    for (const k of Object.keys(WEIGHTS)) score += WEIGHTS[k] * signals[k];

    return { model, label: MODEL_LABEL[model], score: round(score, 3), signals, capacity };
  }

  /* ---------------------------------------------------------------------------
   * 6. REMEDIES — every blocker converts to a concrete, quantified change.
   *    "Feasible with changes" is worthless unless it names the change.
   * ------------------------------------------------------------------------ */

  function buildRemedies(s, e, gates, model, ranked) {
    const out = [];
    const desired = s.desired_creator_count ?? 0;
    const failed = (gates[model] || []).filter((g) => !g.pass).map((g) => g.id);

    if (failed.includes("CASH")) {
      out.push(`Raise cash budget to ${money(e.tier_rate * desired)}`);
      out.push(`or cut the creator target from ${desired} to ${e.capacity_fixed}`);
      out.push(`or step down to ${TIER_LABEL[nextTierDown(s.creator_tier)]} creators`);
    }
    if (failed.includes("BASE_CASH")) {
      out.push(`Raise cash budget to ${money(e.tier_rate * HYBRID_BASE_SHARE * desired)} to fund the base leg`);
      out.push(`or cut the creator target from ${desired} to ${e.capacity_hybrid}`);
    }
    if (failed.includes("INVENTORY")) {
      out.push(`Allocate ${desired - (s.units_available ?? 0)} more units`);
      out.push(`or cut the creator target from ${desired} to ${s.units_available ?? 0}`);
    }
    if (failed.includes("TRACK")) out.push("Connect Shopify or Stripe to unlock every commission-bearing model");
    if (failed.includes("SHIPPING")) out.push("Extend the shipping footprint, or retarget to markets you already ship to");
    if (failed.includes("REVIEW")) out.push(`Cut the creator target to ${e.review_limit}, or raise review capacity`);
    if (failed.includes("BONUS_POOL")) out.push(`Fund a bonus pool of at least ${money(MIN_BONUS_POOL)}`);
    if (failed.includes("MARGIN") || failed.includes("PAYOUT"))
      out.push("Commission economics do not clear — a cash-funded model is the realistic route");
    if (failed.includes("RIGHTS")) out.push("Drop to organic/whitelisted usage, or budget a cash fee for paid usage");
    if (failed.includes("PHYSICAL"))
      out.push(`Gifting needs a shippable good; a ${s.product_type} product rules it out — use a cash or commission model`);
    if (failed.includes("GIFT_VALUE"))
      out.push(`Product retail value ${money(s.aov ?? 0)} is below the ${money(MIN_GIFT_RETAIL_VALUE)} creators accept as payment — bundle units to raise perceived value, or pay a fee`);
    if (failed.includes("GIFT_COST"))
      out.push(`Landed cost ${money(e.landed_gift_cost)} exceeds the ${money(MAX_GIFT_LANDED_COST)} ceiling — at this cost a cash fee buys guaranteed deliverables for less`);

    const slack = model === "gifting" ? e.timeline_slack_gifting : e.timeline_slack;
    if (slack < 0) {
      out.push(`Move launch ${Math.abs(slack)} days later (pipeline needs ${model === "gifting" ? e.pipeline_days_gifting : e.pipeline_days} days)`);
      if (s.requires_content_approval) out.push(`or drop the content-approval gate to recover ${PIPELINE_DAYS.approval_loop} days`);
    }

    // Constraints that bind without failing a gate. A model can clear every
    // hard gate and still be the wrong campaign; say so, with a number.
    const cap = ranked && ranked.length ? ranked[0].capacity : null;
    if (cap !== null && cap < desired && !failed.includes("CASH") && !failed.includes("BASE_CASH") && !failed.includes("INVENTORY")) {
      out.push(`Budget funds ${cap} of ${desired} creators — cut the target to ${cap}, or raise budget`);
    }
    if (ranked && ranked.length && ranked[0].score < 0.55) {
      const weakest = Object.entries(ranked[0].signals).sort((a, b) => a[1] - b[1])[0];
      out.push(`Weakest signal is ${weakest[0].replace(/_/g, " ")} (${round(weakest[1], 2)}) for a ${s.objective.replace(/_/g, " ")} objective`);
      if (ranked[1]) out.push(`Consider ${MODEL_LABEL[ranked[1].model]} instead (scores ${ranked[1].score})`);
      else out.push("Reconsider the objective, or widen the models you are willing to run");
    }

    // Backstop. A verdict that is not READY must never reach a brand without a
    // next action; if no specific remedy fired, name the blockers explicitly.
    if (!out.length && failed.length)
      out.push(`Blocked by ${failed.join(", ")} on ${MODEL_LABEL[model]} — see the gate detail for each`);
    return out;
  }

  // Gates a brand cannot act on. Product type is a fact about the business, not
  // a campaign lever, so a model blocked only by PHYSICAL is not the "closest".
  const UNFIXABLE_GATES = ["PHYSICAL"];

  function nextTierDown(tier) {
    const order = ["macro", "mid", "micro", "nano"];
    const i = order.indexOf(tier);
    return i < order.length - 1 ? order[i + 1] : tier;
  }

  /* ---------------------------------------------------------------------------
   * 7. THE VERDICT — one pure function, recomputed on every state mutation.
   * ------------------------------------------------------------------------ */

  function evaluate(rawState) {
    const s = normalise(rawState);

    // 7a. Missing critical information outranks every other verdict. The system
    //     must never guess its way past a field it needs.
    const missing = CRITICAL_FIELDS
      .filter(([k]) => s[k] === null || s[k] === undefined || s[k] === "")
      .map(([field, label, why]) => ({ field, label, why }));

    const economics = deriveEconomics(s);
    const gates = evaluateGates(s, economics);

    const eligible = MODELS.filter((m) => gates[m].every((g) => g.pass));
    const ineligible = MODELS.filter((m) => !eligible.includes(m)).map((m) => ({
      model: m,
      label: MODEL_LABEL[m],
      blocked_by: gates[m].filter((g) => !g.pass),
    }));

    const ranked = eligible.map((m) => scoreModel(m, s, economics)).sort((a, b) => b.score - a.score);

    if (missing.length) {
      // No recommendation is emitted while critical fields are unknown. A score
      // computed over defaulted inputs is a guess wearing a number's clothes.
      return verdict("MISSING_CRITICAL_INFO", s, economics, gates, [], ineligible, missing,
        `${missing.length} field${missing.length > 1 ? "s" : ""} must be answered before any model can be scored honestly.`,
        missing.map((m) => `Answer: ${m.label} — ${m.why}`));
    }

    if (!ranked.length) {
      // Nothing survives. Surface the binding constraint rather than a shrug.
      // "Closest" means closest to *achievable*, so a model blocked by a fact
      // the brand cannot change ranks behind one blocked by more, fixable gates.
      const nearest = MODELS
        .map((m) => {
          const f = gates[m].filter((g) => !g.pass);
          return { m, fails: f.length, unfixable: f.filter((g) => UNFIXABLE_GATES.includes(g.id)).length };
        })
        .sort((a, b) => a.unfixable - b.unfixable || a.fails - b.fails)[0];
      return verdict("UNREALISTIC", s, economics, gates, ranked, ineligible, missing,
        `No partnership model clears its economics on these inputs. Closest is ${MODEL_LABEL[nearest.m]}, blocked by ${nearest.fails} gate${nearest.fails > 1 ? "s" : ""}.`,
        buildRemedies(s, economics, gates, nearest.m, ranked));
    }

    const top = ranked[0];
    const warnings = [];
    const slack = top.model === "gifting" ? economics.timeline_slack_gifting : economics.timeline_slack;
    if (slack < 0) warnings.push(`Launch date is ${Math.abs(slack)} days inside the ${top.model === "gifting" ? economics.pipeline_days_gifting : economics.pipeline_days}-day pipeline.`);
    if (top.capacity < (s.desired_creator_count ?? 0))
      warnings.push(`Budget reaches ${top.capacity} of ${s.desired_creator_count} creators.`);
    if (top.score < 0.55) warnings.push(`Best available fit scores ${top.score} — workable, but not a strong match for a ${s.objective.replace("_", " ")} objective.`);

    if (warnings.length) {
      return verdict("FEASIBLE_WITH_CHANGES", s, economics, gates, ranked, ineligible, missing,
        `${top.label} is viable, with ${warnings.length} constraint${warnings.length > 1 ? "s" : ""} to resolve first.`,
        buildRemedies(s, economics, gates, top.model, ranked), warnings);
    }

    return verdict("READY", s, economics, gates, ranked, ineligible, missing,
      `${top.label} clears every gate. The brief can be approved and downstream agents armed.`, [], []);
  }

  const STATE_META = {
    READY:                 { label: "Ready to approve",        tone: "ok",     action: "Approve the brief; sourcing and outreach agents can be armed." },
    FEASIBLE_WITH_CHANGES: { label: "Feasible with changes",   tone: "warn",   action: "Apply one of the named changes, then re-run." },
    MISSING_CRITICAL_INFO: { label: "Missing critical info",   tone: "info",   action: "Answer the blocking fields. No verdict is issued until they are known." },
    UNREALISTIC:           { label: "Not realistic as scoped", tone: "danger", action: "Rescope against the binding constraint below." },
  };

  function verdict(state, s, economics, gates, ranked, ineligible, missing, headline, remedies, warnings) {
    return {
      state,
      state_label: STATE_META[state].label,
      tone: STATE_META[state].tone,
      next_action: STATE_META[state].action,
      headline,
      recommendation: ranked[0] || null,
      alternatives: ranked.slice(1),
      ineligible,
      missing,
      warnings: warnings || [],
      remedies: remedies || [],
      economics,
      gates,
      // The negotiation ceiling is DERIVED here and enforced server-side at
      // deal-write time. It is never a number a model was asked to suggest.
      negotiation_policy: {
        // Every derived bound is clamped to the ceiling. Rounding must never be
        // able to lift a threshold above the limit it is meant to sit under.
        commission_ceiling: economics.commission_ceiling,
        commission_floor: Math.min(economics.commission_ceiling, round(economics.commission_ceiling * 0.5, 3)),
        auto_approve_below: Math.min(economics.commission_ceiling, round(economics.commission_ceiling * 0.8, 3)),
        escalate_above: Math.min(economics.commission_ceiling, round(economics.commission_ceiling * 0.8, 3)),
        max_fee_per_creator: economics.tier_rate * 1.5,
        max_total_commitment: s.budget_cash ?? 0,
        hard_never: ["exclusivity beyond 90 days", "perpetual paid usage rights", "guaranteed sales volume"],
      },
      inputs: s,
      engine_version: "1.0.0",
    };
  }

  return {
    evaluate, deriveEconomics, evaluateGates, scoreModel, normalise,
    MODELS, MODEL_LABEL, TIER_RATE, TIER_LABEL, WEIGHTS, OBJECTIVE_FIT,
    PIPELINE_DAYS, CRITICAL_FIELDS, STATE_META,
    fmt: { money, pct, round },
  };
});
