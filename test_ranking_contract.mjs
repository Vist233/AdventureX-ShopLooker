import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("./ranking.html", import.meta.url), "utf8");
const client = await readFile(new URL("./ranking.js", import.meta.url), "utf8");
const build = await readFile(new URL("./build_site.py", import.meta.url), "utf8");
const config = await readFile(new URL("./wrangler.toml", import.meta.url), "utf8");

assert.match(html, /<script src="\/ranking\.js\?v=[^"]+"><\/script>/, "ranking must request a versioned client");
assert.match(html, /70% 资料完整度 \+ 30% 后续回填效果/, "ranking must explain its non-revenue scoring rule");
assert.match(html, /data-stage-filter="operating"/, "ranking must support stage filtering");
assert.match(client, /fetch\("\/api\/leaderboard"/, "ranking must load the public leaderboard API");
assert.match(client, /cache: "no-store"/, "ranking API must not reuse stale responses");
assert.match(client, /retryLeaderboard/, "ranking must provide a user-visible retry path");
assert.match(client, /href="\/case\//, "every case must have a native shareable link");
assert.match(client, /资料完整度/, "case cards must disclose their evidence level");
assert.match(build, /DIST \/ "ranking"/, "build must publish an extensionless /ranking resource");
assert.match(config, /run_worker_first = \[[^\]]*"\/ranking"/, "ranking must reach the Worker before static edge cache");

console.log("ranking contract: versioned client, fresh API request, retry path and /ranking build passed");
