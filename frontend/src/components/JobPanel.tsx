import { api, useApiMutation, useApiQuery } from "../api/client";
import type { JobOut } from "../types/api";
import { Badge, Button, Card, Code, Disclosure, Progress, Spinner, statusTone } from "./ui";

const TERMINAL = ["succeeded", "failed", "cancelled", "interrupted"];

export function JobPanel({ jobId, onDismiss }: { jobId: string; onDismiss?: () => void }) {
  const job = useApiQuery(["job", jobId], () => api.job(jobId), {
    refetchInterval: (query) => {
      const data = query.state.data;
      return data && TERMINAL.includes(data.status) ? false : 1500;
    },
  });
  const cancel = useApiMutation((id: string) => api.cancelJob(id));

  if (job.isLoading || !job.data) return null;
  const data = job.data;
  const running = !TERMINAL.includes(data.status);

  return (
    <Card
      className="animate-enter"
      title={
        <span className="flex flex-wrap items-center gap-2">
          {running && <Spinner size={16} className="text-accent" />}
          {jobLabel(data)} <Badge tone={statusTone(data.status)}>{data.status}</Badge>
        </span>
      }
      description={data.current_step || "queued"}
      actions={
        <>
          {running && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => cancel.mutate(data.id)}
              disabled={data.cancel_requested}
              loading={cancel.isPending}
            >
              {data.cancel_requested ? "Cancelling…" : "Cancel"}
            </Button>
          )}
          {!running && onDismiss && (
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Progress done={data.progress_done} total={data.progress_total} finished={!running} />
        {data.error && (
          <p
            role="alert"
            className="rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 font-mono text-[12px] break-words text-danger"
          >
            {data.error}
          </p>
        )}
        {data.events.length > 0 && (
          <Disclosure summary="Event log" meta={data.events.length} defaultOpen={running}>
            <ul className="sf-scroll max-h-56 overflow-y-auto rounded-lg border border-line bg-surface-sunken p-2.5 font-mono text-[12px]">
              {data.events.map((event) => (
                <li
                  key={event.seq}
                  className={
                    event.level === "error" ? "text-danger" : event.level === "warn" ? "text-warn" : "text-ink-muted"
                  }
                >
                  <span className="text-ink-faint">{new Date(event.created_at).toLocaleTimeString()} </span>
                  {event.message}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
        {!running && Object.keys(data.result ?? {}).length > 0 && (
          <Disclosure summary="Result">
            <Code value={data.result} maxHeight={240} />
          </Disclosure>
        )}
      </div>
    </Card>
  );
}

export function jobLabel(job: JobOut) {
  switch (job.kind) {
    case "experiment_run":
      return String((job.params as { name?: string }).name ?? "Experiment run");
    case "improvement":
      return "Improvement loop";
    case "adversary_suite":
      return "Adversarial suite generation";
    default:
      return job.kind;
  }
}
