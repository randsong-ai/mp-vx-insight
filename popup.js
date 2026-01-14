console.log("MP-VX-Insight ==> loading popup.js")
const alertCVMSG = "Copy successfully! You can use Ctrl+v or Command+V to do so!"

const STORAGE_KEYS = {
    apiUrl: 'apiUrl',
    schoolId: 'schoolId',
    schoolName: 'schoolName',
    categoryId: 'categoryId',
    categoryName: 'categoryName'
}

function setMpAccountUI({ nickname, authorized, tip }) {
    const nameEl = document.getElementById('mpAccountName')
    const tipEl = document.getElementById('mpAccountAuthTip')
    const section = document.getElementById('configPanel')

    if (nameEl) nameEl.textContent = nickname ? nickname : '（未检测）'
    if (tipEl) tipEl.textContent = tip || ''

    // 未授权时隐藏配置区（学校/栏目 + API）
    if (section) section.style.display = authorized ? '' : 'none'
}

function requestMpAccountStatusFromBackground() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getMpAccountStatus' }, (res) => {
            console.log('MP-VX-Insight ==> popup.js ==> getMpAccountStatus response:', res)
            if (chrome.runtime.lastError) {
                console.error('MP-VX-Insight ==> popup.js ==> getMpAccountStatus error:', chrome.runtime.lastError)
                resolve({ ok: false, error: chrome.runtime.lastError.message })
                return
            }
            if (!res || !res.ok) {
                resolve({ ok: false, error: (res && res.error) ? res.error : '未收到后台响应' })
                return
            }
            resolve(res)
        })
    })
}

function requestMpAccountInfoFromActiveTab() {
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs && tabs[0]
            const tabId = tab && tab.id
            const url = tab && tab.url
            if (!tabId || !url) {
                resolve({ ok: false, nickname: '' })
                return
            }

            let hostname = ''
            try {
                hostname = new URL(url).hostname
            } catch (e) {
                hostname = ''
            }

            if (hostname !== 'mp.weixin.qq.com') {
                resolve({ ok: false, nickname: '' })
                return
            }

            chrome.tabs.sendMessage(tabId, { action: 'getAccountInfo', type: 'popup2content' }, (res) => {
                // content script 不存在/页面不匹配时会报 lastError
                if (chrome.runtime.lastError) {
                    resolve({ ok: false, nickname: '' })
                    return
                }
                resolve({ ok: !!(res && res.ok), nickname: (res && res.nickname) ? String(res.nickname) : '' })
            })
        })
    })
}

async function enforceMpAccountAuthorization() {
    // 1) 先用后台缓存的昵称做一次判定（即使当前不在 mp.weixin.qq.com 也能工作）
    const cached = await requestMpAccountStatusFromBackground()
    console.log('MP-VX-Insight ==> popup.js ==> cached status:', cached)

    // 设置初始 UI（基于后台缓存）
    if (cached && cached.ok) {
        if (cached.authorized) {
            setMpAccountUI({
                nickname: cached.nickname || '（未检测）',
                authorized: true,
                tip: '已授权'
            })
        } else {
            const allowedText = (cached.allowed && cached.allowed.length) ? cached.allowed.join('、') : ''
            const t = cached.nickname
                ? `仅支持定义的公众号：${allowedText}（当前：${cached.nickname}）`
                : `仅支持定义的公众号：${allowedText || '请在微信公众号后台页面打开此插件'}`
            setMpAccountUI({ nickname: cached.nickname || '（未检测）', authorized: false, tip: t })
        }
    } else {
        // 后台不可用时先给个默认
        setMpAccountUI({ nickname: '（未检测）', authorized: false, tip: '请在微信公众号后台页面使用此插件' })
    }

    // 2) 再尝试从当前打开的公众号后台页面实时读取昵称（更及时）
    const live = await requestMpAccountInfoFromActiveTab()
    console.log('MP-VX-Insight ==> popup.js ==> live info:', live)

    if (live && live.ok && live.nickname) {
        // 让后台更新缓存（content.js 同时也会更新，这里做双保险）
        chrome.runtime.sendMessage({ action: 'updateMpAccountNickname', nickname: live.nickname })

        const allowed = (cached && cached.ok && Array.isArray(cached.allowed)) ? cached.allowed : null
        const allowedText = allowed ? allowed.join('、') : ''
        // 授权与否让后台口径一致：重新拉一次 status
        const refreshed = await requestMpAccountStatusFromBackground()
        if (refreshed && refreshed.ok) {
            if (refreshed.authorized) {
                setMpAccountUI({ nickname: refreshed.nickname, authorized: true, tip: '已授权' })
            } else {
                const t = `仅支持定义的公众号：${(refreshed.allowed || []).join('、')}（当前：${refreshed.nickname || live.nickname}）`
                setMpAccountUI({ nickname: refreshed.nickname || live.nickname, authorized: false, tip: t })
            }
        } else {
            // 兜底：按"未授权"处理
            const t = allowedText ? `仅支持定义的公众号：${allowedText}（当前：${live.nickname}）` : '仅支持定义的公众号'
            setMpAccountUI({ nickname: live.nickname, authorized: false, tip: t })
        }
    } else {
        // 如果实时检测失败（不在微信页面），但后台有缓存数据，保持后台缓存的结果
        if (cached && cached.ok && cached.nickname) {
            console.log('MP-VX-Insight ==> popup.js ==> using cached data, not on mp page')
            // UI 已经在步骤 1 中设置好了，不需要更新
        }
    }
}

