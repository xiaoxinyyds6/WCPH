const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 订阅消息模板 ID：微信公众平台 → 功能 → 订阅消息 → 选用"提醒"类模板后粘贴到这里
// （同时填到 miniprogram/pages/reminderEdit/reminderEdit.js 的 REMIND_TPL_ID）。
// 模板字段按微信要求是 key-value，字段名（thing1/thing2/time2 等）必须与所选模板的
// 字段关键词一致，接入模板后请同步修改下面 send 调用里的 data 结构。
const TEMPLATE_ID = ''
const REMINDERS = 'reminders'
const DAY = 24 * 3600 * 1000

// 推送窗口：到期前 24 小时内、且尚未推送过的提醒
async function pushDueReminders() {
  const now = Date.now()
  const res = await db
    .collection(REMINDERS)
    .where({
      dueAt: _.gte(now - DAY).and(_.lt(now + DAY)),
      notified: _.neq(true)
    })
    .limit(100)
    .get()
  let sent = 0
  let failed = 0
  for (const item of res.data || []) {
    try {
      await cloud.openapi.subscribeMessage.send({
        touser: item._openid,
        templateId: TEMPLATE_ID,
        page: 'pages/reminders/reminders',
        // 字段名需与你申请的订阅消息模板字段一一对应后调整
        data: {
          thing1: { value: (item.title || '宠物提醒').slice(0, 20) },
          time2: { value: formatTime(item.dueAt) }
        }
      })
      sent++
      await db.collection(REMINDERS).doc(item._id).update({ data: { notified: true } })
    } catch (e) {
      failed++
      // 43101：用户未订阅/订阅已过期，属正常情况，不再重试
      console.warn('[notify] 推送失败', item._id, e && (e.errCode || e.message))
    }
  }
  return { scanned: (res.data || []).length, sent, failed }
}

function formatTime(ts) {
  const d = new Date(ts)
  const p = n => (n < 10 ? '0' + n : '' + n)
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

exports.main = async event => {
  // 定时触发器（每天 9 点）自动执行；也支持手动调用 { action: 'run' } 补发
  if (event && event.Type === 'Timer') {
    /* fallthrough */
  }
  try {
    if (!TEMPLATE_ID) {
      console.warn(
        '[notify] 未配置订阅消息模板 ID，已跳过推送。请到 mp.weixin.qq.com 申请订阅消息模板后填入 TEMPLATE_ID'
      )
      return { ok: true, data: { skipped: true, reason: 'TEMPLATE_ID 未配置' } }
    }
    const result = await pushDueReminders()
    console.log('[notify] 扫描', result.scanned, '条，成功', result.sent, '，失败', result.failed)
    return { ok: true, data: result }
  } catch (e) {
    console.error('[notify]', e)
    return { ok: false, msg: e.message || '推送失败' }
  }
}
