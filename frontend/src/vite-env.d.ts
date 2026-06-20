/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly REACT_APP_API_URL: string;
  readonly REACT_APP_VERSION: string;
  readonly DEV_LOGIN_EMAIL: string;
  readonly DEV_LOGIN_PASSWORD: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
