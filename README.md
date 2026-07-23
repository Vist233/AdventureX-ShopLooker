# 店判 2.1 · 餐饮开店、经营与止损决策 Agent

店判不是“问 AI 该不该开店”的聊天框，而是一套先确认位置、再持续问诊、最后让用户集中纠偏事实的经营决策系统。它先用确定性公式算账，再让 StepFun 文本 Agent 搜索和核验可执行方案。

生产站点：<https://yongge.zhangyvjing.com>

纯演示站：<https://demo.yongge.zhangyvjing.com>。它复用同一套四步界面，但不会请求地图、ASR、案卷或完整 Agent 分析；案例取自已筛选字幕 `BV15vrVBwEVP`（山西运城稷山县私房小碗菜），只展示字幕明确说出的事实，未出现的信息仍标为未知。

勇哥在“完全不知道、数据齐全、经营好、经营差”四种情况下如何判断，见 [YONGGE_DECISION_TREE.md](YONGGE_DECISION_TREE.md)。

## 用户怎么使用

正常流程只有三屏输入和一个结果页：

```text
1. 确认店铺位置
   ↓
2. 点击一次开始问诊，之后持续说话、自动跳题
   ↓
3. 在同一页确认、标记未知或编辑 AI 提取的全部事实
   ↓
确定性算账 + 3 条并行方案流水线
   ↓
最多 3 个带预算、指标、成功线和停止线的方案
```

第一屏要求用户确认腾讯地图返回的地址背景。第二屏只需点击一次“开始问诊”，麦克风在整个问诊期间保持开启；问题同时用文字和语音呈现，浏览器端 VAD 在用户停顿后截出一段 WAV，识别完成后自动进入下一问。第三屏把全部事实一次列出；每项只需选择“AI 记录正确”“我不知道”，或直接编辑自己的原话，最后一次提交整份纠偏结果。

第一屏的经营品类既可以手输，也可直接点击快餐、小碗菜、面馆、咖啡、火锅或烧烤等选项卡。

## 现场 Demo 模式

主站首屏“开始店铺问诊”右侧提供 Demo 入口。Demo 不是跳过流程直接出结论，而是自动完成同一条路径：

```text
点击获取案例地图信息
→ 自动确认字幕案例的位置、阶段与品类
→ 每 4 秒展示一题及对应字幕回答（同时使用设备 TTS 播报）
→ 全量查证页保持已填事实，点击选项不改写案例
→ 点击下一步，2 秒后展示预先写好的案例判断
```

演示页只用于讲解产品，不保存音频、不调用真实语音识别、不消耗分析额度；结果明确标为案例演示，不能当作对现实门店的经营意见。

这是麦克风持续开启、双方轮流说话的交互，不宣称能在嘈杂现场可靠分离多个说话人。系统播报问题时暂停收集用于识别的声音，播报结束后自动继续监听，避免 AI 把自己的声音识别成用户答案。`fun-asr-flash-2026-06-15` 接收的是每轮完整 WAV，不是实时增量输入，因此页面只在一段回答提交后显示最终转写，不伪装成逐字实时字幕。

## 核心能力

- **腾讯地图位置背景**：地址解析、行政区、附近地标和 800 米内同类 POI；真实门店入口仍由用户回答确认。
- **阿里云语音识别**：浏览器端 VAD 以约 600 ms 静音切分回答，打包为 16 kHz、16-bit、单声道 WAV，再由 Worker 调用 DashScope `fun-asr-flash-2026-06-15` 的 HTTP 接口取得最终转写。该模型不承担服务端 VAD，也不接收持续 WebSocket 音频。
- **StepFun 语音播报**：`stepaudio-2.5-tts`；语音不可用时仍保留屏幕文字和浏览器播报。
- **StepFun 动态追问**：程序策略决定必问字段、顺序、每字段最多两问及完成条件；`step-3.7-flash` 提取候选事实和矛盾，并为程序指定字段生成不超过 30 字的问法；在线追问最多等待 7 秒，超时即用确定性问题继续；最多问诊 30 轮。
- **一屏事实查证**：全部事实同时显示；用户逐项确认、标记未知或编辑原话，系统重新解析编辑内容后一次提交。纠偏阶段不再语音重问。
- **可审计事实档案**：保留值或范围、单位、周期、状态、来源、证据等级、原始转写和更新时间；档案整体带有案卷版本。
- **勇哥确定性引擎**：计算贡献毛利、完整固定成本、老板替代工资、保本营业额、订单、利润、现金寿命和压力测试，输出 `EVIDENCE / GO / TEST / STOP / EXIT`。
- **3 条并行方案流水线**：单轮并行生成 3 个候选；每个候选接受证据/因果与财务/执行两次核验，共 9 次 Agent 调用。模型格式失败时只用明确标记的零预算补证据任务安全补位。
- **可执行结果**：最多保留 3 个不同机制的方案；选择方案后生成执行清单和复查时间。

