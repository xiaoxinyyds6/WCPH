const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

function isImageUrl(a) {
  return typeof a === 'string' && /^(cloud:\/\/|https?:\/\/|\/|wxfile:\/\/)/.test(a)
}

Page({
  data: {
    logged: false,
    user: {},
    pets: [],
    petIndex: 0,
    currentPet: {},
    records: []
  },

  onShow() {
    const app = getApp()
    const logged = app.isLoggedIn()
    this.setData({ logged, user: app.getUser() || {} })
    if (logged) {
      this.loadData()
    } else {
      this.setData({ pets: [], records: [] })
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
    const p1 = cloud
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

    const p2 = cloud
      .listRecords()
      .then(list => {
        const records = (list || []).map(r =>
          Object.assign({}, r, {
            avatarIsImage: isImageUrl(r.petAvatar),
            timeText: util.formatDateTime(r.createdAt)
          })
        )
        this.setData({ records })
      })
      .catch(cloud.toastError)

    return Promise.all([p1, p2])
  },

  onUserTap() {
    if (!this.data.logged) {
      wx.navigateTo({ url: '/pages/login/login' })
    }
  },

  onAddPet() {
    if (!getApp().requireLogin()) return
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
  },

  onPetTap() {
    const id = this.data.currentPet && this.data.currentPet._id
    if (!id) return
    wx.navigateTo({ url: '/pages/addPet/addPet?id=' + id })
  },

  onRecordTap(e) {
    wx.navigateTo({ url: '/pages/recordDetail/recordDetail?id=' + e.currentTarget.dataset.id })
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定退出当前账号吗？',
      confirmColor: '#FF5A5F',
      success: res => {
        if (!res.confirm) return
        getApp().logout()
        this.setData({ logged: false, user: {}, pets: [], petIndex: 0, currentPet: {}, records: [] })
        wx.showToast({ title: '已退出登录', icon: 'none' })
      }
    })
  }
})
