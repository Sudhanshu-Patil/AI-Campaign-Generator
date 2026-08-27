# Campaign Setup & Brief Generation — Interactive Prototype

An interactive prototype demonstrating an AI-guided campaign setup and brief generation system.

**Live:** https://sudhanshu-patil.github.io/AI-Campaign-Generator/

Sudhanshu Patil · July 2026

---

## What this is

A navigable prototype of nine screens covering the path from a bare brand URL to an approved campaign brief and on to a negotiated creator deal.

**Screen 4 is not a mockup.** It runs `engine.js`, the deterministic feasibility engine whose formulas, gates and weights are printed in the proposal. Change the budget, margin, inventory, tier or timeline and the eligibility gates flip, the partnership models re-rank and the readiness state changes — with no model call involved in producing any number on the page. Screen 8 uses the same engine's derived negotiation policy to refuse out-of-bounds deal terms.

The document and the prototype therefore cannot drift: both quote one source of truth.

## Screens

| # | Screen | Notes |
|---|--------|-------|
| 1 | Start from a URL | Connected-data-first onboarding |
| 2 | Confirm what we found | Extraction review with confidence, source and conflict handling |
| 3 | Adaptive questions | Deterministic question selection ranked by gain ÷ effort |
| 4 | **Feasibility & models** | **Live engine** — gates, scoring, derived economics, readiness state |
| 5 | Campaign canvas | Typed modules with per-field status and provenance |
| 6 | Review & approve | Diff-first approval; the promotion barrier |
| 7 | Approved brief | Brand / Creator / Agent-JSON projections of one state |
| 8 | **Creator deal override** | **Live** policy enforcement on negotiated terms |
| 9 | System architecture | Component and promotion-barrier diagrams |

## Running locally

No build step and no package manager. Serve the folder over HTTP:

```
python -m http.server 8899
```

Then open <http://127.0.0.1:8899/>.

## Verifying the engine

```
node engine.test.js
```

Runs four worked examples and five invariants across 20,000 randomised campaign states:

- **I1** a recommended model has passed every one of its own gates
- **I2** no derived commission ever exceeds the 40% hard cap
- **I3** the escalation threshold never sits above the ceiling
- **I4** every non-ready verdict names a concrete next action
- **I5** evaluation is deterministic

## Files

```
index.html       nine screens
app.css          styles
app.js           navigation, live rendering, diagrams
engine.js        deterministic feasibility engine — the source of truth
engine.test.js   worked examples and property tests
```
