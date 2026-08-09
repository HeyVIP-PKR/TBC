# 第二批优化：index.html 变成常驻 SPA 壳

解决的问题：点击 "TG Reply Threads" 等工具卡片时，整个页面会真的重新加载
（Topbar/侧边栏跟着一起消失重来），用户反馈"感觉像跳转到了另一个页面"、
"logo 会闪一下不见"——根因是这个项目一直是纯多页应用（每个页面是独立
static HTML 文件），不是 SPA。这次把 `index.html` 改造成常驻壳，参考
`spa-shell-pattern-guide.md` 的模式落地。

---

## 核心改动

**新增 `public/assets/spa-shell.js`**（只在 `index.html` 里加载）：

点击任何 `[data-route]` 元素时，不再是真实的 `<a href>` 跳转，而是：
1. `fetch()` 目标页面的完整 HTML
2. 用 `DOMParser` 解析，只挑出该页面**独有**的内容节点（比如
   `threads.html` 的 `.threads-sidebar` + `.threads-right-col`，
   `form.html` 的 `.subpage-right-col`）——**不**包含它们自己的
   Topbar/导航栏（那些是每个子页面独立访问时才需要的，SPA 模式下复用
   壳自己的）
3. 挂进 `#spaMount`，`new Function()` 重新执行该页面自己的 `<script>`
   （包括 `/assets/app.js` 这种外部但页面专属的脚本）

```js
const ROUTES = {
  threads: { url: "/threads.html", select: ["#attachLightbox", ".threads-sidebar", ".threads-right-col"] },
  announcements: { url: "/announcements.html", select: [".threads-sidebar", ".threads-right-col"] },
  promo: { url: "/promo.html", select: [".subpage-right-col"] },
  deposit_issue: { url: "/deposit-issue.html", select: ["#imgLightbox", ".subpage-right-col"] },
  deposit_backup: { url: "/deposit-backup.html", select: ["#imgLightbox", ".subpage-right-col"] },
  form: { url: "/form.html", select: [".subpage-right-col"] },
};
```

**URL 规则**（照抄 spa-shell-pattern-guide.md 踩过的坑）：`pushState`
永远只改 `/` 这个壳自己的路径 + query string（`/?view=threads`、
`/?view=form&module=qa`），绝不指向某个子页面的真实文件路径——这样
**刷新页面永远还是加载这个壳**，不会掉回一个没有壳的独立页面。壳的
`DOMContentLoaded` 里会读这个 `?view=` 自动恢复对应视图。

**index.html 自身的改动**：
- `.hub-layout` 里原本的 `.hub-right-col`（首页内容）加了 `id="viewHome"`
- 新增一个 `id="spaMount"`，平时 `display:none`，切视图时和 `viewHome`
  互相切换显示/隐藏
- 侧边栏的 Home 链接、5 张工具卡片（TG Reply Threads / Promo / Deposit
  Issue / Deposit Backup / Announcement）都加上了 `data-route`
- 动态生成的模块链接（QA / Account Issue / … 那一串）从"点击后延迟
  200ms 再整页跳转"改成 `data-route="form" data-module="<id>"`，交给
  `spa-shell.js` 的统一点击拦截处理
- 所有这些元素的 `href` **依然保留**（依然是真实可用的链接，只是普通
  左键点击会被拦截走 SPA 路径；Ctrl/Cmd+点击、中键新开标签、右键复制
  链接都还是原生浏览器行为，不受影响）

---

## 过程中修的两个真实 bug

### 1. `initThemeToggle()` / `initClock()` 重复绑定监听器

每个子页面自己的 `<script>` 里都会调用 `window.initThemeToggle()`。
以前每个页面只加载一次，天然没事；但 SPA 模式下同一个 Topbar 按钮/
时钟元素全程不销毁，反复切换视图 = 反复调用这两个函数 = **在同一个
按钮上越叠越多click监听器**。实测：连续切 3 次视图后点一次主题切换
按钮，因为叠加了偶数个监听器，点了跟没点一样（互相抵消）。

