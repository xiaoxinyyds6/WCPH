const cloud = require('../../utils/cloud')

Page({
  // ===== 分享给好友 / 朋友圈 =====
  onShareAppMessage() {
    return { title: 'AI宠物助手', path: '/pages/consult/consult' }
  },
  onShareTimeline() {
    return { title: 'AI宠物助手' }
  },
  data: {
    username: '',
    password: '',
    showPwd: false,
    saving: false
  },

  onUsernameInput(e) {
    this.setData({ username: e.detail.value })
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value })
  },

  togglePwd() {
    this.setData({ showPwd: !this.data.showPwd })
  },

  doLogin() {
    if (this.data.saving) return
    const username = this.data.username.trim()
    const password = this.data.password
    if (!username) {
      wx.showToast({ title: '请输入管理员账号', icon: 'none' })
      return
    }
    if (!password) {
      wx.showToast({ title: '请输入密码', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    wx.showLoading({ title: '登录中', mask: true })
    cloud
      .adminLogin(username, password)
      .then(info => {
        getApp().setAdminLogin(info)
        wx.hideLoading()
        this.setData({ saving: false })
        // 立即跳转管理员后台（redirectTo 失败时兜底 navigateTo）
        wx.redirectTo({
          url: '/pages/admin/admin',
          fail: () => {
            wx.navigateTo({ url: '/pages/admin/admin' })
          }
        })
      })
      .catch(err => {
        wx.hideLoading()
        this.setData({ saving: false })
        cloud.toastError(err)
      })
  }
})
