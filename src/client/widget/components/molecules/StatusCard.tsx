/** @jsxImportSource preact */
import type { Preset } from "../../../../shared/schema";

export function StatusCard({
  title,
  detail,
  action,
  animation,
}: {
  title: string;
  detail: string;
  action: string;
  animation: Preset["animations"]["enter"];
}) {
  return (
    <main
      className={`widget-status status-enter-${animation}`}
      role="status"
      aria-live="polite"
    >
      <span className="status-symbol" aria-hidden="true">
        !
      </span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
        <a href="/dashboard" target="_blank" rel="noreferrer">
          {action}
        </a>
      </div>
    </main>
  );
}
