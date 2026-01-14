console.log("MP-VX-Insight ==> loading content.js")

const MPVX = {
    markerAttr: 'data-mpvx-sync-added',
    rowMarkerAttr: 'data-mpvx-sync-row-added',
    btnClass: 'mpvx-sync-btn',
    toastId: 'mpvx-sync-toast',
    bulkBtnId: 'mpvx-bulk-sync-btn'
}

const MPVX_AUTH = {
    // 注意：微信后台 DOM 里 class 叫 acount_box-nickname（少了个 c），不是 account
    nicknameSelectors: [
        '#js_mp_sidemenu > div > div.weui-desktop-layout__side-menu__footer > div.mp_account_box > div.weui-desktop-account__info.weui-desktop-layout__side-menu__footer-item > div > span.acount_box-nickname',
        '#js_mp_sidemenu span.acount_box-nickname',
        'span.acount_box-nickname',
        // 新增更多候选选择器
        '.weui-desktop-account__info span',
        '.mp_account_box span',
        '#js_mp_sidemenu .weui-desktop-account__info',
        '[class*="account"] [class*="nickname"]',
        '[class*="nickname"]'
    ]
}

function getMpAccountNickname() {
    for (const sel of MPVX_AUTH.nicknameSelectors) {
        const el = document.querySelector(sel)
        const name = el ? (el.textContent || '').trim() : ''
        if (name) {
            console.log('MP-VX-Insight ==> Found nickname with selector:', sel, 'nickname:', name)
            return name
        }
    }
    console.warn('MP-VX-Insight ==> No nickname found, tried selectors:', MPVX_AUTH.nicknameSelectors)
    return ''
}

function reportMpAccountNickname() {
    const nickname = getMpAccountNickname()
    console.log('MP-VX-Insight ==> reportMpAccountNickname:', nickname)
    if (!nickname) return
    try {
        chrome.runtime.sendMessage({
            action: 'updateMpAccountNickname',
            nickname
        })
    } catch (e) {
        // ignore
    }
}

function ensureStyles() {
    if (document.getElementById('mpvx-style')) return
    const style = document.createElement('style')
    style.id = 'mpvx-style'
    style.textContent = `
        .${MPVX.btnClass} {
            margin-left: 8px;
            padding: 2px 8px;
            font-size: 12px;
            border-radius: 4px;
            border: 1px solid #07c160;
            background: #07c160;
            color: #fff;
            cursor: pointer;
            line-height: 18px;
        }
        .${MPVX.btnClass}[disabled] {
            opacity: .6;
            cursor: not-allowed;
        }
        #${MPVX.toastId} {
            position: fixed;
            right: 16px;
            bottom: 16px;
            z-index: 2147483647;
            max-width: 320px;
            padding: 10px 12px;
            border-radius: 8px;
            background: rgba(0,0,0,.82);
            color: #fff;
            font-size: 13px;
            box-shadow: 0 6px 18px rgba(0,0,0,.25);
            display: none;
        }

        .mpvx-sync-row {
            margin-top: 6px;
        }

        .mpvx-sync-row .${MPVX.btnClass} {
            margin-left: 0;
            padding: 4px 10px;
            line-height: 18px;
        }

        /* 已同步按钮样式 */
        .${MPVX.btnClass}.mpvx-synced {
            background: #909399;
            border-color: #909399;
        }

        /* 批量同步按钮 */
        #${MPVX.bulkBtnId} {
            position: fixed;
            right: 16px;
            bottom: 110px;
            z-index: 2147483647;
            padding: 8px 12px;
            border-radius: 999px;
            border: 1px solid #07c160;
            background: #fff;
            color: #07c160;
            font-size: 13px;
            cursor: pointer;
            box-shadow: 0 6px 18px rgba(0,0,0,.12);
        }

        #${MPVX.bulkBtnId}[disabled] {
            opacity: .6;
            cursor: not-allowed;
        }
    `.trim()
    document.documentElement.appendChild(style)
}

