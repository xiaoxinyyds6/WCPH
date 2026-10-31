const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const USERS = 'users'
const CODES = 'sms_codes'
const ACCOUNTS = 'accounts'
const ADMINS = 'admins'

// 首次管理员登录时自动播种的默认管理员账号
const DEFAULT_ADMIN = { username: 'admin', password: 'Admin@123456' }

function hashPwd(password, salt) {
  return crypto.createHash('sha256').update(salt + '|' + password).digest('hex')
}

function validPassword(password) {
  return (
    password.length >= 8 &&
    password.length <= 14 &&
    /^(?=.*[A-Za-z])(?=.*\d)\S+$/.test(password)
  )
}

async function checkSmsCode(openid, phone, code) {
  if (!/^1[3-9]\d{9}$/.test(phone)) return { ok: false, msg: '手机号格式不正确' }
  if (!/^\d{6}$/.test(code)) return { ok: false, msg: '请输入6位验证码' }
  const exist = await db
    .collection(CODES)
    .where({ _openid: openid, phone })
    .limit(1)
    .get()
  if (!exist.data.length) return { ok: false, msg: '请先获取验证码' }
  const rec = exist.data[0]
  if (rec.code !== code) return { ok: false, msg: '验证码错误' }
  if (rec.expireAt < Date.now()) return { ok: false, msg: '验证码已过期，请重新获取' }
  return { ok: true, rec }
}

async function ensureCollection(name) {
  try {
    await db.createCollection(name)
  } catch (e) {
    // 已存在则忽略
  }
}

