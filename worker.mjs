const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  }
});

const cleanText = (value, maxLength = 40) => String(value || "")
  .replace(/[^\p{L}\p{N}\s·\-]/gu, "")
  .trim()
  .slice(0, maxLength);

const trimText = (value, maxLength = 120) => String(value || "")
  .trim()
  .slice(0, maxLength);

function validCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function administrativeAreaOnly(address) {
  const compact = address.replace(/\s+/g, "");
  return /^(?:[\p{Script=Han}]{2,12}(?:省|自治区|特别行政区))?(?:[\p{Script=Han}]{2,12}市)?(?:[\p{Script=Han}]{1,12}(?:区|县|旗))?$/u.test(compact);
}

function configured(env) {
  return Boolean(env?.TENCENT_MAP_KEY);
}

function mapNotConfigured() {
  return json({
    code: "MAP_NOT_CONFIGURED",
    message: "腾讯地图密钥尚未配置"
  }, 503);
}

async function tencentRequest(path, params, key) {
  const url = new URL(path, "https://apis.map.qq.com");
  Object.entries({ ...params, key }).forEach(([name, value]) => {
    url.searchParams.set(name, String(value));
  });
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "Referer": "https://yongge.zhangyvjing.com/"
    },
    signal: AbortSignal.timeout(7000)
  });
  if (!response.ok) throw new Error(`腾讯地图请求失败：${response.status}`);
  const data = await response.json();
  if (data.status !== 0) throw new Error(data.message || "腾讯地图返回异常");
  return data;
}

async function buildContextFromGcj02(lat, lng, category, key, options = {}) {
  if (!validCoordinate(lat, lng)) throw new Error("腾讯地图坐标无效");
  const center = `${lat},${lng}`;
  const [reverse, nearby] = await Promise.all([
    tencentRequest("/ws/geocoder/v1/", {
      location: center,
      get_poi: 1,
      poi_options: "address_format=short;radius=1000;policy=1",
      output: "json"
    }, key),
    tencentRequest("/ws/place/v1/search", {
      keyword: category,
      boundary: `nearby(${center},800,0)`,
      page_size: 20,
      page_index: 1,
      orderby: "_distance",
      output: "json"
    }, key)
  ]);

  const reverseResult = reverse.result || {};
  const addressComponent = reverseResult.address_component || {};
  const landmarks = (reverseResult.pois || []).slice(0, 10).map((poi) => ({
    title: cleanText(poi.title, 36),
    category: cleanText(poi.category, 50),
    distance: Number(poi._distance) || 0,
    direction: cleanText(poi._dir_desc, 8)
  }));
  const competitors = (nearby.data || []).slice(0, 20).map((poi) => ({
    title: cleanText(poi.title, 36),
    category: cleanText(poi.category, 50),
    distance: Number(poi._distance) || 0
  }));

  return {
    context: {
      source: "腾讯位置服务",
      mode: options.mode || "gps",
      coordinateSystem: "GCJ-02",
      location: {
        address: cleanText(reverseResult.address, 100) || cleanText(options.fallbackAddress, 100),
        province: cleanText(addressComponent.province, 20),
        city: cleanText(addressComponent.city, 20),
        district: cleanText(addressComponent.district, 20),
        adcode: cleanText(reverseResult.ad_info?.adcode, 12)
      },
      nearby: {
        keyword: category,
        radiusMeters: 800,
        count: Number(nearby.count) || competitors.length,
        places: competitors
      },
      landmarks
    }
  };
}

export async function getMapContext(url, env) {
  if (!configured(env)) return mapNotConfigured();

  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (!validCoordinate(lat, lng)) {
    return json({ code: "INVALID_LOCATION", message: "当前位置坐标无效" }, 400);
  }
  const category = cleanText(url.searchParams.get("category"), 24) || "餐饮";

  try {
    // Browser geolocation is WGS84. Tencent WebService uses GCJ-02, so convert
    // before reverse geocoding and nearby search.
    const translated = await tencentRequest("/ws/coord/v1/translate", {
      locations: `${lat},${lng}`,
      type: 1,
      output: "json"
    }, env.TENCENT_MAP_KEY);
    const mapLocation = translated.locations?.[0];
    const mapLat = Number(mapLocation?.lat);
    const mapLng = Number(mapLocation?.lng);
    if (!validCoordinate(mapLat, mapLng)) {
      throw new Error("腾讯地图坐标转换失败");
    }

    return json(await buildContextFromGcj02(mapLat, mapLng, category, env.TENCENT_MAP_KEY, {
      mode: "gps"
    }));
  } catch (error) {
    return json({
      code: "MAP_UPSTREAM_ERROR",
      message: error instanceof Error ? error.message : "腾讯地图暂时不可用"
    }, 502);
  }
}

