# AI 实现说明

本文覆盖 `cloudfunctions/assistant` 的实际链路：模型选择、文本 Agent、图像两阶段诊断、RAG 知识库、情感与内容安全、降级策略，以及离线测试。

## 1. 入口与模型

| 项 | 值 |
|---|---|
| 云函数 | `cloudfunctions/assistant` |
| 超时 | `config.json` → `timeout: 60`（秒） |
| 文本模型 | `glm-4-flash`（支持 Function Calling） |
| 视觉模型 | `glm-4.6v-flash`（多图）→ `glm-4v-flash`（仅单图，自动取第一张） |
| 单次问诊预算 | 约 52s（为安全检查、RAG、序列化预留） |
| 图片上限 | 3 张，单张 ≤ 4MB，下载后转 base64 data URL |
| 前端超时 | `utils/cloud.js` 中 `assistantAsk` 为 55s |

请求：

```js
{ question: string, petProfile: object, fileIDs: string[] }
```

返回：

```js
{
  ok: true,
  model: 'glm-4-flash' | 'glm-4.6v-flash' | ...,
  data: { level: 'red|yellow|green', summary, content, followUp: string[] }
}
```

失败返回 `{ ok: false, msg, detail }`，前端不展示 `detail`，仅用于排查。

## 2. 纯文本：Agent 工具调用

```text
question + 宠物档案
  → 内容安全（msgSecCheck）
  → ensureKbSeed() → searchKb(question, 3)
  → 情感分析 → buildSystemPrompt
  → glm-4-flash（tools: get_weather / search_kb）
       ├─ 模型请求工具 → runTool() → 结果回填 messages
       └─ 最多 3 轮（MAX_TOOL_ROUNDS）
  → parseJson → buildContent → 返回
```

- 单轮超时 `min(25s, 剩余预算)`；超时且剩余 ≥ 16s 时重试一次；剩余 < 12s 不再发起新轮，用已有信息兜底。
- 工具结果 JSON 截断到 3000 字符，避免上下文膨胀。
- 多轮工具调用后仍无结论时，返回 `level=yellow` 的兜底结构（提示补充描述）。
- **注意**：对话历史保存在 `records.messages`，但当前请求只发送当前问题与宠物档案；模型侧多轮上下文尚未透传。拍照问诊后的「补充问诊」通过把上下文拼接进 `question` 实现。

### 工具

| 工具 | 实现 | 用途 |
|---|---|---|
| `get_weather(city)` | Open-Meteo 地理编码 + 当前天气（无需 Key） | 判断遛狗、中暑、出行场景 |
| `search_kb(query)` | 本地 RAG 检索，返回前 3 条 | 疾病、疫苗、驱虫、养护知识 |

## 3. 拍照问诊：观察师 → 审查员

```text
图片（≤3）+ 结构化描述 + 宠物档案
  → 阶段一 观察师（glm-4.6v-flash → glm-4v-flash）
       OCR 化验单/报告/疫苗本；逐图描述部位、病灶、边界、渗出等
       输出 { keywords: string[], report: string }
  → 用「用户文字 + keywords」联合检索知识库（top 5）
  → 阶段二 审查员（视觉模型）
       输入：图片 + 用户描述 + 观察报告 + 知识库资料 + 交叉验证指令
       输出：最终 JSON（level/summary/analysis/diseases/care/meds/visit/forbid/followUp）
```

- 观察师：`temperature=0.1`、`max_tokens=900`、`timeout=20s`；失败自动换下一个视觉模型，全部失败则跳过观察、直接诊断。
- 审查员：`temperature=0.15`、`max_tokens=1024`（免费视觉模型上限）、`timeout=25s`；`glm-4v-flash` 只保留「第一张图 + 文本」，因此多图场景优先 `glm-4.6v-flash`。
- 图像链路以准确优先，**未逐段检查 52s 预算**；极端情况下两次模型调用可能接近云函数上限。
- 图片仅送模型做观察，不写入知识库、不做图片内容安全校验。

## 4. RAG 私有知识库

### 4.1 数据与播种

| 集合 | 作用 | 关键字段 |
|---|---|---|
| `kb_docs` | 知识条目 | `title`、`content`、`tags`、`seeded`、`v`、`createdAt` |
| `kb_meta` | 播种版本 | `_id: 'seed'`、`version` |

- 种子分两部分：`index.js` 内 `KB_SEEDS_BASE`（v1，178 条）+ `kb_seeds_v4.js` … `kb_seeds_v9.js`（697 条），合计约 875 条。
- `ensureKbSeed()` 在每次问诊时执行：读取 `kb_meta.seed.version`，只写入 `v > 当前版本` 的条目；按标题去重；每批 100 条写入，失败降级逐条；最后把 `version` upsert 为 `KB_SEED_VERSION`（当前 9）。
- 已被管理员删除的种子条目不会因重启而复活（标题去重只针对现存文档，版本已推进）。

### 4.2 检索

```text
tokenize(query)
  ├─ 按空格/中英文标点切词，长度 ≥ 2
  └─ 中文去符号后做 2 字滑窗（bigram），最多 30 个 term
searchKb(query, topN)
  ├─ 分页读取 kb_docs 全量（每页 500）
  ├─ 标题命中 +3，正文命中 +1
  └─ 过滤 0 分，按分数降序取 topN
```

