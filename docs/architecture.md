# 架构说明

本文描述当前代码的实际结构：页面怎么组织、云函数怎么分工、数据如何流动。产品边界见 [spec.md](../spec.md)，AI 细节见 [ai.md](./ai.md)。

## 1. 总体分层

```text
┌──────────────────────────── 微信小程序 ────────────────────────────┐
│ pages/（26 个页面）                                                │
│   └─ utils/cloud.js  ── 统一 callFunction、超时、{ ok, data, msg } │
│   └─ utils/util.js   ── 日期/校验/提醒元数据/本地规则回复          │
│   └─ utils/history.js── 浏览历史（本地缓存）                       │
└───────────────────────────────┬────────────────────────────────────┘
                                │ wx.cloud.callFunction
┌───────────────────────────────▼────────────────────────────────────┐
│ 云函数（8 个）                                                     │
│  login pet record reminder square admin assistant notify           │
│    ├─ wx-server-sdk ── 云数据库 / 云存储 / openapi                │
│    ├─ 智谱 GLM（assistant）                                        │
│    ├─ 腾讯位置服务（assistant.nearbyHospitals）                    │
│    └─ Open-Meteo（assistant 天气工具）                             │
└───────────────────────────────┬────────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────────┐
│ 云数据库：users pets records reminders sms_codes accounts admins   │
│           square_posts square_reports square_notifications         │
│           kb_docs kb_meta                                          │
│ 云存储：consult/{openid}/...                                       │
└────────────────────────────────────────────────────────────────────┘
```

约定：云函数一律返回 `{ ok: true, data }` 或 `{ ok: false, msg, detail? }`；前端只处理 `data`，错误统一抛 `Error` 并 toast。

## 2. 页面地图

TabBar 三项（`app.json`）：**AI问诊 / 问诊广场 / 我的**。产品规格里的「助手 / 记录 / 我的」三 Tab 未落地，记录入口在「我的」。

| 分组 | 页面 | 说明 |
|---|---|---|
| Tab | `consult/consult` | AI 问诊首页：宠物横滑、拍照/文字入口、急救入口、说明卡 |
| Tab | `square/square` | 问诊广场：大厅 / 精选 / 官方，公告、搜索、消息角标 |
| Tab | `mine/mine` | 我的：用户卡、宠物卡、发布/收藏/点赞/历史、健康计划、记录、医院、设置 |
| 问诊 | `consultForm/consultForm` | 症状拍照表单（类型/患处/病程/瘙痒/食欲/疫苗）→ AI 报告 |
| 问诊 | `chat/chat` | 多会话对话、图片/视频附件、补充问诊、保存记录、发布广场 |
| 记录 | `recordDetail/recordDetail` | 消息流、删除、转提醒、补充问诊 |
| 记录 | `recordsList/recordsList` | 按拍照/文字分类的记录列表 |
| 提醒 | `reminders/reminders` | 健康计划列表与状态操作 |
| 提醒 | `reminderEdit/reminderEdit` | 新建/编辑提醒，请求订阅消息授权 |
| 广场 | `postDetail/postDetail` | 原图、点赞、评论、举报、收藏 |
| 广场 | `topic/topic` | 用户发帖 / 修改待审核帖 |
| 广场 | `searchPosts/searchPosts` | 关键词搜索 |
| 广场 | `myPosts/myPosts` | 我的发布（含审核状态、下架原因） |
| 广场 | `likedPosts/likedPosts` | 我的点赞；`?mode=fav` 为我的收藏 |
| 广场 | `history/history` | 浏览历史（本地） |
| 广场 | `messages/messages` | 互动/审核通知 |
| 宠物 | `addPet/addPet` | 添加/编辑宠物档案 |
| 工具 | `hospitals/hospitals` | 附近医院：定位 + 地图 + 导航/拨号，失败降级 |
| 工具 | `firstaid/firstaid` | 离线急救指南 |
| 工具 | `settings/settings` | 免责声明 / 隐私 / 内容安全 / 关于 |
| 账号 | `login/login` | 微信授权、验证码、账号密码、协议 |
| 账号 | `forgotPassword/forgotPassword` | 忘记密码：验证码校验 → 重置 |
| 账号 | `setPassword/setPassword` | 首次设置密码 / 重置密码 |
| 管理 | `adminLogin/adminLogin` | 管理员账号密码登录 |
| 管理 | `admin/admin` | 账号、帖子、审核、举报、知识库、数据概览 |
| 遗留 | `featured/featured` | 旧精选页，无入口 |

