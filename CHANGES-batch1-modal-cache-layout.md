# 第一批优化：弹窗滚动 bug + 静态资源缓存 + 全站布局固定 + 持久导航栏

来源：从 `php-issue-hub-完整优化记录.md`（同源姊妹项目的踩坑记录）里核实过、
在 pkr 项目中确认存在同样代码模式后移植过来的修复，外加根据用户提供的
php-issue-hub 生产截图核实/新增的两项（第 4、5 节）。均已用 Playwright
做过真实渲染验证（非肉眼截图），细节见下面每一节。

---

## 1. 弹窗"顶部滚不到"的滚动陷阱

**文件**：`public/assets/style.css` — `.edit-modal-backdrop`

**问题**：`align-items: center` 配合 `overflow-y: auto` 是一个经典 CSS 陷阱——
当弹窗内容比视口高时，浏览器把溢出部分"上下对称"地居中裁切，但滚动条只够
到下方溢出的部分，上方溢出的内容无论怎么往上滚都够不到。

**修复**：
```diff
 .edit-modal-backdrop {
   display: flex;
-  align-items: center; justify-content: center;
+  align-items: flex-start; justify-content: center;
   overflow-y: auto;
-  padding: 24px 12px;
+  padding: 40px 12px;
 }
```

**验证**：Playwright 打开弹窗、注入 1400px 高内容、`scrollTop=0`：
修复前 `top = -329.68px`（够不到），修复后 `top = 97px`（完全可见）。

---

## 2. 静态资源缓存策略

**文件**：`public/_headers`、新增 `update-asset-versions.js`

```diff
 /assets/*
-  Cache-Control: no-cache, no-store, must-revalidate
+  Cache-Control: public, max-age=31536000, immutable
```

配合新增的零依赖 Node 脚本 `update-asset-versions.js`：每次改完
`public/assets/*.js`/`*.css` 后跑一次 `node update-asset-versions.js`，
自动给每个文件算内容哈希并更新所有 HTML 里的 `?v=<hash>`。幂等，内容没变
不会重复改动。

⚠️ **以后每次改 `assets/` 下的 `.js`/`.css`，提交前必须重新跑一次这个脚本**，
否则线上浏览器会继续用缓存了一年的旧版本。

---

## 3. 首页布局固定（"固定视口，内部区域各自独立滚动"）

**文件**：`public/index.html`、`public/assets/style.css`

`<body>` 加 `class="hub-page"`，把 `.brand-row`/`#announcementBanner` 从
"跟侧边栏平级、撑满全宽"挪进新增的 `.hub-right-col`，只对齐主内容区宽度：

```css
html:has(body.hub-page), body.hub-page {
  height: 100%; overflow: hidden; display: flex; flex-direction: column;
}
body.hub-page .topbar { flex-shrink: 0; }
.hub-layout { display: flex; flex: 1; min-height: 0; }
.hub-right-col { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.hub-right-col > .brand-row,
.hub-right-col > #announcementBanner { flex-shrink: 0; }
.hub-main { flex: 1; min-height: 0; overflow-y: auto; }
```

**验证**（Playwright `bounding_box()`）：

| | 修复前 | 修复后 |
|---|---|---|
| `body` 的 `overflow` | `visible` | `hidden` |
| `.hub-main` 的 `overflow-y` | `visible` | `auto` |
| `.sidebar` 的 `y` 坐标 | `86`（被挤下去了） | `57`（紧贴 Topbar） |
| `.brand-row` 的 `x` | `0`，全宽压住侧边栏 | `290`，只对齐主内容区 |

---

## 4. threads.html / announcements.html 同款横幅压侧边栏 bug

同样的全宽横幅问题也出现在 `threads.html`、`announcements.html`——
`#announcementBanner` 是 `.threads-shell` 外面的全宽兄弟节点，会盖住侧边栏。
挪进新增的 `.threads-right-col`：

```css
.threads-right-col { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.threads-right-col > #announcementBanner,
.threads-right-col > .threads-topline { flex-shrink: 0; }
```

**验证**：`threads.html` 横幅 `x=300` 正好对齐侧边栏右边缘；
`announcements.html` 横幅 `x=280` 同样精确对齐。

`promo.html`/`deposit-issue.html`/`deposit-backup.html` 当时确认过没有
侧边栏，不受影响——但见下一节，这轮之后它们也有侧边栏了。

---

## 5. 所有子页面加上固定的 "Issue Submission" 导航栏，删除 "Back to Home"

用户发了 php-issue-hub 的 Daily Report（表单页）截图，确认连**没有侧边栏
的页面**（表单、Promo、Deposit 系列）也要有这个持久导航栏。范围最终确定为
**全部 6 个子页面**：`form.html`、`threads.html`、`announcements.html`、
`promo.html`、`deposit-issue.html`、`deposit-backup.html`。

