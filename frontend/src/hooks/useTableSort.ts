import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

type SortValue = string | number | boolean | null | undefined;

export function useTableSort<T>(
  rows: T[],
  accessors: Partial<Record<string, (row: T) => SortValue>>,
  defaultKey?: string,
) {
  const [sortKey, setSortKey] = useState<string | null>(defaultKey ?? null);
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
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
