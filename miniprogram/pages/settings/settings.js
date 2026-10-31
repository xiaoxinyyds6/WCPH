// 设置与协议（静态内容，离线可读）
const SECTIONS = [
  {
    id: 'disclaimer',
    icon: '⚕️',
    title: '免责声明',
    content:
      '本应用的 AI 问诊仅基于通用宠物医学知识提供初步健康评估与护理建议：\n\n· 不构成诊断结论，不提供处方与药物剂量；\n· 不能替代执业兽医的现场诊疗；\n· 若宠物出现呼吸困难、大出血、抽搐等急症，请立即前往宠物医院；\n· 用户依据本应用建议作出的任何决定，风险自负。'
  },
  {
    id: 'privacy',
    icon: '🔒',
    title: '隐私说明',
    content:
      '本应用仅收集以下信息：\n\n· 手机号（用于登录）；\n· 宠物健康信息（品种、体重、症状描述、患处照片等），仅用于问诊分析与记录留存。\n\n问诊广场展示的内容均经脱敏处理，不包含个人身份信息。所有数据存储于微信云开发环境，不会向第三方传输。'
  },
  {
    id: 'security',
    icon: '🛡️',
    title: '内容安全',
    content:
      '用户发布的问诊文本、帖子与评论会通过微信内容安全接口（msgSecCheck）自动校验，违规内容将被拦截。\n\n如发现漏网的违规内容，可在帖子详情页点击「举报」，管理员将在后台处理并下架违规帖子。'
  },
  {
    id: 'about',
    icon: '🐾',
    title: '关于我们',
    content:
      'AI宠愈 —— AI 宠物问诊助手\n\n面向新手宠物主的轻量辅助工具：以宠物档案为底座，用多模态大模型做症状初判，把每次问诊沉淀为可回溯的健康记录，并支持把脱敏案例发布到问诊广场互助。\n\n本项目为教学与竞赛演示用途。'
  }
]

Page({
  // ===== 分享给好友 / 朋友圈 =====
  onShareAppMessage() {
    return { title: 'AI宠物助手 · 智能守护每一位毛孩子', path: '/pages/mine/mine' }
  },
  onShareTimeline() {
    return { title: 'AI宠物助手 · 智能守护每一位毛孩子' }
  },
  data: {
    sections: SECTIONS,
    openId: ''
  },

  onToggle(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ openId: this.data.openId === id ? '' : id })
  }
})
