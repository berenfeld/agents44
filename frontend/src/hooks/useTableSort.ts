import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

type SortValue = string | number | boolean | null | undefined;

type ControlledSort = {
  sortKey: string | null;
  sortDir: SortDirection;
  onSortChange: (sortKey: string | null, sortDir: SortDirection) => void;
};

export function useTableSort<T>(
  rows: T[],
  accessors: Partial<Record<string, (row: T) => SortValue>>,
  defaultKey?: string,
  controlled?: ControlledSort,
) {
  const [internalSortKey, setInternalSortKey] = useState<string | null>(defaultKey ?? null);
  const [internalSortDir, setInternalSortDir] = useState<SortDirection>("asc");

  const sortKey = controlled?.sortKey ?? internalSortKey;
  const sortDir = controlled?.sortDir ?? internalSortDir;

  const toggleSort = (key: string) => {
    if (controlled) {
      if (sortKey === key) {
        controlled.onSortChange(key, sortDir === "asc" ? "desc" : "asc");
      } else {
        controlled.onSortChange(key, "asc");
      }
      return;
    }
    if (sortKey === key) {
      setInternalSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setInternalSortKey(key);
      setInternalSortDir("asc");
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const accessor = accessors[sortKey] ?? ((row: T) => (row as Record<string, SortValue>)[sortKey]);
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      let cmp: number;
      if (av == null && bv == null) cmp = 0;
      else if (av == null) cmp = 1;
      else if (bv == null) cmp = -1;
      else if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else if (typeof av === "boolean" && typeof bv === "boolean") cmp = Number(av) - Number(bv);
      else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir, accessors]);

  return { sorted, sortKey, sortDir, toggleSort };
}