function toast(msg, ms = 2500) {
    let el = document.getElementById(MPVX.toastId)
    if (!el) {
        el = document.createElement('div')
        el.id = MPVX.toastId
        document.body.appendChild(el)
    }
    el.textContent = msg
    el.style.display = 'block'
    clearTimeout(el.__mpvx_timer)
    el.__mpvx_timer = setTimeout(() => {
        el.style.display = 'none'
    }, ms)
}

function createSyncButton(text = '同步到网站') {
    const btn = document.createElement('button')
    btn.className = MPVX.btnClass
    btn.type = 'button'
    btn.textContent = text
    btn.dataset.mpvxDefaultText = text
    return btn
}

/**
 * 规范化 URL 用于同步状态比对（需与 background.js 的 normalizeUrlForSync 保持一致）
 */
function normalizeUrlForSync(url) {
    if (!url) return ''
    try {
        const u = new URL(url)
        const paramsToRemove = ['chksm', 'scene', 'share_token']
        paramsToRemove.forEach(param => u.searchParams.delete(param))
        return u.toString()
    } catch (e) {
        return url
    }
}

function setButtonUrl(btn, url) {
    if (!btn) return
    btn.dataset.mpvxUrl = url || ''
    btn.dataset.mpvxUrlKey = normalizeUrlForSync(url || '')
}

/**
 * 检查文章 URL 是否已同步
 */
function checkSyncStatus(url, btn) {
    if (!url || !btn) return

    setButtonUrl(btn, url)

    chrome.runtime.sendMessage({
        action: 'isUrlSynced',
        url
    }, (res) => {
        if (res && res.ok && res.synced) {
            updateButtonAsSynced(btn)
        } else {
            updateButtonAsUnsynced(btn)
        }
    })
}

/**
 * 将按钮更新为已同步状态
 */
function updateButtonAsSynced(btn) {
    if (!btn) return
    btn.textContent = '已同步'
    btn.classList.add('mpvx-synced')
    btn.disabled = true
    btn.dataset.mpvxBusy = '0'
}

/**
 * 将按钮更新为未同步/可用状态
 */
function updateButtonAsUnsynced(btn) {
    if (!btn) return
    if (btn.dataset.mpvxBusy === '1') return
    btn.classList.remove('mpvx-synced')
    btn.disabled = false
    btn.textContent = btn.dataset.mpvxDefaultText || '同步到网站'
}

function refreshButtonsFromSyncedUrls(syncedUrls) {
    const map = (syncedUrls && typeof syncedUrls === 'object') ? syncedUrls : {}
    const buttons = Array.from(document.querySelectorAll(`.${MPVX.btnClass}[data-mpvx-url-key]`))
    for (const btn of buttons) {
        const key = (btn.dataset && btn.dataset.mpvxUrlKey) ? btn.dataset.mpvxUrlKey : ''
        if (!key) continue
        if (map[key]) {
            updateButtonAsSynced(btn)
        } else {
            updateButtonAsUnsynced(btn)
        }
    }
}

function startSyncedUrlsLiveSync() {
    if (startSyncedUrlsLiveSync.__started) return
    startSyncedUrlsLiveSync.__started = true

    try {
        chrome.storage.local.get({ syncedUrls: {} }, (items) => {
            refreshButtonsFromSyncedUrls(items && items.syncedUrls)
        })

        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local') return
            if (!changes || !changes.syncedUrls) return
            refreshButtonsFromSyncedUrls(changes.syncedUrls.newValue || {})
        })
    } catch (e) {
        // ignore
    }
}