**修复**：给这两个函数加了"已经绑定过就不再绑第二次"的 guard
（`btn.dataset.wired` 标记），`assets/theme.js`：
```diff
   setLabel();
+  if (btn.dataset.wired) return;
+  btn.dataset.wired = "1";
   btn.addEventListener("click", () => { ... });
```
`initClock()` 同样处理。Playwright 验证：连续切 3 次视图后点一次主题
按钮，确认正确切换（不再抵消）。

### 2. 图片预览弹窗（lightbox）被裁到 Topbar 下面

`threads.html` 的 `#attachLightbox`、`deposit-issue.html`/
`deposit-backup.html` 的 `#imgLightbox` 都是 `position:fixed; inset:0`
的全屏浮层，挂进 SPA 壳之后一度量出来只有 `top:57`（卡在 Topbar 下面），
不是覆盖整个视口。

根因：`.hub-layout` 有一个 `page-slide-in` 入场动画 class，动画用
`animation-fill-mode: forwards`，结束后 `transform: translateX(0)`
永久留在元素上——即使数值上"没有位移"，**光是存在 `transform` 属性
就会让这个元素变成它内部所有 `position:fixed` 后代的新定位基准**，
而不是真正的浏览器视口。这个副作用以前从来没暴露过，因为 `.hub-layout`
内部从来没有任何 `fixed` 定位的元素——直到这次把两个 lightbox 挂进来。

**修复**：入场动画播完之后（350ms，比动画时长 0.28s 留一点余量）
自动把 `page-slide-in` 这个 class 摘掉，视觉上没有任何变化，只是不再
继续充当"定位容器"：
```js
const layout = document.querySelector(".hub-layout");
if (layout) setTimeout(() => layout.classList.remove("page-slide-in"), 350);
```
Playwright 验证：两个 lightbox 打开后量出来都是 `top:0, height:800`
（完整视口），不再被裁切。

---

## 验证方法（Playwright，全部通过）

- 在 `window` 上打一个标记，点击 TG Reply Threads → QA 表单 → 浏览器
  后退两次，标记全程存活 → 证明**从未发生真正的整页刷新**
- URL 正确变化：`/` → `/?view=threads` → `/?view=form&module=qa`，
  浏览器前进/后退按钮工作正常
- 强制刷新（F5）停留在 `?view=threads`，内容、侧边栏、logo 全部正确
  恢复（这正是用户最初反馈的"logo 消失/像跳转页面"的场景）
- 6 个路由挂载后经过短暂 loading 态都能正确渲染各自的独有内容
- 两个 lightbox 挂载后位置/尺寸正确（见上）
- 主题切换按钮在反复视图切换后依然正确工作（见上）
- 全程 0 条 JS 报错

---

## 已知的取舍/限制

- 只有**从壳内部点击**才会走 SPA 路径。直接在地址栏输入
  `/threads.html`、书签、外部链接打开某个子页面，依然是完全独立、
  完整可用的一次真实页面加载（这些子页面本身没有任何改动，
  `hub-nav.js` 那套独立导航栏还在，Account Management 的 `/?admin=`
  深链机制也还在）——SPA 只是"锦上添花"的体验优化，不是这些页面唯一
  能工作的方式，出问题可以直接把 `data-route` 属性删掉整体回滚，不
  影响任何页面独立可用。
- 每次切视图都会重新执行该页面的 `<script>`（包括重新 fetch 一次数据），
  不是"保留状态"式的 SPA——比如从工单详情切到别处再切回来，会重新
  拉取最新的工单列表，而不是恢复切走前的滚动位置/选中状态。这是有意
  的简化，换取更低的实现复杂度和更少的潜在 bug（详见 spa-shell.js 里
  关于 setInterval/事件监听器清理的注释）。
