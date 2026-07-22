import { config } from "../../package.json";

export { initLocale, getString, getLocaleID };

// 缓存 Localization 实例
let _l10n: any = null;

function initLocale() {
  try {
    _l10n = new Localization([`${config.addonRef}-addon.ftl`], true);
    addon.data.locale = { current: _l10n };
  } catch {
    // 使用备用 Localization 获取方式
    try {
      const L10n = (Zotero as any)[Symbol.for("Localization")] || Localization;
      _l10n = new L10n([`${config.addonRef}-addon.ftl`], true);
      addon.data.locale = { current: _l10n };
    } catch {}
  }
}

function getString(localString: string): string;
function getString(localString: string, branch: string): string;
function getString(
  localeString: string,
  options: { branch?: string | undefined; args?: Record<string, unknown> },
): string;
function getString(...inputs: any[]) {
  if (inputs.length === 1) return _getString(inputs[0]);
  if (inputs.length === 2) {
    if (typeof inputs[1] === "string") return _getString(inputs[0], { branch: inputs[1] });
    return _getString(inputs[0], inputs[1]);
  }
  return inputs[0] || '';
}

function _getString(
  localeString: string,
  options: { branch?: string | undefined; args?: Record<string, unknown> } = {},
): string {
  const l10n = addon.data.locale?.current || _l10n;
  if (!l10n) return localeString;

  const localStringWithPrefix = `${config.addonRef}-${localeString}`;
  const { branch, args } = options;

  try {
    const pattern = l10n.formatMessagesSync([{ id: localStringWithPrefix, args }])[0];
    if (!pattern) return localStringWithPrefix;
    if (branch && pattern.attributes) {
      for (const attr of pattern.attributes) {
        if (attr.name === branch) return attr.value;
      }
    }
    return pattern.value || localStringWithPrefix;
  } catch {
    return localStringWithPrefix;
  }
}

function getLocaleID(id: string) {
  return `${config.addonRef}-${id}`;
}
