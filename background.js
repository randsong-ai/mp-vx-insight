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

// 便于排查：确认 service worker 是否成功加载
console.log('MP-VX-Insight ==> background.js loaded at', new Date().toISOString())

// 快捷键命令监听
chrome.commands.onCommand.addListener((command) => {
    console.log('MP-VX-Insight ==> Command received:', command)

    if (command === 'sync-article') {
        // 获取当前活动标签页
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) return
            const tab = tabs[0]

            // 检查是否是微信公众号页面
            if (!tab.url || !tab.url.includes('mp.weixin.qq.com')) {
                console.log('MP-VX-Insight ==> Not on WeChat MP page')
                return
            }

            // 发送消息到 content script 触发同步
            chrome.tabs.sendMessage(tab.id, {
                action: 'triggerSyncByShortcut'
            }, (res) => {
                if (chrome.runtime.lastError) {
                    console.error('MP-VX-Insight ==> Shortcut sync error:', chrome.runtime.lastError)
                }
            })
        })
    }
})

// chrome.action.setBadgeText({ text: "VX" })
// chrome.action.setBadgeBackgroundColor({color: "#ff9900"})

const STORAGE_KEYS = {
    apiUrl: 'apiUrl',
    schoolId: 'schoolId',
    schoolName: 'schoolName',
    categoryId: 'categoryId',
    categoryName: 'categoryName',
    mpAccountNickname: 'mpAccountNickname',
    syncHistory: 'syncHistory',          // 同步历史记录
    syncedUrls: 'syncedUrls'              // 已同步文章 URL 集合
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
            const nickname = normalizeNickname(items[STORAGE_KEYS.mpAccountNickname])
            console.log('MP-VX-Insight ==> background.js ==> getLastMpAccountNickname:', nickname)
            resolve(nickname)
        })
    })
}

function setLastMpAccountNickname(nickname) {
    return new Promise((resolve) => {
        const n = normalizeNickname(nickname)
        if (!n) {
            resolve()
            return
        }
        chrome.storage.local.set({ [STORAGE_KEYS.mpAccountNickname]: n }, () => {
            console.log('MP-VX-Insight ==> background.js ==> Saved nickname:', n)
            resolve()
        })
    })
}

const SCHOOLS_API_URL = 'http://api.test.com.cn/weixin/school'

function asArray(v) {
    return Array.isArray(v) ? v : []
}

function pickFirstArray(...candidates) {
    for (const v of candidates) {
        if (Array.isArray(v)) return v
    }
    return []
}

function normalizeSchoolName(s) {
    const v = s && (s.name ?? s.title ?? s.school_name ?? s.schoolName ?? s.label)
    return v ? String(v) : ''
}

function normalizeSchoolId(s) {
    const v = s && (s.id ?? s.school_id ?? s.value ?? s.schoolId)
    return v
}

function normalizeCategoryName(c) {
    const v = c && (c.name ?? c.title ?? c.category_name ?? c.categoryName ?? c.column_name ?? c.columnName ?? c.label)
    return v ? String(v) : ''
}

function normalizeCategoryId(c) {
    const v = c && (c.id ?? c.category_id ?? c.column_id ?? c.value ?? c.categoryId ?? c.columnId)
    return v
}

