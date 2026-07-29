/**
 * itemTreePatch.ts — Dual Title 核心补丁
 *
 * 直接补丁 VirtualizedTable._renderItem：
 * itemsView._renderItem 在 VirtualizedTable 创建时已通过 bind(this) 捕获，
 * 替换实例属性无效。改为补丁 tree._renderItem（VirtualizedTable 实例方法）。
 */

import { getPref } from "../utils/prefs";

let _patched = false;
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
  const tree = itemsView.tree;
  if (!tree || typeof tree._renderItem !== 'function') {
    if (_patchRetryCount++ < MAX_PATCH_RETRY) {
      setTimeout(() => tryPatch(), 500);
    }
    return;
  }

  // 透传补丁 itemsView._renderItem — 保留 ztoolkit 的 _renderCell hook 链
  const origIVRI = itemsView._renderItem;
  itemsView._renderItem = function(
    index: number, selection: any, oldDiv: HTMLElement | null, columns: any[],
  ) {
    return origIVRI.call(this, index, selection, oldDiv, columns);
  };

  // 直接补丁 VirtualizedTable._renderItem
  // itemsView._renderItem 在 VirtualizedTable 创建时已 bind(this) 到 tree.props.renderItem
  // 修改 itemsView._renderItem 不会影响 tree.props.renderItem
  const originalTreeRenderItem = tree._renderItem.bind(tree);
  tree._renderItem = function(
    index: number, oldElem: HTMLElement | null,
  ) {
    const node = originalTreeRenderItem(index, oldElem);
    try {
      if (!_itemsView) return node;
      const row = _itemsView.getRow(index);
      const isRegular = row?.ref?.isRegularItem?.();
      const childMode = String(getPref('childRowHeightMode') || 'follow');
      Zotero.log(`[DualTitle-DEBUG] renderItem idx=${index} regular=${!!isRegular} childMode=${childMode} origH=${_originalRowHeight} rowH=${tree._rowHeight} hasDualClass=${node.classList.contains('dual-row-item')}`);

      ensureChildHeights();

      if (isRegular) {
        // 清理可能遗留的 padding（之前作为下属条目渲染时设置的）
        const pc = node.querySelector('.cell.primary') as HTMLElement | null;
        if (pc) {
          pc.style.paddingTop = '';
          pc.style.paddingBottom = '';
        }
        injectTranslation(node, row.ref);
      } else {
        node.style.removeProperty('height');
        node.style.removeProperty('overflow');
        node.classList.remove('dual-title-child-row');
        // 清理之前可能设置的 padding
        node.style.paddingTop = '';
        node.style.paddingBottom = '';
        // 在 follow 模式下，给下属条目的 primaryCell 设置 padding 实现垂直居中
        if (childMode === 'follow' && _originalRowHeight && tree._rowHeight > _originalRowHeight) {
          const pc = node.querySelector('.cell.primary') as HTMLElement | null;
          if (pc) {
            const extra = tree._rowHeight - _originalRowHeight;
            pc.style.paddingTop = `${Math.floor(extra / 2)}px`;
            pc.style.paddingBottom = `${Math.ceil(extra / 2)}px`;
          }
        }
        if (node.classList.contains('dual-row-item')) {
          const primaryCell = node.querySelector('.cell.primary') as HTMLElement;
          if (primaryCell) cleanupDualRowClasses(node, primaryCell);
        }
      }
    } catch (e) {
      Zotero.log("[DualTitle] renderItem error: " + e);
    }
    return node;
  };

  setRowHeight();
  _patched = true;
  Zotero.log("[DualTitle] Patched VirtualizedTable._renderItem");
  ensureChildHeights();
  scheduleDelayedRefresh();
}

/** 等待 rows 加载后强制刷新（触发 React 重渲染新建 renderItem 绑定） */
function scheduleDelayedRefresh() {
  let tries = 0;
  let triggered = false;
  const attempt = async () => {
    if (triggered) return;
    try {
      if (_itemsView && _itemsView.rowCount > 0) {
        triggered = true;
        Zotero.log(`[DualTitle] Delayed refresh at try ${tries}: ${_itemsView.rowCount} rows`);
        // 等待数据加载 → React 重渲染 → 新建 renderItem 绑定（含 itemsView 透传补丁）
        try { await _itemsView.refresh?.(); } catch (e) {}
        ensureChildHeights();
        forceRerender();
        return;
      }
    } catch (e) {
      Zotero.log("[DualTitle] scheduleDelayedRefresh error: " + e);
    }
    if (++tries < 30) {
      setTimeout(attempt, 500);
    }
  };
  setTimeout(attempt, 300);
}

