const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

const REMEMBER_KEY = 'remember_phone'

Page({
  data: {
    phone: '',
    code: '',
    remember: false,
    countdown: 0,
    codeText: '获取验证码',
    saving: false
  },

  _timer: null,

  onLoad() {
    const saved = wx.getStorageSync(REMEMBER_KEY)
    if (saved) {
      this.setData({ phone: saved, remember: true })
    }
  },

  onUnload() {
    this.clearTimer()
  },

  onPhoneInput(e) {
    this.setData({ phone: e.detail.value })
  },

  onCodeInput(e) {
    this.setData({ code: e.detail.value })
  },

  toggleRemember() {
    const remember = !this.data.remember
    this.setData({ remember })
    if (remember) {
      if (this.data.phone) wx.setStorageSync(REMEMBER_KEY, this.data.phone)
    } else {
      wx.removeStorageSync(REMEMBER_KEY)
    }
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
      const c = this.data.countdown - 1
      if (c <= 0) {
        this.clearTimer()
        this.setData({ countdown: 0, codeText: '重新获取' })
      } else {
        this.setData({ countdown: c, codeText: c + 's' })
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
    if (this.data.remember) wx.setStorageSync(REMEMBER_KEY, phone)
    cloud
      .sendCode(phone)
      .then(res => {
        this.startCountdown()
        // 演示环境无短信服务商，验证码由云函数回传后本地提示
        wx.showModal({
          title: '验证码已发送',
          content: '演示环境验证码：' + ((res && res.code) || '------'),
          showCancel: false,
          confirmText: '知道了'
        })
      })
      .catch(cloud.toastError)
  },

  finishLogin(userInfo) {
    getApp().setLogin(userInfo)
    wx.showToast({ title: '登录成功', icon: 'success' })
    setTimeout(() => {
      const pages = getCurrentPages()
      if (pages.length > 1) {
        wx.navigateBack()
      } else {
        wx.switchTab({ url: '/pages/mine/mine' })
      }
    }, 800)
  },

  // 演示登录：跳过验证码，本地写入登录态，便于预览登录后的页面
  demoLogin() {
    this.finishLogin({
      openid: 'demo_' + Date.now(),
      nickname: '演示用户',
      phone: '13800000000'
    })
  },

  doLogin() {
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
    this.setData({ saving: true })
    cloud
      .smsLogin(phone, code)
      .then(userInfo => {
        this.setData({ saving: false })
        this.finishLogin(userInfo)
      })
      .catch(err => {
        this.setData({ saving: false })
        cloud.toastError(err)
      })
  },

  onGetPhone(e) {
    if (!e.detail || !e.detail.cloudID) {
      wx.showToast({ title: '已取消授权', icon: 'none' })
      return
    }
    wx.showLoading({ title: '登录中' })
    cloud
      .phoneLogin(e.detail.cloudID)
      .then(userInfo => {
        wx.hideLoading()
        this.finishLogin(userInfo)
      })
      .catch(err => {
        wx.hideLoading()
        cloud.toastError(err)
      })
  }
})
