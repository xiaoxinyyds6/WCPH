# 数据模型

所有数据存于微信云数据库。主要集合由云函数按需创建；`square_reports`、`square_notifications` 在首次举报/通知写入时创建。若控制台提示集合不存在，手动新建即可。小程序端不直接访问数据库，全部经云函数读写，因此集合权限可统一设为 **「所有用户不可读写」**（云函数不受该权限限制）。

## 1. 集合总览

| 集合 | 用途 | 写入方 | 隔离键 |
|---|---|---|---|
| `users` | 用户资料 | `login` | `_openid` |
| `accounts` | 手机号账号与密码 | `login`、`admin` | `username` |
| `admins` | 管理员账号 | `login`、`admin` | `_openid` / `username` |
| `sms_codes` | 验证码（演示） | `login` | `_openid` |
| `pets` | 宠物档案 | `pet` | `_openid` |
| `records` | 问诊会话与消息 | `record` | `_openid` |
| `reminders` | 健康提醒 | `reminder`、`notify` | `_openid` |
| `square_posts` | 广场帖子 | `square` | `_openid` |
| `square_reports` | 举报记录 | `square` | `reporter` |
| `square_notifications` | 广场通知 | `square` | `_openid`（接收者） |
| `kb_docs` | RAG 知识条目 | `assistant` | 全局 |
| `kb_meta` | 知识库播种版本 | `assistant` | 全局 |

## 2. 用户与账号

### 2.1 `users`

| 字段 | 类型 | 说明 |
|---|---|---|
| `_openid` | string | 微信 openid，用户唯一标识 |
| `phone` | string | 手机号，可为空（纯微信登录） |
| `nickname` | string | 昵称，默认「微信用户XXXX」/「宠物用户XXXX」 |
| `avatarUrl` | string | 头像 |
| `accountId` | string | 关联的 `accounts._id`（可选） |
| `username` | string | 账号密码登录时使用 |
| `loginType` | string | `wx` / `sms` / `account` / `passwordReset` |
| `createdAt` / `updatedAt` / `lastLoginAt` | number | 毫秒时间戳 |

### 2.2 `accounts`

| 字段 | 类型 | 说明 |
|---|---|---|
| `_openid` | string | 注册时的 openid（仅首次设置密码写入） |
| `username` | string | 11 位手机号，登录账号 |
| `phone` | string | 手机号（冗余） |
| `passwordHash` | string | `sha256(salt + '\|' + password)` |
| `salt` | string | 16 位随机盐 |
| `nickname` | string | 昵称 |
| `createdAt` / `updatedAt` | number | 时间戳 |

密码规则：8–14 位、同时含英文与数字。`listAccounts` 不返回 `passwordHash` 与 `salt`。

### 2.3 `admins`

| 字段 | 类型 | 说明 |
|---|---|---|
| `_openid` | string | 首次管理员登录时绑定当前微信 |
| `username` | string | 管理员账号 |
| `passwordHash` / `salt` | string | 同 `accounts` |
| `createdAt` | number | 时间戳 |

首次用 `admin / Admin@123456` 登录会自动创建并绑定 openid；之后该 openid 即拥有管理员权限。`square` 另有一套 `ADMIN_OPENIDS` 硬编码白名单，属于遗留逻辑。

### 2.4 `sms_codes`

| 字段 | 类型 | 说明 |
|---|---|---|
| `_openid` / `phone` | string | 请求验证码的用户与手机号 |
| `code` | string | 6 位验证码 |
| `expireAt` | number | 5 分钟有效期 |

**演示实现**：验证码由 `sendCode` 直接回传前端展示，生产环境需改为短信下发并移除回传。

## 3. 宠物与问诊

### 3.1 `pets`