export function setRowHeight() {
  if (!_itemsView) return;
  try {
    const tree = _itemsView.tree;
    if (!tree) return;
    const enableDual = getPref('enableDualTitle') !== false;
    const childMode = String(getPref('childRowHeightMode') || 'follow');
    Zotero.log(`[DualTitle-DEBUG] setRowHeight: enableDual=${enableDual} origH=${_originalRowHeight} treeH=${tree._rowHeight} childMode=${childMode}`);
    if (!enableDual) {
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
      try { tree.updateCustomRowHeights?.([]); } catch {}
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
      Zotero.log(`[DualTitle-DEBUG] setRowHeight: orig=${_originalRowHeight} mult=${mult} new=${newHeight} old=${tree._rowHeight}`);
      if (tree._rowHeight !== newHeight) {
        tree._rowHeight = newHeight;
        Zotero.log("[DualTitle] RowHeight: base=" + _originalRowHeight + " mult=" + mult + " result=" + tree._rowHeight);
      }
      ensureChildHeights();
      forceRerender();
    }
  } catch (e) {
    Zotero.log("[DualTitle] setRowHeight error: " + e);
  }
}

export function unpatch() {
  // unpatch 略（运行时不需要反向操作）
  _itemsView = null;
  _patched = false;
  _patchRetryCount = 0;
  _originalRowHeight = 0;
}

export function refresh() {
  if (_itemsView) {
    // 仅重渲染，不调 _itemsView.refresh()——该方法是 async 且无 await，异步回调中会
    // 直接修改 selection.focused，与后续 forceRerender 的 focused 保护竞态。
    // 设置面板变化时数据未变，setRowHeight() + forceRerender() 已足够。
    forceRerender();
  }
}

function forceRerender() {
  if (!_itemsView) return;
  try {
    const tree = _itemsView.tree;
    if (!tree) return;
    // 保存 selection 状态：_itemsView.refresh() 是异步的，可能在 forceRerender 返回后
    // 才修改 selection.focused，selectEventsSuppressed 挡不住直接赋值。
    const sel = tree.selection as any;
    const savedFocused = sel?.focused as number | undefined;
    const savedSelectedSet = sel?.selected ? new Set(sel.selected) as Set<number> : null;
    const origSuppressed = sel?.selectEventsSuppressed;
    if (sel) sel.selectEventsSuppressed = true;
    Zotero.log("[DualTitle] forceRerender");
    if (tree._jsWindow && tree._rowHeight) {
      try {
        const opts = tree._getWindowedListOptions();
        opts.itemHeight = tree._rowHeight;
        // 移除 customRowHeights：_getWindowedListOptions 返回的来自 this.props
        // （始终为 []），会覆盖 ensureChildHeights 设置的正确值。
        // 保留 renderItem 等字段，确保 dual-title 包装函数被 jsWindow 使用。
        delete (opts as any).customRowHeights;
        tree._jsWindow.update(opts);
      } catch (e) {
        tree._jsWindow.update({ itemHeight: tree._rowHeight });
      }
    }
    if (typeof tree.invalidate === 'function') tree.invalidate();
    if (typeof tree.rerender === 'function') tree.rerender();
    if (tree._jsWindow) {
      tree._jsWindow.invalidate();
      try { tree._jsWindow.render(); } catch (e) {}
    }
    // 强制恢复 selection.focused（直接赋值、不依赖事件系统）
    if (sel && savedFocused !== undefined) {
      sel.focused = savedFocused;
    }
    // 恢复 selection 事件
    if (sel) sel.selectEventsSuppressed = origSuppressed ?? false;
  } catch (e) {
    Zotero.log("[DualTitle] forceRerender error: " + e);
  }
}

let _lastEnsureTime = 0;

function ensureChildHeights() {
  if (!_itemsView || !_originalRowHeight) return;
  // 节流：100ms 内不重复执行，合并渲染循环中的多次调用为一次全量重算
  const now = Date.now();
  if (now - _lastEnsureTime < 100) return;
  _lastEnsureTime = now;
  try {
    const tree = _itemsView.tree;
    if (!tree) return;
    const childMode = String(getPref('childRowHeightMode') || 'follow');
    if (childMode === 'keep') {
      const rowCount = _itemsView.rowCount ?? 0;
      if (rowCount === 0) return;
      const customHeights: [number, number][] = [];
      for (let i = 0; i < rowCount; i++) {
        try {
          const row = _itemsView.getRow(i);
          if (row?.ref && !row.ref.isRegularItem?.()) {
            customHeights.push([i, _originalRowHeight]);
          }
        } catch (e) {}
      }
      if (typeof tree.updateCustomRowHeights === 'function') {
        tree.updateCustomRowHeights(customHeights);
        Zotero.log(`[DualTitle-DEBUG] ensureChildHeights: keep, ${customHeights.length} child rows`);
      }
    } else {
      if (typeof tree.updateCustomRowHeights === 'function') {
        tree.updateCustomRowHeights([]);
      }
    }
  } catch (e) {
    Zotero.log("[DualTitle-DEBUG] ensureChildHeights error: " + e);
  }
}

