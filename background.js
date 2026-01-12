/*
 * @Author: SJAY <sjay.u@qq.com>
 * @Date: 2026-01-05 16:59:23
 * @LastEditors: SJAY <//sjay.cn>
 * @LastEditTime: 2026-01-08 17:29:10
 * @FilePath: \mp-vx-insight\background.js
 * @Description: 
 */
chrome.runtime.onInstalled.addListener(() => {
    console.log("MP-VX-Insight ==> Extension installed")

    // https://developer.chrome.com/docs/extensions/reference/api/declarativeContent?hl=zh-cn
    chrome.declarativeContent.onPageChanged.removeRules(undefined, function () {
        chrome.declarativeContent.onPageChanged.addRules([
            {
                conditions: [
                    new chrome.declarativeContent.PageStateMatcher({
                        pageUrl: {hostEquals: 'mp.weixin.qq.com'},
                    }),
                ],
                actions: [new chrome.declarativeContent.ShowAction()]
            }
        ])
    })

})

// chrome.action.setBadgeText({ text: "VX" })
// chrome.action.setBadgeBackgroundColor({color: "#ff9900"})

const STORAGE_KEYS = {
    apiUrl: 'apiUrl',
    schoolId: 'schoolId',
    schoolName: 'schoolName',
    categoryId: 'categoryId',
    categoryName: 'categoryName',
    mpAccountNickname: 'mpAccountNickname'
}

// 仅允许这些公众号使用扩展（可按需扩展/改为可配置）
const ALLOWED_MP_ACCOUNTS = [
    '睿廷信息科技',
    '无锡金桥教育'
]

function normalizeNickname(v) {
    return (v || '').toString().trim()
}

function isAllowedMpAccount(nickname) {
    const n = normalizeNickname(nickname)
    if (!n) return false
    return ALLOWED_MP_ACCOUNTS.includes(n)
}

function getLastMpAccountNickname() {
    return new Promise((resolve) => {
        chrome.storage.local.get({ [STORAGE_KEYS.mpAccountNickname]: '' }, (items) => {
            resolve(normalizeNickname(items[STORAGE_KEYS.mpAccountNickname]))
        })
    })
}

function setLastMpAccountNickname(nickname) {
    const n = normalizeNickname(nickname)
    if (!n) return
    chrome.storage.local.set({ [STORAGE_KEYS.mpAccountNickname]: n })
}

const SCHOOLS_API_URL = 'http://api.test.com.cn/weixin/school'

function normalizeApiUrl(v) {
    const s = (v || '').trim()
    if (!s) return ''
    try {
        const u = new URL(s)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
        return u.toString()
    } catch (e) {
        return ''
    }
}

function getApiUrl() {
    return new Promise((resolve) => {
        chrome.storage.local.get({ [STORAGE_KEYS.apiUrl]: '' }, (items) => {
            resolve(normalizeApiUrl(items[STORAGE_KEYS.apiUrl]))
        })
    })
}

function normalizeId(v) {
    if (v === null || v === undefined) return ''
    return String(v).trim()
}

function getSchoolSelection() {
    return new Promise((resolve) => {
        chrome.storage.local.get({
            [STORAGE_KEYS.schoolId]: '',
            [STORAGE_KEYS.schoolName]: '',
            [STORAGE_KEYS.categoryId]: '',
            [STORAGE_KEYS.categoryName]: ''
        }, (items) => {
            resolve({
                school_id: normalizeId(items[STORAGE_KEYS.schoolId]),
                school_name: (items[STORAGE_KEYS.schoolName] || '').toString(),
                category_id: normalizeId(items[STORAGE_KEYS.categoryId]),
                category_name: (items[STORAGE_KEYS.categoryName] || '').toString()
            })
        })
    })
}

