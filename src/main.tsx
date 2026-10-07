import React from "react";
import ReactDOM from "react-dom/client";
import { SubtitleMeter } from "./features/subtitle-meter/views/SubtitleMeter";
import "./styles.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SubtitleMeter />
  </React.StrictMode>,
);
