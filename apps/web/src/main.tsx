import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";
import { App } from "./App.js";
import "./i18n.js";
import "./styles/global.css";

const root = document.querySelector("#root");
if (root === null) throw new Error("缺少应用根节点");

createRoot(root).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
