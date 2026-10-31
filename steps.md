# README 重构与 docs 建设 · 执行清单

> 目标：让 README 成为准确的「项目门面 + 快速开始」，把架构、AI、数据模型、部署细节拆到 `docs/`。
> 约束：只改文档，不动业务代码；所有描述以当前工作区实现为准（含未提交改动）。

## 步骤总览

| Step | 对应阶段 | 内容 | 状态 |
|---|---|---|---|
| 0 | — | 核对现状与 README 差距 | ✅ 2026-10-31 |
| 1 | 文档 | 重写 README.md | ✅ 2026-10-31 |
| 2 | 文档 | 新增 docs/architecture.md | ✅ 2026-10-31 |
| 3 | 文档 | 新增 docs/ai.md | ✅ 2026-10-31 |
| 4 | 文档 | 新增 docs/data-model.md | ✅ 2026-10-31 |
| 5 | 文档 | 新增 docs/deploy.md | ✅ 2026-10-31 |
| 6 | 文档 | 按现状重写 spec.md | ✅ 2026-10-31 |
| 7 | 文档 | 全量交叉校验 | ✅ 2026-10-31 |

---

## Step 0 · 核对现状与 README 差距（只读，已完成）

- 已读：`README.md`、`spec.md`、`miniprogram/app.json`、`app.js`、`utils/cloud.js`、`utils/util.js`、主要页面、8 个云函数、`package.json`、`project.config.json`、`.gitignore`、`test/`。
- 已核对 `git status` / `git diff`，当前有 21 个文件改动、6 个知识库种子文件与 `test/` 未跟踪。
- 主要差距：
  1. 页面清单缺 `forgotPassword/setPassword/searchPosts/likedPosts/myPosts/history/messages/topic/recordsList/hospitals/firstaid/adminLogin` 等。
  2. 云函数清单缺 `admin`、`notify`；`test/` 与种子文件未提及。
  3. AI 说明仍是「视觉模型 + 规则兜底」，未写 RAG 知识库、Agent 工具调用、图像两阶段诊断、情感分析、超时预算。
  4. 登录方式写成「微信手机号一键登录」，实际无 `getPhoneNumber`；现为微信授权 + 验证码 + 账号密码 + 找回/设置密码。
  5. 管理员写成「openid 白名单 + 我的页入口」，实际为 `admins` 集合 + 账号密码 + 登录页入口；`square` 内仍残留 `ADMIN_OPENIDS` 硬编码。
  6. 内容安全描述自相矛盾（已接入 / 未接入）；实际文本已接入且 fail-open，图片与 AI 输出未校验。
  7. 数据模型缺 `admins/accounts/square_posts/square_reports/square_notifications/kb_docs/kb_meta`。
  8. 部署缺 `ZHIPU_API_KEY`、`TENCENT_MAP_KEY` / `tencent_key.js`、`notify` 定时触发器与模板 ID、索引与权限说明。

**完成判据**：差距清单覆盖上述全部项，且与代码一致。

---

## Step 1 · 重写 `README.md`

- 涉及文件：`README.md`（整体替换）。
- 结构（目标 130–160 行）：
  1. 项目名 + 一句话定位 + 技术栈徽标式纯文本（不引入图片）。
  2. 核心能力（按用户视角分组：问诊、档案、提醒、广场、工具、管理）。
  3. 技术架构一图流（文字版：小程序 → 云函数 → 云数据库/云存储 → 智谱 GLM / 腾讯位置服务）。
  4. 仓库结构（页面、云函数、测试、文档）。
  5. 快速开始（5 步）：打开项目 → 确认 env → 部署 8 个云函数 → 配置环境变量 → 编译。
  6. 文档索引（链到 docs/）。
  7. 已知限制与合规声明（演示验证码、订阅消息待模板、内容安全 fail-open、默认管理员口令）。
- 保留：License、spec 链接（注明 spec 为需求基线）。
- 删除：过时的「规划中」表、逐页功能长清单、与代码不符的部署细节（移入 docs）。
- **完成判据**：页面/云函数/集合清单与仓库一致；快速开始可照做；无自相矛盾表述。

---

## Step 2 · 新增 `docs/architecture.md`

- 内容：
  - 运行时架构与请求链路（小程序 → `utils/cloud.js` → 云函数 → DB/存储 → 外部服务）。
  - 页面地图（Tab + 二级页 + 管理端），标注孤儿页 `pages/featured`。
  - 云函数职责与 action 表（login/pet/record/reminder/square/admin/assistant/notify）。
  - 鉴权模型：普通用户 openid 会话、账号密码、管理员 `admins` 集合、`square` 遗留白名单。
  - 四条关键数据流：文字问诊、拍照问诊、广场发布审核、提醒推送。
  - 开发约定（`{ok,data,msg}`、`requireLogin`、5 只上限、envId 单一来源）。
