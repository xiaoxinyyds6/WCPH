const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 视觉模型按优先级尝试：glm-4.6v-flash（免费、支持多图）→ glm-4v-flash（免费、仅单图）
const VISION_MODELS = ['glm-4.6v-flash', 'glm-4v-flash']
// 文本模型：glm-4-flash 支持 Function Calling，用于 Agent 工具调用
const TEXT_MODEL = 'glm-4-flash'
const MAX_IMAGES = 3
// Agent 工具调用最多轮数（防止无限循环，配合前端 30s 超时）
const MAX_TOOL_ROUNDS = 3

const SYSTEM_PROMPT = [
  '你是"AI宠物健康助手"，具备扎实兽医临床知识的在线问诊助手。回答必须准确、克制、可执行。',
  '【准确性要求】',
  '1. 只在有把握时下判断；不确定就明确说"仅凭这张照片/这段描述无法确诊"，并给出最可能的两个方向。',
  '2. 犬、猫、兔、鸟等物种的常见病差异极大，必须先确认物种再判断。',
  '3. 结合年龄段与品种特征，把遗传病、老年病、幼宠常见病纳入考虑。',
  '4. 照片与描述矛盾时，以主人描述为主，并指出矛盾点。',
  '5. 急症（呼吸困难、大出血、误食毒物、抽搐、昏迷、休克、难产、公猫排尿困难）直接判 red。',
  '【字段要求】',
  'analysis：客观描述照片可见体征或主人描述的症状，说明哪些信息支持判断、哪些缺失。照片看不到的不写。',
  'diseases：2-4 条，每条格式"病名 —— 支持依据"，按可能性从高到低。',
  'care：2-4 条可立即执行的家庭护理措施。',
  'visit：去医院的紧迫程度与建议检查项目。',
  'forbid：1-3 条当前禁止做的事。',
  '不得出现任何具体药物名称、剂量或处方。',
  'followUp：为提升准确性最需要主人补充的信息，写成问句，最多3条。',
  '【输出格式】只返回 JSON，所有字段都是字符串或字符串数组：',
  '{"level":"red|yellow|green","summary":"一句话结论","analysis":"","diseases":[""],"care":[""],"visit":"","forbid":[""],"followUp":[""]}'
].join('\n')

function callZhipu(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload)
    const req = https.request(
      {
        hostname: 'open.bigmodel.cn',
        path: '/api/paas/v4/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.ZHIPU_API_KEY}`,
          'Content-Length': Buffer.byteLength(body)
        },
        // 两级模型回退与前端 30s 超时预算保持一致
        timeout: 8000
      },
      res => {
        let data = ''
        res.on('data', c => (data += c))
        res.on('end', () => {
          let parsed = null
          try {
            parsed = JSON.parse(data)
          } catch (e) {
            // 非 JSON 响应，交给下面统一报错
          }
          if (res.statusCode >= 400 || (parsed && parsed.error)) {
            const apiMsg =
              (parsed && parsed.error && (parsed.error.message || parsed.error.code)) ||
              String(data).slice(0, 300)
            return reject(new Error(`HTTP ${res.statusCode}: ${apiMsg}`))
          }
          if (!parsed) {
            return reject(new Error(`模型响应解析失败: ${String(data).slice(0, 200)}`))
          }
          resolve(parsed)
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('模型请求超时')))
    req.write(body)
    req.end()
  })
}

function buildPetText(petProfile) {
  const p = petProfile || {}
  const breed = [p.category, p.breed].filter(Boolean).join(' ')
  const parts = [
    breed && `品种：${breed}`,
    p.gender && `性别：${p.gender}`,
    p.weight != null && `体重：${p.weight}kg`,
    p.birthDate && `出生日期：${p.birthDate}`,
    p.neutered && `绝育：${p.neutered}`,
    p.vaccinated && `疫苗：${p.vaccinated}`,
    p.dewormed && `驱虫：${p.dewormed}`
  ].filter(Boolean)
  return `宠物档案：${parts.length ? parts.join('；') : '暂无'}`
}

function parseJson(raw) {
  const cleaned = String(raw || '').replace(/```json|```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end < 0) throw new Error('模型未返回有效JSON')
  return JSON.parse(cleaned.slice(start, end + 1))
}

function toText(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v.trim()
  if (Array.isArray(v)) return v.map(toText).filter(Boolean).join('\n')
  if (typeof v === 'object') {
    return Object.keys(v)
      .map(k => toText(v[k]))
      .filter(Boolean)
      .join('\n')
  }
  return String(v)
}

