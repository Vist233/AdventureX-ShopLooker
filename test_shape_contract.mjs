import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const index = readFileSync(new URL("./index.html", import.meta.url), "utf8");

// Keep StoreValidator on the Thermal Brutalism reference system. The test
// checks the frame grammar instead of freezing unrelated product copy.
for (const selector of [
  ".topbar-ranking",
  ".barcode",
  ".method-lanes",
  ".flow-card",
  ".map-picker",
  ".preopen-recommendation",
  ".rank-card"
]) {
  assert.ok(css.includes(selector), `missing thermal receipt rule for ${selector}`);
}

assert.ok(css.includes("border: 1px dashed var(--ink)"), "receipt-like internal dividers must remain dashed");
assert.ok(css.includes("background-image: repeating-linear-gradient(90deg"), "thermal barcode must be generated in CSS");
assert.ok(index.includes('class="barcode-wrap"'), "landing receipt must conclude with a barcode");
assert.ok(index.includes('class="method-lanes"'), "landing must retain the four-step receipt grid");
assert.ok(index.includes('id="mapPicker"'), "functional map picker must survive the visual migration");
assert.ok(index.includes('id="preopenRecommendation"'), "functional pre-open report must survive the visual migration");

console.log("shape contract: thermal receipt frame, barcode, grid, and current functional surfaces passed");