- **完成判据**：action 表与代码逐项对应；数据流能据此定位文件。

---

## Step 3 · 新增 `docs/ai.md`

- 内容：
  - 模型与超时预算（`glm-4.6v-flash` → `glm-4v-flash`、`glm-4-flash`、52s 预算、重试策略）。
  - 纯文本：Agent Function Calling（`get_weather`、`search_kb`）+ 最多 3 轮。
  - 拍照问诊：观察师 → 审查员两阶段、知识库联合检索、1024 token 限制。
  - RAG：`kb_docs` / `kb_meta`、v1–v9 增量播种、bigram 分词与打分、管理员维护入口。
  - 情感分析、内容安全、输出结构（level/summary/content/followUp）。
  - 降级链路：模型失败 → 前端本地 `util.aiConsult` 规则回复；医院检索失败 → 演示数据。
  - 测试：`npm test` 覆盖范围与 mock 方式、如何新增回归用例。
- **完成判据**：新同学能据此改 prompt / 加知识 / 排查模型失败。

---

## Step 4 · 新增 `docs/data-model.md`

- 内容：12 个集合的用途、字段、索引建议、写入方、隔离方式。
  - `users`、`pets`、`records`、`reminders`、`sms_codes`
  - `admins`、`accounts`
  - `square_posts`、`square_reports`、`square_notifications`
  - `kb_docs`、`kb_meta`
- 附表：自动建集合清单、需手动加的索引（`reminders._openid+dueAt` 等）、脱敏/敏感字段（密码盐与哈希、手机号）。
- **完成判据**：字段名与代码一致；索引建议可执行。

---

## Step 5 · 新增 `docs/deploy.md`

- 内容：
  - 前置条件（AppID、云环境、基础库、Node）。
  - 环境变量：`ZHIPU_API_KEY`、`TENCENT_MAP_KEY`（或本地 `tencent_key.js`，已 gitignore）。
  - 8 个云函数部署顺序与「云端安装依赖」；`notify` 定时触发器（每天 9:00）。
  - 订阅消息：申请模板 → 两处填模板 ID（`notify/index.js`、`reminderEdit.js`）→ 字段对齐。
  - 管理员初始化：首次 `admin/Admin@123456` 播种并绑定当前 openid、改密、`square` 白名单说明。
  - 数据库索引与权限、内容安全 openapi 权限。
  - 常见故障排查表（云函数未部署、Key 未配、定位失败、订阅 43101 等）。
  - 上线检查清单。
- **完成判据**：按文档从零可跑通；故障表覆盖当前已知降级提示。

---

## Step 6 · 按现状重写 `spec.md`

- 现状：`spec.md` 更新日期 2026-10-22，明确「不做 UGC 广场」，与已实现的问诊广场冲突；三 Tab 目标也未落地。
- 已确认方案：**按当前实现重写为 as-built 产品规格**。
- 结构：定位与边界 → 用户与场景 → 信息架构（三 Tab 实际为 AI问诊/问诊广场/我的）→ 逐模块功能规格（档案/问诊/记录/提醒/广场/工具/账号与后台）→ 非功能与合规 → 未实现项（Backlog）→ 验收清单。
- 与 docs 分工：spec 讲「产品是什么、做到什么程度」，技术细节链到 `docs/`，不重复展开。
- **完成判据**：无「不做广场」等与实现冲突的表述；已实现/未实现边界清晰；README 对 spec 的定位描述一致。

---

## Step 7 · 全量交叉校验

- 用脚本/命令核对：`app.json` 页面数、`cloudfunctions/` 目录、集合名、文档内相对链接。
- 检查中英文标点、代码块语言标记、失效锚点。
- 更新 `steps.md` 状态表。
- **完成判据**：所有链接可跳转；清单零缺漏；`git diff` 仅含文档改动。

---

## 决策点（已确认 2026-10-31）

1. **docs 拆分粒度**：4 篇完整版（architecture / ai / data-model / deploy）。
2. **README 部署细节**：5 步快速开始 + 链到 `docs/deploy.md`。
3. **spec.md**：按现状重写为 as-built 产品规格。
4. **记忆记录**：同意按既定方式追加，不优化已有记忆文件。
