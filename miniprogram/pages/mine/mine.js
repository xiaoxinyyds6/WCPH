const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

function isImageUrl(a) {
  return typeof a === 'string' && /^(cloud:\/\/|https?:\/\/|\/|wxfile:\/\/)/.test(a)
}

// 与问诊广场、AI 问诊首页保持一致的未登录确认弹窗
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
    return { title: 'AI宠物助手 · 智能守护每一位毛孩子', path: '/pages/mine/mine' }
  },
  onShareTimeline() {
    return { title: 'AI宠物助手 · 智能守护每一位毛孩子' }
  },
  data: {
    logged: false,
    user: {},
    pets: [],
    petIndex: 0,
    currentPet: {}
  },

  onShow() {
    const app = getApp()
    const logged = app.isLoggedIn()
    this.setData({ logged, user: app.getUser() || {} })
    if (logged) {
      this.loadData()
    } else {
      this.setData({ pets: [], petIndex: 0, currentPet: {} })
    }
  },

  onPullDownRefresh() {
    if (!getApp().isLoggedIn()) {
      wx.stopPullDownRefresh()
      return
    }
    this.loadData().then(() => wx.stopPullDownRefresh())
  },

  loadData() {
    return cloud
      .listPets()
      .then(list => {
        const pets = (list || []).map(p =>
          Object.assign({}, p, {
            avatarIsImage: isImageUrl(p.avatar),
            ageText: util.calcAge(p.birthDate)
          })
        )
        // 刷新后尽量保持当前选中的宠物；若它已被删除则回到第一只
        const curId = this.data.currentPet && this.data.currentPet._id
        let petIndex = pets.findIndex(p => p._id === curId)
        if (petIndex < 0) petIndex = 0
        this.setData({
          pets,
          petIndex,
          currentPet: pets[petIndex] || {}
        })
      })
      .catch(cloud.toastError)
  },

  onLoginGate() {
    if (!this.data.logged) ensureLogin()
  },

  onUserTap() {
    if (!ensureLogin()) return
    // 已登录：编辑头像/昵称
    wx.showActionSheet({
      itemList: ['修改头像', '修改昵称'],
      success: res => {
        if (res.tapIndex === 0) this.editAvatar()
        else this.editNickname()
      }
    })
  },

  editAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: res => {
        const file = res.tempFiles[0]
        const ext = (file.tempFilePath.match(/\.(\w+)$/) || [, 'png'])[1]
        const cloudPath = `avatars/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`
        wx.showLoading({ title: '上传中' })
        cloud
          .uploadFile(file.tempFilePath, cloudPath)
          .then(fileID => {
            wx.hideLoading()
            return this.saveProfile('', fileID)
          })
          .catch(() => {
            wx.hideLoading()
            wx.showToast({ title: '上传失败，请重试', icon: 'none' })
          })
      }
    })
  },

  editNickname() {
    wx.showModal({
      title: '修改昵称',
      editable: true,
      placeholderText: '请输入昵称',
      content: this.data.user.nickname || '',
      success: res => {
        if (!res.confirm) return
        const nickname = (res.content || '').trim().slice(0, 20)
        if (!nickname) {
          wx.showToast({ title: '昵称不能为空', icon: 'none' })
          return
        }
        this.saveProfile(nickname, '')
      }
    })
  },

  saveProfile(nickname, avatarUrl) {
    wx.showLoading({ title: '保存中' })
    return cloud
      .updateProfile(nickname, avatarUrl)
      .then(user => {
        wx.hideLoading()
        getApp().setLogin(Object.assign({}, getApp().getUser() || {}, user))
        this.setData({ user: getApp().getUser() })
        wx.showToast({ title: '已保存', icon: 'success' })
      })
      .catch(err => {
        wx.hideLoading()
        cloud.toastError(err)
      })
  },

  onAddPet() {
    if (!ensureLogin()) return
    wx.navigateTo({ url: '/pages/addPet/addPet' })
  },

  onPrevPet() {
    this.switchPet(-1)
  },

  onNextPet() {
    this.switchPet(1)
  },

  switchPet(step) {
    const n = this.data.pets.length
    if (!n) return
    const petIndex = (this.data.petIndex + step + n) % n
    this.setData({
      petIndex,
      currentPet: this.data.pets[petIndex]
    })
    wx.showToast({
      title: '切换宠物成功',
      icon: 'none',
      duration: 2000
    })
  },

  onPetTap() {
    const id = this.data.currentPet && this.data.currentPet._id
    if (!id) return
    wx.navigateTo({ url: '/pages/addPet/addPet?id=' + id })
  },

  onRecordTap(e) {
    wx.navigateTo({ url: '/pages/recordDetail/recordDetail?id=' + e.currentTarget.dataset.id })
  },

  // 全部问诊记录
  onRecordsListTap() {
    if (!ensureLogin()) return
    wx.navigateTo({ url: '/pages/recordsList/recordsList' })
  },

  // 我的发布
  onMyPostsTap() {
    if (!ensureLogin()) return
    wx.navigateTo({ url: '/pages/myPosts/myPosts' })
  },

  // 我的收藏
  onFavTap() {
    if (!ensureLogin()) return
    wx.navigateTo({ url: '/pages/likedPosts/likedPosts?mode=fav' })
  },

  onLikedPostsTap() {
    if (!ensureLogin()) return
    wx.navigateTo({ url: '/pages/likedPosts/likedPosts' })
  },

  // 历史浏览记录
  onHistoryTap() {
    if (!ensureLogin()) return
    wx.navigateTo({ url: '/pages/history/history' })
  },

  onRemindersTap() {
    if (!ensureLogin()) return
    wx.navigateTo({ url: '/pages/reminders/reminders' })
  },

  onSettingsTap() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },

  onHospitals() {
    if (!ensureLogin()) return
    wx.navigateTo({ url: '/pages/hospitals/hospitals' })
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定退出当前账号吗？',
      confirmColor: '#D9534F',
      success: res => {
        if (!res.confirm) return
        getApp().logout()
        getApp().logoutAdmin()
        this.setData({ logged: false, user: {}, pets: [], petIndex: 0, currentPet: {} })
        wx.showToast({ title: '已退出登录', icon: 'none' })
      }
    })
  }
})
