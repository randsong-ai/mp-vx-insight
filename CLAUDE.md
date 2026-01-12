# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 提供在此代码库中工作的指导。

## 项目概述

`mp-vx-insight` 是一个针对微信公众号 (mp.weixin.qq.com) 的 Chrome 扩展程序（Manifest V3）。主要功能包括：
- **内容提取**：提取文章元数据（标题、作者、封面图、简介、阅读量、发布时间）
- **一键同步**：通过"同步到网站"按钮将文章同步到外部 API
- **学校/栏目管理**：配置内容同步的目标学校和栏目
- **公众号授权**：基于白名单的特定公众号访问控制

## 开发环境配置

### 加载扩展程序

1. 打开 Chrome 浏览器，访问 `chrome://extensions`
2. 启用"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择项目目录

**重要**：加载完成后，使用扩展前需先刷新微信公众号页面。

### 测试修改

修改扩展文件后：
1. 访问 `chrome://extensions`
2. 点击扩展卡片上的刷新图标
3. 刷新受影响的微信公众号页面

## 架构设计

### 扩展程序结构

```
mp-vx-insight/
├── manifest.json          # MV3 配置文件
├── background.js          # Service worker（无 DOM 访问权限）
├── content.js             # 注入到 mp.weixin.qq.com 页面
├── popup.html/js/css      # 扩展弹窗 UI
├── _locales/              # 国际化消息（zh_CN, en）
└── icon128.png            # 扩展图标
```

### 组件职责

#### background.js (Service Worker)
- **公众号授权**：白名单验证 (`ALLOWED_MP_ACCOUNTS`)
- **存储管理**：API 地址、学校/栏目选择、公众号昵称
- **API 代理**：从 `http://api.test.com.cn/weixin/school` 获取学校列表
- **文章同步**：POST 到配置的同步 API
- **隐藏标签页提取**：在后台标签页中打开文章链接抓取数据

#### content.js (Content Script)
- **DOM 注入**：在页面上添加"同步到网站"按钮
- **数据提取**：从页面 DOM 中抓取文章元数据
- **公众号昵称检测**：上报当前登录的公众号
- **MutationObserver**：动态处理页面导航/更新

目标页面：
- `/cgi-bin/appmsgpublish?sub=list` - 文章列表页（每行添加按钮）
- `/mp/profile_ext` - 历史文章页（每个链接添加按钮）
- `/s` 或 `/s/` - 文章详情页（添加单个同步按钮）

#### popup.js (扩展 UI)
- **授权检查**：显示当前公众号和授权状态
- **学校/栏目选择**：从学校 API 填充下拉菜单
- **API 配置**：输入并保存同步 API 地址
- **数据获取**：与 content.js 通信以提取文章数据

### 消息传递流程

```
popup.js <---> content.js <---> background.js
                         |
                         v
                    外部 API
                    (schools, sync)
```

主要消息动作：
- `updateMpAccountNickname` - 更新缓存的公众号昵称
- `getMpAccountStatus` - 检查当前公众号是否已授权
- `fetchSchools` - 从 API 获取学校列表
- `syncArticle` - 使用提取的数据包同步
- `syncByUrl` - 通过 URL 同步（后台打开标签页并提取）
- `getAccountInfo` - 弹窗向 content script 请求公众号昵称

### 存储键

所有数据存储在 `chrome.storage.local`：
- `apiUrl` - 同步 API 端点 URL
- `schoolId` / `schoolName` - 选中的学校
- `categoryId` / `categoryName` - 选中的栏目
- `mpAccountNickname` - 上次检测到的公众号昵称

### 授权流程

1. Content script 从侧边栏检测公众号昵称 (`.acount_box-nickname`)
2. Background 对照 `ALLOWED_MP_ACCOUNTS` 白名单验证
3. 未授权时弹窗隐藏配置区域
4. 所有同步操作对未授权账号进行拦截

修改 `background.js:41-44` 中的 `ALLOWED_MP_ACCOUNTS` 可更改白名单。

## 关键实现细节

### 数据提取选择器（微信公众号 DOM）

Content script 目标：
- 标题：`#activity-name` 或 `meta[property="og:title"]`
- 作者：`#js_name` 或 `meta[property="og:article:author"]`
- 链接：`meta[property="og:url"]` 或 `location.href`
- 封面：`meta[property="og:image"]`
- 阅读量：`#readNum3`（异步渲染，最多等待 5 秒）
- 发布时间：`#publish_time`

公众号昵称：`#js_mp_sidemenu span.acount_box-nickname`（注意：微信的 class 名有拼写错误）

### 学校 API 响应格式

期望从 `http://api.test.com.cn/weixin/school` 获取：

```javascript
// 直接数组：
[{ id, name: "title", list: [{ id, name: "栏目名称" }] }]

// 或包裹格式：
{ code: 1, data: [...] }
```

字段规范化：`title` → `name`，`category_id` → `id`

### 隐藏标签页提取

对于 `syncByUrl` 动作：
1. 在新标签页打开 URL (`active: false`)
2. 等待页面加载（15 秒超时）
3. 执行脚本提取数据
4. 关闭标签页
5. 返回提取的数据

当源页面上无法获取阅读量时使用此方法。

### 按钮注入防护

Content script 使用标记属性避免重复添加按钮：
- `data-mpvx-sync-added` - 链接级别
- `data-mpvx-sync-row-added` - 行级别（列表页）

## 重要约束

- **MV3 service worker 中不支持 XMLHttpRequest** - 使用 `fetch`
- **CORS**：外部 API 必须允许 `chrome-extension://` 源
- **公众号域名**：Content script 仅在 `*://mp.weixin.qq.com/*` 上运行
- **阅读量时机**：可能延迟；后台提取会处理此情况
- **类名拼写错误**：微信使用 `acount_box-nickname`（缺少 'c'）

## 外部依赖

- `http://api.test.com.cn/weixin/school` - 学校列表 API（硬编码在 `background.js:70`）
- 可配置的同步 API 地址（用户在弹窗中设置）

无构建系统或包管理器 - 纯 JS/HTML/CSS 扩展。
