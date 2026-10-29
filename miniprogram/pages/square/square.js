const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

const KIND_EMOJI = { 猫: '🐱', 狗: '🐶', 兔: '🐰', 鸟: '🐦', 仓鼠: '🐹', 乌龟: '🐢' }
const REPORT_TYPES = ['广告营销', '辱骂攻击', '虚假信息', '虐宠内容', '其他']
// 收藏 id 列表 + 帖子快照（快照用于「我的收藏」在云端不可用时兜底展示）
const FAV_KEY = 'square_favs_v1'
const FAV_POSTS_KEY = 'square_fav_posts_v1'

// 云端不可用（如未部署 square 云函数）时的本地示例案例（已脱敏）
const FALLBACK_POSTS = [
  {
    _id: 'demo1',
    petKind: '猫',
    petBreed: '布偶猫',
    part: '其他',
    title: '布偶猫呕吐怎么办',
    excerpt: '3个月布偶猫，昨晚吐了两次未消化的猫粮，精神食欲还正常，需要马上就医吗？',
    image: '',
    likes: [],
    comments: [
      { content: '少食多餐观察一下，精神好一般问题不大', createdAt: 1730000000000 },
      { content: '我家猫以前也这样，换粮太快引起的', createdAt: 1730001000000 }
    ],
    demo: true,
    createdAt: Date.now() - 3600000
  },
  {
    _id: 'demo2',
    petKind: '狗',
    petBreed: '金毛',
    part: '粪便',
    title: '狗狗拉稀带血丝',
    excerpt: '金毛昨晚偷吃了半根火腿肠，今天拉稀带少量血丝，活泼能吃，急！',
    image: '',
    likes: [],
    comments: [{ content: '便血别拖，建议做个细小检测', createdAt: 1730002000000 }],
    demo: true,
    createdAt: Date.now() - 7200000
  },
  {
    _id: 'demo3',
    petKind: '猫',
    petBreed: '英短',
    part: '耳朵',
    title: '猫咪频繁挠耳朵',
    excerpt: '英短最近老挠耳朵，耳朵里有很多黑褐色耳垢，是耳螨吗？',
    image: '',
    likes: [],
    comments: [
      { content: '像耳螨，用洁耳液+驱虫药，坚持两周', createdAt: 1730003000000 },
      { content: '去宠物医院做个耳镜更放心', createdAt: 1730003100000 }
    ],
    demo: true,
    createdAt: Date.now() - 86400000
  }
]

// 云端不可用（如未部署 square 云函数）时的官方好帖本地兜底（已脱敏）
const OFFICIAL_FALLBACK = [
  {
    _id: 'official-f1',
    official: true,
    petKind: '猫',
    petBreed: '通用',
    title: '猫咪换季掉毛严重怎么办？',
    excerpt: '每周梳毛2-3次减少浮毛，适量补充卵磷脂与鱼油；若出现斑秃、红疹、频繁抓挠，需排查皮肤病并及时就医。',
    image: '',
    likes: [],
    comments: [],
    createdAt: Date.now() - 3600000
  },
  {
    _id: 'official-f2',
    official: true,
    petKind: '狗',
    petBreed: '通用',
    title: '狗狗每天到底要遛多久？',
    excerpt: '小型犬每天30-60分钟、中型犬60-90分钟、大型犬90-120分钟，可分早晚两次；老年犬与幼犬适量减半，天气炎热时避开正午。',
    image: '',
    likes: [],
    comments: [],
    createdAt: Date.now() - 7200000
  },
  {
    _id: 'official-f3',
    official: true,
    petKind: '兔',
    petBreed: '通用',
    title: '兔子的科学饮食结构',
    excerpt: '提摩西草应占每日饮食70%以上，兔粮按体重限量（约体重的2%-3%），每日提供新鲜饮水与少量绿叶菜，避免高糖零食。',
    image: '',
    likes: [],
    comments: [],
    createdAt: Date.now() - 10800000
  },
  {
    _id: 'official-f4',
    official: true,
    petKind: '龟',
    petBreed: '通用',
    title: '乌龟冬眠前后的养护要点',
    excerpt: '冬眠前2-4周停止喂食清空肠胃，环境温度稳定在5-10℃，提供湿润垫材；冬眠中每周检查一次，出现腐皮腐甲需终止冬眠加温处理。',
    image: '',
    likes: [],
    comments: [],
    createdAt: Date.now() - 14400000
  }
]

