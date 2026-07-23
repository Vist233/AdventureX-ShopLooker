# 店判 · 餐饮开店与止损决策 Agent

这是一个基于 AdventureX 2025 评分结构和勇哥餐饮完整连麦语料做出的研究型原型。产品默认从用户当前位置开始，只要求用户补充地图和系统无法知道的少量经营信息。

## 已完成

- 对字幕归档进行高精度质量审计；
- 将标题选题统计与字幕正文统计分开；
- 提取勇哥反复使用的经营判断维度；
- 形成 `GO / TEST / STOP / EXIT` 产品协议；
- 将原来的完整经营表单压缩成“阶段、位置、关键账目、三个现场问题”四步；
- 接入腾讯位置服务的坐标转换、逆地址解析、地址解析和同类地点周边搜索；
- 浏览器精确定位失败时，自动识别大致城市并要求用户补充具体地址；
- 实现可离线运行的财务判断、压力测试、风险提示和下一步行动；
- 提供福州菜馆、待开咖啡店两个案例结构。

## 使用

在工作区执行：

```bash
cd output/adventurex-restaurant-decision
pyenv shell Agent
python -m http.server 8765
```

然后访问 `http://localhost:8765`。

网页的财务计算与决策引擎没有外部依赖。即使比赛现场断网，表单、压力测试和决策闸门仍可演示；自动地址和周边地点需要腾讯地图服务。

## 腾讯地图

定位使用三级降级，不让用户因为浏览器无法提供坐标而卡住：

1. 优先用浏览器 GPS 获取 WGS84 坐标并请求 `/api/map/context`；
2. 失败时通过 `/api/map/ip-location` 识别大致城市，仅用于预填；
3. 用户补充商圈、路名或门牌号后，通过 `/api/map/address-context` 确认店铺位置。

Cloudflare Worker 在服务端完成：

1. WGS84 → GCJ-02 坐标转换；
2. GPS 逆地址解析或文字地址解析；
3. 800 米内同类地点搜索；
4. 返回地址、行政区和附近地标。

网络 IP 结果不会返回坐标、不会读取周边 POI、不会启用下一步，因此不会把城市中心误当成店铺位置。

腾讯地图 Key 不进入前端代码。部署前需要配置 Worker Secret：

```bash
cd output/adventurex-restaurant-decision
wrangler secret put TENCENT_MAP_KEY --config wrangler.toml
```

然后粘贴在腾讯位置服务控制台创建的 WebService Key。未配置 Key
时，当前位置仍可取得，系统会明确标注“地图数据未参与本次判断”，不会伪造周边信息。

该 Key 需要启用 **WebServiceAPI**。如果开启域名白名单，应授权
`zhangyvjing.com`（腾讯会同时授权其子域名）；Worker 请求会携带
`https://yongge.zhangyvjing.com/` 作为来源。

使用真实腾讯接口做本地联调时，可临时设置 `TENCENT_MAP_KEY` 后运行
`node test_worker_live.mjs`。测试脚本不会保存或输出 Key。

浏览器端到端测试使用本机 Chromium，覆盖 GPS 成功以及权限拒绝、位置不可用、定位超时后的完整降级流程：

```bash
pyenv shell Agent
python test_location_e2e.py
```

## 发布

生产站点：`https://yongge.zhangyvjing.com`。

每次修改页面或重新生成语料统计后，运行：

```bash
cd output/adventurex-restaurant-decision
./deploy.sh
```

该脚本只把 `index.html`、`styles.css`、`decision-engine.js`、`app.js` 和聚合后的
`data/corpus_analysis.json` 发布到 Cloudflare Worker 静态资产；研究文档、分析程序和原始字幕不公开。
生产域名由 `wrangler.toml` 中的 Worker Custom Domain 管理。

## 重新分析字幕

归档有新增内容后运行：

```bash
pyenv shell Agent
python output/adventurex-restaurant-decision/analyze_corpus.py
```

输出：

- `data/corpus_analysis.json`：完整统计与每份字幕的保留/剔除原因；
- `data/cases.csv`：全部标题的阶段和问题标签；
- `data/transcript_audit.csv`：字幕质量审计表。
- `data/accepted_transcripts.csv`：通过质量门槛的正文清单。
- `data/conversation_analysis.csv`：高可信对话的直接请求、风险维度与询问协议。

第二层人工筛选与核心案例见 [SHORTLIST.md](SHORTLIST.md)。

## 重要边界

- AI 字幕可能错配；未通过门槛的内容不进入正文结论。
- 标题分布只代表该频道选择和包装的案例。
- 当前原型是决策筛查工具，不是会计、法律或投资意见。
- 腾讯地图用于地址和附近 POI，不把 POI 数量冒充真实人流、目标客流或营业额预测。
- OCR、视觉、合同核验仍是产品路线，不冒充已经接入。

完整的用户问题分布、勇哥询问协议、自动化边界与 No-Chatbot 产品定义见
[FIRST_PRINCIPLES_REPORT.md](FIRST_PRINCIPLES_REPORT.md)；AdventureX 评分与比赛
Demo 设计见 [RESEARCH.md](RESEARCH.md)。
