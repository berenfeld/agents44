import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const DEFAULT_SIDEBAR_WIDTH = 256;
const MIN_SIDEBAR_WIDTH = 200;

function maxSidebarWidth(): number {
  if (typeof window === "undefined") return 720;
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(720, window.innerWidth - 320));
}

function clampSidebarWidth(value: number): number {
  return Math.min(maxSidebarWidth(), Math.max(MIN_SIDEBAR_WIDTH, value));
}

function readSidebarWidth(storageKey: string | undefined): number {
  if (!storageKey || typeof window === "undefined") return DEFAULT_SIDEBAR_WIDTH;
  const raw = window.localStorage.getItem(storageKey);
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_SIDEBAR_WIDTH;
  return clampSidebarWidth(parsed);
}

function ResizeGripIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 28" className="h-7 w-2.5" aria-hidden="true">
      <circle cx="3" cy="4" r="1.25" fill="currentColor" />
      <circle cx="7" cy="4" r="1.25" fill="currentColor" />
      <circle cx="3" cy="10" r="1.25" fill="currentColor" />
      <circle cx="7" cy="10" r="1.25" fill="currentColor" />
      <circle cx="3" cy="16" r="1.25" fill="currentColor" />
      <circle cx="7" cy="16" r="1.25" fill="currentColor" />
      <circle cx="3" cy="22" r="1.25" fill="currentColor" />
      <circle cx="7" cy="22" r="1.25" fill="currentColor" />
    </svg>
  );
}

export function SplitPanelLayout({
  sidebar,
  children,
  className,
  sidebarClassName,
  sidebarWidthKey,
  sidebarCollapsed = false,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  sidebarClassName?: string;
  sidebarWidthKey?: string;
  sidebarCollapsed?: boolean;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => readSidebarWidth(sidebarWidthKey));
  const [dragging, setDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(sidebarWidth);

  useEffect(() => {
    if (!sidebarWidthKey) return;
    window.localStorage.setItem(sidebarWidthKey, String(sidebarWidth));
  }, [sidebarWidth, sidebarWidthKey]);

  const onResizePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartX.current = event.clientX;
    dragStartWidth.current = sidebarWidth;
    setDragging(true);
  }, [sidebarWidth]);

  const onResizePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    setSidebarWidth(clampSidebarWidth(dragStartWidth.current + event.clientX - dragStartX.current));
  }, []);

  const onResizePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  }, []);

  return (
    <div className={cn("flex w-full flex-col gap-4 md:flex-row md:items-stretch md:gap-0", className)}>
      <aside
        className={cn(
          "w-full shrink-0",
          sidebarCollapsed ? "md:hidden" : "md:w-[var(--sidebar-width)]",
          sidebarClassName,
        )}
        style={sidebarCollapsed ? undefined : { ["--sidebar-width" as string]: `${sidebarWidth}px` }}
      >
        {sidebar}
      </aside>
      {!sidebarCollapsed ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize side panel"
          aria-valuenow={Math.round(sidebarWidth)}
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          tabIndex={0}
          title="Drag to resize. Double-click to reset."
          className={cn(
            "relative z-20 hidden w-4 shrink-0 cursor-col-resize select-none flex-col items-center justify-center md:flex",
            "text-slate-400 hover:bg-slate-100 hover:text-slate-700",
            dragging && "bg-slate-200 text-slate-800",
          )}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
          onDoubleClick={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setSidebarWidth((current) => clampSidebarWidth(current - 16));
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              setSidebarWidth((current) => clampSidebarWidth(current + 16));
            }
          }}
        >
          <ResizeGripIcon />
        </div>
      ) : null}
      <section className="min-w-0 flex-1 space-y-3">{children}</section>
    </div>
  );
}

export function PanelCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("h-full rounded-lg border bg-white", className)}>{children}</div>;
}