function ensureBulkSyncButton() {
    if (document.getElementById(MPVX.bulkBtnId)) return
    const btn = document.createElement('button')
    btn.id = MPVX.bulkBtnId
    btn.type = 'button'
    btn.textContent = '批量同步本页未同步'
    document.body.appendChild(btn)

    btn.addEventListener('click', async () => {
        const candidates = Array.from(document.querySelectorAll(`.${MPVX.btnClass}[data-mpvx-url-key]`))
            .filter(b => b && !b.disabled && !b.classList.contains('mpvx-synced'))

        if (!candidates.length) {
            toast('本页没有可同步的文章')
            return
        }

        btn.disabled = true
        const total = candidates.length
        let ok = 0
        let fail = 0

        for (let i = 0; i < candidates.length; i++) {
            const itemBtn = candidates[i]
            toast(`批量同步中：${i + 1}/${total}`)
            try {
                const payload = itemBtn.__mpvx_payload
                const url = (itemBtn.dataset && itemBtn.dataset.mpvxUrl) ? itemBtn.dataset.mpvxUrl : ''
                const title = (itemBtn.dataset && itemBtn.dataset.mpvxTitle) ? itemBtn.dataset.mpvxTitle : ''

                const res = payload
                    ? await syncPayload(payload, itemBtn)
                    : await syncByUrl(url, { title }, itemBtn)

                if (res && res.ok) ok++
                else fail++
            } catch (e) {
                fail++
            }

            await new Promise(r => setTimeout(r, 400))
        }

        btn.disabled = false
        toast(`批量同步完成：成功 ${ok}，失败 ${fail}`, 4000)
    })
}

function safeMeta(selector) {
    const el = document.querySelector(selector)
    if (!el) return ''
    return (el.getAttribute('content') || '').trim()
}

function safeText(selector) {
    const el = document.querySelector(selector)
    return el ? (el.textContent || '').trim() : ''
}

