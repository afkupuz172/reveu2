export interface LoadStep {
  label: string;
  status: "done" | "active" | "pending";
}

// A loading indicator that tells the user what's being collected — either a
// determinate bar (progress) or an animated indeterminate bar, plus an optional
// checklist of named steps.
export default function LoadingBar({
  title,
  detail,
  steps,
  progress,
}: {
  title: string;
  detail?: string;
  steps?: LoadStep[];
  progress?: { current: number; total: number };
}) {
  const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : null;
  return (
    <div className="card loading">
      <div className="loading-title">{title}</div>
      {detail && <div className="loading-detail">{detail}</div>}
      <div className="loading-track">
        {pct != null ? (
          <div className="loading-fill" style={{ width: `${pct}%` }} />
        ) : (
          <div className="loading-fill indeterminate" />
        )}
      </div>
      {pct != null && (
        <div className="loading-detail" style={{ marginTop: 6 }}>
          {progress!.current} of {progress!.total}
        </div>
      )}
      {steps && (
        <ul className="loading-steps">
          {steps.map((s, i) => (
            <li key={i} className={s.status}>
              <span className="step-dot">
                {s.status === "done" ? "✓" : s.status === "active" ? <span className="spin" /> : "○"}
              </span>
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