function normalizeCategoriesFromSchoolLikeObject(s) {
    const rawCategories = pickFirstArray(
        s && s.list,
        s && s.categories,
        s && s.category_list,
        s && s.categoryList,
        s && s.columns,
        s && s.children,
        s && s.child
    )
    return asArray(rawCategories).map((c) => ({
        id: normalizeCategoryId(c),
        name: normalizeCategoryName(c)
    }))
}

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
    console.log('MP-VX-Insight ==> background.js ==> fetchSchools() called, URL:', SCHOOLS_API_URL)
    // MV3 service worker 中 XMLHttpRequest 不可用，请使用 fetch
    const res = await fetch(SCHOOLS_API_URL, {
        method: 'GET',
        headers: {
            'Accept': 'application/json'
        }
    })

    console.log('MP-VX-Insight ==> background.js ==> fetchSchools response status:', res.status)

    const text = await res.text().catch(() => '')
    if (!res.ok) {
        console.error('MP-VX-Insight ==> background.js ==> fetchSchools HTTP error:', res.status, text)
        throw new Error(text || `HTTP ${res.status}`)
    }

    let data
    try {
        data = JSON.parse(text)
        console.log('MP-VX-Insight ==> background.js ==> fetchSchools parsed data:', data)
    } catch (e) {
        console.error('MP-VX-Insight ==> background.js ==> fetchSchools JSON parse error:', e)
        throw new Error('学校接口返回非 JSON：' + String(text).slice(0, 200))
    }

    // 兼容返回格式（线上常见会有字段差异）：
    // 1) 直接数组：[{id,name/list...}]
    // 2) 包裹对象：{code,msg,time,data:[...]}
    // 3) 包裹对象：{code,msg,data:{list:[...]}} / {data:{data:[...]}} 等
    const rawList = (() => {
        if (Array.isArray(data)) return data
        if (data && typeof data === 'object') {
            // success code 兼容：1/0/200
            if ('code' in data) {
                const codeNum = Number(data.code)
                const okCodes = [1, 0, 200]
                if (!okCodes.includes(codeNum)) {
                    const msg = (data.msg || data.message || '').toString() || '学校接口返回失败'
                    throw new Error(msg)
                }
            }

            if (Array.isArray(data.data)) return data.data

            // data 可能是对象
            if (data.data && typeof data.data === 'object') {
                if (Array.isArray(data.data.list)) return data.data.list
                if (Array.isArray(data.data.data)) return data.data.data
                if (Array.isArray(data.data.rows)) return data.data.rows
            }

            // 一些接口会用 list/rows 作为顶层
            if (Array.isArray(data.list)) return data.list
            if (Array.isArray(data.rows)) return data.rows
        }
        return null
    })()

    if (!rawList) {
        console.error('MP-VX-Insight ==> background.js ==> fetchSchools invalid format:', data)
        throw new Error('学校接口返回格式不正确：期望数组或 {code,data:[]}')
    }

    console.log('MP-VX-Insight ==> background.js ==> fetchSchools rawList count:', rawList.length)

    // 规范化字段：学校/栏目字段名在不同环境可能不同，这里做尽量宽松的兼容。
    const normalized = rawList.map((s) => {
        const schoolId = normalizeSchoolId(s)
        const schoolName = normalizeSchoolName(s)
        const normalizedList = normalizeCategoriesFromSchoolLikeObject(s)

        return {
            id: schoolId,
            name: schoolName,
            list: normalizedList
        }
    })

    console.log('MP-VX-Insight ==> background.js ==> fetchSchools normalized result:', normalized)
    return normalized
}

