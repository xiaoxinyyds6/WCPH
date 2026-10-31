const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

const KIND_EMOJI = { 猫: '🐱', 狗: '🐶', 兔: '🐰', 鸟: '🐦', 仓鼠: '🐹', 乌龟: '🐢' }
const FEATURED_MIN = 100

Page({
  // ===== 分享给好友 / 朋友圈 =====
  onShareAppMessage() {
    return { title: '官方精选好帖 · 养宠干货合集', path: '/pages/featured/featured' }
  },
  onShareTimeline() {
    return { title: '官方精选好帖 · 养宠干货合集' }
  },
  data: {
    posts: [],
    loading: true,
    min: FEATURED_MIN,
    openId: ''
  },

  onShow() {
    this.setData({ openId: getApp().globalData.openid || '' })
    this.load()
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh())
  },

  load() {
    this.setData({ loading: true })
    return cloud
      .squareFeatured()
      .then(list => {
        const openid = this.data.openId
        const posts = (list || []).map(p =>
          Object.assign({}, p, {
            kindEmoji: KIND_EMOJI[p.petKind] || '🐾',
            breedText: p.petBreed ? ' · ' + p.petBreed : '',
            timeText: util.formatDateTime(p.createdAt),
            likeCount: p.likeCount || (p.likes || []).length,
            likedByMe: (p.likes || []).indexOf(openid) >= 0,
            commentCount: (p.comments || []).length
          })
        )
        this.setData({ posts, loading: false })
      })
      .catch(err => {
        this.setData({ loading: false })
        cloud.toastError(err)
      })
  },

  // 精选页内点赞（乐观更新，云端失败时重新拉取）
  onLike(e) {
    if (!getApp().requireLogin()) return
    const id = e.currentTarget.dataset.id
    let newLiked = false
    const posts = this.data.posts.map(p => {
      if (p._id !== id) return p
      newLiked = !p.likedByMe
      return Object.assign({}, p, {
        likedByMe: newLiked,
        likeCount: p.likeCount + (newLiked ? 1 : -1)
      })
    })
    this.setData({ posts })
    cloud.squareLike(id).catch(() => {
      console.warn('[featured] like sync failed')
      this.load()
    })
  },

  onPostTap(e) {
    wx.navigateTo({ url: '/pages/postDetail/postDetail?id=' + e.currentTarget.dataset.id })
  }
})
