import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, CircleAlert, Info, LoaderCircle, X } from "lucide-react";
import type { RateMetric } from "../types/api";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const buttonBase =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0";
const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-9 px-4 text-[14px]",
};
const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-white border-accent shadow-card hover:bg-accent-strong hover:border-accent-strong disabled:hover:bg-accent",
  secondary: "bg-surface text-ink border-line-strong shadow-card hover:bg-surface-hover hover:border-ink-faint/50",
  ghost: "bg-transparent text-ink-muted border-transparent hover:bg-surface-sunken hover:text-ink",
  danger: "bg-surface text-danger border-danger/35 hover:bg-danger-soft",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cx(buttonBase, buttonSizes[size], buttonVariants[variant], className);
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  title,
  type = "button",
  size = "md",
  icon,
  loading,
  className,
  ariaLabel,
  ariaExpanded,
  ariaControls,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
  size?: ButtonSize;
  icon?: ReactNode;
  loading?: boolean;
  className?: string;
  ariaLabel?: string;
  ariaExpanded?: boolean;
  ariaControls?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
    >
      {loading ? <Spinner size={size === "sm" ? 14 : 16} /> : icon}
      {children}
    </button>
  );
}

/** An anchor styled as a button - used for downloads and navigation, never nested inside a <button>. */
export function ButtonLink({
  href,
  children,
  variant = "secondary",
  size = "md",
  icon,
  download,
  external,
  title,
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  download?: boolean;
  external?: boolean;
  title?: string;
}) {
  return (
    <a
      href={href}
      download={download || undefined}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      title={title}
      className={buttonClass(variant, size)}
    >
      {icon}
      {children}
    </a>
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <LoaderCircle aria-hidden size={size} className={cx("animate-spin", className)} />;
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */
export function Card({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  id,
  headingLevel = 2,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section id={id} className={cx("min-w-0 rounded-2xl border border-line bg-surface shadow-card", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0">
            {title && <Heading className="text-[15px] font-semibold text-ink">{title}</Heading>}
            {description && <div className="mt-0.5 text-[13px] text-ink-muted">{description}</div>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx("px-5 pb-5", !(title || actions) && "pt-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-2xl">
        {eyebrow && <div className="mb-1">{eyebrow}</div>}
        <h1 className="text-[24px] leading-tight font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-1.5 text-[15px] text-ink-muted">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Page wrapper: consistent width, gap and a short entrance transition. */
export function Page({ children, width = "wide" }: { children: ReactNode; width?: "wide" | "narrow" }) {
  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className={cx("animate-enter flex w-full flex-col gap-6", width === "narrow" && "max-w-4xl")}>{children}</div>
    </div>
  );
}

/** Renders `**bold**` spans in model text. Everything else stays literal text (React escapes it). */
export function EmphasisText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*\n]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^\*\*[^*\n]+\*\*$/.test(part) ? (
          <strong key={i} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cx("text-[12px] font-semibold tracking-wide text-ink-faint uppercase", className)}>{children}</p>
  );
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */
export type Tone = "neutral" | "pass" | "warn" | "danger" | "accent" | "slate";

const badgeTones: Record<Tone, string> = {
  neutral: "bg-surface-sunken text-ink-muted border-line",
  pass: "bg-pass-soft text-pass border-pass/20",
  warn: "bg-warn-soft text-warn border-warn/20",
  danger: "bg-danger-soft text-danger border-danger/20",
  accent: "bg-accent-soft text-accent-strong border-accent/20",
  slate: "bg-[#eaeef2] text-ink border-line-strong/70",
};

export function Badge({
  tone = "neutral",
  children,
  title,
  icon,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] leading-[18px] font-medium whitespace-nowrap",
        badgeTones[tone],
        className,
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function statusTone(status: string): Tone {
  if (["succeeded", "completed", "ok", "accepted", "allow"].includes(status)) return "pass";
  if (["running", "queued", "pending"].includes(status)) return "accent";
  if (["failed", "rejected", "invalid", "deny"].includes(status)) return "danger";
  if (["cancelled", "interrupted"].includes(status)) return "warn";
  return "neutral";
}

export function StatusDot({ tone }: { tone: Tone }) {
  const colors: Record<Tone, string> = {
    neutral: "bg-ink-faint/60",
    pass: "bg-pass",
    warn: "bg-[#c77a12]",
    danger: "bg-danger",
    accent: "bg-accent",
    slate: "bg-ink-muted",
  };
  return <span aria-hidden className={cx("inline-block h-2 w-2 shrink-0 rounded-full", colors[tone])} />;
}

const toneText: Record<Tone, string> = {
  neutral: "text-ink",
  pass: "text-pass",
  warn: "text-warn",
  danger: "text-danger",
  accent: "text-accent-strong",
  slate: "text-ink",
};

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */
export function hasRate(metric?: RateMetric | null): metric is RateMetric & { rate: number } {
  return !!metric && metric.denominator > 0 && metric.rate !== null && metric.rate !== undefined;
}

export function pct(rate: number) {
  return `${Math.round(rate * 100)}%`;
}

export function rateTone(metric: RateMetric | null | undefined, invert?: boolean): Tone {
  if (!hasRate(metric)) return "neutral";
  const rate = metric.rate;
  const good = invert ? rate <= 0.0001 : rate >= 0.999;
  const bad = invert ? rate > 0.0001 : rate < 0.5;
  return good ? "pass" : bad ? "danger" : "warn";
}

export function Metric({
  label,
  metric,
  invert,
  hint,
}: {
  label: string;
  metric?: RateMetric | null;
  invert?: boolean;
  hint?: string;
}) {
  const tone = rateTone(metric, invert);
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="flex items-center gap-1 text-[13px] font-medium text-ink-muted">
        {label}
        {hint && <InfoTip label={label}>{hint}</InfoTip>}
      </div>
      <div className={cx("mt-1 text-[24px] font-semibold tabular-nums", tone === "neutral" ? "text-ink" : toneText[tone])}>
        {hasRate(metric) ? pct(metric.rate) : <span className="text-[16px] font-medium text-ink-faint">No data</span>}
      </div>
      <div className="text-[13px] text-ink-muted tabular-nums">
        {metric ? `${metric.numerator} / ${metric.denominator}` : "0 / 0"}
        {metric?.excluded_infrastructure_failures ? (
          <span className="ml-1 text-warn" title="Runs excluded because the run itself failed (for example a model error)">
            · {metric.excluded_infrastructure_failures} excluded
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  tone = "neutral",
  hint,
  sub,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  hint?: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface px-4 py-3">
      <div className="flex items-center gap-1 text-[13px] font-medium text-ink-muted">
        <span className="truncate">{label}</span>
        {hint && <InfoTip label={label}>{hint}</InfoTip>}
      </div>
      <div className={cx("mt-1 text-[16px] font-semibold break-words tabular-nums", toneText[tone])}>{value}</div>
      {sub && <div className="mt-0.5 text-[12px] text-ink-muted">{sub}</div>}
    </div>
  );
}

/** A thin horizontal bar for a real rate. Renders nothing when there is no data. */
export function RateBar({ rate, tone }: { rate: number | null | undefined; tone: Tone }) {
  if (rate === null || rate === undefined) return <div className="h-1.5 w-full rounded-full bg-surface-sunken" aria-hidden />;
  const fills: Record<Tone, string> = {
    neutral: "bg-ink-faint",
    pass: "bg-pass",
    warn: "bg-[#c77a12]",
    danger: "bg-danger",
    accent: "bg-accent",
    slate: "bg-ink-muted",
  };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
      <div
        className={cx("h-full rounded-full transition-[width] duration-200", fills[tone])}
        style={{ width: `${Math.max(0, Math.min(100, rate * 100))}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Feedback states                                                     */
/* ------------------------------------------------------------------ */
export function EmptyState({
  title,
  children,
  icon,
  action,
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong bg-surface-sunken/60 px-6 py-8 text-center">
      {icon && <div className="mb-2 text-ink-faint">{icon}</div>}
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-xl text-[14px] text-ink-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, context }: { error: unknown; context?: string }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="flex gap-3 rounded-xl border border-danger/25 bg-danger-soft px-4 py-3">
      <CircleAlert aria-hidden size={18} className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0">
        <p className="text-[14px] font-semibold text-danger">{context ?? "Request failed"}</p>
        <p className="mt-0.5 font-mono text-[12px] break-words text-danger">{message}</p>
      </div>
    </div>
  );
}

export function Callout({
  tone = "neutral",
  title,
  children,
  icon,
  role,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  role?: "alert" | "status";
}) {
  const tones: Record<Tone, string> = {
    neutral: "border-line bg-surface-sunken/70",
    pass: "border-pass/20 bg-pass-soft",
    warn: "border-warn/25 bg-warn-soft",
    danger: "border-danger/25 bg-danger-soft",
    accent: "border-accent/20 bg-accent-soft",
    slate: "border-line-strong bg-surface-sunken",
  };
  return (
    <div role={role} className={cx("flex gap-3 rounded-xl border px-4 py-3", tones[tone])}>
      {icon && <div className={cx("mt-0.5 shrink-0", toneText[tone] === "text-ink" ? "text-ink-muted" : toneText[tone])}>{icon}</div>}
      <div className="min-w-0 text-[14px]">
        {title && <p className={cx("font-semibold", tone === "neutral" ? "text-ink" : toneText[tone])}>{title}</p>}
        {children && <div className={cx("text-ink-muted", !!title && "mt-0.5")}>{children}</div>}
      </div>
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <p className="flex items-center gap-2 px-1 py-4 text-[14px] text-ink-muted" role="status">
      <Spinner size={16} className="text-accent" />
      {label}…
    </p>
  );
}

/** Placeholder blocks shown only while a real request is pending. */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-surface-sunken" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */
export function Table({
  headers,
  children,
  minWidth = 640,
  caption,
}: {
  headers: ReactNode[];
  children: ReactNode;
  minWidth?: number;
  caption?: string;
}) {
  return (
    <div className="sf-scroll relative -mx-1 overflow-x-auto px-1">
      <table className="w-full text-left text-[14px]" style={{ minWidth }}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-line">
            {headers.map((h, i) => (
              <th
                key={i}
                scope="col"
                className="px-3 py-2 text-[12px] font-semibold tracking-wide whitespace-nowrap text-ink-faint uppercase"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Row({
  children,
  onClick,
  selected,
  label,
}: {
  children: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  label?: string;
}) {
  return (
    <tr
      onClick={onClick}
      tabIndex={onClick ? 0 : undefined}
      aria-label={label}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cx(
        "border-b border-line/70 align-top transition-colors duration-150 last:border-b-0",
        onClick && "cursor-pointer hover:bg-surface-hover",
        selected && "bg-accent-soft/70",
      )}
    >
      {children}
    </tr>
  );
}

export function Cell({ children, mono, className }: { children?: ReactNode; mono?: boolean; className?: string }) {
  return <td className={cx("px-3 py-2.5", mono && "font-mono text-[12px]", className)}>{children}</td>;
}

/* ------------------------------------------------------------------ */
/* Detail primitives                                                   */
/* ------------------------------------------------------------------ */
export function Code({ value, maxHeight = 320 }: { value: unknown; maxHeight?: number }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <pre
      className="sf-scroll overflow-auto rounded-lg border border-line bg-surface-sunken p-3 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap text-ink"
      style={{ maxHeight }}
      tabIndex={0}
    >
      {text}
    </pre>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("font-mono text-[12px] break-all", className)}>{children}</span>;
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[14px] sm:grid-cols-[minmax(140px,auto)_1fr] sm:gap-y-2">
      {items.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-ink-faint max-sm:mt-1.5">{key}</dt>
          <dd className="min-w-0 break-words text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Accessible disclosure built on <details>. */
export function Disclosure({
  summary,
  children,
  defaultOpen,
  meta,
  className,
  variant = "plain",
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  meta?: ReactNode;
  className?: string;
  variant?: "plain" | "boxed";
}) {
  return (
    <details
      className={cx(
        "sf-disclosure group",
        variant === "boxed" && "rounded-xl border border-line bg-surface",
        className,
      )}
      open={defaultOpen}
    >
      <summary
        className={cx(
          "flex cursor-pointer items-center gap-2 rounded-lg text-[14px] font-medium text-ink-muted select-none hover:text-ink",
          variant === "boxed" ? "px-4 py-3" : "py-1",
        )}
      >
        <ChevronRight aria-hidden size={16} className="sf-chevron shrink-0" />
        <span className="min-w-0 flex-1">{summary}</span>
        {meta && <span className="shrink-0 text-[13px] font-normal text-ink-faint">{meta}</span>}
      </summary>
      <div className={cx("sf-disclosure-body", variant === "boxed" ? "border-t border-line px-4 py-3" : "pt-2")}>
        {children}
      </div>
    </details>
  );
}

/** Small "i" button with a tooltip shown on hover or keyboard focus. The text is also its accessible description. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const [dismissed, setDismissed] = useState(false);
  return (
    <span
      className="sf-tip-root relative inline-flex"
      onMouseLeave={() => setDismissed(false)}
      onBlur={() => setDismissed(false)}
    >
      <button
        type="button"
        aria-label={`About: ${label}`}
        aria-describedby={id}
        onKeyDown={(event) => {
          if (event.key === "Escape") setDismissed(true);
        }}
        onClick={(event) => event.stopPropagation()}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-faint hover:text-accent-strong"
      >
        <Info aria-hidden size={14} />
      </button>
      <span
        role="tooltip"
        id={id}
        data-open={dismissed ? "false" : undefined}
        className="sf-tip pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 w-64 rounded-lg bg-nav px-3 py-2 text-left text-[12px] leading-snug font-normal tracking-normal text-nav-ink normal-case shadow-raised"
      >
        {children}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Drawer                                                              */
/* ------------------------------------------------------------------ */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  headerExtra,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  headerExtra?: ReactNode;
}) {
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // keep the drawer mounted for a short exit transition
  useEffect(() => {
    if (open) {
      restoreRef.current = (document.activeElement as HTMLElement) ?? null;
      setRendered(true);
      setClosing(false);
      return;
    }
    if (!rendered) return;
    setClosing(true);
    const timer = window.setTimeout(() => {
      setRendered(false);
      setClosing(false);
      const target = restoreRef.current;
      if (target && document.contains(target)) target.focus();
    }, 160);
    return () => window.clearTimeout(timer);
  }, [open]); // `rendered` is intentionally read, not tracked

  useEffect(() => {
    if (open && rendered) panelRef.current?.focus();
  }, [open, rendered]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // with stacked drawers, only the topmost one closes
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs.length && dialogs[dialogs.length - 1] !== panelRef.current) return;
      onClose();
    };
    window.addEventListener("keydown", handler);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  // keep Tab focus inside the dialog
  const trapFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = panelRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, summary, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!rendered) return null;
  // Portal to <body>: an ancestor with an entrance animation would otherwise become the containing block.
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end">
      <div
        className={cx("absolute inset-0 bg-nav/35", closing ? "opacity-0 transition-opacity duration-150" : "animate-fade")}
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapFocus}
        className={cx(
          "sf-scroll relative flex w-full max-w-3xl flex-col overflow-y-auto bg-ground shadow-drawer outline-none",
          closing ? "animate-drawer-out" : "animate-drawer-in",
        )}
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-surface/95 px-5 py-4 backdrop-blur-sm">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[17px] font-semibold break-words text-ink">
              {title}
            </h2>
            {subtitle && <div className="mt-1 text-[13px] text-ink-muted">{subtitle}</div>}
            {headerExtra && <div className="mt-2">{headerExtra}</div>}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} ariaLabel="Close" icon={<X aria-hidden size={16} />}>
            Close
          </Button>
        </header>
        <div className="flex flex-col gap-4 p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */
export function Progress({ done, total, finished }: { done: number; total: number; finished?: boolean }) {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="w-full">
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label="Job progress"
      >
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-[13px] text-ink-muted tabular-nums">
        {total > 0
          ? finished
            ? `${done} of ${total} planned steps recorded`
            : `${done} of ${total} completed`
          : "Waiting for the worker to pick this up"}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Forms                                                               */
/* ------------------------------------------------------------------ */
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="text-[12px] text-ink-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "h-9 w-full min-w-0 rounded-lg border border-line-strong bg-surface px-3 text-[14px] text-ink shadow-[inset_0_1px_1px_rgb(16_32_43/0.03)] transition-[border-color,box-shadow] duration-150 placeholder:text-ink-faint hover:border-ink-faint/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export const textareaClass = inputClass.replace("h-9", "py-2");

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      type="number"
      className={cx(inputClass, "tabular-nums")}
      value={text}
      min={min}
      max={max}
      step={step}
      onChange={(event) => {
        setText(event.target.value);
        const parsed = Number(event.target.value);
        if (!Number.isNaN(parsed)) onChange(parsed);
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Tabs and segmented filters                                          */
/* ------------------------------------------------------------------ */
export function tabIds(base: string, key: string) {
  return { tab: `${base}-tab-${key}`, panel: `${base}-panel-${key}` };
}

export function Tabs({
  tabs,
  active,
  onSelect,
  idBase = "tabs",
  label,
}: {
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  onSelect: (key: string) => void;
  idBase?: string;
  label?: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (event: ReactKeyboardEvent, index: number) => {
    let next = -1;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    onSelect(tabs[next].key);
    refs.current[tabs[next].key]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="sf-scroll flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((tab, index) => {
        const ids = tabIds(idBase, tab.key);
        const selected = active === tab.key;
        return (
          <button
            key={tab.key}
            ref={(el) => {
              refs.current[tab.key] = el;
            }}
            id={ids.tab}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={ids.panel}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(tab.key)}
            onKeyDown={(event) => move(event, index)}
            className={cx(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-[14px] font-medium whitespace-nowrap transition-colors duration-150",
              selected ? "border-accent text-accent-strong" : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cx(
                  "ml-1.5 rounded-full px-1.5 text-[12px] tabular-nums",
                  selected ? "bg-accent-soft text-accent-strong" : "bg-surface-sunken text-ink-faint",
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  idBase = "tabs",
  tabKey,
  children,
}: {
  idBase?: string;
  tabKey: string;
  children: ReactNode;
}) {
  const ids = tabIds(idBase, tabKey);
  return (
    <div role="tabpanel" id={ids.panel} aria-labelledby={ids.tab} className="animate-enter flex flex-col gap-4">
      {children}
    </div>
  );
}

/** Radio-group style filter. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex max-w-full flex-wrap gap-0.5 rounded-lg border border-line bg-surface-sunken p-0.5"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cx(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-150",
              selected ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink",
            )}
          >
            {option.label}
            {option.count !== undefined && <span className="text-[12px] text-ink-faint tabular-nums">{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
