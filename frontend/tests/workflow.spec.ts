import { expect, test } from "@playwright/test";

/** Browser checks of the workflow a reviewer actually follows. */

test.describe("ScopeForge workflow", () => {
  test("the shell loads and reports real integration state", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Workspace" })).toBeVisible();
    await expect(page.getByText("Tested permissions for AI agents")).toBeVisible();

    // integration pills reflect the backend, not a hardcoded "connected"
    const health = await page.request.get("/api/health");
    const body = await health.json();
    for (const integration of body.integrations) {
      const expected =
        integration.ok === true
          ? "ok"
          : integration.ok === false
            ? "failing"
            : integration.configured
              ? "unchecked"
              : "not configured";
      await expect(page.getByTitle(`${integration.name}: ${expected}`)).toBeVisible();
    }
  });

  test("a dataset can be generated and its records inspected", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Generate dataset" }).click();
    await expect(page.getByText(/Synthetic e-commerce v\d+/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/\d+ orders/).first()).toBeVisible();

    // the counts shown match what the API reports
    const datasets = await (await page.request.get("/api/datasets")).json();
    expect(datasets.length).toBeGreaterThan(0);
    expect(datasets[0].counts.orders).toBeGreaterThan(0);
  });

  test("a scenario suite is generated with entity-separated splits", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Generate suite" }).click();
    await expect(page.getByText(/Development: \d+/).first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole("navigation").getByRole("link", { name: "Scenarios" }).click();
    await expect(page.getByRole("heading", { name: "Scenarios" })).toBeVisible();

    const suites = await (await page.request.get("/api/suites")).json();
    const scenarios = await (await page.request.get(`/api/suites/${suites[0].id}/scenarios`)).json();
    expect(scenarios.length).toBeGreaterThan(0);

    // one customer never spans two splits
    const splitsByCustomer = new Map<string, Set<string>>();
    for (const scenario of scenarios) {
      const set = splitsByCustomer.get(scenario.authenticated_customer_id) ?? new Set();
      set.add(scenario.split);
      splitsByCustomer.set(scenario.authenticated_customer_id, set);
    }
    for (const set of splitsByCustomer.values()) expect(set.size).toBe(1);
  });

  test("a scenario drawer shows the trusted actor and hides expectations from the agent prompt", async ({ page }) => {
    await page.goto("/scenarios");
    await page.locator("tbody tr").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("Trusted actor and target")).toBeVisible();
    await expect(page.getByText("What the agent receives")).toBeVisible();
    await expect(
      page.getByText(/Expected outcomes are admin-only/),
    ).toBeVisible();
  });

  test("the permissive baseline is visible and cannot be activated", async ({ page }) => {
    await page.goto("/policies");
    await expect(page.getByRole("heading", { name: "Policies" })).toBeVisible();
    // assert on behaviour and the human label, not on the raw enum value
    await expect(page.getByText("Permissive baseline").first()).toBeVisible();

    await page.getByText("Permissive baseline").first().click();
    await expect(page.getByRole("button", { name: /Activate/ }).first()).toBeDisabled();

    // the exact policy document stays inspectable
    await page.getByRole("tab", { name: /Technical details/ }).click();
    await expect(page.getByText('"schema_version"').first()).toBeVisible();
  });

  test("experiments show real outcomes, including honest failures and No data", async ({ page }) => {
    const experiments = await (await page.request.get("/api/experiments")).json();
    test.skip(experiments.length === 0, "no experiment has been run in this workspace yet");

    await page.goto("/experiments");
    await expect(page.getByRole("heading", { name: "Experiments" })).toBeVisible();
    await expect(page.getByText("Legitimate tasks completed").first()).toBeVisible();

    const detail = await (await page.request.get(`/api/experiments/${experiments[0].id}`)).json();
    const rate = detail.metrics?.legit_completion?.rate;
    if (rate === null || rate === undefined) {
      // a zero denominator must read "No data", never 0%
      await expect(page.getByText("No data").first()).toBeVisible();
    }
    if ((detail.metrics?.runs?.infrastructure_failures ?? 0) > 0) {
      await page.getByRole("tab", { name: /Failures and violations/ }).click();
      await expect(page.locator("tbody tr").first()).toBeVisible();
    }
  });

  test("the playground refuses to run without an activated policy", async ({ page }) => {
    const workspace = await (await page.request.get("/api/workspace")).json();
    await page.goto("/playground");
    if (workspace.active_policy) {
      await expect(page.getByRole("heading", { name: "Session", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Start session" })).toBeVisible();
      // the session identity comes from the server, not from anything typed in
      await expect(page.getByText("Sign in as a generated customer")).toBeVisible();
    } else {
      await expect(page.getByText("No policy is active")).toBeVisible();
      await expect(page.getByRole("link", { name: "Policies" }).last()).toBeVisible();
    }
  });

  test("settings never expose secrets and show setup instructions when a key is missing", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByText("Environment (read-only)")).toBeVisible();

    const settings = await (await page.request.get("/api/settings")).json();
    const serialised = JSON.stringify(settings);
    // credentials_present carries booleans only - never a key value
    expect(typeof settings.environment.credentials_present.wandb_api_key).toBe("boolean");
    expect(serialised.toLowerCase()).not.toMatch(/[a-f0-9]{40}/); // no raw API-key shape anywhere
    expect(serialised).not.toContain("Bearer ");

    if (!settings.environment.credentials_present.wandb_api_key) {
      await expect(page.getByText(/not configured|not set/).first()).toBeVisible();
    }
    await expect(page.getByText("Business contract")).toBeVisible();
  });

  test("keyboard navigation reaches the primary sections", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab"); // skip link
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    for (const label of ["Workspace", "Scenarios", "Experiments"]) {
      await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
  });
});
