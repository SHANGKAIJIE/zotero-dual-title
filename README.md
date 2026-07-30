# Dual Title

在 Zotero 条目列表中将翻译标题显示为第二行，无需额外列。

![Zotero 7+](https://img.shields.io/badge/Zotero-7%2F8%2F9-green)
![License](https://img.shields.io/badge/License-AGPL--3.0-blue)
![Version](https://img.shields.io/badge/Version-0.1.7-blue)

<img width="905" height="395" alt="image" src="https://github.com/user-attachments/assets/44025aec-47e4-4632-81c2-6488e7a883c0" />

---

## 功能

- **双行标题显示**：在条目列表的标题列下方自动显示翻译标题，无需额外列
- **PDF Translate 集成**：通过 [Zotero PDF Translate](https://github.com/windingwind/zotero-pdf-translate) 自动翻译条目标题
- **标题内容**：支持四种显示模式：
  - 原标题 ＋ 翻译标题（默认）
  - 原标题 ＋ 简记
  - 仅原标题
  - 仅翻译标题
- **标题顺序**：双行模式下可切换行序（原标题在上 / 副标题在上）
- **副标题字重**：支持常规和加粗两种字重
- **简记兼容**：支持从 extra 字段 `remark` 键读取简记内容，与翻译标题使用相同的字号/颜色设置
- **条目行高调整**：可调节双行显示时的行高倍率（支持小数）
- **下属条目行高**：独立控制附件、笔记等下属条目的行高（跟随主条目 / 保持不变）
- **翻译颜色自定义**：自由选择翻译标题的文字颜色，支持恢复默认
- **zotero-style 兼容**：与 [zotero-style](https://github.com/MuiseDestiny/zotero-style) 的标签小圆点、列图标等特性兼容
- **新条目自动翻译**：添加新条目时自动翻译非中文标题
- **翻译管理**：翻译结果存储在条目的 extra 字段中，支持 `titleTranslation` 和 `dualRowTranslation` 两种 key

## 安装

### 从 Release 安装

1. 下载最新版本的 `dual-title.xpi`
2. 打开 Zotero → 工具 → 附加组件
3. 将 xpi 文件拖拽到附加组件窗口
4. 重启 Zotero

### 从源码构建

```bash
git clone https://github.com/username/zotero-dual-title.git
cd zotero-dual-title
npm install
npm run build
```

构建产物位于 `.scaffold/build/dual-title.xpi`。

### 依赖

- **Zotero 7 / 8 / 9** (基于 Firefox ESR 115 / 128 / 140)
- **[Zotero PDF Translate](https://github.com/windingwind/zotero-pdf-translate) 2.x+**（推荐，用于自动翻译标题）

## 配置

打开 Zotero → 编辑 → 设置 → Dual Title：

| 选项 | 默认值 | 说明 |
|------|--------|------|
| 启用双行标题显示 | 启用 | 插件总开关 |
| 标题内容 | 原标题 ＋ 翻译标题 | 四种显示模式（含简记） |
| 标题顺序 | 原标题在上，副标题在下 | 双行模式下的行序（仅双行模式生效） |
| 标题间距 | 2px | 原标题行与副标题行之间的间距 |
| 副标题字号 | 12px | 副标题（翻译或简记）的字体大小 |
| 副标题颜色 | — | 副标题的文字颜色（拾色器选择，可恢复默认） |
| 副标题字重 | 常规 | 副标题字重（常规 / 加粗） |
| 主条目行高 | 2 倍 | 有翻译的主条目行高倍率（支持小数） |
| 下属条目行高 | 保持不变 | 附件、笔记等下属条目的行高策略（跟随主条目 / 保持不变） |
| 新条目自动翻译 | 启用 | 添加新条目时自动翻译非中文标题 |

> **下属条目行高说明：**
> - **跟随主条目改变**：下属条目与主条目使用相同的行高倍率
> - **保持不变**：下属条目保持 1 倍原始行高，不受主条目行高影响

## 技术架构

### 核心机制

插件通过**包装（monkey-patch）** Zotero 条目列表 VirtualizedTable 的 `_renderItem` 方法，在标题单元格渲染完成后注入翻译行。

```
VirtualizedTable._renderItem (patched)
  ├── 原始 VirtualizedTable._renderItem
  │   ├── itemsView._renderItem (Zotero 原生)
  │   │   └── 行 div（含原标题、图标等）
  │   └── 行高设置 / 事件绑定
  └── injectTranslation(node, item)  ← 我们的注入点
      ├── 构建 firstLine 容器
      ├── 将 indent/twisty/icon/cell-text 移入 firstLine
      └── 追加翻译行 transSpan
```

渲染后的 DOM 结构：

```
条目 Cell（flex column）
├── .dual-row-first-line（flex row）
│   ├── .cell-indent             ← 层级缩进
│   ├── .twisty                  ← 展开/折叠按钮
│   ├── .cell-icon               ← 条目类型图标
│   ├── .colored-tag-swatches    ← zotero-style 标签小圆点
│   └── .cell-text               ← 原标题文字
└── .dual-row-translation        ← 翻译标题文字
```

### 下属条目行高

使用 VirtualizedTable 原生 API `updateCustomRowHeights()` 实现变高行支持，无需 CSS hack：

- **跟随模式**：清空自定义行高，所有行使用统一的 `_rowHeight`
- **保持模式**：为非主条目行设置 `[index, _originalRowHeight]` 自定义高度

### 翻译与简记存储

翻译结果和简记保存在条目的 **extra 字段**中：

```
extra:
  dualRowTranslation: 翻译后的标题
  remark: 用户添加的简记内容
```

同时兼容 PDF Translate 的 `titleTranslation` 格式（优先读取 `dualRowTranslation`）。

### 补充说明

- **简记（remark）**：使用 `原标题+简记` 模式时，副标题内容从 extra 字段的 `remark` 键读取。
  字号、颜色、间距、字重等设置与翻译标题共用同一组偏好。
- **显示模式与行序**：核心逻辑由 `injectTranslation()` 函数统一处理。`displayMode` 决定标题内容（4 选 1），`titleOrder` 决定双行模式下的行序（2 选 1）。`secondLineContent` 动态决定副标题是翻译还是简记，`secondLineFirst` 控制 `.translation-first` CSS 类切换。
- **兼容性**：v0.1.6 之前的 `翻译标题 ＋ 原标题` 与 `简记 ＋ 原标题` 配置在 v0.1.7 启动时自动迁移为 `原标题 ＋ 翻译标题/简记` + `副标题在上`。

### 依赖关系

- **PDF Translate API**：通过 `Zotero.PDFTranslate.api.translate(text, { pluginID, itemID })` 调用翻译
- **Zotero Prefs**：通过 `extensions.zotero.dualtitle.*` 偏好键存储设置
- **zotero-style**：通过 ztoolkit 的 `addRenderCellHook` 机制兼容，无需额外配置

## 开发

### 项目结构

```
src/
├── index.ts                    # 入口
├── hooks.ts                    # 生命周期钩子（startup/shutdown/notify）
├── modules/
│   ├── itemTreePatch.ts        # 核心：VirtualizedTable._renderItem 包装 + 翻译注入
│   ├── menu.ts                 # 右键菜单注册
│   └── translate.ts            # 翻译管理（PDF Translate API 调用）
└── utils/
    ├── locale.ts               # 本地化
    └── prefs.ts                # 偏好读写
addon/
├── bootstrap.js                # Zotero 引导脚本
├── manifest.json               # 插件清单
├── prefs.js                    # 默认偏好值
├── content/
│   ├── preferences.xhtml       # 偏好面板 UI
│   └── zoteroPane.css          # 条目列样式
├── locale/                     # 本地化文件（zh-CN / en-US）
└── icons/                      # 插件图标
```

### 构建

使用 `zotero-plugin-scaffold` 构建：

```bash
npm run build    # 生产构建
npm run start    # 开发模式（自动重载）
```

## 许可

AGPL-3.0-or-later
