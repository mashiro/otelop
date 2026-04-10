import { useState } from "react";

export function KV({ k, v }: { k: string; v: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="text-xs">
      <div className="text-muted-foreground">{k}</div>
      <div
        className={`whitespace-normal break-all pl-3 font-mono text-foreground/80 ${expanded ? "" : "line-clamp-2"}`}
      >
        {v}
      </div>
      {v.length > 100 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="cursor-pointer pl-3 text-[10px] text-muted-foreground hover:text-foreground"
        >
          {expanded ? "show less" : "show more..."}
        </button>
      )}
    </div>
  );
}
