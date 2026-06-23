import { useAppHealth } from "@/hooks/useAppHealth";

export function AppFooter() {
  const { version, serverTimeUtc } = useAppHealth();

  return (
    <footer className="border-t border-slate-200 bg-white py-3 text-center text-xs text-slate-500">
      Agents44 v{version ?? "…"}
      {serverTimeUtc ? ` · ${serverTimeUtc}` : null}
    </footer>
  );
}
