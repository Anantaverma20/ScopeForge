import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  FlaskConical,
  LayoutDashboard,
  ListChecks,
  Menu,
  MessagesSquare,
  Settings as SettingsIcon,
  ShieldCheck,
  X,
} from "lucide-react";
import { api, useApiQuery } from "../api/client";
import type { IntegrationState } from "../types/api";
import { Spinner, cx } from "./ui";

const NAV = [
  { to: "/", label: "Workspace", end: true, icon: LayoutDashboard },
  { to: "/scenarios", label: "Scenarios", icon: ListChecks },
  { to: "/experiments", label: "Experiments", icon: FlaskConical },
  { to: "/policies", label: "Policies", icon: ShieldCheck },
  { to: "/playground", label: "Playground", icon: MessagesSquare },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

const INTEGRATION_NAMES: Record<string, string> = {
  llm: "W&B Inference",
  weave: "Weave tracing",
  mcp: "W&B MCP",
};

/** The status text is the backend's state, unchanged: ok / failing / unchecked / not configured. */
export function integrationStatus(integration: Pick<IntegrationState, "ok" | "configured">) {
  if (integration.ok === true) return { text: "ok", dot: "bg-[#3fbf86]", ink: "text-nav-muted" };
  if (integration.ok === false) return { text: "failing", dot: "bg-[#f26b5e]", ink: "text-[#ffb4ab]" };
  if (integration.configured) return { text: "unchecked", dot: "bg-[#e3a23b]", ink: "text-nav-muted" };
  return { text: "not configured", dot: "bg-nav-muted/60", ink: "text-nav-muted" };
}

function BrandMark() {
  return (
    <svg aria-hidden width="28" height="28" viewBox="0 0 28 28" className="shrink-0">
      <rect width="28" height="28" rx="8" fill="#087F8C" />
      <path
        d="M14 6.5 20 9v4.6c0 3.7-2.5 6.6-6 7.9-3.5-1.3-6-4.2-6-7.9V9l6-2.5Z"
        fill="none"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="m11.2 14 2 2 3.8-3.9" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Layout() {
  const health = useApiQuery(["health"], api.health, { refetchInterval: 15000 });
  const jobs = useApiQuery(["jobs", "active"], () => api.jobs(true), { refetchInterval: 3000 });
  const activeJobs = jobs.data ?? [];
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    <div className="flex min-h-full flex-col bg-ground lg:flex-row">
      <a href="#main" className="sf-skip">
        Skip to content
      </a>

      <nav
        aria-label="Primary"
        className="sf-nav flex shrink-0 flex-col bg-nav text-nav-ink lg:sticky lg:top-0 lg:h-screen lg:w-64"
      >
        {/* brand row */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 lg:pt-6 lg:pb-5">
          <Link to="/" className="flex min-w-0 items-center gap-2.5 rounded-lg">
            <BrandMark />
            <span className="min-w-0">
              <span className="block text-[16px] leading-tight font-semibold tracking-tight text-white">ScopeForge</span>
              <span className="block truncate text-[12px] text-nav-muted">Tested permissions for AI agents</span>
            </span>
          </Link>
          {!menuOpen && (health.isError || (health.data?.integrations ?? []).some((i) => i.ok === false)) && (
            <Link
              to="/settings#integrations"
              role="alert"
              className="ml-auto rounded-md bg-[#3a1d1d] px-2 py-1 text-[12px] font-medium whitespace-nowrap text-[#ffb4ab] lg:hidden"
            >
              {health.isError ? "Backend unreachable" : "Integration failing"}
            </Link>
          )}
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-nav-ink hover:bg-nav-raised lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="sf-nav-panel"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X aria-hidden size={20} /> : <Menu aria-hidden size={20} />}
          </button>
        </div>

        <div
          id="sf-nav-panel"
          className={cx("flex-1 flex-col px-3 pb-4 lg:flex", menuOpen ? "flex animate-enter" : "hidden")}
        >
          <ul className="flex flex-col gap-0.5">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cx(
                        "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium transition-colors duration-150",
                        isActive ? "bg-nav-active text-white" : "text-nav-muted hover:bg-nav-raised hover:text-nav-ink",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          aria-hidden
                          className={cx(
                            "absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-nav-accent transition-opacity duration-150",
                            isActive ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <Icon
                          aria-hidden
                          size={18}
                          className={cx(isActive ? "text-nav-accent" : "text-nav-muted group-hover:text-nav-ink")}
                        />
                        {item.label}
                      </>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>

          <div className="mt-6 flex flex-col gap-3 border-t border-nav-line px-2 pt-4 lg:mt-auto">
            {activeJobs.length > 0 && (
              <Link
                to="/"
                className="flex items-center gap-2 rounded-lg bg-nav-raised px-3 py-2 text-[13px] text-nav-ink hover:bg-nav-active"
              >
                <Spinner size={14} className="text-nav-accent" />
                {activeJobs.length} job{activeJobs.length > 1 ? "s" : ""} running
              </Link>
            )}

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[11px] font-semibold tracking-wider text-nav-muted uppercase">Integrations</p>
                <Link to="/settings#integrations" className="text-[12px] text-nav-muted underline-offset-2 hover:text-nav-ink hover:underline">
                  Details
                </Link>
              </div>
              <ul className="flex flex-col gap-0.5">
                {(health.data?.integrations ?? []).map((integration) => {
                  const status = integrationStatus(integration);
                  return (
                    <li key={integration.name}>
                      <Link
                        to="/settings#integrations"
                        title={`${integration.name}: ${status.text}`}
                        className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[13px] hover:bg-nav-raised"
                      >
                        <span aria-hidden className={cx("h-2 w-2 shrink-0 rounded-full", status.dot)} />
                        <span className="min-w-0 flex-1 truncate text-nav-ink">
                          {INTEGRATION_NAMES[integration.name] ?? integration.name}
                        </span>
                        <span className={cx("shrink-0 text-[12px]", status.ink)}>{status.text}</span>
                      </Link>
                      {integration.ok === false && integration.detail && (
                        <p className="mt-0.5 mb-1 line-clamp-2 px-1.5 pl-5.5 text-[12px] break-words text-[#ffb4ab]">
                          {integration.detail}
                        </p>
                      )}
                    </li>
                  );
                })}
                {health.isLoading && (
                  <li className="flex items-center gap-2 px-1.5 py-1 text-[13px] text-nav-muted">
                    <Spinner size={14} /> Checking backend
                  </li>
                )}
                {health.isError && (
                  <li
                    role="alert"
                    className="rounded-md bg-[#3a1d1d] px-2 py-1.5 text-[13px] text-[#ffb4ab]"
                    title={health.error?.message}
                  >
                    Backend unreachable
                  </li>
                )}
              </ul>
            </div>

            <p className="text-[12px] text-nav-muted">
              Local prototype · Synthetic data
              {health.data ? ` · v${health.data.version}` : ""}
            </p>
          </div>
        </div>
      </nav>

      <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 outline-none sm:px-6 lg:px-10 lg:py-8">
        <Outlet />
      </main>
    </div>
  );
}
