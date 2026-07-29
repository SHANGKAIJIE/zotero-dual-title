/**
 * menu.ts — Dual Title 右键菜单
 *
 * 使用直接 label 而非 l10nID，避免 FTL 未加载时菜单系统报错。
 */

import { config } from "../../package.json";
import { translateTitle } from "./translate";

let _registeredMenuID: string | false | null = null;

/**
 * 注册右键菜单项
 * 幂等：如果已注册则先注销再重新注册
 */
export function registerMenu() {
  // 先注销已有菜单
  if (_registeredMenuID) {
    try {
      Zotero.MenuManager.unregisterMenu(_registeredMenuID);
    } catch (e) {}
    _registeredMenuID = null;
  }

  // 检查 MenuManager 是否可用
  if (!Zotero.MenuManager?.registerMenu) {
    Zotero.log("[DualTitle] MenuManager not available, skipping menu registration");
    return;
  }

  try {
    _registeredMenuID = Zotero.MenuManager.registerMenu({
      menuID: `${config.addonRef}-translate-title`,
      pluginID: config.addonID,
      target: "main/library/item",
      menus: [
        {
          menuType: "menuitem",
          // 使用 l10nID，FTL 文件通过 MozXULElement.insertFTLIfNeeded 加载
          l10nID: `${config.addonRef}-itemmenu-translate-title`,
          onCommand: async (event: any, context: any) => {
            try {
              if (!context.items?.length) return;
              for (const item of context.items) {
                await translateTitle(item);
              }
              try {
                (Zotero as any).ZoteroPane?.itemsView?.refresh?.();
              } catch (e) {}
            } catch (e) {
              Zotero.log("[DualTitle] menu onCommand error: " + e);
            }
          },
          onShowing: (event: any, context: any) => {
            try {
              context.setVisible(
                !!(
                  context.items?.length &&
                  context.items?.every((item: Zotero.Item) => item.isRegularItem())
                ),
              );
            } catch (e) {
              // 如果 setVisible 失败，不影响菜单显示
            }
          },
        },
      ],
    });
    Zotero.log("[DualTitle] Menu registered: " + _registeredMenuID);
  } catch (e) {
    Zotero.log("[DualTitle] Menu registration failed: " + e);
  }
}

/**
 * 注销右键菜单
 */
export function unregisterMenu() {
  if (_registeredMenuID) {
    try {
      Zotero.MenuManager.unregisterMenu(_registeredMenuID);
    } catch (e) {}
    _registeredMenuID = null;
  }
}