| 字段 | 类型 | 说明 |
|---|---|---|
| `_openid` | string | 所属用户 |
| `name` | string | 名字（必填） |
| `avatar` | string | 云存储 fileID 或 emoji |
| `category` / `breed` | string | 分类 / 品种（前端联动字典） |
| `gender` | string | 性别 |
| `birthDate` | string | `YYYY-MM-DD`，前端实时算年龄 |
| `weight` | number | 体重 kg |
| `neutered` | string | 绝育状态 |
| `body` | string | 体型/备注 |
| `dewormed` | string | 驱虫情况 |
| `vaccinated` | string | 疫苗情况 |
| `createdAt` / `updatedAt` | number | 时间戳 |

服务端强制每个 openid 最多 5 只（`add` 时 `count` 校验）。

### 3.2 `records`

| 字段 | 类型 | 说明 |
|---|---|---|
| `_openid` | string | 所属用户 |
| `petId` / `petName` / `petAvatar` | string | 关联宠物快照 |
| `title` | string | 会话名，默认「问诊记录N」，≤ 20 字 |
| `messages` | array | 消息流，见下 |
| `consultType` | string | `photo` / `text`（旧记录为空，列表按消息推断） |
| `published` | boolean | 是否已发布到广场 |
| `squarePostId` | string | 对应 `square_posts._id` |
| `createdAt` / `updatedAt` | number | 时间戳 |

`messages[]`：

```js
{
  role: 'user' | 'ai',
  content: string,
  time: string,          // 展示用 HH:mm
  level: '' | 'red' | 'yellow' | 'green',
  images: string[],      // 云存储 fileID
  video: string          // 云存储 fileID（仅保存展示，不送模型）
}
```

一次问诊 = 一条 `records` 文档（「档案袋」）；继续对话时 `update` 覆盖 `messages`。

## 4. 健康提醒

### 4.1 `reminders`

| 字段 | 类型 | 说明 |
|---|---|---|
| `_openid` | string | 所属用户 |
| `petId` / `petName` | string | 关联宠物 |
| `type` | string | `vaccine` / `deworm_in` / `deworm_out` / `recheck` / `medication` / `custom` |
| `title` | string | 提醒内容，≤ 30 字 |
| `dueAt` | number | 到期时间戳 |
| `repeat` | string | `none` / `monthly` / `quarterly` / `yearly` |
| `status` | string | `pending` / `done` / `skipped` / `expired` |
| `rootId` | string | 周期提醒链的根记录 id |
| `notifiedAt` | number | 修改到期时间时重置为 0（供后续扩展） |
| `notified` | boolean | `notify` 推送成功后置 `true` |
| `createdAt` / `updatedAt` | number | 时间戳 |

- `list` 时把「`pending` 且 `dueAt` 早于今天零点」懒更新为 `expired`。
- `complete` / `skip` 后按周期自动创建下一条（月末对齐，`rootId + dueAt` 去重）。
- `notifiedAt` 与 `notified` 并存是历史原因：前者由 `reminder` 维护，后者由 `notify` 维护，后续可合并。

## 5. 问诊广场

### 5.1 `square_posts`

| 字段 | 类型 | 说明 |
|---|---|---|
| `_openid` | string | 作者（演示/官方为 `demo` / `official`） |
| `petKind` / `petBreed` / `part` | string | 物种 / 品种 / 部位标签 |
| `title` / `excerpt` | string | 标题 ≤ 40、摘要 ≤ 120 |
| `image` | string | 缩略图 fileID |
| `recordId` | string | 来源问诊记录 |
| `audit` | string | `pending` / `approved` / `rejected` |
| `rejectReason` | string | 下架/驳回原因 |
| `auditedAt` / `auditedBy` | number/string | 审核时间与管理员 openid |
| `likes` | string[] | 点赞者 openid 列表 |
| `likeCount` | number | 点赞数（冗余） |
| `lastLikeAt` | number | 最近点赞时间，精选页并列排序用 |
| `comments` | array | `{ commentId, _openid, content, createdAt }` |
| `official` | boolean | 官方好帖 |
| `demo` / `featuredDemo` / `demoKey` | boolean/string | 精选演示数据标记 |
| `fromConsult` | boolean | 来自问诊 |
| `createdAt` | number | 时间戳 |

