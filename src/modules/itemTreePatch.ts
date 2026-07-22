/**
 * itemTreePatch.ts — Dual Title 核心补丁
 *
 * 实例级方法包装：
 * 1. 通过 Zotero.getMainWindow().ZoteroPane.itemsView 获取 ItemTree 实例
 * 2. 包装实例的 _renderItem 方法，在渲染后注入翻译 span
 * 3. 通过 itemsView.tree（VirtualizedTable 实例）修改行高
 *
 * 关键设计（v2 — CSS Grid 方案）：
 * - 不再使用 JS 移动元素到 dual-row-first-line span
 * - 改用 CSS Grid 在 .dual-row-primary 上布局：
 *   行1: cell-indent | twisty | cell-icon | cell-text
 *   行2: dual-row-translation（跨所有列）
 * - 这样无论 Zotero 在 _renderItem 之前还是之后添加 twisty/indent 都能正确布局
 * - 兼容旧版（twisty 在 _renderCell 中添加）和新版（twisty 在 _addIndentAndTwisty 中添加）
 */

import { getPref } from "../utils/prefs";

let _patched = false;
let _originalRenderItem: ((...args: any[]) => HTMLElement) | null = null;
let _originalRowHeight: number = 0;
let _itemsView: any = null;
let _patchRetryCount = 0;
const MAX_PATCH_RETRY = 30;

export function setDocument(_doc: Document) {}

export function patch() {
  if (_patched) return;
  tryPatch();
}

function tryPatch() {
  if (_patched) return;

  let itemsView: any = null;
  try {
    const win = Zotero.getMainWindow();
    itemsView = win?.ZoteroPane?.itemsView;
  } catch (e) {}

  if (!itemsView) {
    if (_patchRetryCount++ < MAX_PATCH_RETRY) {
      setTimeout(() => tryPatch(), 500);
    }
    return;
  }

  _itemsView = itemsView;

  _originalRenderItem = itemsView._renderItem;
  itemsView._renderItem = function(
    index: number, selection: any, oldDiv: HTMLElement | null, columns: any[],
  ) {
    const div = _originalRenderItem!.call(this, index, selection, oldDiv, columns);
    try {
      const row = this.getRow(index);
      if (row?.ref?.isRegularItem?.()) {
        injectTranslation(div, row.ref);
      } else if (div.classList.contains('dual-row-item')) {
        // 非常规条目（附件、注释等）且可能有残留类 → 清理
        const primaryCell = div.querySelector('.cell.primary') as HTMLElement;
        if (primaryCell) cleanupDualRowClasses(div, primaryCell);
      }
    } catch (e) {
      Zotero.log("[DualTitle] injectTranslation error: " + e);
    }
    return div;
  };

  setRowHeight();

  _patched = true;
  Zotero.log("[DualTitle] Patch applied");

  // 应用补丁后多次尝试强制重绘，覆盖树状结构未准备就绪的场景
  forceRerender();
  setTimeout(() => forceRerender(), 300);
  setTimeout(() => forceRerender(), 1500);
}

/**
 * 设置行高 — 根据行高倍率调整整行高度
 */
