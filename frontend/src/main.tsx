import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppHealthProvider } from "@/components/app-health-provider";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppHealthProvider>
        <App />
      </AppHealthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