- 用户发帖 `audit=pending`，管理员通过后才进入大厅。
- 举报下架置 `audit=rejected` 并写 `rejectReason`，不物理删除。
- 官方/精选种子在集合为空时自动写入，`demoKey` 保证幂等。

### 5.2 `square_reports`

| 字段 | 类型 | 说明 |
|---|---|---|
| `postId` / `postTitle` | string | 被举报帖子 |
| `commentId` | string | 被举报评论（可空） |
| `type` | string | 广告营销 / 辱骂攻击 / 虚假信息 / 虐宠内容 / 其他 |
| `reason` | string | 补充说明，≤ 200 字 |
| `reporter` | string | 举报人 openid |
| `status` | string | `pending` / `handled` |
| `handledAt` / `removed` | number/boolean | 处理时间与是否下架 |
| `createdAt` | number | 时间戳 |

### 5.3 `square_notifications`

| 字段 | 类型 | 说明 |
|---|---|---|
| `_openid` | string | 接收者 |
| `fromOpenid` | string | 触发者 |
| `type` | string | `like` / `comment` / `audit` |
| `postId` / `postTitle` | string | 相关帖子 |
| `content` | string | 通知正文，≤ 120 字 |
| `read` | boolean | 是否已读 |
| `createdAt` | number | 时间戳 |

自己操作自己的帖子不产生通知；审核/下架通知用 `force` 强制发送。

## 6. 知识库

### 6.1 `kb_docs`

| 字段 | 类型 | 说明 |
|---|---|---|
| `title` | string | 标题 ≤ 40 字，用于去重与检索 |
| `content` | string | 正文 ≤ 2000 字 |
| `tags` | string | 空格分隔标签，≤ 50 字 |
| `seeded` | boolean | 是否内置种子 |
| `v` | number | 种子版本（1、4–9） |
| `createdAt` | number | 时间戳 |

### 6.2 `kb_meta`

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | 固定为 `seed` |
| `version` | number | 已播种到的版本，当前 9 |

## 7. 索引建议

云数据库默认单字段索引足够小数据量；以下组合索引用于列表查询，建议在控制台手动创建：

| 集合 | 索引字段 | 用途 |
|---|---|---|
| `records` | `_openid` + `createdAt`（降序） | 记录列表 |
| `pets` | `_openid` + `createdAt`（升序） | 宠物列表 |
| `reminders` | `_openid` + `dueAt`（降序） | 健康计划 |
| `reminders` | `dueAt` + `notified` | `notify` 扫描待推送 |
| `square_posts` | `audit` + `createdAt`（降序） | 大厅/审核列表 |
| `square_posts` | `_openid` + `createdAt`（降序） | 我的发布 |
| `square_notifications` | `_openid` + `read` + `createdAt` | 未读数与消息列表 |
| `square_reports` | `status` + `createdAt` | 举报处理 |
| `accounts` / `admins` | `username`（唯一） | 登录查询 |
| `kb_docs` | `title` | 播种去重 |

## 8. 敏感数据与保留

- **密码**：仅存 `passwordHash + salt`，任何接口都不回传；管理员列表只返回 `_id / username / nickname / createdAt`。
- **手机号**：`users.phone`、`accounts.username` 明文存储，前端展示时脱敏；导出/日志中避免打印全量。
- **验证码**：`sms_codes` 仅演示用，生产环境应设置 TTL 清理。
- **图片/视频**：存于云存储 `consult/{openid}/...`；删除记录、帖子时**不会**自动删除云存储文件，长期运行会产生孤儿文件，建议后续加清理任务。
- **本地数据**：收藏、不感兴趣、浏览历史存于本地缓存，不进入数据库，也不跨设备同步。
