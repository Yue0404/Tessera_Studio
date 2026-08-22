import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ProductionAppLoader } from "./components/ProductionAppLoader.js";
import "./i18n.js";
import "./styles/global.css";

const root = document.querySelector("#root");
if (root === null) throw new Error("缺少应用根节点");

createRoot(root).render(
  <StrictMode>
    <ProductionAppLoader />
  </StrictMode>,
);
