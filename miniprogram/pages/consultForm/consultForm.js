const cloud = require('../../utils/cloud')
const util = require('../../utils/util')
const petDict = require('../../utils/petDict')

const MAX_IMAGES = 3
// 简单版图片质检：压缩后体积过小，疑似模糊/无内容，提示重拍（仍允许提交）
const MIN_IMAGE_SIZE = 15 * 1024

const LEVEL_TEXT = {
  red: '🚨 紧急 · 建议立即就医',
  yellow: '⚠️ 需观察 · 建议尽快就诊',
  green: '🌿 可居家护理'
}

Page({
  // ===== 分享给好友 / 朋友圈 =====
  onShareAppMessage() {
    return { title: 'AI宠物问诊 · 症状自查', path: '/pages/consult/consult' }
  },
  onShareTimeline() {
    return { title: 'AI宠物问诊 · 症状自查' }
  },
  data: {
    mode: 'form',
    levelText: '',

    // 宠物档案
    pets: [],
    petNames: [],
    petIndex: -1,
    selectedPet: null,

    kinds: petDict.CATEGORIES,
    kindIndex: -1,
    otherKind: '',
    parts: ['皮肤', '耳朵', '眼睛', '口腔', '粪便', '其他'],
    partIndex: -1,
    otherPart: '',
    durations: ['1-3天', '4-7天', '1-2周', '2周以上', '不清楚'],
    durationIndex: -1,
    itchOptions: ['是', '否', '不清楚'],
    itchIndex: -1,
    appetiteOptions: ['正常', '下降', '拒食'],
    appetiteIndex: -1,
    stoolOptions: ['正常', '软便', '腹泻', '便秘', '未观察'],
    stoolIndex: -1,
    vaccineOptions: ['齐全', '不齐全', '未知'],
    vaccineIndex: -1,
    desc: '',
    images: [],
    uploading: false,
    submitting: false,
    maxImages: MAX_IMAGES,

    report: { level: 'green', summary: '', content: '', followUp: [] },
    savedId: ''
  },

  onLoad() {
    if (getApp().isLoggedIn()) this.loadPets()
  },

  loadPets() {
    return cloud
      .listPets()
      .then(list => {
        const pets = list || []
        this.setData({ pets, petNames: pets.map(p => p.name) })
      })
      .catch(err => console.warn('[consultForm] 宠物列表加载失败', err && err.message))
  },

  // 通用选项点击：data-key 对应 data 中的下标字段名
  onPick(e) {
    const key = e.currentTarget.dataset.key
    const i = Number(e.currentTarget.dataset.i)
    this.setData({ [key]: i })
  },

  // 「其他」补充输入：宠物类型 / 患处部位
  onOtherKind(e) {
    this.setData({ otherKind: e.detail.value })
  },

  onOtherPart(e) {
    this.setData({ otherPart: e.detail.value })
  },

  onPetPick(e) {
    const petIndex = Number(e.detail.value)
    const pet = this.data.pets[petIndex] || null
    const patch = { petIndex, selectedPet: pet }
    // 选择宠物后自动匹配宠物类型（宠物档案存的 category 即字典 label，如「犬类」），仍可手动修改
    if (pet && pet.category) {
      const ki = this.data.kinds.indexOf(pet.category)
      if (ki >= 0) patch.kindIndex = ki
    }
    this.setData(patch)
  },

  onChooseImage() {
    if (!getApp().requireLogin()) return
    const remain = MAX_IMAGES - this.data.images.length
    if (remain <= 0) {
      wx.showToast({ title: '图片最多3张', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: res => this.uploadFiles(res.tempFiles || [])
    })
  },

  uploadFiles(files) {
    wx.showLoading({ title: '上传中', mask: true })
    const owner = getApp().globalData.openid || 'anon'
    Promise.all(
      files.map((f, i) => {
        if (f.size != null && f.size < MIN_IMAGE_SIZE) {
          wx.showToast({ title: '图片可能模糊，建议重拍', icon: 'none' })
        }
        const ext = (f.tempFilePath.match(/\.([a-zA-Z0-9]+)$/) || [])[1] || 'jpg'
        return cloud.uploadFile(f.tempFilePath, `consult/${owner}/${Date.now()}-${i}.${ext}`)
      })
    )
      .then(urls => {
        wx.hideLoading()
        const images = this.data.images.concat(urls).slice(0, MAX_IMAGES)
        this.setData({ images })
      })
      .catch(() => {
        wx.hideLoading()
        wx.showToast({ title: '上传失败，请重试', icon: 'none' })
      })
  },

  onRemoveImage(e) {
    const i = e.currentTarget.dataset.i
    const images = this.data.images.slice()
    images.splice(i, 1)
    this.setData({ images })
  },

  onPreviewImage(e) {
    const { urls, cur } = e.currentTarget.dataset
    wx.previewImage({ urls: urls || [cur], current: cur })
  },

  onDesc(e) {
    this.setData({ desc: e.detail.value })
  },

  buildText() {
    const d = this.data
    const lines = []
    if (d.selectedPet) {
      lines.push(
        `宠物：${d.selectedPet.name}${d.selectedPet.breed ? '（' + d.selectedPet.breed + '）' : ''}`
      )
    }
    const kindLabel =
      d.kindIndex === d.kinds.length - 1 && d.otherKind.trim()
        ? `其他（${d.otherKind.trim()}）`
        : d.kinds[d.kindIndex]
    const partLabel =
      d.partIndex === d.parts.length - 1 && d.otherPart.trim()
        ? `其他（${d.otherPart.trim()}）`
        : d.parts[d.partIndex]
    lines.push(`宠物类型：${kindLabel}`)
    lines.push(`患处部位：${partLabel}`)
    if (d.durationIndex >= 0) lines.push(`病程：${d.durations[d.durationIndex]}`)
    if (d.itchIndex >= 0) lines.push(`是否瘙痒：${d.itchOptions[d.itchIndex]}`)
    if (d.appetiteIndex >= 0) lines.push(`精神食欲：${d.appetiteOptions[d.appetiteIndex]}`)
    if (d.stoolIndex >= 0) lines.push(`排便情况：${d.stoolOptions[d.stoolIndex]}`)
    if (d.vaccineIndex >= 0) lines.push(`疫苗情况：${d.vaccineOptions[d.vaccineIndex]}`)
    lines.push('症状描述：' + d.desc.trim().slice(0, 500))
    return lines.join('；')
  },

  onSubmit() {
    if (!getApp().requireLogin()) return
    if (this.data.submitting) return
    if (this.data.kindIndex < 0) {
      wx.showToast({ title: '请选择宠物类型', icon: 'none' })
      return
    }
    if (this.data.kindIndex === this.data.kinds.length - 1 && !this.data.otherKind.trim()) {
      wx.showToast({ title: '请填写具体宠物类型', icon: 'none' })
      return
    }
    if (this.data.partIndex < 0) {
      wx.showToast({ title: '请选择患处部位', icon: 'none' })
      return
    }
    if (this.data.partIndex === this.data.parts.length - 1 && !this.data.otherPart.trim()) {
      wx.showToast({ title: '请填写具体患处部位', icon: 'none' })
      return
    }
    if (!this.data.desc.trim()) {
      wx.showToast({ title: '请填写症状描述', icon: 'none' })
      return
    }
    if (!wx.getStorageSync('disclaimer_agreed_v1')) {
      wx.showModal({
        title: 'AI 问诊免责声明',
        content: 'AI 助手仅提供初步健康评估与护理建议，不构成诊断、不开具处方，不能替代执业兽医的现场诊疗。急症请立即前往宠物医院。继续使用即表示您已了解并同意。',
        confirmText: '同意',
        cancelText: '不同意',
        success: res => {
          if (!res.confirm) return
          wx.setStorageSync('disclaimer_agreed_v1', true)
          this.onSubmit()
        }
      })
      return
    }

    const d = this.data
    const text = this.buildText()
    const cloudImages = d.images.filter(u => typeof u === 'string' && u.indexOf('cloud://') === 0)
    const pet = d.selectedPet || {}

    this.setData({ submitting: true })
    wx.showLoading({ title: 'AI 分析中', mask: true })

    cloud
      .assistantAsk(text, pet, cloudImages)
      .catch(() => {
        // 真实 AI 不可用时降级本地规则引擎，保证功能可用
        const reply = util.aiConsult(text, pet, { images: d.images, video: '' })
        return Promise.resolve({
          level: reply.level,
          summary: '',
          content: reply.content,
          followUp: []
        })
      })
      .then(data => {
        wx.hideLoading()
        const level = (data && data.level) || 'green'
        const summary = (data && data.summary) || ''
        const content = (data && data.content) || ''
        const followUp = (data && data.followUp) || []
        this.setData({
          mode: 'report',
          submitting: false,
          levelText: LEVEL_TEXT[level] || LEVEL_TEXT.green,
          report: { level, summary, content, followUp }
        })
        this.saveRecord(text, level, summary, content)
      })
      .catch(err => {
        wx.hideLoading()
        this.setData({ submitting: false })
        cloud.toastError(err)
      })
  },

  // 报告生成后自动保存为问诊记录
  saveRecord(text, level, summary, content) {
    const pet = this.data.selectedPet || {}
    const title = (this.data.desc.trim() || '拍照问诊报告').slice(0, 20)
    const messages = [
      { role: 'user', content: text, time: util.formatDateTime(Date.now()), images: this.data.images }
    ]
    const aiContent = summary ? `📋 ${summary}\n\n${content}` : content
    messages.push({ role: 'ai', content: aiContent, time: util.formatDateTime(Date.now()), level })
    cloud
      .addRecord({
        title,
        messages,
        petId: pet._id || '',
        petName: pet.name || '',
        petAvatar: pet.avatar && pet.avatar.indexOf('cloud://') !== 0 ? pet.avatar : '',
        consultType: 'photo'
      })
      .then(res => {
        if (res && res._id) this.setData({ savedId: res._id })
      })
      .catch(err => {
        console.error('保存问诊记录失败', err && err.message)
        wx.showToast({ title: '报告已生成但记录保存失败', icon: 'none' })
      })
  },

  resetForm() {
    this.setData({
      mode: 'form',
      kindIndex: -1,
      otherKind: '',
      partIndex: -1,
      durationIndex: -1,
      itchIndex: -1,
      appetiteIndex: -1,
      stoolIndex: -1,
      vaccineIndex: -1,
      desc: '',
      images: [],
      report: { level: 'green', summary: '', content: '', followUp: [] },
      savedId: ''
    })
  },

  finish() {
    wx.navigateBack()
  },

  // 报告下方补充问诊：打开本次拍照问诊对应的聊天会话，在完整上下文里继续提问
  supplementConsult() {
    const d = this.data
    const lines = [this.buildText()]
    if (d.report.summary) lines.push('AI初步评估：' + d.report.summary)
    // 上下文静默携带：会话内每条消息发送时自动附加给 AI
    getApp()._supplementContext = lines.filter(Boolean).join('\n')
    if (d.savedId) {
      // 记录已保存：直接打开该记录的会话（含图片、描述与 AI 报告历史，档案袋自动选中）
      wx.navigateTo({ url: '/pages/chat/chat?sessionId=' + d.savedId + '&supplement=1' })
    } else {
      // 记录尚未保存完成：退回新建会话方式，同样携带上下文
      const petId = d.selectedPet && d.selectedPet._id
      wx.navigateTo({
        url: '/pages/chat/chat?mode=text&supplement=1' + (petId ? '&petId=' + petId : '')
      })
    }
  }
})