function setStatus(text) {
    const el = document.getElementById('schoolStatus')
    if (!el) return
    el.textContent = text
}

function asArray(v) {
    return Array.isArray(v) ? v : []
}

function requestSchoolsFromBackground() {
    return new Promise((resolve, reject) => {
        console.log('MP-VX-Insight ==> popup.js ==> sending fetchSchools message to background')
        chrome.runtime.sendMessage({ action: 'fetchSchools' }, (res) => {
            console.log('MP-VX-Insight ==> popup.js ==> fetchSchools response:', res)
            if (chrome.runtime.lastError) {
                console.error('MP-VX-Insight ==> popup.js ==> fetchSchools lastError:', chrome.runtime.lastError)
                reject(new Error(chrome.runtime.lastError.message))
                return
            }
            if (!res) {
                reject(new Error('未收到后台响应'))
                return
            }
            if (!res.ok) {
                reject(new Error(res.error || '获取学校列表失败'))
                return
            }
            console.log('MP-VX-Insight ==> popup.js ==> fetchSchools success, data count:', asArray(res.data).length)
            resolve(asArray(res.data))
        })
    })
}

function requestCategoriesFromBackground(schoolId) {
    return new Promise((resolve, reject) => {
        const sid = normalizeId(schoolId)
        if (!sid) {
            resolve([])
            return
        }

        console.log('MP-VX-Insight ==> popup.js ==> sending fetchCategories message to background, schoolId:', sid)
        chrome.runtime.sendMessage({ action: 'fetchCategories', schoolId: sid }, (res) => {
            console.log('MP-VX-Insight ==> popup.js ==> fetchCategories response:', res)
            if (chrome.runtime.lastError) {
                console.error('MP-VX-Insight ==> popup.js ==> fetchCategories lastError:', chrome.runtime.lastError)
                reject(new Error(chrome.runtime.lastError.message))
                return
            }
            if (!res) {
                reject(new Error('未收到后台响应'))
                return
            }
            if (!res.ok) {
                reject(new Error(res.error || '获取栏目列表失败'))
                return
            }
            resolve(asArray(res.data))
        })
    })
}

function buildOption(value, text, selected = false) {
    const opt = document.createElement('option')
    opt.value = value
    opt.textContent = text
    opt.selected = selected
    return opt
}

function clearSelect(selectEl) {
    if (!selectEl) return
    while (selectEl.firstChild) selectEl.removeChild(selectEl.firstChild)
}

function normalizeId(v) {
    if (v === null || v === undefined) return ''
    return String(v).trim()
}

function getSelectedOptionText(selectEl) {
    if (!selectEl) return ''
    const idx = selectEl.selectedIndex
    if (idx < 0) return ''
    const opt = selectEl.options[idx]
    return opt ? (opt.textContent || '') : ''
}

