/**
 * 云开发调用封装：统一处理 callFunction 与错误提示
 * 依赖云函数：login / pet / record / assistant / square / reminder
 */

function call(name, data, timeout) {
  return wx.cloud
    .callFunction({ name, data, timeout: timeout || 60000 })
    .then(res => {
      const result = res && res.result
      if (result && result.ok === false) {
        const detail = result.detail ? `｜${result.detail}` : ''
        return Promise.reject(new Error((result.msg || '操作失败') + detail))
      }
      return result ? result.data : null
    })
    .catch(err => {
      console.error(`[cloud] ${name}`, err)
      const msg = (err && err.message) || '云函数调用失败，请确认已部署云函数'
      return Promise.reject(new Error(msg))
    })
}

function toastError(err) {
  wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' })
}

module.exports = {
  call,
  toastError,

  // ===== 云存储 =====
  uploadFile: (tempFilePath, cloudPath) =>
    wx.cloud
      .uploadFile({ cloudPath, filePath: tempFilePath })
      .then(res => (res && res.fileID) || tempFilePath),

  // ===== 登录 =====
  smsLogin: (phone, code) => call('login', { action: 'smsLogin', phone, code }),
  verifyCode: (phone, code, purpose) => call('login', { action: 'verifyCode', phone, code, purpose }),
  setPassword: (phone, code, password, mode) =>
    call('login', { action: 'setPassword', phone, code, password, mode }),
  sendCode: phone => call('login', { action: 'sendCode', phone }),
  checkPhoneRegistered: phone => call('login', { action: 'checkPhoneRegistered', phone }),
  updateProfile: (nickname, avatarUrl) =>
    call('login', { action: 'updateProfile', nickname, avatarUrl }),
  // 账号密码登录（账号由管理员创建）
  accountLogin: (username, password) =>
    call('login', { action: 'accountLogin', username, password }),
  // 微信一键登录：纯 openid 建立账户，无需手机号
  wxLogin: () => call('login', { action: 'wxLogin' }),
  adminLogin: (username, password) =>
    call('login', { action: 'adminLogin', username, password }),

  // ===== 管理员后台 =====
  adminIsAdmin: () => call('admin', { action: 'isAdmin' }),
  adminAddAccount: (username, password, nickname) =>
    call('admin', { action: 'addAccount', username, password, nickname }),
  adminListAccounts: () => call('admin', { action: 'listAccounts' }),
  adminRemoveAccount: id => call('admin', { action: 'removeAccount', id }),
  adminStats: () => call('admin', { action: 'stats' }),

  // ===== 宠物 =====
  listPets: () => call('pet', { action: 'list' }),
  getPet: id => call('pet', { action: 'get', id }),
  addPet: pet => call('pet', { action: 'add', pet }),
  updatePet: (id, pet) => call('pet', { action: 'update', id, pet }),
  deletePet: id => call('pet', { action: 'remove', id }),
  countPets: () => call('pet', { action: 'count' }),

  // ===== 问诊记录 =====
  listRecords: () => call('record', { action: 'list' }),
  getRecord: id => call('record', { action: 'get', id }),
  addRecord: record => call('record', { action: 'add', record }),
  updateRecord: (id, record) => call('record', { action: 'update', id, record }),
  renameRecord: (id, title) => call('record', { action: 'rename', id, title }),
  markRecordPublished: (id, squarePostId) =>
    call('record', { action: 'markPublished', id, squarePostId }),
  deleteRecord: id => call('record', { action: 'remove', id }),

  // ===== AI 问诊助手 =====
  assistantAsk: (question, petProfile, fileIDs) =>
    call('assistant', { question, petProfile, fileIDs }, 30000),

  // ===== 问诊广场 =====
  squareList: (page, feed, feedSeed) => call('square', { action: 'list', page, feed, feedSeed }),
  squareSearch: keyword => call('square', { action: 'search', keyword }),
  squareFeatured: () => call('square', { action: 'featured' }),
  squareOfficial: () => call('square', { action: 'officialList' }),
  squareGet: id => call('square', { action: 'get', id }),
  squareMine: () => call('square', { action: 'mylist' }),
  squareFavlist: ids => call('square', { action: 'favlist', ids }),
  squareLiked: () => call('square', { action: 'likedList' }),
  squareLike: id => call('square', { action: 'like', id }),
  squareComment: (id, content) => call('square', { action: 'comment', id, content }),
  squareDeleteComment: (id, commentId) => call('square', { action: 'deleteComment', id, commentId }),
  squarePublish: post => call('square', { action: 'publish', post }),
  squareEditPost: (id, post) => call('square', { action: 'editPost', id, post }),
  squareRemove: id => call('square', { action: 'remove', id }),
  squareReport: (id, type, reason, commentId) =>
    call('square', { action: 'report', id, type, reason, commentId }),
  squareAmIAdmin: () => call('square', { action: 'amIAdmin' }),
  squareAdminPosts: () => call('square', { action: 'adminPosts' }),
  squareAdminRemove: id => call('square', { action: 'adminRemove', id }),
  squareAdminPublishOfficial: post => call('square', { action: 'adminPublishOfficial', post }),
  squareAdminPendingList: () => call('square', { action: 'adminPendingList' }),
  squareAdminAudit: (id, result) => call('square', { action: 'adminAudit', id, result }),
  squareAdminReports: () => call('square', { action: 'adminReports' }),
  squareAdminHandleReport: (id, remove, reason) =>
    call('square', { action: 'adminHandleReport', id, remove: remove === true, reason: String(reason || '').slice(0, 200) }),
  squareNotifications: () => call('square', { action: 'notifications' }),
  squareReadNotifications: ids => call('square', { action: 'readNotifications', ids }),
  squareUnread: () => call('square', { action: 'unread' }),

  // ===== 健康提醒 =====
  listReminders: () => call('reminder', { action: 'list' }),
  getReminder: id => call('reminder', { action: 'get', id }),
  addReminder: reminder => call('reminder', { action: 'add', reminder }),
  updateReminder: (id, reminder) => call('reminder', { action: 'update', id, reminder }),
  completeReminder: id => call('reminder', { action: 'complete', id }),
  skipReminder: id => call('reminder', { action: 'skip', id }),
  reopenReminder: id => call('reminder', { action: 'reopen', id }),
  deleteReminder: id => call('reminder', { action: 'remove', id })
}
