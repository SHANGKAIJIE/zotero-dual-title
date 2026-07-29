import { config } from "../../package.json";

type PluginPrefsMap = _ZoteroTypes.Prefs["PluginPrefsMap"];

const PREFS_PREFIX = config.prefsPrefix;

// 默认值（当 prefs.js 未加载时的回退）
// 注意：translationFontSize 使用 px（默认 12），不再使用 em 倍率
// 注意：rowHeightMultiplier 使用字符串类型，避免 Mozilla 偏好系统按 int 截断小数
const DEFAULT_VALUES: Record<string, any> = {
  enableDualTitle: true,
  displayMode: "original-translated",
  translationFontSize: 12,
  translationColor: "",
  translationGap: 2,
  rowHeightMultiplier: "2",
  childRowHeightMode: "keep",
  autoTranslate: true,
};

export function getPref<K extends keyof PluginPrefsMap>(key: K) {
  const fullKey = `${PREFS_PREFIX}.${key}`;
  // 对于 rowHeightMultiplier，强制使用 getStringPref 读取
  // 因为旧版本可能将其存储为 INT 类型，导致小数被截断
  if (key === 'rowHeightMultiplier' as string) {
    try {
      const prefType = Services.prefs.getPrefType(fullKey);
      if (prefType === Services.prefs.PREF_STRING) {
        return Services.prefs.getStringPref(fullKey) as PluginPrefsMap[K];
      } else if (prefType === Services.prefs.PREF_INT) {
        // 旧版本残留 INT 类型，读取并转换为 STRING
        const intVal = Services.prefs.getIntPref(fullKey);
        Services.prefs.clearUserPref(fullKey);
        Services.prefs.setStringPref(fullKey, String(intVal));
        return String(intVal) as PluginPrefsMap[K];
      }
      return DEFAULT_VALUES[key as string] as PluginPrefsMap[K];
    } catch (e) {
      return DEFAULT_VALUES[key as string] as PluginPrefsMap[K];
    }
  }
  // 尝试获取存储的值
  const val = Zotero.Prefs.get(fullKey, true);
  // 如果为 undefined，使用默认值
  if (val === undefined || val === null) {
    return DEFAULT_VALUES[key as string] as PluginPrefsMap[K];
  }
  return val as PluginPrefsMap[K];
}

export function setPref<K extends keyof PluginPrefsMap>(
  key: K,
  value: PluginPrefsMap[K],
) {
  return Zotero.Prefs.set(`${PREFS_PREFIX}.${key}`, value, true);
}

export function clearPref(key: string) {
  return Zotero.Prefs.clear(`${PREFS_PREFIX}.${key}`, true);
}
