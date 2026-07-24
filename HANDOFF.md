# 店判交接文档

更新：2026-07-24（Asia/Shanghai）  
仓库：`Vist233/AdventureX-ShopLooker`  
生产：<https://yongge.zhangyvjing.com>  
案例榜：<https://yongge.zhangyvjing.com/ranking>

## 当前状态

Cloudflare Worker 名称为 `yongge`，技术栈为 Worker + Static Assets + D1 + Queue + Durable Object。`main` 最新提交：`774d63c`。本轮已上线、并以生产 API 做过文字问诊冒烟验证。

关键验证：回答“最近一个月营业额十二万元”会在生产案卷中写入 `monthlyRevenue=120000`、`period=month`，下一题稳定推进为 `variableCostRate`；不会重复第一题。

## 核心规则：6–12 问

地址、阶段、品类在问诊前确认，不计入问题数。

| 阶段 | 固定六项 |
|---|---|
| 已营业 | 月营收、变动成本率、月固定成本总额（含老板劳动）、可用现金、债务、最大断点 |
| 准备开店 | 总投入、可用现金、债务、月固定成本、变动成本率、真实付费验证 |
| 增长 | 月营收、变动成本率、月固定成本、可用现金、产能、增长断点 |

- `interview-policy.js` 是问题顺序、上限和结束条件的唯一权威。
- `MAX_TURNS=12`，每字段最多一次。
- “不知道”写为 `unknown`，绝不换句式追问。
- 固定六项结束后，仅在核心事实足够且判断确有需要时补问；目前默认最多补三项，12 是硬上限。
- Agent 只能抽取事实，不能决定下一问；`sanitizeAgentNextQuestion()` 会回到程序策略。

## Agent 与事实架构

```mermaid
flowchart TD
  A[阶段、品类、地址] --> B[确定性问诊规划器]
  B --> C[屏幕问题与 TTS]
  C --> D[浏览器即时语音草稿]
  D --> E[DashScope 最终 ASR]
  E --> F[可编辑 AnswerDraft]
  F --> G[确认并下一题]
  G --> H[事实抽取 Agent：严格 JSON]
  H --> I[服务端 FactArchive 归一化]
  I --> J[确定性经营引擎]
  J --> K[主方案生成]
  K --> L[独立核验]
  L --> M[主方案与已核验备选]
```

### 关键实现边界

- 浏览器即时识别先写入草稿；DashScope 最终转写仅在用户未手改时更新草稿。
- 只有用户点击“确认并下一题”才会写入案卷和推进问题。
- VAD 静音结束为 350ms，前端与 Worker 一致。
- `AnswerDraft` 状态包含 `turnId / draft / draftEdited / draftSource`。
- Worker 的 `canonicalInterviewFacts()` 是唯一归一化入口，内部经 `normalizeServerFacts()` 执行字段白名单、数值、周期、范围、单位及未知校验。
- `deterministicAnswerFact()` 仅在模型超时或返回空事实时，对**当前确定性字段**进行受限兜底，防止数字丢失；不要将其扩展为自由文本推理。
- `fixedCostTotal` 是新核心字段。旧案卷只有房租、人工、其他固定成本时，`FactStore` 只会在老板劳动成本未明确为未知时派生总固定成本。

## 前端状态

首页没有重做。问诊页只保留当前问题、`第 X / 6 · 最多补至 12`、草稿框、确认按钮与暂停/继续。

结果页只展示中文结论、3 个关键数字、判断说明、主方案和已核验备选。完整事实与现场证据收进 `<details>`。结论中文映射为：`可以继续`、`小步验证`、`停止追加`、`准备退出`。Loading 使用与顶部一致的“判”标志。

## 匿名案例榜

### 隐私边界

私有案卷在 `cases` 表中，设计寿命为 24 小时。公开榜使用独立 D1 表：`public_cases` 与 `public_case_outcomes`。

公开快照绝不能包含精确地址、身份、音频、原始转写、案卷令牌、完整账目或金额型核心事实。允许显示阶段、品类、中文结论、非敏感信号、主/备选方案和证据分。

### 资格与排序

- 数据丰富度至少 70；
- 有非 `EVIDENCE` 确定性结论；
- 当前分析完成，且至少一条方案通过核验；
- 结果页默认尝试匿名发布，失败不影响私有结果；
- 本机 `localStorage` 保存管理令牌，结果页可下架自己的案例。

排行榜完全不调用 Agent：

`排行榜分 = 70% 数据丰富度 + 30% 结果改善度`

改善度支持 `revenue / orders / gross_margin / cost / cash_burn`。成本与现金消耗按下降更好；无可比回填时结果分为 0。

### API

| API | 用途 |
|---|---|
| `GET /api/leaderboard` | 获取仅含公开快照的榜单 |
| `POST /api/cases/:caseId/publish` | 使用私有案卷令牌匿名发布 |
| `POST /api/public-cases/:id` | 使用管理令牌回填结构化前后数据 |
| `DELETE /api/public-cases/:id` | 使用管理令牌下架案例 |

## 部署与数据库

- 配置：`wrangler.toml`
- 构建：`build_site.py`
- 发布：`deploy.sh`
- D1：`yongge-cases`，绑定名 `DB`
- 已执行生产迁移：`migrations/0002_public_cases.sql`

常规发布：

```bash
cd output/adventurex-restaurant-decision
./deploy.sh
```

脚本运行静态检查、Node 测试、构建、dry-run 和正式部署。网络不稳时先走本地 `7897` 代理，再直接重试。

不要提交 `.env`、Cloudflare Secrets、生产案卷、音频、原始转写或案例管理令牌。

## 已完成验证

- `test_fact_store.js`
- `test_decision_engine.js`
- `test_interview_policy.js`
- `test_server_decision_adapter.mjs`
- `test_dashscope_asr_client.mjs`
- `test_dashscope_tts_client.mjs`
- `test_stepfun_client.mjs`
- `test_agent_orchestrator.js`
- `test_worker.mjs`
- 生产 `GET /api/leaderboard` 返回 `{"cases":[]}`（空榜正常）
- 生产文字问诊：数字入档、问诊进度为 `1 / 6 / 12`、问题不重复。

## 后续优先级

1. 做浏览器真人 E2E：语音草稿、手改保护、暂停恢复、6 问结束与补问路径。
2. 增加普通用户的榜单结果回填表单；后端 API 已就绪，前端尚未提供此表单。
3. 当前 Worker 目标数为 2、并发为 1；若要严格“主方案核验通过后才生成备选”，继续重构 `agent-orchestrator.js` 的生成时序。
4. 增加 Playwright 视觉回归基线。
5. 审视 `analysis_runs`、审计表和公开案例的长期保留/级联清理策略。

## 常见排障

- `/api/leaderboard` 404：通常是静态文件上传成功但 Worker 未切换；重新 `wrangler deploy --config wrangler.toml`，再 curl 验证。
- 页面显示数字但结果未采纳：检查 `/turns` 响应的 `extractedFacts`。应含当前字段、归一化数值、周期与状态；检查 `deterministicAnswerFact()` 与 `canonicalInterviewFacts()`。
- 问题重复：检查 `interview-policy.js` 的 `turns` 是否写入当前字段，以及前端是否重用 `turnId`。
- 无法公开：检查丰富度≥70、分析 `completed`、且有通过核验的方案；三项均为故意门槛。