### 新增 `public/assets/hub-nav.js`（共享组件）

渲染跟 `index.html` 一样的 "ISSUE SUBMISSION" 导航栏内容（Home + 各模块
链接 + Account Management 分组），供上述 6 个页面挂载：
```js
window.HubNav.mount("hubNavMount", { activeModule: "qa" }); // 高亮当前模块
```
权限过滤逻辑（`accountCanSeeAdminSection` 等）是从 `index.html` 里镜像
过来的一份独立实现——**没有改动 index.html 自己原有的侧边栏代码**，
两边各自独立跑，不会互相影响。

### 两种页面结构改法

- **原本没有侧边栏的页面**（`form.html`/`promo.html`/`deposit-issue.html`/
  `deposit-backup.html`）：新增 `.subpage-shell` 两栏结构（导航栏 + 右侧
  内容列），配套 `body.subpage-fixed` 固定视口 CSS（复用首页那套模式）：
  ```css
  html:has(body.subpage-fixed), body.subpage-fixed {
    height: 100%; overflow: hidden; display: flex; flex-direction: column;
  }
  body.subpage-fixed .topbar { flex-shrink: 0; }
  .subpage-shell { display: flex; flex: 1; min-height: 0; }
  .subpage-right-col { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .subpage-right-col > #announcementBanner { flex-shrink: 0; }
  .subpage-main { flex: 1; min-height: 0; overflow-y: auto; }
  ```
- **本来就有自己侧边栏的页面**（`threads.html`/`announcements.html`）：
  在原有的工单列表/公告列表侧边栏**左边**再插一栏导航，变成三栏：
  `.threads-shell` 现在是 `<aside class="sidebar" id="hubNavMount">` +
  原有的 `.threads-sidebar` + `.threads-right-col`。

所有页面统一删除了 `.back-pill`（"← Back to Home"）——导航栏第一项
"Home" 就是回首页的入口。

### Account Management 怎么处理的（关键设计决定）

Account Management 弹窗那一整套逻辑（创建账号、Whitelist IP、TG 路由等
好几个 tab 的实际渲染代码）**只存在于 `index.html` 里**，直接复制到 6 个
页面风险太高、维护成本也太大。改成这样：

1. 子页面导航栏里点 Account Management 的任意子项（比如 "Whitelist IP"）
   → 跳转到 `/?admin=whitelist`
2. `index.html` 末尾新增几行代码，页面加载时读这个 `?admin=` 参数，
   做权限校验后自动调用已有的 `openAcctModal("whitelist")`，然后把 URL
   清理回 `/`（不留查询参数）

功能上完全等价，但避免了维护两份重复的弹窗代码。

### 踩到的一个真实 bug，顺手改了

给 `deposit-issue.html`/`deposit-backup.html` 加上 `schemas.js`（导航栏
渲染模块列表需要它）之后，两个页面**打不开了**——浏览器报
`Identifier 'BRANDS' has already been declared`。原因：这两个页面自己
内联脚本里本来就有 `var BRANDS = [...]`（它们自己那 9 个品牌的本地列表），
跟 `schemas.js` 里全局的 `const BRANDS` 撞名了——`const`/`let` 声明的
标识符和后面任何 `var` 重复声明都会直接报语法错误（不是运行时警告），
整个脚本直接不执行，页面白屏。改法：把这两个文件里的本地变量重命名成
`DEP_BRANDS`，两处引用一起改，不影响其他任何逻辑。

### 验证方法

Playwright 跑了全部 6 个页面，确认：
- `#hubNavMount` 挂载成功，渲染出 9 个导航项（Home + 8 个模块）
- `.back-pill` 在所有页面都不存在了
- 当前模块在导航栏里正确高亮（例如打开 `form.html?module=qa` 时 "QA" 项
  有高亮样式）
- Account Management 深链完整走通：从子页面点 "Whitelist IP" → 跳转到
  `/?admin=whitelist` → `index.html` 自动弹出 "Whitelist IP" 弹窗 →
  URL 清理回 `/`

---

## 还没动的部分（讨论过、故意先不做）

- **IP Access 审批面板**：pkr 目前完全没有这个功能，需要新开发，放在这批
  之后单独做。
- **`accounts-admin.html` 与首页侧边栏弹窗的重复入口**：需要先确认两边
  接口是否真的完全重复，再决定要不要合并/删除，这次没动。
- **SPA 壳模式**（`spa-shell-pattern-guide.md`）：架构改动面覆盖全部
  子页面，建议等这批修复上线跑稳之后再单独立项。