async function loadSchoolAndCategoryUI() {
    const schoolSelect = document.getElementById('schoolSelect')
    const categorySelect = document.getElementById('categorySelect')
    if (!schoolSelect || !categorySelect) {
        console.warn('MP-VX-Insight ==> schoolSelect or categorySelect not found')
        return
    }

    console.log('MP-VX-Insight ==> loadSchoolAndCategoryUI() called')
    setStatus('加载学校列表中...')

    const stored = await new Promise((resolve) => {
        chrome.storage.local.get({
            [STORAGE_KEYS.schoolId]: '',
            [STORAGE_KEYS.schoolName]: '',
            [STORAGE_KEYS.categoryId]: '',
            [STORAGE_KEYS.categoryName]: ''
        }, resolve)
    })

    let schools = []
    try {
        schools = await requestSchoolsFromBackground()
    } catch (e) {
        console.error('MP-VX-Insight ==> fetchSchools error:', e)
        setStatus('加载失败：' + (e && e.message ? e.message : e))
        // 仍渲染一个占位，避免 UI 空白
        clearSelect(schoolSelect)
        schoolSelect.appendChild(buildOption('', '（加载失败，点“刷新学校/栏目”重试）', true))
        clearSelect(categorySelect)
        categorySelect.appendChild(buildOption('', '（请先选择学校）', true))
        return
    }

    // 绑定 schools 到元素上，后续联动用
    schoolSelect.__mpvx_schools = schools

    const storedSchoolId = normalizeId(stored[STORAGE_KEYS.schoolId])
    const storedCategoryId = normalizeId(stored[STORAGE_KEYS.categoryId])

    clearSelect(schoolSelect)
    schoolSelect.appendChild(buildOption('', '请选择学校', !storedSchoolId))
    for (const s of schools) {
        const sid = normalizeId(s && s.id)
        const name = (s && s.name) ? String(s.name) : sid
        schoolSelect.appendChild(buildOption(sid, name, sid && sid === storedSchoolId))
    }

    const renderCategoryOptions = (list) => {
        clearSelect(categorySelect)
        categorySelect.appendChild(buildOption('', '请选择栏目', !storedCategoryId))
        for (const c of asArray(list)) {
            const cid = normalizeId(c && c.id)
            const cname = (c && c.name) ? String(c.name) : cid
            const selected = cid && cid === storedCategoryId
            categorySelect.appendChild(buildOption(cid, cname, selected))
        }
        // 若有已存栏目且命中，则确保选中
        if (storedCategoryId) {
            for (const opt of Array.from(categorySelect.options)) {
                if (opt.value === storedCategoryId) {
                    opt.selected = true
                    break
                }
            }
        }
    }

    const loadAndRenderCategories = async (schoolId) => {
        const sid = normalizeId(schoolId)
        if (!sid) {
            clearSelect(categorySelect)
            categorySelect.appendChild(buildOption('', '（请先选择学校）', true))
            return
        }

        clearSelect(categorySelect)
        categorySelect.appendChild(buildOption('', '加载栏目中...', true))

        // 1) 优先走接口按学校拉取栏目（确保“栏目”确实调用接口）
        try {
            const categories = await requestCategoriesFromBackground(sid)
            renderCategoryOptions(categories)
            return
        } catch (e) {
            console.warn('MP-VX-Insight ==> popup.js ==> fetchCategories failed, fallback to embedded list:', e)
        }

        // 2) 回退：使用学校列表里内嵌的 list（兼容老接口）
        const embedded = (() => {
            const s = schools.find(x => normalizeId(x && x.id) === sid)
            return asArray(s && s.list)
        })()
        renderCategoryOptions(embedded)
    }

    if (storedSchoolId) {
        await loadAndRenderCategories(storedSchoolId)
    } else {
        clearSelect(categorySelect)
        categorySelect.appendChild(buildOption('', '（请先选择学校）', true))
    }

    setStatus('已加载 ' + schools.length + ' 所学校')

    // 事件绑定（防止重复绑定）
    if (!schoolSelect.__mpvx_bound) {
        schoolSelect.__mpvx_bound = true
        schoolSelect.addEventListener('change', async () => {
            const sid = normalizeId(schoolSelect.value)
            const sname = getSelectedOptionText(schoolSelect)

            // 切换学校时，栏目清空
            chrome.storage.local.set({
                [STORAGE_KEYS.schoolId]: sid,
                [STORAGE_KEYS.schoolName]: sid ? sname : '',
                [STORAGE_KEYS.categoryId]: '',
                [STORAGE_KEYS.categoryName]: ''
            })

            if (!sid) {
                clearSelect(categorySelect)
                categorySelect.appendChild(buildOption('', '（请先选择学校）', true))
                return
            }
            // 重新生成栏目（走接口）
            await loadAndRenderCategories(sid)
        })
    }

    if (!categorySelect.__mpvx_bound) {
        categorySelect.__mpvx_bound = true
        categorySelect.addEventListener('change', () => {
            const cid = normalizeId(categorySelect.value)
            const cname = getSelectedOptionText(categorySelect)
            chrome.storage.local.set({
                [STORAGE_KEYS.categoryId]: cid,
                [STORAGE_KEYS.categoryName]: cid ? cname : ''
            })
        })
    }
}

