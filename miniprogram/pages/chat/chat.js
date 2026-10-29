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

// 演示用附近宠物医院数据（正式版本可接入地图POI检索）
const HOSPITALS = [
  { name: '瑞鹏宠物医院·24h急诊（科技园分院·约1.2km）', phone: '075512345678' },
  { name: '芭比堂动物医院（中心院区·约2.0km）', phone: '075587654321' },
  { name: '安安宠医·24小时急诊（约2.8km）', phone: '075599988877' }
]

Page({
  // ===== 分享给好友 / 朋友圈（聊天页分享落到问诊入口） =====
  onShareAppMessage() {
    return { title: 'AI宠物问诊 · 描述症状即可获得初步评估', path: '/pages/consult/consult' }
  },
  onShareTimeline() {
    return { title: 'AI宠物问诊 · 描述症状即可获得初步评估' }
  },
  data: {
    pets: [],
    petIndex: -1,
    currentPet: {},
    messages: [],
    inputValue: '',
    scrollTo: '',
    sending: false,
    statusBarHeight: 20,
    // 当前问诊会话（一条记录 = 一个档案袋）
    sessionId: '',
    sessionTitle: '',
    published: false,
    // 会话选择面板
    sessions: [],
    showSessionPicker: false,
    loadingSessions: false,
    // 多模态：待发送附件
    pendingImages: [],
    pendingVideo: '',
    // 宠物列表加载失败标记（区分"没有宠物"与"加载失败"）
    petLoadError: false,
    // 调试用：宠物加载状态
    loadState: '',
    // 快捷提问入口
    quickQuestions: ['宠物呕吐怎么办', '拉稀是什么原因', '食欲下降', '皮肤脱毛瘙痒', '疫苗驱虫安排']
  },

  _seq: 0,
  _pendingMedia: null,
  _pendingSessionId: '',
  _saveChain: null,
  // 每个宠物的会话视图暂存：切换宠物时保存/恢复，切回来不丢对话
  _petViews: {},

  onLoad(options) {
    // 自定义导航栏：状态栏高度 + 状态栏前景白色
    try {
      const wi = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      this.setData({ statusBarHeight: wi.statusBarHeight || 20 })
      wx.setNavigationBarColor({ frontColor: '#ffffff', backgroundColor: '#6CBFB5' })
    } catch (e) {
      this.setData({ statusBarHeight: 20 })
    }
    // 待发送附件草稿：挂到全局暂存，退回首页再进入不丢失
    this._pendingMedia = getApp()._chatDraftMedia = getApp()._chatDraftMedia || { images: [], video: '' }
    this.setData({ pendingImages: this._pendingMedia.images, pendingVideo: this._pendingMedia.video })
    this._pendingSessionId = (options && options.sessionId) || ''
    // 问诊方式归类：只有拍照问诊报告流程显式传 mode=photo；
    // 聊天页（文字问诊入口及其他入口）产生的记录一律归「文字图片问诊记录」，无论聊天中是否带图片
    const mode = options && options.mode
    this._consultMode = mode === 'photo' ? 'photo' : 'text'
    // 问诊表单跳转：结构化描述文本预填输入框（auto=1 时自动发送）
    const draftText = (options && options.text) || getApp()._chatDraftText || ''
    if (draftText) {
      this.setData({ inputValue: draftText })
      getApp()._chatDraftText = ''
    }
    this._autoSend = (options && options.auto) === '1'
    // 免责声明弹窗与宠物加载解耦：加载立即执行，弹窗只负责"是否同意继续问诊"
    this.checkDisclaimer()
    this.loadPets(options && options.petId)
  },

  // 首次 AI 问诊弹出免责声明；同意后执行回调（用于自动发送等后续动作）
  checkDisclaimer(cb) {
    if (wx.getStorageSync('disclaimer_agreed_v1')) {
      if (cb) cb()
      return
    }
    wx.showModal({
      title: 'AI 问诊免责声明',
      content:
        'AI 助手仅提供初步健康评估与护理建议，不构成诊断、不开具处方，不能替代执业兽医的现场诊疗。急症请立即前往宠物医院。继续使用即表示您已了解并同意。',
      confirmText: '同意',
      cancelText: '不同意',
      confirmColor: '#5FA8A0',
      success: res => {
        if (res.confirm) {
          wx.setStorageSync('disclaimer_agreed_v1', true)
          if (cb) cb()
        } else {
          this.leavePage()
        }
      }
    })
  },

  leavePage() {
    if (getCurrentPages().length > 1) wx.navigateBack()
    else wx.switchTab({ url: '/pages/consult/consult' })
  },

  onShow() {
    const app = getApp()
    // 从添加/编辑宠物页返回时刷新宠物列表，避免仍提示"还没有宠物"
    if (app._petsChanged) {
      app._petsChanged = false
      this.loadPets()
      return
    }
    // 兜底：页面已初始化但宠物列表为空时重试加载（覆盖首次加载失败等场景）
    if (this._initDone && !this.data.pets.length && !this._loadingPets) {
      this.loadPets()
    }
  },

  onRetryPets() {
    this.loadPets()
  },

  noop() {},

  // 返回首页：有未发送附件时询问是否保存
  onBack() {
    const goHome = () => {
      if (getCurrentPages().length > 1) wx.navigateBack()
      else wx.switchTab({ url: '/pages/consult/consult' }) // 聊天页为栈底时（如直接打开）兜底
    }
    const draft = this._pendingMedia
    if (draft && ((draft.images || []).length || draft.video)) {
      wx.showModal({
        title: '提示',
        content: '图片还未保存，需要保存后再退出吗？',
        cancelText: '不保存',
        confirmText: '保存',
        success: res => {
          if (!res.confirm) {
            draft.images = []
            draft.video = ''
          }
          goHome()
        }
      })
      return
    }
    goHome()
  },

  onRemoveImage(e) {
    const i = e.currentTarget.dataset.i
    this._pendingMedia.images.splice(i, 1)
    this.setData({ pendingImages: this._pendingMedia.images })
  },

  // 附件栏 ＋：继续添加图片/视频（新附件排在最右）
  onAddMore() {
    wx.showActionSheet({
      itemList: ['添加图片', '添加视频'],
      success: res => {
        if (res.tapIndex === 0) this.addMoreImages()
        else this.addMoreVideo()
      }
    })
  },

  addMoreImages() {
    const remain = 3 - this._pendingMedia.images.length
    if (remain <= 0) {
      wx.showToast({ title: '图片最多3张', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: res => {
        const paths = (res.tempFiles || []).map(f => f.tempFilePath)
        if (paths.length) this.uploadAppendMedia(paths, 'image')
      }
    })
  },

  addMoreVideo() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      maxDuration: 30,
      sourceType: ['album', 'camera'],
      success: res => {
        const f = res.tempFiles && res.tempFiles[0]
        if (f && f.tempFilePath) this.uploadAppendMedia([f.tempFilePath], 'video')
      }
    })
  },

  uploadAppendMedia(paths, type) {
    wx.showLoading({ title: '上传中' })
    const owner = getApp().globalData.openid || 'anon'
    Promise.all(
      paths.map((p, i) => {
        const ext = (p.match(/\.([a-zA-Z0-9]+)$/) || [])[1] || (type === 'video' ? 'mp4' : 'jpg')
        return cloud.uploadFile(p, `consult/${owner}/${Date.now()}-${type}-${i}.${ext}`)
      })
    )
      .then(urls => {
        wx.hideLoading()
        urls.forEach(url => {
          if (type === 'video') {
            this._pendingMedia.video = url // 新视频替换旧视频
          } else if (this._pendingMedia.images.length < 3) {
            this._pendingMedia.images.push(url) // 排在上一张右边
          }
        })
        this.setData({
          pendingImages: this._pendingMedia.images,
          pendingVideo: this._pendingMedia.video
        })
      })
      .catch(err => {
        wx.hideLoading()
        console.error('上传失败', err)
        wx.showToast({ title: '上传失败，请重试', icon: 'none' })
      })
  },

  onRemoveVideo() {
    this._pendingMedia.video = ''
    this.setData({ pendingVideo: '' })
  },

  onPreviewImage(e) {
    const urls = e.currentTarget.dataset.urls || []
    const current = e.currentTarget.dataset.src
    if (urls.length) wx.previewImage({ current, urls })
  },

  // ================= 紧急预警：一键拨打附近宠物医院 =================
  onCallHospital() {
    wx.showActionSheet({
      itemList: HOSPITALS.map(h => h.name),
      success: res => {
        const h = HOSPITALS[res.tapIndex]
        wx.makePhoneCall({ phoneNumber: h.phone })
      }
    })
  },

  // 跳转附近宠物医院列表（按距离排序，可拨号/导航）
  onNearbyHospitals() {
    wx.navigateTo({ url: '/pages/hospitals/hospitals' })
  },

  // ================= 宠物 =================
  loadPets(preselectId) {
    // 防止并发重复加载
    if (this._loadingPets) return
    this._loadingPets = true
    this.setData({ loadState: 'loading' })
    wx.showLoading({ title: '加载中' })
    cloud
      .listPets()
      .then(list => {
        wx.hideLoading()
        this._loadingPets = false
        this._initDone = true
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
          currentPet: petIndex >= 0 ? pets[petIndex] : {},
          petLoadError: false,
          loadState: 'ok:' + pets.length
        })
        this.afterPetsReady()
      })
      .catch(err => {
        wx.hideLoading()
        this._loadingPets = false
        this._initDone = true
        console.error('[chat] 宠物列表加载失败', err)
        this.setData({ petLoadError: true, loadState: 'error:' + (err && err.message) })
        this.afterPetsReady()
      })
  },

  // 宠物数据就绪：指定了会话则直接打开，否则弹出「新建 / 继续」选择面板
  afterPetsReady() {
    if (this._pendingSessionId) {
      const id = this._pendingSessionId
      this._pendingSessionId = ''
      this.openSession(id)
      return
    }
    // 问诊表单跳转：直接新建会话并自动发送
    if (this._autoSend) {
      this._autoSend = false
      if (!this.data.currentPet || !this.data.currentPet.name) {
        this.setData({ showSessionPicker: true, messages: [] })
        this.loadSessions()
        return
      }
      const proceed = () => {
        this.setData({
          showSessionPicker: false,
          sessionId: '',
          sessionTitle: '',
          published: false,
          messages: [this.greeting()],
          scrollTo: 'bottom-anchor'
        })
        this.send()
      }
      // 未同意免责声明时先弹窗，同意后继续自动发送
      if (!wx.getStorageSync('disclaimer_agreed_v1')) {
        this.checkDisclaimer(proceed)
        return
      }
      proceed()
      return
    }
    // 已有会话/消息时（如从添加宠物页返回），不打断当前对话
    if (this.data.sessionId || this.data.messages.length) return
    this.setData({ showSessionPicker: true, messages: [] })
    this.loadSessions()
  },

  // ================= 问诊会话（档案袋） =================
  greeting() {
    const name = this.data.currentPet && this.data.currentPet.name
    const greet = name
      ? `您好！我是AI宠物健康助手🐾 请详细描述「${name}」的情况：发病时间与频率、异常行为、近期饮食与排便、疫苗及驱虫史等，我会为您做初步健康评估。`
      : '您好！我是AI宠物健康助手🐾 请先在上方选择要咨询的宠物，然后详细描述症状（发病时间、异常行为、饮食排便、疫苗驱虫史等），我会为您做初步健康评估。'
    return {
      role: 'ai',
      content:
        greet +
        '\n\n✨ 您还可以：\n· 按住输入栏 🎙 说话，松开自动转文字；\n· 上传化验单/病历照片，AI 会先提取图中文字再逐项解读；\n· 点击右上角 📁 随时切换或新建问诊记录；\n· 点 📤 可把这次问诊脱敏后发布到问诊广场求助。\n\n🚨 如遇呼吸困难、大出血、误食毒物、抽搐等危急情况，请立即送医！',
      timeText: hm(),
      _k: this.nextKey()
    }
  },

  nextKey() {
    this._seq += 1
    return 'm' + this._seq
  },

  loadSessions() {
    if (!getApp().isLoggedIn()) {
      this.setData({ sessions: [] })
      return Promise.resolve()
    }
    this.setData({ loadingSessions: true })
    return cloud
      .listRecords()
      .then(list => {
        const sessions = (list || []).map(r => ({
          _id: r._id,
          title: r.title || '问诊记录',
          petName: r.petName || '',
          published: !!r.published,
          count: (r.messages || []).filter(m => m.role === 'user').length,
          timeText: util.formatDateTime(r.updatedAt || r.createdAt)
        }))
        this.setData({ sessions, loadingSessions: false })
      })
      .catch(err => {
        this.setData({ loadingSessions: false })
        cloud.toastError(err)
      })
  },

  onOpenPicker() {
    if (this.data.sending) {
      wx.showToast({ title: 'AI 正在回复，请稍候再切换', icon: 'none' })
      return
    }
    if (!this.data.sessionId) {
      this.setData({ showSessionPicker: true })
      this.loadSessions()
      return
    }
    this.setData({ showSessionPicker: true })
    this.loadSessions()
  },

  onClosePicker() {
    this.setData({ showSessionPicker: false })
  },

  // 新建一个空的问诊记录（首次发送消息时才真正落库，避免产生空档案）
  onCreateSession() {
    this.setData({
      showSessionPicker: false,
      sessionId: '',
      sessionTitle: '',
      published: false,
      messages: [this.greeting()],
      scrollTo: 'bottom-anchor'
    })
  },

  onPickSession(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ showSessionPicker: false })
    if (id === this.data.sessionId) return
    this.openSession(id)
  },

  openSession(id) {
    wx.showLoading({ title: '加载中' })
    cloud
      .getRecord(id)
      .then(rec => {
        wx.hideLoading()
        this.applyRecord(rec)
      })
      .catch(err => {
        wx.hideLoading()
        cloud.toastError(err)
        this.setData({ showSessionPicker: true, messages: [] })
        this.loadSessions()
      })
  },

  applyRecord(rec) {
    const msgs = (rec.messages || []).map((m, i) =>
      Object.assign({}, m, { _k: 'h' + i, timeText: m.time || '' })
    )
    const patch = {
      sessionId: rec._id,
      sessionTitle: rec.title || '',
      published: !!rec.published,
      messages: msgs.length ? msgs : [this.greeting()],
      scrollTo: 'bottom-anchor'
    }
    const petIndex = rec.petId ? this.data.pets.findIndex(p => p._id === rec.petId) : -1
    if (petIndex >= 0) {
      patch.petIndex = petIndex
      patch.currentPet = this.data.pets[petIndex]
    } else {
      patch.petIndex = -1
      patch.currentPet = null
    }
    this.setData(patch)
  },

  // 给当前问诊记录命名（未命名时云端会自动编号 问诊记录1、2、3…）
  onRenameSession() {
    const hasUserMsg = (this.data.messages || []).some(m => m.role === 'user')
    if (!this.data.sessionId && !hasUserMsg) {
      wx.showToast({ title: '先发起一次问诊再命名', icon: 'none' })
      return
    }
    wx.showModal({
      title: '命名问诊记录',
      editable: true,
      placeholderText: '例如：布丁呕吐 / 皮肤瘙痒',
      content: this.data.sessionTitle,
      success: res => {
        if (!res.confirm) return
        const title = (res.content || '').trim().slice(0, 20)
        if (!title) {
          wx.showToast({ title: '名称不能为空', icon: 'none' })
          return
        }
        this.setData({ sessionTitle: title })
        if (this.data.sessionId) {
          cloud.renameRecord(this.data.sessionId, title).catch(err => cloud.toastError(err))
        }
      }
    })
  },

  // 手动发布到问诊广场（默认不发，需用户主动确认，可选择患处部位）
  onPublishSession() {
    if (this.data.published) {
      wx.showToast({ title: '该记录已发布到广场', icon: 'none' })
      return
    }
    const firstUser = (this.data.messages || []).find(m => m.role === 'user')
    if (!firstUser) {
      wx.showToast({ title: '还没有问诊内容可发布', icon: 'none' })
      return
    }
    const pet = this.data.currentPet || {}
    const raw =
      (firstUser.content || '').trim() || (firstUser.video ? '视频问诊求助' : '图片问诊求助')
    // 第一张云端图片作为广场缩略图
    const thumb =
      (firstUser.images || []).find(u => typeof u === 'string' && u.indexOf('cloud://') === 0) || ''
    const PARTS = ['皮肤', '耳朵', '眼睛', '口腔', '粪便', '其他']
    wx.showActionSheet({
      itemList: PARTS,
      success: res => {
        const part = PARTS[res.tapIndex]
        wx.showModal({
          title: '发布到问诊广场',
          content: '将脱敏后公开以下内容（不含个人信息）：\n\n' + raw.slice(0, 60),
          confirmText: '发布',
          success: r => {
            if (!r.confirm) return
            wx.showLoading({ title: '发布中', mask: true })
            cloud
              .squarePublish({
                petKind: pet.category || '宠物',
                petBreed: pet.breed || '',
                part,
                title: (this.data.sessionTitle || raw).slice(0, 40),
                excerpt: raw.slice(0, 120),
                image: thumb,
                recordId: this.data.sessionId || ''
              })
              .then(res2 => {
                wx.hideLoading()
                this.setData({ published: true })
                if (this.data.sessionId && res2 && res2._id) {
                  cloud.markRecordPublished(this.data.sessionId, res2._id).catch(() => {
                    wx.showToast({ title: '已发布，但记录状态同步失败', icon: 'none' })
                  })
                }
                wx.showToast({ title: '已提交，待管理员审核', icon: 'success' })
              })
              .catch(err => {
                wx.hideLoading()
                cloud.toastError(err)
              })
          }
        })
      }
    })
  },

  appendMessage(role, content, extra) {
    const msg = Object.assign({ role, content, timeText: hm(), _k: this.nextKey() }, extra || {})
    this.setData({ messages: this.data.messages.concat([msg]), scrollTo: 'msg-' + msg._k })
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
    if (this.data.sending) {
      wx.showToast({ title: 'AI 正在回复，请稍候再切换', icon: 'none' })
      return
    }
    // 先把当前宠物的会话视图暂存起来
    const prevPetId = this.data.currentPet && this.data.currentPet._id
    if (prevPetId) {
      this._petViews[prevPetId] = {
        sessionId: this.data.sessionId,
        sessionTitle: this.data.sessionTitle,
        published: this.data.published,
        messages: this.data.messages.slice()
      }
    }
    const petIndex = (this.data.petIndex + step + n) % n
    const currentPet = this.data.pets[petIndex]
    this.setData({ petIndex, currentPet })
    const view = this._petViews[currentPet._id]
    if (view && view.messages.length) {
      // 切回来：恢复该宠物之前的会话视图
      this.setData({
        sessionId: view.sessionId || '',
        sessionTitle: view.sessionTitle || '',
        published: !!view.published,
        messages: view.messages,
        scrollTo: 'bottom-anchor'
      })
    } else {
      // 该宠物还没有会话：开启新会话
      this.setData({
        sessionId: '',
        sessionTitle: '',
        published: false,
        messages: [this.greeting()],
        scrollTo: 'bottom-anchor'
      })
    }
    wx.showToast({
      title: '切换宠物成功',
      icon: 'none',
      duration: 2000
    })
  },

  onAddPet() {
    if (!getApp().requireLogin()) return
    wx.navigateTo({ url: '/pages/addPet/addPet' })
  },

  onInput(e) {
    this.setData({ inputValue: e.detail.value })
  },

  send() {
    // 免责声明未同意时先弹窗，同意后继续发送
    if (!wx.getStorageSync('disclaimer_agreed_v1')) {
      this.checkDisclaimer(() => this.send())
      return
    }
    const text = this.data.inputValue.trim()
    const media = this._pendingMedia
    const hasMedia = media.images.length > 0 || !!media.video
    if ((!text && !hasMedia) || this.data.sending) return

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

    this.appendMessage('user', text || (media.video ? '[视频]' : '[图片]'), {
      images: media.images.slice(),
      video: media.video || ''
    })
    this._pendingMedia = { images: [], video: '' }
    getApp()._chatDraftMedia = this._pendingMedia
    this.setData({
      inputValue: '',
      pendingImages: [],
      pendingVideo: '',
      sending: true,
      scrollTo: 'bottom-anchor'
    })

    // 有文字或有已上传到云端的图片 → 走真实 AI；否则（仅本地图/视频且无文字）降级规则引擎
    const cloudImages = media.images.filter(u => typeof u === 'string' && u.indexOf('cloud://') === 0)
    if (cloudImages.length || text) {
      this.requestAI(text, cloudImages, media)
    } else {
      const reply = util.aiConsult(text, this.data.currentPet, media)
      this.appendMessage('ai', reply.content, { level: reply.level })
      this.setData({ sending: false })
      this.saveRecord()
    }
  },

  // 调用真实 AI（文字问诊 / 拍照问诊），失败自动降级回本地规则引擎
  requestAI(text, cloudImages, media) {
    cloud
      .assistantAsk(text, this.data.currentPet, cloudImages)
      .then(data => {
        const level = (data && data.level) || 'green'
        const summary = (data && data.summary) || ''
        let content = (data && data.content) || ''
        if (summary) content = `📋 ${summary}\n\n${content}`
        const followUp = (data && data.followUp) || []
        if (followUp.length) {
          content += '\n\n💬 想评估更准确？请补充：\n' + followUp.map((f, i) => `${i + 1}. ${f}`).join('\n')
        }
        this.appendMessage('ai', content, { level })
      })
      .catch(() => {
        const reply = util.aiConsult(text, this.data.currentPet, media)
        this.appendMessage('ai', reply.content, { level: reply.level })
      })
      .then(() => {
        this.setData({ sending: false })
        this.saveRecord()
      })
  },

  // 快捷提问：填入输入框，可编辑后发送
  onQuickQuestion(e) {
    this.setData({ inputValue: e.currentTarget.dataset.q })
  },

  // 输入栏相机按钮：拍照/相册选图（最多3张）
  onCameraConsult() {
    this.addMoreImages()
  },

  // 保存当前会话：没有 id 时新建（云端自动命名 问诊记录N），有 id 时更新
  saveRecord() {
    const sourceMessages = this.data.messages
    const sessionId = this.data.sessionId
    const msgs = sourceMessages
      .filter(m => m.role === 'user' || m.role === 'ai')
      .map(m => ({
        role: m.role,
        content: m.content,
        time: m.timeText,
        level: m.level || '',
        images: m.images || [],
        video: m.video || ''
      }))
    const pet = this.data.currentPet || {}
    const payload = {
      title: this.data.sessionTitle || '',
      messages: msgs,
      petId: pet._id || '',
      petName: pet.name || '',
      petAvatar: pet.avatarIsImage ? '' : pet.avatar || '',
      consultType: this._consultMode || ''
    }

    // 串行化，避免连续发送时重复创建记录
    this._saveChain = (this._saveChain || Promise.resolve()).then(() => {
      if (sessionId) return cloud.updateRecord(sessionId, payload)
      return cloud.addRecord(payload).then(res => {
        if (res && res._id && !this.data.sessionId && this.data.messages === sourceMessages) {
          this.setData({ sessionId: res._id, sessionTitle: res.title || '' })
        }
      })
    }).catch(err => {
      console.error('保存问诊记录失败', err)
      wx.showToast({ title: '对话暂未保存，请检查网络后重试', icon: 'none' })
    })
    return this._saveChain
  }
})
