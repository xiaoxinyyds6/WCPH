const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

// 消息类型展示配置
const TYPE_META = {
  comment: { icon: '💬', title: '有人评论了你的帖子' },
  like: { icon: '❤️', title: '有人赞了你的帖子' },
  audit: { icon: '📢', title: '审核结果通知' },
  auditing: { icon: '⏳', title: '帖子审核中' }
}

Page({
  // ===== 分享给好友 / 朋友圈 =====
  onShareAppMessage() {
    return { title: 'AI宠物助手 · 消息中心', path: '/pages/consult/consult' }
  },
  onShareTimeline() {
    return { title: 'AI宠物助手 · 消息中心' }
  },
  data: {
    list: [],
    loading: true
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh())
  },

  load() {
    this.setData({ loading: true })
    return cloud
      .squareNotifications()
      .then(res => {
        const list = ((res && res.list) || []).map(n => {
          const meta = TYPE_META[n.type] || TYPE_META.like
          return {
            _id: n._id,
            type: n.type,
            icon: meta.icon,
            title: meta.title,
            postTitle: n.postTitle || '帖子',
            content: n.content || '',
            timeText: util.formatDateTime(n.createdAt),
            postId: n.postId,
            read: !!n.read,
            auditing: n.type === 'auditing'
          }
        })
        this.setData({ list, loading: false })
        // 展示后把未读的全部标记为已读（"审核中"是动态消息，无需标记）
        const unreadIds = list.filter(x => !x.read && x.type !== 'auditing').map(x => x._id)
        if (unreadIds.length) {
          cloud.squareReadNotifications(unreadIds).catch(() => {})
        }
      })
      .catch(err => {
        this.setData({ loading: false })
        cloud.toastError(err)
      })
  },

  // 点击消息：审核类消息跳帖子详情（可查看状态/修改），互动消息跳广场定位
  onTap(e) {
    const pid = e.currentTarget.dataset.pid
    const type = e.currentTarget.dataset.type
    if (!pid) {
      wx.showToast({ title: '该消息未关联帖子', icon: 'none' })
      return
    }
    if (type === 'auditing' || type === 'audit') {
      wx.navigateTo({ url: '/pages/postDetail/postDetail?id=' + pid })
      return
    }
    getApp()._squareTargetPostId = pid
    wx.switchTab({ url: '/pages/square/square' })
  }
})