未知值不会被当成 0，范围不会静默变成“精确数字”，默认成本只能标为假设。用户修改事实后案卷版本会增加，旧分析自动标记为过期。最终写作 Agent 只能解释既定结果，不得改写确定性引擎的数字、已经完成的排名、风险或停止线。

## 地图不是人流

腾讯地图只提供地理背景：

- 浏览器 GPS 的 WGS84 坐标由 Worker 转为 GCJ-02 后查询；
- GPS 失败时，IP 位置只能预填大致城市；
- 用户可以输入商圈、路名或门牌号，再从返回结果中确认；
- Map Key 只存在于 Worker Secret，不进入前端。

POI 数量、学校、地标和附近门店都不能证明真实人流，更不能证明目标顾客会进店。店判把真实人流留给现场的 20 分钟五段计数：

```text
经过 → 目标顾客 → 看见门头 → 进店 → 下单
```

地图不可用时，系统退回用户确认的文字地址，并明确标注地图未参与判断，不伪造商圈、客流或租金信息。

## 数据与隐私

- 原始麦克风音频只在浏览器和 Worker 内存中短暂停留，并作为单轮 WAV 发送给 DashScope ASR；不写入 D1、R2 或应用日志。
- 转写、结构化事实、用户选择、分析状态和方案会进入案卷。
- 每个案卷使用独立随机令牌，服务端只保存令牌哈希。
- 案卷的服务端读取期限为最后一次写入后的 24 小时；过期案卷不再由 API 读取。这是读取期限，不等同于一项法规级自动物理擦除承诺。
- 用户可调用删除接口立即删除自己的案卷。
- Worker 还执行同源检查、请求大小限制、接口限流和单案卷 TTS 次数限制。

当前生产配置面向现场 Demo：全站每天最多创建 25 次新完整分析，同一公网 IP 每天最多 5 次；共享会场 Wi‑Fi 会共用这 5 次。每段 ASR 音频不得超过 3 MiB，ASR 接口另有每小时限流；每个案卷最多调用 40 次 TTS。演示前可在 `wrangler.toml` 调整 `ANALYSIS_DAILY_*`，再重新部署。

## 本地运行

### 仅看前端与离线降级

```bash
cd output/adventurex-restaurant-decision
pyenv shell Agent
python -m http.server 8765
```

访问 <http://localhost:8765>。这个模式没有 Worker API，会自动演示文字问诊、确定性引擎和本地低成本方案降级。

### 完整 Worker 本地环境

首次运行本地 D1：

```bash
cd output/adventurex-restaurant-decision
pyenv shell Agent
python build_site.py
wrangler d1 execute yongge-cases --local --file schema.sql --config wrangler.toml
wrangler dev --config wrangler.toml
```

本地密钥应放在未提交的 `.dev.vars`，不要写入源码、README 或 `wrangler.toml`。

## 测试

不需要真实密钥的回归测试：

```bash
cd output/adventurex-restaurant-decision
node test_fact_store.js
node test_decision_engine.js
node test_interview_policy.js
node test_server_decision_adapter.mjs
node test_stepfun_client.mjs
node test_dashscope_asr_client.mjs
node test_agent_orchestrator.js
node test_worker.mjs

pyenv shell Agent
python test_location_e2e.py
```

`test_location_e2e.py` 是浏览器 E2E：它模拟地图和案卷 API，并故意拒绝麦克风权限，验证“位置确认 → 一次启动问诊 → 文字降级 → 全量事实查证 → Top 3”不会卡死；它还检查全部查证项同时可见、一次提交、编辑原话后重新解析，以及“毛利 45%”“12 万一年”“10 到 12 万”等口径。

