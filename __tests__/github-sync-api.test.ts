import { describe, expect, it } from "vitest";
import { ENDPOINT_GROUPS } from "@/components/api-keys/api-explorer";
import { normalizeApiSyncScope } from "@/lib/github-sync/api-runs";

describe("GitHub Sync public API", () => {
  it("publishes the complete control and status surface in the API Explorer", () => {
    const group = ENDPOINT_GROUPS.find((item) => item.label === "GitHub sync");
    expect(group).toBeDefined();
    const operations = new Set(
      group!.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`),
    );
    for (const operation of [
      "GET /api/v1/github-sync/status",
      "GET /api/v1/github-sync/runs",
      "POST /api/v1/github-sync/runs",
      "GET /api/v1/github-sync/runs/{id}",
      "GET /api/v1/github-sync/schedule",
      "PUT /api/v1/github-sync/schedule",
      "DELETE /api/v1/github-sync/schedule",
      "POST /api/v1/github-sync/commit",
      "POST /api/v1/github-sync/deploy",
      "GET /api/v1/github-sync/deployments",
      "GET /api/v1/github-sync/deployments/{id}",
    ]) {
      expect(operations.has(operation), `missing ${operation}`).toBe(true);
    }
  });

  it("keeps only supported, well-formed scoped-sync assets", () => {
    expect(
      normalizeApiSyncScope({
        asset_types: ["workflows", "reports", "forms", "pages", "not_a_section"],
        assets: [
          { section: "data_tables", id: "table-1", name: "Customers" },
          { section: "pages", id: "page-1", name: "Portal" },
          { section: "bad", id: "x" },
          { section: "reports", id: "" },
        ],
      }),
    ).toEqual({
      // forms are a sync section again (reusable task forms); pages stay retired.
      asset_types: ["workflows", "reports", "forms"],
      assets: [{ section: "data_tables", id: "table-1", name: "Customers" }],
    });
  });

  it("rejects an empty scoped-sync selection", () => {
    expect(
      normalizeApiSyncScope({ asset_types: ["invalid"], assets: [] }),
    ).toBeUndefined();
  });
});
