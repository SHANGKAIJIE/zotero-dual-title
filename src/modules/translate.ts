/**
 * translate.ts — Dual Title 翻译管理
 *
 * 翻译源：PDF Translate（通过其公开 API 翻译）
 *
 * 注意：不使用 ztoolkit（Zotero 9 中不兼容），直接使用 Zotero 原生 API 读写 extra 字段。
 */

export function detectSource(): string {
  // 翻译源固定使用 PDF Translate
  if (hasPDFTranslate()) return 'pdf-translate';
  return 'none';
}

function hasPDFTranslate(): boolean {
  return typeof (Zotero as any).PDFTranslate?.api?.translate === 'function';
}

/**
 * 设置 extra 字段中的翻译
 * 直接操作 item.setField() 避免依赖 ztoolkit
 */
function setExtraTranslation(item: Zotero.Item, key: string, value: string) {
  const existingExtra = item.getField('extra') as string || '';
  const lines = existingExtra ? existingExtra.split('\n') : [];
  const normalizedKey = key.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  
  let found = false;
  const newLines = lines.map(line => {
    const match = line.match(/^([a-zA-Z][a-zA-Z -_]+):(.+)$/);
    if (match) {
      const lineKey = match[1].trim()
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .toLowerCase()
        .replace(/[\s_]+/g, '-');
      if (lineKey === normalizedKey) {
        found = true;
        // 保持原 key 格式不变，只替换值
        return match[1].trim() + ': ' + value;
      }
    }
    return line;
  });

  if (!found) {
    // 与原格式保持一致，直接使用原始 camelCase key（无中划线转换）
    // 例如 "titleTranslation" 而非 "title-Translation"（匹配 PDF Translate 格式）
    const displayKey = key;
    newLines.push(displayKey + ': ' + value);
  }

  item.setField('extra', newLines.join('\n'));
}

/**
 * 读取 extra 字段中的翻译
 */
function getExtraTranslation(item: Zotero.Item, key: string): string | null {
  // 方法1：Zotero 原生 extractExtraFields（如果可用）
  try {
    const fields = Zotero.Utilities.Internal.extractExtraFields(item.getField('extra') as string);
    if (fields?.fields) {
      for (const entry of fields.fields) {
        if (Array.isArray(entry) && entry.length >= 2) {
          const k = String(entry[0]);
          const v = String(entry[1] || '');
          const nk = k.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().replace(/[\s_]+/g, '-');
          const nKey = key.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().replace(/[\s_]+/g, '-');
          if (nk === nKey) return v;
        }
      }
    }
  } catch {}

  // 方法2：直接文本解析
  const extra = item.getField('extra') as string;
  if (!extra) return null;

  const lines = extra.split('\n');
  const normalizedKey = key.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().replace(/[\s_]+/g, '-');

  for (const line of lines) {
    const match = line.match(/^([a-zA-Z][a-zA-Z -_]+):\s*(.+)$/);
    if (!match) continue;
    const lineKey = match[1].trim()
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase()
      .replace(/[\s_]+/g, '-');
    if (lineKey === normalizedKey) return match[2].trim();
  }
  return null;
}

export async function translateTitle(item: Zotero.Item): Promise<string | null> {
  if (!item.isRegularItem()) return null;
  const title = item.getField('title') as string;
  if (!title) return null;

  const existing = getTranslationFromExtra(item);
  if (existing) return existing;

  const source = detectSource();
  if (source === 'none') return null;

  let result: string | null = null;
  try {
    if (source === 'pdf-translate') {
      result = await translateViaPDFT(item, title);
    }
  } catch (e: any) {
    Zotero.logError(new Error("[DualTitle] Translation failed: " + String(e?.message || e)));
    return null;
  }

  if (result) {
    setExtraTranslation(item, "titleTranslation", result);
    await item.saveTx();
  }
  return result;
}

export async function translateBatch(items: Zotero.Item[]): Promise<void> {
  const sourceType = detectSource();
  if (sourceType !== 'pdf-translate') return;
  await translateBatchViaPDFT(items);
}

async function translateViaPDFT(item: Zotero.Item, title: string): Promise<string | null> {
  const task = await (Zotero as any).PDFTranslate.api.translate(title, {
    pluginID: 'dualtitle@dual-title.zotero',
    itemID: item.id,
  });
  return task?.status === 'success' ? task.result : null;
}

async function translateBatchViaPDFT(items: Zotero.Item[]): Promise<void> {
  const tasks = items
    .filter(item => item.isRegularItem() && !getTranslationFromExtra(item))
    .map(item => ({
      id: `${Zotero.Utilities.randomString()}-${Date.now()}`,
      type: 'title' as const,
      raw: item.getField('title') as string,
      result: '', audio: [],
      service: '', candidateServices: [],
      itemId: item.id, status: 'waiting' as const,
      extraTasks: [], silent: true,
    }));
  if (tasks.length === 0) return;
  await (Zotero as any).PDFTranslate.hooks.onTranslateInBatch(tasks, {
    noDisplay: true, noCache: true,
  });
}

/**
 * 从 extra 字段读取翻译（优先 titleTranslation，回退 dualRowTranslation）
 */
export function getTranslationFromExtra(item: Zotero.Item): string | null {
  let trans = getExtraTranslation(item, "titleTranslation");
  if (trans) return trans;
  trans = getExtraTranslation(item, "dualRowTranslation");
  if (trans) return trans;
  return null;
}

export function isChinese(text: string): boolean {
  const cjkChars = text.match(/[\u4e00-\u9FFF\u3400-\u4DBF]/g);
  if (!cjkChars) return false;
  return cjkChars.length / text.length > 0.3;
}
