console.log("MP-VX-Insight ==> loading content.js")

const MPVX = {
    markerAttr: 'data-mpvx-sync-added',
    rowMarkerAttr: 'data-mpvx-sync-row-added',
    btnClass: 'mpvx-sync-btn',
    toastId: 'mpvx-sync-toast'
}

const MPVX_AUTH = {
    // 注意：微信后台 DOM 里 class 叫 acount_box-nickname（少了个 c），不是 account
    nicknameSelectors: [
        '#js_mp_sidemenu > div > div.weui-desktop-layout__side-menu__footer > div.mp_account_box > div.weui-desktop-account__info.weui-desktop-layout__side-menu__footer-item > div > span.acount_box-nickname',
        '#js_mp_sidemenu span.acount_box-nickname',
        'span.acount_box-nickname'
    ]
}

function getMpAccountNickname() {
    for (const sel of MPVX_AUTH.nicknameSelectors) {
        const el = document.querySelector(sel)
        const name = el ? (el.textContent || '').trim() : ''
        if (name) return name
    }
    return ''
}

function reportMpAccountNickname() {
    const nickname = getMpAccountNickname()
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
    return btn
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
    const title = titleLink ? (titleLink.textContent || '').trim() : ''
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
    // 注意：.publish_content.publish_record_history 往往是“整个列表容器”，不是单条记录。
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

        const btnRow = document.createElement('div')
        btnRow.className = 'mpvx-sync-row'
        const btn = createSyncButton('同步到网站')
        btn.dataset.mpvxScope = 'appmsgpublish-list'

        btn.addEventListener('click', (e) => {
            e.preventDefault()
            e.stopPropagation()

            const payload = extractFromPublishRow(row)
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
    const oldText = btn.textContent
    btn.textContent = '同步中...'

    const mp_account_nickname = getMpAccountNickname()

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

        if (chrome.runtime.lastError) {
            toast('同步失败：' + chrome.runtime.lastError.message)
            return
        }

        console.log('MP-VX-Insight ==> syncArticle response ->', res)

        if (!res) {
            toast('同步失败：未收到后台响应（请检查扩展是否已启用）')
            return
        }
        if (res.ok) {
            if (res.posted === false) {
                toast('同步成功（但后台未标记已发起接口，请确认已重载扩展）')
            } else {
                toast('同步成功')
            }
        } else {
            toast('同步失败：' + (res.error || '未知错误'))
        }
    })
}

function syncByUrl(url, hints, btn) {
    btn.disabled = true
    const oldText = btn.textContent
    btn.textContent = '采集中...'

    const mp_account_nickname = getMpAccountNickname()

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

        if (chrome.runtime.lastError) {
            toast('同步失败：' + chrome.runtime.lastError.message)
            return
        }

        console.log('MP-VX-Insight ==> syncByUrl response ->', res)

        if (!res) {
            toast('同步失败：未收到后台响应')
            return
        }
        if (res.ok) {
            if (res.posted === false) {
                toast('同步成功（但后台未标记已发起接口，请确认已重载扩展）')
            } else {
                toast('同步成功')
            }
        } else {
            toast('同步失败：' + (res.error || '未知错误'))
        }
    })
}

function initArticlePageButton() {
    // 文章详情页：放在标题附近；找不到就固定右下角
    if (document.querySelector(`.${MPVX.btnClass}[data-mpvx-scope="article"]`)) return

    const btn = createSyncButton('同步到网站')
    btn.dataset.mpvxScope = 'article'
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

        const btn = createSyncButton('同步到网站')
        btn.dataset.mpvxScope = 'list'
        btn.addEventListener('click', (e) => {
            e.preventDefault()
            e.stopPropagation()

            const url = new URL(href, location.href).toString()
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
    const mo = new MutationObserver(() => decorateArticleLinks())
    mo.observe(document.documentElement || document.body, { childList: true, subtree: true })
}

function initSyncButtons() {
    ensureStyles()
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

try {
    initSyncButtons()
} catch (e) {
    console.warn('MP-VX-Insight ==> initSyncButtons error:', e)
}

// 再延迟上报一次，避免昵称区域晚渲染
setTimeout(() => {
    try {
        reportMpAccountNickname()
    } catch (e) {
        // ignore
    }
}, 1200)

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