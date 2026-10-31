// 附近宠物医院（真源：腾讯位置服务 POI；兜底：演示数据）
const cloud = require('../../utils/cloud')

// 哈弗辛公式：两点球面距离（公里）
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const rad = d => (d * Math.PI) / 180
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function distText(km) {
  if (km == null) return '距离未知'
  if (km < 1) return (km * 1000).toFixed(0) + 'm'
  return km.toFixed(1) + 'km'
}

// 演示兜底数据：接口不可用时保证页面可用
const HOSPITALS = [
  {
    name: '瑞鹏宠物医院·24h急诊',
    addr: '南山区科技园科苑路15号',
    lat: 22.5405,
    lng: 113.9345,
    phone: '075512345678',
    tag: '24小时'
  },
  {
    name: '芭比堂动物医院',
    addr: '福田区福华三路中心城1层',
    lat: 22.5431,
    lng: 114.0579,
    phone: '075587654321',
    tag: ''
  },
  {
    name: '安安宠医·24小时急诊',
    addr: '罗湖区东门中路2088号',
    lat: 22.5517,
    lng: 114.1236,
    phone: '075599988877',
    tag: '24小时'
  },
  {
    name: '联合宠物医院',
    addr: '南山区南海大道2746号',
    lat: 22.5333,
    lng: 113.9304,
    phone: '075533311122',
    tag: ''
  },
  {
    name: '瑞派宠物医院',
    addr: '宝安区新湖路99号',
    lat: 22.5552,
    lng: 113.883,
    phone: '075544455566',
    tag: ''
  },
  {
    name: '新瑞鹏宠物医院',
    addr: '龙岗区龙翔大道7188号',
    lat: 22.7203,
    lng: 114.2469,
    phone: '075588899900',
    tag: '24小时'
  }
]

Page({
  // ===== 分享给好友 / 朋友圈 =====
  onShareAppMessage() {
    return { title: '附近宠物医院查询 · 一键拨号导航', path: '/pages/hospitals/hospitals' }
  },
  onShareTimeline() {
    return { title: '附近宠物医院查询 · 一键拨号导航' }
  },
  data: {
    hospitals: [],
    located: false,
    locating: true,
    // true = 接口不可用已降级为演示数据
    demoMode: false,
    // 降级原因（地图服务报错、未配置 Key 等），展示给用户便于排查
    errMsg: '',
    // 定位精度（米），用于提示「位置不准」的原因
    accuracy: null,
    // 地图：用户位置 + 医院标记点
    markers: [],
    mapLat: 22.5431,
    mapLng: 114.0579
  },

  onLoad() {
    this.locate()
  },

  onPullDownRefresh() {
    this.locate().then(() => wx.stopPullDownRefresh())
  },

  // 按坐标组装医院列表（含距离计算与排序），供真实数据与演示数据共用
  buildHospitalList(lat, lng, list) {
    return list
      .map(h =>
        Object.assign({}, h, {
          dist: distanceKm(lat, lng, h.lat, h.lng),
          distText: distText(distanceKm(lat, lng, h.lat, h.lng))
        })
      )
      .sort((a, b) => a.dist - b.dist)
  },

  // 降级：接口失败时展示演示数据，保证页面可用
  applyDemo(lat, lng, reason) {
    const hasLoc = lat != null && lng != null
    const hospitals = this.buildHospitalList(
      hasLoc ? lat : 22.5431,
      hasLoc ? lng : 114.0579,
      HOSPITALS.map(h => Object.assign({}, h))
    )
    const view = hasLoc
      ? hospitals
      : hospitals.map(h => Object.assign({}, h, { dist: null, distText: '距离未知' }))
    this.setData({
      hospitals: view,
      demoMode: true,
      errMsg: reason || '',
      accuracy: null,
      mapLat: hasLoc ? lat : 22.5431,
      mapLng: hasLoc ? lng : 114.0579,
      markers: hasLoc ? this.buildMarkers(hospitals) : []
    })
  },

  locate() {
    this.setData({ locating: true, errMsg: '' })
    return new Promise(resolve => {
      wx.getLocation({
        type: 'gcj02',
        // 高精度定位：室外 GPS 可把误差从公里级降到十几米
        isHighAccuracy: true,
        highAccuracyExpireTime: 6000,
        success: res => {
          const lat = res.latitude
          const lng = res.longitude
          this.setData({
            located: true,
            locating: false,
            accuracy: Math.round(Number(res.accuracy) || 0) || null,
            mapLat: lat,
            mapLng: lng
          })

          // 真源：腾讯位置服务检索附近宠物医院；失败自动降级演示数据
          cloud
            .nearbyHospitals(lat, lng)
            .then(list => {
              // 云函数旧版本或异常返回非数组时，也走降级，避免白屏
              if (!Array.isArray(list) || !list.length) {
                this.applyDemo(lat, lng, Array.isArray(list) ? '附近 5 公里内未检索到宠物医院' : '医院数据格式异常')
                resolve()
                return
              }
              const hospitals = this.buildHospitalList(lat, lng, list)
              this.setData({
                hospitals,
                demoMode: false,
                errMsg: '',
                markers: this.buildMarkers(hospitals)
              })
              resolve()
            })
            .catch(err => {
              this.applyDemo(lat, lng, (err && err.message) || '医院检索服务调用失败')
              resolve()
            })
        },
        fail: err => {
          this.setData({ located: false, locating: false, markers: [] })
          // 微信原始 errMsg 较长，转成一句可读原因
          let why = ((err && err.errMsg) || '').replace(/^getLocation:fail\s*/, '') || '未知原因'
          if (/频繁调用/.test(why)) why = '定位请求过于频繁，请稍后点击重新定位'
          this.applyDemo(null, null, `定位失败：${why}`)
          // 用户拒绝授权时引导去设置页开启
          if (err && /auth deny|auth denied/.test(err.errMsg || '')) {
            wx.showModal({
              title: '需要定位权限',
              content: '获取定位后才能计算与宠物医院的距离，是否前往设置开启？',
              confirmText: '去设置',
              cancelText: '暂不',
              success: r => {
                if (r.confirm) wx.openSetting()
              }
            })
          }
          resolve()
        }
      })
    })
  },

  // 生成地图标记点：名称与距离放 callout 气泡，点击标记直接发起导航
  buildMarkers(hospitals) {
    return hospitals.map((h, i) => ({
      id: i,
      latitude: h.lat,
      longitude: h.lng,
      iconPath: '/assets/marker.png',
      width: 30,
      height: 30,
      callout: {
        content: `${h.name}\n${h.distText}`,
        display: 'ALWAYS',
        padding: 6,
        borderRadius: 6,
        fontSize: 11,
        color: '#2F3A3F'
      }
    }))
  },

  onMarkerTap(e) {
    const h = this.data.hospitals[e.detail.markerId]
    if (!h) return
    wx.openLocation({
      latitude: h.lat,
      longitude: h.lng,
      name: h.name,
      address: h.addr,
      scale: 15
    })
  },

  onRelocate() {
    this.locate()
  },

  onCall(e) {
    const phone = e.currentTarget.dataset.phone
    if (phone) wx.makePhoneCall({ phoneNumber: phone })
  },

  onOpenMap(e) {
    const { lat, lng, name, addr } = e.currentTarget.dataset
    wx.openLocation({
      latitude: Number(lat),
      longitude: Number(lng),
      name,
      address: addr,
      scale: 15
    })
  }
})
