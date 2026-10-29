const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COL = 'records'

async function ensureCollection() {
  try {
    await db.createCollection(COL)
  } catch (e) {}
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = event.action
  const col = db.collection(COL)

  try {
    await ensureCollection()

    if (action === 'list') {
      const res = await col
        .where({ _openid: OPENID })
        .field({
          petId: true,
          petName: true,
          petAvatar: true,
          title: true,
          published: true,
          consultType: true,
          createdAt: true,
          updatedAt: true,
          messages: true
        })
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get()
      return { ok: true, data: res.data }
    }

    if (action === 'get') {
      const res = await col.where({ _openid: OPENID, _id: event.id }).limit(1).get()
      if (!res.data.length) return { ok: false, msg: '记录不存在' }
      return { ok: true, data: res.data[0] }
    }

    if (action === 'add') {
      const r = event.record || {}
      // 未命名时自动编号：问诊记录1、问诊记录2……
      let title = (r.title || '').trim()
      if (!title) {
        let total = 0
        try {
          const c = await col.where({ _openid: OPENID }).count()
          total = c.total || 0
        } catch (e) {
          total = 0
        }
        title = `问诊记录${total + 1}`
      }
      const data = {
        _openid: OPENID,
        petId: r.petId || '',
        petName: r.petName || '',
        petAvatar: r.petAvatar || '',
        title: title.slice(0, 20),
        messages: r.messages || [],
        // 问诊方式：photo=拍照问诊 / text=文字问诊（旧记录为空，列表页按消息内容推断）
        consultType: r.consultType === 'photo' || r.consultType === 'text' ? r.consultType : '',
        published: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      const res = await col.add({ data })
      return { ok: true, data: Object.assign({ _id: res._id }, data) }
    }

    if (action === 'rename') {
      const title = (event.title || '').trim().slice(0, 20)
      if (!title) return { ok: false, msg: '名称不能为空' }
      const exist = await col.where({ _openid: OPENID, _id: event.id }).limit(1).get()
      if (!exist.data.length) return { ok: false, msg: '记录不存在' }
      await col.doc(event.id).update({ data: { title, updatedAt: Date.now() } })
      return { ok: true, data: { id: event.id, title } }
    }

    if (action === 'markPublished') {
      const exist = await col.where({ _openid: OPENID, _id: event.id }).limit(1).get()
      if (!exist.data.length) return { ok: false, msg: '记录不存在' }
      await col.doc(event.id).update({
        data: { published: true, squarePostId: event.squarePostId || '', updatedAt: Date.now() }
      })
      return { ok: true, data: { id: event.id, published: true } }
    }

    if (action === 'update') {
      const exist = await col.where({ _openid: OPENID, _id: event.id }).limit(1).get()
      if (!exist.data.length) return { ok: false, msg: '记录不存在' }
      const r = event.record || {}
      const data = {
        title: r.title !== undefined ? r.title : exist.data[0].title,
        messages: r.messages !== undefined ? r.messages : exist.data[0].messages,
        updatedAt: Date.now()
      }
      await col.doc(event.id).update({ data })
      return { ok: true, data: Object.assign({}, exist.data[0], data) }
    }

    if (action === 'remove') {
      const exist = await col.where({ _openid: OPENID, _id: event.id }).limit(1).get()
      if (!exist.data.length) return { ok: false, msg: '记录不存在' }
      await col.doc(event.id).remove()
      return { ok: true, data: { id: event.id } }
    }

    return { ok: false, msg: '未知操作' }
  } catch (err) {
    console.error('[record]', err)
    return { ok: false, msg: err.message || '服务异常' }
  }
}
