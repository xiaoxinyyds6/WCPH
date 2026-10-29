const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

const REMEMBER_KEY = 'remember_phone'

// 协议正文（分段展示）
const AGREEMENTS = {
  user: [
    { h: '一、服务性质', p: '本小程序为宠物健康管理工具，AI 问诊仅提供基于描述与图片的初步健康评估和护理建议，不构成医疗诊断、不开具处方，不能替代执业兽医的现场诊疗。宠物出现急症（呼吸困难、大出血、误食异物、抽搐等）时，请立即前往线下宠物医院。' },
    { h: '二、账号与使用', p: '您可通过手机号验证码、账号密码或微信授权方式登录。请使用本人真实手机号注册，并妥善保管账号密码，因账号保管不善造成的损失由您自行承担。' },
    { h: '三、用户行为规范', p: '您在社区发布的内容应遵守法律法规及公序良俗，禁止发布广告引流、辱骂攻击、虚假信息、虐待动物及其他与宠物健康无关的内容。所有帖子需经管理员审核，违规内容将被拒绝发布或下架，情节严重者账号可能被限制使用。' },
    { h: '四、内容授权', p: '您发布的问诊记录与帖子仅展示脱敏后的内容（不含您的真实姓名、手机号等隐私信息）。您同意平台在社区内展示、审核该等内容。' },
    { h: '五、免责声明', p: 'AI 生成内容可能存在偏差，仅供健康参考。您基于 AI 建议做出的任何决策及其后果由您自行承担。' },
    { h: '六、协议变更', p: '我们可能不定期更新本协议，更新后将在页面公示。继续使用即视为您接受更新后的协议。' }
  ],
  privacy: [
    { h: '一、我们收集的信息', p: '为提供服务，我们会收集：微信用户标识（openid）、手机号、您主动填写的宠物档案（品种、年龄、体重、疫苗驱虫情况）、问诊对话记录与上传的照片/视频。' },
    { h: '二、信息用途', p: '收集的信息仅用于：身份识别与账号体系、AI 健康评估、疫苗驱虫到期提醒推送、社区内容展示（脱敏处理）与违规审核。' },
    { h: '三、存储与安全', p: '数据存储于腾讯云开发环境，密码经加盐哈希加密存储，不保存明文。我们采取合理的安全措施防止信息泄露、篡改或丢失。' },
    { h: '四、第三方服务', p: 'AI 问诊内容将交由智谱 AI 大模型处理以生成回答，仅用于本次问诊；发布内容会经微信内容安全接口检测。上述第三方均按其隐私规范处理数据。' },
    { h: '五、您的权利', p: '您可随时在"我的"页面删除宠物档案、问诊记录、帖子与收藏等内容；注销需求可联系管理员处理。' },
    { h: '六、未成年人保护', p: '若您为未满 14 周岁的未成年人，请在监护人陪同下使用本小程序。' }
  ]
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
    loginTab: 'phone',
    phone: '',
    code: '',
    username: '',
    password: '',
    showPwd: false,
    remember: false,
    agreed: false,
    countdown: 0,
    codeText: '获取验证码',
    saving: false,
    wxSaving: false,
    // 协议弹窗
    showAgreement: false,
    agreementType: 'user',
    agreementSections: []
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

  switchTab(e) {
    this.setData({ loginTab: e.currentTarget.dataset.tab })
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

  onPhoneInput(e) {
    this.setData({ phone: e.detail.value })
  },

  onCodeInput(e) {
    this.setData({ code: e.detail.value })
  },

  onToggleAgreement() {
    this.setData({ agreed: !this.data.agreed })
  },

  // 打开协议弹窗（用户协议 / 隐私政策）
  onOpenAgreement(e) {
    const type = e.currentTarget.dataset.type === 'privacy' ? 'privacy' : 'user'
    this.setData({ showAgreement: true, agreementType: type, agreementSections: AGREEMENTS[type] })
  },

  // 拒绝：关闭弹窗并取消勾选
  onAgreementReject() {
    this.setData({ showAgreement: false, agreed: false })
  },

  // 同意：关闭弹窗并勾选协议
  onAgreementAccept() {
    this.setData({ showAgreement: false, agreed: true })
  },

  noop() {},

  showAgreementToast() {
    wx.showToast({
      title: '先阅读并同意《用户协议》与《隐私政策》',
      icon: 'none',
      duration: 2000
    })
  },

  ensureAgreement() {
    if (this.data.agreed) return true
    this.showAgreementToast()
    return false
  },

  // 微信一键登录：不获取手机号，仅以 openid 建立/登录账户
  onWxLoginTap() {
    if (!this.ensureAgreement() || this.data.wxSaving) return
    this.setData({ wxSaving: true })
    wx.showLoading({ title: '微信登录中', mask: true })
    cloud
      .wxLogin()
      .then(userInfo => {
        if (!userInfo || !userInfo.openid) throw new Error('微信登录信息不完整，请重试')
        wx.hideLoading()
        this.setData({ wxSaving: false })
        this.finishLogin(userInfo)
      })
      .catch(err => {
        wx.hideLoading()
        this.setData({ wxSaving: false })
        cloud.toastError(err)
      })
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
        wx.switchTab({ url: '/pages/consult/consult' })
      }
    }, 800)
  },

  doLogin() {
    if (!this.ensureAgreement()) return
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
      .then(result => {
        this.setData({ saving: false })
        if (result && result.needSetPassword) {
          wx.showModal({
            title: '提示',
            content: '该手机号是第一次注册，请先设置密码',
            showCancel: false,
            confirmText: '确定',
            success: res => {
              if (res.confirm) {
                // 等弹窗完全关闭后再跳转，避免弹窗与页面过渡动画叠加导致渲染异常
                setTimeout(() => {
                  wx.navigateTo({
                    url: '/pages/setPassword/setPassword?mode=register&phone=' + phone + '&code=' + code
                  })
                }, 300)
              }
            }
          })
          return
        }
        const userInfo = result && result.userInfo
        if (!userInfo || !userInfo.openid) throw new Error('登录信息不完整，请重试')
        this.finishLogin(userInfo)
      })
      .catch(err => {
        this.setData({ saving: false })
        cloud.toastError(err)
      })
  },

  // 账号密码登录（账号由管理员在后台创建）
  doAccountLogin() {
    if (!this.ensureAgreement()) return
    const username = this.data.username.trim()
    const password = this.data.password
    if (!util.isValidPhone(username)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    if (!password) {
      wx.showToast({ title: '请输入密码', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    cloud
      .accountLogin(username, password)
      .then(userInfo => {
        this.setData({ saving: false })
        this.finishLogin(userInfo)
      })
      .catch(err => {
        this.setData({ saving: false })
        cloud.toastError(err)
      })
  },

  onForgotPassword() {
    wx.navigateTo({ url: '/pages/forgotPassword/forgotPassword' })
  },

  // 管理员登录入口
  onAdminLogin() {
    wx.navigateTo({ url: '/pages/adminLogin/adminLogin' })
  }
})
