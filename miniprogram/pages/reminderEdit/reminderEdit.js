const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

// 各类型的推荐标题与重复周期（标题可改，周期仅为新建时的默认值）
const TYPE_DEFAULTS = {
  vaccine: { title: '疫苗接种', repeat: 'yearly' },
  deworm_in: { title: '体内驱虫', repeat: 'quarterly' },
  deworm_out: { title: '体外驱虫', repeat: 'monthly' },
  recheck: { title: '复诊检查', repeat: 'none' },
  medication: { title: '按时用药', repeat: 'none' },
  custom: { title: '', repeat: 'none' }
}

// 到期日期统一取当天上午 9 点
function dueAtFromDate(dateStr) {
  const p = dateStr.split('-').map(Number)
  return new Date(p[0], p[1] - 1, p[2], 9, 0, 0).getTime()
}

// 订阅消息模板 ID：微信公众平台 → 功能 → 订阅消息 → 选用"宠物提醒"类模板，
// 把模板 ID 粘贴到这里（与 cloudfunctions/notify/index.js 的 TEMPLATE_ID 保持一致）。
// 留空时保存提醒不请求订阅授权，静默跳过。
const REMIND_TPL_ID = ''

Page({
  // ===== 分享给好友 / 朋友圈 =====
  onShareAppMessage() {
    return { title: '疫苗驱虫提醒 · 养宠必备', path: '/pages/reminders/reminders' }
  },
  onShareTimeline() {
    return { title: '疫苗驱虫提醒 · 养宠必备' }
  },
  data: {
    id: '',
    isEdit: false,
    saving: false,
    types: util.REMINDER_TYPES,
    typeIndex: 5,
    repeatOptions: util.REMINDER_REPEATS,
    repeatLabels: util.REMINDER_REPEATS.map(r => r.label),
    repeatIndex: 0,
    pets: [],
    petNames: ['不关联宠物'],
    petIndex: 0,
    title: '',
    dueDate: '',
    today: util.todayStr()
  },

  _autoTitle: '',

  onLoad(options) {
    const id = (options && options.id) || ''
    const prefillTitle = (options && options.title) || ''
    const petId = (options && options.petId) || ''
    if (id) {
      this.setData({ id, isEdit: true })
      wx.setNavigationBarTitle({ title: '编辑提醒' })
      this.loadReminder(id)
    } else {
      const d = new Date()
      d.setDate(d.getDate() + 3)
      this.setData({ dueDate: util.formatDate(d), title: prefillTitle })
      this.loadPets(petId)
    }
  },

  loadPets(preselectId) {
    cloud
      .listPets()
      .then(list => {
        const pets = list || []
        const petNames = ['不关联宠物'].concat(pets.map(p => p.name))
        let petIndex = 0
        if (preselectId) {
          const i = pets.findIndex(p => p._id === preselectId)
          if (i >= 0) petIndex = i + 1
        }
        this.setData({ pets, petNames, petIndex })
      })
      .catch(() => {})
  },

  loadReminder(id) {
    wx.showLoading({ title: '加载中' })
    cloud
      .getReminder(id)
      .then(r => {
        wx.hideLoading()
        if (!r) return
        const typeIndex = Math.max(0, this.data.types.findIndex(t => t.value === r.type))
        const repeatIndex = Math.max(0, this.data.repeatOptions.findIndex(t => t.value === r.repeat))
        this._autoTitle = r.title || ''
        this.setData({
          typeIndex,
          repeatIndex,
          title: r.title || '',
          dueDate: util.formatDate(r.dueAt)
        })
        this.loadPets(r.petId)
      })
      .catch(err => {
        wx.hideLoading()
        cloud.toastError(err)
      })
  },

  onType(e) {
    const typeIndex = Number(e.currentTarget.dataset.i)
    const meta = this.data.types[typeIndex]
    const def = TYPE_DEFAULTS[meta.value]
    const patch = { typeIndex }
    // 标题未手动改过（为空或仍是自动填充值）时跟随类型联动
    const cur = this.data.title.trim()
    if (!cur || cur === this._autoTitle) {
      patch.title = def.title
      this._autoTitle = def.title
    }
    // 新建时按类型推荐重复周期，编辑时保留用户已选的周期
    if (!this.data.isEdit) {
      patch.repeatIndex = Math.max(
        0,
        this.data.repeatOptions.findIndex(r => r.value === def.repeat)
      )
    }
    this.setData(patch)
  },

  onTitle(e) {
    this.setData({ title: e.detail.value })
  },

  onPet(e) {
    this.setData({ petIndex: Number(e.detail.value) })
  },

  onDue(e) {
    this.setData({ dueDate: e.detail.value })
  },

  onRepeat(e) {
    this.setData({ repeatIndex: Number(e.detail.value) })
  },

  onSave() {
    const title = this.data.title.trim()
    if (!title) {
      wx.showToast({ title: '请填写提醒标题', icon: 'none' })
      return
    }
    if (!this.data.dueDate) {
      wx.showToast({ title: '请选择到期日期', icon: 'none' })
      return
    }
    const type = this.data.types[this.data.typeIndex].value
    const repeat = this.data.repeatOptions[this.data.repeatIndex].value
    const pet = this.data.pets[this.data.petIndex - 1]
    const reminder = {
      type,
      title: title.slice(0, 30),
      dueAt: dueAtFromDate(this.data.dueDate),
      repeat,
      petId: pet ? pet._id : '',
      petName: pet ? pet.name : ''
    }
    this.setData({ saving: true })
    const task = this.data.isEdit
      ? cloud.updateReminder(this.data.id, reminder)
      : cloud.addReminder(reminder)
    task
      .then(() => {
        this.requestRemindSubscribe()
        wx.showToast({ title: '已保存', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 600)
      })
      .catch(err => {
        this.setData({ saving: false })
        cloud.toastError(err)
      })
  },

  // 订阅消息：请用户授权接收到期提醒（一次性订阅，每授权一次可下发一条）
  requestRemindSubscribe() {
    if (!REMIND_TPL_ID) return
    wx.requestSubscribeMessage({
      tmplIds: [REMIND_TPL_ID],
      complete: () => {}
    })
  },

  onDelete() {
    wx.showModal({
      title: '删除提醒',
      content: '确定删除这条提醒吗？',
      confirmColor: '#D9534F',
      success: res => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中' })
        cloud
          .deleteReminder(this.data.id)
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已删除', icon: 'success' })
            setTimeout(() => wx.navigateBack(), 600)
          })
          .catch(err => {
            wx.hideLoading()
            cloud.toastError(err)
          })
      }
    })
  }
})
