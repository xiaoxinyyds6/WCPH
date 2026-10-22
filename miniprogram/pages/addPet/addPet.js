const cloud = require('../../utils/cloud')
const util = require('../../utils/util')
const dict = require('../../utils/petDict')

const MAX_PETS = 5

function isImageUrl(a) {
  return typeof a === 'string' && /^(cloud:\/\/|https?:\/\/|\/|wxfile:\/\/)/.test(a)
}

Page({
  data: {
    id: '',
    isEdit: false,
    saving: false,

    avatar: '🐶',
    avatarIsImage: false,
    defaultAvatars: dict.DEFAULT_AVATARS,

    name: '',

    categories: dict.CATEGORIES,
    catIndex: -1,
    category: '',
    customCategory: '',
    breeds: [],
    breedIndex: -1,
    breed: '',
    customBreed: '',

    genderOptions: ['公', '母'],
    gender: '',

    birthDate: '',
    today: util.todayStr(),

    weight: '',

    neuterOptions: ['已绝育', '未绝育', '未知'],
    neutered: '未知',

    bodyOptions: ['偏瘦', '标准', '偏胖', '肥胖'],
    body: '标准',

    dewormOptions: ['已驱虫', '未驱虫', '未知'],
    dewormed: '未知'
  },

  onLoad(options) {
    if (options && options.id) {
      this.setData({ id: options.id, isEdit: true })
      wx.setNavigationBarTitle({ title: '宠物详情' })
      this.loadPet(options.id)
    } else {
      this.checkFull()
    }
  },

  checkFull() {
    cloud
      .countPets()
      .then(res => {
        if (res && res.total >= MAX_PETS) {
          wx.showToast({ title: '宠物位置已满，无法继续添加', icon: 'none' })
          setTimeout(() => wx.navigateBack(), 1200)
        }
      })
      .catch(cloud.toastError)
  },

  loadPet(id) {
    wx.showLoading({ title: '加载中' })
    cloud
      .getPet(id)
      .then(p => {
        wx.hideLoading()
        if (!p) return
        // 历史数据若不在字典内（自定义分类/品种），回填为「其他」+ 自定义文本
        const knownCat = dict.CATEGORIES.indexOf(p.category) >= 0
        const category = knownCat ? p.category : (p.category ? '其他' : '')
        const customCategory = knownCat ? '' : (p.category || '')
        const catIndex = category ? dict.CATEGORIES.indexOf(category) : -1
        const breeds = dict.getBreeds(category)
        const knownBreed = p.breed && breeds.indexOf(p.breed) >= 0 && p.breed !== '其他'
        const breed = p.breed ? (knownBreed ? p.breed : '其他') : ''
        const breedIndex = breed ? breeds.indexOf('其他') : -1
        const customBreed = knownBreed ? '' : (p.breed === '其他' ? '' : (p.breed || ''))
        this.setData({
          avatar: p.avatar || '🐶',
          avatarIsImage: isImageUrl(p.avatar),
          name: p.name || '',
          catIndex,
          category,
          customCategory,
          breeds,
          breedIndex,
          breed,
          customBreed,
          gender: p.gender || '',
          birthDate: p.birthDate || '',
          weight: p.weight != null ? String(p.weight) : '',
          neutered: p.neutered || '未知',
          body: p.body || '标准',
          dewormed: p.dewormed || '未知'
        })
      })
      .catch(err => {
        wx.hideLoading()
        cloud.toastError(err)
      })
  },

  chooseFromAlbum() {
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
        wx.cloud
          .uploadFile({ cloudPath, filePath: file.tempFilePath })
          .then(up => {
            wx.hideLoading()
            this.setData({ avatar: up.fileID, avatarIsImage: true })
          })
          .catch(() => {
            wx.hideLoading()
            wx.showToast({ title: '上传失败，请重试', icon: 'none' })
          })
      }
    })
  },

  pickDefaultAvatar(e) {
    this.setData({ avatar: e.currentTarget.dataset.avatar, avatarIsImage: false })
  },

  onName(e) {
    this.setData({ name: e.detail.value })
  },

  onWeight(e) {
    this.setData({ weight: e.detail.value })
  },

  onCategory(e) {
    const catIndex = Number(e.detail.value)
    const category = this.data.categories[catIndex]
    this.setData({
      catIndex,
      category,
      customCategory: '',
      breeds: dict.getBreeds(category),
      breedIndex: -1,
      breed: '',
      customBreed: ''
    })
  },

  onCustomCategory(e) {
    this.setData({ customCategory: e.detail.value })
  },

  onBreed(e) {
    const breedIndex = Number(e.detail.value)
    this.setData({ breedIndex, breed: this.data.breeds[breedIndex], customBreed: '' })
  },

  onCustomBreed(e) {
    this.setData({ customBreed: e.detail.value })
  },

  onGender(e) {
    this.setData({ gender: e.currentTarget.dataset.val })
  },

  onNeutered(e) {
    this.setData({ neutered: e.currentTarget.dataset.val })
  },

  onBody(e) {
    this.setData({ body: e.currentTarget.dataset.val })
  },

  onDewormed(e) {
    this.setData({ dewormed: e.currentTarget.dataset.val })
  },

  onBirth(e) {
    this.setData({ birthDate: e.detail.value })
  },

  validate() {
    const d = this.data
    if (!d.name.trim()) return '请填写宠物名字'
    if (!d.category) return '请选择宠物分类'
    if (d.category === '其他' && !d.customCategory.trim()) return '请输入自定义分类名称'
    const isCustomBreed = d.category === '其他' || d.breed === '其他'
    if (isCustomBreed && !d.customBreed.trim()) return '请输入品种名称'
    if (!isCustomBreed && !d.breed) return '请选择宠物品种'
    const w = parseFloat(d.weight)
    if (isNaN(w) || w <= 0) return '体重必须大于0'
    if (w > 500) return '请输入合理的体重'
    if (d.birthDate && d.birthDate > d.today) return '出生日期不能晚于今天'
    return ''
  },

  onSave() {
    const err = this.validate()
    if (err) {
      wx.showToast({ title: err, icon: 'none' })
      return
    }
    const d = this.data
    const isCustomBreed = d.category === '其他' || d.breed === '其他'
    const pet = {
      name: d.name.trim(),
      avatar: d.avatar,
      category: d.category === '其他' ? d.customCategory.trim() : d.category,
      breed: isCustomBreed ? d.customBreed.trim() : d.breed,
      gender: d.gender,
      birthDate: d.birthDate,
      weight: parseFloat(d.weight),
      neutered: d.neutered,
      body: d.body,
      dewormed: d.dewormed
    }

    this.setData({ saving: true })
    wx.showLoading({ title: '保存中' })
    const task = d.isEdit ? cloud.updatePet(d.id, pet) : cloud.addPet(pet)
    task
      .then(() => {
        wx.hideLoading()
        this.setData({ saving: false })
        wx.showToast({ title: '已保存', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 700)
      })
      .catch(e => {
        wx.hideLoading()
        this.setData({ saving: false })
        cloud.toastError(e)
      })
  },

  onDelete() {
    wx.showModal({
      title: '删除宠物',
      content: '确定删除该宠物信息吗？此操作不可恢复。',
      confirmColor: '#FF5A5F',
      success: res => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中' })
        cloud
          .deletePet(this.data.id)
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已删除', icon: 'success' })
            setTimeout(() => wx.navigateBack(), 700)
          })
          .catch(e => {
            wx.hideLoading()
            cloud.toastError(e)
          })
      }
    })
  }
})