// 统一拼装成前端展示的三段式文本，兼容模型返回的各种结构
function buildContent(data) {
  const lines = []
  const analysis = toText(data.analysis)
  if (analysis) lines.push(`【分析】${analysis}`)

  const diseases = toText(data.diseases)
  if (diseases) lines.push(`【可能病症】\n${diseases}`)

  const care = toText(data.care)
  const visit = toText(data.visit)
  const forbid = toText(data.forbid)
  if (care || visit || forbid) {
    const t = ['【治疗意见】']
    if (care) t.push(`· 家庭护理：${care}`)
    if (visit) t.push(`· 就医建议：${visit}`)
    if (forbid) t.push(`· 禁止事项：${forbid}`)
    lines.push(t.join('\n'))
  }

  // 兜底：模型没有按新字段返回时，沿用旧 content 字段
  if (!lines.length) {
    const fallback = toText(data.content)
    if (fallback) lines.push(fallback)
  }

  lines.push('以上建议不能替代执业兽医的现场诊断，若症状加重请立即就医。')
  return lines.join('\n\n')
}

// ================= OCR + 图像识别 + 情感：system prompt 组装 =================

// hasImages：是否带图（带图走视觉模型，不注入工具说明）
function buildSystemPrompt(hasImages, mood) {
  const parts = [SYSTEM_PROMPT]

  if (hasImages) {
    // OCR（光学字符识别）+ 图像识别提示
    parts.push(
      '【图像能力】',
      '1. OCR 文字识别：若图片中包含文字（化验单、检查报告、病历、处方单、疫苗本、说明书、发票等），先在 analysis 开头逐行完整提取图中文字，再逐项解读异常指标与含义。',
      '2. 图像识别：判断图中动物物种与品种（如可辨认）、拍摄部位、可见异常（分泌物、红肿、脱毛、伤口、姿态异常等），识别结果写入 analysis。'
    )
  }

  // 情感分析：焦虑时先安抚再建议
  if (mood === 'anxious') {
    parts.push(
      '【情感语气】主人当前情绪比较焦虑，请先用一两句温柔的话安抚情绪，再给出条理清晰、可执行的建议，避免使用加重恐慌的措辞。'
    )
  }

  // Agent：工具调用说明（仅纯文本对话注入，带图时视觉模型不支持）
  if (!hasImages) {
    parts.push(
      '【工具调用】你可以调用以下工具获取事实信息，需要时先调用工具、再基于结果作答：',
      '- get_weather(city)：查询城市实时天气，判断是否适宜宠物外出/遛狗/防中暑时使用。'
    )
  }

  return parts.join('\n')
}

// ================= 情感分析（规则法）：识别焦虑语气 =================

const ANXIOUS_WORDS = [
  '担心', '害怕', '急', '救命', '救救', '疼', '痛', '哭', '崩溃', '不行了',
  '难受', '严重吗', '恶化', '吐血', '抽搐', '瘫', '危险', '怎么办', '吓死'
]

function analyzeSentiment(text) {
  const t = String(text || '')
  const hits = ANXIOUS_WORDS.filter(w => t.indexOf(w) >= 0)
  return { mood: hits.length ? 'anxious' : 'neutral', hits: hits.slice(0, 5) }
}

// ================= Agent：工具定义与执行 =================

// WMO 天气代码 → 中文描述
const WEATHER_CODES = {
  0: '晴', 1: '基本晴', 2: '局部多云', 3: '阴',
  45: '有雾', 48: '雾凇',
  51: '毛毛雨', 53: '毛毛雨', 55: '浓毛毛雨', 56: '冻毛毛雨', 57: '冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '小阵雨', 81: '阵雨', 82: '强阵雨', 85: '小阵雪', 86: '阵雪',
  95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '雷阵雨伴冰雹'
}

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        let data = ''
        res.on('data', c => (data += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (e) {
            reject(new Error('天气接口响应解析失败'))
          }
        })
      })
      .on('error', reject)
  })
}

// Open-Meteo 免费天气接口（无需 API key）：城市名 → 经纬度 → 当前天气
function getWeather(city) {
  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`
  return httpsGetJson(geoUrl).then(geo => {
    const loc = geo.results && geo.results[0]
    if (!loc) return { ok: false, msg: `未找到城市「${city}」` }
    const wUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`
    return httpsGetJson(wUrl).then(w => {
      const c = w.current || {}
      return {
        ok: true,
        city: loc.name,
        country: loc.country || '',
        weather: WEATHER_CODES[c.weather_code] || '未知',
        temperature: c.temperature_2m,
        humidity: c.relative_humidity_2m,
        windSpeed: c.wind_speed_10m
      }
    })
  })
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description:
        '查询全球任意城市当前实时天气（天气现象、气温、湿度、风速）。用于判断是否适宜宠物外出、遛狗、防中暑等场景。',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: '城市名称，如：北京、上海、广州' }
        },
        required: ['city']
      }
    }
  }
]

async function runTool(name, args) {
  if (name === 'get_weather') {
    if (!args || !args.city) return { ok: false, msg: '缺少城市参数' }
    return getWeather(String(args.city))
  }
  return { ok: false, msg: `未知工具：${name}` }
}

