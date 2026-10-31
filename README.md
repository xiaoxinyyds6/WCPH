# AI 宠物助手（微信小程序）

基于微信云开发的养宠助手：以宠物档案为底座，用多模态大模型承接日常咨询与症状初判，把每次交流沉淀为可回溯的健康记录，并用提醒、问诊广场、急救指南与附近医院把「知道」变成「做到」。

> 项目状态：功能可演示，尚未正式上线。产品规格见 [spec.md](./spec.md)，技术细节见 [`docs/`](./docs/)。

## 核心能力

- **AI 问诊**：文字问诊 + 症状拍照问诊（最多 3 张图），支持图片、视频留证与报告后「补充问诊」；急症优先判红并给出就医指引，模型不可用时自动回退本地规则回复。
- **宠物档案**：最多 5 只，头像（相册 / emoji）、分类-品种联动、性别、生日、体重、绝育、驱虫、疫苗；服务端双重校验上限。
- **问诊记录**：一次问诊一个「档案袋」，支持多会话、重命名、详情回看、删除，以及把脱敏记录一键发布到广场。
- **健康计划**：疫苗、体内/体外驱虫、复诊、用药、自定义六类提醒；周期提醒完成后自动排下一次，待办 / 已完成 / 已跳过 / 已过期流转。
- **问诊广场**：大厅、精选好帖、官方好帖三栏；搜索、点赞、收藏、评论、举报、消息通知；用户发帖先审核后展示，支持我的发布 / 点赞 / 收藏 / 历史浏览。
- **辅助工具**：离线宠物急救指南、按定位检索附近宠物医院（腾讯位置服务，失败降级演示数据）、设置与协议。
- **账号与后台**：微信授权、手机验证码、账号密码、找回 / 设置密码；管理员账号体系与后台（账号管理、帖子审核、举报处理、知识库、数据概览）。

## 技术架构

```text
微信小程序（原生 WXML / WXSS / JS）
  └─ utils/cloud.js ── 云函数调用（统一 { ok, data, msg }）
       ├─ login / pet / record / reminder / square / admin
       ├─ assistant ── 智谱 GLM（文本 Agent + 视觉两阶段诊断）
       │                ├─ RAG 私有知识库（kb_docs / kb_meta）
       │                ├─ Open-Meteo 天气工具
       │                └─ 腾讯位置服务 POI（附近医院）
       └─ notify ── 定时触发器（每天 9:00）→ 订阅消息推送
  └─ 云数据库 / 云存储
```

- **鉴权**：普通用户以微信 `openid` 隔离数据；账号密码登录绑定到 `accounts`；管理员身份存于 `admins` 集合，与普通登录态分离。
- **降级**：大模型失败 → 前端本地规则；医院检索失败 → 演示数据；内容安全接口不可用 → 放行（fail-open）。

## 技术栈

| 层 | 选型 |
|---|---|
| 小程序 | 原生框架，基础库 `3.17.3`（见 `project.config.json`） |
| 后端 | 微信云开发：云函数 + 云数据库 + 云存储，Node.js + `wx-server-sdk` |
| 大模型 | 智谱 GLM：`glm-4-flash`（文本 Agent）、`glm-4.6v-flash` → `glm-4v-flash`（视觉） |
| 外部服务 | 腾讯位置服务（POI）、Open-Meteo（天气） |
| 测试 | Node.js `assert` + 模块 mock 的离线单测 |

## 仓库结构

```text
miniprogram/
  app.js / app.json / app.wxss     # 全局逻辑、页面与 tabBar、全局样式
  config.js                        # 云开发环境 ID（唯一来源）
  utils/
    cloud.js                       # 云函数封装与统一错误处理
    util.js                        # 日期、校验、提醒元数据、本地规则回复
    petDict.js                     # 分类-品种字典
    history.js                     # 浏览历史本地存储
  images/tabbar/                   # tabBar 图标
  assets/marker.png                # 地图标记
  pages/
    consult/ consultForm/ chat/    # 问诊首页、拍照表单、对话
    recordDetail/ recordsList/     # 记录详情与分类列表
    reminders/ reminderEdit/       # 健康计划与提醒编辑
    square/ postDetail/ topic/     # 广场、帖子详情、发帖/编辑
    searchPosts/ myPosts/          # 搜索、我的发布
    likedPosts/ history/ messages/ # 点赞/收藏、浏览历史、通知
    hospitals/ firstaid/ settings/ # 附近医院、急救指南、协议
    mine/ addPet/                  # 我的、宠物档案
    login/ forgotPassword/ setPassword/
    admin/ adminLogin/             # 管理员后台与登录
    featured/                      # 遗留精选页（无入口，保留代码）
cloudfunctions/
  login/ pet/ record/ reminder/    # 账号、宠物、记录、提醒
  square/ admin/                   # 广场、管理员
  assistant/                       # 大模型代理 + RAG + 工具调用
    kb_seeds_v4.js … v9.js         # 知识库增量种子
  notify/                          # 订阅消息定时推送
test/
  assistant-image-flow.test.js     # 图像问诊两阶段流程离线单测
docs/                              # 架构、AI、数据模型、部署
spec.md                            # 产品规格（as-built）
```

