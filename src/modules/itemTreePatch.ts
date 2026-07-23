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

      if (_originalRowHeight) {
        ensureChildHeights();
      }

      if (isRegular) {
        injectTranslation(node, row.ref);
      } else {
        node.style.removeProperty('height');
        node.style.removeProperty('overflow');
        node.classList.remove('dual-title-child-row');
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

/** 等待 rows 加载后强制 VirtualizedTable 重绘所有可见行 */
function scheduleDelayedRefresh() {
  let tries = 0;
  let triggered = false;
  const attempt = () => {
    if (triggered) return;
    try {
      if (_itemsView && _itemsView.rowCount > 0) {
        triggered = true;
        Zotero.log(`[DualTitle] Delayed refresh at try ${tries}: ${_itemsView.rowCount} rows`);
        const tree = _itemsView.tree;
        if (tree) {
          ensureChildHeights();
          tree.invalidate?.();
          tree.rerender?.();
          Zotero.log("[DualTitle] tree invalidate+rerender called");
        }
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
    try { _itemsView.refresh?.(); } catch {}
    forceRerender();
  }
}

function forceRerender() {
  if (!_itemsView) return;
  try {
    const tree = _itemsView.tree;
    if (!tree) return;
    Zotero.log("[DualTitle] forceRerender");
    if (tree._jsWindow && tree._rowHeight) {
      try {
        const opts = tree._getWindowedListOptions();
        opts.itemHeight = tree._rowHeight;
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
  } catch (e) {
    Zotero.log("[DualTitle] forceRerender error: " + e);
  }
}

function ensureChildHeights() {
  if (!_itemsView || !_originalRowHeight) return;
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

function cleanupDualRowClasses(div: HTMLElement, primaryCell: HTMLElement, item?: Zotero.Item) {
  div.classList.remove('dual-row-item');
  primaryCell.classList.remove('dual-row-primary', 'has-translation', 'translation-first');
  const oldTrans = primaryCell.querySelector('.dual-row-translation');
  if (oldTrans) oldTrans.remove();
  const ct = primaryCell.querySelector('.cell-text') as HTMLElement | null;
  if (ct) {
    if (item) {
      const realTitle = item.getField('title') as string;
      if (realTitle) {
        ct.textContent = realTitle;
      }
    } else if (ct.dataset.dualTitleOriginal) {
      ct.textContent = ct.dataset.dualTitleOriginal;
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
  const dm = String(getPref('displayMode') || 'original-translated');
  const showOriginalOnly = dm === 'original';
  const showTranslatedOnly = dm === 'translated';
  const translationFirst = dm === 'translated-original';
  const hasTranslation = !!translation;

  Zotero.log(`[DualTitle-DEBUG] injectTranslation: item="${String(item.getField('title')).substring(0, 30)}" translation="${String(translation).substring(0, 30)}" hasTrans=${hasTranslation} dm=${dm}`);

  if (!hasTranslation && !div.classList.contains('dual-row-item')) return;

  const doc = div.ownerDocument || Zotero.getMainWindow()?.document;
  if (!doc) return;

  if (showOriginalOnly || !hasTranslation) {
    cleanupDualRowClasses(div, primaryCell, item);
    return;
  }

  if (showTranslatedOnly) {
    cleanupDualRowClasses(div, primaryCell, item);
    const cellText = primaryCell.querySelector('.cell-text') as HTMLElement | null;
    if (cellText) cellText.textContent = translation;
    return;
  }

  // === 模式 3 & 4：双行显示 ===
  div.classList.add('dual-row-item');
  primaryCell.classList.add('dual-row-primary');
  primaryCell.classList.toggle('has-translation', true);
  primaryCell.classList.toggle('translation-first', translationFirst);

  const originalTitle = item.getField('title') as string;
  const ct = primaryCell.querySelector('.cell-text') as HTMLElement | null;
  if (ct && originalTitle) ct.textContent = originalTitle;
  if (ct?.dataset.dualTitleOriginal) delete ct.dataset.dualTitleOriginal;

  let firstLine = primaryCell.querySelector('.dual-row-first-line') as HTMLElement;
  if (!firstLine) {
    firstLine = doc.createElement('span');
    firstLine.className = 'dual-row-first-line';
    primaryCell.insertBefore(firstLine, primaryCell.firstChild);
  }

  const firstLineElements: HTMLElement[] = [];
  const indent = primaryCell.querySelector(':scope > .cell-indent') as HTMLElement;
  if (indent) firstLineElements.push(indent);
  const twisty = primaryCell.querySelector(':scope > .twisty, :scope > .spacer-twisty') as HTMLElement;
  if (twisty) firstLineElements.push(twisty);
  const cellIcon = primaryCell.querySelector(':scope > .cell-icon, :scope > .icon-item-type') as HTMLElement;
  if (cellIcon) firstLineElements.push(cellIcon);
  const colorSwatch = primaryCell.querySelector(':scope > .colored-tag-swatches') as HTMLElement;
  if (colorSwatch) firstLineElements.push(colorSwatch);
  const cellText = primaryCell.querySelector(':scope > .cell-text') as HTMLElement;
  if (cellText) firstLineElements.push(cellText);

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
  transSpan.textContent = translation || '';
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