export function setRowHeight() {
  if (!_itemsView) return;
  try {
    const tree = _itemsView.tree;
    if (!tree) return;

    // 如果双行标题显示已禁用，不调整行高
    const enableDual = getPref('enableDualTitle') !== false;
    if (!enableDual) {
      // 恢复原始行高
      if (_originalRowHeight && _originalRowHeight > 10) {
        tree._rowHeight = _originalRowHeight;
        if (tree._jsWindow) {
          try {
            const opts = tree._getWindowedListOptions();
            opts.itemHeight = _originalRowHeight;
            tree._jsWindow.update(opts);
          } catch (e) {
            tree._jsWindow.update({ itemHeight: _originalRowHeight });
          }
          tree._jsWindow.invalidate();
        }
      }
      return;
    }

    if ((!_originalRowHeight || _originalRowHeight <= 10) && tree._rowHeight && tree._rowHeight > 10) {
      _originalRowHeight = tree._rowHeight;
      Zotero.log("[DualTitle] Captured originalRowHeight=" + _originalRowHeight);
    }
    if (_originalRowHeight && _originalRowHeight > 10) {
      let mult = parseFloat(String(getPref('rowHeightMultiplier') || '2'));
      if (isNaN(mult) || mult < 1 || mult > 5) mult = 2;
      const newHeight = Math.max(Math.round(_originalRowHeight * mult), _originalRowHeight);

      if (tree._rowHeight !== newHeight) {
        tree._rowHeight = newHeight;
        Zotero.log("[DualTitle] RowHeight: base=" + _originalRowHeight + " mult=" + mult + " result=" + tree._rowHeight);
        forceRerender();
      }
    } else {
      Zotero.log("[DualTitle] setRowHeight skipped: originalRowHeight=" + _originalRowHeight + " tree._rowHeight=" + tree._rowHeight);
    }
  } catch (e) {
    Zotero.log("[DualTitle] setRowHeight error: " + e);
  }
}

export function unpatch() {
  if (_itemsView && _originalRenderItem) {
    _itemsView._renderItem = _originalRenderItem;
    try {
      const tree = _itemsView.tree;
      if (tree && _originalRowHeight) {
        tree._rowHeight = _originalRowHeight;
        if (tree._jsWindow) {
          tree._jsWindow.update({ itemHeight: _originalRowHeight });
          tree._jsWindow.invalidate();
        }
      }
    } catch {}
  }
  _itemsView = null;
  _originalRenderItem = null;
  _patched = false;
  _patchRetryCount = 0;
  _originalRowHeight = 0;
}

export function refresh() {
  if (_itemsView) {
    // 方法1：调用 itemsView.refresh() 触发完整数据刷新 + 重绘
    try { _itemsView.refresh?.(); } catch {}
    // 方法2：直接强制重绘 WindowedList
    forceRerender();
  }
}

/**
 * 强制重绘条目列表中所有可见行
 * 在补丁应用后和偏好变更后调用，确保翻译行立即渲染
 */
function forceRerender() {
  if (!_itemsView) return;
  try {
    const tree = _itemsView.tree;
    if (!tree) return;
    Zotero.log("[DualTitle] forceRerender");
    // 同步 WindowedList 的行高
    if (tree._jsWindow && tree._rowHeight) {
      try {
        const opts = tree._getWindowedListOptions();
        opts.itemHeight = tree._rowHeight;
        tree._jsWindow.update(opts);
      } catch (e) {
        tree._jsWindow.update({ itemHeight: tree._rowHeight });
      }
    }
    // VirtualizedTable.invalidate()
    if (typeof tree.invalidate === 'function') {
      tree.invalidate();
    }
    // VirtualizedTable.rerender()
    if (typeof tree.rerender === 'function') {
      tree.rerender();
    }
    // 底层 WindowedList 直接渲染
    if (tree._jsWindow) {
      tree._jsWindow.invalidate();
      try { tree._jsWindow.render(); } catch (e) {}
    }
  } catch (e) {
    Zotero.log("[DualTitle] forceRerender error: " + e);
  }
}

/**
 * 清理双行标题相关的 CSS 类和 DOM 元素
 * 用于非常规条目（附件、注释等）或禁用双行标题时
 */
function cleanupDualRowClasses(div: HTMLElement, primaryCell: HTMLElement) {
  div.classList.remove('dual-row-item');
  primaryCell.classList.remove('dual-row-primary', 'has-translation', 'translation-first');
  const oldTrans = primaryCell.querySelector('.dual-row-translation');
  if (oldTrans) oldTrans.remove();
  // 恢复 cell-text 原标题
  const ct = primaryCell.querySelector('.cell-text') as HTMLElement | null;
  if (ct && ct.dataset.dualTitleOriginal) {
    ct.textContent = ct.dataset.dualTitleOriginal;
    delete ct.dataset.dualTitleOriginal;
  }
}

