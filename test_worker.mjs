import assert from "node:assert/strict";
import worker, {
  AgentGate,
  asrSessionConfig,
  claimAnalysisRound,
  consumeDailyAnalysisBudget,
  enqueueAnalysisRound,
  handleQueueMessageFailure,
  normalizeAsrClientEvent,
  publicRunSnapshot,
  releaseAnalysisRoundClaim
} from "./worker.mjs";

const originalFetch = globalThis.fetch;
const upstreamCalls = [];
let stepfunActive = 0;
let stepfunMaxActive = 0;

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input);
  upstreamCalls.push({ url, init });
  if (url.hostname === "api.stepfun.com") {
    stepfunActive += 1;
    stepfunMaxActive = Math.max(stepfunMaxActive, stepfunActive);
    await new Promise((resolve) => setTimeout(resolve, 15));
    stepfunActive -= 1;
    return Response.json({
      choices: [{ message: { content: JSON.stringify({ ok: true }) } }]
    });
  }

  if (url.hostname === "dashscope.aliyuncs.com") {
    return Response.json({
      output: { text: "Hello World，这里是阿里巴巴语音实验室。" },
      request_id: "dashscope-request-test"
    });
  }

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
const apiRequest = (path, { method = "GET", token, body, headers = {} } = {}) => worker.fetch(
  new Request(`https://example.com${path}`, {
    method,
    headers: {
      ...headers,
      ...(token ? { "X-Case-Token": token } : {}),
      ...(body !== undefined && !("Content-Type" in headers)
        ? { "Content-Type": "application/json" }
        : {})
    },
    body: body instanceof ArrayBuffer || ArrayBuffer.isView(body)
      ? body
      : body !== undefined
        ? JSON.stringify(body)
        : undefined
  }),
  env
);

function validWavFixture() {
  const bytes = new Uint8Array(46);
  const writeAscii = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      bytes[offset + index] = value.charCodeAt(index);
    }
  };
  const view = new DataView(bytes.buffer);
  writeAscii(0, "RIFF");
  view.setUint32(4, 38, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, 2, true);
  view.setInt16(44, 0, true);
  return bytes.buffer;
}

function mutateWavFixture(mutator) {
  const wav = validWavFixture();
  mutator(new DataView(wav), new Uint8Array(wav));
  return wav;
}

