import { useEffect, useRef, useState } from "react";
import type { ClientListItem } from "../../shared/types";

// Searchable company selector (combobox): type to filter, click to choose.
export default function CompanySelect({
  companies,
  value,
  onChange,
}: {
  companies: ClientListItem[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const selected = companies.find((c) => c.id === value);
  const filtered = companies.filter(
    (c) =>
      c.name.toLowerCase().includes(query.toLowerCase()) ||
      (c.domain ?? "").toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="combo" ref={ref}>
      <input
        className="combo-input"
        placeholder="Search companies…"
        value={open ? query : selected?.name ?? ""}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
      />
      {open && (
        <div className="combo-list">
          {filtered.map((c) => (
            <div
              key={c.id}
              className={`combo-opt ${c.id === value ? "sel" : ""}`}
              onMouseDown={() => {
                onChange(c.id);
                setOpen(false);
              }}
            >
              <span>{c.name}</span>
              {c.domain && <span className="muted combo-dom">{c.domain}</span>}
            </div>
          ))}
          {filtered.length === 0 && <div className="muted combo-empty">No matches</div>}
        </div>
      )}
    </div>
  );
}