/**
 * 计算 cell-text 在 firstLine 容器中的左偏移量（像素）
 *
 * 不使用 getBoundingClientRect，因为：
 * 1. 元素在 _renderItem 中尚未挂载到 DOM，getBoundingClientRect 返回 0
 * 2. getBoundingClientRect 触发布局重算，_renderItem 对每个条目调用，性能很差
 *
 * 基于 Zotero 已知 CSS 宽度估算：
 * - cell-indent: paddingInlineStart（可变，按层级）
 * - .twisty: 16px + .icon{margin-inline-end:4px} = 20px
 * - .spacer-twisty: 空 span，无视觉宽度
 * - .cell-icon: min-width=16px + .icon{margin-inline-end:4px} = 20px
 * - .cell-text: margin-left=4px
 */
function calcCellTextOffset(firstLine: HTMLElement): number {
  let offset = 0;
  const indent = firstLine.querySelector(':scope > .cell-indent') as HTMLElement | null;
  if (indent) {
    const ps = indent.style.paddingInlineStart;
    offset += ps ? (parseFloat(ps) || 0) : 0;
  }
  // twisty: 16px + margin-inline-end 4px
  if (firstLine.querySelector(':scope > .twisty')) {
    offset += 20;
  }
  // spacer-twisty 无视觉宽度
  // cell-icon: min-width 16px + margin-inline-end 4px
  if (firstLine.querySelector(':scope > .cell-icon, :scope > .icon-item-type')) {
    offset += 20;
  }
  // cell-text: margin-left 4px
  offset += 4;
  return Math.round(offset);
}

/**
 * 幂等注入翻译行 — First-line 包装器方案
 *
 * 在 Zotero 旧版（7/8/9）中，twisty 和 indent 由 _renderItem 在 _renderCell 中
 * 直接添加到 primaryCell，因此 injectTranslation 运行时这些元素已存在。
 * 将 cell-indent + twisty + cell-icon + cell-text 移入 dual-row-first-line span，
 * 将翻译放入 dual-row-translation span，通过 flex column 垂直堆叠。
 */
