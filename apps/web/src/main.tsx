import React from "react";
import { createRoot } from "react-dom/client";
import { Studio } from "./creator/Studio.tsx";
import { Viewer } from "./viewer/Viewer.tsx";
import { ReaderHome } from "./viewer/ReaderHome.tsx";
import "./style.css";
import { installClientDiagnostics } from "./client.ts";
installClientDiagnostics();
const id = /^\/r\/([\w-]+)$/.exec(location.pathname)?.[1];
const reader =
  document
    .querySelector('meta[name="thatbit-app"], meta[name="replylink-app"]')
    ?.getAttribute("content") === "reader";
createRoot(document.getElementById("root") ?? document.body).render(
  <React.StrictMode>
    {id ? <Viewer id={id} /> : reader ? <ReaderHome /> : <Studio />}
  </React.StrictMode>,
);