try {
  const asrConfig = asrSessionConfig({});
  assert.equal(asrConfig.session.audio.input.format.codec, "pcm_s16le");
  assert.equal(asrConfig.session.audio.input.format.rate, 16000);
  assert.equal(asrConfig.session.audio.input.transcription.model, "stepaudio-2.5-asr-stream");
  assert.equal(asrConfig.session.audio.input.transcription.full_rerun_on_commit, true);
  assert.equal(asrConfig.session.audio.input.turn_detection.silence_duration_ms, 600);
  const normalizedAudio = normalizeAsrClientEvent({
    type: "input_audio_buffer.append",
    audio: "AQID"
  });
  assert.equal(normalizedAudio.type, "input_audio_buffer.append");
  assert.equal(normalizedAudio.audio, "AQID");
  assert.match(normalizedAudio.event_id, /^event_/);
  assert.equal(normalizeAsrClientEvent({ type: "session.update", session: {} }), null);
  assert.equal(normalizeAsrClientEvent({ type: "dangerous.unapproved.command" }), null);

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

  const createdResponse = await apiRequest("/api/cases", {
    method: "POST",
    body: { stage: "operating" }
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.match(created.case.id, /^case_/);
  assert.match(created.caseToken, /^token_/);

  const missingLocation = await apiRequest(`/api/cases/${created.case.id}/turns`, {
    method: "POST",
    token: created.caseToken,
    body: { turnId: "turn-1", transcript: "一个月大约十万元" }
  });
  assert.equal(missingLocation.status, 409);

  const locationResponse = await apiRequest(`/api/cases/${created.case.id}/location`, {
    method: "POST",
    token: created.caseToken,
    body: {
      confirmed: true,
      context: {
        location: { address: "上海市黄浦区测试路1号" },
        nearby: { count: 2 }
      }
    }
  });
  assert.equal(locationResponse.status, 200);
  assert.equal((await locationResponse.json()).firstQuestion.complete, false);

  env.DASHSCOPE_API_KEY = "dashscope-server-only-key";
  const asrStart = upstreamCalls.length;
  const asrResponse = await apiRequest(`/api/cases/${created.case.id}/asr`, {
    method: "POST",
    token: created.caseToken,
    headers: { "Content-Type": "audio/wav" },
    body: validWavFixture()
  });
  assert.equal(asrResponse.status, 200);
  const asr = await asrResponse.json();
  assert.equal(asr.text, "Hello World，这里是阿里巴巴语音实验室。");
  assert.equal(asr.requestId, "dashscope-request-test");
  assert.equal(asr.model, "fun-asr-flash-2026-06-15");
  const asrCalls = upstreamCalls.slice(asrStart);
  assert.equal(asrCalls.length, 1);
  assert.equal(
    asrCalls[0].url.href,
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
  );
  assert.equal(asrCalls[0].init.method, "POST");
  assert.equal(asrCalls[0].init.headers.Authorization, "Bearer dashscope-server-only-key");
  assert.equal(asrCalls[0].init.headers["X-DashScope-SSE"], "disable");
  const dashScopeBody = JSON.parse(asrCalls[0].init.body);
  assert.equal(dashScopeBody.model, "fun-asr-flash-2026-06-15");
  assert.deepEqual(dashScopeBody.parameters, { format: "wav", sample_rate: "16000" });
  assert.match(
    dashScopeBody.input.messages.at(-1).content[0].input_audio.data,
    /^data:audio\/wav;base64,/
  );
  assert.match(
    dashScopeBody.input.messages[0].content[0].text,
    /营业额/
  );

  const invalidWavResponse = await apiRequest(`/api/cases/${created.case.id}/asr`, {
    method: "POST",
    token: created.caseToken,
    headers: { "Content-Type": "audio/wav" },
    body: new Uint8Array(44).buffer
  });
  assert.equal(invalidWavResponse.status, 422);
  assert.equal((await invalidWavResponse.json()).code, "ASR_AUDIO_INVALID");

  const nonPcmWavResponse = await apiRequest(`/api/cases/${created.case.id}/asr`, {
    method: "POST",
    token: created.caseToken,
    headers: { "Content-Type": "audio/wav" },
    body: mutateWavFixture((view) => view.setUint16(20, 3, true))
  });
  assert.equal(nonPcmWavResponse.status, 422);

  const stereoWavResponse = await apiRequest(`/api/cases/${created.case.id}/asr`, {
    method: "POST",
    token: created.caseToken,
    headers: { "Content-Type": "audio/wav" },
    body: mutateWavFixture((view) => view.setUint16(22, 2, true))
  });
  assert.equal(stereoWavResponse.status, 422);

  const wrongRateWavResponse = await apiRequest(`/api/cases/${created.case.id}/asr`, {
    method: "POST",
    token: created.caseToken,
    headers: { "Content-Type": "audio/wav" },
    body: mutateWavFixture((view) => view.setUint32(24, 44_100, true))
  });
  assert.equal(wrongRateWavResponse.status, 422);

  const missingDataWavResponse = await apiRequest(`/api/cases/${created.case.id}/asr`, {
    method: "POST",
    token: created.caseToken,
    headers: { "Content-Type": "audio/wav" },
    body: mutateWavFixture((_view, bytes) => {
      bytes.set(new TextEncoder().encode("JUNK"), 36);
    })
  });
  assert.equal(missingDataWavResponse.status, 422);

  const forgedLengthWavResponse = await apiRequest(`/api/cases/${created.case.id}/asr`, {
    method: "POST",
    token: created.caseToken,
    headers: { "Content-Type": "audio/wav" },
    body: mutateWavFixture((view) => view.setUint32(4, 36, true))
  });
  assert.equal(forgedLengthWavResponse.status, 422);

  delete env.DASHSCOPE_API_KEY;
  const missingDashScopeKeyResponse = await apiRequest(`/api/cases/${created.case.id}/asr`, {
    method: "POST",
    token: created.caseToken,
    headers: { "Content-Type": "audio/wav" },
    body: validWavFixture()
  });
  assert.equal(missingDashScopeKeyResponse.status, 503);
  assert.equal((await missingDashScopeKeyResponse.json()).code, "DASHSCOPE_NOT_CONFIGURED");

  const retiredInterviewResponse = await apiRequest(`/api/cases/${created.case.id}/interview`, {
    token: created.caseToken
  });
  assert.equal(retiredInterviewResponse.status, 410);
  assert.equal((await retiredInterviewResponse.json()).code, "ASR_PROTOCOL_RETIRED");

  const turnResponse = await apiRequest(`/api/cases/${created.case.id}/turns`, {
    method: "POST",
    token: created.caseToken,
    body: { turnId: "turn-1", transcript: "已经营业，最近主要想先止损" }
  });
  assert.equal(turnResponse.status, 200);
  const turn = await turnResponse.json();
  assert.equal(turn.mode, "deterministic-fallback");
  assert.equal(turn.nextQuestion.complete, false);
  const duplicateTurnResponse = await apiRequest(`/api/cases/${created.case.id}/turns`, {
    method: "POST",
    token: created.caseToken,
    body: { turnId: "turn-1", transcript: "重复提交不应再次处理" }
  });
  assert.equal(duplicateTurnResponse.status, 200);
  assert.equal((await duplicateTurnResponse.json()).duplicate, true);

  const staleTurnResponse = await apiRequest(`/api/cases/${created.case.id}/turns`, {
    method: "POST",
    token: created.caseToken,
    body: {
      turnId: "turn-stale",
      transcript: "这是基于旧问题的迟到回答",
      caseVersion: turn.version - 1
    }
  });
  assert.equal(staleTurnResponse.status, 409);
  assert.equal((await staleTurnResponse.json()).code, "CASE_VERSION_CONFLICT");

  const invalidTurnVersionResponse = await apiRequest(`/api/cases/${created.case.id}/turns`, {
    method: "POST",
    token: created.caseToken,
    body: {
      turnId: "turn-invalid-version",
      transcript: "版本字段格式不对",
      expectedVersion: "not-a-version"
    }
  });
  assert.equal(invalidTurnVersionResponse.status, 422);
  assert.equal((await invalidTurnVersionResponse.json()).code, "CASE_VERSION_INVALID");

  const reviewCorrections = [
    {
      id: "monthlyRevenue",
      field: "monthlyRevenue",
      value: null,
      range: { min: 100000, max: 120000 },
      unit: "元",
      period: "月",
      status: "confirmed",
      source: "typed",
      transcript: "一个月十到十二万"
    },
    {
      id: "cashReserve",
      field: "cashReserve",
      value: null,
      range: null,
      unit: "元",
      status: "unknown",
      source: "choice",
      transcript: "我不知道"
    }
  ];
  const reviewResponse = await apiRequest(`/api/cases/${created.case.id}/review`, {
    method: "POST",
    token: created.caseToken,
    body: {
      caseVersion: turn.version,
      corrections: reviewCorrections
    }
  });
  assert.equal(reviewResponse.status, 200);
  const reviewed = await reviewResponse.json();
  assert.equal(reviewed.version, turn.version + 1);
  const reviewedRevenue = reviewed.facts.find((fact) => fact.id === "monthlyRevenue");
  assert.equal(reviewedRevenue.value, null);
  assert.deepEqual(reviewedRevenue.range, { min: 100000, max: 120000 });
  assert.equal(reviewedRevenue.source, "typed");
  assert.equal(reviewedRevenue.transcript, "一个月十到十二万");
  assert.equal(reviewedRevenue.status, "confirmed");
  assert.equal(reviewedRevenue.evidence, "B");
  const reviewedCash = reviewed.facts.find((fact) => fact.id === "cashReserve");
  assert.equal(reviewedCash.value, null);
  assert.equal(reviewedCash.range, null);
  assert.equal(reviewedCash.status, "unknown");
  assert.equal(reviewedCash.source, "choice");
  assert.equal(reviewedCash.transcript, "我不知道");
  assert.equal(reviewedCash.evidence, "U");

  const staleAnalyzeResponse = await apiRequest(`/api/cases/${created.case.id}/analyze`, {
    method: "POST",
    token: created.caseToken,
    body: { caseVersion: reviewed.version - 1 }
  });
  assert.equal(staleAnalyzeResponse.status, 409);
  const staleAnalyze = await staleAnalyzeResponse.json();
  assert.equal(staleAnalyze.code, "CASE_VERSION_CONFLICT");
  assert.equal(staleAnalyze.version, reviewed.version);
  assert.ok(Array.isArray(staleAnalyze.facts));

  const invalidAnalyzeVersionResponse = await apiRequest(`/api/cases/${created.case.id}/analyze`, {
    method: "POST",
    token: created.caseToken,
    body: { caseVersion: "latest" }
  });
  assert.equal(invalidAnalyzeVersionResponse.status, 422);
  assert.equal((await invalidAnalyzeVersionResponse.json()).code, "CASE_VERSION_INVALID");

  const analyzeResponse = await apiRequest(`/api/cases/${created.case.id}/analyze`, {
    method: "POST",
    token: created.caseToken,
    body: {
      caseVersion: reviewed.version,
      deterministicResult: {
        decision: "TEST",
        title: "先测试",
        reason: "证据不足",
        metrics: { grossMargin: 0.55, runway: 5 }
      }
    }
  });
  assert.equal(analyzeResponse.status, 202);
  const analyze = await analyzeResponse.json();
  assert.match(analyze.runId, /^run_/);

  const runResponse = await apiRequest(
    `/api/cases/${created.case.id}/runs/${analyze.runId}`,
    { token: created.caseToken }
  );
  assert.equal(runResponse.status, 200);
  const run = await runResponse.json();
  assert.equal(run.status, "completed");
  assert.equal(run.result.mode, "deterministic-fallback");
  assert.equal(run.result.top3.length, 0);
  assert.match(run.result.explanation.headline, /先/);
  assert.notEqual(run.result.deterministic.title, "先测试");
  assert.notDeepEqual(run.result.deterministic.metrics, { grossMargin: 0.55, runway: 5 });
  assert.equal("claimToken" in run, false);
  assert.equal("claimedRound" in run, false);
  assert.equal("claimExpiresAt" in run, false);

  const duplicateReviewResponse = await apiRequest(`/api/cases/${created.case.id}/review`, {
    method: "POST",
    token: created.caseToken,
    body: {
      caseVersion: reviewed.version,
      corrections: reviewCorrections
    }
  });
  assert.equal(duplicateReviewResponse.status, 200);
  const duplicateReview = await duplicateReviewResponse.json();
  assert.equal(duplicateReview.unchanged, true);
  assert.equal(duplicateReview.version, reviewed.version);

  const reusedAnalysisResponse = await apiRequest(`/api/cases/${created.case.id}/analyze`, {
    method: "POST",
    token: created.caseToken,
    body: {
      caseVersion: reviewed.version,
      deterministicResult: {
        decision: "TEST",
        title: "不应重复调用",
        reason: "同一版本复用结果",
        metrics: {}
      }
    }
  });
  assert.equal(reusedAnalysisResponse.status, 200);
  const reusedAnalysis = await reusedAnalysisResponse.json();
  assert.equal(reusedAnalysis.runId, analyze.runId);
  assert.equal(reusedAnalysis.reused, true);

  const casCaseResponse = await apiRequest("/api/cases", {
    method: "POST",
    body: { stage: "operating" }
  });
  const casCase = await casCaseResponse.json();
  const casLocationResponse = await apiRequest(`/api/cases/${casCase.case.id}/location`, {
    method: "POST",
    token: casCase.caseToken,
    body: {
      confirmed: true,
      context: { location: { address: "上海市黄浦区并发确认测试1号" } }
    }
  });
  const casLocation = await casLocationResponse.json();
  const concurrentReviews = await Promise.all([
    apiRequest(`/api/cases/${casCase.case.id}/review`, {
      method: "POST",
      token: casCase.caseToken,
      body: {
        caseVersion: casLocation.version,
        corrections: [{
          id: "rent",
          value: 10_000,
          unit: "元",
          period: "月",
          status: "confirmed",
          source: "typed",
          transcript: "房租一个月一万"
        }]
      }
    }),
    apiRequest(`/api/cases/${casCase.case.id}/review`, {
      method: "POST",
      token: casCase.caseToken,
      body: {
        caseVersion: casLocation.version,
        corrections: [{
          id: "staffCount",
          value: 5,
          unit: "人",
          status: "confirmed",
          source: "typed",
          transcript: "一共五个人"
        }]
      }
    })
  ]);
  assert.deepEqual(
    concurrentReviews.map((response) => response.status).sort(),
    [200, 409]
  );
  const winningReviewPayload = await concurrentReviews
    .find((response) => response.status === 200)
    .json();
  const rejectedReviewPayload = await concurrentReviews
    .find((response) => response.status === 409)
    .json();
  assert.equal(rejectedReviewPayload.code, "CASE_VERSION_CONFLICT");
  assert.equal(rejectedReviewPayload.version, winningReviewPayload.version);
  assert.deepEqual(
    rejectedReviewPayload.facts.map((fact) => fact.id).sort(),
    winningReviewPayload.facts.map((fact) => fact.id).sort()
  );
  const committedConcurrentFields = ["rent", "staffCount"].filter((id) =>
    winningReviewPayload.facts.some((fact) => fact.id === id)
  );
  assert.equal(committedConcurrentFields.length, 1);

  const ttsFallback = await apiRequest("/api/tts", {
    method: "POST",
    token: created.caseToken,
    body: { caseId: created.case.id, text: "测试语音" }
  });
  assert.equal(ttsFallback.status, 503);

  const ttsWithoutCase = await apiRequest("/api/tts", {
    method: "POST",
    body: { text: "测试语音" }
  });
  assert.equal(ttsWithoutCase.status, 400);

  env.STEPFUN_API_KEY = "server-only-key";
  for (let index = 0; index < 40; index += 1) {
    const response = await apiRequest("/api/tts", {
      method: "POST",
      token: created.caseToken,
      body: { caseId: created.case.id, text: `第${index + 1}次播报` }
    });
    assert.equal(response.status, 200, `TTS request ${index + 1} should be allowed`);
  }
  const ttsOverQuota = await apiRequest("/api/tts", {
    method: "POST",
    token: created.caseToken,
    body: { caseId: created.case.id, text: "第41次播报" }
  });
  assert.equal(ttsOverQuota.status, 429);
  assert.equal((await ttsOverQuota.json()).code, "TTS_QUOTA_EXCEEDED");

  const policyCaseResponse = await apiRequest("/api/cases", {
    method: "POST",
    body: { stage: "operating" }
  });
  const policyCase = await policyCaseResponse.json();
  const policyLocationResponse = await apiRequest(`/api/cases/${policyCase.case.id}/location`, {
    method: "POST",
    token: policyCase.caseToken,
    body: {
      confirmed: true,
      context: { location: { address: "上海市黄浦区程序控制问题1号" } }
    }
  });
  const policyLocation = await policyLocationResponse.json();
  const committedTurnPromise = apiRequest(`/api/cases/${policyCase.case.id}/turns`, {
    method: "POST",
    token: policyCase.caseToken,
    body: {
      turnId: "turn-policy-a",
      transcript: "我想先止损",
      caseVersion: policyLocation.version
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 2));
  const [rejectedConcurrentTurn, rejectedConcurrentReview, committedPolicyTurn] = await Promise.all([
    apiRequest(`/api/cases/${policyCase.case.id}/turns`, {
      method: "POST",
      token: policyCase.caseToken,
      body: {
        turnId: "turn-policy-b",
        transcript: "我也说一句迟到回答",
        caseVersion: policyLocation.version
      }
    }),
    apiRequest(`/api/cases/${policyCase.case.id}/review`, {
      method: "POST",
      token: policyCase.caseToken,
      body: {
        caseVersion: policyLocation.version,
        corrections: [{
          id: "goal",
          value: "止损",
          status: "confirmed",
          source: "choice"
        }]
      }
    }),
    committedTurnPromise
  ]);
  assert.equal(committedPolicyTurn.status, 200);
  const policyPayload = await committedPolicyTurn.json();
  assert.equal(policyPayload.nextQuestion.field, "category");
  assert.equal(rejectedConcurrentTurn.status, 409);
  assert.equal((await rejectedConcurrentTurn.json()).code, "TURN_IN_PROGRESS");
  assert.equal(rejectedConcurrentReview.status, 409);
  assert.equal((await rejectedConcurrentReview.json()).code, "TURN_IN_PROGRESS");
  delete env.STEPFUN_API_KEY;

  const missingPlanResponse = await apiRequest(
    `/api/cases/${created.case.id}/plans/plan_missing/start`,
    { method: "POST", token: created.caseToken, body: {} }
  );
  assert.equal(missingPlanResponse.status, 404);

  const unauthorized = await apiRequest(`/api/cases/${created.case.id}/review`, {
    method: "POST",
    body: { corrections: [{ id: "rent", value: 1000, status: "confirmed" }] }
  });
  assert.equal(unauthorized.status, 403);

  const gate = new AgentGate({}, { STEPFUN_API_KEY: "server-only-key" });
  const gateResponses = await Promise.all(Array.from({ length: 12 }, () => gate.fetch(
    new Request("https://gate.internal/chat", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "test" }] })
    })
  )));
  assert.ok(gateResponses.every((response) => response.status === 200));
  assert.ok(stepfunMaxActive <= 5, `Durable Object gate exceeded 5: ${stepfunMaxActive}`);

  const durableBuckets = new Map();
  const durableGate = new AgentGate({
    storage: {
      get: async (key) => durableBuckets.get(key),
      put: async (key, value) => durableBuckets.set(key, value)
    }
  }, {});
  const durableRateResults = [];
  for (let index = 0; index < 3; index += 1) {
    const response = await durableGate.fetch(new Request("https://gate.internal/rate", {
      method: "POST",
      body: JSON.stringify({
        action: "analyze",
        key: "a".repeat(64),
        limit: 2,
        windowMs: 60_000
      })
    }));
    durableRateResults.push(await response.json());
  }
  assert.deepEqual(durableRateResults.map((item) => item.allowed), [true, true, false]);
  assert.equal(durableBuckets.size, 1);

  const asrAcquire = async (sessionId) => {
    const response = await durableGate.fetch(new Request("https://gate.internal/asr/acquire", {
      method: "POST",
      body: JSON.stringify({ key: "b".repeat(64), sessionId })
    }));
    return response.json();
  };
  const asrRelease = async (sessionId) => {
    const response = await durableGate.fetch(new Request("https://gate.internal/asr/release", {
      method: "POST",
      body: JSON.stringify({ key: "b".repeat(64), sessionId })
    }));
    return response.json();
  };
  assert.equal((await asrAcquire("asr-one")).allowed, true);
  const concurrentAsr = await asrAcquire("asr-two");
  assert.equal(concurrentAsr.allowed, false);
  assert.equal(concurrentAsr.reason, "active");
  assert.equal((await asrRelease("wrong-session")).released, false);
  assert.equal((await asrRelease("asr-one")).released, true);
  assert.equal((await asrAcquire("asr-two")).allowed, true);
  assert.equal((await asrRelease("asr-two")).released, true);
  assert.equal((await asrAcquire("asr-three")).allowed, true);
  assert.equal((await asrRelease("asr-three")).released, true);
  const asrOverQuota = await asrAcquire("asr-four");
  assert.equal(asrOverQuota.allowed, false);
  assert.equal(asrOverQuota.reason, "session-quota");
  const persistedAsr = durableBuckets.get(`asr:${"b".repeat(64)}`);
  assert.equal(persistedAsr.sessions, 3);
  assert.ok(persistedAsr.reservedBytes >= 3 * 40 * 1024 * 1024);
  assert.ok(persistedAsr.reservedDurationMs >= 3 * 20 * 60 * 1000);

  const dailyEnv = {
    ANALYSIS_DAILY_BUDGET: "2",
    ANALYSIS_DAILY_IP_BUDGET: "1",
    AGENT_GATE: {
      idFromName: () => ({ name: "global" }),
      get: () => ({
        fetch: (input, init) => durableGate.fetch(new Request(input, init))
      })
    }
  };
  const dailyRequest = (ip) => new Request("https://example.com/api/cases/c/analyze", {
    method: "POST",
    headers: { "CF-Connecting-IP": ip }
  });
  assert.equal((await consumeDailyAnalysisBudget(dailyRequest("198.51.100.1"), dailyEnv)).allowed, true);
  const sameIpDaily = await consumeDailyAnalysisBudget(dailyRequest("198.51.100.1"), dailyEnv);
  assert.equal(sameIpDaily.allowed, false);
  assert.equal(sameIpDaily.reason, "ip");
  assert.equal((await consumeDailyAnalysisBudget(dailyRequest("198.51.100.2"), dailyEnv)).allowed, true);
  const globalDaily = await consumeDailyAnalysisBudget(dailyRequest("198.51.100.3"), dailyEnv);
  assert.equal(globalDaily.allowed, false);
  assert.equal(globalDaily.reason, "global");

  env.AGENT_GATE = {
    idFromName: () => ({ name: "global" }),
    get: () => ({
      fetch: async () => Response.json({ allowed: false, retryAfterMs: 1000 })
    })
  };
  const durablyRateLimited = await apiRequest("/api/cases", {
    method: "POST",
    headers: { "CF-Connecting-IP": "198.51.100.44" },
    body: { stage: "operating" }
  });
  assert.equal(durablyRateLimited.status, 429);
  assert.equal((await durablyRateLimited.json()).code, "ACTION_RATE_LIMITED");
  delete env.AGENT_GATE;

  const claimState = { token: null, round: null, expiresAt: null };
  const claimDb = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() {
              if (sql.includes("SET claim_token = ?")) {
                const [token, round, expiresAt] = values;
                if (claimState.token && claimState.expiresAt > new Date().toISOString()) {
                  return { meta: { changes: 0 } };
                }
                claimState.token = token;
                claimState.round = round;
                claimState.expiresAt = expiresAt;
                return { meta: { changes: 1 } };
              }
              if (sql.includes("SET claim_token = NULL")) {
                const [, , token, round] = values;
                if (claimState.token !== token || claimState.round !== round) {
                  return { meta: { changes: 0 } };
                }
                claimState.token = null;
                claimState.round = null;
                claimState.expiresAt = null;
                return { meta: { changes: 1 } };
              }
              throw new Error(`unexpected claim SQL: ${sql}`);
            }
          };
        }
      };
    }
  };
  const claimRun = { id: "run_atomic_claim" };
  const simultaneousClaims = await Promise.all([
    claimAnalysisRound({ DB: claimDb }, claimRun, 1, "claim-a"),
    claimAnalysisRound({ DB: claimDb }, claimRun, 1, "claim-b")
  ]);
  assert.equal(simultaneousClaims.filter(Boolean).length, 1);
  const winningClaim = simultaneousClaims.find(Boolean);
  await releaseAnalysisRoundClaim({ DB: claimDb }, claimRun, 1, winningClaim);
  assert.equal(await claimAnalysisRound({ DB: claimDb }, claimRun, 1, "claim-c"), "claim-c");

  const activeClaimRow = {
    id: "run_claimed_delivery",
    case_id: "case_claimed_delivery",
    case_version: 1,
    status: "running",
    progress_json: JSON.stringify({ phase: "round-start" }),
    result_json: "null",
    state_json: JSON.stringify({
      context: {},
      searchState: { round: 0, audited: [], target: 3 }
    }),
    warning: "",
    claim_token: "other-delivery",
    claimed_round: 1,
    claim_expires_at: new Date(Date.now() + 120_000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  const activeClaimDb = {
    prepare(sql) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes("SELECT * FROM analysis_runs")) return { ...activeClaimRow };
              return null;
            },
            async run() {
              if (sql.includes("SET claim_token = ?")) return { meta: { changes: 0 } };
              throw new Error(`unexpected active-claim SQL: ${sql}`);
            }
          };
        }
      };
    }
  };
  let claimDeliveryAcked = false;
  let claimDeliveryRetry = null;
  await worker.queue({
    messages: [{
      body: { runId: activeClaimRow.id, round: 1 },
      attempts: 1,
      ack: () => { claimDeliveryAcked = true; },
      retry: (options) => { claimDeliveryRetry = options; }
    }]
  }, { DB: activeClaimDb });
  assert.equal(claimDeliveryAcked, false);
  assert.ok(claimDeliveryRetry.delaySeconds >= 5);
  assert.ok(claimDeliveryRetry.delaySeconds <= 600);

  const queuedRun = {
    id: "run_enqueue_failure",
    caseId: "case_enqueue_failure",
    caseVersion: 1,
    status: "running",
    progress: {},
    result: null,
    context: {},
    searchState: { round: 0, audited: [] },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const enqueueFailure = await enqueueAnalysisRound({
    ANALYSIS_QUEUE: { send: async () => { throw new Error("queue unavailable"); } }
  }, queuedRun, 1);
  assert.equal(enqueueFailure.queued, false);
  assert.equal(queuedRun.status, "failed");
  assert.equal(queuedRun.progress.phase, "enqueue-failed");
  assert.match(queuedRun.warning, /queue unavailable/);

  const safeRun = publicRunSnapshot({
    id: "run_public",
    status: "running",
    context: { secret: true },
    searchState: { private: true },
    claimToken: "secret-claim",
    claimedRound: 2,
    claimExpiresAt: "2099-01-01",
    queueClaim: { token: "memory-secret" }
  });
  assert.deepEqual(safeRun, { id: "run_public", status: "running" });

  const poisonRow = {
    id: "run_poison",
    case_id: "case_poison",
    case_version: 1,
    status: "running",
    progress_json: JSON.stringify({ phase: "round-start" }),
    result_json: "null",
    state_json: JSON.stringify({
      context: {},
      searchState: { round: 0, audited: [], target: 3 }
    }),
    warning: "",
    claim_token: "stale-claim",
    claimed_round: 1,
    claim_expires_at: new Date(Date.now() + 60_000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  const poisonDb = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              if (sql.includes("SELECT * FROM analysis_runs")) return { ...poisonRow };
              return null;
            },
            async run() {
              if (sql.includes("INSERT INTO analysis_runs")) {
                poisonRow.status = values[3];
                poisonRow.progress_json = values[4];
                poisonRow.warning = values[7];
                poisonRow.updated_at = values[9];
                return { meta: { changes: 1 } };
              }
              if (sql.includes("SET claim_token = NULL")) {
                poisonRow.claim_token = null;
                poisonRow.claimed_round = null;
                poisonRow.claim_expires_at = null;
                return { meta: { changes: 1 } };
              }
              throw new Error(`unexpected poison SQL: ${sql}`);
            }
          };
        }
      };
    }
  };
  let retryOptions = null;
  await handleQueueMessageFailure({
    attempts: 3,
    body: { runId: "run_poison", round: 1 },
    retry: (options) => { retryOptions = options; }
  }, { DB: poisonDb }, new Error("poison message"));
  assert.deepEqual(retryOptions, { delaySeconds: 15 });
  assert.equal(poisonRow.status, "running");
  assert.equal(poisonRow.claim_token, "stale-claim");

  await handleQueueMessageFailure({
    attempts: 4,
    body: { runId: "run_poison", round: 1 },
    retry: (options) => { retryOptions = options; }
  }, { DB: poisonDb }, new Error("poison message"));
  assert.equal(poisonRow.status, "failed");
  assert.match(poisonRow.warning, /连续失败/);
  assert.equal(poisonRow.claim_token, null);

  let scheduledSql = "";
  let scheduledCutoff = "";
  const scheduledResult = await worker.scheduled({}, {
    DB: {
      prepare(sql) {
        scheduledSql = sql;
        return {
          bind(cutoff) {
            scheduledCutoff = cutoff;
            return { run: async () => ({ meta: { changes: 3 } }) };
          }
        };
      }
    }
  }, {});
  assert.match(scheduledSql, /DELETE FROM cases WHERE expires_at <=/);
  assert.match(scheduledCutoff, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(scheduledResult.deleted, 3);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("worker map + DashScope ASR + batch review + deterministic authority + quotas + queue/DLQ guards: all assertions passed");
