// 附近宠物医院（演示数据：坐标为深圳市区；正式版可接入腾讯位置服务 POI 检索）
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

  locate() {
    this.setData({ locating: true })
    return new Promise(resolve => {
      wx.getLocation({
        type: 'gcj02',
        success: res => {
          const hospitals = HOSPITALS.map(h =>
            Object.assign({}, h, {
              dist: distanceKm(res.latitude, res.longitude, h.lat, h.lng),
              distText: distText(distanceKm(res.latitude, res.longitude, h.lat, h.lng))
            })
          ).sort((a, b) => a.dist - b.dist)
          this.setData({
            hospitals,
            located: true,
            locating: false,
            mapLat: res.latitude,
            mapLng: res.longitude,
            markers: this.buildMarkers(hospitals)
          })
          resolve()
        },
        fail: err => {
          const hospitals = HOSPITALS.map(h => Object.assign({}, h, { dist: null, distText: '距离未知' }))
          this.setData({ hospitals, located: false, locating: false })
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