function updateCellText(ct: HTMLElement, text: string) {
  // 只替换第一个文本节点，保留其他子元素（Ethereal Style 进度条等）
  let textNode: Node | null = null;
  let removedCount = 0;
  for (const child of Array.from(ct.childNodes) as Node[]) {
    if (child.nodeType === 3 && !textNode) {
      textNode = child;
      (textNode as Text).textContent = text;
    } else if (child.nodeType === 3 && textNode) {
      ct.removeChild(child);
      removedCount++;
    }
  }
  if (!textNode) {
    // 没有直接文本节点（cellText 只有非文本子元素，如 Ethereal Style span）
    // 直接设置 textContent = text 会移除所有子元素（丢失进度条）
    // 改用 insertBefore + 清空子元素内的文本
    ct.insertBefore(ct.ownerDocument!.createTextNode(text), ct.firstChild);
    const children = Array.from(ct.childNodes) as Node[];
    for (let i = 1; i < children.length; i++) {
      const child = children[i];
      if (child.nodeType !== 3 && child.textContent) {
        child.textContent = '';
      }
    }
  }
}

function cleanupDualRowClasses(div: HTMLElement, primaryCell: HTMLElement, item?: Zotero.Item) {
  div.classList.remove('dual-row-item');
  primaryCell.classList.remove('dual-row-primary', 'has-translation', 'translation-first');
  const oldTrans = primaryCell.querySelector('.dual-row-translation');
  if (oldTrans) oldTrans.remove();
  const ct = primaryCell.querySelector('.cell-text') as HTMLElement | null;
  if (ct) {
    if (item) {
      let realTitle = item.getField('title') as string;
      // 清理 PDF Translate 早期版本导致的拼接污染（仅作用于显示）
      try {
        const trans = getTranslation(item);
        const cleaned = stripAppendedTranslation(realTitle, trans);
        if (cleaned && cleaned !== realTitle) {
          Zotero.log(`[DualTitle-DEBUG] cleanup 清理拼接污染: len=${realTitle.length}->${cleaned.length}`);
          realTitle = cleaned;
        }
      } catch (e) { /* silent */ }
      if (realTitle) updateCellText(ct, realTitle);
    } else if (ct.dataset.dualTitleOriginal) {
      updateCellText(ct, ct.dataset.dualTitleOriginal);
    }
    if (ct.dataset.dualTitleOriginal) delete ct.dataset.dualTitleOriginal;
  }
}

function calcCellTextOffset(firstLine: HTMLElement): number {
  let offset = 0;
  const indent = firstLine.querySelector(':scope > .cell-indent') as HTMLElement | null;
  if (indent) {
    const ps = indent.style.paddingInlineStart;
    offset += ps ? (parseFloat(ps) || 0) : 0;
  }
  if (firstLine.querySelector(':scope > .twisty')) offset += 20;
  if (firstLine.querySelector(':scope > .cell-icon, :scope > .icon-item-type')) offset += 20;
  offset += 4;
  return Math.round(offset);
}