function getUriParams(url) {
    const params = {}
    const queryString = url.split("?")[1]
    const bizPrefix = "__biz"

    if (queryString) {
        const keyValuePairs = queryString.split("&")
        keyValuePairs.forEach(keyValue => {
            let [key, value] = keyValue.split("=")
            if (keyValue.startsWith(bizPrefix)) {
                key = bizPrefix
                value = keyValue.substring(bizPrefix.length + 1)
            }
            params[key] = decodeURIComponent(value)
        })
    }

    return params
}

function toggleLoading(button) {
    button.disabled = !button.disabled // 切换按钮禁用状态
    button.classList.toggle("loading") // 切换加载状态样式

    const spinner = button.querySelector(".spinner") || document.createElement("div")
    if (!button.contains(spinner)) {
        spinner.classList.add("spinner")
        button.appendChild(spinner)
    } else {
        button.removeChild(spinner)
    }
}

function copyImageUrl() {
    const imageUrl = document.getElementById("articleCoverImage").src
    if (!imageUrl) {
        alert("Can't get the link address for the cover art!")
        return
    }

    navigator.clipboard.writeText(imageUrl).then(() => {
        alert(alertCVMSG)
        console.log("MP-VX-Insight ==> Image URL copied to clipboard: " + imageUrl)
    }).catch(err => {
        console.error("MP-VX-Insight ==> Failed to copy: ", err)
    })
}

function openImageUrl() {
    const imageUrl = document.getElementById("articleCoverImage").src
    if (!imageUrl) {
        alert("Can't get the link address for the cover art!")
        return
    }

    window.open(imageUrl)
}

function downloadCoverImage() {
    const imageUrl = document.getElementById("articleCoverImage").src
    if (!imageUrl) {
        alert("Can't get the link address for the cover art!")
        return
    }

    const downloadCoverImageBtn = document.getElementById("downloadCoverImage")
    toggleLoading(downloadCoverImageBtn)

    fetch(imageUrl)
        .then(response => response.blob())
        .then(blob => {
            const blobUrl = window.URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = blobUrl
            a.download = "cover_image.png"
            document.body.appendChild(a)
            a.click()
            // 下载完成后，从文档中移除创建的链接元素
            document.body.removeChild(a)
            // 释放之前通过 createObjectURL 创建的 URL 关联的 Blob 对象所占用的内存
            window.URL.revokeObjectURL(blobUrl)
        })
        .catch(err => console.error("MP-VX-Insight ==> downloadCoverImage Error: ", err))

    toggleLoading(downloadCoverImageBtn)
}

function copyArticleHistoryUrl() {
    const articleUrl = document.getElementById("articleUrlContent").textContent
    if (!articleUrl) {
        alert("Can't get the article url!")
        return
    }

    const params = getUriParams(articleUrl)
    // https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=MzIzMDE2MzA3NQ==
    const historyUrl = `https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=${encodeURIComponent(params.__biz)}`

    navigator.clipboard.writeText(historyUrl).then(() => {
        alert(alertCVMSG)
        console.log("MP-VX-Insight ==> VX Home URL copied to clipboard: " + historyUrl)
    }).catch(err => {
        console.error("MP-VX-Insight ==> Failed to copy: ", err)
    })
}

function noticeTitle() {
    const src = document.getElementById("articleCoverImage").src
    if (src.endsWith("icon128.png")) {
        alert("请刷新当前页面之后，再打开此插件！")
        return null
    }
    // initializeData()
}

function coverData(data) {
    const cover = document.getElementById("articleCoverImage")
    if (cover) cover.src = data.cover_image

    const title = document.getElementById("titleContent")
    if (title) title.textContent = data.title

    const author = document.getElementById("authorContent")
    if (author) author.textContent = data.author

    const desc = document.getElementById("descriptionContent")
    if (desc) desc.textContent = data.description

    const url = document.getElementById("articleUrlContent")
    if (url) url.textContent = data.url
}

