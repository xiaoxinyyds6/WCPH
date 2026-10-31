'use strict'
/**
 * 图像问诊「观察师-审查员」两阶段诊断流程单元测试（含知识库配合的回归用例）
 * 运行方式：node test/assistant-image-flow.test.js
 *
 * 说明：assistant 云函数依赖 wx-server-sdk 与外部模型 API，本测试通过
 * Module._load 拦截这两个模块完成离线 mock，不发起任何真实网络请求。
 */
const assert = require('assert')
const EventEmitter = require('events')
const Module = require('module')

const INDEX_PATH = require.resolve('../cloudfunctions/assistant/index.js')

// 云函数入口会校验该环境变量，mock 环境需预先提供
process.env.ZHIPU_API_KEY = 'test-key'

/* ================= mock 全局状态 ================= */
let calls = [] // 按调用顺序记录的模型请求 { body }
let responders = [] // 与 calls 一一对应的模拟响应

/* ---------------- 模拟 https 模块 ---------------- */
class MockIncoming extends EventEmitter {}

class MockRequest {
  constructor(opts, cb) {
    this.opts = opts
    this.cb = cb
    this.chunks = []
  }

  write(c) {
    this.chunks.push(c)
    return true
  }

  end() {
    const body = JSON.parse(this.chunks.join(''))
    const idx = calls.length
    calls.push(Object.assign({}, this.opts, { body }))
    setImmediate(() => {
      const r = responders[idx] || { status: 200, body: { choices: [] } }
      const res = new MockIncoming()
      res.statusCode = r.status
      this.cb(res)
      setTimeout(() => {
        res.emit('data', typeof r.raw === 'string' ? r.raw : JSON.stringify(r.body || {}))
        res.emit('end')
      }, 0)
    })
  }

  on() {
    return this
  }

  destroy() {}
}

Module._load = (function (orig) {
  return function (request, parent, isMain) {
    if (request === 'wx-server-sdk') return cloudMock
    if (request === 'https') {
      return {
        request: (opts, cb) => new MockRequest(opts, cb),
        // 地图服务 GET：模拟网络不可用，用于验证降级路径
        get: () => {
          const req = new MockIncoming()
          req.destroy = () => {}
          setImmediate(() => req.emit('error', new Error('mock network unavailable')))
          return req
        }
      }
    }
    return orig.call(this, request, parent, isMain)
  }
})(Module._load)

/* ---------------- 模拟 wx-server-sdk（内存云数据库） ---------------- */
let idSeq = 0

function makeDb({ kbDocs = [], metaVersion = null }) {
  const docsMap = new Map()
  const put = (name, doc) => {
    if (!docsMap.has(name)) docsMap.set(name, [])
    docsMap.get(name).push(doc)
  }

  for (const d of kbDocs) {
    put('kb_docs', Object.assign({ _id: `kb_${++idSeq}` }, d))
  }
  if (metaVersion !== null) {
    put('kb_meta', { _id: 'seed', version: metaVersion })
  }

  const collection = name => {
    const ctx = { select: null, limitN: null }
    const chain = {
      field(sel) {
        ctx.select = Object.assign({}, sel)
        return chain
      },
      limit(n) {
        ctx.limitN = n
        return chain
      },
      orderBy() {
        return chain
      },
      where() {
        return chain
      },
      skip() {
        return chain
      },
      async add({ data }) {
        const list = Array.isArray(data) ? data : [data]
        const ids = []
        for (const item of list) {
          const doc = Object.assign({ _id: `${name}_${++idSeq}` }, item)
          put(name, doc)
          ids.push(doc._id)
        }
        return Array.isArray(data) ? { _ids: ids } : { _id: ids[0] }
      },
      async get() {
        let list = docsMap.get(name) || []
        if (ctx.select) {
          list = list.map(d => {
            const out = { _id: d._id }
            Object.keys(ctx.select).forEach(k => {
              out[k] = d[k]
            })
            return out
          })
        }
        if (ctx.limitN != null) list = list.slice(0, ctx.limitN)
        return { data: list }
      },
      doc(id) {
        return {
          async get() {
            const found = (docsMap.get(name) || []).find(d => d._id === id)
            if (!found) throw new Error('document does not exist')
            return { data: found }
          },
          async set({ data }) {
            const list = docsMap.get(name) || []
            const found = list.find(d => d._id === id)
            if (found) {
              Object.assign(found, data)
            } else {
              put(name, Object.assign({ _id: id }, data))
            }
            return { stats: { updated: 1 } }
          }
        }
      }
    }
    return chain
  }

  return {
    async createCollection() {},
    collection,
    // 测试辅助：读取某集合全部文档
    _dump(name) {
      return (docsMap.get(name) || []).slice()
    }
  }
}

