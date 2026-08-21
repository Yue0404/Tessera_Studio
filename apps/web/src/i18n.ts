import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { zhCN } from "./locales/zh-CN.js";

void i18n.use(initReactI18next).init({
  lng: "zh-CN",
  fallbackLng: "zh-CN",
  resources: { "zh-CN": zhCN },
  interpolation: { escapeValue: false },
  returnNull: false,
  parseMissingKeyHandler: (key) => {
    if (import.meta.env.DEV || import.meta.env.MODE === "test")
      throw new Error(`缺少 locale key: ${key}`);
    return key;
  },
});

export default i18n;