async function upsertUser(openid, phone, extra) {
  await ensureCollection(USERS)
  const col = db.collection(USERS)
  const exist = await col.where({ _openid: openid }).limit(1).get()
  const now = Date.now()
  if (exist.data.length) {
    const doc = exist.data[0]
    const patch = Object.assign({ updatedAt: now }, extra || {})
    if (phone) patch.phone = phone
    await col.doc(doc._id).update({ data: patch })
    return Object.assign({}, doc, patch, { openid })
  }
  const data = Object.assign(
    {
      _openid: openid,
      phone: phone || '',
      nickname: phone ? '微信用户' + phone.slice(-4) : ((extra && (extra.nickname || extra.username)) || '宠物用户'),
      avatarUrl: '',
      createdAt: now,
      updatedAt: now
    },
    extra || {}
  )
  const res = await col.add({ data })
  return Object.assign({ _id: res._id }, data, { openid })
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = event.action

  try {
    if (action === 'sendCode') {
      const phone = String(event.phone || '')
      if (!/^1[3-9]\d{9}$/.test(phone)) {
        return { ok: false, msg: '手机号格式不正确' }
      }
      await ensureCollection(CODES)
      const code = String(Math.floor(100000 + Math.random() * 900000))
      const col = db.collection(CODES)
      const exist = await col.where({ _openid: OPENID, phone }).limit(1).get()
      const expireAt = Date.now() + 5 * 60 * 1000
      if (exist.data.length) {
        await col.doc(exist.data[0]._id).update({ data: { code, expireAt } })
      } else {
        await col.add({ data: { _openid: OPENID, phone, code, expireAt } })
      }
      // 演示环境无短信服务商，直接回传验证码供页面提示；生产应改为短信下发并移除该字段
      return { ok: true, data: { code } }
    }

    if (action === 'smsLogin') {
      const phone = String(event.phone || '').trim()
      const code = String(event.code || '').trim()
      const checked = await checkSmsCode(OPENID, phone, code)
      if (!checked.ok) return checked
      await ensureCollection(ACCOUNTS)
      const accountRes = await db.collection(ACCOUNTS).where({ username: phone }).limit(1).get()
      // 首次使用该手机号：保留验证码，待密码设置成功后再完成登录并消费验证码
      if (!accountRes.data.length) {
        return { ok: true, data: { needSetPassword: true, phone } }
      }
      const acc = accountRes.data[0]
      const user = await upsertUser(OPENID, phone, {
        accountId: acc._id,
        username: phone,
        loginType: 'sms'
      })
      await db.collection(CODES).doc(checked.rec._id).remove()
      return {
        ok: true,
        data: {
          needSetPassword: false,
          userInfo: {
            openid: OPENID,
            phone,
            accountId: acc._id,
            username: phone,
            nickname: user.nickname,
            avatarUrl: user.avatarUrl
          }
        }
      }
    }

    // 检查手机号是否被注册/使用过（忘记密码页提前提示）
    if (action === 'checkPhoneRegistered') {
      const phone = String(event.phone || '').trim()
      if (!/^1[3-9]\d{9}$/.test(phone)) {
        return { ok: false, msg: '手机号格式不正确' }
      }
      await ensureCollection(ACCOUNTS)
      const accRes = await db.collection(ACCOUNTS).where({ username: phone }).limit(1).get()
      if (accRes.data.length) return { ok: true, data: { registered: true } }
      await ensureCollection(USERS)
      const userRes = await db.collection(USERS).where({ phone }).limit(1).get()
      return { ok: true, data: { registered: userRes.data.length > 0 } }
    }

    // 忘记密码第一步：只校验验证码，不登录、不消费验证码
    if (action === 'verifyCode') {
      const phone = String(event.phone || '').trim()
      const code = String(event.code || '').trim()
      const checked = await checkSmsCode(OPENID, phone, code)
      if (!checked.ok) return checked
      if (event.purpose === 'reset') {
        await ensureCollection(ACCOUNTS)
        const accountRes = await db.collection(ACCOUNTS).where({ username: phone }).limit(1).get()
        if (!accountRes.data.length) {
          return { ok: false, msg: '该手机号尚未设置密码，请使用验证码登录' }
        }
      }
      return { ok: true, data: { valid: true, phone } }
    }

    // 首次设置密码 / 忘记密码后重置密码
    if (action === 'setPassword') {
      const phone = String(event.phone || '').trim()
      const code = String(event.code || '').trim()
      const password = String(event.password || '')
      const mode = event.mode === 'reset' ? 'reset' : 'register'
      if (!validPassword(password)) {
        return { ok: false, msg: '密码需为8-14位，且同时包含英文和数字' }
      }
      const checked = await checkSmsCode(OPENID, phone, code)
      if (!checked.ok) return checked
      await ensureCollection(ACCOUNTS)
      const col = db.collection(ACCOUNTS)
      const accountRes = await col.where({ username: phone }).limit(1).get()
      const existing = accountRes.data[0]
      if (mode === 'register' && existing) {
        return { ok: false, msg: '该手机号已设置密码，请直接登录' }
      }
      if (mode === 'reset' && !existing) {
        return { ok: false, msg: '该手机号尚未设置密码，请使用验证码登录' }
      }
      const salt = crypto.randomBytes(8).toString('hex')
      const passwordHash = hashPwd(password, salt)
      let accountId = existing && existing._id
      if (existing) {
        await col.doc(accountId).update({
          data: { passwordHash, salt, updatedAt: Date.now() }
        })
      } else {
        const res = await col.add({
          data: {
            _openid: OPENID,
            username: phone,
            phone,
            passwordHash,
            salt,
            nickname: '微信用户' + phone.slice(-4),
            createdAt: Date.now()
          }
        })
        accountId = res._id
      }
      await db.collection(CODES).doc(checked.rec._id).remove()
      const user = await upsertUser(OPENID, phone, {
        accountId,
        username: phone,
        loginType: mode === 'reset' ? 'passwordReset' : 'sms'
      })
      return {
        ok: true,
        data: {
          userInfo: {
            openid: OPENID,
            phone,
            accountId,
            username: phone,
            nickname: user.nickname,
            avatarUrl: user.avatarUrl
          }
        }
      }
    }

    // ===== 微信一键登录：以 openid 为唯一标识自动创建/登录账户（无需手机号） =====
    if (action === 'wxLogin') {
      if (!OPENID) return { ok: false, msg: '未获取到微信身份，请重试' }
      await ensureCollection(USERS)
      const col = db.collection(USERS)
      const exist = await col.where({ _openid: OPENID }).limit(1).get()
      const now = Date.now()
      let user
      if (exist.data.length) {
        const doc = exist.data[0]
        await col.doc(doc._id).update({ data: { updatedAt: now, lastLoginAt: now } })
        user = Object.assign({}, doc, { openid: OPENID })
      } else {
        const data = {
          _openid: OPENID,
          phone: '',
          nickname: '宠物用户' + OPENID.slice(-4),
          avatarUrl: '',
          loginType: 'wx',
          createdAt: now,
          updatedAt: now
        }
        const res = await col.add({ data })
        user = Object.assign({ _id: res._id }, data, { openid: OPENID })
      }
      // 与 phoneLogin 一致返回扁平结构，前端直接拿 openid 等字段
      return {
        ok: true,
        data: {
          openid: OPENID,
          phone: user.phone || '',
          username: user.username || '',
          nickname: user.nickname,
          avatarUrl: user.avatarUrl || '',
          loginType: 'wx'
        }
      }
    }

    // 更新头像/昵称
    if (action === 'updateProfile') {
      const nickname = String(event.nickname || '').trim().slice(0, 20)
      const avatarUrl = String(event.avatarUrl || '').slice(0, 300)
      if (!nickname && !avatarUrl) {
        return { ok: false, msg: '没有需要更新的内容' }
      }
      const extra = {}
      if (nickname) extra.nickname = nickname
      if (avatarUrl) extra.avatarUrl = avatarUrl
      const user = await upsertUser(OPENID, event.phone || '', extra)
      return {
        ok: true,
        data: { openid: OPENID, phone: user.phone, nickname: user.nickname, avatarUrl: user.avatarUrl }
      }
    }

    // ===== 账号密码登录（账号由管理员在后台创建） =====
    if (action === 'accountLogin') {
      const username = String(event.username || '').trim()
      const password = String(event.password || '')
      if (!username || !password) {
        return { ok: false, msg: '请输入账号和密码' }
      }
      await ensureCollection(ACCOUNTS)
      const exist = await db
        .collection(ACCOUNTS)
        .where({ username })
        .limit(1)
        .get()
      if (!exist.data.length) {
        return {
          ok: false,
          msg: /^1[3-9]\d{9}$/.test(username)
            ? '该手机号尚未设置密码，请先使用验证码登录'
            : '账号不存在，请联系管理员添加'
        }
      }
      const acc = exist.data[0]
      if (hashPwd(password, acc.salt || '') !== acc.passwordHash) {
        return { ok: false, msg: '密码错误' }
      }
      const phone = /^1[3-9]\d{9}$/.test(username) ? username : ''
      const user = await upsertUser(OPENID, phone, {
        accountId: acc._id,
        username,
        loginType: 'account'
      })
      return {
        ok: true,
        data: {
          openid: OPENID,
          accountId: acc._id,
          username,
          nickname: user.nickname || acc.nickname || username,
          avatarUrl: user.avatarUrl || '',
          phone: user.phone || phone,
          role: 'user'
        }
      }
    }

    // ===== 管理员账号密码登录 =====
    if (action === 'adminLogin') {
      const username = String(event.username || '').trim()
      const password = String(event.password || '')
      if (!username || !password) {
        return { ok: false, msg: '请输入账号和密码' }
      }
      await ensureCollection(ADMINS)
      const exist = await db
        .collection(ADMINS)
        .where({ username })
        .limit(1)
        .get()
      if (!exist.data.length) {
        // 首次登录：自动播种默认管理员（admin / Admin@123456）
        if (username === DEFAULT_ADMIN.username && password === DEFAULT_ADMIN.password) {
          const salt = crypto.randomBytes(8).toString('hex')
          await db.collection(ADMINS).add({
            data: {
              _openid: OPENID,
              username,
              passwordHash: hashPwd(password, salt),
              salt,
              createdAt: Date.now()
            }
          })
          return { ok: true, data: { openid: OPENID, username, role: 'admin' } }
        }
        return { ok: false, msg: '管理员账号不存在' }
      }
      const acc = exist.data[0]
      if (hashPwd(password, acc.salt || '') !== acc.passwordHash) {
        return { ok: false, msg: '密码错误' }
      }
      // 绑定当前 openid：管理员换设备时以账号密码为准
      if (acc._openid !== OPENID) {
        await db.collection(ADMINS).doc(acc._id).update({ data: { _openid: OPENID } })
      }
      return { ok: true, data: { openid: OPENID, username, role: 'admin' } }
    }

    return { ok: false, msg: '未知操作' }
  } catch (err) {
    console.error('[login]', err)
    return { ok: false, msg: err.message || '服务异常' }
  }
}
