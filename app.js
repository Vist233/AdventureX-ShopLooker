const $ = (id) => document.getElementById(id);
const money = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const state = {
  stage: null,
  step: 1,
  locationConfirmed: false,
  mapContextLoaded: false,
  locationSource: null,
  approximateLocationLabel: "",
  locationAttempt: 0,
  answers: {
    trafficMatch: null,
    visibility: null,
    retention: null
  }
};

const numericFields = [
  "monthlyRevenue", "variableCostRate", "rent", "labor", "otherFixed",
  "cashReserve", "avgTicket", "plannedCommitment", "debt"
];

function setStep(step) {
  state.step = step;
  document.querySelectorAll("[data-step]").forEach((panel) => {
    const active = Number(panel.dataset.step) === step;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  document.querySelectorAll("[data-progress]").forEach((item) => {
    item.classList.toggle("active", Number(item.dataset.progress) <= step);
  });
  document.querySelector(`[data-step="${step}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setStage(stage) {
  state.stage = stage;
  document.querySelectorAll(".operating-only").forEach((el) => { el.hidden = stage !== "operating"; });
  document.querySelectorAll(".preopen-only").forEach((el) => { el.hidden = stage !== "preopen"; });
  $("thirdQuestion").textContent = stage === "preopen"
    ? "你做过真实试卖，而不是只问朋友“觉得怎么样”吗？"
    : "买过的人，会再次回来吗？";
  setStep(2);
}

function setLocationStatus(kind, message) {
  const box = $("locationStatus");
  box.className = `location-status ${kind || ""}`.trim();
  box.setAttribute("role", kind === "error" ? "alert" : "status");
  box.querySelector("p").textContent = message;
}

function acceptLocation(source) {
  state.locationConfirmed = true;
  state.locationSource = source;
  $("locationNext").disabled = false;
}

function renderMapContext(data) {
  const context = data.context || {};
  const location = context.location || {};
  const nearby = context.nearby || {};
  $("mapAddress").textContent = location.address || "已取得当前位置";
  $("mapDistrict").textContent = [location.city, location.district].filter(Boolean).join(" · ") || "坐标已确认";
  $("mapCompetitors").textContent = Number.isFinite(nearby.count) ? `${nearby.count} 个` : "已读取";
  const tags = [...(nearby.places || []), ...(context.landmarks || [])]
    .filter((item, index, all) => {
      const title = item.title || item;
      return title && all.findIndex((candidate) => (candidate.title || candidate) === title) === index;
    })
    .slice(0, 7);
  $("nearbyTags").innerHTML = tags.length
    ? tags.map((item) => `<span>${escapeHtml(item.title || item)}</span>`).join("")
    : "<span>周边地点已读取</span>";
  $("mapSummary").hidden = false;
  state.mapContextLoaded = true;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  }[char]));
}

async function fetchMapContext(latitude, longitude) {
  const params = new URLSearchParams({
    lat: latitude.toFixed(6),
    lng: longitude.toFixed(6),
    category: $("category").value.trim() || "餐饮"
  });
  const response = await fetch(`/api/map/context?${params}`, {
    headers: { "Accept": "application/json" }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "腾讯地图暂时不可用");
  return data;
}

async function fetchApproximateLocation() {
  const response = await fetch("/api/map/ip-location", {
    headers: { "Accept": "application/json" }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "无法识别大致城市");
  return data.approximate || {};
}

async function fetchAddressContext(address) {
  const params = new URLSearchParams({
    address,
    category: $("category").value.trim() || "餐饮"
  });
  const response = await fetch(`/api/map/address-context?${params}`, {
    headers: { "Accept": "application/json" }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || "地址解析暂时不可用");
    error.code = data.code || "ADDRESS_LOOKUP_ERROR";
    error.status = response.status;
    throw error;
  }
  return data;
}

function openManualLocation() {
  $("manualLocationDetails").open = true;
  requestAnimationFrame(() => {
    $("manualLocation").focus();
    const end = $("manualLocation").value.length;
    $("manualLocation").setSelectionRange?.(end, end);
  });
}

async function offerLocationFallback(reason, attempt) {
  if (attempt !== state.locationAttempt) return;
  openManualLocation();
  setLocationStatus("loading", `${reason} 正在尝试识别你所在的城市…`);
  try {
    const approximate = await fetchApproximateLocation();
    if (attempt !== state.locationAttempt) return;
    const label = approximate.label || [approximate.city, approximate.district].filter(Boolean).join("");
    state.approximateLocationLabel = label;
    if (!$("manualLocation").value.trim() && label) $("manualLocation").value = `${label} `;
    $("manualLocationHint").textContent = `已大致识别为 ${label || "当前城市"}。请在后面补充商圈、路名或门牌号；大致城市不会被当成店铺位置。`;
    setLocationStatus("notice", `精确定位失败；已识别大致在 ${label || "当前城市"}。请补充店铺地址。`);
  } catch (error) {
    if (attempt !== state.locationAttempt) return;
    state.approximateLocationLabel = "";
    $("manualLocationHint").textContent = "请写下城市和商圈，最好补充路名或门牌号；系统会自动查找附近同类店。";
    setLocationStatus("error", `${reason} ${error.message}，请手动输入店铺地址。`);
  } finally {
    if (attempt !== state.locationAttempt) return;
    $("locateButton").disabled = false;
    $("locateButton").setAttribute("aria-busy", "false");
    openManualLocation();
  }
}

function locateCurrentStore() {
  const attempt = ++state.locationAttempt;
  state.mapContextLoaded = false;
  state.locationConfirmed = false;
  state.locationSource = null;
  state.approximateLocationLabel = "";
  $("locationNext").disabled = true;
  $("mapSummary").hidden = true;
  $("locateButton").disabled = true;
  $("locateButton").setAttribute("aria-busy", "true");
  setLocationStatus("loading", "正在取得当前位置并读取腾讯地图周边信息…");
  if (!navigator.geolocation) {
    void offerLocationFallback("当前浏览器不支持精确定位。", attempt);
    return;
  }
  navigator.geolocation.getCurrentPosition(async (position) => {
    if (attempt !== state.locationAttempt) return;
    try {
      const data = await fetchMapContext(position.coords.latitude, position.coords.longitude);
      if (attempt !== state.locationAttempt) return;
      renderMapContext(data);
      acceptLocation("gps");
      setLocationStatus("success", "定位成功，腾讯地图周边信息已读取。");
    } catch (error) {
      if (attempt !== state.locationAttempt) return;
      acceptLocation("gps-without-map");
      state.mapContextLoaded = false;
      setLocationStatus("notice", `精确位置已取得；${error.message}。地图周边未参与，仍可继续判断。`);
      $("mapAddress").textContent = "精确位置已取得";
      $("mapDistrict").textContent = "腾讯地图暂时未核验";
      $("mapCompetitors").textContent = "未读取";
      $("nearbyTags").innerHTML = "<span>地图数据未参与本次判断</span>";
      $("mapSummary").hidden = false;
    } finally {
      if (attempt !== state.locationAttempt) return;
      $("locateButton").disabled = false;
      $("locateButton").setAttribute("aria-busy", "false");
    }
  }, (error) => {
    if (attempt !== state.locationAttempt) return;
    const messages = {
      1: "没有取得精确定位权限。",
      2: "浏览器暂时无法取得精确位置。",
      3: "精确定位超时。"
    };
    void offerLocationFallback(messages[error.code] || "精确定位失败。", attempt);
  }, {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 60000
  });
}

async function useManualLocation() {
  const description = $("manualLocation").value.trim();
  if (!description) {
    setLocationStatus("error", "请先写下城市、商圈或详细地址。");
    openManualLocation();
    return;
  }
  if (state.approximateLocationLabel && description === state.approximateLocationLabel) {
    setLocationStatus("notice", "现在只有大致城市，请再补充商圈、路名或门牌号。");
    openManualLocation();
    return;
  }

  const attempt = ++state.locationAttempt;
  $("locateButton").disabled = false;
  $("locateButton").setAttribute("aria-busy", "false");
  $("useManualLocation").disabled = true;
  $("useManualLocation").setAttribute("aria-busy", "true");
  $("locationNext").disabled = true;
  setLocationStatus("loading", "正在查找这个地址和附近同类店…");
  try {
    const data = await fetchAddressContext(description);
    if (attempt !== state.locationAttempt) return;
    renderMapContext(data);
    acceptLocation("address");
    setLocationStatus("success", "地址已确认，腾讯地图周边信息已读取。");
  } catch (error) {
    if (attempt !== state.locationAttempt) return;
    if (Number(error.status) < 500) {
      state.locationConfirmed = false;
      state.locationSource = null;
      state.mapContextLoaded = false;
      $("locationNext").disabled = true;
      setLocationStatus("error", error.message);
      openManualLocation();
      return;
    }
    // A map outage should not trap the user. Keep the manually supplied
    // evidence, but label it clearly so downstream confidence is reduced.
    acceptLocation("manual-unverified");
    state.mapContextLoaded = false;
    $("mapAddress").textContent = description;
    $("mapDistrict").textContent = "手动提供，地图未核验";
    $("mapCompetitors").textContent = "未读取";
    $("nearbyTags").innerHTML = "<span>地图数据未参与本次判断</span>";
    $("mapSummary").hidden = false;
    setLocationStatus("notice", `${error.message}。已保留手动地址，仍可继续判断。`);
  } finally {
    if (attempt !== state.locationAttempt) return;
    $("useManualLocation").disabled = false;
    $("useManualLocation").setAttribute("aria-busy", "false");
  }
}

function fieldKnown(id) {
  return $(id).value.trim() !== "";
}

function collectInput() {
  const values = Object.fromEntries(numericFields.map((id) => [id, Number($(id).value) || 0]));
  return {
    ...values,
    stage: state.stage,
    category: $("category").value.trim(),
    locationConfirmed: state.locationConfirmed,
    mapContextLoaded: state.mapContextLoaded,
    trafficMatch: state.answers.trafficMatch,
    visibility: state.answers.visibility,
    retention: state.answers.retention,
    known: Object.fromEntries(numericFields.map((id) => [id, fieldKnown(id)]))
  };
}

function validateMoney() {
  const required = state.stage === "operating"
    ? ["monthlyRevenue", "variableCostRate", "rent", "labor", "otherFixed", "cashReserve", "avgTicket"]
    : ["variableCostRate", "rent", "labor", "otherFixed", "cashReserve", "avgTicket", "plannedCommitment"];
  const missing = required.filter((id) => !fieldKnown(id));
  if (missing.length) {
    $("moneyError").textContent = "还有数字没填。确实为 0 时请填 0，不要留空。";
    $(missing[0]).focus();
    return false;
  }
  const rate = Number($("variableCostRate").value);
  if (rate <= 0 || rate >= 100) {
    $("moneyError").textContent = "每卖 100 元的食材和平台成本必须在 1—95 元之间。";
    $("variableCostRate").focus();
    return false;
  }
  $("moneyError").textContent = "";
  return true;
}

function validateEvidence() {
  const missing = Object.values(state.answers).some((value) => !value);
  $("evidenceError").textContent = missing ? "每个问题都请选择一个答案；不知道就选“不确定”。" : "";
  return !missing;
}

function formatSigned(value) {
  if (!Number.isFinite(value)) return "待补数据";
  return `${value < 0 ? "−" : "+"}¥${money.format(Math.abs(value))}`;
}

function renderResult(result) {
  const { metrics } = result;
  const resultEl = $("result");
  resultEl.dataset.decision = result.decision;
  $("decisionCode").textContent = result.decision;
  $("confidenceLabel").textContent = `证据完整度 ${metrics.completeness}%`;
  $("decisionTitle").textContent = result.title;
  $("decisionReason").textContent = result.reason;
  $("breakEvenDaily").textContent = `¥${money.format(metrics.breakEvenDaily)}`;
  $("breakEvenOrders").textContent = `约 ${Math.ceil(metrics.breakEvenOrders)} 单 / 天`;

  if (state.stage === "operating") {
    $("monthlyProfit").textContent = formatSigned(metrics.monthlyProfit);
    $("monthlyProfit").previousElementSibling.textContent = "每月真实经营结果";
    $("monthlyProfit").nextElementSibling.textContent = "已扣食材、平台、房租、人工和固定支出";
    $("thirdMetricLabel").textContent = "现金还能撑";
    $("thirdMetricValue").textContent = metrics.runway === Infinity ? "正现金流" : `${metrics.runway.toFixed(1)} 个月`;
    $("thirdMetricHint").textContent = "保持现在的情况下";
  } else {
    $("monthlyProfit").textContent = `¥${money.format(metrics.breakEvenMonthly)}`;
    $("monthlyProfit").previousElementSibling.textContent = "每月保本营业额";
    $("monthlyProfit").nextElementSibling.textContent = "这是保本线，不是营业额预测";
    $("thirdMetricLabel").textContent = "计划投入 / 可用现金";
    $("thirdMetricValue").textContent = `${metrics.commitmentRatio.toFixed(1)}×`;
    $("thirdMetricHint").textContent = "越高，失败后越难退出";
  }

  $("nextAction").textContent = result.nextAction;
  $("stopLine").textContent = `停止线：${result.stopLine}`;
  const riskLabels = { high: "高风险", medium: "需验证", low: "可接受" };
  $("riskList").innerHTML = result.risks.map((risk) => `
    <div class="risk-item"><span>${escapeHtml(risk.label)} · ${escapeHtml(risk.value)}</span><b class="${risk.level}">${riskLabels[risk.level]}</b></div>
  `).join("");
  $("scenarioList").innerHTML = result.scenarios.map((scenario) => {
    const value = scenario.unit === "orders"
      ? `${Math.ceil(scenario.value)} 单`
      : formatSigned(scenario.value);
    return `<div><span>${escapeHtml(scenario.label)}</span><strong>${value}</strong></div>`;
  }).join("");
  resultEl.hidden = false;
  resultEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetFlow() {
  state.locationAttempt += 1;
  state.stage = null;
  state.step = 1;
  state.locationConfirmed = false;
  state.mapContextLoaded = false;
  state.locationSource = null;
  state.approximateLocationLabel = "";
  state.answers = { trafficMatch: null, visibility: null, retention: null };
  document.querySelectorAll(".answer-row button").forEach((button) => button.classList.remove("selected"));
  $("mapSummary").hidden = true;
  $("manualLocationDetails").open = false;
  $("manualLocation").value = "";
  $("category").value = "";
  $("manualLocationHint").textContent = "写下城市和商圈，最好补充路名或门牌号；系统会自动查找附近同类店。";
  $("mapAddress").textContent = "—";
  $("mapDistrict").textContent = "—";
  $("mapCompetitors").textContent = "—";
  $("nearbyTags").innerHTML = "";
  $("locateButton").disabled = false;
  $("locateButton").setAttribute("aria-busy", "false");
  $("useManualLocation").disabled = false;
  $("useManualLocation").setAttribute("aria-busy", "false");
  $("locationNext").disabled = true;
  $("result").hidden = true;
  $("moneyForm").reset();
  $("variableCostRate").value = 45;
  $("debt").value = 0;
  setLocationStatus("", "等待定位");
  setStep(1);
}

function loadDemo() {
  state.stage = "operating";
  state.locationConfirmed = true;
  state.mapContextLoaded = true;
  state.locationSource = "demo";
  state.answers = { trafficMatch: "yes", visibility: "no", retention: "unknown" };
  const values = {
    category: "景区福州菜",
    monthlyRevenue: 570000,
    variableCostRate: 40.5,
    rent: 141900,
    labor: 179300,
    otherFixed: 46000,
    cashReserve: 300000,
    avgTicket: 220,
    plannedCommitment: 0,
    debt: 0
  };
  Object.entries(values).forEach(([id, value]) => { $(id).value = value; });
  document.querySelectorAll(".answer-row button").forEach((button) => {
    const group = button.closest("[data-answer-group]").dataset.answerGroup;
    button.classList.toggle("selected", state.answers[group] === button.dataset.value);
  });
  renderResult(DecisionEngine.assess(collectInput()));
}

document.querySelectorAll("[data-stage]").forEach((button) => {
  button.addEventListener("click", () => setStage(button.dataset.stage));
});
document.querySelectorAll("[data-back]").forEach((button) => {
  button.addEventListener("click", () => setStep(Number(button.dataset.back)));
});
document.querySelectorAll("[data-answer-group] button").forEach((button) => {
  button.addEventListener("click", () => {
    const groupEl = button.closest("[data-answer-group]");
    const group = groupEl.dataset.answerGroup;
    state.answers[group] = button.dataset.value;
    groupEl.querySelectorAll("button").forEach((item) => item.classList.toggle("selected", item === button));
  });
});

$("locateButton").addEventListener("click", locateCurrentStore);
$("useManualLocation").addEventListener("click", useManualLocation);
$("manualLocation").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void useManualLocation();
  }
});
$("locationNext").addEventListener("click", () => setStep(3));
$("moneyNext").addEventListener("click", () => { if (validateMoney()) setStep(4); });
$("calculateButton").addEventListener("click", () => {
  if (!validateEvidence()) return;
  renderResult(DecisionEngine.assess(collectInput()));
});
$("restartButton").addEventListener("click", resetFlow);
$("loadDemoButton").addEventListener("click", loadDemo);

fetch("data/corpus_analysis.json")
  .then((response) => response.ok ? response.json() : Promise.reject())
  .then((data) => {
    $("heroTitles").textContent = data.archive.manifest_unique_videos;
    $("heroAccepted").textContent = data.archive.accepted_transcripts;
    $("heroExcluded").textContent = data.archive.excluded_transcripts;
  })
  .catch(() => {});
