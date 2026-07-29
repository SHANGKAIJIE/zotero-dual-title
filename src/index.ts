import Addon from "./addon";
import { config } from "../package.json";

// 不使用 zotero-plugin-toolkit 的 BasicTool（Zotero 9 中 ChromeUtils.import() 已移除）
// 直接检查 Zotero 全局对象
// @ts-ignore
if (!Zotero[config.addonInstance]) {
  _globalThis.addon = new Addon();
  // @ts-ignore
  Zotero[config.addonInstance] = addon;
}
