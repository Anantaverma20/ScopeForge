import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import type {
  CustomerRow,
  DatasetSummary,
  ExperimentDetail,
  ExperimentSummary,
  GenerateDatasetRequest,
  HealthResponse,
  IntegrationState,
  JobDetail,
  JobOut,
  OrderRow,
  PlaygroundExample,
  PlaygroundMessageOut,
  PlaygroundSessionOut,
  PlaygroundTurnResponse,
  PolicyDetail,
  PolicyDiffResponse,
  PolicySummary,
  RunDetail,
  RunSummary,
  ScenarioDetail,
  ScenarioSummary,
  SettingsResponse,
  SuiteSummary,
  TicketRow,
  WorkspaceState,
} from "../types/api";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") detail = body.detail;
      else if (body?.detail) detail = JSON.stringify(body.detail);
    } catch {
      /* keep the status text */
    }
    throw new ApiError(detail, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const get = <T,>(path: string) => request<T>(path);
const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
const put = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: "PUT", body: JSON.stringify(body) });

export const api = {
  health: () => get<HealthResponse>("/api/health"),
  integrations: () => get<IntegrationState[]>("/api/integrations"),
  checkIntegrations: () => post<IntegrationState[]>("/api/integrations/check"),

  workspace: () => get<WorkspaceState>("/api/workspace"),
  settings: () => get<SettingsResponse>("/api/settings"),
  updateSettings: (patch: Record<string, unknown>) => put<SettingsResponse>("/api/settings", { patch }),
  resetSettings: () => post<SettingsResponse>("/api/settings/reset"),

  datasets: () => get<DatasetSummary[]>("/api/datasets"),
  createDataset: (body: GenerateDatasetRequest) => post<DatasetSummary>("/api/datasets", body),
  datasetStats: (id: string) => get<Record<string, unknown>>(`/api/datasets/${id}/stats`),
  customers: (id: string, limit = 50) => get<CustomerRow[]>(`/api/datasets/${id}/customers?limit=${limit}`),
  orders: (id: string, limit = 50, customerId?: string) =>
    get<OrderRow[]>(
      `/api/datasets/${id}/orders?limit=${limit}${customerId ? `&customer_id=${customerId}` : ""}`,
    ),
  tickets: (id: string, limit = 50) => get<TicketRow[]>(`/api/datasets/${id}/tickets?limit=${limit}`),

  suites: (datasetId?: string) => get<SuiteSummary[]>(`/api/suites${datasetId ? `?dataset_id=${datasetId}` : ""}`),
  createSuite: (body: { dataset_id: string; legitimate_cases?: number; adversarial_cases?: number }) =>
    post<SuiteSummary>("/api/suites", body),
  scenarios: (suiteId: string) => get<ScenarioSummary[]>(`/api/suites/${suiteId}/scenarios`),
  scenario: (id: string) => get<ScenarioDetail>(`/api/scenarios/${id}`),

  policies: () => get<PolicySummary[]>("/api/policies"),
  policy: (id: string) => get<PolicyDetail>(`/api/policies/${id}`),
  policyDiff: (id: string) => get<PolicyDiffResponse>(`/api/policies/${id}/diff`),
  activatePolicy: (id: string, overrideReason = "") =>
    post<PolicySummary>(`/api/policies/${id}/activate`, { override_reason: overrideReason }),
  evaluatePolicy: (id: string, body: { suite_id: string; splits: string[] }) =>
    post<JobOut>(`/api/policies/${id}/evaluate`, body),

  experiments: (limit = 50) => get<ExperimentSummary[]>(`/api/experiments?limit=${limit}`),
  experiment: (id: string) => get<ExperimentDetail>(`/api/experiments/${id}`),
  run: (id: string) => get<RunDetail>(`/api/runs/${id}`),
  runs: (scenarioId: string) => get<RunSummary[]>(`/api/runs?scenario_id=${scenarioId}&limit=50`),

  jobs: (activeOnly = false) => get<JobOut[]>(`/api/jobs?active_only=${activeOnly}`),
  job: (id: string) => get<JobDetail>(`/api/jobs/${id}`),
  cancelJob: (id: string) => post<JobOut>(`/api/jobs/${id}/cancel`),
  startBaseline: (body: { suite_id: string; policy_id?: string; splits: string[] }) =>
    post<JobOut>("/api/runs/baseline", body),
  startImprovement: (body: { suite_id: string; policy_id?: string; max_iterations?: number; use_mcp: boolean }) =>
    post<JobOut>("/api/jobs/improvement", body),
  startAdversary: (body: { suite_id: string; count?: number }) => post<JobOut>("/api/jobs/adversary", body),

  playgroundCustomers: (datasetId?: string) =>
    get<CustomerRow[]>(`/api/playground/customers${datasetId ? `?dataset_id=${datasetId}` : ""}`),
  playgroundSessions: () => get<PlaygroundSessionOut[]>("/api/playground/sessions"),
  createPlaygroundSession: (body: { customer_id: string; policy_id?: string }) =>
    post<PlaygroundSessionOut>("/api/playground/sessions", body),
  playgroundMessages: (id: string) => get<PlaygroundMessageOut[]>(`/api/playground/sessions/${id}/messages`),
  sendPlaygroundMessage: (id: string, message: string) =>
    post<PlaygroundTurnResponse>(`/api/playground/sessions/${id}/messages`, { message }),
  playgroundExamples: (id: string) => get<PlaygroundExample[]>(`/api/playground/sessions/${id}/examples`),

  exportExperimentUrl: (id: string) => `/api/experiments/${id}/export`,
  exportPolicyUrl: (id: string) => `/api/policies/${id}/export`,
};

type QueryOpts<T> = Omit<UseQueryOptions<T, Error, T, readonly unknown[]>, "queryKey" | "queryFn">;

export function useApiQuery<T>(key: readonly unknown[], fn: () => Promise<T>, options?: QueryOpts<T>) {
  return useQuery<T, Error, T, readonly unknown[]>({ queryKey: key, queryFn: fn, ...options });
}

/** Invalidate everything after a mutation - the whole UI is derived from the server. */
export function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries();
}

export function useApiMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const refresh = useRefresh();
  return useMutation<TResult, Error, TArgs>({ mutationFn: fn, onSuccess: () => refresh() });
}