export async function getAddressContext(url, env) {
  if (!configured(env)) return mapNotConfigured();

  const address = trimText(url.searchParams.get("address"));
  if (address.length < 3) {
    return json({ code: "INVALID_ADDRESS", message: "请填写城市、商圈或详细地址" }, 400);
  }
  if (administrativeAreaOnly(address)) {
    return json({
      code: "ADDRESS_TOO_BROAD",
      message: "这个位置范围太大，请补充商圈、路名或门牌号"
    }, 422);
  }
  const category = cleanText(url.searchParams.get("category"), 24) || "餐饮";

  try {
    const geocoded = await tencentRequest("/ws/geocoder/v1/", {
      address,
      output: "json"
    }, env.TENCENT_MAP_KEY);
    const location = geocoded.result?.location;
    const lat = Number(location?.lat);
    const lng = Number(location?.lng);
    if (!validCoordinate(lat, lng)) {
      return json({
        code: "ADDRESS_NOT_FOUND",
        message: "没有找到这个地址，请补充城市、商圈或门牌号"
      }, 422);
    }
    const level = cleanText(geocoded.result?.level, 16);
    if (["国家", "省", "城市", "区县", "行政区"].includes(level)) {
      return json({
        code: "ADDRESS_TOO_BROAD",
        message: "这个位置范围太大，请补充商圈、路名或门牌号"
      }, 422);
    }

    return json(await buildContextFromGcj02(lat, lng, category, env.TENCENT_MAP_KEY, {
      mode: "address",
      fallbackAddress: address
    }));
  } catch (error) {
    return json({
      code: "ADDRESS_LOOKUP_ERROR",
      message: error instanceof Error ? error.message : "地址解析暂时不可用"
    }, 502);
  }
}

function clientIp(request) {
  const forwarded = request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0];
  const value = trimText(forwarded, 64);
  return /^[0-9a-f:.]+$/i.test(value) ? value : "";
}

export async function getApproximateLocation(request, env) {
  if (!configured(env)) return mapNotConfigured();
  const ip = clientIp(request);
  if (!ip) {
    return json({
      code: "IP_UNAVAILABLE",
      message: "无法识别大致城市，请手动输入店铺地址"
    }, 422);
  }

  try {
    const located = await tencentRequest("/ws/location/v1/ip", {
      ip,
      output: "json"
    }, env.TENCENT_MAP_KEY);
    const adInfo = located.result?.ad_info || {};
    const province = cleanText(adInfo.province, 20);
    const city = cleanText(adInfo.city, 20);
    const district = cleanText(adInfo.district, 20);
    const label = [province, city, district]
      .filter((part, index, all) => part && all.indexOf(part) === index)
      .join("");
    if (!label) throw new Error("无法识别大致城市");

    // Do not expose or use the IP result's city-government coordinate as the
    // store location. The client must still obtain GPS or resolve an address.
    return json({
      approximate: {
        source: "腾讯位置服务·网络定位",
        precision: district ? "district" : "city",
        province,
        city,
        district,
        adcode: cleanText(adInfo.adcode, 12),
        label
      }
    });
  } catch (error) {
    return json({
      code: "IP_LOCATION_ERROR",
      message: error instanceof Error ? error.message : "无法识别大致城市"
    }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/map/context") {
      return getMapContext(url, env);
    }
    if (request.method === "GET" && url.pathname === "/api/map/address-context") {
      return getAddressContext(url, env);
    }
    if (request.method === "GET" && url.pathname === "/api/map/ip-location") {
      return getApproximateLocation(request, env);
    }
    if (!env.ASSETS) return new Response("Not found", { status: 404 });
    return env.ASSETS.fetch(request);
  }
};