function injectTranslation(div: HTMLElement, item: Zotero.Item) {
  const primaryCell = div.querySelector('.cell.primary') as HTMLElement;
  if (!primaryCell) return;

  const enableDual = getPref('enableDualTitle') !== false;
  if (!enableDual) {
    if (div.classList.contains('dual-row-item')) cleanupDualRowClasses(div, primaryCell, item);
    return;
  }

  const translation = getTranslation(item);
  const remark = getRemark(item);
  const dm = String(getPref('displayMode') || 'original-translated');
  const showOriginalOnly = dm === 'original';
  const showTranslatedOnly = dm === 'translated';
  const translationFirst = dm === 'translated-original';
  const isRemarkMode = dm === 'original-remark' || dm === 'remark-original';
  const remarkFirst = dm === 'remark-original';

  // 第二行内容：简记模式用 remark，翻译模式用 translation
  const secondLineContent = isRemarkMode ? remark : translation;
  const secondLineFirst = isRemarkMode ? remarkFirst : translationFirst;
  const hasSecondLine = !!secondLineContent;

  Zotero.log(`[DualTitle-DEBUG] injectTranslation: item="${String(item.getField('title')).substring(0, 50)}..." len=${(item.getField('title') as string).length} translation="${String(translation).substring(0, 30)}..." dm=${dm} hasSecond=${hasSecondLine}`);

  if (!hasSecondLine && !div.classList.contains('dual-row-item')) return;

  const doc = div.ownerDocument || Zotero.getMainWindow()?.document;
  if (!doc) return;

  if (showOriginalOnly || !hasSecondLine) {
    cleanupDualRowClasses(div, primaryCell, item);
    return;
  }

  // === 模式 2：仅翻译标题（替换原标题文字） ===
  if (showTranslatedOnly) {
    cleanupDualRowClasses(div, primaryCell, item);
    const cellText = primaryCell.querySelector('.cell-text') as HTMLElement | null;
    if (cellText) updateCellText(cellText, translation || '');
    return;
  }

  // === 模式 3 & 4：双行显示（翻译或简记） ===
  div.classList.add('dual-row-item');
  primaryCell.classList.add('dual-row-primary');
  primaryCell.classList.toggle('has-translation', true);
  primaryCell.classList.toggle('translation-first', secondLineFirst);

  // 读取原始 title 并清理 PDF Translate 早期版本导致的拼接污染
  // 污染格式: "英文原标题中文翻译" (无分隔符)
  // 检测方法：如果 title 末尾包含与 extra 中翻译相同的子串（允许标点差异），则剥离
  let originalTitle = item.getField('title') as string;
  if (originalTitle && secondLineContent && originalTitle.length > secondLineContent.length * 2) {
    const transNormalized = getTranslation(item) || '';
    const cleaned = stripAppendedTranslation(originalTitle, transNormalized);
    if (cleaned && cleaned !== originalTitle) {
      Zotero.log(`[DualTitle-DEBUG] 清理拼接污染: len=${originalTitle.length}->${cleaned.length} "${cleaned.substring(0, 30)}..."`);
      originalTitle = cleaned;
    }
  }

  const ct = Array.from(primaryCell.children).find((el) => el.classList.contains('cell-text')) as HTMLElement | null;
  // 更新 cellText：只替换第一个文本节点，保留 Ethereal Style 进度条等子元素
  if (ct && originalTitle) {
    updateCellText(ct, originalTitle);
  }
  // 清除 firstLine 中的旧 cellText（如果有，从上一轮渲染残留）
  const oldCellTextInFirst = primaryCell.querySelector('.dual-row-first-line .cell-text') as HTMLElement | null;
  if (oldCellTextInFirst && oldCellTextInFirst !== ct) {
    oldCellTextInFirst.remove();
  }
  if (ct?.dataset.dualTitleOriginal) delete ct.dataset.dualTitleOriginal;

  let firstLine = primaryCell.querySelector('.dual-row-first-line') as HTMLElement;
  if (!firstLine) {
    firstLine = doc.createElement('span');
    firstLine.className = 'dual-row-first-line';
    primaryCell.insertBefore(firstLine, primaryCell.firstChild);
  }

  const firstLineElements: HTMLElement[] = [];
  const indent = primaryCell.querySelector('.cell-indent') as HTMLElement;
  if (indent) firstLineElements.push(indent);
  const twisty = primaryCell.querySelector('.twisty, .spacer-twisty') as HTMLElement;
  if (twisty) firstLineElements.push(twisty);
  const cellIcon = primaryCell.querySelector('.cell-icon, .icon-item-type') as HTMLElement;
  if (cellIcon) firstLineElements.push(cellIcon);
  const colorSwatch = primaryCell.querySelector('.colored-tag-swatches') as HTMLElement;
  if (colorSwatch) firstLineElements.push(colorSwatch);
  // 收集 emoji 标签：原生 Zotero（itemTreeRow.js）将每个 emoji 渲染为独立
  // .tag-swatch.emoji span（不在 .colored-tag-swatches 容器内），
  // 必须逐个收集搬入 firstLine，否则会滞留在 .dual-row-first-line 之外
  // 导致多 emoji 垂直堆叠、原标题被挤走的布局 bug。
  const emojiSwatches = Array.from(primaryCell.children).filter(
    (el): el is HTMLElement =>
      !!el.classList &&
      el.classList.contains('tag-swatch') &&
      el.classList.contains('emoji'),
  );
  for (const es of emojiSwatches) firstLineElements.push(es);
  // cellText — 只找 primaryCell 的直接子级（Zotero 新渲染的），排除 firstLine 中的残留
  const cellTextEl = Array.from(primaryCell.children).find((el) => el.classList.contains('cell-text')) as HTMLElement | null;
  if (cellTextEl) { firstLineElements.push(cellTextEl); cellTextEl.style.position = 'relative'; }

  while (firstLine.firstChild) firstLine.removeChild(firstLine.firstChild);
  for (const el of firstLineElements) {
    firstLine.appendChild(el);
  }

  const alignPadding = calcCellTextOffset(firstLine);

  let transSpan = primaryCell.querySelector('.dual-row-translation') as HTMLElement;
  if (!transSpan) {
    transSpan = doc.createElement('span');
    transSpan.className = 'dual-row-translation';
    primaryCell.appendChild(transSpan);
  }
  transSpan.textContent = secondLineContent || '';
  transSpan.style.paddingLeft = `${alignPadding}px`;

  let fontSize = parseFloat(String(getPref('translationFontSize') || '12'));
  if (isNaN(fontSize) || fontSize < 6 || fontSize > 32) fontSize = 12;
  transSpan.style.fontSize = `${fontSize}px`;

  const color = String(getPref('translationColor') || '');
  if (color) {
    transSpan.style.color = color;
  } else {
    transSpan.style.color = '';
  }

  let gap = parseInt(String(getPref('translationGap') || '2'), 10);
  if (isNaN(gap) || gap < 0 || gap > 40) gap = 2;
  if (secondLineFirst) {
    transSpan.style.marginTop = '0';
    transSpan.style.marginBottom = `${gap}px`;
  } else {
    transSpan.style.marginTop = `${gap}px`;
    transSpan.style.marginBottom = '0';
  }
}

