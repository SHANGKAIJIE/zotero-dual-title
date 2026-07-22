# Dual Title

在 Zotero 条目列表中将翻译标题显示为第二行，无需额外列。

![Screenshot](https://img.shields.io/badge/Zotero-7%2F8%2F9-green)
![License](https://img.shields.io/badge/License-AGPL--3.0-blue)

## 功能

- **双行标题显示**：在条目列表的标题列下方自动显示翻译标题，无需额外列
- **PDF Translate 集成**：通过 [Zotero PDF Translate](https://github.com/windingwind/zotero-pdf-translate) 自动翻译条目标题
- **显示模式**：支持四种显示模式：
  - 原标题 ＋ 翻译标题（默认）
  - 翻译标题 ＋ 原标题
  - 仅原标题
  - 仅翻译标题
- **条目行高调整**：可调节双行显示时的行高倍率
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
| 标题内容 | 原标题 ＋ 翻译标题 | 四种显示模式 |
| 翻译字号 | 12px | 翻译标题的字体大小 |
| 标题间距 | 2px | 原标题行与翻译行之间的间距 |
| 条目行高 | 2 倍 | 双行显示时的行高倍率（支持小数） |
| 新条目自动翻译 | 启用 | 添加新条目时自动翻译非中文标题 |

## 技术架构

### 核心机制

插件通过**包装（monkey-patch）** Zotero 条目列表的 `_renderItem` 方法，在标题单元格渲染完成后注入翻译行。

```
条目 Cell（flex column）
├── .dual-row-first-line（flex row）
│   ├── .cell-indent       ← 层级缩进
│   ├── .twisty            ← 展开/折叠按钮
│   ├── .cell-icon         ← 条目类型图标
│   └── .cell-text         ← 原标题文字
└── .dual-row-translation  ← 翻译标题文字（左对齐）
```

### 翻译存储

翻译结果保存在条目的 **extra 字段**中，key 为 `dualRowTranslation`：

```
extra:
  dualRowTranslation: 翻译后的标题
```

同时兼容 PDF Translate 的 `titleTranslation` 格式。

### 依赖关系

- **PDF Translate API**：通过 `Zotero.PDFTranslate.api.translate(text, { pluginID, itemID })` 调用翻译
- **Zotero Prefs**：通过 `extensions.zotero.dualtitle.*` 偏好键存储设置
- **Zotero MenuManager**：右键菜单注册（目前禁用，排查兼容性问题）

## 开发

### 项目结构

```
src/
├── index.ts                    # 入口
├── hooks.ts                    # 生命周期钩子（startup/shutdown/notify）
├── modules/
│   ├── itemTreePatch.ts        # 核心：_renderItem 包装 + 翻译注入
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
