const list = document.getElementById("rankingList");
const countLabel = document.getElementById("rankingCount");
const caseCount = document.getElementById("caseCount");
const verifiedPlanCount = document.getElementById("verifiedPlanCount");
const stageFilters = document.getElementById("stageFilters");

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
const DECISION_CLASS = { GO: "go", TEST: "test", STOP: "stop", EXIT: "exit", EVIDENCE: "test" };
const DECISION_LABEL = { GO: "可以继续", TEST: "小步验证", STOP: "停止追加", EXIT: "准备退出", EVIDENCE: "小步验证" };
const STAGE_LABEL = { operating: "已营业", preopen: "准备开店", growth: "增长中" };

let currentCases = [];
let selectedStage = "all";
let initialCasesRendered = false;

function conclusionOf(item) {
  return item.conclusion || DECISION_LABEL[item.decision] || "小步验证";
}

function decisionClass(item) {
  return DECISION_CLASS[item.decision] || "test";
}

function stageOf(item) {
  return item.stage || "operating";
}

function stageLabel(item) {
  return STAGE_LABEL[stageOf(item)] || "经营中";
}

function evidenceScore(item) {
  const value = Number(item.evidenceScore ?? item.dataScore);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null;
}

function outcomeScore(item) {
  const value = Number(item.outcomeScore);
  return Number.isFinite(value) && value > 0 ? Math.max(0, Math.min(100, Math.round(value))) : null;
}

function displayCases() {
  return selectedStage === "all" ? currentCases : currentCases.filter((item) => stageOf(item) === selectedStage);
}

function updateDashboard() {
  const plans = currentCases.reduce((sum, item) => sum + (Array.isArray(item.plans) ? item.plans.length : 0), 0);
  if (caseCount) caseCount.textContent = String(currentCases.length);
  if (verifiedPlanCount) verifiedPlanCount.textContent = String(plans);
}

function updateFilterState() {
  stageFilters?.querySelectorAll("[data-stage-filter]").forEach((button) => {
    const active = button.dataset.stageFilter === selectedStage;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function renderCards() {
  if (!list) return;
  const cases = displayCases();
  if (!cases.length) {
    list.innerHTML = `<div class="ranking-empty"><b>这个阶段还没有公开案例。</b><p>换一个经营阶段，或稍后再来查看新发布的判断记录。</p></div>`;
    if (countLabel) countLabel.textContent = "0 份符合条件的案例";
    return;
  }

  if (countLabel) countLabel.textContent = selectedStage === "all" ? `共 ${cases.length} 份公开案例` : `显示 ${cases.length} 份${STAGE_LABEL[selectedStage] || ""}案例`;
  list.innerHTML = cases.map((item) => {
    const loc = item.location || "匿名地点";
    const category = item.category || "餐饮";
    const status = item.statusLine || item.status || item.decisionReason || "已完成经营判断";
    const evidence = evidenceScore(item);
    const outcome = outcomeScore(item);
    const plans = Array.isArray(item.plans) ? item.plans.length : 0;
    const rank = Number(item.rank);
    const rankLabel = Number.isFinite(rank) ? String(rank).padStart(2, "0") : "--";
    const scoreLine = evidence === null ? "资料完整度待补充" : `资料完整度 ${evidence}%`;
    const outcomeLine = outcome === null ? "尚无后续回填" : `回填改善度 ${outcome}%`;
    return `<a class="rank-card" href="/case/${encodeURIComponent(item.id)}/" aria-label="查看第 ${rankLabel} 份：${escapeHtml(category)}经营判断记录">
      <div class="rank-card-header">
        <span class="rank-number">#${rankLabel}</span>
        <div class="rank-card-tags"><span>${escapeHtml(stageLabel(item))}</span><span>${escapeHtml(loc)} · ${escapeHtml(category)}</span></div>
        <span class="rank-badge rank-badge-${decisionClass(item)}">${escapeHtml(conclusionOf(item))}</span>
      </div>
      <p class="rank-status">${escapeHtml(status)}</p>
      <div class="rank-card-evidence">
        <span>${escapeHtml(scoreLine)}</span>
        <span>${escapeHtml(outcomeLine)}</span>
        <span>${plans} 个已核验方案</span>
      </div>
      <div class="rank-card-foot"><span>查看完整判断票</span><b aria-hidden="true">→</b></div>
    </a>`;
  }).join("");
}

function showLoadError(message) {
  if (!list) return;
  list.innerHTML = `<div class="ranking-load-error"><b>案例榜暂时没有加载成功</b><p>${escapeHtml(message)}</p><button type="button" class="secondary-button" id="retryLeaderboard">重新加载案例榜</button></div>`;
  document.getElementById("retryLeaderboard")?.addEventListener("click", () => void loadLeaderboard());
}

async function loadLeaderboard() {
  if (!list) return;
  list.setAttribute("aria-busy", "true");
  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    let response;
    try {
      response = await fetch("/api/leaderboard", {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
    } finally {
      window.clearTimeout(timeout);
    }
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await response.json() : null;
    if (!response.ok) throw new Error(data?.message || "案例榜暂时不可用");
    if (!data || !Array.isArray(data.cases)) throw new Error("案例榜数据格式异常，请重新加载");
    const shouldStayAtTop = !initialCasesRendered && window.scrollY < 4;
    currentCases = data.cases.filter((item) => item && typeof item === "object" && item.id);
    updateDashboard();
    renderCards();
    initialCasesRendered = true;
    if (shouldStayAtTop) requestAnimationFrame(() => window.scrollTo(0, 0));
  } catch (error) {
    const message = error?.name === "AbortError"
      ? "加载超时，请检查网络后重新加载。"
      : (error?.message || "案例榜暂时不可用，请重新加载。");
    showLoadError(message);
  } finally {
    list.removeAttribute("aria-busy");
  }
}

stageFilters?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-stage-filter]");
  if (!button) return;
  selectedStage = button.dataset.stageFilter || "all";
  updateFilterState();
  renderCards();
});

updateFilterState();
void loadLeaderboard();