const cloudMock = {
  DYNAMIC_CURRENT_ENV: 'test-env',
  init() {},
  database: () => null,
  downloadFile: async () => ({ fileContent: Buffer.from('fake-jpeg') }),
  openapi: { security: { msgSecCheck: async () => ({ result: { suggest: 'pass' } }) } },
  getWXContext: () => ({ OPENID: 'openid-test' })
}

/* ---------------- 装配与加载被测模块（每个用例重载一次） ---------------- */
function loadAssistant(state) {
  calls = []
  responders = []
  cloudMock.database = () => state.db
  delete require.cache[INDEX_PATH]
  return require(INDEX_PATH)
}

function respond(...list) {
  responders = list
}

function fail(status, message) {
  return { status, body: { error: { message } } }
}

/* ---------------- 通用夹具 ---------------- */
const KB_SKIN_DOC = {
  title: '犬猫皮肤瘙痒与脱毛',
  content:
    '常见原因：真菌（圆形脱毛伴皮屑）、螨虫（剧烈瘙痒、红疹）、跳蚤过敏性皮炎。勿自行涂人用药膏。'
}

// 观察师输出：详尽影像报告 + 检索关键词
const OBSERVER_JSON = JSON.stringify({
  keywords: ['皮肤', '圆形脱毛', '鳞屑'],
  report:
    '图1：犬背部可见约2cm圆形脱毛区，边缘略红伴少量皮屑，中心皮肤淡粉色，未见破溃渗出；精神状态图中不可见。可疑方向：真菌性皮肤病、浅表细菌感染。'
})

// 审查员最终输出
const FINAL_ANSWER = JSON.stringify({
  level: 'yellow',
  summary: '疑似真菌性皮肤病',
  analysis: '图片及观察报告可见背部圆形脱毛伴鳞屑，符合真菌感染特征，与知识库资料一致',
  diseases: ['真菌性皮肤病 —— 圆形脱毛伴鳞屑'],
  care: ['每日一次用宠物专用香波清洗患处并吹干，保持环境干燥', '记录患处大小变化，每周拍照对比'],
  meds: ['局部抗真菌药膏（类别建议）'],
  visit: '较轻，建议24小时内到院做伍德灯与皮肤刮片确诊',
  forbid: ['勿自行涂人用激素药膏'],
  followUp: ['宠物最近是否频繁抓挠？']
})

function okJson(contentText) {
  return { status: 200, body: { choices: [{ message: { content: contentText } }] } }
}

function imageEvent(question, fileIDs = ['cloud://test/1.jpg']) {
  return { question, petProfile: {}, fileIDs }
}

/* ================= 测试用例 ================= */
const cases = []

