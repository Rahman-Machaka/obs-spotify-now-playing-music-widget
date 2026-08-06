import { useId } from "react";
import { ChevronDownIcon } from "../atoms/Icons";

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function CollapsibleSection({
  title,
  subtitle,
  complete,
  open,
  onToggle,
  expandLabel,
  collapseLabel,
  children,
}: {
  title: string;
  subtitle: string;
  complete: boolean;
  open: boolean;
  onToggle: () => void;
  expandLabel: string;
  collapseLabel: string;
  children: React.ReactNode;
}) {
  const buttonId = useId();
  const contentId = useId();
  return (
    <section className={`collapsible-section ${open ? "open" : ""}`}>
      <button
        id={buttonId}
        className="collapsible-header"
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        aria-label={`${title}: ${open ? collapseLabel : expandLabel}`}
        onClick={onToggle}
      >
        <span>
          <strong className="collapsible-title">{title}</strong>
          <small className={complete ? "complete" : "required"}>
            {subtitle}
          </small>
        </span>
        <span className="collapsible-chevron" aria-hidden="true">
          <ChevronDownIcon />
        </span>
      </button>
      {open && (
        <div
          id={contentId}
          className="collapsible-content"
          role="region"
          aria-labelledby={buttonId}
        >
          {children}
        </div>
      )}
    </section>
  );
}
