import React from "react";
import { createRoot } from "react-dom/client";
import { Studio } from "./creator/Studio.tsx";
import { Viewer } from "./viewer/Viewer.tsx";
import "./style.css";
const id = /^\/r\/([\w-]+)$/.exec(location.pathname)?.[1];
createRoot(document.getElementById("root") ?? document.body).render(
  <React.StrictMode>{id ? <Viewer id={id} /> : <Studio />}</React.StrictMode>,
);
