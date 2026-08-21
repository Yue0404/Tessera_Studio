import { ProjectRepository } from "@tessera/storage";
import { App } from "./App.js";

// 浏览器页面只使用一个仓库连接，避免 StrictMode 双渲染构造无人负责关闭的实例。
const productionRepository = new ProjectRepository();

export function ProductionApp() {
  return <App repository={productionRepository} />;
}
