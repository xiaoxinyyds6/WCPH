const cloud = require('../../utils/cloud')

const KINDS = ['猫', '狗', '兔', '鸟', '仓鼠', '其他']
const MAX_EXCERPT = 120

Page({
  // ===== 分享给好友 / 朋友圈 =====
  onShareAppMessage() {
    return { title: '宠物健康自查 · 按部位快速问诊', path: '/pages/topic/topic' }
  },
  onShareTimeline() {
    return { title: '宠物健康自查 · 按部位快速问诊' }
  },
  data: {
    kinds: KINDS,
    petKind: '猫',
    title: '',
    excerpt: '',
    count: 0,
    maxExcerpt: MAX_EXCERPT,
    submitting: false,
    // 编辑模式：从消息中心/帖子详情进入修改待审核帖子
    editId: ''
  },

  onLoad(options) {
    const id = options && options.id
    if (!id) return
    wx.showLoading({ title: '加载中' })
    cloud
      .squareGet(id)
      .then(post => {
        wx.hideLoading()
        // 仅作者本人且帖子处于待审核/未通过状态时可编辑
        if (!post || !post.mine || post.audit === 'approved') {
          wx.showToast({ title: '仅待审核或未通过的帖子可以修改', icon: 'none' })
          setTimeout(() => wx.navigateBack(), 900)
          return
        }
        const excerpt = String(post.excerpt || '').slice(0, MAX_EXCERPT)
        this.setData({
          editId: id,
          petKind: KINDS.indexOf(post.petKind) >= 0 ? post.petKind : '其他',
          title: post.title || '',
          excerpt,
          count: excerpt.length
        })
      })
      .catch(err => {
        wx.hideLoading()
        cloud.toastError(err)
        setTimeout(() => wx.navigateBack(), 900)
      })
  },

  onKind(e) {
    this.setData({ petKind: e.currentTarget.dataset.k })
  },

  onTitle(e) {
    this.setData({ title: e.detail.value })
  },

  onExcerpt(e) {
    const v = e.detail.value || ''
    const excerpt = v.slice(0, MAX_EXCERPT)
    this.setData({ excerpt, count: excerpt.length })
  },

  onSubmit() {
    if (!getApp().requireLogin()) return
    if (this.data.submitting) return
    const title = (this.data.title || '').trim()
    const excerpt = (this.data.excerpt || '').trim()
    if (!title) {
      wx.showToast({ title: '请填写标题', icon: 'none' })
      return
    }
    if (!excerpt) {
      wx.showToast({ title: '请描述具体情况', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    const payload = { petKind: this.data.petKind, petBreed: '', title, excerpt }
    const save = this.data.editId
      ? cloud.squareEditPost(this.data.editId, payload)
      : cloud.squarePublish(payload)
    save
      .then(() => {
        wx.showToast({
          title: this.data.editId ? '已修改，重新提交审核' : '已提交，待管理员审核',
          icon: 'success'
        })
        setTimeout(() => {
          if (getCurrentPages().length > 1) wx.navigateBack()
          else wx.switchTab({ url: '/pages/square/square' })
        }, 900)
      })
      .catch(err => {
        this.setData({ submitting: false })
        cloud.toastError(err)
      })
  }
})