## 3. 云函数职责

### 3.1 `login` — 账号与会话

| action | 关键入参 | 行为 |
|---|---|---|
| `sendCode` | `phone` | 生成 6 位验证码，写 `sms_codes`（5 分钟有效）；**演示环境直接回传** |
| `smsLogin` | `phone, code` | 校验验证码；未设密码返回 `needSetPassword` |
| `checkPhoneRegistered` | `phone` | 查 `accounts` / `users` 是否已注册（找回密码用） |
| `verifyCode` | `phone, code, purpose` | 只校验不消费；`purpose=reset` 时要求已设密码 |
| `setPassword` | `phone, code, password, mode` | 注册/重置密码，写 `accounts`，登录并消费验证码 |
| `wxLogin` | — | 以 openid 建立/登录用户，无需手机号 |
| `updateProfile` | `nickname, avatarUrl` | 更新 `users` |
| `accountLogin` | `username, password` | 账号密码登录（账号由管理员创建，或验证码首次登录时设置密码生成） |
| `adminLogin` | `username, password` | 管理员登录；首次 `admin/Admin@123456` 自动播种到 `admins` |

密码规则：8–14 位、同时含英文与数字；`sha256(salt + '|' + password)` 存储。

### 3.2 `pet` / `record` / `reminder`

| 云函数 | action |
|---|---|
| `pet` | `list`、`count`、`get`、`add`、`update`、`remove`；`add` 服务端强制 5 只上限 |
| `record` | `list`、`get`、`add`、`rename`、`markPublished`、`update`、`remove` |
| `reminder` | `list`、`get`、`add`、`update`、`complete`、`skip`、`reopen`、`remove` |

`reminder` 细节：类型 `vaccine / deworm_in / deworm_out / recheck / medication / custom`；周期 `none / monthly / quarterly / yearly`；`list` 时把过期待办懒更新为 `expired`；`complete/skip` 后周期提醒自动排下一次（按月末对齐，`rootId` 去重）。

### 3.3 `square` — 问诊广场

| 分组 | action |
|---|---|
| 读 | `list`（`feed=recommend/latest`）、`search`、`featured`、`officialList`、`get`、`mylist`、`likedList`、`favlist` |
| 互动 | `like`、`comment`、`deleteComment`、`report` |
| 发布 | `publish`（进入 `pending`）、`editPost`（重新进审核）、`remove` |
| 通知 | `notifications`、`readNotifications`、`unread` |
| 管理 | `amIAdmin`、`adminPosts`、`adminPendingList`、`adminAudit`、`adminRemove`、`adminPublishOfficial`、`adminReports`、`adminHandleReport` |

- 用户发帖 `audit=pending`，管理员 `approved` 后才进大厅；被举报下架置 `rejected` 并写 `rejectReason`，不物理删除。
- `featured` / `officialList` 在缺少演示数据时会自动补齐，保证页面有内容。
- 文本内容经 `msgSecCheck`（`checkText`）校验，接口异常时放行。

### 3.4 `admin` — 后台

| action | 说明 |
|---|---|
| `isAdmin` | 当前 openid 是否在 `admins` |
| `addAccount` / `listAccounts` / `removeAccount` | 管理普通账号（手机号 + 密码） |
| `stats` | `users / pets / records / square_posts` 计数 + 最近 10 个用户 |

### 3.5 `assistant` — AI 与外部服务

| action | 说明 |
|---|---|
| 默认（无 action） | AI 问诊：文字 Agent / 图片两阶段诊断，见 [ai.md](./ai.md) |
| `nearbyHospitals` | 腾讯位置服务检索 5km 内「宠物医院」，环境变量 Key 失败时用本地 Key 重试 |
| `kbList` / `kbAdd` / `kbRemove` | RAG 知识库管理，仅 `admins` 可用 |

### 3.6 `notify` — 订阅消息

- `config.json` 已配置每天 9:00 的定时触发器（`0 0 9 * * * *`）与 `subscribeMessage.send` 权限。
- 扫描 `reminders` 中 `dueAt` 在 ±24 小时内且未推送的记录，发送后置 `notified: true`。
- 模板 ID 为空时跳过并返回 `skipped`，因此当前实际提醒仍以应用内为主。

