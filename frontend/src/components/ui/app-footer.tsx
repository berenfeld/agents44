import { appVersion } from "@/lib/version";

export function AppFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white py-3 text-center text-xs text-slate-500">
      Agents44 v{appVersion()}
    </footer>
  );
}