## 快速开始

1. 用[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)导入仓库根目录，确认 AppID 与云环境（`project.config.json`、`miniprogram/config.js`，默认 `ai-d5gc65qrdab971a09`）。
2. 在云开发控制台部署全部 8 个云函数：`login`、`pet`、`record`、`reminder`、`square`、`admin`、`assistant`、`notify`，均选 **「上传并部署：云端安装依赖」**。
3. 配置 `assistant` 环境变量 `ZHIPU_API_KEY`（智谱开放平台）；如需附近医院，再配 `TENCENT_MAP_KEY`（腾讯位置服务）。
4. 初始化管理员：登录页 → 「管理员登录」→ 首次用 `admin / Admin@123456` 自动创建并绑定当前微信；上线前必须按 [docs/deploy.md](./docs/deploy.md#52-修改默认口令上线必做) 替换默认口令。
5. 编译运行。数据库集合会按需自动创建；若控制台提示某集合不存在，手动新建即可。建议补 `reminders` 的 `_openid + dueAt` 索引。

订阅消息、索引、权限与排障的完整步骤见 [docs/deploy.md](./docs/deploy.md)。

## 数据集合速览

| 分组 | 集合 |
|---|---|
| 用户与账号 | `users`、`accounts`、`admins`、`sms_codes` |
| 宠物与问诊 | `pets`、`records` |
| 健康提醒 | `reminders` |
| 问诊广场 | `square_posts`、`square_reports`、`square_notifications` |
| 知识库 | `kb_docs`、`kb_meta` |

字段、索引与隔离方式见 [docs/data-model.md](./docs/data-model.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/architecture.md](./docs/architecture.md) | 页面地图、云函数职责、鉴权模型、关键数据流 |
| [docs/ai.md](./docs/ai.md) | 文本 Agent、图像两阶段诊断、RAG、降级与测试 |
| [docs/data-model.md](./docs/data-model.md) | 集合字段、索引、敏感数据与写入方 |
| [docs/deploy.md](./docs/deploy.md) | 环境变量、部署、管理员、订阅消息、排障 |
| [spec.md](./spec.md) | 产品规格与实现边界（as-built） |

## 测试

```bash
npm test                        # 无需安装依赖；图像问诊两阶段流程离线单测
npm install && npm run lint     # 可选；ESLint 模板配置较旧，可按需调整
```

## 已知限制

- **短信验证码为演示实现**：`login` 云函数直接回传验证码供页面展示；生产环境需接入短信服务商并移除回传字段。
- **订阅消息待模板**：`notify` 云函数与每天 9:00 定时触发器已就绪，但模板 ID 为空；填入 `cloudfunctions/notify/index.js` 与 `pages/reminderEdit/reminderEdit.js` 后才会真正推送，当前仅应用内提醒。
- **内容安全为 fail-open**：问诊文本、帖子、评论接入 `msgSecCheck`，接口不可用时放行；图片与 AI 输出尚未校验。
- **默认管理员口令**：`admin / Admin@123456` 仅用于首次播种，上线前必须修改；`cloudfunctions/square/index.js` 仍保留 `ADMIN_OPENIDS` 遗留白名单，建议统一到 `admins` 集合。
- **AI 边界**：仅提供初步评估，不出诊断结论、不开处方、不给具体剂量；急症请立即就医。
- **本地状态**：收藏、不感兴趣、浏览历史存于本地缓存；更换设备不同步。
- **测试覆盖**：仅 assistant 图像流程有单测，无 UI 自动化测试。
- **遗留页面**：`pages/featured` 无入口，仅保留历史代码。

## License

[MIT](./LICENSE)
