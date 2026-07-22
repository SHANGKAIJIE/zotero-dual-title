/**
 * hooks.ts — Dual Title 生命周期钩子
 *
 * 完全不使用 ztoolkit（Zotero 9 中 ChromeUtils.import() 已移除）。
 * 所有操作直接使用 Zotero 原生 API。
 */

import { initLocale } from "./utils/locale";
import { patch, unpatch, setDocument, refresh, setRowHeight } from "./modules/itemTreePatch";
import { registerMenu, unregisterMenu } from "./modules/menu";
import { translateTitle, isChinese, getTranslationFromExtra } from "./modules/translate";

// 默认偏好值（兜底，prefs.js 应已注册，此处仅作双保险）
// 注意：translationFontSize 现在使用 px（默认 12），不再使用 em 倍率
// 注意：rowHeightMultiplier 使用字符串类型，避免 Mozilla 偏好系统按 int 截断小数
const DEFAULT_PREFS: Record<string, any> = {
  enableDualTitle: true,
  displayMode: "original-translated",
  translationFontSize: 12,
  translationGap: 2,
  rowHeightMultiplier: "2",
  autoTranslate: true,
};

let _prefObserverRegistered = false;
let _prefObserverRefs: any[] = [];

async function onStartup() {
  Zotero.log("[DualTitle] onStartup: initializing...");

  try { initLocale(); } catch (e) { Zotero.log("[DualTitle] Locale init failed: " + e); }

  // 确保默认偏好已设置（双保险，bootstrap 已加载 prefs.js）
  ensureDefaultPrefs();

  // 注册通知监听
  registerNotifier();

  // 注册偏好变化观察者 — 设置改变后立即刷新列表
  registerPrefObserver();

  // 等待主窗口与 UI 就绪后再注入 CSS / 打补丁
  try {
    await Promise.all([
      Zotero.initializationPromise,
      Zotero.unlockPromise,
      Zotero.uiReadyPromise,
    ]);
  } catch (e) {}

  // 注入 CSS
  const win = Zotero.getMainWindow();
  if (win) {
    registerStyleSheet(win);
    setDocument(win.document);
  }

  // 注册偏好面板
  try {
    Zotero.PreferencePanes.register({
      pluginID: addon.data.config.addonID,
      src: `chrome://${addon.data.config.addonRef}/content/preferences.xhtml`,
      label: "Dual Title",
    });
    Zotero.log("[DualTitle] Preferences registered");
  } catch (e) {
    Zotero.log("[DualTitle] Prefs registration failed: " + e);
  }

  // 应用补丁
  try {
    patch();
  } catch (e) {
    Zotero.log("[DualTitle] Patch failed: " + e);
  }

  // 注册右键菜单（暂时禁用，排查右键无响应问题）
  // try {
  //   registerMenu();
  // } catch (e) {
  //   Zotero.log("[DualTitle] Menu registration failed: " + e);
  // }

  Zotero.log("[DualTitle] Startup complete");
}

/**
 * 确保默认偏好值已写入 Zotero 偏好存储（双保险）
 */
function ensureDefaultPrefs() {
  const prefix = addon.data.config.prefsPrefix;
  for (const [key, value] of Object.entries(DEFAULT_PREFS)) {
    const fullKey = `${prefix}.${key}`;
    try {
      const existing = Zotero.Prefs.get(fullKey, true);
      if (existing === undefined || existing === null) {
        Zotero.Prefs.set(fullKey, value, true);
      }
    } catch (e) {
      // 静默处理
    }
  }
}

/**
 * 注册偏好变化观察者
 * 当 enableDualTitle / displayMode / translationFontSize / translationGap / rowHeightMultiplier 改变时刷新列表
 */
function registerPrefObserver() {
  if (_prefObserverRegistered) return;
  _prefObserverRegistered = true;
  const prefix = addon.data.config.prefsPrefix;

  const watchedKeys = [
    "enableDualTitle",
    "displayMode",
    "translationFontSize",
    "translationGap",
    "rowHeightMultiplier",
  ];

  for (const key of watchedKeys) {
    try {
      const ref = Zotero.Prefs.registerObserver(
        `${prefix}.${key}`,
        () => {
          // 偏好变化：更新行高并刷新列表
          try { setRowHeight(); } catch (e) {}
          try { refresh(); } catch (e) {}
        },
        true,
      );
      if (ref) _prefObserverRefs.push(ref);
    } catch (e) {
      Zotero.log("[DualTitle] Pref observer register failed for " + key + ": " + e);
    }
  }
}

