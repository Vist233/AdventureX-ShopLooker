const list = document.getElementById("rankingList");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[char]));
const stageLabel = (stage) => ({ preopen: "筹备开店", operating: "经营中", growth: "增长期" }[stage] || stage || "经营中");
async function loadLeaderboard() {
  try {
    const response = await fetch("/api/leaderboard"); const data = await response.json();
    if (!response.ok) throw new Error(data.message || "案例榜暂时不可用");
    const cases = Array.isArray(data.cases) ? data.cases : [];
    list.innerHTML = cases.length ? cases.map((item) => `<article class="ranking-card"><div><span class="plan-rank">#${item.rank} · ${escapeHtml(stageLabel(item.stage))} · ${escapeHtml(item.category)}</span><h2>${escapeHtml(item.conclusion)}</h2></div><div class="ranking-score"><b>${Math.round(item.rankScore || 0)}</b><span>排行榜分</span></div><p>证据分 ${Math.round(item.evidenceScore || item.dataScore || 0)} · 结果分 ${Math.round(item.outcomeScore || 0)}</p>${(item.plans || []).map((plan) => `<section><b>${escapeHtml(plan.role)}</b><h3>${escapeHtml(plan.title)}</h3><p>${escapeHtml(plan.action)}</p><small>成功线：${escapeHtml(plan.successLine)}　停止线：${escapeHtml(plan.stopLine)}</small></section>`).join("")}</article>`).join("") : "<p>还没有达到公开门槛的案例。</p>";
  } catch (error) { list.innerHTML = `<p>${escapeHtml(error.message)}</p>`; }
}
void loadLeaderboard();
