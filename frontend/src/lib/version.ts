export function appVersion(): string {
  return import.meta.env.REACT_APP_VERSION || "dev";
}
