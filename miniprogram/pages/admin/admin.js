const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

const KIND_EMOJI = { 猫: '🐱', 狗: '🐶', 兔: '🐰', 鸟: '🐦', 仓鼠: '🐹', 乌龟: '🐢' }

Page({
  // ===== 分享给好友 / 朋友圈 =====
  onShareAppMessage() {
    return { title: 'AI宠物助手', path: '/pages/consult/consult' }
  },
  onShareTimeline() {
    return { title: 'AI宠物助手' }
  },
  data: {
    tab: 'accounts',
    posts: [],
    pendingPosts: [],
    loadingAudit: false,
    reports: [],
    accounts: [],
    stats: { users: 0, pets: 0, records: 0, posts: 0 },
    recentUsers: [],
    newAccount: { username: '', password: '', nickname: '' },
    showAccPwd: false,
    accPwdStrength: '',
    petKinds: Object.keys(KIND_EMOJI),
    officialForm: { petKind: '猫', petBreed: '', title: '', excerpt: '' },
    publishingOfficial: false,
    // 知识库（RAG 私有知识库）
    kbDocs: [],
    kbForm: { title: '', tags: '', content: '' },
    addingKb: false,
    loadingKb: false,
    loading: true,
    loadingAccounts: false,
    loadingStats: false,
    addingAccount: false,
    isAdmin: false
  },

  onLoad() {
    // 本地管理员登录态优先：登录成功后直接进后台，云端校验后台异步复核
    if (getApp().isAdminLoggedIn()) {
      this.setData({ isAdmin: true, loading: false })
      this.loadTabData()
      cloud
        .squareAmIAdmin()
        .then(res => {
          if (!(res && res.isAdmin)) {
            // 云端判定不一致时以本地为准，但仍提示可能需重新部署云函数
            console.warn('[admin] 云端未识别当前账号为管理员，请确认 login/square 云函数已重新部署')
          }
        })
        .catch(() => {})
      return
    }
    cloud
      .squareAmIAdmin()
      .then(res => {
        this.setData({ isAdmin: !!(res && res.isAdmin) })
        if (res && res.isAdmin) this.loadTabData()
        else this.setData({ loading: false })
      })
      .catch(() => this.setData({ loading: false, isAdmin: false }))
  },

  onPullDownRefresh() {
    if (!this.data.isAdmin) {
      wx.stopPullDownRefresh()
      return
    }
    this.loadTabData().then(() => wx.stopPullDownRefresh())
  },

  onTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ tab })
    this.loadTabData()
  },

  // 按当前标签懒加载数据；徽标数字不依赖 tab 切换，进入页面即并行加载全部计数
  loadTabData() {
    const badges = Promise.all([this.loadAll(), this.loadPending()])
    const t = this.data.tab
    if (t === 'accounts') {
      return Promise.all([badges, this.loadAccounts()])
    }
    if (t === 'posts' || t === 'reports' || t === 'audit') return badges
    if (t === 'kb') return Promise.all([badges, this.loadKb()])
    if (t === 'stats') return Promise.all([badges, this.loadStats()])
    return badges
  },

  // 加载待审核帖子列表
  loadPending() {
    this.setData({ loadingAudit: true })
    return cloud
      .squareAdminPendingList()
      .then(list => {
        const pendingPosts = (list || []).map(p =>
          Object.assign({}, p, {
            timeText: util.formatDateTime(p.createdAt),
            kindEmoji: KIND_EMOJI[p.petKind] || '🐾'
          })
        )
        this.setData({ pendingPosts, loadingAudit: false })
      })
      .catch(err => {
        this.setData({ loadingAudit: false })
        cloud.toastError(err)
      })
  },

  // 审核通过：帖子进入问诊广场展示
  onApprovePost(e) {
    this.auditPost(e.currentTarget.dataset.id, 'approved', '同意发布该帖子？')
  },

  // 审核拒绝：帖子不会出现在问诊广场
  onRejectPost(e) {
    this.auditPost(e.currentTarget.dataset.id, 'rejected', '拒绝发布该帖子？作者将收到未通过通知。')
  },

  auditPost(id, result, tip) {
    if (!id || this._auditing) return
    wx.showModal({
      title: result === 'approved' ? '同意发布' : '拒绝发布',
      content: tip,
      confirmColor: result === 'approved' ? '#4CAF7D' : '#D9534F',
      success: res => {
        if (!res.confirm) return
        this._auditing = true
        wx.showLoading({ title: '处理中' })
        cloud
          .squareAdminAudit(id, result)
          .then(() => {
            wx.hideLoading()
            this._auditing = false
            wx.showToast({ title: result === 'approved' ? '已同意发布' : '已拒绝', icon: 'success' })
            this.loadPending()
          })
          .catch(err => {
            wx.hideLoading()
            this._auditing = false
            cloud.toastError(err)
          })
      }
    })
  },

  loadAccounts() {
    this.setData({ loadingAccounts: true })
    return cloud
      .adminListAccounts()
      .then(list => {
        const accounts = (list || []).map(a =>
          Object.assign({}, a, { timeText: util.formatDateTime(a.createdAt) })
        )
        this.setData({ accounts, loadingAccounts: false })
      })
      .catch(err => {
        this.setData({ loadingAccounts: false })
        cloud.toastError(err)
      })
  },

  loadStats() {
    this.setData({ loadingStats: true })
    return cloud
      .adminStats()
      .then(res => {
        const recentUsers = ((res && res.recentUsers) || []).map(u =>
          Object.assign({}, u, { timeText: util.formatDateTime(u.createdAt) })
        )
        this.setData({
          stats: (res && res.stats) || this.data.stats,
          recentUsers,
          loadingStats: false
        })
      })
      .catch(err => {
        this.setData({ loadingStats: false })
        cloud.toastError(err)
      })
  },

  loadAll() {
    this.setData({ loading: true })
    const p1 = cloud
      .squareAdminPosts()
      .then(list => {
        const posts = (list || []).map(p =>
          Object.assign({}, p, {
            timeText: util.formatDateTime(p.createdAt),
            kindEmoji: KIND_EMOJI[p.petKind] || '🐾'
          })
        )
        this.setData({ posts })
      })
      .catch(cloud.toastError)
    const p2 = cloud
      .squareAdminReports()
      .then(list => {
        const reports = (list || []).map(r =>
          Object.assign({}, r, {
            timeText: util.formatDateTime(r.createdAt),
            statusText: r.status === 'handled' ? '已处理' : '待处理'
          })
        )
        this.setData({ reports })
      })
      .catch(cloud.toastError)
    return Promise.all([p1, p2]).then(() => this.setData({ loading: false }))
  },

  onAccountInput(e) {
    const key = e.currentTarget.dataset.key
    const value = e.detail.value
    const patch = { ['newAccount.' + key]: value }
    if (key === 'password') {
      // 达到基础规则（8-14位、含英文和数字）后评估强度：含特殊字符为可靠，否则为一般
      const base = value.length >= 8 && value.length <= 14 && /^(?=.*[A-Za-z])(?=.*\d)\S+$/.test(value)
      patch.accPwdStrength = base ? (/[^A-Za-z0-9]/.test(value) ? 'strong' : 'medium') : ''
    }
    this.setData(patch)
  },

  toggleAccPwd() {
    this.setData({ showAccPwd: !this.data.showAccPwd })
  },

  // ===== 官方好帖发布 =====
  onOffKind(e) {
    this.setData({ 'officialForm.petKind': e.currentTarget.dataset.kind })
  },

  onOffInput(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ ['officialForm.' + key]: e.detail.value })
  },

  onPublishOfficial() {
    if (this.data.publishingOfficial) return
    const f = this.data.officialForm
    if (!f.title.trim() || !f.excerpt.trim()) {
      wx.showToast({ title: '请填写标题和内容', icon: 'none' })
      return
    }
    this.setData({ publishingOfficial: true })
    cloud
      .squareAdminPublishOfficial({
        petKind: f.petKind,
        petBreed: f.petBreed.trim(),
        title: f.title.trim(),
        excerpt: f.excerpt.trim()
      })
      .then(() => {
        this.setData({
          publishingOfficial: false,
          officialForm: { petKind: f.petKind, petBreed: '', title: '', excerpt: '' }
        })
        wx.showToast({ title: '官方好帖已发布', icon: 'success' })
      })
      .catch(err => {
        this.setData({ publishingOfficial: false })
        cloud.toastError(err)
      })
  },

  // ===== 知识库管理（RAG 私有知识库：AI 问诊时检索参考） =====
  loadKb() {
    this.setData({ loadingKb: true })
    return cloud
      .kbList()
      .then(list => {
        const kbDocs = (list || []).map(d =>
          Object.assign({}, d, { timeText: util.formatDateTime(d.createdAt) })
        )
        this.setData({ kbDocs, loadingKb: false })
      })
      .catch(err => {
        this.setData({ loadingKb: false })
        cloud.toastError(err)
      })
  },

  onKbInput(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ ['kbForm.' + key]: e.detail.value })
  },

  onAddKb() {
    if (this.data.addingKb) return
    const f = this.data.kbForm
    if (!f.title.trim() || !f.content.trim()) {
      wx.showToast({ title: '请填写标题和内容', icon: 'none' })
      return
    }
    this.setData({ addingKb: true })
    cloud
      .kbAdd({ title: f.title.trim(), tags: f.tags.trim(), content: f.content.trim() })
      .then(() => {
        this.setData({ addingKb: false, kbForm: { title: '', tags: '', content: '' } })
        wx.showToast({ title: '知识条目已添加', icon: 'success' })
        this.loadKb()
      })
      .catch(err => {
        this.setData({ addingKb: false })
        cloud.toastError(err)
      })
  },

  onRemoveKb(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除知识条目',
      content: '删除后 AI 问诊将不再参考该条内容，确定删除吗？',
      confirmColor: '#D9534F',
      success: res => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中' })
        cloud
          .kbRemove(id)
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已删除', icon: 'success' })
            this.loadKb()
          })
          .catch(err => {
            wx.hideLoading()
            cloud.toastError(err)
          })
      }
    })
  },

  onAddAccount() {
    const a = this.data.newAccount
    const username = a.username.trim()
    if (!/^1[3-9]\d{9}$/.test(username)) {
      wx.showToast({ title: '请输入正确的11位手机号', icon: 'none' })
      return
    }
    if (!(a.password.length >= 8 && a.password.length <= 14 && /^(?=.*[A-Za-z])(?=.*\d)\S+$/.test(a.password))) {
      wx.showToast({ title: '密码需为8-14位，且同时包含英文和数字', icon: 'none' })
      return
    }
    this.setData({ addingAccount: true })
    cloud
      .adminAddAccount(username, a.password, a.nickname.trim())
      .then(() => {
        this.setData({ addingAccount: false, newAccount: { username: '', password: '', nickname: '' } })
        wx.showToast({ title: '账号已添加', icon: 'success' })
        this.loadAccounts()
      })
      .catch(err => {
        this.setData({ addingAccount: false })
        cloud.toastError(err)
      })
  },

  onRemoveAccount(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除账号',
      content: '确定删除该账号吗？该账号用户将无法再登录。',
      confirmColor: '#D9534F',
      success: res => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中' })
        cloud
          .adminRemoveAccount(id)
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已删除', icon: 'success' })
            this.loadAccounts()
          })
          .catch(err => {
            wx.hideLoading()
            cloud.toastError(err)
          })
      }
    })
  },

  removePost(id) {
    wx.showModal({
      title: '下架帖子',
      content: '确定下架（删除）该帖子吗？',
      confirmColor: '#D9534F',
      success: res => {
        if (!res.confirm) return
        wx.showLoading({ title: '处理中' })
        cloud
          .squareAdminRemove(id)
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已下架', icon: 'success' })
            this.loadAll()
          })
          .catch(err => {
            wx.hideLoading()
            cloud.toastError(err)
          })
      }
    })
  },

  onRemovePost(e) {
    this.removePost(e.currentTarget.dataset.id)
  },

  // 下架帖子：标记为审核不通过并通知作者原因（不物理删除）
  onRemoveReportedPost(e) {
    const id = e.currentTarget.dataset.id
    const rep = (this.data.reports || []).find(r => r._id === id)
    if (!rep) return
    wx.showModal({
      title: '下架帖子',
      content: `确定下架《${rep.postTitle || '未知标题'}》吗？作者将收到下架原因通知。`,
      confirmColor: '#D9534F',
      success: res => {
        if (!res.confirm) return
        wx.showLoading({ title: '处理中' })
        cloud
          .squareAdminHandleReport(id, true, rep.reason)
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已下架并通知作者', icon: 'success' })
            this.loadAll()
          })
          .catch(err => {
            wx.hideLoading()
            cloud.toastError(err)
          })
      }
    })
  },

  onHandleReport(e) {
    const id = e.currentTarget.dataset.id
    const rep = (this.data.reports || []).find(r => r._id === id)
    if (!rep) return
    // 下架时带上举报类型和补充原因，作者可在"我的帖子"和站内消息中看到
    const reasonText = `因收到「${rep.type}」类举报${rep.reason ? '（原因：' + rep.reason + '）' : ''}`
    wx.showModal({
      title: '处理举报',
      content: `是否下架帖子《${rep.postTitle || '未知标题'}》？下架后作者将收到"${reasonText}已被下架"的通知。`,
      confirmText: '下架',
      cancelText: '仅处理',
      confirmColor: '#D9534F',
      success: res => {
        // 确认 = 下架并通知作者；取消 = 仅标记已处理
        cloud
          .squareAdminHandleReport(id, res.confirm, rep.reason)
          .then(() => {
            wx.showToast({ title: res.confirm ? '已下架并通知作者' : '已标记处理', icon: 'none' })
            this.loadAll()
          })
          .catch(cloud.toastError)
      }
    })
  },

  goAdminLogin() {
    wx.navigateTo({ url: '/pages/adminLogin/adminLogin' })
  },

  onLogoutAdmin() {
    wx.showModal({
      title: '退出管理员登录',
      content: '确定退出管理员后台吗？',
      success: res => {
        if (!res.confirm) return
        getApp().logoutAdmin()
        wx.showToast({ title: '已退出', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 600)
      }
    })
  }
})
