const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COL = 'pets'
const MAX_PETS = 5

async function ensureCollection() {
  try {
    await db.createCollection(COL)
  } catch (e) {}
}

const FIELDS = [
  'name', 'avatar', 'category', 'breed', 'gender',
  'birthDate', 'weight', 'neutered', 'body', 'dewormed'
]

function pick(pet) {
  const out = {}
  FIELDS.forEach(k => {
    if (pet[k] !== undefined) out[k] = pet[k]
  })
  return out
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = event.action
  const col = db.collection(COL)

  try {
    await ensureCollection()

    if (action === 'list') {
      const res = await col.where({ _openid: OPENID }).orderBy('createdAt', 'asc').limit(20).get()
      return { ok: true, data: res.data }
    }

    if (action === 'count') {
      const res = await col.where({ _openid: OPENID }).count()
      return { ok: true, data: { total: res.total } }
    }

    if (action === 'get') {
      const res = await col.where({ _openid: OPENID, _id: event.id }).limit(1).get()
      if (!res.data.length) return { ok: false, msg: '宠物不存在' }
      return { ok: true, data: res.data[0] }
    }

    if (action === 'add') {
      const count = await col.where({ _openid: OPENID }).count()
      if (count.total >= MAX_PETS) {
        return { ok: false, msg: '宠物位置已满，无法继续添加' }
      }
      const data = pick(event.pet || {})
      if (!data.name) return { ok: false, msg: '请填写宠物名字' }
      data._openid = OPENID
      data.createdAt = Date.now()
      data.updatedAt = Date.now()
      const res = await col.add({ data })
      return { ok: true, data: Object.assign({ _id: res._id }, data) }
    }

    if (action === 'update') {
      const exist = await col.where({ _openid: OPENID, _id: event.id }).limit(1).get()
      if (!exist.data.length) return { ok: false, msg: '宠物不存在' }
      const data = pick(event.pet || {})
      data.updatedAt = Date.now()
      await col.doc(event.id).update({ data })
      return { ok: true, data: Object.assign({}, exist.data[0], data) }
    }

    if (action === 'remove') {
      const exist = await col.where({ _openid: OPENID, _id: event.id }).limit(1).get()
      if (!exist.data.length) return { ok: false, msg: '宠物不存在' }
      await col.doc(event.id).remove()
      return { ok: true, data: { id: event.id } }
    }

    return { ok: false, msg: '未知操作' }
  } catch (err) {
    console.error('[pet]', err)
    return { ok: false, msg: err.message || '服务异常' }
  }
}