async function fetchCategoriesBySchoolId(schoolId) {
    const sid = normalizeId(schoolId)
    if (!sid) throw new Error('缺少 school_id')

    // 先尝试：从学校全量接口结果里找（后端若把栏目内嵌在学校里，最稳）
    try {
        const schools = await fetchSchools()
        const found = asArray(schools).find(s => normalizeId(s && s.id) === sid)
        if (found && Array.isArray(found.list)) {
            return found.list
        }
    } catch (e) {
        // 忽略，继续尝试按 school_id 拉
        console.warn('MP-VX-Insight ==> fetchCategoriesBySchoolId: fetchSchools failed, fallback to param request:', e)
    }

    // 再尝试：带 school_id 参数请求（如果后端支持单校栏目查询）
    const url = `${SCHOOLS_API_URL}?school_id=${encodeURIComponent(sid)}`
    console.log('MP-VX-Insight ==> background.js ==> fetchCategoriesBySchoolId() called, URL:', url)
    const res = await fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/json'
        }
    })

    const text = await res.text().catch(() => '')
    if (!res.ok) {
        console.error('MP-VX-Insight ==> background.js ==> fetchCategoriesBySchoolId HTTP error:', res.status, text)
        throw new Error(text || `HTTP ${res.status}`)
    }

    let data
    try {
        data = JSON.parse(text)
    } catch (e) {
        throw new Error('栏目接口返回非 JSON：' + String(text).slice(0, 200))
    }

    const rawList = (() => {
        if (Array.isArray(data)) return data
        if (data && typeof data === 'object') {
            if ('code' in data) {
                const codeNum = Number(data.code)
                const okCodes = [1, 0, 200]
                if (!okCodes.includes(codeNum)) {
                    const msg = (data.msg || data.message || '').toString() || '栏目接口返回失败'
                    throw new Error(msg)
                }
            }
            if (Array.isArray(data.data)) return data.data
            if (data.data && typeof data.data === 'object') {
                if (Array.isArray(data.data.list)) return data.data.list
                if (Array.isArray(data.data.data)) return data.data.data
                if (Array.isArray(data.data.rows)) return data.data.rows
            }
            if (Array.isArray(data.list)) return data.list
            if (Array.isArray(data.rows)) return data.rows
        }
        return null
    })()

    if (!rawList) {
        throw new Error('栏目接口返回格式不正确：期望数组或 {code,data:[]}')
    }

    // 若返回是“学校对象/学校数组”，则从中提取栏目
    const first = rawList[0]
    const looksLikeSchool = first && (('list' in first) || ('categories' in first) || ('school_id' in first) || ('schoolId' in first))
    if (looksLikeSchool) {
        const foundRaw = asArray(rawList).find(s => normalizeId(normalizeSchoolId(s)) === sid)
        return normalizeCategoriesFromSchoolLikeObject(foundRaw)
    }

    // 否则假定返回是栏目数组
    return asArray(rawList).map((c) => ({
        id: normalizeCategoryId(c),
        name: normalizeCategoryName(c)
    }))
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

// ==================== 同步历史和状态管理 ====================

/**
 * 记录同步历史
 * @param {Object} record - 同步记录 { url, title, schoolName, categoryName, timestamp }
 */
async function addSyncHistory(record) {
    return new Promise((resolve) => {
        chrome.storage.local.get({ [STORAGE_KEYS.syncHistory]: [] }, (items) => {
            let history = items[STORAGE_KEYS.syncHistory] || []
            // 添加新记录到开头
            history.unshift({
                url: record.url || '',
                title: record.title || '',
                schoolName: record.schoolName || '',
                categoryName: record.categoryName || '',
                timestamp: record.timestamp || Date.now()
            })
            // 只保留最近 100 条记录
            history = history.slice(0, 100)
            chrome.storage.local.set({ [STORAGE_KEYS.syncHistory]: history }, () => resolve())
        })
    })
}

/**
 * 获取同步历史
 * @param {number} limit - 返回记录数量限制
 */
async function getSyncHistory(limit = 50) {
    return new Promise((resolve) => {
        chrome.storage.local.get({ [STORAGE_KEYS.syncHistory]: [] }, (items) => {
            const history = items[STORAGE_KEYS.syncHistory] || []
            resolve(history.slice(0, limit))
        })
    })
}

/**
 * 检查文章 URL 是否已同步
 * @param {string} url - 文章 URL
 */
async function isUrlSynced(url) {
    return new Promise((resolve) => {
        chrome.storage.local.get({ [STORAGE_KEYS.syncedUrls]: {} }, (items) => {
            const syncedUrls = items[STORAGE_KEYS.syncedUrls] || {}
            const normalizedUrl = normalizeUrlForSync(url)
            resolve(!!syncedUrls[normalizedUrl])
        })
    })
}

