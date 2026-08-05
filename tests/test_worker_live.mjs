import assert from "node:assert/strict";
import { getMapContext } from "../src/worker.mjs";

const key = process.env.TENCENT_MAP_KEY;
if (!key) {
  throw new Error("请通过 TENCENT_MAP_KEY 环境变量提供腾讯位置服务 WebService Key");
}

const response = await getMapContext(
  new URL("https://local.test/api/map/context?lat=31.2304&lng=121.4737&category=咖啡"),
  { TENCENT_MAP_KEY: key }
);
const payload = await response.json();

assert.equal(response.status, 200, payload.message || "腾讯地图联调失败");
assert.equal(payload.context?.source, "腾讯位置服务");
assert.ok(payload.context?.location?.address, "地图联调没有返回可用位置标签");
if (payload.context?.dataQuality?.status === "degraded") {
  assert.ok(payload.context.dataQuality.reason, "降级地图必须说明不可用原因");
  if (payload.context.nearby.count === null) {
    assert.equal(payload.context.nearby.places.length, 0, "周边不可用时不应伪造竞品");
  } else {
    assert.ok(Number.isFinite(payload.context.nearby.count), "部分降级仍应保留真实周边数量");
  }
} else {
  assert.ok(Number.isFinite(payload.context?.nearby?.count), "周边搜索没有返回数量");
}

console.log(JSON.stringify({
  status: "ok",
  source: payload.context.source,
  address: payload.context.location.address,
  district: payload.context.location.district,
  nearbyCount: payload.context.nearby.count,
  topPlaces: payload.context.nearby.places.slice(0, 3).map((item) => item.title)
}, null, 2));
