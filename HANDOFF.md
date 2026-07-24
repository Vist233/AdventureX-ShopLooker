# 交接文档 · Thermal Brutalism 界面改版

分支：`thermal-brutalism-reskin`（基于最新 `main`）

## 一、本次改动目标

把现有勇哥判店界面统一改成 **Thermal Brutalism（热敏收据 / 粗野主义）** 设计风格，
参考 `design-reference/DESIGN.md` 与 `design-reference/thermal-brutalism-mockup.html`。

约束：**现有页面字体不变**，只改视觉风格（配色、边框、圆角、阴影、分隔线、强调方式）。

## 二、改了哪些文件

| 文件 | 改动 |
| --- | --- |
| `styles.css` | 整体重写为 Thermal Brutalism；类名、布局结构、响应式断点、所有 `font-family` 保持不变 |
| `index.html` | 仅在 footer 增加纯 CSS 条形码 + 版本戳（`.barcode-wrap`），其余为纯 CSS 接管 |
| `ranking.html` | 增加 `.ranking-footer` 条形码页脚 |
| `design-reference/DESIGN.md` | 新增，设计规范原稿 |
| `design-reference/thermal-brutalism-mockup.html` | 新增，设计参考稿（原 `code.html`） |

因为改动集中在共享的 `styles.css`，所有引用它的界面都被统一改版，**不只是首页**：

- 落地页（hero、市场数据卡、结论条、事实对照、勇哥数据、方法四栏、来源说明、页脚）
- 问诊流程（位置面板、问诊面板、纠偏复核面板）
- 分析与结果页（进度、决策头、指标卡、方案卡——首个方案整卡反白、被淘汰方案、方案详情弹窗）
- 店铺排行榜页 `ranking.html`

## 三、设计风格要点（落地到 CSS 的规则）

- 配色：油墨黑 `#1A1D1A` / 纸白 `#FAFAF5` / 热敏灰，去掉原霓虹绿/蓝/琥珀；错误红 `#BA1A1A` 仅保留于报错态
- 锐角：移除所有 `border-radius`
- 边框：统一 1px 实心油墨线；区块内分隔线改为 `1px dashed`
- 无柔性阴影：去掉投影，改用「色调反白」表达层级（首方案卡、选中项、`market-early` 卡反白为黑底纸字）
- 按钮：默认 2px 油墨描边 + 黑字白底；hover/active 全黑填充 + 纸白字
- 输入框：仅下划线（`border-bottom`）
- 纸张颗粒：整页叠加 SVG 噪点，模拟热敏纸印刷质感
- 强调：hero / 排行榜标题的 `<em>` 用反白黑块，替代原绿色高亮
- 收尾：首页与排行榜页脚各加 1D 条形码，呼应收据隐喻

## 四、本地预览（重要）

**普通静态服务器无法完整预览。** `ranking.html` 会请求 `/api/leaderboard`，
`app.js` 也依赖 `/api/*`（地图、TTS、案例等）。这些接口只存在于 Cloudflare Worker。

- ❌ `python3 -m http.server 3001`：能看样式，但 `/api/*` 返回 404 HTML，
  排行榜会报 `Unexpected token '<' ... is not valid JSON`（**这是后端缺失，不是样式 bug**）。
- ✅ 正确方式：`wrangler dev`（会跑 `worker.mjs`，提供 `/api/*`）。地图/语音仍需
  在本地配置对应 secret 才能完整联调。

API 路由定义见 `worker.mjs`：`/api/leaderboard`、`/api/cases`、`/api/map/*`、`/api/tts`。

## 五、验证结果

- `styles.css`：花括号配平（403/403），无未定义 CSS 变量
- HTML/JS 中 115 个类名全部有样式覆盖（4 个未匹配项在原样式表里本就无样式）
- 无残留 green/blue/radius/backdrop-filter；剩余 `box-shadow` 均为功能性（内描边 / 脉冲环）
- 无测试对 CSS 计算样式做断言

## 六、部署

上线走 `deploy.sh`：会先 `node --check` + 跑单测，再 `python build_site.py` 生成 `dist/`，
最后 `wrangler deploy`。`build_site.py` 只复制白名单公开文件
（`index.html`、`ranking.html`、`ranking.js`、`styles.css`、`fact-store.js`、
`decision-engine.js`、`app.js` + `corpus_analysis.json`）；`design-reference/` 与
`HANDOFF.md` 不会进入 `dist/`，不影响线上产物。

## 七、后续待办 / 风险

- 未在 `wrangler dev` 下做端到端联调（本次仅静态样式核对 + 结构校验）
- 未加视觉回归测试；如需，可对关键页面做截图基线
- 设计风格属较强改版，合并前建议产品/设计确认整体观感