/**
 * 标记文章 URL 为已同步
 * @param {string} url - 文章 URL
 */
async function markUrlAsSynced(url) {
    return new Promise((resolve) => {
        chrome.storage.local.get({ [STORAGE_KEYS.syncedUrls]: {} }, (items) => {
            const syncedUrls = items[STORAGE_KEYS.syncedUrls] || {}
            const normalizedUrl = normalizeUrlForSync(url)
            syncedUrls[normalizedUrl] = Date.now()
            // 清理 30 天前的记录
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000)
            for (const key in syncedUrls) {
                if (syncedUrls[key] < thirtyDaysAgo) {
                    delete syncedUrls[key]
                }
            }
            chrome.storage.local.set({ [STORAGE_KEYS.syncedUrls]: syncedUrls }, () => resolve())
        })
    })
}

/**
 * 规范化 URL 用于同步状态比对
 * 移除可能变化的参数（如分享码等）
 */
function normalizeUrlForSync(url) {
    if (!url) return ''
    try {
        const u = new URL(url)
        // 移除可能变化的查询参数
        const paramsToRemove = ['chksm', 'scene', 'share_token']
        paramsToRemove.forEach(param => u.searchParams.delete(param))
        return u.toString()
    } catch (e) {
        return url
    }
}

async function removeUrlFromSynced(url) {
    return new Promise((resolve) => {
        chrome.storage.local.get({ [STORAGE_KEYS.syncedUrls]: {} }, (items) => {
            const syncedUrls = items[STORAGE_KEYS.syncedUrls] || {}
            const key = normalizeUrlForSync(url)
            if (key && syncedUrls[key]) {
                delete syncedUrls[key]
            }
            chrome.storage.local.set({ [STORAGE_KEYS.syncedUrls]: syncedUrls }, () => resolve())
        })
    })
}

async function setSyncedFlagByHistory(url, history) {
    const key = normalizeUrlForSync(url)
    if (!key) return

    const hasAny = (history || []).some(r => normalizeUrlForSync(r && r.url) === key)
    if (hasAny) {
        await markUrlAsSynced(url)
    } else {
        await removeUrlFromSynced(url)
    }
}

/**
 * 清理过期的同步历史（可选的维护操作）
 */