function injectTranslation(div: HTMLElement, item: Zotero.Item) {
  const primaryCell = div.querySelector('.cell.primary') as HTMLElement;
  if (!primaryCell) return;

  // 本地函数
  function cleanupSingleRow(d: HTMLElement, pc: HTMLElement) {
    cleanupDualRowClasses(d, pc);
  }

  // === 快速路径：双行显示已禁用 ===
  const enableDual = getPref('enableDualTitle') !== false;
  if (!enableDual) {
    if (div.classList.contains('dual-row-item')) {
      cleanupSingleRow(div, primaryCell);
    }
    return;
  }

  // 获取翻译内容（轻量操作：仅读取 extra 字段）
  const translation = getTranslation(item);
  const dm = String(getPref('displayMode') || 'original-translated');
  const showOriginalOnly = dm === 'original';
  const showTranslatedOnly = dm === 'translated';
  const translationFirst = dm === 'translated-original';
  const hasTranslation = !!translation;

  // 快速路径：无翻译且无残留类 → 跳过全部 DOM 操作
  if (!hasTranslation && !div.classList.contains('dual-row-item')) {
    return;
  }

  const doc = div.ownerDocument || Zotero.getMainWindow()?.document;
  if (!doc) return;

  // === 模式 1：仅原标题 ===
  if (showOriginalOnly || !hasTranslation) {
    cleanupSingleRow(div, primaryCell);
    return;
  }

  // === 模式 2：仅翻译标题（替换原标题文字） ===
  if (showTranslatedOnly) {
    cleanupSingleRow(div, primaryCell);
    const cellText = primaryCell.querySelector('.cell-text') as HTMLElement | null;
    if (cellText) {
      if (!cellText.dataset.dualTitleOriginal) {
        cellText.dataset.dualTitleOriginal = cellText.textContent || '';
      }
      cellText.textContent = translation;
    }
    return;
  }

  // === 模式 3 & 4：双行显示 ===
  div.classList.add('dual-row-item');
  primaryCell.classList.add('dual-row-primary');
  primaryCell.classList.toggle('has-translation', true);
  primaryCell.classList.toggle('translation-first', translationFirst);

  // 恢复 cell-text 原标题（如有残留）
  const ct = primaryCell.querySelector('.cell-text') as HTMLElement | null;
  if (ct && ct.dataset.dualTitleOriginal) {
    ct.textContent = ct.dataset.dualTitleOriginal;
    delete ct.dataset.dualTitleOriginal;
  }

  // 确保 firstLine 容器存在
  let firstLine = primaryCell.querySelector('.dual-row-first-line') as HTMLElement;
  if (!firstLine) {
    firstLine = doc.createElement('span');
    firstLine.className = 'dual-row-first-line';
    primaryCell.insertBefore(firstLine, primaryCell.firstChild);
  }

  // 收集并移动第一行元素（保持顺序）
  const firstLineElements: HTMLElement[] = [];
  const indent = primaryCell.querySelector(':scope > .cell-indent') as HTMLElement;
  if (indent) firstLineElements.push(indent);
  const twisty = primaryCell.querySelector(':scope > .twisty, :scope > .spacer-twisty') as HTMLElement;
  if (twisty) firstLineElements.push(twisty);
  const cellIcon = primaryCell.querySelector(':scope > .cell-icon, :scope > .icon-item-type') as HTMLElement;
  if (cellIcon) firstLineElements.push(cellIcon);
  const cellText = primaryCell.querySelector(':scope > .cell-text') as HTMLElement;
  if (cellText) firstLineElements.push(cellText);

  // 清空 firstLine 并重新追加（处理重复渲染）
  while (firstLine.firstChild) firstLine.removeChild(firstLine.firstChild);
  for (const el of firstLineElements) {
    firstLine.appendChild(el);
  }

  // 计算 cell-text 的左偏移量（不触发布局重算）
  // 基于已知 CSS 宽度计算：cell-indent(可变) + twisty(16+4) + icon(16+4) + cell-text(4)
  const alignPadding = calcCellTextOffset(firstLine);

  // 确保翻译行存在
  let transSpan = primaryCell.querySelector('.dual-row-translation') as HTMLElement;
  if (!transSpan) {
    transSpan = doc.createElement('span');
    transSpan.className = 'dual-row-translation';
    primaryCell.appendChild(transSpan);
  }
  transSpan.textContent = translation || '';

  // 精确左对齐：padding-left = cell-text 相对于 firstLine 的偏移量
  transSpan.style.paddingLeft = `${alignPadding}px`;

  // 字号 — 使用 px
  let fontSize = parseFloat(String(getPref('translationFontSize') || '12'));
  if (isNaN(fontSize) || fontSize < 6 || fontSize > 32) {
    fontSize = 12;
  }
  transSpan.style.fontSize = `${fontSize}px`;

  // 间距
  let gap = parseInt(String(getPref('translationGap') || '2'), 10);
  if (isNaN(gap) || gap < 0 || gap > 40) {
    gap = 2;
  }
  if (translationFirst) {
    transSpan.style.marginTop = '0';
    transSpan.style.marginBottom = `${gap}px`;
  } else {
    transSpan.style.marginTop = `${gap}px`;
    transSpan.style.marginBottom = '0';
  }
}

function getTranslation(item: Zotero.Item): string | null {
  const extra = item.getField('extra') as string;
  if (!extra) return null;
  const lines = extra.split('\n');
  for (const line of lines) {
    const match = line.match(/^([a-zA-Z][a-zA-Z -_]+):\s*(.+)$/);
    if (!match) continue;
    const key = match[1].trim()
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase()
      .replace(/[\s_]+/g, '-');
    if (key === 'dual-row-translation' || key === 'title-translation') {
      return match[2].trim();
    }
  }
  return null;
}