Page({
  // ===== 分享给好友 / 朋友圈 =====
  onShareAppMessage() {
    return { title: '问诊广场 · 养宠人的经验交流社区', path: '/pages/square/square' }
  },
  onShareTimeline() {
    return { title: '问诊广场 · 养宠人的经验交流社区' }
  },
  data: {
    logged: false,
    posts: [],
    loading: true,
    openId: '',
    offline: false,
    page: 0,
    hasMore: true,
    loadingMore: false,
    // 「不感兴趣」：本地隐藏的帖子 id 列表 + 当前展开下拉菜单的帖子 id
    hiddenIds: [],
    menuId: '',
    // 收藏的帖子 id 列表（本地持久化）
    favIds: [],
    // 未读消息数（信封角标）
    unread: 0,
    // 从消息页跳转过来时要定位高亮的帖子 id
    highlightId: '',
    // 每日公告弹框
    showNotice: false,
    noticeDismiss: false,
    // 三标签：问诊大厅 / 精选好帖 / 官方好帖
    tab: 'hall',
    feed: 'recommend',
    feedSeed: 0,
    featuredPosts: [],
    featuredLoading: false,
    officialPosts: [],
    officialLoading: false
  },

  onTabItemTap() {
    this.setData({ tab: 'hall', feed: 'recommend', menuId: '', showNotice: false })
    wx.pageScrollTo({ scrollTop: 0, duration: 0 })
    if (this.data.logged) this.refresh()
  },

  onShow() {
    const logged = getApp().isLoggedIn()
    this.setData({
      logged,
      openId: getApp().globalData.openid || '',
      hiddenIds: this.loadHiddenIds(),
      favIds: this.loadFavIds(),
      menuId: '',
      showNotice: false
    })
    if (!logged) {
      wx.showModal({
        title: '登录过期',
        content: '为了账户安全，请重新登录',
        cancelText: '稍后',
        confirmText: '立即登录',
        success: res => {
          if (res.confirm) this.onLogin()
        }
      })
      return
    }
    if (!this.loaded) {
      this.loaded = true
      this.refresh()
    } else if (getApp()._squareTargetPostId) {
      this.scrollToTarget()
    }
    this.loadUnread()
    if (!this.noticeChecked) {
      this.noticeChecked = true
      this.checkDailyNotice()
    }
  },

  onLogin() {
    wx.navigateTo({ url: '/pages/login/login' })
  },

  // 每天第一次进入广场：弹公告（勾选“一天内不再提醒”则当天不再弹）
  checkDailyNotice() {
    let dismissed = false
    try {
      dismissed = !!wx.getStorageSync('square_notice_' + util.todayStr())
    } catch (e) {
      dismissed = false
    }
    this.setData({ showNotice: !dismissed, noticeDismiss: false })
  },

  onNoticeToggle() {
    this.setData({ noticeDismiss: !this.data.noticeDismiss })
  },

  onNoticeClose() {
    if (this.data.noticeDismiss) {
      try {
        const info = wx.getStorageInfoSync()
        ;(info.keys || []).forEach(key => {
          if (key.indexOf('square_notice_') === 0) wx.removeStorageSync(key)
        })
        wx.setStorageSync('square_notice_' + util.todayStr(), '1')
      } catch (e) {}
    }
    this.setData({ showNotice: false })
  },

  loadUnread() {
    cloud
      .squareUnread()
      .then(res => {
        this.setData({ unread: (res && res.unread) || 0 })
      })
      .catch(() => {})
  },

  onMessages() {
    wx.navigateTo({ url: '/pages/messages/messages' })
  },

  onPullDownRefresh() {
    if (!this.data.logged) {
      wx.stopPullDownRefresh()
      return
    }
    this.loadUnread()
    this.reloadActive().then(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (!this.data.logged || this.data.tab !== 'hall') return
    if (this.data.offline || this.data.loadingMore || !this.data.hasMore) return
    this.load(this.data.page + 1, true)
  },

  onFeedTab(e) {
    const feed = e.currentTarget.dataset.feed
    if (feed === this.data.feed && this.data.loading) return
    this.setData({ feed, menuId: '' })
    wx.pageScrollTo({ scrollTop: 0, duration: 0 })
    this.refresh()
  },

  // 进入搜索页
  onSearchTap() {
    wx.navigateTo({ url: '/pages/searchPosts/searchPosts' })
  },

  refresh() {
    const feedSeed = this.data.feed === 'recommend' ? Date.now() + Math.random() : 0
    this._feedRequest = (this._feedRequest || 0) + 1
    this.setData({ page: 0, hasMore: true, feedSeed, loadingMore: false })
    return this.load(0).then(() => this.scrollToTarget())
  },

  // 消息页跳转过来时：滚动定位到目标帖子并高亮提示（帖子在问诊大厅列表中）
  scrollToTarget() {
    const targetId = getApp()._squareTargetPostId
    if (!targetId) return
    delete getApp()._squareTargetPostId
    if (this.data.tab !== 'hall') this.setData({ tab: 'hall' })
    setTimeout(() => {
      const exists = this.data.posts.some(p => p._id === targetId)
      if (!exists) {
        wx.navigateTo({ url: '/pages/postDetail/postDetail?id=' + targetId })
        return
      }
      wx.pageScrollTo({ selector: '#post-' + targetId, duration: 300 })
      this.setData({ highlightId: targetId })
      setTimeout(() => this.setData({ highlightId: '' }), 2600)
    }, 400)
  },

  // 标签切换（页内切换，不跳转页面）
  onTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.tab) return
    this.setData({ tab, menuId: '' })
    if (tab === 'featured' && !this.data.featuredPosts.length) this.loadFeatured()
    else if (tab === 'official' && !this.data.officialPosts.length) this.loadOfficial()
  },

  // 精选好帖：点赞过百上榜（样式与大厅一致）
  loadFeatured() {
    this.setData({ featuredLoading: true })
    return cloud
      .squareFeatured()
      .then(list => {
        this.setData({ featuredPosts: this.applyPosts(list || []), featuredLoading: false })
      })
      .catch(err => {
        this.setData({ featuredLoading: false })
        console.warn('[square] 精选加载失败', err && err.message)
        wx.showToast({ title: '精选加载失败，请下拉重试', icon: 'none' })
      })
  },

  // 官方好帖：官方发布的宠物养护小知识（云端不可用时本地兜底）
  loadOfficial() {
    this.setData({ officialLoading: true })
    return cloud
      .squareOfficial()
      .then(list => {
        this.setData({ officialPosts: this.applyPosts(list || []), officialLoading: false })
      })
      .catch(err => {
        console.warn('[square] 官方好帖云端不可用，使用本地示例', err && err.message)
        this.setData({
          officialPosts: this.applyPosts(OFFICIAL_FALLBACK),
          officialLoading: false
        })
      })
  },

  load(page, append) {
    const requestId = this._feedRequest || 0
    const feed = this.data.feed
    const feedSeed = this.data.feedSeed
    this.setData(append ? { loadingMore: true } : { loading: true })
    return cloud
      .squareList(page, feed, feedSeed)
      .then(res => {
        if (requestId !== this._feedRequest || feed !== this.data.feed) return
        const raw = (res && res.list) || []
        const decorated = this.applyPosts(this.filterHidden(raw))
        this.setData({
          offline: false,
          posts: append ? this.data.posts.concat(decorated) : decorated,
          page,
          hasMore: !!(res && res.hasMore),
          loading: false,
          loadingMore: false
        })
      })
      .catch(err => {
        if (requestId !== this._feedRequest || feed !== this.data.feed) return
        // 云函数未部署/网络异常时静默降级为本地示例，不弹报错
        console.warn('[square] 云端不可用，使用本地示例数据', err && err.message)
        this.setData({
          offline: true,
          hasMore: false,
          loading: false,
          loadingMore: false,
          posts: append ? this.data.posts : this.applyPosts(this.filterHidden(FALLBACK_POSTS))
        })
      })
  },

  // ===== 「不感兴趣」隐藏 =====
  loadHiddenIds() {
    try {
      const v = wx.getStorageSync('square_hidden_v1')
      return Array.isArray(v) ? v : []
    } catch (e) {
      return []
    }
  },

  saveHiddenIds(ids) {
    try {
      wx.setStorageSync('square_hidden_v1', ids.slice(0, 200))
    } catch (e) {}
  },

  filterHidden(list) {
    const hidden = this.data.hiddenIds
    return hidden.length ? list.filter(p => hidden.indexOf(p._id) < 0) : list
  },

  // ===== 收藏 =====
  loadFavIds() {
    try {
      const v = wx.getStorageSync(FAV_KEY)
      return Array.isArray(v) ? v : []
    } catch (e) {
      return []
    }
  },

  saveFavIds(ids) {
    try {
      wx.setStorageSync(FAV_KEY, ids.slice(0, 200))
    } catch (e) {}
  },

  // 保存/删除收藏帖子的本地快照
  saveFavSnap(id, post) {
    try {
      const map = wx.getStorageSync(FAV_POSTS_KEY) || {}
      map[id] = {
        _id: id,
        petKind: post.petKind,
        petBreed: post.petBreed,
        part: post.part,
        title: post.title,
        excerpt: post.excerpt,
        image: post.image,
        createdAt: post.createdAt,
        demo: !!post.demo,
        fromConsult: !!post.fromConsult,
        likeCount: post.likeCount,
        commentCount: post.commentCount
      }
      wx.setStorageSync(FAV_POSTS_KEY, map)
    } catch (e) {}
  },

  removeFavSnap(id) {
    try {
      const map = wx.getStorageSync(FAV_POSTS_KEY) || {}
      delete map[id]
      wx.setStorageSync(FAV_POSTS_KEY, map)
    } catch (e) {}
  },

  // 当前标签对应的列表 data key
  activeKey() {
    if (this.data.tab === 'featured') return 'featuredPosts'
    if (this.data.tab === 'official') return 'officialPosts'
    return 'posts'
  },

  reloadActive() {
    if (this.data.tab === 'featured') return this.loadFeatured()
    if (this.data.tab === 'official') return this.loadOfficial()
    return this.refresh()
  },

  // 收藏/取消收藏：空心星 ↔ 实心黄星（作用于当前标签列表）
  onFav(e) {
    if (!getApp().requireLogin()) return
    const id = e.currentTarget.dataset.id
    const key = this.activeKey()
    const post = this.data[key].find(p => p._id === id)
    const favIds = this.data.favIds.slice()
    const idx = favIds.indexOf(id)
    let fav = false
    if (idx >= 0) {
      favIds.splice(idx, 1)
      this.removeFavSnap(id)
      wx.showToast({ title: '已取消收藏', icon: 'none' })
    } else {
      favIds.push(id)
      fav = true
      if (post) this.saveFavSnap(id, post)
      wx.showToast({ title: '收藏成功', icon: 'none' })
    }
    this.saveFavIds(favIds)
    this.setData({
      favIds,
      [key]: this.data[key].map(p => (p._id === id ? Object.assign({}, p, { fav }) : p))
    })
  },

  noop() {},

  onMore(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ menuId: this.data.menuId === id ? '' : id })
  },

  onCloseMenu() {
    this.setData({ menuId: '' })
  },

  onNotInterested(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ menuId: '' })
    wx.showModal({
      title: '提示',
      content: '将不显示该帖子',
      confirmText: '是',
      cancelText: '否',
      success: res => {
        if (res.confirm) this.hidePost(id, '已去除，将不再显示')
      }
    })
  },

  // 举报：与帖子详情页一致（选类型 → 补充说明 → 提交云端），成功后同样从自己的列表去除
  onReport(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ menuId: '' })
    if (!getApp().requireLogin()) return
    wx.showActionSheet({
      itemList: REPORT_TYPES,
      success: res => {
        const type = REPORT_TYPES[res.tapIndex]
        wx.showModal({
          title: '举报该帖子',
          content: '举报类型：' + type,
          editable: true,
          placeholderText: '可补充说明举报原因（选填）',
          success: r => {
            if (!r.confirm) return
            wx.showLoading({ title: '提交中', mask: true })
            cloud
              .squareReport(id, type, r.content || '')
              .then(() => {
                wx.hideLoading()
                this.hidePost(id, '举报成功，已从列表中去除')
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

  // 从列表移除并持久化，保证之后刷新/翻页都不再出现
  hidePost(id, toastText) {
    const hiddenIds = this.data.hiddenIds.concat([id])
    this.setData({
      hiddenIds,
      posts: this.data.posts.filter(p => p._id !== id)
    })
    this.saveHiddenIds(hiddenIds)
    wx.showToast({ title: toastText, icon: 'none' })
  },

  applyPosts(list) {
    const openid = this.data.openId
    const favIds = this.data.favIds
    return list.map(p =>
      Object.assign({}, p, {
        kindEmoji: KIND_EMOJI[p.petKind] || '🐾',
        breedText: p.petBreed ? ' · ' + p.petBreed : '',
        timeText: util.formatDateTime(p.createdAt),
        likeCount: p.likeCount != null ? p.likeCount : (p.likes || []).length,
        likedByMe: (p.likes || []).indexOf(openid) >= 0,
        commentCount: (p.comments || []).length,
        // 优先用服务端标记（不依赖本地登录态），旧版云函数未返回时按本地 openid 兜底
        mine: p.mine !== undefined ? p.mine : p._openid === openid,
        fav: favIds.indexOf(p._id) >= 0
      })
    )
  },

  onLike(e) {
    if (!getApp().requireLogin()) return
    const id = e.currentTarget.dataset.id
    const key = this.activeKey()
    let newLiked = false
    const list = this.data[key].map(p => {
      if (p._id !== id) return p
      newLiked = !p.likedByMe
      return Object.assign({}, p, {
        likedByMe: newLiked,
        likeCount: p.likeCount + (newLiked ? 1 : -1)
      })
    })
    this.setData({ [key]: list })
    cloud.squareLike(id).catch(() => {
      console.warn('[square] like sync failed')
      this.reloadActive()
    })
  },

  onPostTap(e) {
    wx.navigateTo({ url: '/pages/postDetail/postDetail?id=' + e.currentTarget.dataset.id })
  },

  // 右下角 + ：发布求助话题
  onCreateTopic() {
    if (!getApp().requireLogin()) return
    wx.navigateTo({ url: '/pages/topic/topic' })
  }
})
