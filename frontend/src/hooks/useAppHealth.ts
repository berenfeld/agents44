import { createContext, useContext } from "react";

export type HealthResponse = {
  ok: boolean;
  version: string;
  utc: string;
};

export type AppHealthContextValue = {
  version: string | null;
  serverTimeUtc: string | null;
};

export const AppHealthContext = createContext<AppHealthContextValue>({
  version: null,
  serverTimeUtc: null,
});

export function useAppHealth() {
  return useContext(AppHealthContext);
}
