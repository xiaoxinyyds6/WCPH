const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

Page({
  // ===== 分享给好友 / 朋友圈 =====
  onShareAppMessage() {
    return { title: '疫苗驱虫提醒 · 养宠必备', path: '/pages/reminders/reminders' }
  },
  onShareTimeline() {
    return { title: '疫苗驱虫提醒 · 养宠必备' }
  },
  data: {
    logged: false,
    tab: 'pending',
    pendingList: [],
    doneList: [],
    loading: true
  },

  onShow() {
    const logged = getApp().isLoggedIn()
    this.setData({ logged })
    if (logged) this.load()
    else this.setData({ loading: false, pendingList: [], doneList: [] })
  },

  onPullDownRefresh() {
    if (!this.data.logged) {
      wx.stopPullDownRefresh()
      return
    }
    this.load().then(() => wx.stopPullDownRefresh())
  },

  load() {
    this.setData({ loading: true })
    return cloud
      .listReminders()
      .then(list => {
        const items = (list || []).map(r => {
          try {
            const meta = util.reminderTypeMeta(r.type)
            return Object.assign({}, r, {
              typeLabel: meta.label,
              typeEmoji: meta.emoji,
              dueText: util.reminderDueText(r.dueAt),
              dateText: util.formatDate(r.dueAt),
              repeatText: util.reminderRepeatLabel(r.repeat)
            })
          } catch (e) {
            // 单条数据异常不影响整页渲染
            console.warn('[reminders] 单条提醒渲染失败', e)
            return Object.assign({}, r, {
              typeLabel: '提醒',
              typeEmoji: '⏰',
              dueText: '',
              dateText: '',
              repeatText: ''
            })
          }
        })
        this.setData({
          pendingList: items.filter(r => r.status === 'pending' || r.status === 'expired'),
          doneList: items.filter(r => r.status === 'done' || r.status === 'skipped'),
          loading: false
        })
      })
      .catch(err => {
        this.setData({ loading: false })
        cloud.toastError(err)
      })
  },

  onTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab })
  },

  onCreate() {
    if (!getApp().requireLogin()) return
    wx.navigateTo({ url: '/pages/reminderEdit/reminderEdit' })
  },

  onEdit(e) {
    wx.navigateTo({ url: '/pages/reminderEdit/reminderEdit?id=' + e.currentTarget.dataset.id })
  },

  onComplete(e) {
    this.act(e.currentTarget.dataset.id, cloud.completeReminder, '已完成')
  },

  onSkip(e) {
    this.act(e.currentTarget.dataset.id, cloud.skipReminder, '已跳过')
  },

  onReopen(e) {
    this.act(e.currentTarget.dataset.id, cloud.reopenReminder, '已恢复待办')
  },

  act(id, fn, toast) {
    wx.showLoading({ title: '处理中', mask: true })
    fn(id)
      .then(() => {
        wx.hideLoading()
        wx.showToast({ title: toast, icon: 'none' })
        this.load()
      })
      .catch(err => {
        wx.hideLoading()
        cloud.toastError(err)
      })
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除提醒',
      content: '确定删除这条提醒吗？',
      confirmColor: '#D9534F',
      success: res => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中' })
        cloud
          .deleteReminder(id)
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已删除', icon: 'success' })
            this.load()
          })
          .catch(err => {
            wx.hideLoading()
            cloud.toastError(err)
          })
      }
    })
  }
})
