const cloud = require('../../utils/cloud')
const util = require('../../utils/util')
const history = require('../../utils/history')

const KIND_EMOJI = { 猫: '🐱', 狗: '🐶', 兔: '🐰', 鸟: '🐦', 仓鼠: '🐹', 乌龟: '🐢' }
const REPORT_TYPES = ['广告营销', '辱骂攻击', '虚假信息', '虐宠内容', '其他']

Page({
  data: {
    id: '',
    post: null,
    kindEmoji: '🐾',
    breedText: '',
    timeText: '',
    likedByMe: false,
    likeCount: 0,
    mine: false,
    hasRecord: false,
    commentText: '',
    sending: false,
    // 我的昵称（自己的评论显示账号名，他人评论保持脱敏）
    myName: '我',
    // 评论删除小弹框
    delMenu: { show: false, x: 0, y: 0, id: '' }
  },

  onLoad(options) {
    this.setData({ id: (options && options.id) || '' })
    const user = getApp().getUser() || {}
    this.setData({ myName: user.nickname || '我' })
    this.load()
  },

  // 作者修改待审核/未通过的帖子 → 跳转发帖页编辑模式
  onEditPost() {
    if (!this.data.mine || !this.data.post || this.data.post.audit === 'approved') return
    wx.navigateTo({ url: '/pages/topic/topic?id=' + this.data.id })
  },

  load(silent) {
    const id = this.data.id
    if (!id) return
    if (!silent) wx.showLoading({ title: '加载中' })
    cloud
      .squareGet(id)
      .then(post => {
        if (!silent) wx.hideLoading()
        this.applyPost(post)
      })
      .catch(err => {
        if (!silent) wx.hideLoading()
        cloud.toastError(err)
        setTimeout(() => {
          if (getCurrentPages().length > 1) wx.navigateBack()
          else wx.switchTab({ url: '/pages/square/square' })
        }, 900)
      })
  },

  applyPost(post) {
    if (!post) return
    const openid = getApp().globalData.openid || ''
    const comments = (post.comments || []).map(c =>
      Object.assign({}, c, {
        // 优先用服务端标记（不依赖本地登录态），旧版云函数未返回时按本地 openid 兜底
        mine: c.mine !== undefined ? c.mine : c._openid === openid,
        timeText: util.formatDateTime(c.createdAt)
      })
    )
    this.setData({
      post: Object.assign({}, post, { comments }),
      kindEmoji: KIND_EMOJI[post.petKind] || '🐾',
      breedText: post.petBreed ? ' · ' + post.petBreed : '',
      timeText: util.formatDateTime(post.createdAt),
      likedByMe: (post.likes || []).indexOf(openid) >= 0,
      likeCount: (post.likes || []).length,
      mine: post.mine !== undefined ? post.mine : post._openid === openid,
      hasRecord: !!post.recordId
    })
    // 浏览他人帖子时记入历史浏览记录（自己的帖子不计入）
    const isMine = post.mine !== undefined ? post.mine : post._openid === openid
    if (!isMine && post._id) history.record(post)
  },

  onPreviewImage() {
    const post = this.data.post
    if (post && post.image) wx.previewImage({ urls: [post.image], current: post.image })
  },

  onLike() {
    if (!getApp().requireLogin()) return
    const likedByMe = !this.data.likedByMe
    this.setData({
      likedByMe,
      likeCount: this.data.likeCount + (likedByMe ? 1 : -1)
    })
    cloud.squareLike(this.data.id).catch(err => {
      console.warn('[square] like sync failed', err)
      this.load()
    })
  },

  onCommentInput(e) {
    this.setData({ commentText: e.detail.value })
  },

  onCommentSend() {
    if (!getApp().requireLogin()) return
    if (this.data.sending) return
    const content = this.data.commentText.trim()
    if (!content) {
      wx.showToast({ title: '请输入评论内容', icon: 'none' })
      return
    }
    this.setData({ sending: true })
    cloud
      .squareComment(this.data.id, content)
      .then(() => {
        this.setData({ sending: false, commentText: '' })
        wx.showToast({ title: '评论成功', icon: 'none' })
        // 静默刷新，避免加载框顶掉提示
        this.load(true)
      })
      .catch(err => {
        this.setData({ sending: false })
        cloud.toastError(err)
      })
  },

  // 长按评论：自己的评论或自己帖子下的任何评论，弹删除小框
  onCommentLongPress(e) {
    const { id, mine: cmine } = e.currentTarget.dataset
    const post = this.data.post || {}
    const canDelete = cmine === '1' || post.mine
    if (!canDelete) return
    const t = (e.touches && e.touches[0]) || {}
    this.setData({
      delMenu: {
        show: true,
        x: t.clientX || 200,
        y: t.clientY || 300,
        id: String(id)
      }
    })
  },

  onCloseDelMenu() {
    this.setData({ delMenu: { show: false, x: 0, y: 0, id: '' } })
  },

  noop() {},

  // 确认删除评论
  onConfirmDelete() {
    const commentId = this.data.delMenu.id
    if (!commentId) return
    this.onCloseDelMenu()
    wx.showLoading({ title: '删除中', mask: true })
    cloud
      .squareDeleteComment(this.data.id, commentId)
      .then(() => {
        wx.hideLoading()
        wx.showToast({ title: '删除成功', icon: 'success' })
        // 静默刷新，避免加载框顶掉"删除成功"提示
        this.load(true)
      })
      .catch(err => {
        wx.hideLoading()
        cloud.toastError(err)
      })
  },

  onReport() {
    if (!getApp().requireLogin()) return
    wx.showActionSheet({
      itemList: REPORT_TYPES,
      success: res => {
        const type = REPORT_TYPES[res.tapIndex]
        wx.showModal({
          title: '举报该帖子',
          content: '举报类型：' + type,
          editable: true,
          placeholderText: '可补充说明举报原因（选填）',
          success: r => {
            if (!r.confirm) return
            wx.showLoading({ title: '提交中', mask: true })
            cloud
              .squareReport(this.data.id, type, r.content || '')
              .then(() => {
                wx.hideLoading()
                wx.showToast({ title: '已提交举报，感谢反馈', icon: 'none' })
              })
              .catch(err => {
                wx.hideLoading()
                cloud.toastError(err)
              })
          }
        })
      }
    })
  },

  onViewReport() {
    const recordId = this.data.post && this.data.post.recordId
    if (recordId) {
      wx.navigateTo({ url: '/pages/recordDetail/recordDetail?id=' + recordId })
    }
  },

  onDelete() {
    wx.showModal({
      title: '删除帖子',
      content: '确定删除该帖子吗？删除后不可恢复。',
      confirmColor: '#D9534F',
      success: res => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中' })
        cloud
          .squareRemove(this.data.id)
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已删除', icon: 'success' })
            setTimeout(() => wx.navigateBack(), 700)
          })
          .catch(err => {
            wx.hideLoading()
            cloud.toastError(err)
          })
      }
    })
  },

  onShareAppMessage() {
    const post = this.data.post || {}
    return {
      title: post.title || '宠物问诊求助',
      path: '/pages/postDetail/postDetail?id=' + this.data.id
    }
  },

  onShareTimeline() {
    const post = this.data.post || {}
    return {
      title: post.title || '宠物问诊求助',
      query: 'id=' + this.data.id
    }
  }
})
