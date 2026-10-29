const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

Page({
  data: {
    id: '',
    record: { messages: [], petName: '', petAvatar: '', title: '' },
    timeText: '',
    userAvatar: '',
    published: false,
    publishing: false
  },

  onLoad(options) {
    const id = (options && options.id) || ''
    this.setData({ id })
    const user = getApp().getUser() || {}
    this.setData({ userAvatar: user.avatarUrl || '' })
    if (!id) return
    wx.showLoading({ title: '加载中' })
    cloud
      .getRecord(id)
      .then(record => {
        wx.hideLoading()
        if (!record) return
        record.messages = (record.messages || []).map((m, i) =>
          Object.assign({}, m, { _k: 'r' + i })
        )
        this.setData({
          record,
          published: !!record.published,
          timeText: util.formatDateTime(record.createdAt)
        })
      })
      .catch(err => {
        wx.hideLoading()
        cloud.toastError(err)
      })
  },

  // 全屏预览聊天记录中的图片
  onPreviewImage(e) {
    const { urls, cur } = e.currentTarget.dataset
    wx.previewImage({ urls: urls || [cur], current: cur })
  },

  // 跳转 AI 问诊聊天页，直接打开该条问诊档案继续对话
  onContinueConsult() {
    const id = this.data.id || (this.data.record && this.data.record._id) || ''
    wx.navigateTo({ url: '/pages/chat/chat' + (id ? '?sessionId=' + id : '') })
  },

  // 把本次问诊沉淀为健康提醒（疫苗/驱虫/复诊等）
  onAddReminder() {
    const rec = this.data.record
    const query = []
    if (rec.petId) query.push('petId=' + rec.petId)
    if (rec.title) query.push('title=' + encodeURIComponent(rec.title))
    wx.navigateTo({
      url: '/pages/reminderEdit/reminderEdit' + (query.length ? '?' + query.join('&') : '')
    })
  },

  // 未发布的记录重新发布到问诊广场（脱敏）
  onPublish() {
    if (this.data.published) {
      wx.showToast({ title: '已发布到广场', icon: 'none' })
      return
    }
    if (this.data.publishing) return
    const rec = this.data.record
    const firstUser = (rec.messages || []).find(m => m.role === 'user')
    if (!firstUser) {
      wx.showToast({ title: '记录为空，无法发布', icon: 'none' })
      return
    }
    const raw =
      (firstUser.content || '').trim() || (firstUser.video ? '视频问诊求助' : '图片问诊求助')
    const thumb =
      (firstUser.images || []).find(u => typeof u === 'string' && u.indexOf('cloud://') === 0) || ''
    const PARTS = ['皮肤', '耳朵', '眼睛', '口腔', '粪便', '其他']
    wx.showActionSheet({
      itemList: PARTS,
      success: res => {
        const part = PARTS[res.tapIndex]
        wx.showModal({
          title: '发布到问诊广场',
          content: '将脱敏后公开以下内容（不含个人信息）：\n\n' + raw.slice(0, 60),
          confirmText: '发布',
          success: r => {
            if (!r.confirm) return
            this.setData({ publishing: true })
            wx.showLoading({ title: '发布中', mask: true })
            cloud
              .squarePublish({
                petKind: '',
                petBreed: '',
                part,
                title: (rec.title || raw).slice(0, 40),
                excerpt: raw.slice(0, 120),
                image: thumb,
                recordId: this.data.id
              })
              .then(res2 => {
                wx.hideLoading()
                this.setData({ publishing: false, published: true })
                if (res2 && res2._id) {
                  cloud.markRecordPublished(this.data.id, res2._id).catch(() => {
                    wx.showToast({ title: '已发布，但记录状态同步失败', icon: 'none' })
                  })
                }
                wx.showToast({ title: '已提交，待管理员审核', icon: 'success' })
              })
              .catch(err => {
                wx.hideLoading()
                this.setData({ publishing: false })
                cloud.toastError(err)
              })
          }
        })
      }
    })
  },

  onDelete() {
    wx.showModal({
      title: '删除记录',
      content: '确定删除这条问诊记录吗？',
      confirmColor: '#D9534F',
      success: res => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中' })
        cloud
          .deleteRecord(this.data.id)
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已删除', icon: 'success' })
            setTimeout(() => wx.navigateBack(), 700)
          })
          .catch(e => {
            wx.hideLoading()
            cloud.toastError(e)
          })
      }
    })
  },

  // 分享 AI 分诊报告
  onShareAppMessage() {
    const rec = this.data.record || {}
    return {
      title: (rec.petName ? rec.petName + ' · ' : '') + (rec.title || 'AI 分诊报告'),
      path: '/pages/recordDetail/recordDetail?id=' + this.data.id
    }
  },

  onShareTimeline() {
    const rec = this.data.record || {}
    return {
      title: (rec.petName ? rec.petName + ' · ' : '') + (rec.title || 'AI 分诊报告'),
      query: 'id=' + this.data.id
    }
  }
})
