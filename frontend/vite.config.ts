import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";
import { execSync } from "node:child_process";
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

function resolveAppVersion(env: Record<string, string>): string {
  if (process.env.REACT_APP_VERSION) {
    return process.env.REACT_APP_VERSION;
  }
  if (env.REACT_APP_VERSION) {
    return env.REACT_APP_VERSION;
  }
  try {
    return execSync("bash scripts/git-version.sh", { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}

export default defineConfig(() => {
  const env = loadProjectEnv();
  const appVersion = resolveAppVersion(env);
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
      "import.meta.env.REACT_APP_VERSION": JSON.stringify(appVersion),
      "import.meta.env.DEV_LOGIN_EMAIL": JSON.stringify(env.DEV_LOGIN_EMAIL || ""),
      "import.meta.env.DEV_LOGIN_PASSWORD": JSON.stringify(env.DEV_LOGIN_PASSWORD || ""),
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