cases.push({
  name: '纯图片两阶段：观察师出报告+关键词 → 知识库注入 → 审查员终判',
  async fn() {
    const db = makeDb({ kbDocs: [KB_SKIN_DOC], metaVersion: 8 })
    const assistant = loadAssistant({ db })
    respond(okJson(OBSERVER_JSON), okJson(FINAL_ANSWER))

    const res = await assistant.main(imageEvent(''))

    assert.strictEqual(res.ok, true)
    assert.strictEqual(calls.length, 2, '两阶段各一次调用')

    // 阶段一：观察师
    const obs = calls[0].body
    assert.strictEqual(obs.model, 'glm-4.6v-flash', '观察师使用免费多图模型')
    assert.ok(obs.max_tokens <= 1000, '观察师输出为观察报告+关键词')
    assert.ok(obs.messages[0].content.indexOf('影像观察师') >= 0, '观察师使用专项提示词')
    assert.ok(obs.messages[1].content[0].type === 'image_url', '观察师应看到图片')

    // 阶段二：审查员
    const rev = calls[1].body
    assert.strictEqual(rev.model, 'glm-4.6v-flash')
    assert.strictEqual(rev.max_tokens, 1024, '免费视觉模型 max_tokens 上限 1024，审查员需按满配输出')
    assert.ok(rev.messages[0].content.indexOf('[资料1] 犬猫皮肤瘙痒与脱毛') >= 0, '审查员注入知识库资料')
    assert.ok(rev.messages[0].content.indexOf('【图像与资料交叉验证】') >= 0, '审查员带交叉验证指令')
    assert.ok(
      rev.messages[1].content[rev.messages[1].content.length - 1].text.indexOf('【影像观察报告') >= 0,
      '审查员应拿到观察师报告'
    )
    assert.ok(rev.messages[1].content[0].type === 'image_url', '审查员同样应看到图片')

    assert.strictEqual(res.data.level, 'yellow')
    assert.ok(res.data.summary.length > 0)
    assert.ok(res.data.content.indexOf('真菌') >= 0)
    assert.ok(res.data.content.indexOf('可用药类') >= 0, '治疗意见应包含药物类别建议')
    assert.ok(Array.isArray(res.data.followUp))
  }
})

cases.push({
  name: '观察师首选模型失败：自动回退次级免费模型，链路继续可用',
  async fn() {
    const db = makeDb({ kbDocs: [KB_SKIN_DOC], metaVersion: 8 })
    const assistant = loadAssistant({ db })
    respond(
      fail(500, 'server busy'),
      okJson(OBSERVER_JSON),
      okJson(FINAL_ANSWER)
    )

    const res = await assistant.main(imageEvent(''))

    assert.strictEqual(res.ok, true)
    assert.strictEqual(calls.length, 3, '观察师失败一次后回退 + 审查员一次')
    assert.strictEqual(calls[0].body.model, 'glm-4.6v-flash', '首次尝试多图免费模型')
    assert.strictEqual(calls[1].body.model, 'glm-4v-flash', '失败后回退到单图免费模型')
    assert.ok(
      calls[2].body.messages[0].content.indexOf('[资料1] 犬猫皮肤瘙痒与脱毛') >= 0,
      '回退后知识库仍正常注入'
    )
  }
})

cases.push({
  name: '观察师全部失败：降级为直接诊断，不注入知识库但问诊可用',
  async fn() {
    const db = makeDb({ kbDocs: [KB_SKIN_DOC], metaVersion: 8 })
    const assistant = loadAssistant({ db })
    respond(fail(500, 'a'), fail(500, 'b'), fail(500, 'c'), okJson(FINAL_ANSWER))

    const res = await assistant.main(imageEvent(''))

    assert.strictEqual(res.ok, true, '观察师全挂也不影响问诊可用性')
    assert.strictEqual(calls.length, 4, '两个观察师模型失败 + 审查员模型回退一次后成功')
    assert.ok(
      calls[3].body.messages[0].content.indexOf('【私有知识库】') < 0,
      '无关键词时不得注入无关资料'
    )
  }
})

cases.push({
  name: '观察师关键词无知识库命中：审查员不注入资料',
  async fn() {
    const db = makeDb({ kbDocs: [KB_SKIN_DOC], metaVersion: 8 })
    const assistant = loadAssistant({ db })
    respond(
      okJson(JSON.stringify({ keywords: ['咔哒谜语', '呜噜音节'], report: '图1未见明显异常' })),
      okJson(FINAL_ANSWER)
    )

    const res = await assistant.main(imageEvent(''))

    assert.strictEqual(res.ok, true)
    assert.strictEqual(calls.length, 2)
    assert.ok(
      calls[1].body.messages[0].content.indexOf('【私有知识库】') < 0,
      '知识库无匹配时不注入资料'
    )
  }
})

