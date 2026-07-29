/* eslint-disable no-undef */

var chromeHandle;

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  if (!rootURI) {
    rootURI = resourceURI.spec;
  }

  var aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "__addonRef__", rootURI + "content/"],
  ]);

  // 加载 prefs.js — 注册默认偏好值
  // 必须在加载主脚本前完成，以便偏好面板的 preference 绑定能读到默认值
  try {
    const prefsCtx = {
      pref: (key, value) => {
        // prefs.js 中 pref("enableDualTitle", true) 使用短名
        // Zotero 期望完整 key：extensions.zotero.<addonRef>.<key>
        const fullKey = key.startsWith("extensions.zotero.")
          ? key
          : `extensions.zotero.__addonRef__.${key}`;
        // 仅当未设置时写入默认值，避免覆盖用户已有设置
        try {
          const existing = Zotero.Prefs.get(fullKey, true);
          if (existing === undefined || existing === null) {
            Zotero.Prefs.set(fullKey, value, true);
          }
        } catch (e) {
          Zotero.Prefs.set(fullKey, value, true);
        }
      },
    };
    prefsCtx._globalThis = prefsCtx;
    Services.scriptloader.loadSubScript(`${rootURI}prefs.js`, prefsCtx);

    // 修复：如果 rowHeightMultiplier 之前被存储为 INT 类型（旧版本），
    // 清除旧值并以 STRING 类型重新设置，避免 setIntPref 截断小数
    try {
      const rhmKey = `extensions.zotero.__addonRef__.rowHeightMultiplier`;
      const prefType = Services.prefs.getPrefType(rhmKey);
      if (prefType === Services.prefs.PREF_INT) {
        // 旧版本存储为 INT，读取旧值并转换为 STRING
        let oldVal = "2";
        try { oldVal = String(Services.prefs.getIntPref(rhmKey)); } catch (e) {}
        Services.prefs.clearUserPref(rhmKey);
        Services.prefs.setStringPref(rhmKey, oldVal);
        Zotero.log("[DualTitle] Migrated rowHeightMultiplier from INT to STRING: " + oldVal);
      } else if (prefType === 0) {
        // 未设置，创建为 STRING
        Services.prefs.setStringPref(rhmKey, "2");
        Zotero.log("[DualTitle] Created rowHeightMultiplier as STRING: 2");
      }
    } catch (e) {
      Zotero.log("[DualTitle] rowHeightMultiplier migration failed: " + e);
    }
  } catch (e) {
    Zotero.log("[DualTitle] prefs.js load failed: " + e);
  }

  const ctx = {
    rootURI,
  };
  ctx._globalThis = ctx;

  Services.scriptloader.loadSubScript(
    `${rootURI}content/scripts/__addonRef__.js`,
    ctx,
  );
  Zotero.__addonInstance__.hooks.onStartup();
}

async function onMainWindowLoad({ window }, reason) {
  Zotero.__addonInstance__?.hooks.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
  Zotero.__addonInstance__?.hooks.onMainWindowUnload(window);
}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }

  if (typeof Zotero === "undefined") {
    Zotero = Components.classes["@zotero.org/Zotero;1"].getService(
      Components.interfaces.nsISupports,
    ).wrappedJSObject;
  }
  Zotero.__addonInstance__?.hooks.onShutdown();

  Cc["@mozilla.org/intl/stringbundle;1"]
    .getService(Components.interfaces.nsIStringBundleService)
    .flushBundles();

  Cu.unload(`${rootURI}content/scripts/__addonRef__.js`);

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

function uninstall(data, reason) {}