function getTranslation(item: Zotero.Item): string | null {
  return getFieldFromExtra(item, ["title-translation", "dual-row-translation"]);
}

function getRemark(item: Zotero.Item): string | null {
  return getFieldFromExtra(item, ["remark"]);
}

/**
 * 从 extra 字段中按 key 列表查找值（优先级从前往后）
 */
/**
 * 检测并剥离拼接在原标题末尾的翻译文本
 * PDF Translate 早期版本会将翻译直接追加到 title 末尾（无分隔符）
 *
 * 策略：
 * 1. 如果 extra 中有 translation（中文），在 title 末尾查找该中文子串
 * 2. 允许标点差异（句号/逗号/括号等变换）
 * 3. 只剥离明确以中文/全角字符开始的部分（保护英文标题不被误切）
 */
function stripAppendedTranslation(title: string, translation: string | null): string | null {
  if (!title || !translation) return null;
  if (title.length <= translation.length) return null;

  // 如果原标题已经包含中文字符，跳过拼接检测
  // PDFT 拼接翻译只可能发生在英文标题上，中文标题无需处理
  if (/[\u4e00-\u9FFF\u3400-\u4DBF]/.test(title)) return null;

  // 从 title 末尾开始，寻找与 translation 匹配的连续中文字符串
  let matchLen = 0;
  let minStart = title.length;

  // 用翻译中最长的连续中文字段来定位
  // 先把 translation 按非中文字符分割成片段
  const segments = translation.match(/[\u4e00-\u9FFF\u3400-\u4DBF\u3000-\u303F\uff00-\uffef]+[\u4e00-\u9FFF\u3400-\u4DBF]*/g) || [];
  for (const seg of segments) {
    if (seg.length < 3) continue; // 至少 3 个中文字符才有意义
    const pos = title.lastIndexOf(seg);
    if (pos !== -1 && pos > title.length / 2) {
      // 翻译出现在 title 的后半段 → 确认污染
      if (pos < minStart) {
        minStart = pos;
        matchLen = Math.max(matchLen, seg.length);
      }
    }
  }

  if (minStart < title.length && matchLen >= 3) {
    // 从第一个匹配的中文片段开始剥离
    const cleaned = title.substring(0, minStart).trim();
    if (cleaned && cleaned.length > translation.length / 2) {
      return cleaned;
    }
  }

  return null;
}

function getFieldFromExtra(item: Zotero.Item, keys: string[]): string | null {
  const extra = item.getField('extra') as string;
  if (!extra) return null;
  const normalizedKeys = keys.map(k =>
    k.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().replace(/[\s_]+/g, '-')
  );
  const lines = extra.split('\n');
  for (const line of lines) {
    const match = line.match(/^([a-zA-Z][a-zA-Z -_]+):\s*(.+)$/);
    if (!match) continue;
    const key = match[1].trim()
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase()
      .replace(/[\s_]+/g, '-');
    if (normalizedKeys.includes(key)) {
      return match[2].trim();
    }
  }
  return null;
}
