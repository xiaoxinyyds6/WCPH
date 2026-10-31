# 部署与运维

从零把项目跑起来、上线前要补的配置，以及常见故障的排查顺序。功能清单见 [README](../README.md)，代码结构见 [04-technical.md](./04-technical.md)。

## 1. 前置条件

| 项 | 要求 |
|---|---|
| 微信开发者工具 | 稳定版，基础库 `3.17.3`（与 `project.config.json` 一致） |
| 小程序 AppID | `wxee9d6c9598f84391`（或替换为你自己的） |
| 云开发 | 已开通，环境 ID 默认 `ai-d5gc65qrdab971a09` |
| Node.js | 本地跑 `npm test` / `npm run lint` 用，建议 16+ |
| 智谱开放平台 | 用于 AI 问诊，需 `ZHIPU_API_KEY` |
| 腾讯位置服务 | 可选，用于「附近宠物医院」真实 POI |

## 2. 环境与项目配置

1. 微信开发者工具 → 导入项目 → 选择仓库根目录。
2. 确认 `project.config.json` 的 `appid` 与 `miniprogramRoot` / `cloudfunctionRoot`。
3. 打开 `miniprogram/config.js`，把 `envId` 改成你的云环境 ID。**环境 ID 只允许出现在这里。**
4. 若使用自己的 AppID，还需要在公众平台配置：合法域名（本项目全部走云函数，通常无需额外 request 域名）、隐私协议、用户信息用途。

## 3. 部署云函数

需部署 8 个（均右键 → **「上传并部署：云端安装依赖」**）：

| 云函数 | 依赖 | 说明 |
|---|---|---|
| `login` | `wx-server-sdk` | 登录、验证码、密码、管理员登录 |
| `pet` | `wx-server-sdk` | 宠物 CRUD |
| `record` | `wx-server-sdk` | 问诊记录 |
| `reminder` | `wx-server-sdk` | 健康提醒 |
| `square` | `wx-server-sdk` | 广场与审核 |
| `admin` | `wx-server-sdk` | 管理员后台 |
| `assistant` | `wx-server-sdk` | AI、RAG、医院 POI |
| `notify` | `wx-server-sdk` | 订阅消息定时推送 |

注意事项：

- `assistant/config.json` 已设置 `timeout: 60`，不要改成更小值；图像两阶段诊断耗时接近上限。
- `notify/config.json` 已声明 `subscribeMessage.send` 权限和每天 9:00 的定时触发器。部署后**右键 `notify` → 上传触发器**，否则定时任务不会生效。
- 云函数间不需要互相调用，均通过 `wx-server-sdk` 访问同一环境。

## 4. 环境变量

### 4.1 `ZHIPU_API_KEY`（必需）

云开发控制台 → 云函数 → `assistant` → 配置 → 环境变量 → 添加：

```text
ZHIPU_API_KEY = 你的智谱 API Key
```

`.env` 不参与本项目；`cloudfunctions/assistant/config.json` 里的 `envVariables` 只是占位示例，**不要在仓库里提交真实 Key**。未配置时 `assistant` 会返回：

```text
云函数未读取到 ZHIPU_API_KEY
```

前端此时会降级到本地规则回复。

### 4.2 `TENCENT_MAP_KEY`（可选）

用于「附近宠物医院」：

