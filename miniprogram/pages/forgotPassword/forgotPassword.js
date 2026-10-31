const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

Page({
  // ===== 分享给好友 / 朋友圈 =====
  onShareAppMessage() {
    return { title: 'AI宠物助手 · 智能守护每一位毛孩子', path: '/pages/consult/consult' }
  },
  onShareTimeline() {
    return { title: 'AI宠物助手 · 智能守护每一位毛孩子' }
  },
  data: {
    phone: '',
    code: '',
    countdown: 0,
    codeText: '获取验证码',
    verifying: false
  },

  _timer: null,

  onUnload() {
    this.clearTimer()
  },

  onPhoneInput(e) {
    this.setData({ phone: e.detail.value })
  },

  onCodeInput(e) {
    this.setData({ code: e.detail.value })
  },

  clearTimer() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  },

  startCountdown() {
    this.clearTimer()
    this.setData({ countdown: 60, codeText: '60s' })
    this._timer = setInterval(() => {
      const countdown = this.data.countdown - 1
      if (countdown <= 0) {
        this.clearTimer()
        this.setData({ countdown: 0, codeText: '重新获取' })
      } else {
        this.setData({ countdown, codeText: countdown + 's' })
      }
    }, 1000)
  },

  getCode() {
    if (this.data.countdown > 0) return
    const phone = this.data.phone.trim()
    if (!util.isValidPhone(phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    wx.showLoading({ title: '校验中', mask: true })
    cloud
      .checkPhoneRegistered(phone)
      .then(res => {
        wx.hideLoading()
        if (!res || !res.registered) {
          wx.showToast({ title: '该手机号还未被注册使用过', icon: 'none', duration: 2500 })
          return
        }
        return cloud.sendCode(phone).then(res => {
          this.startCountdown()
          wx.showModal({
            title: '验证码已发送',
            content: '演示环境验证码：' + ((res && res.code) || '------'),
            showCancel: false,
            confirmText: '知道了'
          })
        })
      })
      .catch(err => {
        wx.hideLoading()
        cloud.toastError(err)
      })
  },

  onConfirm() {
    if (this.data.verifying) return
    const phone = this.data.phone.trim()
    const code = this.data.code.trim()
    if (!util.isValidPhone(phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    if (!/^\d{6}$/.test(code)) {
      wx.showToast({ title: '请输入6位验证码', icon: 'none' })
      return
    }
    this.setData({ verifying: true })
    cloud
      .verifyCode(phone, code, 'reset')
      .then(() => {
        this.setData({ verifying: false })
        wx.navigateTo({
          url: '/pages/setPassword/setPassword?mode=reset&phone=' + phone + '&code=' + code
        })
      })
      .catch(err => {
        this.setData({ verifying: false })
        cloud.toastError(err)
      })
  }
})