`test_dashscope_asr_client.mjs` 验证 DashScope 请求格式、WAV Data URI、鉴权头和两种转写响应结构；`test_worker.mjs` 验证受保护的单轮 ASR HTTP 接口。真实 StepFun 文本模型与 TTS 可用 `node test_stepfun_live.mjs` 验证；腾讯地图可用 `node test_worker_live.mjs` 验证。真实 ASR 调用应在当前 shell 或 Worker Secret 中安全提供 `DASHSCOPE_API_KEY`。不要把任何密钥写进命令历史或提交记录。

真实 ASR 可分别验证供应商接口和已部署 Worker 代理：

```bash
pyenv shell Agent
python test_dashscope_asr_live.py
node test_production_asr.mjs
```

生产全链路验收会真实消费一次完整 Agent 分析及当日配额：

```bash
cd output/adventurex-restaurant-decision
pyenv shell Agent
python test_production_e2e.py --confirm-paid-analysis
```

## 首次部署

需要已登录的 Wrangler 和具有对应 Cloudflare 权限的账号。

1. 创建生产资源：

```bash
wrangler queues create yongge-analysis
wrangler queues create yongge-analysis-dlq
wrangler d1 create yongge-cases
```

2. 把 D1 创建命令返回的数据库标识填入本地 `wrangler.toml` 的 `database_id`。不要把密钥当作普通变量提交；数据库标识也不需要出现在文档中。

3. 初始化远程 D1：

```bash
wrangler d1 execute yongge-cases --remote --file schema.sql --config wrangler.toml
```

4. 写入 Worker Secrets：

```bash
wrangler secret put STEPFUN_API_KEY --config wrangler.toml
wrangler secret put DASHSCOPE_API_KEY --config wrangler.toml
wrangler secret put TENCENT_MAP_KEY --config wrangler.toml
```

`STEPFUN_API_KEY` 只供文本 Agent 和 TTS 使用；`DASHSCOPE_API_KEY` 只供 `fun-asr-flash-2026-06-15` 使用。也可以使用 `STEPFUN_API_KEYS` 保存由服务端轮换的 StepFun 密钥池。只能配置单个 StepFun Key 或 Key 池中的一种来源；所有密钥值都不得进入前端、Git 或日志。

腾讯地图 Key 需要启用 WebService API。如果腾讯控制台启用了域名白名单，应授权生产域名；Worker 会以生产站点为来源请求地图服务。

5. 运行完整静态检查、单元测试、构建、Dry Run 和部署：

```bash
./deploy.sh
```

`deploy.sh` 发布 `dist/` 中的公开网页资产和 Worker，不会公开研究文档、分析脚本、原始字幕或密钥。

## 日常部署

代码或页面修改后：

```bash
cd output/adventurex-restaurant-decision
./deploy.sh
```

如果 `schema.sql` 有变更，应先在本地副本验证，再显式执行对应的远程 D1 迁移；日常部署脚本不会替你修改生产数据结构。若 Queue、DLQ、D1 或 Durable Object 绑定发生变化，先执行 `wrangler deploy --dry-run --config wrangler.toml` 检查绑定，再正式发布。

## 字幕语料再分析

```bash
pyenv shell Agent
python output/adventurex-restaurant-decision/analyze_corpus.py
```

程序会更新：

- `data/corpus_analysis.json`：统计与每份字幕的保留/剔除原因；
- `data/cases.csv`：标题阶段和问题标签；
- `data/transcript_audit.csv`：字幕质量审计；
- `data/accepted_transcripts.csv`：通过质量门槛的正文；
- `data/conversation_analysis.csv`：高可信对话中的请求、风险维度和询问协议。

AI 字幕可能错配；未通过门槛的内容不能进入正文结论。标题分布只代表频道选题，不代表整个餐饮行业。

## 文档

- [FIRST_PRINCIPLES_REPORT.md](FIRST_PRINCIPLES_REPORT.md)：用户真实需求、勇哥判断协议和第一性原理产品定义。
- [RESEARCH.md](RESEARCH.md)：AdventureX 评分结构、语料统计与桌面研究。
- [ARCHITECTURE.md](ARCHITECTURE.md)：前后端、语音、事实、确定性引擎、Agent 搜索、Cloudflare 资源与降级架构。

店判是经营决策筛查和实验设计工具，不是会计、法律、劳动人事或投资意见。证据不足时，它的正确输出是先补证据，不是替用户制造一个看起来精确的答案。
