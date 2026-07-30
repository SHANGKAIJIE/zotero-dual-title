// Dual Title 默认偏好设置
// 注意：translationFontSize 使用 px（默认 12），不再使用 em 倍率
pref("enableDualTitle", true);
pref("displayMode", "original-translated");
pref("titleOrder", "original-first");
pref("subtitleFontWeight", "normal");
pref("translationFontSize", 12);
pref("translationColor", "");
pref("translationGap", 2);
pref("autoTranslate", true);
// rowHeightMultiplier 以字符串类型注册，避免 Mozilla 偏好系统按 int 截断小数
pref("rowHeightMultiplier", "2");
// childRowHeightMode: "follow"=跟随主条目, "keep"=保持不变
pref("childRowHeightMode", "keep");
