const cloud = require('../../utils/cloud')

const KIND_EMOJI = { 猫: '🐱', 狗: '🐶', 兔: '🐰', 鸟: '🐦', 仓鼠: '🐹', 乌龟: '🐢' }

Page({
  // ===== 分享给好友 / 朋友圈 =====
  onShareAppMessage() {
    return { title: '问诊广场 · 搜一搜养宠经验', path: '/pages/square/square' }
  },
  onShareTimeline() {
    return { title: '问诊广场 · 搜一搜养宠经验' }
  },
  data: {
    keyword: '',
    searched: false,
    searching: false,
    posts: [],
    keywords: []
  },

  onLoad() {},

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  onConfirm() {
    if (this.data.searching) return
    const keyword = this.data.keyword.trim()
    if (!keyword) {
      wx.showToast({ title: '请输入搜索关键词', icon: 'none' })
      return
    }
    this.setData({ searching: true, searched: false })
    cloud
      .squareSearch(keyword)
      .then(res => {
        const list = (res && res.list) || []
        const posts = list.map(p =>
          Object.assign({}, p, {
            kindEmoji: KIND_EMOJI[p.petKind] || '🐾',
            timeText: this.formatTime(p.createdAt),
            likeCount: p.likeCount || (p.likes || []).length,
            commentCount: (p.comments || []).length,
            official: !!p.official
          })
        )
        this.setData({
          posts,
          keywords: (res && res.keywords) || [],
          searched: true,
          searching: false
        })
      })
      .catch(err => {
        this.setData({ searching: false, searched: true, posts: [] })
        cloud.toastError(err)
      })
  },

  formatTime(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    const pad = n => (n < 10 ? '0' + n : '' + n)
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  },

  onPostTap(e) {
    wx.navigateTo({ url: '/pages/postDetail/postDetail?id=' + e.currentTarget.dataset.id })
  },

  onClear() {
    this.setData({ keyword: '', posts: [], keywords: [], searched: false })
  }
})