async function cleanupOldHistory() {
    return new Promise((resolve) => {
        chrome.storage.local.get({ [STORAGE_KEYS.syncHistory]: [] }, (items) => {
            let history = items[STORAGE_KEYS.syncHistory] || []
            // 只保留最近 30 天的记录
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000)
            history = history.filter(record => record.timestamp > thirtyDaysAgo)
            chrome.storage.local.set({ [STORAGE_KEYS.syncHistory]: history }, () => resolve())
        })
    })
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return

    console.log('MP-VX-Insight ==> received message:', message)

    const action = message.action

    // 更新当前登录公众号昵称
    if (action === 'updateMpAccountNickname') {
        ;(async () => {
            try {
                await setLastMpAccountNickname(message.nickname)
                sendResponse({ ok: true })
            } catch (e) {
                sendResponse({ ok: false, error: e && e.message ? e.message : String(e) })
            }
        })()
        return true
    }

    // 获取当前登录公众号状态
    if (action === 'getMpAccountStatus') {
        ;(async () => {
            const nickname = await getLastMpAccountNickname()
            const response = {
                ok: true,
                nickname,
                authorized: isAllowedMpAccount(nickname),
                allowed: ALLOWED_MP_ACCOUNTS
            }
            console.log('MP-VX-Insight ==> background.js ==> getMpAccountStatus response:', response)
            sendResponse(response)
        })().catch((err) => {
            console.error('MP-VX-Insight ==> background.js ==> getMpAccountStatus error:', err)
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

    // 获取栏目列表（按学校）
    if (action === 'fetchCategories') {
        ;(async () => {
            const schoolId = message.schoolId || message.school_id || ''
            const data = await fetchCategoriesBySchoolId(schoolId)
            sendResponse({ ok: true, data })
        })().catch((err) => {
            sendResponse({ ok: false, error: err && err.message ? err.message : String(err) })
        })

        return true
    }

    // 获取同步历史
    if (action === 'getSyncHistory') {
        ;(async () => {
            const limit = message.limit || 50
            const history = await getSyncHistory(limit)
            sendResponse({ ok: true, data: history })
        })().catch((err) => {
            sendResponse({ ok: false, error: err && err.message ? err.message : String(err) })
        })

        return true
    }

    // 清空同步历史（同时清空已同步状态）
    if (action === 'clearSyncHistory') {
        ;(async () => {
            await new Promise((resolve) => {
                chrome.storage.local.set({
                    [STORAGE_KEYS.syncHistory]: [],
                    [STORAGE_KEYS.syncedUrls]: {}
                }, () => resolve())
            })
            sendResponse({ ok: true })
        })().catch((err) => {
            sendResponse({ ok: false, error: err && err.message ? err.message : String(err) })
        })

        return true
    }

    // 删除单条同步历史（按 timestamp 优先；并同步维护已同步状态）
    if (action === 'deleteSyncHistoryItem') {
        ;(async () => {
            const ts = Number(message.timestamp || 0)
            const url = (message.url || '').toString()

            const { history, removed } = await new Promise((resolve) => {
                chrome.storage.local.get({ [STORAGE_KEYS.syncHistory]: [] }, (items) => {
                    const oldHistory = items[STORAGE_KEYS.syncHistory] || []

                    let removedItem = null
                    let newHistory = oldHistory

                    if (ts) {
                        newHistory = oldHistory.filter((r) => {
                            const keep = Number(r && r.timestamp) !== ts
                            if (!keep && !removedItem) removedItem = r
                            return keep
                        })
                    } else if (url) {
                        const key = normalizeUrlForSync(url)
                        newHistory = oldHistory.filter((r) => {
                            const keep = normalizeUrlForSync(r && r.url) !== key
                            if (!keep && !removedItem) removedItem = r
                            return keep
                        })
                    }

                    chrome.storage.local.set({ [STORAGE_KEYS.syncHistory]: newHistory }, () => {
                        resolve({ history: newHistory, removed: removedItem })
                    })
                })
            })

            // 同步维护 syncedUrls：只对被删除的那条 url 进行重算
            const affectedUrl = (removed && removed.url) ? String(removed.url) : url
            if (affectedUrl) {
                await setSyncedFlagByHistory(affectedUrl, history)
            }

            sendResponse({ ok: true })
        })().catch((err) => {
            sendResponse({ ok: false, error: err && err.message ? err.message : String(err) })
        })

        return true
    }

    // 检查 URL 是否已同步
    if (action === 'isUrlSynced') {
        ;(async () => {
            const url = message.url || ''
            if (!url) {
                sendResponse({ ok: false, synced: false })
                return
            }
            const synced = await isUrlSynced(url)
            sendResponse({ ok: true, synced })
        })().catch((err) => {
            sendResponse({ ok: false, error: err && err.message ? err.message : String(err), synced: false })
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

            // 同步成功后记录历史和标记状态
            const articleUrl = payload.url || ''
            if (articleUrl) {
                await markUrlAsSynced(articleUrl)
                await addSyncHistory({
                    url: articleUrl,
                    title: payload.title || '',
                    schoolName: selection.school_name || '',
                    categoryName: selection.category_name || ''
                })
            }

            sendResponse({ ok: true, data: respText, via: 'background', posted })
        })().catch((err) => {
            console.warn('MP-VX-Insight ==> sync error:', err)
            sendResponse({ ok: false, error: err && err.message ? err.message : String(err), via: 'background', posted: false })
        })

        // 异步响应
        return true
    }
})