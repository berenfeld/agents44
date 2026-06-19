import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(PROJECT_ROOT, ".env");

function loadProjectEnv(): Record<string, string> {
  if (!fs.existsSync(ENV_FILE)) {
    return {};
  }
  return dotenv.parse(fs.readFileSync(ENV_FILE));
}

export default defineConfig(() => {
  const env = loadProjectEnv();
  return {
    plugins: [react()],
    envPrefix: ["VITE_", "REACT_APP_"],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    define: {
      "import.meta.env.REACT_APP_API_URL": JSON.stringify(env.REACT_APP_API_URL || "/api"),
    },
    server: {
      port: 3000,
      strictPort: true,
      proxy: {
        "/api": "http://127.0.0.1:5000",
      },
    },
  };
});