async function fetchSchools() {
    // MV3 service worker 中 XMLHttpRequest 不可用，请使用 fetch
    const res = await fetch(SCHOOLS_API_URL, {
        method: 'GET',
        headers: {
            'Accept': 'application/json'
        }
    })

    const text = await res.text().catch(() => '')
    if (!res.ok) {
        throw new Error(text || `HTTP ${res.status}`)
    }

    let data
    try {
        data = JSON.parse(text)
    } catch (e) {
        throw new Error('学校接口返回非 JSON：' + String(text).slice(0, 200))
    }

    // 兼容两种返回：
    // 1) 直接数组：[{id,name/list...}]
    // 2) 包裹对象：{code,msg,time,data:[...]}
    const rawList = (() => {
        if (Array.isArray(data)) return data
        if (data && typeof data === 'object') {
            // code=1 表示 success（你提供的示例）
            if ('code' in data && Number(data.code) !== 1) {
                const msg = (data.msg || '').toString() || '学校接口返回失败'
                throw new Error(msg)
            }
            if (Array.isArray(data.data)) return data.data
        }
        return null
    })()

    if (!rawList) {
        throw new Error('学校接口返回格式不正确：期望数组或 {code,data:[]}')
    }

    // 规范化字段：学校用 title/name 二选一，统一为 name；list 子项保留 name
    return rawList.map((s) => {
        const schoolId = s && (s.id ?? s.school_id)
        const schoolName = (s && (s.name ?? s.title)) ? String(s.name ?? s.title) : ''

        const list = Array.isArray(s && s.list) ? s.list : []
        const normalizedList = list.map((c) => {
            const cid = c && (c.id ?? c.category_id)
            const cname = (c && (c.name ?? c.title)) ? String(c.name ?? c.title) : ''
            return { id: cid, name: cname }
        })

        return {
            id: schoolId,
            name: schoolName,
            list: normalizedList
        }
    })
}

