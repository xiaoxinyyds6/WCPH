const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

function isImageUrl(a) {
  return typeof a === 'string' && /^(cloud:\/\/|https?:\/\/|\/|wxfile:\/\/)/.test(a)
}

Page({
  // ===== 分享给好友 / 朋友圈 =====
  onShareAppMessage() {
    return { title: 'AI宠物助手 · 问诊记录', path: '/pages/mine/mine' }
  },
  onShareTimeline() {
    return { title: 'AI宠物助手 · 问诊记录' }
  },
  data: {
    records: [],
    shown: [],
    recordTab: 'photo',
    loading: true
  },

  onShow() {
    if (!getApp().isLoggedIn()) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    this.loadRecords()
  },

  // 切换分类：拍照问诊记录 / 文字问诊记录
  onRecordTab(e) {
    const tab = e.currentTarget.dataset.tab === 'text' ? 'text' : 'photo'
    this.setData({ recordTab: tab })
    this.applyFilter()
  },

  // 按问诊方式过滤：新记录直接按 consultType；旧记录按消息里有无图片/视频推断
  applyFilter() {
    const tab = this.data.recordTab
    const shown = this.data.records.filter(r => {
      if (r.consultType === 'photo' || r.consultType === 'text') return r.consultType === tab
      const hasMedia = (r.messages || []).some(m => m.role === 'user' && ((m.images || []).length || m.video))
      return (hasMedia ? 'photo' : 'text') === tab
    })
    this.setData({ shown })
  },

  onPullDownRefresh() {
    this.loadRecords().then(() => wx.stopPullDownRefresh())
  },

  loadRecords() {
    return cloud
      .listRecords()
      .then(list => {
        const records = (list || []).map(r => {
          const userMsgs = (r.messages || []).filter(m => m.role === 'user')
          let firstQuestion = ''
          for (const m of userMsgs) {
            const t = String(m.content || '').trim()
            if (t && t !== '[图片]' && t !== '[视频]') {
              firstQuestion = t
              break
            }
          }
          if (!firstQuestion) {
            const hasVideo = userMsgs.some(m => m.video || String(m.content || '') === '[视频]')
            firstQuestion = hasVideo ? '视频问诊' : '图片问诊'
          }
          if (firstQuestion.length > 5) firstQuestion = firstQuestion.slice(0, 5) + '...'
          return Object.assign({}, r, {
            avatarIsImage: isImageUrl(r.petAvatar),
            timeText: util.formatDateTime(r.createdAt),
            firstQuestion
          })
        })
        this.setData({ records, loading: false })
        this.applyFilter()
      })
      .catch(err => {
        this.setData({ loading: false })
        cloud.toastError(err)
      })
  },

  onRecordTap(e) {
    wx.navigateTo({ url: '/pages/recordDetail/recordDetail?id=' + e.currentTarget.dataset.id })
  }
})
