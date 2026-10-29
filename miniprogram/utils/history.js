/**
 * 历史浏览记录（本地存储）：
 * - square_history_v1        帖子 id 数组，最新在前，最多 50 条
 * - square_history_posts_v1  帖子快照 map（离线兜底展示用）
 */
const KEY = 'square_history_v1'
const MAP_KEY = 'square_history_posts_v1'
const MAX = 50

function record(post) {
  if (!post || !post._id) return
  try {
    let ids = wx.getStorageSync(KEY)
    if (!Array.isArray(ids)) ids = []
    ids = ids.filter(id => id !== post._id)
    ids.unshift(post._id)
    ids = ids.slice(0, MAX)

    const map = wx.getStorageSync(MAP_KEY) || {}
    map[post._id] = {
      _id: post._id,
      title: post.title || '',
      petKind: post.petKind || '',
      petBreed: post.petBreed || '',
      excerpt: post.excerpt || '',
      image: post.image || '',
      createdAt: post.createdAt,
      viewedAt: Date.now()
    }
    Object.keys(map).forEach(id => {
      if (ids.indexOf(id) < 0) delete map[id]
    })
    wx.setStorageSync(KEY, ids)
    wx.setStorageSync(MAP_KEY, map)
  } catch (e) {}
}

function list() {
  try {
    const ids = wx.getStorageSync(KEY)
    if (!Array.isArray(ids)) return []
    const map = wx.getStorageSync(MAP_KEY) || {}
    return ids.map(id => map[id]).filter(Boolean)
  } catch (e) {
    return []
  }
}

function remove(ids) {
  if (!Array.isArray(ids) || !ids.length) return
  try {
    const removing = {}
    ids.forEach(id => {
      removing[id] = true
    })
    const storedIds = wx.getStorageSync(KEY)
    const nextIds = Array.isArray(storedIds) ? storedIds.filter(id => !removing[id]) : []
    const map = wx.getStorageSync(MAP_KEY) || {}
    ids.forEach(id => {
      delete map[id]
    })
    wx.setStorageSync(KEY, nextIds)
    wx.setStorageSync(MAP_KEY, map)
  } catch (e) {}
}

function clear() {
  try {
    wx.removeStorageSync(KEY)
    wx.removeStorageSync(MAP_KEY)
  } catch (e) {}
}

module.exports = { record, list, remove, clear }
