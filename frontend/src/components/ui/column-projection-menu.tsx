import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

function SearchIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-3.5 w-3.5 shrink-0 text-slate-400"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={cn("h-3.5 w-3.5", className)}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export type ColumnProjectionItem = {
  name: string;
  label?: string;
  type?: string;
  primaryKey?: boolean;
};

function CheckboxRow({
  checked,
  indeterminate,
  onChange,
  label,
  hint,
  bold,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
  hint?: string;
  bold?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = Boolean(indeterminate);
    }
  }, [indeterminate]);

  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm hover:bg-slate-50",
        checked ? "text-slate-900" : "text-slate-600",
      )}
    >
      <input
        ref={inputRef}
        type="checkbox"
        className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
        checked={checked}
        onChange={onChange}
      />
      <span className={cn("min-w-0 flex-1 truncate", bold && "font-medium")}>{label}</span>
      {hint ? <span className="shrink-0 text-xs text-slate-400">{hint}</span> : null}
    </label>
  );
}

export function ColumnProjectionMenu({
  columns,
  visibleColumns,
  onVisibleColumnsChange,
  disabled,
}: {
  columns: ColumnProjectionItem[];
  visibleColumns: ReadonlySet<string>;
  onVisibleColumnsChange: (next: Set<string>) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = 256;
    const padding = 8;
    const left = Math.min(rect.left, window.innerWidth - width - padding);
    setMenuStyle({
      top: rect.bottom + 4,
      left: Math.max(padding, left),
      width,
    });
  }, []);

  const visibleCount = useMemo(
    () => columns.filter((col) => visibleColumns.has(col.name)).length,
    [columns, visibleColumns],
  );

  const filteredColumns = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return columns;
    return columns.filter((col) => {
      const label = col.label ?? col.name;
      return (
        col.name.toLowerCase().includes(term) ||
        label.toLowerCase().includes(term) ||
        (col.type?.toLowerCase().includes(term) ?? false)
      );
    });
  }, [columns, search]);

  const filteredSelectedCount = useMemo(
    () => filteredColumns.filter((col) => visibleColumns.has(col.name)).length,
    [filteredColumns, visibleColumns],
  );

  const allFilteredSelected =
    filteredColumns.length > 0 && filteredSelectedCount === filteredColumns.length;
  const someFilteredSelected =
    filteredSelectedCount > 0 && filteredSelectedCount < filteredColumns.length;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (open && menuStyle) {
      searchRef.current?.focus();
      return;
    }
    if (!open) {
      setSearch("");
    }
  }, [open, menuStyle]);

  const toggleColumn = (name: string) => {
    const next = new Set(visibleColumns);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    onVisibleColumnsChange(next);
  };

  const selectAll = () => {
    const next = new Set(visibleColumns);
    for (const col of filteredColumns) {
      next.add(col.name);
    }
    onVisibleColumnsChange(next);
  };

  const selectNone = () => {
    const filteredNames = new Set(filteredColumns.map((col) => col.name));
    const next = new Set([...visibleColumns].filter((name) => !filteredNames.has(name)));
    onVisibleColumnsChange(next);
  };

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      selectNone();
      return;
    }
    selectAll();
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || columns.length === 0}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          "inline-flex h-8 min-w-[7.5rem] items-center justify-between gap-2 rounded-md border border-slate-300 bg-white pl-2.5 pr-2 text-sm text-slate-700",
          "hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40",
          open && "border-slate-400 ring-2 ring-slate-200",
        )}
      >
        <span className="truncate">
          Columns
          <span className="ml-1 text-xs text-slate-500">
            ({visibleCount}/{columns.length})
          </span>
        </span>
        <ChevronDownIcon className={cn("shrink-0 text-slate-400 transition", open && "rotate-180")} />
      </button>

      {open && menuStyle
        ? createPortal(
            <div
              ref={menuRef}
              className="fixed z-[200] overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-xl"
              style={{ top: menuStyle.top, left: menuStyle.left, width: menuStyle.width }}
              role="dialog"
              aria-label="Choose visible columns"
            >
              <div className="border-b border-slate-100 px-2 pb-2 pt-1">
                <div className="relative">
                  <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2">
                    <SearchIcon />
                  </span>
                  <Input
                    ref={searchRef}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search fields"
                    className="h-7 pl-7 pr-2 text-xs"
                    aria-label="Search fields"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-2.5 py-1.5 text-xs">
                <button
                  type="button"
                  onClick={selectAll}
                  className="font-medium text-blue-700 hover:text-blue-900 hover:underline"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={selectNone}
                  className="font-medium text-blue-700 hover:text-blue-900 hover:underline"
                >
                  Select none
                </button>
              </div>

              <div className="max-h-56 overflow-y-auto">
                {filteredColumns.length === 0 ? (
                  <p className="px-2.5 py-2 text-xs text-slate-500">No fields match your search</p>
                ) : (
                  <ul role="listbox" aria-multiselectable="true">
                    <li className="border-b border-slate-100">
                      <CheckboxRow
                        checked={allFilteredSelected}
                        indeterminate={someFilteredSelected}
                        onChange={toggleSelectAll}
                        label="(Select All)"
                        bold
                      />
                    </li>
                    {filteredColumns.map((col) => {
                      const label = col.label ?? col.name;
                      return (
                        <li key={col.name}>
                          <CheckboxRow
                            checked={visibleColumns.has(col.name)}
                            onChange={() => toggleColumn(col.name)}
                            label={label}
                            hint={col.type}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
