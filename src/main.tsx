import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { HeadlessReelRenderer } from "./HeadlessReelRenderer";
import "./styles.css";

const Root = new URLSearchParams(window.location.search).get("scheduler-render") === "1"
  ? HeadlessReelRenderer
  : App;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
