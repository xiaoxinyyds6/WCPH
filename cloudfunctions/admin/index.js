const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const ADMINS = 'admins'
const ACCOUNTS = 'accounts'

function hashPwd(password, salt) {
  return crypto.createHash('sha256').update(salt + '|' + password).digest('hex')
}

async function ensureCollection(name) {
  try {
    await db.createCollection(name)
  } catch (e) {}
}

// 管理员校验：admins 集合中 _openid 命中即视为管理员
async function isAdmin(openid) {
  try {
    await ensureCollection(ADMINS)
    const res = await db
      .collection(ADMINS)
      .where({ _openid: openid })
      .limit(1)
      .get()
    return res.data.length > 0
  } catch (e) {
    return false
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = event.action

  try {
    if (action === 'isAdmin') {
      return { ok: true, data: { isAdmin: await isAdmin(OPENID) } }
    }

    if (!(await isAdmin(OPENID))) {
      return { ok: false, msg: '无管理员权限' }
    }

    // ===== 添加账号（仅管理员，供用户账号密码登录） =====
    if (action === 'addAccount') {
      const username = String(event.username || '').trim()
      const password = String(event.password || '')
      const nickname = String(event.nickname || '').trim().slice(0, 20)
      if (!/^1[3-9]\d{9}$/.test(username)) {
        return { ok: false, msg: '请输入正确的11位手机号' }
      }
      if (
        password.length < 8 ||
        password.length > 14 ||
        !/^(?=.*[A-Za-z])(?=.*\d)\S+$/.test(password)
      ) {
        return { ok: false, msg: '密码需为8-14位，且同时包含英文和数字' }
      }
      await ensureCollection(ACCOUNTS)
      const exist = await db
        .collection(ACCOUNTS)
        .where({ username })
        .limit(1)
        .get()
      if (exist.data.length) {
        return { ok: false, msg: '该手机号已被注册，无法重复添加' }
      }
      const salt = crypto.randomBytes(8).toString('hex')
      const res = await db.collection(ACCOUNTS).add({
        data: {
          username,
          passwordHash: hashPwd(password, salt),
          salt,
          nickname: nickname || username,
          createdAt: Date.now()
        }
      })
      return { ok: true, data: { _id: res._id, username, nickname: nickname || username } }
    }

    // ===== 账号列表（不回传密码哈希与盐） =====
    if (action === 'listAccounts') {
      await ensureCollection(ACCOUNTS)
      const res = await db
        .collection(ACCOUNTS)
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get()
      const data = res.data.map(a => ({
        _id: a._id,
        username: a.username,
        nickname: a.nickname || a.username,
        createdAt: a.createdAt
      }))
      return { ok: true, data }
    }

    // ===== 删除账号 =====
    if (action === 'removeAccount') {
      const exist = await db
        .collection(ACCOUNTS)
        .where({ _id: event.id })
        .limit(1)
        .get()
      if (!exist.data.length) return { ok: false, msg: '账号不存在' }
      await db.collection(ACCOUNTS).doc(event.id).remove()
      return { ok: true, data: { id: event.id } }
    }

    // ===== 数据概览：各集合数量 + 最近注册用户 =====
    if (action === 'stats') {
      const countOf = async name => {
        try {
          const c = await db.collection(name).count()
          return c.total || 0
        } catch (e) {
          return 0
        }
      }
      const [users, pets, records, posts] = await Promise.all([
        countOf('users'),
        countOf('pets'),
        countOf('records'),
        countOf('square_posts')
      ])
      let recentUsers = []
      try {
        const res = await db
          .collection('users')
          .orderBy('createdAt', 'desc')
          .limit(10)
          .get()
        recentUsers = res.data.map(u => ({
          _id: u._id,
          nickname: u.nickname || '',
          phone: u.phone || '',
          username: u.username || '',
          createdAt: u.createdAt
        }))
      } catch (e) {}
      return { ok: true, data: { stats: { users, pets, records, posts }, recentUsers } }
    }

    return { ok: false, msg: '未知操作' }
  } catch (err) {
    console.error('[admin]', err)
    return { ok: false, msg: err.message || '服务异常' }
  }
}