async function pickArticleContent() {
    const articleUrl = document.getElementById("articleUrlContent").textContent
    if (!articleUrl) {
        alert("Can't get the article url!")
        return
    }
    const pickArticleContentBtn = document.getElementById("pickArticleContent")
    toggleLoading(pickArticleContentBtn)

    const url = "https://r.jina.ai/" + articleUrl
    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            }
        })

        if (!response.ok) {
            alert("Network response was not ok")
            return
        }
        const text = await response.text()
        if (!text) {
            alert("No text to copy")
            return
        }
        await navigator.clipboard.writeText(text)
        alert(alertCVMSG)
    } catch (err) {
        console.error("MP-VX-Insight ==> Failed to copy: ", err)
        alert("采集出现错误：" + err.message || err)
    } finally {
        toggleLoading(pickArticleContentBtn)
    }

}

function registerButtonListener(btnID, func) {
    const el = document.getElementById(btnID)
    if (!el) {
        console.warn(`MP-VX-Insight ==> popup.js ==> button #${btnID} not found, skip binding`)
        return
    }
    el.addEventListener("click", () => {
        try {
            func()
        } catch (e) {
            console.error(`MP-VX-Insight ==> popup.js ==> handler error for #${btnID}:`, e)
            alert('操作失败：' + (e && e.message ? e.message : e))
        }
    })
}

// ==================== 标签页切换功能 ====================

function initTabSwitching() {
    const tabBtns = document.querySelectorAll('.tabBtn')
    const tabPanels = document.querySelectorAll('.tabPanel')

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab

            // 更新按钮状态
            tabBtns.forEach(b => b.classList.remove('active'))
            btn.classList.add('active')

            // 更新面板显示
            tabPanels.forEach(panel => {
                if (panel.id === tabName + 'Panel') {
                    panel.classList.add('active')
                } else {
                    panel.classList.remove('active')
                }
            })

            // 如果切换到历史面板，加载历史数据
            if (tabName === 'history') {
                loadSyncHistory()
            }
        })
    })
}

// ==================== 同步历史功能 ====================

function loadSyncHistory() {
    const historyList = document.getElementById('historyList')
    const statusEl = document.getElementById('historyStatus')

    if (!historyList) return

    statusEl.textContent = '加载中...'

    chrome.runtime.sendMessage({ action: 'getSyncHistory', limit: 50 }, (res) => {
        if (chrome.runtime.lastError) {
            console.error('MP-VX-Insight ==> getSyncHistory error:', chrome.runtime.lastError)
            statusEl.textContent = '加载失败'
            return
        }

        if (!res || !res.ok) {
            statusEl.textContent = '加载失败'
            return
        }

        const history = res.data || []
        renderSyncHistory(history)
        statusEl.textContent = `共 ${history.length} 条记录`
    })
}

function renderSyncHistory(history) {
    const historyList = document.getElementById('historyList')
    if (!historyList) return

    if (history.length === 0) {
        historyList.innerHTML = '<div class="emptyHint">暂无同步历史</div>'
        return
    }

    historyList.innerHTML = history.map(item => {
        const date = new Date(item.timestamp)
        const timeStr = date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        })

        return `
            <div class="historyItem">
                <div class="historyItemTitle">${escapeHtml(item.title || '无标题')}</div>
                <div class="historyItemMeta">
                    <span>🏫 ${escapeHtml(item.schoolName || '-')}</span>
                    <span>📂 ${escapeHtml(item.categoryName || '-')}</span>
                    <span class="historyItemTime">🕒 ${timeStr}</span>
                </div>
                <div class="historyItemActions">
                    <button class="historyDeleteBtn" data-ts="${Number(item.timestamp || 0)}" data-url="${escapeHtml(item.url || '')}">删除</button>
                </div>
            </div>
        `
    }).join('')

    // 事件委托：单条删除
    if (!historyList.__mpvx_bound_delete) {
        historyList.__mpvx_bound_delete = true
        historyList.addEventListener('click', (e) => {
            const btn = e.target && e.target.closest ? e.target.closest('.historyDeleteBtn') : null
            if (!btn) return

            const ts = Number(btn.dataset.ts || 0)
            const url = (btn.dataset.url || '').toString()
            if (!ts && !url) return

            if (!confirm('确定要删除这条同步历史吗？')) return

            chrome.runtime.sendMessage({ action: 'deleteSyncHistoryItem', timestamp: ts, url }, (res) => {
                if (chrome.runtime.lastError) {
                    alert('删除失败：' + chrome.runtime.lastError.message)
                    return
                }
                if (!res || !res.ok) {
                    alert('删除失败：' + ((res && res.error) ? res.error : '未知错误'))
                    return
                }
                loadSyncHistory()
            })
        })
    }
}

function escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
}

function refreshHistory() {
    loadSyncHistory()
}