exports.main = async event => {
  const apiKey = process.env.ZHIPU_API_KEY
  if (!apiKey) {
    return {
      ok: false,
      msg: '云函数未读取到 ZHIPU_API_KEY',
      detail: '请在云开发控制台 → 云函数 → assistant → 配置 → 环境变量中添加 ZHIPU_API_KEY 后重试'
    }
  }

  const { OPENID } = cloud.getWXContext()

  try {
    // ===== AI 问诊（默认） =====
    const { question = '', petProfile = {}, fileIDs = [] } = event

    // 内容安全：问题文本违规直接拦截；openapi 不可用时放行（fail-open）
    try {
      const sec = await cloud.openapi.security.msgSecCheck({
        version: 2,
        scene: 2,
        openid: OPENID,
        content: question
      })
      const d = sec && sec.result
      if (d && d.suggest && d.suggest !== 'pass') {
        return { ok: false, msg: '问题内容涉嫌违规，请修改后重试' }
      }
    } catch (e) {
      console.warn('[assistant] msgSecCheck 不可用，放行', e && e.message)
    }

    // 下载图片并转 base64
    const imageUrls = []
    for (const fileID of fileIDs.slice(0, MAX_IMAGES)) {
      const file = await cloud.downloadFile({ fileID })
      if (file.fileContent.length > 4 * 1024 * 1024) {
        return { ok: false, msg: '图片过大，请压缩后重试' }
      }
      imageUrls.push(`data:image/jpeg;base64,${file.fileContent.toString('base64')}`)
    }

    // 情感分析：识别焦虑语气
    const mood = analyzeSentiment(question).mood

    const userText = `${buildPetText(petProfile)}\n\n用户描述：${question || '（仅上传了照片，请结合照片分析）'}`
    const sysPrompt = buildSystemPrompt(imageUrls.length > 0, mood)

    // ---- 带图：视觉模型多模态（OCR/图像识别），不走工具调用 ----
    if (imageUrls.length) {
      const content = imageUrls.map(url => ({ type: 'image_url', image_url: { url } }))
      content.push({ type: 'text', text: userText })

      let lastErr = null
      for (const model of VISION_MODELS) {
        try {
          const res = await callZhipu({
            model,
            messages: [
              { role: 'system', content: sysPrompt },
              {
                role: 'user',
                content:
                  model === 'glm-4v-flash'
                    ? content.slice(0, 1).concat(content.slice(-1))
                    : content
              }
            ],
            temperature: 0.2,
            max_tokens: 1024
          })
          const data = parseJson(res.choices[0].message.content)
          return {
            ok: true,
            model,
            data: {
              level: data.level || 'yellow',
              summary: toText(data.summary),
              content: buildContent(data),
              followUp: (Array.isArray(data.followUp) ? data.followUp : []).map(toText).filter(Boolean).slice(0, 3)
            }
          }
        } catch (e) {
          lastErr = e
          console.error(`[assistant] ${model} 调用失败:`, e && e.message)
        }
      }
      throw lastErr || new Error('模型调用失败')
    }

    // ---- 纯文本：Agent 工具调用循环（glm-4-flash 支持 Function Calling） ----
    const messages = [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: userText }
    ]
    let finalContent = ''
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await callZhipu({
        model: TEXT_MODEL,
        messages,
        tools: TOOLS,
        temperature: 0.2,
        max_tokens: 1024
      })
      const msg = res.choices[0].message
      // 模型请求调用工具：本地执行后把结果回填，继续下一轮
      if (msg.tool_calls && msg.tool_calls.length) {
        messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls })
        for (const tc of msg.tool_calls) {
          let result
          try {
            const args = JSON.parse(tc.function.arguments || '{}')
            result = await runTool(tc.function.name, args)
            console.log('[assistant] 工具调用', tc.function.name, JSON.stringify(result).slice(0, 200))
          } catch (e) {
            result = { ok: false, msg: String((e && e.message) || e) }
          }
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result).slice(0, 3000)
          })
        }
        continue
      }
      finalContent = msg.content || ''
      break
    }

    let data
    if (finalContent) {
      data = parseJson(finalContent)
    } else {
      // 多轮工具调用后仍未产出结论：返回兜底结构
      data = {
        level: 'yellow',
        summary: '本次分析未能完成',
        analysis: 'AI 在获取资料后未能得出结论，请补充更详细的描述后重试。',
        diseases: [],
        care: [],
        visit: '如症状持续或加重，请及时就医。',
        forbid: [],
        followUp: ['请补充更详细的症状描述']
      }
    }

    return {
      ok: true,
      model: TEXT_MODEL,
      data: {
        level: data.level || 'yellow',
        summary: toText(data.summary),
        content: buildContent(data),
        followUp: (Array.isArray(data.followUp) ? data.followUp : []).map(toText).filter(Boolean).slice(0, 3)
      }
    }
  } catch (e) {
    console.error('[assistant]', e)
    return {
      ok: false,
      msg: 'AI服务繁忙，请稍后重试',
      detail: String((e && e.message) || e)
    }
  }
}