function getBackgroundImageUrlFromStyle(el) {
    if (!el) return ''
    const bg = (el.style && el.style.backgroundImage) ? el.style.backgroundImage : ''
    if (!bg) return ''
    const m = bg.match(/url\(["']?(.*?)["']?\)/i)
    return m && m[1] ? m[1] : ''
}

function isAppmsgPublishListPage() {
    // 公众号后台内容管理列表页
    // 例：https://mp.weixin.qq.com/cgi-bin/appmsgpublish?sub=list&begin=0&count=10...
    if ((location.pathname || '') !== '/cgi-bin/appmsgpublish') return false
    try {
        const sp = new URLSearchParams(location.search || '')
        return (sp.get('sub') || '') === 'list'
    } catch (e) {
        return false
    }
}

function extractFromPublishRow(row) {
    const titleLink = row.querySelector('a.weui-desktop-mass-appmsg__title')

    // 标题链接里可能包含额外 DOM（如“转载”提示、Popover 等）。
    // 目标：只取第一个 <span> 的纯标题文本。
    const title = (() => {
        if (!titleLink) return ''

        const span = titleLink.querySelector('span')
        const spanText = span ? (span.textContent || '').trim() : ''
        if (spanText) return spanText

        // 兜底：取 a 下“直接文本节点”，避免深层嵌套的提示文案
        const directText = Array.from(titleLink.childNodes || [])
            .filter(n => n && n.nodeType === 3) // Node.TEXT_NODE
            .map(n => (n.textContent || '').trim())
            .filter(Boolean)
            .join(' ')
            .trim()
        if (directText) return directText

        return (titleLink.textContent || '').trim()
    })()
    const href = titleLink ? (titleLink.getAttribute('href') || '').trim() : ''
    const url = href ? new URL(href, location.href).toString() : ''

    const publish_time = (() => {
        const t = row.querySelector('.weui-desktop-mass__time')
        return t ? (t.textContent || '').trim() : ''
    })()

    const read_count = (() => {
        const el = row.querySelector('.weui-desktop-mass-media__data.appmsg-view .weui-desktop-mass-media__data__inner')
        return el ? (el.textContent || '').trim() : ''
    })()

    const cover_image = (() => {
        const thumb = row.querySelector('.weui-desktop-mass-appmsg__thumb')
        return getBackgroundImageUrlFromStyle(thumb)
    })()

    // 后台列表通常不直接展示作者；保留字段给后续兼容
    const author = ''

    const mp_account_nickname = getMpAccountNickname()

    return {
        title,
        publish_time,
        read_count,
        url,
        author,
        cover_image,
        mp_account_nickname
    }
}

function decorateAppmsgPublishRows() {
    // 注意：.publish_content.publish_record_history 往往是"整个列表容器"，不是单条记录。
    // 之前在容器上 querySelector 只会命中第一个 .weui-desktop-mass-media__data-list，导致只给第一条加按钮。
    const dataLists = Array.from(document.querySelectorAll('.weui-desktop-mass-media__data-list'))
    for (const dataList of dataLists) {
        const row = dataList.closest('.weui-desktop-mass__item')
            || dataList.closest('.weui-desktop-mass-appmsg')
            || dataList.closest('.publish_content')
            || dataList.parentElement
        if (!row) continue
        if (row.getAttribute(MPVX.rowMarkerAttr) === '1') continue

        // 必须能在同一条记录里找到标题链接，否则可能是页面其它区域的 data-list
        const titleLink = row.querySelector('a.weui-desktop-mass-appmsg__title')
        if (!titleLink) continue

        const payload = extractFromPublishRow(row)
        const btnRow = document.createElement('div')
        btnRow.className = 'mpvx-sync-row'
        const btn = createSyncButton('同步到网站')
        btn.dataset.mpvxScope = 'appmsgpublish-list'

        // 为实时联动/批量同步保存关键信息
        setButtonUrl(btn, payload.url)
        btn.dataset.mpvxTitle = payload.title || ''
        btn.__mpvx_payload = payload

        // 检查同步状态
        if (payload.url) {
            checkSyncStatus(payload.url, btn)
        }

        btn.addEventListener('click', (e) => {
            e.preventDefault()
            e.stopPropagation()

            if (!payload.url) {
                toast('未检测到文章链接，无法同步')
                return
            }
            syncPayload(payload, btn)
        })

        btnRow.appendChild(btn)
        dataList.insertAdjacentElement('afterend', btnRow)
        row.setAttribute(MPVX.rowMarkerAttr, '1')
    }
}

function initAppmsgPublishListButtons() {
    decorateAppmsgPublishRows()
    ensureBulkSyncButton()
    const mo = new MutationObserver(() => decorateAppmsgPublishRows())
    mo.observe(document.documentElement || document.body, { childList: true, subtree: true })
}

function extractArticleFromPage() {
    const title = safeText('#activity-name') || safeMeta('meta[property="og:title"]')
    const author = safeText('#js_name') || safeMeta('meta[property="og:article:author"]')
    const url = safeMeta('meta[property="og:url"]') || location.href
    const cover_image = safeMeta('meta[property="og:image"]')
    const description = safeMeta('meta[property="og:description"]')
    const publish_time = safeText('#publish_time') || safeMeta('meta[property="article:published_time"]') || safeMeta('meta[name="publish_time"]')

    // 阅读数可能是异步渲染：这里先取一次，缺失则交给后台通过隐藏标签页再次采集
    const read_count = safeText('#readNum3') || safeText('#js_read_area #readNum3') || ''

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

function syncPayload(payload, btn) {
    btn.disabled = true
    btn.dataset.mpvxBusy = '1'
    const oldText = btn.textContent
    btn.textContent = '同步中...'

    const mp_account_nickname = getMpAccountNickname()

    return new Promise((resolve) => {
        chrome.runtime.sendMessage({
            action: 'syncArticle',
            payload: {
                ...(payload && typeof payload === 'object' ? payload : {}),
                mp_account_nickname
            },
            mp_account_nickname
        }, (res) => {
            btn.disabled = false
            btn.textContent = oldText
            btn.dataset.mpvxBusy = '0'

            if (chrome.runtime.lastError) {
                toast('同步失败：' + chrome.runtime.lastError.message)
                resolve({ ok: false, error: chrome.runtime.lastError.message })
                return
            }

            console.log('MP-VX-Insight ==> syncArticle response ->', res)

            if (!res) {
                toast('同步失败：未收到后台响应（请检查扩展是否已启用）')
                resolve({ ok: false, error: 'no_response' })
                return
            }
            if (res.ok) {
                if (res.posted === false) {
                    toast('同步成功（但后台未标记已发起接口，请确认已重载扩展）')
                } else {
                    toast('同步成功')
                    // 同步成功后更新按钮状态
                    updateButtonAsSynced(btn)
                }
            } else {
                toast('同步失败：' + (res.error || '未知错误'))
            }
            resolve(res)
        })
    })
}

function syncByUrl(url, hints, btn) {
    btn.disabled = true
    btn.dataset.mpvxBusy = '1'
    const oldText = btn.textContent
    btn.textContent = '采集中...'

    const mp_account_nickname = getMpAccountNickname()

    return new Promise((resolve) => {
        chrome.runtime.sendMessage({
            action: 'syncByUrl',
            url,
            hints: {
                ...(hints && typeof hints === 'object' ? hints : {}),
                mp_account_nickname
            },
            mp_account_nickname
        }, (res) => {
            btn.disabled = false
            btn.textContent = oldText
            btn.dataset.mpvxBusy = '0'

            if (chrome.runtime.lastError) {
                toast('同步失败：' + chrome.runtime.lastError.message)
                resolve({ ok: false, error: chrome.runtime.lastError.message })
                return
            }

            console.log('MP-VX-Insight ==> syncByUrl response ->', res)

            if (!res) {
                toast('同步失败：未收到后台响应')
                resolve({ ok: false, error: 'no_response' })
                return
            }
            if (res.ok) {
                if (res.posted === false) {
                    toast('同步成功（但后台未标记已发起接口，请确认已重载扩展）')
                } else {
                    toast('同步成功')
                    // 同步成功后更新按钮状态
                    updateButtonAsSynced(btn)
                }
            } else {
                toast('同步失败：' + (res.error || '未知错误'))
            }
            resolve(res)
        })
    })
}

function initArticlePageButton() {
    // 文章详情页：放在标题附近；找不到就固定右下角
    if (document.querySelector(`.${MPVX.btnClass}[data-mpvx-scope="article"]`)) return

    const btn = createSyncButton('同步到网站')
    btn.dataset.mpvxScope = 'article'

    // 检查同步状态
    const currentUrl = location.href
    checkSyncStatus(currentUrl, btn)

    btn.addEventListener('click', () => {
        const payload = extractArticleFromPage()
        if (!payload.url) {
            toast('未检测到文章链接，无法同步')
            return
        }
        // 如果当前页没拿到阅读数，也可用后台再采集一次
        if (!payload.read_count) {
            // 走后台隐藏标签页采集（更稳）
            syncByUrl(payload.url, payload, btn)
        } else {
            syncPayload(payload, btn)
        }
    })

    const titleEl = document.querySelector('#activity-name')
    if (titleEl && titleEl.parentElement) {
        titleEl.parentElement.appendChild(btn)
        return
    }

    // fallback：固定按钮
    btn.style.position = 'fixed'
    btn.style.right = '16px'
    btn.style.bottom = '60px'
    btn.style.zIndex = '2147483647'
    document.body.appendChild(btn)
}

function decorateArticleLinks() {
    const links = Array.from(document.querySelectorAll('a[href]'))
    for (const a of links) {
        const hrefRaw = a.getAttribute('href') || ''
        const href = hrefRaw.trim()
        if (!href) continue

        // 只处理文章链接
        const isArticle = href.includes('mp.weixin.qq.com/s') || href.startsWith('/s?') || href.startsWith('/s/')
        if (!isArticle) continue

        if (a.getAttribute(MPVX.markerAttr) === '1') continue
        a.setAttribute(MPVX.markerAttr, '1')

        const url = new URL(href, location.href).toString()
        const btn = createSyncButton('同步到网站')
        btn.dataset.mpvxScope = 'list'

        setButtonUrl(btn, url)
        btn.dataset.mpvxTitle = (a.textContent || '').trim()

        // 检查同步状态
        checkSyncStatus(url, btn)

        btn.addEventListener('click', (e) => {
            e.preventDefault()
            e.stopPropagation()

            const title = (a.textContent || '').trim()
            syncByUrl(url, { title }, btn)
        })

        // 插到链接后面，尽量不破坏原布局
        if (a.parentElement) {
            a.parentElement.insertBefore(btn, a.nextSibling)
        }
    }
}

function initListPageButtons() {
    decorateArticleLinks()
    ensureBulkSyncButton()
    const mo = new MutationObserver(() => decorateArticleLinks())
    mo.observe(document.documentElement || document.body, { childList: true, subtree: true })
}

function initSyncButtons() {
    ensureStyles()
    startSyncedUrlsLiveSync()
    // 尝试上报当前登录公众号（如果页面能拿到）
    reportMpAccountNickname()
    const path = location.pathname || ''

    // 公众号后台发表记录列表页：逐行加按钮（你给的页面）
    if (isAppmsgPublishListPage()) {
        initAppmsgPublishListButtons()
        return
    }

    // 历史文章页 / 列表页：尽量为每条文章加按钮
    if (path.startsWith('/mp/profile_ext')) {
        initListPageButtons()
        return
    }

    // 文章详情页：一键同步
    if (path.startsWith('/s') || path.startsWith('/s/')) {
        initArticlePageButton()
        return
    }
}

/**
 * 处理快捷键触发的同步
 */
function handleShortcutSync() {
    const path = location.pathname || ''

    // 文章详情页：直接同步
    if (path.startsWith('/s') || path.startsWith('/s/')) {
        const btn = document.querySelector(`.${MPVX.btnClass}[data-mpvx-scope="article"]`)
        if (btn && !btn.disabled) {
            btn.click()
            toast('已触发快捷键同步')
        } else {
            toast('无法同步：按钮未就绪或已同步')
        }
        return
    }

    // 其他页面：提示用户使用点击按钮
    toast('快捷键同步仅支持文章详情页，请点击按钮同步')
}

try {
    initSyncButtons()
} catch (e) {
    console.warn('MP-VX-Insight ==> initSyncButtons error:', e)
}

// 多次延迟上报，避免昵称区域晚渲染
const delays = [500, 1200, 2500, 5000]
delays.forEach(delay => {
    setTimeout(() => {
        try {
            reportMpAccountNickname()
        } catch (e) {
            // ignore
        }
    }, delay)
})

// 使用 MutationObserver 监听侧边栏加载
const observeMpSidebar = () => {
    const sidebar = document.querySelector('#js_mp_sidemenu')
    if (!sidebar) {
        // 如果侧边栏还没加载，稍后重试
        setTimeout(observeMpSidebar, 1000)
        return
    }

    const observer = new MutationObserver(() => {
        reportMpAccountNickname()
    })

    observer.observe(sidebar, {
        childList: true,
        subtree: true
    })

    // 10 秒后停止观察
    setTimeout(() => observer.disconnect(), 10000)
}

// 延迟启动观察器
setTimeout(observeMpSidebar, 2000)

function getContent() {
    const safeContent = (v) => {
        return v && typeof v === 'object' ? String(v.content) : ''
    }

    const title = document.querySelector('meta[property="og:title"]')
    const author = document.querySelector('meta[property="og:article:author"]')
    const url = document.querySelector('meta[property="og:url"]')
    const cover_image = document.querySelector('meta[property="og:image"]')
    const description = document.querySelector('meta[property="og:description"]')

    return {
        title: safeContent(title),
        author: safeContent(author),
        url: safeContent(url),
        cover_image: safeContent(cover_image),
        description: safeContent(description)
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("MP-VX-Insight ==> content.js ==> receive from popup2content msg -> ", message)

    // 快捷键触发同步
    if (message && message.action === 'triggerSyncByShortcut') {
        handleShortcutSync()
        sendResponse({ ok: true })
        return true
    }

    // 方案A：getAccountInfo 只走 sendResponse（点对点回包），不再广播消息，避免 popup 循环触发。
    if (message && message.action === 'getAccountInfo') {
        const nickname = getMpAccountNickname()
        if (nickname) reportMpAccountNickname()
        sendResponse({ ok: true, nickname })
        return
    }

    let req = {
        type: "content2popup",
    }

    if ("initData" === message.action) {
        const fetchData = getContent()
        console.log("MP-VX-Insight ==> 微信小助手获取到的数据：", fetchData)
        req.action = "afterFetchData"
        req.params = fetchData
        req.info = "抓取了页面上的数据"
    }

    chrome.runtime.sendMessage(req, res => {
        console.log("MP-VX-Insight ==> content2popup then res -> ", res)
    })

    sendResponse("MP-VX-Insight ==> content.js 收到来自 popup.js 的消息")
})