这是轻量关键词检索，不依赖向量库；优点是零额外成本、可解释，缺点是语义召回有限。知识库规模继续增长时，建议改为向量检索或加倒排索引。

### 4.3 管理入口

管理员后台「知识库」Tab 调用 `assistant` 的 `kbList / kbAdd / kbRemove`：

- 仅 `admins` 集合中的 openid 可用。
- 标题 ≤ 40 字、正文 ≤ 2000 字、标签 ≤ 50 字。
- 新增条目不带 `v`，不会被播种逻辑覆盖；删除立即生效。

## 5. 情感分析与提示词

- 规则法：命中「担心、害怕、急、救命、疼、哭、崩溃、严重吗、抽搐、怎么办」等词即判 `anxious`，在 system prompt 中要求先安抚再给建议。
- `buildSystemPrompt` 按场景拼接：
  1. 基础兽医问诊规则（准确性、物种差异、照片与描述矛盾处理、急症判红）；
  2. 图像能力（OCR + 影像观察）；
  3. RAG 资料（`[资料N] 标题 + 正文`）与「图像-资料交叉验证」；
  4. 焦虑安抚；
  5. 纯文本时的工具说明。
- 输出强制 JSON；`parseJson` 会剥离 ```json 代码块并截取首尾花括号，容忍模型多余文字。

### 输出字段

| 字段 | 用途 |
|---|---|
| `level` | `red` 立即就医 / `yellow` 观察或就诊 / `green` 居家护理 |
| `summary` | 一句话结论，前端加 📋 前缀 |
| `analysis` | 客观分析（图片可见体征、缺失信息） |
| `diseases` | 2–4 条「病名 —— 支持依据」 |
| `care` | 3–6 条家庭护理 |
| `meds` | 仅药物**类别**，禁止具体药名/剂量 |
| `visit` | 就医时机、检查项目、告知医生清单 |
| `forbid` | 禁止事项 |
| `followUp` | 最多 3 条追问，前端渲染为「想评估更准确？请补充」 |

`buildContent` 把结构化字段拼成前端展示文本，并固定追加「不能替代执业兽医」免责声明。

## 6. 内容安全

| 范围 | 现状 |
|---|---|
| 问诊问题文本 | `msgSecCheck(version=2, scene=2, openid, content)`，`suggest != pass` 直接拦截 |
| 广场帖子/评论 | `square` 的 `checkText` 同样接入 |
| 接口不可用 | 捕获异常并放行（fail-open），保证演示可用 |
| 图片 | 未做 `mediaCheckAsync` / 图片安全校验 |
| AI 输出 | 未做二次审核 |

上线前需补齐图片与 AI 输出的内容安全，并把 fail-open 改为可观测的降级策略。

## 7. 外部服务与降级

| 依赖 | 失败表现 | 降级 |
|---|---|---|
| 智谱 API | 超时 / HTTP 4xx / 非 JSON | 文本：预算内重试一次；仍失败由前端 `util.aiConsult` 本地规则回复 |
| 智谱 Key 缺失 | 入口直接返回 `ok:false` | 同上，前端本地规则 |
| 观察师模型 | 单模型失败 | 换下一个视觉模型；全失败则跳过观察直接诊断 |
| 审查员模型 | 全部失败 | 抛错 → 前端本地规则 |
| 腾讯位置服务 | 未配 Key / 配额 / 网络 | 返回 `ok:false` → 医院页用演示数据并显示原因 |
| Open-Meteo | 网络失败 | 工具返回 `{ok:false}`，模型基于常识继续回答 |

本地规则 `utils/util.js → aiConsult()`：

- 急症词（呼吸困难、大出血、误食、中毒、抽搐、昏迷、休克、难产、惊厥、瘫痪、排不出尿）→ `red` + 立即就医；
- 呕吐、腹泻、食欲、皮肤、呼吸道、疫苗/驱虫/绝育等 → `yellow` + 结构化建议；
- 图片/视频附件 → 输出「影像初析（模拟）」，明确标注为演示。

## 8. 测试

```bash
npm test
```

`test/assistant-image-flow.test.js` 通过 `Module._load` 拦截 `wx-server-sdk` 与 `https`，在内存中模拟云数据库与模型响应，不发起真实网络请求。当前 7 个用例：

1. 纯图片两阶段：观察师报告 + 关键词 → 知识库注入 → 审查员终判；
2. 观察师首选模型失败 → 回退次级模型；
3. 观察师全部失败 → 跳过观察直接诊断；
4. 关键词无知识库命中 → 不注入资料；
5. 文字 + 图片 → 联合检索知识库；
6. 医院接口不可用 → 返回降级错误；
7. 知识库增量播种：只补新版本、不重复、不复活已删条目、版本推进。

新增用例时复用现有的 `makeDb / loadAssistant / respond` 工具函数，断言模型请求体与最终 `data`，避免依赖真实 API。

## 9. 调优建议

- 想提升回答稳定性：优先补充 `kb_docs`，再调 prompt，最后才换模型。
- 想提升图像准确率：保证 3 张以内、光线充足、患处近景；观察师提示词已要求逐图描述与 OCR。
- 想降低成本：文本链路避免不必要的工具轮次；知识库检索保持在 top 3–5。
- 想支持多轮：在请求中增加 `recentMessages`，并在 `buildContent` 前做长度裁剪；注意 52s 预算。
