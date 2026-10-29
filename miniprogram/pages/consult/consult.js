const cloud = require('../../utils/cloud')

const MAX_PETS = 5

function isImageUrl(a) {
  return typeof a === 'string' && /^(cloud:\/\/|https?:\/\/|\/|wxfile:\/\/)/.test(a)
}

// 首页涉及宠物资料和问诊的功能：未登录时先询问，再由用户决定是否前往登录
function ensureLogin() {
  if (getApp().isLoggedIn()) return true
  wx.showModal({
    title: '登录过期',
    content: '为了账户安全，请重新登录',
    cancelText: '稍后',
    confirmText: '立即登录',
    confirmColor: '#5FA8A0',
    success: res => {
      if (res.confirm) wx.navigateTo({ url: '/pages/login/login' })
    }
  })
  return false
}

Page({
  // ===== 分享给好友 / 朋友圈 =====
  onShareAppMessage() {
    return { title: 'AI宠物问诊 · 24小时在线守护毛孩子', path: '/pages/consult/consult' }
  },
  onShareTimeline() {
    return { title: 'AI宠物问诊 · 24小时在线守护毛孩子' }
  },
  data: {
    pets: [],
    loading: false,
    deleteMode: false,
    tips: [
      {
        icon: '💡',
        title: '评估标准',
        desc: '参考国内外权威兽医学指南，综合症状、病史、生活环境等多维度分析，优先排查高风险疾病。'
      },
      {
        icon: '📝',
        title: '请尽量详细描述',
        desc: '发病时间与频率、异常行为表现、近期饮食及排便情况、疫苗接种史等。'
      },
      {
        icon: '🚨',
        title: '紧急提示',
        desc: '如遇呼吸困难、大出血、误食毒物、抽搐等危急情况，请立即送医！在线咨询仅限轻症或非紧急问题。'
      }
    ]
  },

  onShow() {
    this.setData({ deleteMode: false })
    this.loadPets()
  },

  onPullDownRefresh() {
    this.loadPets().then(() => wx.stopPullDownRefresh())
  },

  loadPets() {
    const app = getApp()
    if (!app.isLoggedIn()) {
      this.setData({ pets: [] })
      return Promise.resolve()
    }
    this.setData({ loading: true })
    return cloud
      .listPets()
      .then(list => {
        const pets = (list || []).map(p =>
          Object.assign({}, p, {
            avatarIsImage: isImageUrl(p.avatar),
            avatarText: p.avatar && !isImageUrl(p.avatar) ? p.avatar : '🐾'
          })
        )
        this.setData({ pets, loading: false })
      })
      .catch(err => {
        this.setData({ loading: false })
        cloud.toastError(err)
      })
  },

  onAddPet() {
    if (this.data.pets.length >= MAX_PETS) {
      wx.showToast({ title: '宠物位置已满，无法继续添加', icon: 'none' })
      return
    }
    if (!ensureLogin()) return
    wx.navigateTo({ url: '/pages/addPet/addPet' })
  },

  onPetTap(e) {
    if (!ensureLogin()) return
    const id = e.currentTarget.dataset.id
    // 删除模式下点击宠物：弹窗确认后删除
    if (this.data.deleteMode) {
      const pet = this.data.pets.find(p => p._id === id)
      if (!pet) return
      wx.showModal({
        title: '删除宠物',
        content: '确认删除该宠物吗？',
        confirmText: '确认',
        cancelText: '取消',
        confirmColor: '#D9534F',
        success: res => {
          if (!res.confirm) return
          wx.showLoading({ title: '删除中', mask: true })
          cloud
            .deletePet(id)
            .then(() => {
              wx.hideLoading()
              wx.showToast({ title: '已删除', icon: 'success' })
              const pets = this.data.pets.filter(p => p._id !== id)
              this.setData({ pets, deleteMode: pets.length ? this.data.deleteMode : false })
            })
            .catch(err => {
              wx.hideLoading()
              cloud.toastError(err)
            })
        }
      })
      return
    }
    wx.navigateTo({ url: '/pages/chat/chat?petId=' + id })
  },

  // 删除按钮：切换删除模式（显示/隐藏宠物头像右上角的删除徽标）
  onDeletePet() {
    if (!ensureLogin()) return
    if (!this.data.pets.length) {
      wx.showToast({ title: '暂无宠物可删除', icon: 'none' })
      return
    }
    this.setData({ deleteMode: !this.data.deleteMode })
  },

  // 症状拍照问诊：结构化表单 + 拍照 → AI 分诊报告
  onSymptomForm() {
    if (!ensureLogin()) return
    wx.navigateTo({ url: '/pages/consultForm/consultForm' })
  },

  onTextConsult() {
    if (!ensureLogin()) return
    wx.navigateTo({ url: '/pages/chat/chat?mode=text' })
  },

  // 宠物急救指南（离线版）
  onFirstAid() {
    wx.navigateTo({ url: '/pages/firstaid/firstaid' })
  }
})