function unregisterPrefObserver() {
  for (const ref of _prefObserverRefs) {
    try { Zotero.Prefs.unregisterObserver(ref); } catch (e) {}
  }
  _prefObserverRefs = [];
  _prefObserverRegistered = false;
}

function registerStyleSheet(win: any) {
  try {
    const doc = win.document;
    // 避免重复注入
    if (doc.getElementById('dualtitle-styles')) return;

    const link = doc.createElement('link');
    link.id = 'dualtitle-styles';
    link.type = "text/css";
    link.rel = "stylesheet";
    link.href = `chrome://${addon.data.config.addonRef}/content/zoteroPane.css`;
    doc.documentElement?.appendChild(link);
  } catch (e) {
    Zotero.log("[DualTitle] CSS injection failed: " + e);
  }
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  setDocument(win.document);
  registerStyleSheet(win);

  // 加载主窗口 FTL 本地化文件（菜单项标签等）
  try {
    // @ts-ignore MozXULElement is a Mozilla-specific API
    win.MozXULElement.insertFTLIfNeeded(
      `${addon.data.config.addonRef}-mainWindow.ftl`
    );
  } catch (e) {
    Zotero.log("[DualTitle] FTL loading failed: " + e);
  }

  try { patch(); } catch (e) {}

  Zotero.log("[DualTitle] Main window loaded");
}

async function onMainWindowUnload(win: Window): Promise<void> {}

function onShutdown(): void {
  unregisterPrefObserver();
  unregisterNotifier();
  // unregisterMenu(); // 菜单已禁用
  unpatch();
  addon.data.alive = false;
  delete (Zotero as any)[addon.data.config.addonInstance];
  Zotero.log("[DualTitle] Shutdown complete");
}

// 跨版本 delay：Zotero 7 中 Zotero.Promise.delay 可用，Zotero 9 中已移除
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: any },
) {
  // 新条目自动翻译
  if (event === "add" && type === "item") {
    try {
      const autoTranslate = Zotero.Prefs.get(
        `${addon.data.config.prefsPrefix}.autoTranslate`, true);
      if (autoTranslate === false) return;

      for (const id of ids) {
        const item = Zotero.Items.get(id as number);
        if (!item || !item.isRegularItem()) continue;
        const title = item.getField("title") as string;
        if (!title || isChinese(title)) continue;
        if (getTranslationFromExtra(item)) continue;

        // 使用原生 setTimeout 兼容 Zotero 9
        delay(500).then(() => {
          translateTitle(item).catch((e: any) =>
            Zotero.log("[DualTitle] translateTitle failed: " + e)
          );
        });
      }
    } catch (e) {
      Zotero.log("[DualTitle] autoTranslate error: " + e);
    }
  }

  // 条目修改后刷新显示
  if (event === "modify" && type === "item") {
    try { refresh(); } catch (e) {}
  }
}

/**
 * 偏好面板事件
 * - load: 面板加载，绑定 HTML checkbox/select/input ↔ Zotero.Prefs
 * - pref: 偏好值改变时触发刷新
 */
function onPrefsEvent(type: string, data: { [key: string]: any }) {
  if (type === "load") {
    bindPrefPaneUI(data.window);
    return;
  }
  // 其他事件触发刷新
  try {
    setRowHeight();
    refresh();
  } catch (e) {}
}

/**
 * 绑定偏好面板中的 HTML 控件和 XUL 控件
 * 从 onPrefsEvent('load', { window }) 获得的 window.document 是偏好面板的内层文档
 * 注意：内联 <html:script> 在 Zotero 偏好面板中不会执行（片段加载方式剥离 script），
 * 因此必须在此回调中操作 DOM
 * 注意：HTML <select> / <input> 的 preference 属性在 Zotero 中不自动绑定（仅 XUL 元素支持），
 * 必须手动读写 Zotero.Prefs
 * menulist 是 XUL 元素，支持 preference 属性自动绑定
 */
