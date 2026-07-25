import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const index = readFileSync(new URL("./index.html", import.meta.url), "utf8");

// Keep the StoreValidator branch on its deliberate geometry system. The test
// checks only shape/layout contracts; palette and product content are free to
// evolve independently.
for (const selector of [
  ".flow-card, .rank-card, .map-summary, .map-picker, .analysis-failure, .result-main, .result-metrics, .narrative, .preopen-recommendation",
  ".choice-grid button, .category-chips button, .primary-button, .secondary-button, .danger-button, .confirm-location, .panel-demo-link",
  ".plan-card, .preopen-rank-card, .preopen-rank-number, .plan-score, .preopen-decision, .preopen-signal-row",
  ".case-detail-dialog, .plan-detail-dialog, .dialog-close, .location-status, .location-proof"
]) {
  assert.ok(css.includes(selector), `missing StoreValidator geometry rule for ${selector}`);
}

assert.ok(css.includes("border-radius: 0 !important"), "core surfaces must be square");
assert.ok(css.includes("border-style: dashed"), "receipt-like internal dividers must remain dashed");
assert.ok(css.includes(".map-picker-pin, .status-dot, .listening-pill i { border-radius: 50%"), "only functional markers may remain circular");
assert.match(css, /\.hero-actions\s*\{\s*max-width:\s*620px;\s*display:\s*flex;/, "homepage actions must retain the original vertical action layout");
assert.match(css, /\.hero-actions \.primary-button, \.hero-actions \.demo-button, \.hero-actions \.ranking-button\s*\{\s*flex:\s*1 1 100%;/, "each homepage action must occupy its own row");

console.log("shape contract: square surfaces, receipt separators, functional circles, and original homepage action layout passed");
