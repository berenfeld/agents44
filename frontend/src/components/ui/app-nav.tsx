import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/agents", label: "Agents", match: (path: string) => path === "/agents" },
  { to: "/agents_runs", label: "Agents Runs", match: (path: string) => path.startsWith("/agents_runs") || path.startsWith("/runs") },
  { to: "/departments", label: "Departments", match: (path: string) => path.startsWith("/departments") },
  { to: "/agents_files", label: "Agent Files", match: (path: string) => path.startsWith("/agents_files") || path.startsWith("/files") },
  { to: "/agent_database", label: "Agent Database", match: (path: string) => path.startsWith("/agent_database") },
  { to: "/settings", label: "Settings", match: (path: string) => path.startsWith("/settings") },
] as const;

function linkClass(isActive: boolean) {
  return cn(
    "block rounded-md px-3 py-2 text-sm transition-colors",
    isActive ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100",
  );
}

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
    </svg>
  );
}

function activeNavItem(pathname: string) {
  return NAV_ITEMS.find((item) => item.match(pathname)) ?? NAV_ITEMS[0];
}

export function AppNav() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = activeNavItem(location.pathname);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <>
      <nav className="hidden items-center gap-1 md:flex">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => linkClass(isActive)}>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div ref={menuRef} className="relative md:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="listbox"
          className="inline-flex w-full min-w-[10rem] items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="inline-flex items-center gap-2 truncate">
            <MenuIcon />
            <span className="truncate">{current.label}</span>
          </span>
          <ChevronDownIcon open={open} />
        </button>

        {open ? (
          <div
            role="listbox"
            className="absolute left-0 top-full z-50 mt-1 w-full min-w-[12rem] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          >
            {NAV_ITEMS.map((item) => {
              const isActive = item.to === current.to;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  role="option"
                  aria-selected={isActive}
                  className={cn("mx-1 block", linkClass(isActive))}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </NavLink>
              );
            })}
          </div>
        ) : null}
      </div>
    </>
  );
}