function clearHistory() {
    if (!confirm('确定要清空同步历史记录吗？此操作不可恢复。')) {
        return
    }

    chrome.runtime.sendMessage({ action: 'clearSyncHistory' }, (res) => {
        if (chrome.runtime.lastError) {
            alert('清空失败：' + chrome.runtime.lastError.message)
            return
        }
        if (!res || !res.ok) {
            alert('清空失败：' + ((res && res.error) ? res.error : '未知错误'))
            return
        }
        loadSyncHistory()
        alert('同步历史已清空')
    })
}

function updateCopyrightYear() {
    const currentYear = new Date().getFullYear();
    document.getElementById("copyright").innerHTML =
        `&copy; ${currentYear} <a href="https://github.com/randsong-ai/mp-vx-insight" target="_blank">@GitHub</a>`;
}

function normalizeApiUrl(v) {
    const s = (v || '').trim()
    if (!s) return ''
    try {
        // 允许 http/https
        const u = new URL(s)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
        return u.toString()
    } catch (e) {
        return ''
    }
}

function loadApiUrl() {
    chrome.storage.local.get({ [STORAGE_KEYS.apiUrl]: '' }, (items) => {
        const apiUrlInput = document.getElementById('apiUrlInput')
        if (!apiUrlInput) return
        apiUrlInput.value = items[STORAGE_KEYS.apiUrl] || ''
    })
}

function saveApiUrl() {
    const apiUrlInput = document.getElementById('apiUrlInput')
    if (!apiUrlInput) return

    const apiUrl = normalizeApiUrl(apiUrlInput.value)
    if (!apiUrl) {
        alert('请输入有效的 API 地址（必须为 http/https）')
        return
    }

    chrome.storage.local.set({ [STORAGE_KEYS.apiUrl]: apiUrl }, () => {
        alert('已保存 API 地址')
    })
}

function initializeData() {
    chrome.tabs.query({
        active: true,
        currentWindow: true
    }, (tabs) => {

        if (tabs.length > 0) {
            const currentUrl = tabs[0].url
            // 允许在任意页面打开弹窗做配置（学校/栏目、同步 API 等）
            // 只有在 mp.weixin.qq.com 页面才尝试抓取文章信息
            let currentDomain = ''
            try {
                const parsedUrl = new URL(currentUrl)
                currentDomain = parsedUrl.hostname
            } catch (e) {
                // 例如 chrome:// 页面
                currentDomain = ''
            }
            if ("mp.weixin.qq.com" !== currentDomain) {
                console.log('MP-VX-Insight ==> popup.js ==> not on mp.weixin.qq.com, skip initData')
                return null
            }

            const req = {
                type: "popup2content",
                action: "initData",
                info: "初始化 popup.html 页面数据"
            }
            chrome.tabs.sendMessage(tabs[0].id, req, res => {
                console.log("MP-VX-Insight ==> popup2content then res -> ", res)
            })
        }

    })
}

document.addEventListener("DOMContentLoaded", async () => {
    console.log("MP-VX-Insight ==> Start!")

    // registerButtonListener("copyImageUrl", copyImageUrl)
    // registerButtonListener("copyArticleHistoryUrl", copyArticleHistoryUrl)
    // registerButtonListener("openImageUrl", openImageUrl)
    // registerButtonListener("downloadCoverImage", downloadCoverImage)
    // registerButtonListener("noticeTitle", noticeTitle)
    // registerButtonListener("pickArticleContent", pickArticleContent)
    registerButtonListener("saveApiUrl", saveApiUrl)
    registerButtonListener("refreshSchools", () => loadSchoolAndCategoryUI())
    registerButtonListener("refreshHistory", refreshHistory)
    registerButtonListener("clearHistory", clearHistory)

    updateCopyrightYear()
    loadApiUrl()

    // 先加载学校/栏目数据（无论授权状态如何都需要加载）
    await loadSchoolAndCategoryUI()

    initializeData()
    initTabSwitching()

    // 白名单校验：未授权则隐藏配置区
    enforceMpAccountAuthorization().catch((e) => {
        console.warn('MP-VX-Insight ==> enforceMpAccountAuthorization error:', e)
        setMpAccountUI({ nickname: '', authorized: false, tip: '（检测失败）' })
    })
})


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("MP-VX-Insight ==> popup.js ==> receive from content2popup msg -> ", message)

    if ("afterFetchData" === message.action) {
        coverData(message.params)
    }

    sendResponse("MP-VX-Insight ==> popup.js 收到来自 content.js 的消息")
})