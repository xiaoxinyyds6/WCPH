const cloud = require('../../utils/cloud')

function validPassword(password) {
  return password.length >= 8 && password.length <= 14 && /^(?=.*[A-Za-z])(?=.*\d)\S+$/.test(password)
}

Page({
  // ===== 分享给好友 / 朋友圈 =====
  onShareAppMessage() {
    return { title: 'AI宠物助手 · 智能守护每一位毛孩子', path: '/pages/consult/consult' }
  },
  onShareTimeline() {
    return { title: 'AI宠物助手 · 智能守护每一位毛孩子' }
  },
  data: {
    mode: 'register',
    phone: '',
    code: '',
    password: '',
    confirmPassword: '',
    showPwd: false,
    showConfirmPwd: false,
    pwdStrength: '',
    saving: false
  },

  onLoad(options) {
    const mode = options && options.mode === 'reset' ? 'reset' : 'register'
    this.setData({
      mode,
      phone: (options && options.phone) || '',
      code: (options && options.code) || ''
    })
    wx.setNavigationBarTitle({ title: mode === 'reset' ? '重置密码' : '设置密码' })
  },

  onPasswordInput(e) {
    const password = e.detail.value
    // 达到基础规则（8-14位、含英文和数字）后评估强度：含特殊字符为可靠，否则为一般
    let pwdStrength = ''
    if (validPassword(password)) {
      pwdStrength = /[^A-Za-z0-9]/.test(password) ? 'strong' : 'medium'
    }
    this.setData({ password, pwdStrength })
  },

  onConfirmPasswordInput(e) {
    this.setData({ confirmPassword: e.detail.value })
  },

  togglePwd() {
    this.setData({ showPwd: !this.data.showPwd })
  },

  toggleConfirmPwd() {
    this.setData({ showConfirmPwd: !this.data.showConfirmPwd })
  },

  onSubmit() {
    if (this.data.saving) return
    const password = this.data.password
    const confirmPassword = this.data.confirmPassword
    if (!password) {
      wx.showToast({ title: '请输入密码', icon: 'none' })
      return
    }
    if (!validPassword(password)) {
      wx.showToast({ title: '密码需为8-14位，且同时包含英文和数字', icon: 'none' })
      return
    }
    if (password !== confirmPassword) {
      wx.showToast({ title: '两次输入的密码不一致', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    cloud
      .setPassword(this.data.phone, this.data.code, password, this.data.mode)
      .then(result => {
        const userInfo = result && result.userInfo
        if (!userInfo || !userInfo.openid) throw new Error('密码设置成功，但登录信息不完整')
        if (this.data.mode === 'reset') {
          wx.showToast({ title: '密码重置成功', icon: 'success' })
          setTimeout(() => wx.navigateBack({ delta: 2 }), 800)
          return
        }
        getApp().setLogin(userInfo)
        wx.showToast({ title: '密码设置成功', icon: 'success' })
        setTimeout(() => wx.switchTab({ url: '/pages/consult/consult' }), 800)
      })
      .catch(err => {
        this.setData({ saving: false })
        cloud.toastError(err)
      })
  }
})