cases.push({
  name: '文字+图片：两阶段照走，知识库由「文字+关键词」联合检索',
  async fn() {
    const db = makeDb({ kbDocs: [KB_SKIN_DOC], metaVersion: 8 })
    const assistant = loadAssistant({ db })
    respond(okJson(OBSERVER_JSON), okJson(FINAL_ANSWER))

    const res = await assistant.main(imageEvent('狗狗皮肤掉毛'))

    assert.strictEqual(res.ok, true)
    assert.strictEqual(calls.length, 2, '文字+图片同样走两阶段')
    const revSys = calls[1].body.messages[0].content
    assert.ok(revSys.indexOf('[资料1] 犬猫皮肤瘙痒与脱毛') >= 0, '联合检索应命中知识库')
    assert.ok(revSys.indexOf('【图像与资料交叉验证】') >= 0)
  }
})

cases.push({
  name: '附近宠物医院接口：地图服务不可用时返回降级错误（页面自动回演示数据）',
  async fn() {
    const db = makeDb({ kbDocs: [], metaVersion: 8 })
    const assistant = loadAssistant({ db })

    const res = await assistant.main({ action: 'nearbyHospitals', lat: 22.54, lng: 113.93 })

    assert.strictEqual(res.ok, false)
    assert.ok(String(res.msg || '').indexOf('附近医院检索失败') >= 0, '应返回可降级的错误信息')
  }
})

cases.push({
  name: '知识库增量播种：只补 v3 条目、不重复已存在、不复活已删条目、版本号推进',
  async fn() {
    const db = makeDb({
      kbDocs: [{ title: '犬钩端螺旋体病（人畜共患）', content: '已存在' }],
      metaVersion: 2
    })
    const assistant = loadAssistant({ db })
    respond(okJson(FINAL_ANSWER))

    const res = await assistant.main({ question: '狗狗没精神', petProfile: {}, fileIDs: [] })

    assert.strictEqual(res.ok, true)
    const titles = db._dump('kb_docs').map(d => d.title)
    assert.strictEqual(
      titles.filter(t => t === '犬钩端螺旋体病（人畜共患）').length,
      1,
      '已存在的同名条目不重复播种'
    )
    assert.ok(titles.indexOf('犬布鲁氏菌病（人畜共患）') >= 0, 'v3 新增条目应增量写入')
    assert.ok(titles.indexOf('犬蛔虫与钩虫感染') >= 0, 'v4 批次条目（独立文件）应批量写入')
    assert.ok(titles.indexOf('犬急性腹泻的鉴别与处置') >= 0, 'v5 批次条目应批量写入')
    assert.ok(titles.indexOf('犬胆囊黏液囊肿（GB mucocele）') >= 0, 'v6 批次条目应批量写入')
    assert.ok(titles.indexOf('犬猫心肺复苏（CPR）操作要点') >= 0, 'v7 批次条目应批量写入')
    assert.ok(titles.indexOf('拉布拉多犬常见疾病谱') >= 0, 'v8 批次条目应批量写入')
    assert.ok(titles.indexOf('犬猫皮肤检查路线图') >= 0, 'v9 批次条目应批量写入')
    assert.ok(
      titles.indexOf('犬猫常见肿瘤与肿块自查') < 0,
      'v2 时代被删除的条目不应被复活'
    )
    const meta = db._dump('kb_meta').find(d => d._id === 'seed')
    assert.strictEqual(meta.version, 9, '播种完成后种子版本应更新为 9')
  }
})

/* ================= 执行 ================= */
async function main() {
  console.log('== 图像问诊两阶段诊断流程单元测试 ==\n')
  let failed = 0
  for (const c of cases) {
    try {
      await c.fn()
      console.log(`  ✓ ${c.name}`)
    } catch (e) {
      failed++
      console.error(`  ✗ ${c.name}`)
      console.error(`    ${e && e.message}`)
    }
  }
  console.log(`\n共 ${cases.length} 个用例，失败 ${failed} 个`)
  process.exitCode = failed ? 1 : 0
}

if (require.main === module) main()