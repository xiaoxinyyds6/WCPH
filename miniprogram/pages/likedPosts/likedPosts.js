const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

const KIND_EMOJI = { 猫: '🐱', 狗: '🐶', 兔: '🐰', 鸟: '🐦', 仓鼠: '🐹', 乌龟: '🐢', 龟: '🐢' }
const FAV_KEY = 'square_favs_v1'
const FAV_POSTS_KEY = 'square_fav_posts_v1'

Page({
  // ===== 分享给好友 / 朋友圈 =====
  onShareAppMessage() {
    return { title: '问诊广场 · 大家都在看的好帖', path: '/pages/square/square' }
  },
  onShareTimeline() {
    return { title: '问诊广场 · 大家都在看的好帖' }
  },
  data: {
    mode: 'like', // like=我的点赞 / fav=我的收藏
    posts: [],
    loading: true,
    selecting: false,
    selectedIds: [],
    deleting: false
  },

  onLoad(options) {
    const mode = options && options.mode === 'fav' ? 'fav' : 'like'
    this.setData({ mode })
    wx.setNavigationBarTitle({ title: mode === 'fav' ? '我的收藏' : '我的点赞' })
  },

  onShow() {
    if (!getApp().requireLogin()) return
    this.loadPosts()
  },

  onPullDownRefresh() {
    this.loadPosts().then(() => wx.stopPullDownRefresh())
  },

  loadPosts() {
    if (this.data.mode === 'fav') return this.loadFavPosts()
    return cloud
      .squareLiked()
      .then(list => {
        this.setData({ posts: this.decorate(list || []), loading: false, selecting: false, selectedIds: [], deleting: false })
      })
      .catch(err => {
        this.setData({ loading: false, deleting: false })
        cloud.toastError(err)
      })
  },

  // 收藏列表：优先云端批量取帖（数据最新），云端不可用时回退本地快照兜底
  loadFavPosts() {
    let ids = []
    try {
      const v = wx.getStorageSync(FAV_KEY)
      ids = Array.isArray(v) ? v : []
    } catch (e) {
      ids = []
    }
    if (!ids.length) {
      this.setData({ posts: [], loading: false })
      return Promise.resolve()
    }
    return cloud
      .squareFavlist(ids)
      .then(list => {
        if (list && list.length) {
          this.setData({ posts: this.decorate(list), loading: false })
        } else {
          this.setData({ posts: this.decorate(this.favSnapshots(ids)), loading: false })
        }
      })
      .catch(() => {
        this.setData({ posts: this.decorate(this.favSnapshots(ids)), loading: false })
      })
  },

  favSnapshots(ids) {
    let map = {}
    try {
      map = wx.getStorageSync(FAV_POSTS_KEY) || {}
    } catch (e) {
      map = {}
    }
    return ids.map(id => map[id]).filter(Boolean)
  },

  decorate(list) {
    return (list || []).map(p =>
      Object.assign({}, p, {
        kindEmoji: KIND_EMOJI[p.petKind] || '🐾',
        timeText: util.formatDateTime(p.viewedAt || p.createdAt),
        selected: false
      })
    )
  },

  onToggleSelectMode() {
    if (this.data.deleting || (!this.data.selecting && !this.data.posts.length)) return
    this.setData({
      selecting: !this.data.selecting,
      selectedIds: [],
      posts: this.data.posts.map(p => Object.assign({}, p, { selected: false }))
    })
  },

  onPostTap(e) {
    const id = e.currentTarget.dataset.id
    if (!this.data.selecting) {
      wx.navigateTo({ url: '/pages/postDetail/postDetail?id=' + id })
      return
    }
    if (this.data.deleting) return
    const selectedIds = this.data.selectedIds.slice()
    const index = selectedIds.indexOf(id)
    if (index >= 0) selectedIds.splice(index, 1)
    else selectedIds.push(id)
    const posts = this.data.posts.map(p =>
      p._id === id ? Object.assign({}, p, { selected: index < 0 }) : p
    )
    this.setData({ posts, selectedIds })
  },

  onDeleteSelected() {
    if (!this.data.selectedIds.length || this.data.deleting) return
    const isFav = this.data.mode === 'fav'
    wx.showModal({
      title: isFav ? '删除收藏' : '删除点赞记录',
      content: isFav ? '确认取消收藏选中的帖子吗？' : '确认删除点赞记录吗？',
      cancelText: '取消',
      confirmText: '确认',
      confirmColor: '#D9534F',
      success: res => {
        if (res.confirm) this.deleteSelected()
      }
    })
  },

  deleteSelected() {
    const ids = this.data.selectedIds.slice()
    this.setData({ deleting: true })
    const job = this.data.mode === 'fav' ? this.removeFavs(ids) : this.removeLikes(ids)
    job
      .then(() => {
        this.setData({
          posts: this.data.posts.filter(p => ids.indexOf(p._id) < 0),
          selecting: false,
          selectedIds: [],
          deleting: false
        })
        wx.showToast({
          title: this.data.mode === 'fav' ? '已取消收藏' : '删除成功',
          icon: 'none',
          duration: 2000
        })
      })
      .catch(err => {
        this.setData({ deleting: false })
        // 批量请求可能部分成功，重新拉取以保证列表与云端一致
        return this.loadPosts().then(() => cloud.toastError(err))
      })
  },

  removeLikes(ids) {
    return Promise.all(ids.map(id => cloud.squareLike(id)))
  },

  removeFavs(ids) {
    return new Promise(resolve => {
      try {
        const v = wx.getStorageSync(FAV_KEY)
        let stored = Array.isArray(v) ? v : []
        stored = stored.filter(x => ids.indexOf(x) < 0)
        wx.setStorageSync(FAV_KEY, stored)
        const map = wx.getStorageSync(FAV_POSTS_KEY) || {}
        ids.forEach(id => delete map[id])
        wx.setStorageSync(FAV_POSTS_KEY, map)
      } catch (e) {}
      resolve()
    })
  }
})