## 4. 鉴权模型

| 身份 | 凭证 | 存储 | 作用域 |
|---|---|---|---|
| 普通用户 | 微信 openid（云函数 `getWXContext`） | `users._openid` | 自己的宠物、记录、提醒 |
| 账号 | 手机号 + 密码 | `accounts`（`passwordHash + salt`） | 登录后绑定到当前 openid |
| 管理员 | 账号 + 密码 | `admins`（`_openid` 绑定首次登录者） | 后台、审核、知识库 |

- 管理端登录态与普通登录态分开：`app.globalData.adminInfo` 与 `pet_admin` 缓存；普通用户是 `userInfo` 与 `pet_user`。
- 数据隔离：业务集合均带 `_openid`，查询与更新同时匹配 `_openid + _id`，避免越权。
- 广场管理员判定：`square` 先查硬编码 `ADMIN_OPENIDS`，再查 `admins` 集合（兼容两套）。上线前建议移除硬编码白名单。
- 前端需登录的操作统一走 `app.requireLogin()`；首页另有 `ensureLogin()` 弹窗引导。

## 5. 关键数据流

### 5.1 文字问诊

```text
consult → chat?mode=text → 输入/快捷问题 → send()
  → 上传图片（如有）到云存储
  → cloud.assistantAsk(question, petProfile, fileIDs)（超时 55s）
  → assistant：校验 Key → msgSecCheck → 下载图片 → RAG 检索 → 情感分析
       → 文本 Agent（get_weather / search_kb，最多 3 轮）→ JSON
  → chat 渲染 level/summary/content/followUp
  → saveRecord()：record.add / record.update
  → 失败：util.aiConsult() 本地规则兜底
```

### 5.2 拍照问诊

```text
consult → consultForm → 填写结构化表单 + 拍照（最多 3 张）
  → 上传云存储 → assistantAsk(结构化描述, pet, fileIDs)
  → assistant：观察师（OCR + 影像观察，输出 keywords/report）
       → 用「描述 + keywords」二次检索知识库
       → 审查员结合图片 + 观察报告 + 知识库输出最终 JSON
  → 报告页展示；addRecord 保存（consultType=photo）
  → 「补充问诊」把上下文挂到 app._supplementContext → chat
```

### 5.3 广场发布与审核

```text
chat/记录详情/topic → square.publish（脱敏字段）→ audit=pending
  → 管理员 admin.adminPendingList → adminAudit(approved/rejected)
  → 写 square_notifications 通知作者
  → approved 进入大厅 / 精选可见范围
  → 举报 → square_reports(pending) → adminHandleReport（可置 rejected 下架）
```

### 5.4 提醒推送

```text
reminderEdit → requestSubscribeMessage（模板 ID 非空时）
  → reminder.add（status=pending, notifiedAt=0）
  → 每天 9:00 notify 定时触发
  → 查 dueAt ∈ [now-24h, now+24h) 且 notified != true
  → subscribeMessage.send → notified=true（失败记日志，43101 视为未订阅）
```

### 5.5 附近医院

```text
hospitals.onShow → wx.getLocation(gcj02, 高精度)
  → cloud.nearbyHospitals(lat,lng)（15s 超时）
  → assistant 腾讯 POI（5km，page_size=20）
  → 前端哈弗辛公式算距离并排序
  → 失败/无结果：演示数据 + errMsg + demoMode 提示
```

## 6. 约定与扩展点

- **新增页面**：在 `app.json.pages` 注册；新增 Tab 还要补 `images/tabbar/` 图标并改 `tabBar.list`。
- **新增云函数**：放到 `cloudfunctions/<name>/`，带 `package.json`；前端在 `utils/cloud.js` 增加封装。
- **新增集合**：云函数内先 `createCollection` 容错创建；所有用户数据带 `_openid`。
- **环境 ID**：只出现在 `miniprogram/config.js`，不要在页面里硬编码。
- **错误协议**：不要直接抛裸对象；保持 `{ ok, msg, detail }`，前端才能统一提示。
- **AI 输出**：保持 `level / summary / content / followUp` 四字段，前端渲染依赖它。

## 7. 相关文档

- [AI 实现](./ai.md)
- [数据模型](./data-model.md)
- [部署与运维](./deploy.md)
- [产品规格](../spec.md)
