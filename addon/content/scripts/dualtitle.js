"use strict";
(() => {
  // package.json
  var config = {
    addonName: "Dual Title",
    addonID: "dualtitle@dual-title.zotero",
    addonRef: "dualtitle",
    addonInstance: "DualTitle",
    prefsPrefix: "extensions.zotero.dualtitle"
  };

  // src/utils/locale.ts
  var _l10n = null;
  function initLocale() {
    try {
      _l10n = new Localization([`${config.addonRef}-addon.ftl`], true);
      addon.data.locale = { current: _l10n };
    } catch {
      try {
        const L10n = Zotero[Symbol.for("Localization")] || Localization;
        _l10n = new L10n([`${config.addonRef}-addon.ftl`], true);
        addon.data.locale = { current: _l10n };
      } catch {
      }
    }
  }

  // src/utils/prefs.ts
  var PREFS_PREFIX = config.prefsPrefix;
  var DEFAULT_VALUES = {
    enableDualTitle: true,
    displayMode: "original-translated",
    translationFontSize: 12,
    translationColor: "",
    translationGap: 2,
    rowHeightMultiplier: "2",
    childRowHeightMode: "keep",
    autoTranslate: true
  };
  function getPref(key) {
    const fullKey = `${PREFS_PREFIX}.${key}`;
    if (key === "rowHeightMultiplier") {
      try {
        const prefType = Services.prefs.getPrefType(fullKey);
        if (prefType === Services.prefs.PREF_STRING) {
          return Services.prefs.getStringPref(fullKey);
        } else if (prefType === Services.prefs.PREF_INT) {
          const intVal = Services.prefs.getIntPref(fullKey);
          Services.prefs.clearUserPref(fullKey);
          Services.prefs.setStringPref(fullKey, String(intVal));
          return String(intVal);
        }
        return DEFAULT_VALUES[key];
      } catch (e) {
        return DEFAULT_VALUES[key];
      }
    }
    const val = Zotero.Prefs.get(fullKey, true);
    if (val === void 0 || val === null) {
      return DEFAULT_VALUES[key];
    }
    return val;
  }

  // src/modules/itemTreePatch.ts
  var _patched = false;
  var _originalRowHeight = 0;
  var _itemsView = null;
  var _patchRetryCount = 0;
  var MAX_PATCH_RETRY = 30;
  function setDocument(_doc) {
  }
  function patch() {
    if (_patched) return;
    tryPatch();
  }
  function tryPatch() {
    if (_patched) return;
    let itemsView = null;
    try {
      const win = Zotero.getMainWindow();
      itemsView = win?.ZoteroPane?.itemsView;
    } catch (e) {
    }
    if (!itemsView) {
      if (_patchRetryCount++ < MAX_PATCH_RETRY) {
        setTimeout(() => tryPatch(), 500);
      }
      return;
    }
    _itemsView = itemsView;
    const tree = itemsView.tree;
    if (!tree || typeof tree._renderItem !== "function") {
      if (_patchRetryCount++ < MAX_PATCH_RETRY) {
        setTimeout(() => tryPatch(), 500);
      }
      return;
    }
    const origIVRI = itemsView._renderItem;
    itemsView._renderItem = function(index, selection, oldDiv, columns) {
      return origIVRI.call(this, index, selection, oldDiv, columns);
    };
    const originalTreeRenderItem = tree._renderItem.bind(tree);
    tree._renderItem = function(index, oldElem) {
      const node = originalTreeRenderItem(index, oldElem);
      try {
        if (!_itemsView) return node;
        const row = _itemsView.getRow(index);
        const isRegular = row?.ref?.isRegularItem?.();
        const childMode = String(getPref("childRowHeightMode") || "follow");
        Zotero.log(`[DualTitle-DEBUG] renderItem idx=${index} regular=${!!isRegular} childMode=${childMode} origH=${_originalRowHeight} rowH=${tree._rowHeight} hasDualClass=${node.classList.contains("dual-row-item")}`);
        ensureChildHeights();
        if (isRegular) {
          const pc = node.querySelector(".cell.primary");
          if (pc) {
            pc.style.paddingTop = "";
            pc.style.paddingBottom = "";
          }
          injectTranslation(node, row.ref);
        } else {
          node.style.removeProperty("height");
          node.style.removeProperty("overflow");
          node.classList.remove("dual-title-child-row");
          node.style.paddingTop = "";
          node.style.paddingBottom = "";
          if (childMode === "follow" && _originalRowHeight && tree._rowHeight > _originalRowHeight) {
            const pc = node.querySelector(".cell.primary");
            if (pc) {
              const extra = tree._rowHeight - _originalRowHeight;
              pc.style.paddingTop = `${Math.floor(extra / 2)}px`;
              pc.style.paddingBottom = `${Math.ceil(extra / 2)}px`;
            }
          }
          if (node.classList.contains("dual-row-item")) {
            const primaryCell = node.querySelector(".cell.primary");
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
  function scheduleDelayedRefresh() {
    let tries = 0;
    let triggered = false;
    const attempt = async () => {
      if (triggered) return;
      try {
        if (_itemsView && _itemsView.rowCount > 0) {
          triggered = true;
          Zotero.log(`[DualTitle] Delayed refresh at try ${tries}: ${_itemsView.rowCount} rows`);
          try {
            await _itemsView.refresh?.();
          } catch (e) {
          }
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
  function setRowHeight() {
    if (!_itemsView) return;
    try {
      const tree = _itemsView.tree;
      if (!tree) return;
      const enableDual = getPref("enableDualTitle") !== false;
      const childMode = String(getPref("childRowHeightMode") || "follow");
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
        try {
          tree.updateCustomRowHeights?.([]);
        } catch {
        }
        return;
      }
      if ((!_originalRowHeight || _originalRowHeight <= 10) && tree._rowHeight && tree._rowHeight > 10) {
        _originalRowHeight = tree._rowHeight;
        Zotero.log("[DualTitle] Captured originalRowHeight=" + _originalRowHeight);
      }
      if (_originalRowHeight && _originalRowHeight > 10) {
        let mult = parseFloat(String(getPref("rowHeightMultiplier") || "2"));
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
  function unpatch() {
    _itemsView = null;
    _patched = false;
    _patchRetryCount = 0;
    _originalRowHeight = 0;
  }
  function refresh() {
    if (_itemsView) {
      forceRerender();
    }
  }
  function forceRerender() {
    if (!_itemsView) return;
    try {
      const tree = _itemsView.tree;
      if (!tree) return;
      const sel = tree.selection;
      const savedFocused = sel?.focused;
      const savedSelectedSet = sel?.selected ? new Set(sel.selected) : null;
      const origSuppressed = sel?.selectEventsSuppressed;
      if (sel) sel.selectEventsSuppressed = true;
      Zotero.log("[DualTitle] forceRerender");
      if (tree._jsWindow && tree._rowHeight) {
        try {
          const opts = tree._getWindowedListOptions();
          opts.itemHeight = tree._rowHeight;
          delete opts.customRowHeights;
          tree._jsWindow.update(opts);
        } catch (e) {
          tree._jsWindow.update({ itemHeight: tree._rowHeight });
        }
      }
      if (typeof tree.invalidate === "function") tree.invalidate();
      if (typeof tree.rerender === "function") tree.rerender();
      if (tree._jsWindow) {
        tree._jsWindow.invalidate();
        try {
          tree._jsWindow.render();
        } catch (e) {
        }
      }
      if (sel && savedFocused !== void 0) {
        sel.focused = savedFocused;
      }
      if (sel) sel.selectEventsSuppressed = origSuppressed ?? false;
    } catch (e) {
      Zotero.log("[DualTitle] forceRerender error: " + e);
    }
  }
  var _lastEnsureTime = 0;
  function ensureChildHeights() {
    if (!_itemsView || !_originalRowHeight) return;
    const now = Date.now();
    if (now - _lastEnsureTime < 100) return;
    _lastEnsureTime = now;
    try {
      const tree = _itemsView.tree;
      if (!tree) return;
      const childMode = String(getPref("childRowHeightMode") || "follow");
      if (childMode === "keep") {
        const rowCount = _itemsView.rowCount ?? 0;
        if (rowCount === 0) return;
        const customHeights = [];
        for (let i = 0; i < rowCount; i++) {
          try {
            const row = _itemsView.getRow(i);
            if (row?.ref && !row.ref.isRegularItem?.()) {
              customHeights.push([i, _originalRowHeight]);
            }
          } catch (e) {
          }
        }
        if (typeof tree.updateCustomRowHeights === "function") {
          tree.updateCustomRowHeights(customHeights);
          Zotero.log(`[DualTitle-DEBUG] ensureChildHeights: keep, ${customHeights.length} child rows`);
        }
      } else {
        if (typeof tree.updateCustomRowHeights === "function") {
          tree.updateCustomRowHeights([]);
        }
      }
    } catch (e) {
      Zotero.log("[DualTitle-DEBUG] ensureChildHeights error: " + e);
    }
  }
  function updateCellText(ct, text) {
    let textNode = null;
    let removedCount = 0;
    for (const child of Array.from(ct.childNodes)) {
      if (child.nodeType === 3 && !textNode) {
        textNode = child;
        textNode.textContent = text;
      } else if (child.nodeType === 3 && textNode) {
        ct.removeChild(child);
        removedCount++;
      }
    }
    if (!textNode) {
      ct.insertBefore(ct.ownerDocument.createTextNode(text), ct.firstChild);
      const children = Array.from(ct.childNodes);
      for (let i = 1; i < children.length; i++) {
        const child = children[i];
        if (child.nodeType !== 3 && child.textContent) {
          child.textContent = "";
        }
      }
    }
  }
  function cleanupDualRowClasses(div, primaryCell, item) {
    div.classList.remove("dual-row-item");
    primaryCell.classList.remove("dual-row-primary", "has-translation", "translation-first");
    const oldTrans = primaryCell.querySelector(".dual-row-translation");
    if (oldTrans) oldTrans.remove();
    const ct = primaryCell.querySelector(".cell-text");
    if (ct) {
      if (item) {
        let realTitle = item.getField("title");
        try {
          const trans = getTranslation(item);
          const cleaned = stripAppendedTranslation(realTitle, trans);
          if (cleaned && cleaned !== realTitle) {
            Zotero.log(`[DualTitle-DEBUG] cleanup \u6E05\u7406\u62FC\u63A5\u6C61\u67D3: len=${realTitle.length}->${cleaned.length}`);
            realTitle = cleaned;
          }
        } catch (e) {
        }
        if (realTitle) updateCellText(ct, realTitle);
      } else if (ct.dataset.dualTitleOriginal) {
        updateCellText(ct, ct.dataset.dualTitleOriginal);
      }
      if (ct.dataset.dualTitleOriginal) delete ct.dataset.dualTitleOriginal;
    }
  }
  function calcCellTextOffset(firstLine) {
    let offset = 0;
    const indent = firstLine.querySelector(":scope > .cell-indent");
    if (indent) {
      const ps = indent.style.paddingInlineStart;
      offset += ps ? parseFloat(ps) || 0 : 0;
    }
    if (firstLine.querySelector(":scope > .twisty")) offset += 20;
    if (firstLine.querySelector(":scope > .cell-icon, :scope > .icon-item-type")) offset += 20;
    offset += 4;
    return Math.round(offset);
  }
  function injectTranslation(div, item) {
    const primaryCell = div.querySelector(".cell.primary");
    if (!primaryCell) return;
    const enableDual = getPref("enableDualTitle") !== false;
    if (!enableDual) {
      if (div.classList.contains("dual-row-item")) cleanupDualRowClasses(div, primaryCell, item);
      return;
    }
    const translation = getTranslation(item);
    const remark = getRemark(item);
    const dm = String(getPref("displayMode") || "original-translated");
    const showOriginalOnly = dm === "original";
    const showTranslatedOnly = dm === "translated";
    const translationFirst = dm === "translated-original";
    const isRemarkMode = dm === "original-remark" || dm === "remark-original";
    const remarkFirst = dm === "remark-original";
    const secondLineContent = isRemarkMode ? remark : translation;
    const secondLineFirst = isRemarkMode ? remarkFirst : translationFirst;
    const hasSecondLine = !!secondLineContent;
    Zotero.log(`[DualTitle-DEBUG] injectTranslation: item="${String(item.getField("title")).substring(0, 50)}..." len=${item.getField("title").length} translation="${String(translation).substring(0, 30)}..." dm=${dm} hasSecond=${hasSecondLine}`);
    if (!hasSecondLine && !div.classList.contains("dual-row-item")) return;
    const doc = div.ownerDocument || Zotero.getMainWindow()?.document;
    if (!doc) return;
    if (showOriginalOnly || !hasSecondLine) {
      cleanupDualRowClasses(div, primaryCell, item);
      return;
    }
    if (showTranslatedOnly) {
      cleanupDualRowClasses(div, primaryCell, item);
      const cellText = primaryCell.querySelector(".cell-text");
      if (cellText) updateCellText(cellText, translation || "");
      return;
    }
    div.classList.add("dual-row-item");
    primaryCell.classList.add("dual-row-primary");
    primaryCell.classList.toggle("has-translation", true);
    primaryCell.classList.toggle("translation-first", secondLineFirst);
    let originalTitle = item.getField("title");
    if (originalTitle && secondLineContent && originalTitle.length > secondLineContent.length * 2) {
      const transNormalized = getTranslation(item) || "";
      const cleaned = stripAppendedTranslation(originalTitle, transNormalized);
      if (cleaned && cleaned !== originalTitle) {
        Zotero.log(`[DualTitle-DEBUG] \u6E05\u7406\u62FC\u63A5\u6C61\u67D3: len=${originalTitle.length}->${cleaned.length} "${cleaned.substring(0, 30)}..."`);
        originalTitle = cleaned;
      }
    }
    const ct = Array.from(primaryCell.children).find((el) => el.classList.contains("cell-text"));
    if (ct && originalTitle) {
      updateCellText(ct, originalTitle);
    }
    const oldCellTextInFirst = primaryCell.querySelector(".dual-row-first-line .cell-text");
    if (oldCellTextInFirst && oldCellTextInFirst !== ct) {
      oldCellTextInFirst.remove();
    }
    if (ct?.dataset.dualTitleOriginal) delete ct.dataset.dualTitleOriginal;
    let firstLine = primaryCell.querySelector(".dual-row-first-line");
    if (!firstLine) {
      firstLine = doc.createElement("span");
      firstLine.className = "dual-row-first-line";
      primaryCell.insertBefore(firstLine, primaryCell.firstChild);
    }
    const firstLineElements = [];
    const indent = primaryCell.querySelector(".cell-indent");
    if (indent) firstLineElements.push(indent);
    const twisty = primaryCell.querySelector(".twisty, .spacer-twisty");
    if (twisty) firstLineElements.push(twisty);
    const cellIcon = primaryCell.querySelector(".cell-icon, .icon-item-type");
    if (cellIcon) firstLineElements.push(cellIcon);
    const colorSwatch = primaryCell.querySelector(".colored-tag-swatches");
    if (colorSwatch) firstLineElements.push(colorSwatch);
    const emojiSwatches = Array.from(primaryCell.children).filter(
      (el) => !!el.classList && el.classList.contains("tag-swatch") && el.classList.contains("emoji")
    );
    for (const es of emojiSwatches) firstLineElements.push(es);
    const cellTextEl = Array.from(primaryCell.children).find((el) => el.classList.contains("cell-text"));
    if (cellTextEl) {
      firstLineElements.push(cellTextEl);
      cellTextEl.style.position = "relative";
    }
    while (firstLine.firstChild) firstLine.removeChild(firstLine.firstChild);
    for (const el of firstLineElements) {
      firstLine.appendChild(el);
    }
    const alignPadding = calcCellTextOffset(firstLine);
    let transSpan = primaryCell.querySelector(".dual-row-translation");
    if (!transSpan) {
      transSpan = doc.createElement("span");
      transSpan.className = "dual-row-translation";
      primaryCell.appendChild(transSpan);
    }
    transSpan.textContent = secondLineContent || "";
    transSpan.style.paddingLeft = `${alignPadding}px`;
    let fontSize = parseFloat(String(getPref("translationFontSize") || "12"));
    if (isNaN(fontSize) || fontSize < 6 || fontSize > 32) fontSize = 12;
    transSpan.style.fontSize = `${fontSize}px`;
    const color = String(getPref("translationColor") || "");
    if (color) {
      transSpan.style.color = color;
    } else {
      transSpan.style.color = "";
    }
    let gap = parseInt(String(getPref("translationGap") || "2"), 10);
    if (isNaN(gap) || gap < 0 || gap > 40) gap = 2;
    if (secondLineFirst) {
      transSpan.style.marginTop = "0";
      transSpan.style.marginBottom = `${gap}px`;
    } else {
      transSpan.style.marginTop = `${gap}px`;
      transSpan.style.marginBottom = "0";
    }
  }
  function getTranslation(item) {
    return getFieldFromExtra(item, ["title-translation", "dual-row-translation"]);
  }
  function getRemark(item) {
    return getFieldFromExtra(item, ["remark"]);
  }
  function stripAppendedTranslation(title, translation) {
    if (!title || !translation) return null;
    if (title.length <= translation.length) return null;
    if (/[\u4e00-\u9FFF\u3400-\u4DBF]/.test(title)) return null;
    let matchLen = 0;
    let minStart = title.length;
    const segments = translation.match(/[\u4e00-\u9FFF\u3400-\u4DBF\u3000-\u303F\uff00-\uffef]+[\u4e00-\u9FFF\u3400-\u4DBF]*/g) || [];
    for (const seg of segments) {
      if (seg.length < 3) continue;
      const pos = title.lastIndexOf(seg);
      if (pos !== -1 && pos > title.length / 2) {
        if (pos < minStart) {
          minStart = pos;
          matchLen = Math.max(matchLen, seg.length);
        }
      }
    }
    if (minStart < title.length && matchLen >= 3) {
      const cleaned = title.substring(0, minStart).trim();
      if (cleaned && cleaned.length > translation.length / 2) {
        return cleaned;
      }
    }
    return null;
  }
  function getFieldFromExtra(item, keys) {
    const extra = item.getField("extra");
    if (!extra) return null;
    const normalizedKeys = keys.map(
      (k) => k.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase().replace(/[\s_]+/g, "-")
    );
    const lines = extra.split("\n");
    for (const line of lines) {
      const match = line.match(/^([a-zA-Z][a-zA-Z -_]+):\s*(.+)$/);
      if (!match) continue;
      const key = match[1].trim().replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase().replace(/[\s_]+/g, "-");
      if (normalizedKeys.includes(key)) {
        return match[2].trim();
      }
    }
    return null;
  }

  // src/modules/translate.ts
  function detectSource() {
    if (hasPDFTranslate()) return "pdf-translate";
    return "none";
  }
  function hasPDFTranslate() {
    return typeof Zotero.PDFTranslate?.api?.translate === "function";
  }
  function setExtraTranslation(item, key, value) {
    const existingExtra = item.getField("extra") || "";
    const lines = existingExtra ? existingExtra.split("\n") : [];
    const normalizedKey = key.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
    let found = false;
    const newLines = lines.map((line) => {
      const match = line.match(/^([a-zA-Z][a-zA-Z -_]+):(.+)$/);
      if (match) {
        const lineKey = match[1].trim().replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase().replace(/[\s_]+/g, "-");
        if (lineKey === normalizedKey) {
          found = true;
          return match[1].trim() + ": " + value;
        }
      }
      return line;
    });
    if (!found) {
      const displayKey = key;
      newLines.push(displayKey + ": " + value);
    }
    item.setField("extra", newLines.join("\n"));
  }
  function getExtraTranslation(item, key) {
    try {
      const fields = Zotero.Utilities.Internal.extractExtraFields(item.getField("extra"));
      if (fields?.fields) {
        for (const entry of fields.fields) {
          if (Array.isArray(entry) && entry.length >= 2) {
            const k = String(entry[0]);
            const v = String(entry[1] || "");
            const nk = k.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase().replace(/[\s_]+/g, "-");
            const nKey = key.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase().replace(/[\s_]+/g, "-");
            if (nk === nKey) return v;
          }
        }
      }
    } catch {
    }
    const extra = item.getField("extra");
    if (!extra) return null;
    const lines = extra.split("\n");
    const normalizedKey = key.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase().replace(/[\s_]+/g, "-");
    for (const line of lines) {
      const match = line.match(/^([a-zA-Z][a-zA-Z -_]+):\s*(.+)$/);
      if (!match) continue;
      const lineKey = match[1].trim().replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase().replace(/[\s_]+/g, "-");
      if (lineKey === normalizedKey) return match[2].trim();
    }
    return null;
  }
  async function translateTitle(item) {
    if (!item.isRegularItem()) return null;
    const title = item.getField("title");
    if (!title) return null;
    const existing = getTranslationFromExtra(item);
    if (existing) return existing;
    const source = detectSource();
    if (source === "none") return null;
    let result = null;
    try {
      if (source === "pdf-translate") {
        result = await translateViaPDFT(item, title);
      }
    } catch (e) {
      Zotero.logError(new Error("[DualTitle] Translation failed: " + String(e?.message || e)));
      return null;
    }
    if (result) {
      setExtraTranslation(item, "titleTranslation", result);
      await item.saveTx();
    }
    return result;
  }
  async function translateViaPDFT(item, title) {
    const task = await Zotero.PDFTranslate.api.translate(title, {
      pluginID: "dualtitle@dual-title.zotero",
      itemID: item.id
    });
    return task?.status === "success" ? task.result : null;
  }
  function getTranslationFromExtra(item) {
    let trans = getExtraTranslation(item, "titleTranslation");
    if (trans) return trans;
    trans = getExtraTranslation(item, "dualRowTranslation");
    if (trans) return trans;
    return null;
  }
  function isChinese(text) {
    const cjkChars = text.match(/[\u4e00-\u9FFF\u3400-\u4DBF]/g);
    if (!cjkChars) return false;
    return cjkChars.length / text.length > 0.3;
  }

  // src/hooks.ts
  var DEFAULT_PREFS = {
    enableDualTitle: true,
    displayMode: "original-translated",
    translationFontSize: 12,
    translationGap: 2,
    rowHeightMultiplier: "2",
    autoTranslate: true
  };
  var _prefObserverRegistered = false;
  var _prefObserverRefs = [];
  async function onStartup() {
    Zotero.log("[DualTitle] onStartup: initializing...");
    try {
      initLocale();
    } catch (e) {
      Zotero.log("[DualTitle] Locale init failed: " + e);
    }
    ensureDefaultPrefs();
    registerNotifier();
    registerPrefObserver();
    try {
      await Promise.all([
        Zotero.initializationPromise,
        Zotero.unlockPromise,
        Zotero.uiReadyPromise
      ]);
    } catch (e) {
    }
    const win = Zotero.getMainWindow();
    if (win) {
      registerStyleSheet(win);
      setDocument(win.document);
    }
    try {
      Zotero.PreferencePanes.register({
        pluginID: addon.data.config.addonID,
        src: `chrome://${addon.data.config.addonRef}/content/preferences.xhtml`,
        label: "Dual Title"
      });
      Zotero.log("[DualTitle] Preferences registered");
    } catch (e) {
      Zotero.log("[DualTitle] Prefs registration failed: " + e);
    }
    try {
      patch();
    } catch (e) {
      Zotero.log("[DualTitle] Patch failed: " + e);
    }
    Zotero.log("[DualTitle] Startup complete");
  }
  function ensureDefaultPrefs() {
    const prefix = addon.data.config.prefsPrefix;
    for (const [key, value] of Object.entries(DEFAULT_PREFS)) {
      const fullKey = `${prefix}.${key}`;
      try {
        const existing = Zotero.Prefs.get(fullKey, true);
        if (existing === void 0 || existing === null) {
          Zotero.Prefs.set(fullKey, value, true);
        }
      } catch (e) {
      }
    }
  }
  function registerPrefObserver() {
    if (_prefObserverRegistered) return;
    _prefObserverRegistered = true;
    const prefix = addon.data.config.prefsPrefix;
    const watchedKeys = [
      "enableDualTitle",
      "displayMode",
      "translationFontSize",
      "translationColor",
      "translationGap",
      "rowHeightMultiplier",
      "childRowHeightMode"
    ];
    for (const key of watchedKeys) {
      try {
        const ref = Zotero.Prefs.registerObserver(
          `${prefix}.${key}`,
          () => {
            try {
              setRowHeight();
            } catch (e) {
            }
            try {
              refresh();
            } catch (e) {
            }
          },
          true
        );
        if (ref) _prefObserverRefs.push(ref);
      } catch (e) {
        Zotero.log("[DualTitle] Pref observer register failed for " + key + ": " + e);
      }
    }
  }
  function unregisterPrefObserver() {
    for (const ref of _prefObserverRefs) {
      try {
        Zotero.Prefs.unregisterObserver(ref);
      } catch (e) {
      }
    }
    _prefObserverRefs = [];
    _prefObserverRegistered = false;
  }
  function registerStyleSheet(win) {
    try {
      const doc = win.document;
      if (doc.getElementById("dualtitle-styles")) return;
      const link = doc.createElement("link");
      link.id = "dualtitle-styles";
      link.type = "text/css";
      link.rel = "stylesheet";
      link.href = `chrome://${addon.data.config.addonRef}/content/zoteroPane.css`;
      doc.documentElement?.appendChild(link);
    } catch (e) {
      Zotero.log("[DualTitle] CSS injection failed: " + e);
    }
  }
  async function onMainWindowLoad(win) {
    setDocument(win.document);
    registerStyleSheet(win);
    try {
      win.MozXULElement.insertFTLIfNeeded(
        `${addon.data.config.addonRef}-mainWindow.ftl`
      );
    } catch (e) {
      Zotero.log("[DualTitle] FTL loading failed: " + e);
    }
    try {
      patch();
    } catch (e) {
    }
    Zotero.log("[DualTitle] Main window loaded");
  }
  async function onMainWindowUnload(win) {
  }
  function onShutdown() {
    unregisterPrefObserver();
    unregisterNotifier();
    unpatch();
    addon.data.alive = false;
    delete Zotero[addon.data.config.addonInstance];
    Zotero.log("[DualTitle] Shutdown complete");
  }
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async function onNotify(event, type, ids, extraData) {
    if (event === "add" && type === "item") {
      try {
        const autoTranslate = Zotero.Prefs.get(
          `${addon.data.config.prefsPrefix}.autoTranslate`,
          true
        );
        if (autoTranslate === false) return;
        for (const id of ids) {
          const item = Zotero.Items.get(id);
          if (!item || !item.isRegularItem()) continue;
          const title = item.getField("title");
          if (!title || isChinese(title)) continue;
          if (getTranslationFromExtra(item)) continue;
          delay(500).then(() => {
            translateTitle(item).catch(
              (e) => Zotero.log("[DualTitle] translateTitle failed: " + e)
            );
          });
        }
      } catch (e) {
        Zotero.log("[DualTitle] autoTranslate error: " + e);
      }
    }
  }
  function onPrefsEvent(type, data) {
    if (type === "load") {
      bindPrefPaneUI(data.window);
      return;
    }
    try {
      setRowHeight();
      refresh();
    } catch (e) {
    }
  }
  function bindPrefPaneUI(win) {
    if (!win?.document) return;
    const doc = win.document;
    const prefix = addon.data.config.prefsPrefix;
    const ref = addon.data.config.addonRef;
    const checkboxBindings = [
      { id: `zotero-prefpane-${ref}-enableDualTitle`, key: "enableDualTitle" },
      { id: `zotero-prefpane-${ref}-autoTranslate`, key: "autoTranslate" }
    ];
    for (const { id, key } of checkboxBindings) {
      const cb = doc.getElementById(id);
      if (!cb) continue;
      cb.addEventListener("command", () => {
        if (key === "enableDualTitle") {
          try {
            setRowHeight();
          } catch (e) {
          }
          try {
            refresh();
          } catch (e) {
          }
        }
      });
    }
    const menulistBindings = [
      { id: `zotero-prefpane-${ref}-displayMode`, key: "displayMode" },
      { id: `zotero-prefpane-${ref}-childRowHeightMode`, key: "childRowHeightMode" }
    ];
    for (const { id, key } of menulistBindings) {
      const sel = doc.getElementById(id);
      if (!sel) continue;
      const fullKey = `${prefix}.${key}`;
      try {
        const val = String(Zotero.Prefs.get(fullKey, true));
        sel.value = val;
      } catch (e) {
      }
      sel.addEventListener("command", () => {
        try {
          Zotero.Prefs.set(fullKey, sel.value, true);
          try {
            setRowHeight();
          } catch (e) {
          }
          try {
            refresh();
          } catch (e) {
          }
        } catch (e) {
        }
      });
    }
    const inputBindings = [
      { id: `zotero-prefpane-${ref}-translationFontSize`, key: "translationFontSize" },
      { id: `zotero-prefpane-${ref}-translationColor`, key: "translationColor" },
      { id: `zotero-prefpane-${ref}-translationGap`, key: "translationGap" },
      { id: `zotero-prefpane-${ref}-rowHeightMultiplier`, key: "rowHeightMultiplier" }
    ];
    for (const { id, key } of inputBindings) {
      const inp = doc.getElementById(id);
      if (!inp) continue;
      const fullKey = `${prefix}.${key}`;
      try {
        if (key === "rowHeightMultiplier") {
          try {
            inp.value = Services.prefs.getStringPref(fullKey) ?? "";
          } catch (e) {
            try {
              const v = Services.prefs.getIntPref(fullKey);
              inp.value = String(v);
              Services.prefs.clearUserPref(fullKey);
              Services.prefs.setStringPref(fullKey, String(v));
            } catch (e2) {
              inp.value = "2";
            }
          }
        } else if (key === "translationColor") {
          const stored = String(Zotero.Prefs.get(fullKey, true) ?? "");
          inp.value = stored || "#808080";
        } else {
          inp.value = String(Zotero.Prefs.get(fullKey, true) ?? "");
        }
      } catch (e) {
      }
      inp.addEventListener("change", () => {
        try {
          if (key === "rowHeightMultiplier") {
            Services.prefs.setStringPref(fullKey, inp.value);
          } else {
            Zotero.Prefs.set(fullKey, inp.value, true);
          }
          Zotero.log("[DualTitle] Pref " + key + " = " + inp.value);
          try {
            setRowHeight();
          } catch (e) {
          }
          try {
            refresh();
          } catch (e) {
          }
        } catch (e) {
          Zotero.log("[DualTitle] input handler error: " + e);
        }
      });
    }
    const resetBtn = doc.getElementById(`zotero-prefpane-${ref}-translationColorReset`);
    const colorInput = doc.getElementById(`zotero-prefpane-${ref}-translationColor`);
    if (resetBtn && colorInput) {
      resetBtn.addEventListener("click", () => {
        try {
          Zotero.Prefs.set(`${prefix}.translationColor`, "", true);
          colorInput.value = "#808080";
          Zotero.log("[DualTitle] translationColor reset to default");
          try {
            refresh();
          } catch (e) {
          }
        } catch (e) {
          Zotero.log("[DualTitle] color reset error: " + e);
        }
      });
    }
  }
  function onShortcuts(type) {
    if (type === "translate") {
      const items = Zotero.getMainWindow()?.ZoteroPane?.getSelectedItems();
      if (items?.length) {
        for (const item of items) translateTitle(item);
      }
    }
  }
  var _notifierID = null;
  function registerNotifier() {
    if (_notifierID) return;
    const callback = {
      notify: async (event, type, ids, extraData) => {
        if (!addon?.data?.alive) {
          unregisterNotifier();
          return;
        }
        await onNotify(event, type, ids, extraData);
      }
    };
    _notifierID = Zotero.Notifier.registerObserver(callback, ["item"]);
  }
  function unregisterNotifier() {
    if (_notifierID) {
      try {
        Zotero.Notifier.unregisterObserver(_notifierID);
      } catch (e) {
      }
      _notifierID = null;
    }
  }
  var hooks_default = {
    onStartup,
    onShutdown,
    onMainWindowLoad,
    onMainWindowUnload,
    onNotify,
    onPrefsEvent,
    onShortcuts
  };

  // src/addon.ts
  var Addon = class {
    data;
    hooks;
    api;
    constructor() {
      this.data = {
        alive: true,
        config,
        env: "production"
      };
      this.hooks = hooks_default;
      this.api = {};
    }
  };
  var addon_default = Addon;

  // src/index.ts
  if (!Zotero[config.addonInstance]) {
    _globalThis.addon = new addon_default();
    Zotero[config.addonInstance] = addon;
  }
})();
