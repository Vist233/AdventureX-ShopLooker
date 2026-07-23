import assert from "node:assert/strict";
import worker from "./worker.mjs";

const originalFetch = globalThis.fetch;
const upstreamCalls = [];

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input);
  upstreamCalls.push({ url, init });

  if (url.pathname.includes("/location/v1/ip")) {
    return Response.json({
      status: 0,
      result: {
        location: { lat: 31.2304, lng: 121.4737 },
        ad_info: {
          province: "上海市",
          city: "上海市",
          district: "黄浦区",
          adcode: "310101"
        }
      }
    });
  }

  if (url.pathname.includes("/coord/")) {
    return Response.json({ status: 0, locations: [{ lat: 31.2304, lng: 121.4737 }] });
  }

  if (url.pathname.includes("/geocoder/") && url.searchParams.has("address")) {
    const address = url.searchParams.get("address");
    if (address === "上游失败测试地址") {
      return Response.json({ status: 120, message: "模拟上游错误" });
    }
    if (address === "上海市") {
      return Response.json({
        status: 0,
        result: { level: "城市", location: { lat: 31.2304, lng: 121.4737 } }
      });
    }
    return Response.json({
      status: 0,
      result: {
        level: "门牌号",
        reliability: 9,
        location: { lat: 31.2304, lng: 121.4737 }
      }
    });
  }

  if (url.pathname.includes("/geocoder/")) {
    return Response.json({
      status: 0,
      result: {
        address: "上海市黄浦区测试路1号",
        address_component: { province: "上海市", city: "上海市", district: "黄浦区" },
        ad_info: { adcode: "310101" },
        pois: [{ title: "测试商场", category: "购物:商场", _distance: 80, _dir_desc: "东" }]
      }
    });
  }

  return Response.json({
    status: 0,
    count: 2,
    data: [
      { title: "咖啡一号", category: "美食:咖啡厅", _distance: 120 },
      { title: "咖啡二号", category: "美食:咖啡厅", _distance: 260 }
    ]
  });
};

const assets = { fetch: async () => new Response("asset") };
const env = { TENCENT_MAP_KEY: "test-key", ASSETS: assets };
const request = (path, headers = {}) => worker.fetch(
  new Request(`https://example.com${path}`, { headers }),
  env
);

try {
  const gpsStart = upstreamCalls.length;
  const gpsResponse = await request("/api/map/context?lat=31.22&lng=121.47&category=咖啡");
  assert.equal(gpsResponse.status, 200);
  const gps = await gpsResponse.json();
  assert.equal(gps.context.mode, "gps");
  assert.equal(gps.context.location.district, "黄浦区");
  assert.equal(gps.context.nearby.count, 2);
  const gpsCalls = upstreamCalls.slice(gpsStart);
  assert.equal(gpsCalls.length, 3);
  assert.match(gpsCalls[0].url.pathname, /coord/);
  assert.equal(gpsCalls[0].url.searchParams.get("type"), "1");
  assert.equal(gpsCalls[0].init.headers.Referer, "https://yongge.zhangyvjing.com/");

  const addressStart = upstreamCalls.length;
  const addressResponse = await request(
    "/api/map/address-context?address=上海市黄浦区测试路1号&category=咖啡"
  );
  assert.equal(addressResponse.status, 200);
  const address = await addressResponse.json();
  assert.equal(address.context.mode, "address");
  assert.equal(address.context.location.address, "上海市黄浦区测试路1号");
  const addressCalls = upstreamCalls.slice(addressStart);
  assert.equal(addressCalls.length, 3);
  assert.equal(addressCalls.some(({ url }) => url.pathname.includes("/coord/")), false);
  assert.equal(addressCalls[0].url.searchParams.get("address"), "上海市黄浦区测试路1号");

  const broadStart = upstreamCalls.length;
  const broadResponse = await request("/api/map/address-context?address=上海市");
  assert.equal(broadResponse.status, 422);
  const broad = await broadResponse.json();
  assert.equal(broad.code, "ADDRESS_TOO_BROAD");
  assert.equal(upstreamCalls.length - broadStart, 0);

  const upstreamFailure = await request("/api/map/address-context?address=上游失败测试地址");
  assert.equal(upstreamFailure.status, 502);
  assert.equal((await upstreamFailure.json()).code, "ADDRESS_LOOKUP_ERROR");

  const ipStart = upstreamCalls.length;
  const ipResponse = await request("/api/map/ip-location", {
    "CF-Connecting-IP": "203.0.113.8"
  });
  assert.equal(ipResponse.status, 200);
  const ip = await ipResponse.json();
  assert.equal(ip.approximate.label, "上海市黄浦区");
  assert.equal("location" in ip.approximate, false);
  assert.equal("lat" in ip.approximate, false);
  assert.equal("lng" in ip.approximate, false);
  assert.equal("nearby" in ip.approximate, false);
  const ipCalls = upstreamCalls.slice(ipStart);
  assert.equal(ipCalls.length, 1);
  assert.match(ipCalls[0].url.pathname, /location\/v1\/ip/);
  assert.equal(ipCalls[0].url.searchParams.get("ip"), "203.0.113.8");

  const noIpStart = upstreamCalls.length;
  const noIpResponse = await request("/api/map/ip-location");
  assert.equal(noIpResponse.status, 422);
  assert.equal(upstreamCalls.length, noIpStart);

  const missingKey = await worker.fetch(
    new Request("https://example.com/api/map/context?lat=31.22&lng=121.47"),
    { ASSETS: assets }
  );
  assert.equal(missingKey.status, 503);

  const invalidCoordinate = await request("/api/map/context?lat=999&lng=121.47");
  assert.equal(invalidCoordinate.status, 400);

  const invalidAddress = await request("/api/map/address-context?address=上海");
  assert.equal(invalidAddress.status, 400);

  const asset = await request("/");
  assert.equal(await asset.text(), "asset");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("worker map integration: 10 scenarios passed");