1. 在[腾讯位置服务](https://lbs.qq.com/)创建应用，开通 **WebService API**，获取 Key。
2. 云开发控制台 → `assistant` → 环境变量 → `TENCENT_MAP_KEY`。
3. 或本地开发时在 `cloudfunctions/assistant/tencent_key.js` 写入：

```js
module.exports = { key: '你的腾讯位置服务 Key' }
```

该文件已被 `.gitignore` 忽略。云函数会优先用环境变量，失败时再用本地文件重试一次。

未配置时医院页不会白屏：会展示演示数据，并在页面提示失败原因。

## 5. 管理员初始化

### 5.1 首次登录

1. 小程序登录页 → 底部「管理员登录」→ `admin / Admin@123456`。
2. `login` 云函数会在 `admins` 集合创建记录，并把 `_openid` 绑定到**当前微信**。
3. 之后该微信即为管理员；再次进入从登录页「管理员登录」进入后台（管理员登录态本地保留）。

### 5.2 修改默认口令（上线必做）

后台没有「修改管理员密码」页面；而 `adminLogin` 只在 `admins` 中**查不到账号时**才用 `DEFAULT_ADMIN` 播种。因此：

> 默认口令一旦播种成功，只改常量不会改变已写入数据库的密码。

**场景 A：还没用默认口令首次登录（推荐）**

1. 先把 `cloudfunctions/login/index.js` 顶部改成自己的账号与强密码：

```js
const DEFAULT_ADMIN = { username: '你的管理员账号', password: '你的强密码' }
```

2. 重新部署 `login`，用新账号首次登录完成播种。
3. 播种成功后，把 `DEFAULT_ADMIN` 改成随机不可用值（或删除自动播种分支）并再次部署，避免默认账号被再次创建。已有管理员记录不受影响。

**场景 B：已经用 `admin / Admin@123456` 登录过**

1. 云开发控制台 → 数据库 → `admins`，删除 `username: admin` 的记录（会同时解绑该 openid）。
2. 按场景 A 改成新账号密码 → 部署 `login`。
3. 用新账号重新登录，完成播种。
4. 再把 `DEFAULT_ADMIN` 改为随机值并重新部署。

**场景 C：直接改库（不重新播种）**

用 Node 生成新的 `salt` 与 `passwordHash`，更新 `admins` 记录：

```bash
node -e "const c=require('crypto');const salt=c.randomBytes(8).toString('hex');const p='新密码';console.log('salt:',salt);console.log('passwordHash:',c.createHash('sha256').update(salt+'|'+p).digest('hex'))"
```

把输出写回 `admins` 对应记录的 `salt` / `passwordHash` 字段即可。注意生产环境不要用默认账号长期保留。

### 5.3 广场管理员白名单

`cloudfunctions/square/index.js` 顶部仍有：

```js
const ADMIN_OPENIDS = ['o6oL4xUswvY3jsbrfMFNKiziEg4I']
```

这是早期 openid 白名单，与 `admins` 集合并存。上线前建议：

- 删除该硬编码数组，或改成空数组；
- 统一用「管理员登录 → `admins` 集合」判定权限。

## 6. 数据库集合与索引

集合会在云函数首次调用或首次写入时创建；若控制台未自动创建（尤其是 `square_reports`、`square_notifications`），手动新建同名集合即可：

```text
users accounts admins sms_codes
pets records reminders
square_posts square_reports square_notifications
kb_docs kb_meta
```

建议在控制台手动补组合索引（详见 [data-model.md](./data-model.md#7-索引建议)）：

| 集合 | 索引 |
|---|---|
| `records` | `_openid` + `createdAt`（降序） |
| `pets` | `_openid` + `createdAt`（升序） |
| `reminders` | `_openid` + `dueAt`；`dueAt` + `notified` |
| `square_posts` | `audit` + `createdAt`；`_openid` + `createdAt` |
| `square_notifications` | `_openid` + `read` + `createdAt` |
| `square_reports` | `status` + `createdAt` |
| `accounts` / `admins` | `username`（唯一） |

权限：小程序端不直接读数据库，所有集合可设为 **「所有用户不可读写」**；云函数使用管理员权限访问，不受影响。

## 7. 订阅消息

当前代码已预留完整链路，但模板 ID 为空，默认只做应用内提醒。

1. 公众平台 → 功能 → 订阅消息 → 选用「提醒」类模板（字段需包含提醒内容与时间）。
2. 记下模板 ID 与字段名（如 `thing1`、`time2`）。
3. 两处同步填写：

```js
// cloudfunctions/notify/index.js
const TEMPLATE_ID = '你的模板ID'

// miniprogram/pages/reminderEdit/reminderEdit.js
const REMIND_TPL_ID = '你的模板ID'
```

4. 按模板字段调整 `notify` 中 `data` 的 key；字段名不一致会导致 `47003` 类错误。
5. 重新部署 `notify` 与小程序；在提醒编辑页首次保存时会调用 `wx.requestSubscribeMessage`。
6. 确认定时触发器已上传（每天 9:00），也可手动调用 `notify` 并在 `event` 传 `{ "action": "run" }` 补发。

行为说明：

- 扫描 `dueAt ∈ [now-24h, now+24h)` 且 `notified != true` 的提醒；
- 发送成功置 `notified: true`；
- `43101` 表示用户未订阅/订阅过期，属正常，不重试。

## 8. 内容安全

- `assistant`（问诊文本）与 `square`（帖子/评论）调用 `cloud.openapi.security.msgSecCheck`，失败时 **fail-open**。
- 若云函数调用 openapi 报权限错误，在对应云函数目录补 `config.json`：

```json
{
  "permissions": {
    "openapi": ["security.msgSecCheck"]
  }
}
```

然后重新部署。上线前还应补：

- 图片/视频 `mediaCheckAsync`；
- AI 输出二次审核；
- fail-open 的可观测告警（记录被放行的次数与原因）。

## 9. 常见故障排查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 「云函数调用失败」 | 未部署 / 环境 ID 不一致 | 确认 8 个函数都在同一环境，检查 `miniprogram/config.js` |
| 「云函数未读取到 ZHIPU_API_KEY」 | 环境变量缺失或未重新部署 | 在控制台添加后重新部署 `assistant` |
| AI 一直降级本地回复 | Key 无效、额度用尽、模型超时 | 看 `assistant` 日志；检查智谱额度与模型名 |
| 图像问诊超时 | 两阶段耗时接近 60s | 减少图片数量/压缩；保持 `timeout: 60` |
| 医院页显示演示数据 | Key 未配、配额、参数错误 | 看页面 `errMsg`；腾讯错误码 110/112/113/121/311 多为 Key/配额/权限 |
| 订阅消息不推送 | 模板未填、触发器未上传、用户未订阅 | 检查两处模板 ID、上传触发器、确认 `43101` 日志 |
| 管理员提示无权限 | 当前 openid 不在 `admins` | 用首次绑定的微信登录；或控制台检查 `_openid` |
| 验证码登录无反应 | `sendCode` 失败 / 手机号格式 | 看 `login` 日志；确认 11 位手机号 |
| 帖子发布后大厅看不到 | 审核未通过 | 管理后台「审核」通过；作者可在「我的发布」看状态 |
| 图片上传失败 | 云存储权限/配额 | 检查云存储与云函数配额 |

日志入口：云开发控制台 → 云函数 → 选择函数 → 日志；前端错误可在开发者工具 Console 查看 `[cloud]` 前缀。

## 10. 上线检查清单

- [ ] `miniprogram/config.js` 使用生产环境 ID
- [ ] 8 个云函数已部署，`assistant` 超时 60s
- [ ] `ZHIPU_API_KEY` 已配置，且未写入仓库
- [ ] `TENCENT_MAP_KEY` 已配置或明确接受医院演示数据
- [ ] 默认管理员口令已替换，`DEFAULT_ADMIN` 已失效
- [ ] `square` 的 `ADMIN_OPENIDS` 已移除或收敛
- [ ] 订阅消息模板 ID 两处一致，定时触发器已上传
- [ ] 数据库组合索引已创建
- [ ] 集合权限设为「所有用户不可读写」
- [ ] 验证码改为真实短信，移除 `sendCode` 回传字段
- [ ] 图片/AI 输出内容安全已补齐
- [ ] 隐私协议、免责声明、用户信息用途已在公众平台配置
- [ ] `npm test` 通过，真机走通登录 → 建档 → 问诊 → 记录 → 提醒 → 广场主链路

## 11. 本地检查

```bash
npm test                        # 无需安装依赖：assistant 图像两阶段流程
npm install && npm run lint     # 可选；ESLint 模板配置较旧，可按需调整
```

单测不访问网络：`test/assistant-image-flow.test.js` 会 mock `wx-server-sdk` 与 `https`。修改 AI 链路后先跑一遍，再部署。