async function postToApi(apiUrl, payload) {
    console.log('MP-VX-Insight ==> postToApi ->', apiUrl, payload)
    try {
        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/plain, */*'
            },
            body: JSON.stringify(payload)
        })

        const text = await res.text().catch(() => '')
        if (!res.ok) {
            const err = text || `HTTP ${res.status}`
            throw new Error(err)
        }
        console.log('MP-VX-Insight ==> postToApi ok, respText length =', (text || '').length)
        return text
    } catch (e) {
        // MV3 下 fetch 若被服务端 CORS/自定义跨域检测拦截，通常会表现为 Failed to fetch 或服务端返回 403 文案
        const msg = e && e.message ? e.message : String(e)
        if (/Failed to fetch/i.test(msg) || /NetworkError/i.test(msg) || /CORS/i.test(msg)) {
            throw new Error('网络请求失败（可能是后端未放行 chrome-extension Origin）：' + msg)
        }
        throw e
    }
}

async function extractArticleFromTab(tabId) {
    // executeScript 支持返回 Promise
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: async () => {
            const safeMeta = (selector) => {
                const el = document.querySelector(selector)
                if (!el) return ''
                // meta 标签上 content 是属性；但也兼容某些页面返回对象的情况
                const v = el.getAttribute('content')
                return (v || '').trim()
            }

            const safeText = (selector) => {
                const el = document.querySelector(selector)
                return el ? (el.textContent || '').trim() : ''
            }

            const getReadCountFromDom = () => {
                // 公众号文章页常见阅读数节点：#readNum3
                const candidates = [
                    '#readNum3',
                    '#js_read_area #readNum3',
                    '#js_read_area .read_num',
                    '[id^="readNum"]'
                ]
                for (const sel of candidates) {
                    const t = safeText(sel)
                    if (t) return t
                }
                return ''
            }

            const title = safeText('#activity-name') || safeMeta('meta[property="og:title"]')
            const author = safeText('#js_name') || safeMeta('meta[property="og:article:author"]')
            const url = safeMeta('meta[property="og:url"]') || location.href
            const cover_image = safeMeta('meta[property="og:image"]')
            const description = safeMeta('meta[property="og:description"]')
            const publish_time = safeText('#publish_time') || safeMeta('meta[property="article:published_time"]') || safeMeta('meta[name="publish_time"]')

            // 等待阅读数渲染（最多 5 秒）
            const deadline = Date.now() + 5000
            let read_count = getReadCountFromDom()
            while (!read_count && Date.now() < deadline) {
                await new Promise(r => setTimeout(r, 250))
                read_count = getReadCountFromDom()
            }

            return {
                title,
                publish_time,
                read_count,
                url,
                author,
                cover_image,
                description
            }
        }
    })

    return results && results[0] ? results[0].result : null
}

async function openTabExtractAndClose(url) {
    const tab = await new Promise((resolve) => {
        chrome.tabs.create({ url, active: false }, resolve)
    })

    const tabId = tab && tab.id
    if (!tabId) throw new Error('无法创建用于采集的后台标签页')

    try {
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(listener)
                reject(new Error('采集超时：页面加载过慢'))
            }, 15000)

            const listener = (updatedTabId, info) => {
                if (updatedTabId !== tabId) return
                if (info.status === 'complete') {
                    clearTimeout(timeout)
                    chrome.tabs.onUpdated.removeListener(listener)
                    resolve()
                }
            }
            chrome.tabs.onUpdated.addListener(listener)
        })

        const extracted = await extractArticleFromTab(tabId)
        if (!extracted || !extracted.url) {
            throw new Error('采集失败：未获取到文章信息')
        }
        return extracted
    } finally {
        chrome.tabs.remove(tabId)
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return

    console.log('MP-VX-Insight ==> received message:', message)

    const action = message.action

    // 更新当前登录公众号昵称
    if (action === 'updateMpAccountNickname') {
        try {
            setLastMpAccountNickname(message.nickname)
            sendResponse({ ok: true })
        } catch (e) {
            sendResponse({ ok: false, error: e && e.message ? e.message : String(e) })
        }
        return
    }

    // 获取当前登录公众号状态
    if (action === 'getMpAccountStatus') {
        ;(async () => {
            const nickname = await getLastMpAccountNickname()
            sendResponse({
                ok: true,
                nickname,
                authorized: isAllowedMpAccount(nickname),
                allowed: ALLOWED_MP_ACCOUNTS
            })
        })().catch((err) => {
            sendResponse({ ok: false, error: err && err.message ? err.message : String(err) })
        })

        return true
    }

    // 获取学校列表
    if (action === 'fetchSchools') {
        ;(async () => {
            const data = await fetchSchools()
            sendResponse({ ok: true, data })
        })().catch((err) => {
            sendResponse({ ok: false, error: err && err.message ? err.message : String(err) })
        })

        return true
    }

    // 同步文章（完整 payload） 或 根据链接同步文章
    if (action === 'syncArticle' || action === 'syncByUrl') {
        ;(async () => {
            console.log('MP-VX-Insight ==> receive', action, 'from', sender && sender.tab ? sender.tab.url : '(no-tab)')
            let posted = false
            // ---- 公众号白名单校验（强制拦截） ----
            const nicknameFromMsg = normalizeNickname(
                message.mp_account_nickname
                || (message.payload && message.payload.mp_account_nickname)
                || (message.hints && message.hints.mp_account_nickname)
            )
            const nickname = nicknameFromMsg || await getLastMpAccountNickname()

            console.log('MP-VX-Insight ==> mp account nickname =', nickname || '(empty)')

            if (!nickname) {
                sendResponse({
                    ok: false,
                    error: '无法识别当前登录公众号：请先打开公众号后台（左侧菜单底部可见公众号名称）再试。'
                })
                return
            }
            if (!isAllowedMpAccount(nickname)) {
                sendResponse({
                    ok: false,
                    error: `仅支持定义的公众号：${ALLOWED_MP_ACCOUNTS.join('、')}（当前：${nickname}）`
                })
                return
            }

            const apiUrl = await getApiUrl()
            console.log('MP-VX-Insight ==> apiUrl =', apiUrl || '(empty)')
            if (!apiUrl) {
                sendResponse({ ok: false, error: '未配置同步 API 地址：请先打开插件弹窗并保存 API 地址。' })
                return
            }

            const selection = await getSchoolSelection()
            console.log('MP-VX-Insight ==> selection =', selection)
            if (!selection.school_id) {
                sendResponse({ ok: false, error: '请先在扩展弹窗中选择学校后再同步。' })
                return
            }
            if (!selection.category_id) {
                sendResponse({ ok: false, error: '请先在扩展弹窗中选择栏目后再同步。' })
                return
            }

            let payload
            if (action === 'syncByUrl') {
                const url = (message.url || '').trim()
                if (!url) {
                    sendResponse({ ok: false, error: '缺少文章链接（url）' })
                    return
                }
                const extracted = await openTabExtractAndClose(url)
                payload = {
                    ...extracted,
                    // 允许列表页传入的 hints 覆盖/补充
                    ...(message.hints && typeof message.hints === 'object' ? message.hints : {}),
                    mp_account_nickname: nickname,
                    ...selection,
                    synced_at: new Date().toISOString(),
                    source: 'mp-vx-insight'
                }
            } else {
                payload = {
                    ...(message.payload && typeof message.payload === 'object' ? message.payload : {}),
                    mp_account_nickname: nickname,
                    ...selection,
                    synced_at: new Date().toISOString(),
                    source: 'mp-vx-insight'
                }
            }

            posted = true
            const respText = await postToApi(apiUrl, payload)
            sendResponse({ ok: true, data: respText, via: 'background', posted })
        })().catch((err) => {
            console.warn('MP-VX-Insight ==> sync error:', err)
            sendResponse({ ok: false, error: err && err.message ? err.message : String(err), via: 'background', posted: false })
        })

        // 异步响应
        return true
    }
})