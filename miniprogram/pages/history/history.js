const util = require('../../utils/util')
const history = require('../../utils/history')

const KIND_EMOJI = { 猫: '🐱', 狗: '🐶', 兔: '🐰', 鸟: '🐦', 仓鼠: '🐹', 乌龟: '🐢' }

Page({
  // ===== 分享给好友 / 朋友圈 =====
  onShareAppMessage() {
    return { title: 'AI宠物助手 · 健康档案', path: '/pages/mine/mine' }
  },
  onShareTimeline() {
    return { title: 'AI宠物助手 · 健康档案' }
  },
  data: {
    list: [],
    selecting: false,
    selectedIds: [],
    deleting: false
  },

  onShow() {
    this.load()
  },

  load() {
    const list = history
      .list()
      .map(p =>
        Object.assign({}, p, {
          kindEmoji: KIND_EMOJI[p.petKind] || '🐾',
          timeText: util.formatDateTime(p.viewedAt || p.createdAt),
          selected: false
        })
      )
    this.setData({ list, selecting: false, selectedIds: [], deleting: false })
  },

  onToggleSelectMode() {
    if (this.data.deleting || (!this.data.selecting && !this.data.list.length)) return
    this.setData({
      selecting: !this.data.selecting,
      selectedIds: [],
      list: this.data.list.map(p => Object.assign({}, p, { selected: false }))
    })
  },

  onTap(e) {
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
    const list = this.data.list.map(p =>
      p._id === id ? Object.assign({}, p, { selected: index < 0 }) : p
    )
    this.setData({ list, selectedIds })
  },

  onDeleteSelected() {
    if (!this.data.selectedIds.length || this.data.deleting) return
    wx.showModal({
      title: '删除历史浏览记录',
      content: '确认删除历史浏览记录吗？',
      cancelText: '取消',
      confirmText: '确认',
      confirmColor: '#D9534F',
      success: res => {
        if (!res.confirm) return
        const ids = this.data.selectedIds.slice()
        history.remove(ids)
        this.setData({
          list: this.data.list.filter(p => ids.indexOf(p._id) < 0),
          selecting: false,
          selectedIds: []
        })
        wx.showToast({ title: '删除成功', icon: 'none', duration: 2000 })
      }
    })
  },

  onClear() {
    wx.showModal({
      title: '清空浏览记录',
      content: '确定清空全部历史浏览记录吗？',
      cancelText: '取消',
      confirmText: '确认',
      confirmColor: '#D9534F',
      success: res => {
        if (!res.confirm) return
        history.clear()
        this.setData({ list: [], selecting: false, selectedIds: [] })
        wx.showToast({ title: '删除成功', icon: 'none', duration: 2000 })
      }
    })
  }
})
