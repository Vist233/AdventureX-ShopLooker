import assert from "node:assert/strict";
import staticWorker from "./storevalidator-worker.mjs";

const assets = {
  async fetch(request) {
    return new Response(`asset:${new URL(request.url).pathname}`);
  }
};

const env = { ASSETS: assets, BACKEND_ORIGIN: "https://shopvalidator.zhangyvjing.com" };

async function fetchPath(path) {
  return staticWorker.fetch(new Request(`https://storevalidator.zhangyvjing.com${path}`), env);
}

const ranking = await fetchPath("/ranking/");
assert.equal(await ranking.text(), "asset:/ranking.html");

const oldRanking = await fetchPath("/ranking.html");
assert.equal(oldRanking.status, 308);
assert.equal(new URL(oldRanking.headers.get("Location")).pathname, "/ranking/");

const noSlashCase = await fetchPath("/case/public_case_123");
assert.equal(noSlashCase.status, 308);
assert.equal(new URL(noSlashCase.headers.get("Location")).pathname, "/case/public_case_123/");

const canonicalCase = await fetchPath("/case/public_case_123/");
assert.equal(await canonicalCase.text(), "asset:/case/public_case_123/");

console.log("share routes: canonical slash redirects and public case fallback passed");
