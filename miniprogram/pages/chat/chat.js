const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

function isImageUrl(a) {
  return typeof a === 'string' && /^(cloud:\/\/|https?:\/\/|\/|wxfile:\/\/)/.test(a)
}

function hm() {
  const d = new Date()
  const p = n => (n < 10 ? '0' + n : '' + n)
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

Page({
  data: {
    pets: [],
    petIndex: -1,
    currentPet: {},
    messages: [],
    inputValue: '',
    scrollTo: '',
    sending: false,
    savedId: ''
  },

  _seq: 0,
  _chats: null,
  _savedIds: null,

  onLoad(options) {
    // 每只宠物一份聊天记录：petId -> messages[]
    this._chats = {}
    this._savedIds = {}
    this.loadPets(options && options.petId)
  },

  loadPets(preselectId) {
    wx.showLoading({ title: '加载中' })
    cloud
      .listPets()
      .then(list => {
        wx.hideLoading()
        const pets = (list || []).map(p =>
          Object.assign({}, p, {
            avatarIsImage: isImageUrl(p.avatar),
            ageText: util.calcAge(p.birthDate)
          })
        )
        let petIndex = preselectId ? pets.findIndex(p => p._id === preselectId) : -1
        if (petIndex < 0 && pets.length) petIndex = 0
        this.setData({
          pets,
          petIndex,
          currentPet: petIndex >= 0 ? pets[petIndex] : {}
        })
        this.ensureChat()
      })
      .catch(err => {
        wx.hideLoading()
        cloud.toastError(err)
        this.ensureChat()
      })
  },

  nextKey() {
    this._seq += 1
    return 'm' + this._seq
  },

  chatKey() {
    return (this.data.currentPet && this.data.currentPet._id) || 'none'
  },

  appendMessage(role, content) {
    const key = this.chatKey()
    const msg = { role, content, timeText: hm(), _k: this.nextKey() }
    const messages = (this._chats[key] || []).concat([msg])
    this._chats[key] = messages
    this.setData({ messages, scrollTo: 'msg-' + msg._k })
    return messages
  },

  // 进入当前宠物的会话：没有记录则生成欢迎语，有则恢复历史
  ensureChat() {
    const key = this.chatKey()
    if (!this._chats[key]) {
      const name = this.data.currentPet && this.data.currentPet.name
      const greet = name
        ? `您好！我是AI宠物健康助手🐾 请详细描述「${name}」的情况：发病时间与频率、异常行为、近期饮食与排便、疫苗及驱虫史等，我会为您做初步健康评估。`
        : '您好！我是AI宠物健康助手🐾 请先在上方选择要咨询的宠物，然后详细描述症状（发病时间、异常行为、饮食排便、疫苗驱虫史等），我会为您做初步健康评估。'
      this._chats[key] = [
        {
          role: 'ai',
          content: greet + '\n\n🚨 如遇呼吸困难、大出血、误食毒物、抽搐等危急情况，请立即送医！',
          timeText: hm(),
          _k: this.nextKey()
        }
      ]
    }
    this.setData({
      messages: this._chats[key],
      savedId: this._savedIds[key] || '',
      scrollTo: 'bottom-anchor'
    })
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
    this.ensureChat()
  },

  onAddPet() {
    if (!getApp().requireLogin()) return
    wx.navigateTo({ url: '/pages/addPet/addPet' })
  },

  onInput(e) {
    this.setData({ inputValue: e.detail.value })
  },

  send() {
    const text = this.data.inputValue.trim()
    if (!text || this.data.sending) return

    if (!this.data.currentPet || !this.data.currentPet.name) {
      if (!this.data.pets.length) {
        wx.showModal({
          title: '还没有宠物',
          content: '问诊前请先添加宠物信息，以便更准确地评估。',
          confirmText: '去添加',
          success: r => {
            if (r.confirm) this.onAddPet()
          }
        })
      } else {
        wx.showToast({ title: '请先选择宠物', icon: 'none' })
      }
      return
    }

    this.appendMessage('user', text)
    this.setData({ inputValue: '', sending: true, scrollTo: 'bottom-anchor' })

    setTimeout(() => {
      const reply = util.aiReply(text, this.data.currentPet)
      this.appendMessage('ai', reply)
      this.setData({ sending: false })
      this.saveRecord()
    }, 700)
  },

  saveRecord() {
    const key = this.chatKey()
    const savedId = this._savedIds[key] || ''
    const msgs = this.data.messages
      .filter(m => m.role === 'user' || m.role === 'ai')
      .map(m => ({ role: m.role, content: m.content, time: m.timeText }))
    const firstUser = this.data.messages.find(m => m.role === 'user')
    const title = firstUser ? firstUser.content.slice(0, 20) : '新问诊'
    const pet = this.data.currentPet
    const payload = {
      title,
      messages: msgs,
      petId: pet._id,
      petName: pet.name,
      petAvatar: pet.avatarIsImage ? '' : pet.avatar || ''
    }

    const task = savedId ? cloud.updateRecord(savedId, payload) : cloud.addRecord(payload)

    task
      .then(res => {
        if (!savedId && res && res._id) {
          this._savedIds[key] = res._id
          this.setData({ savedId: res._id })
        }
      })
      .catch(err => console.error('保存问诊记录失败', err))
  }
})