function bindPrefPaneUI(win: Window | undefined) {
  if (!win?.document) return;
  const doc = win.document;
  const prefix = addon.data.config.prefsPrefix;
  const ref = addon.data.config.addonRef;

  // —— Checkbox 绑定 ——
  // 使用 XUL 原生 preference 属性绑定（在 preferences.xhtml 中设置）
  // 此处仅添加 command 事件监听以触发 UI 刷新
  // XUL <checkbox> 触发 command 事件
  const checkboxBindings = [
    { id: `zotero-prefpane-${ref}-enableDualTitle`, key: "enableDualTitle" },
    { id: `zotero-prefpane-${ref}-autoTranslate`, key: "autoTranslate" },
  ];
  for (const { id, key } of checkboxBindings) {
    const cb = doc.getElementById(id) as any;
    if (!cb) continue;
    // preference 属性已自动绑定偏好值，无需手动设置 checked
    cb.addEventListener("command", () => {
      // 仅触发 UI 刷新，偏好值已由 preference 属性自动管理
      if (key === "enableDualTitle") {
        try { setRowHeight(); } catch (e) {}
        try { refresh(); } catch (e) {}
      }
    });
  }

  // —— Menulist 绑定（标题内容） ——
  // menulist 是 XUL 元素，但为保险起见仍手动绑定
  const menulistBindings = [
    { id: `zotero-prefpane-${ref}-displayMode`, key: "displayMode" },
  ];
  for (const { id, key } of menulistBindings) {
    const sel = doc.getElementById(id) as any;
    if (!sel) continue;
    const fullKey = `${prefix}.${key}`;
    try {
      const val = String(Zotero.Prefs.get(fullKey, true));
      sel.value = val;
    } catch (e) {}
    sel.addEventListener("command", () => {
      try {
        Zotero.Prefs.set(fullKey, sel.value, true);
        try { setRowHeight(); } catch (e) {}
        try { refresh(); } catch (e) {}
      } catch (e) {}
    });
  }

  // —— Text Input 绑定（字号 px、间距 px、行高倍率） ——
  // 注意：rowHeightMultiplier 必须以 STRING 类型存储，避免 Mozilla 偏好系统
  // 的 getPrefType 检测到 INT 类型后用 setIntPref 截断小数
  const inputBindings = [
    { id: `zotero-prefpane-${ref}-translationFontSize`, key: "translationFontSize" },
    { id: `zotero-prefpane-${ref}-translationGap`, key: "translationGap" },
    { id: `zotero-prefpane-${ref}-rowHeightMultiplier`, key: "rowHeightMultiplier" },
  ];
  for (const { id, key } of inputBindings) {
    const inp = doc.getElementById(id) as HTMLInputElement;
    if (!inp) continue;
    const fullKey = `${prefix}.${key}`;
    try {
      // 读取：对于 rowHeightMultiplier 强制使用 getStringPref 以获得字符串值
      if (key === 'rowHeightMultiplier') {
        try {
          inp.value = Services.prefs.getStringPref(fullKey) ?? '';
        } catch (e) {
          // 如果偏好类型不是 STRING（旧版本残留 INT），尝试读取后转换
          try {
            const v = Services.prefs.getIntPref(fullKey);
            inp.value = String(v);
            // 同时修复偏好类型
            Services.prefs.clearUserPref(fullKey);
            Services.prefs.setStringPref(fullKey, String(v));
          } catch (e2) {
            inp.value = '2';
          }
        }
      } else {
        inp.value = String(Zotero.Prefs.get(fullKey, true) ?? '');
      }
    } catch (e) {}
    // 使用 change 事件而非 input 事件，避免数值输入过程中频繁刷新
    inp.addEventListener("change", () => {
      try {
        if (key === 'rowHeightMultiplier') {
          // 强制 STRING 类型写入
          Services.prefs.setStringPref(fullKey, inp.value);
        } else {
          Zotero.Prefs.set(fullKey, inp.value, true);
        }
        Zotero.log("[DualTitle] Pref " + key + " = " + inp.value);
        try { setRowHeight(); } catch (e) {}
        try { refresh(); } catch (e) {}
      } catch (e) {
        Zotero.log("[DualTitle] input handler error: " + e);
      }
    });
  }
}

function onShortcuts(type: string) {
  if (type === "translate") {
    const items = Zotero.getMainWindow()?.ZoteroPane?.getSelectedItems();
    if (items?.length) {
      for (const item of items) translateTitle(item);
    }
  }
}

let _notifierID: string | null = null;
function registerNotifier() {
  if (_notifierID) return;
  const callback = {
    notify: async (
      event: string, type: string, ids: Array<string | number>,
      extraData: { [key: string]: any },
    ) => {
      if (!addon?.data?.alive) { unregisterNotifier(); return; }
      await onNotify(event, type, ids, extraData);
    },
  };
  _notifierID = Zotero.Notifier.registerObserver(callback, ["item"]);
}

function unregisterNotifier() {
  if (_notifierID) {
    try {
      Zotero.Notifier.unregisterObserver(_notifierID);
    } catch (e) {}
    _notifierID = null;
  }
}

export default {
  onStartup, onShutdown, onMainWindowLoad, onMainWindowUnload,
  onNotify, onPrefsEvent, onShortcuts,
};
