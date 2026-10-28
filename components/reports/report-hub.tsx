"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import {
  FileBarChart,
  ClipboardList,
  Workflow,
  Bot,
  Network,
  Plus,
  Star,
  StarOff,
  Share2,
  Trash2,
  Copy,
  Search,
  Scale,
  Archive,
  CheckSquare,
  Square,
  AlertTriangle,
  ChevronUp,
  ChevronDown,
  Grid3x3,
  List as ListIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { bulkDeleteWithJob, useJobs } from "@/components/jobs/jobs-provider";
import {
  deleteReport,
  toggleFavorite,
  toggleShare,
  duplicateReport,
} from "@/app/actions/reports";
import { InlineNotice } from "@/components/ui/inline-notice";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ExportAssetButton } from "@/components/shared/config-transfer";
import {
  buildQueuedDeleteNotice,
  type DeleteNotice,
} from "@/lib/queued-delete-feedback";

const PRE_BUILT_REPORTS = [
  {
    href: "/reports/tasks",
    label: "Task Analytics",
    description:
      "Status distribution, completion rates, effort accuracy, overdue analysis",
    icon: ClipboardList,
    color: "bg-[color:var(--theme-primary-text)]",
  },
  {
    href: "/reports/workflows",
    label: "Workflow Analytics",
    description:
      "Execution success/failure, duration, error patterns, queue health",
    icon: Workflow,
    color: "bg-purple-500",
  },
  {
    href: "/reports/integrations",
    label: "Integration Health",
    description: "Connection status, test results, usage metrics",
    icon: Network,
    color: "bg-rose-500",
  },
  {
    href: "/reports/business-rules",
    label: "Business Rules",
    description:
      "Rule executions, matched branches, and workflow usage patterns",
    icon: Scale,
    color: "bg-[#6E8CA0]",
  },
  {
    href: "/reports/retention",
    label: "Retention Policies",
    description:
      "Coverage, reviews, executions, and upcoming governance actions",
    icon: Archive,
    color: "bg-emerald-500",
  },
];

const CATEGORY_ICONS: Record<string, typeof FileBarChart> = {
  tasks: ClipboardList,
  workflows: Workflow,
  agents: Bot,
  integrations: Network,
  business_rules: Scale,
  retention: Archive,
  custom: FileBarChart,
};

type SavedSortField = "name" | "category" | "updated_at";
type SavedFilter = "all" | "mine" | "shared" | "favorites";
type SavedView = "grid" | "list";

const DEFAULT_PAGE_SIZE = 25;

export function ReportHub({
  savedReports,
  userId,
}: {
  savedReports: any[];
  userId: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const jobs = useJobs();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<SavedFilter>("all");
  const [sortBy, setSortBy] = useState<SavedSortField>("updated_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [viewMode, setViewMode] = useState<SavedView>("grid");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [localReports, setLocalReports] = useState<any[]>(savedReports);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteNotice, setBulkDeleteNotice] = useState<DeleteNotice | null>(
    null,
  );
  const [notice, setNotice] = useState<{
    tone: "success" | "warning" | "error";
    message: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    setLocalReports(savedReports);
  }, [savedReports]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return localReports.filter((r) => {
      if (
        q &&
        !(r.name ?? "").toLowerCase().includes(q) &&
        !(r.description ?? "").toLowerCase().includes(q)
      )
        return false;
      if (filter === "mine" && r.created_by !== userId) return false;
      if (filter === "shared" && !r.is_shared) return false;
      if (filter === "favorites" && !r.is_favorite) return false;
      return true;
    });
  }, [localReports, search, filter, userId]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "name")
        cmp = String(a.name ?? "").localeCompare(String(b.name ?? ""));
      else if (sortBy === "category")
        cmp = String(a.category ?? "").localeCompare(String(b.category ?? ""));
      else
        cmp =
          new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      return sortDir === "desc" ? -cmp : cmp;
    });
    return copy;
  }, [filtered, sortBy, sortDir]);

  useEffect(() => {
    setPage(1);
  }, [search, filter, pageSize]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => sorted.slice((safePage - 1) * pageSize, safePage * pageSize),
    [sorted, safePage, pageSize],
  );

  function toggleSort(field: SavedSortField) {
    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(field);
      setSortDir(field === "name" ? "asc" : "desc");
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allPageSelected =
    pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  function toggleSelectPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        for (const row of pageRows) next.delete(row.id);
      } else {
        for (const row of pageRows) next.add(row.id);
      }
      return next;
    });
  }

  async function safeAction(id: string, action: () => Promise<void>) {
    setActionLoading(id);
    try {
      await action();
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      router.refresh();
    } catch (err: any) {
      setNotice({ tone: "error", message: err?.message ?? "Action failed" });
    }
    setActionLoading(null);
  }

  async function safeDeleteReport(id: string) {
    const previous = localReports;
    setLocalReports((current) => current.filter((report) => report.id !== id));
    setSelected((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setActionLoading(id);
    try {
      await deleteReport(id);
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      router.refresh();
    } catch (err: any) {
      setLocalReports(previous);
      setNotice({ tone: "error", message: err?.message ?? "Delete failed" });
    }
    setActionLoading(null);
  }

  async function handleBulkDelete() {
    setBulkDeleting(true);
    setBulkDeleteNotice(null);
    const ids = Array.from(selected);
    const previous = localReports;
    const selectedCount = ids.length;
    setLocalReports((current) =>
      current.filter((report) => !selected.has(report.id)),
    );
    setSelected(new Set());
    setShowBulkDelete(false);
    try {
      const result = await bulkDeleteWithJob(jobs, "report", ids, () => queryClient.invalidateQueries({ queryKey: ["reports"] }));
      if (!result.background) setBulkDeleteNotice(
        buildQueuedDeleteNotice({
          queued: result?.queued ?? 0,
          total: selectedCount,
          singular: "report",
          plural: "reports",
        }),
      );
    } catch (err: any) {
      setLocalReports(previous);
      setBulkDeleteNotice({
        tone: "error",
        message: err?.message ?? "Bulk delete failed",
      });
    }
    setBulkDeleting(false);
  }

  function SortIcon({ field }: { field: SavedSortField }) {
    if (sortBy !== field) return null;
    return sortDir === "asc" ? (
      <ChevronUp size={10} />
    ) : (
      <ChevronDown size={10} />
    );
  }

  return (
    <div className="space-y-6">
      {/* Pre-built reports */}
      <div>
        <h2
          className="text-sm font-semibold mb-3"
          style={{ color: "var(--theme-muted-text)" }}
        >
          Analytics
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {PRE_BUILT_REPORTS.map((r) => (
            <Link key={r.href} href={r.href}>
              <Card
                className="p-4 hover:shadow-md transition-shadow cursor-pointer h-full"
                style={{
                  backgroundColor: "var(--theme-card-bg)",
                  borderColor: "var(--theme-surface-border)",
                }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-white",
                      r.color,
                    )}
                  >
                    <r.icon size={20} />
                  </div>
                  <div className="min-w-0">
                    <h3
                      className="font-semibold text-sm"
                      style={{ color: "var(--theme-card-text)" }}
                    >
                      {r.label}
                    </h3>
                    <p
                      className="text-xs mt-0.5 line-clamp-2"
                      style={{ color: "var(--theme-muted-text)" }}
                    >
                      {r.description}
                    </p>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Saved reports */}
      <div className="space-y-3">
        <h2
          className="text-sm font-semibold"
          style={{ color: "var(--theme-muted-text)" }}
        >
          Saved Reports
        </h2>

        {notice && (
          <InlineNotice
            tone={notice.tone}
            message={notice.message}
            onDismiss={() => setNotice(null)}
          />
        )}

        {bulkDeleteNotice && (
          <InlineNotice
            tone={bulkDeleteNotice.tone}
            message={bulkDeleteNotice.message}
            onDismiss={() => setBulkDeleteNotice(null)}
          />
        )}

        <ConfirmDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          title="Delete Report"
          description={`Delete report "${deleteTarget?.name ?? "this report"}"?`}
          confirmLabel="Delete"
          destructive
          busy={Boolean(deleteTarget && actionLoading === deleteTarget.id)}
          onConfirm={async () => {
            if (!deleteTarget) return;
            await safeDeleteReport(deleteTarget.id);
            setDeleteTarget(null);
          }}
        />

        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reports…"
              className="pl-9 h-8 text-sm"
            />
          </div>
          <div className="flex gap-1 shrink-0">
            {(["all", "mine", "shared", "favorites"] as SavedFilter[]).map(
              (f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                    filter === f
                      ? "bg-[color:var(--theme-accent-light)] text-[color:var(--theme-card-text)]"
                      : "text-gray-500 hover:bg-gray-100",
                  )}
                >
                  {f === "all"
                    ? "All"
                    : f === "mine"
                      ? "Mine"
                      : f === "shared"
                        ? "Shared"
                        : "Favorites"}
                </button>
              ),
            )}
          </div>
          {/* Sort pills — only visible in grid mode; the list view
              headers double as sort buttons. */}
          {viewMode === "grid" && (
            <div className="flex items-center gap-1 shrink-0">
              {(["updated_at", "name", "category"] as SavedSortField[]).map(
                (f) => (
                  <button
                    key={f}
                    onClick={() => toggleSort(f)}
                    className="flex items-center gap-0.5 text-[10px] font-medium px-2 py-1 rounded"
                    style={{
                      backgroundColor:
                        sortBy === f
                          ? "var(--theme-primary-light)"
                          : "var(--theme-surface)",
                      color:
                        sortBy === f
                          ? "var(--theme-primary-text)"
                          : "var(--theme-muted-text)",
                    }}
                  >
                    {f === "updated_at"
                      ? "Updated"
                      : f === "name"
                        ? "Name"
                        : "Category"}
                    <SortIcon field={f} />
                  </button>
                ),
              )}
            </div>
          )}
          <div
            className="flex rounded-lg overflow-hidden border shrink-0"
            style={{ borderColor: "var(--theme-surface-border)" }}
          >
            <button
              onClick={() => setViewMode("grid")}
              className="p-1.5"
              style={{
                backgroundColor:
                  viewMode === "grid" ? "var(--theme-primary)" : "transparent",
                color:
                  viewMode === "grid" ? 'var(--theme-on-primary)' : "var(--theme-muted-text)",
              }}
              title="Card view"
            >
              <Grid3x3 size={14} />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className="p-1.5"
              style={{
                backgroundColor:
                  viewMode === "list" ? "var(--theme-primary)" : "transparent",
                color:
                  viewMode === "list" ? 'var(--theme-on-primary)' : "var(--theme-muted-text)",
              }}
              title="List view"
            >
              <ListIcon size={14} />
            </button>
          </div>
        </div>

        {/* Selection toolbar */}
        {selected.size > 0 && (
          <div
            className="flex items-center gap-3 rounded-lg px-4 py-2 border"
            style={{
              backgroundColor: "var(--theme-primary-light)",
              borderColor: "var(--theme-primary)",
            }}
          >
            <span
              className="text-sm font-medium"
              style={{ color: "var(--theme-primary-text)" }}
            >
              {selected.size} selected
            </span>
            <button
              onClick={() => setSelected(new Set())}
              className="text-[11px] hover:underline"
              style={{ color: "var(--theme-primary-text)" }}
            >
              Clear
            </button>
            <div className="flex-1" />
            <ExportAssetButton
              ids={[...selected]}
              name={`${selected.size} report${selected.size === 1 ? "" : "s"}`}
              className="!h-7 !text-[11px]"
            />
            <Button
              size="sm"
              onClick={() => setShowBulkDelete(true)}
              className="!bg-red-600 hover:!bg-red-700 !text-white h-7 text-[11px]"
            >
              <Trash2 size={12} className="mr-1" /> Delete {selected.size}
            </Button>
          </div>
        )}

        <p className="text-[11px]" style={{ color: "var(--theme-muted-text)" }}>
          {sorted.length === localReports.length
            ? `${localReports.length} report${localReports.length !== 1 ? "s" : ""}`
            : `${sorted.length} of ${localReports.length} reports match`}
        </p>

        {pageRows.length === 0 ? (
          <div
            className="text-center py-12 text-sm"
            style={{ color: "var(--theme-muted-text)" }}
          >
            {localReports.length === 0 ? (
              <>
                No saved reports yet.{" "}
                <Link
                  href="/reports/builder"
                  className="text-[color:var(--theme-card-text)] hover:underline"
                >
                  Create one
                </Link>
              </>
            ) : (
              "No reports match your filters."
            )}
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {pageRows.map((report) => {
              const Icon = CATEGORY_ICONS[report.category] ?? FileBarChart;
              const isSelected = selected.has(report.id);
              return (
                <Card
                  key={report.id}
                  className={cn(
                    "p-4 hover:shadow-md transition-shadow group relative",
                    isSelected && "ring-2",
                  )}
                  style={{
                    backgroundColor: "var(--theme-card-bg)",
                    borderColor: isSelected
                      ? "var(--theme-primary)"
                      : "var(--theme-surface-border)",
                    ...(isSelected
                      ? { boxShadow: "0 0 0 2px var(--theme-primary-light)" }
                      : {}),
                  }}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelect(report.id);
                    }}
                    className="absolute top-3 left-3 z-10"
                    title={isSelected ? "Deselect" : "Select"}
                    style={{
                      color: isSelected
                        ? "var(--theme-primary-text)"
                        : "var(--theme-muted-text)",
                    }}
                  >
                    {isSelected ? (
                      <CheckSquare size={15} />
                    ) : (
                      <Square size={15} />
                    )}
                  </button>

                  <div
                    className="flex items-start gap-3 pl-7 cursor-pointer"
                    onClick={() => router.push(`/reports/${report.id}`)}
                  >
                    <div
                      className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center"
                      style={{
                        backgroundColor: "var(--theme-surface)",
                        color: "var(--theme-primary-text)",
                      }}
                    >
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3
                        className="font-semibold text-sm truncate"
                        style={{ color: "var(--theme-card-text)" }}
                      >
                        {report.name}
                      </h3>
                      {report.description && (
                        <p
                          className="text-xs mt-0.5 line-clamp-2"
                          style={{ color: "var(--theme-muted-text)" }}
                        >
                          {report.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-full capitalize"
                          style={{
                            backgroundColor: "var(--theme-surface)",
                            color: "var(--theme-muted-text)",
                          }}
                        >
                          {report.category}
                        </span>
                        {report.is_shared && (
                          <Share2
                            size={10}
                            style={{ color: "var(--theme-muted-text)" }}
                          />
                        )}
                        <span
                          className="text-[10px] ml-auto"
                          style={{ color: "var(--theme-muted-text)" }}
                        >
                          {new Date(report.updated_at).toLocaleDateString(
                            "en-GB",
                            { day: "2-digit", month: "short" },
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="absolute top-2 right-2 hidden group-hover:flex items-center gap-0.5">
                    {actionLoading === report.id ? (
                      <span
                        className="text-[10px] px-2 py-1"
                        style={{ color: "var(--theme-muted-text)" }}
                      >
                        ...
                      </span>
                    ) : (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            safeAction(report.id, () =>
                              toggleFavorite(report.id),
                            );
                          }}
                          className="p-1 rounded hover:bg-gray-100"
                          title={
                            report.is_favorite
                              ? "Remove favorite"
                              : "Add favorite"
                          }
                        >
                          {report.is_favorite ? (
                            <Star
                              size={12}
                              className="text-amber-500 fill-amber-500"
                            />
                          ) : (
                            <StarOff size={12} className="text-gray-400" />
                          )}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            safeAction(report.id, () => toggleShare(report.id));
                          }}
                          className="p-1 rounded hover:bg-gray-100"
                          title={
                            report.is_shared
                              ? "Make private"
                              : "Share with team"
                          }
                        >
                          <Share2
                            size={12}
                            className={
                              report.is_shared
                                ? "text-[color:var(--theme-card-text)]"
                                : "text-gray-400"
                            }
                          />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            safeAction(report.id, () =>
                              duplicateReport(report.id).then(() => {}),
                            );
                          }}
                          className="p-1 rounded hover:bg-gray-100"
                          title="Duplicate"
                        >
                          <Copy size={12} className="text-gray-400" />
                        </button>
                        <ExportAssetButton
                          ids={[report.id]}
                          name={report.name ?? "Report"}
                          iconOnly
                          variant="ghost"
                          className="!h-auto !p-1 text-gray-400"
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget({
                              id: report.id,
                              name: report.name ?? "Report",
                            });
                          }}
                          className="p-1 rounded hover:bg-gray-100"
                          title="Delete"
                        >
                          <Trash2 size={12} className="text-red-400" />
                        </button>
                      </>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <div
            className="rounded-xl border overflow-hidden max-lg:overflow-x-auto"
            style={{
              borderColor: "var(--theme-surface-border)",
              backgroundColor: "var(--theme-card-bg)",
            }}
          >
            <div
              className="max-lg:min-w-[680px] grid grid-cols-[32px_minmax(0,2.4fr)_120px_90px_110px_120px] gap-3 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider"
              style={{
                backgroundColor: "var(--theme-surface)",
                color: "var(--theme-muted-text)",
              }}
            >
              <button
                onClick={toggleSelectPage}
                title={
                  allPageSelected
                    ? "Deselect all on page"
                    : "Select all on page"
                }
                style={{
                  color: allPageSelected
                    ? "var(--theme-primary-text)"
                    : "var(--theme-muted-text)",
                }}
              >
                {allPageSelected ? (
                  <CheckSquare size={13} />
                ) : (
                  <Square size={13} />
                )}
              </button>
              <button
                className="text-left flex items-center gap-1 hover:opacity-80"
                onClick={() => toggleSort("name")}
                style={{
                  color: sortBy === "name" ? "var(--theme-primary-text)" : undefined,
                }}
              >
                Name <SortIcon field="name" />
              </button>
              <button
                className="text-left flex items-center gap-1 hover:opacity-80"
                onClick={() => toggleSort("category")}
                style={{
                  color:
                    sortBy === "category" ? "var(--theme-primary-text)" : undefined,
                }}
              >
                Category <SortIcon field="category" />
              </button>
              <div>Shared</div>
              <button
                className="text-left flex items-center gap-1 hover:opacity-80"
                onClick={() => toggleSort("updated_at")}
                style={{
                  color:
                    sortBy === "updated_at"
                      ? "var(--theme-primary-text)"
                      : undefined,
                }}
              >
                Updated <SortIcon field="updated_at" />
              </button>
              <div className="text-right pr-2">Actions</div>
            </div>
            {pageRows.map((report) => {
              const Icon = CATEGORY_ICONS[report.category] ?? FileBarChart;
              const isSelected = selected.has(report.id);
              return (
                <div
                  key={report.id}
                  className="max-lg:min-w-[680px] grid grid-cols-[32px_minmax(0,2.4fr)_120px_90px_110px_120px] gap-3 px-4 py-3 items-center border-t text-xs"
                  style={{
                    borderColor: "var(--theme-surface-border)",
                    backgroundColor: isSelected
                      ? "var(--theme-primary-light)"
                      : undefined,
                  }}
                >
                  <button
                    onClick={() => toggleSelect(report.id)}
                    title={isSelected ? "Deselect" : "Select"}
                    style={{
                      color: isSelected
                        ? "var(--theme-primary-text)"
                        : "var(--theme-muted-text)",
                    }}
                  >
                    {isSelected ? (
                      <CheckSquare size={13} />
                    ) : (
                      <Square size={13} />
                    )}
                  </button>
                  <Link
                    href={`/reports/${report.id}`}
                    className="flex items-center gap-2 min-w-0"
                  >
                    <Icon
                      size={14}
                      className="shrink-0"
                      style={{ color: "var(--theme-primary-text)" }}
                    />
                    <div className="min-w-0">
                      <div
                        className="font-medium truncate"
                        style={{ color: "var(--theme-card-text)" }}
                      >
                        {report.is_favorite && (
                          <Star
                            size={10}
                            className="inline mr-1 text-amber-500 fill-amber-500"
                          />
                        )}
                        {report.name}
                      </div>
                      {report.description && (
                        <div
                          className="text-[10px] truncate"
                          style={{ color: "var(--theme-muted-text)" }}
                        >
                          {report.description}
                        </div>
                      )}
                    </div>
                  </Link>
                  <span
                    className="capitalize text-[11px]"
                    style={{ color: "var(--theme-muted-text)" }}
                  >
                    {report.category ?? "—"}
                  </span>
                  <span>
                    {report.is_shared ? (
                      <span
                        className="inline-flex items-center gap-1 text-[10px]"
                        style={{ color: "var(--theme-primary-text)" }}
                      >
                        <Share2 size={10} /> Shared
                      </span>
                    ) : (
                      <span
                        className="text-[10px]"
                        style={{ color: "var(--theme-muted-text)" }}
                      >
                        Private
                      </span>
                    )}
                  </span>
                  <span
                    className="text-[11px]"
                    style={{ color: "var(--theme-muted-text)" }}
                  >
                    {new Date(report.updated_at).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                    })}
                  </span>
                  <div className="flex items-center justify-end gap-0.5">
                    <button
                      onClick={() =>
                        safeAction(report.id, () => toggleFavorite(report.id))
                      }
                      className="p-1 rounded hover:bg-[var(--theme-surface)]"
                      title={
                        report.is_favorite ? "Remove favorite" : "Favorite"
                      }
                    >
                      {report.is_favorite ? (
                        <Star
                          size={12}
                          className="text-amber-500 fill-amber-500"
                        />
                      ) : (
                        <StarOff size={12} className="text-gray-400" />
                      )}
                    </button>
                    <button
                      onClick={() =>
                        safeAction(report.id, () => toggleShare(report.id))
                      }
                      className="p-1 rounded hover:bg-[var(--theme-surface)]"
                      title={report.is_shared ? "Make private" : "Share"}
                    >
                      <Share2
                        size={12}
                        className={
                          report.is_shared ? "text-[color:var(--theme-card-text)]" : "text-gray-400"
                        }
                      />
                    </button>
                    <button
                      onClick={() =>
                        safeAction(report.id, () =>
                          duplicateReport(report.id).then(() => {}),
                        )
                      }
                      className="p-1 rounded hover:bg-[var(--theme-surface)]"
                      title="Duplicate"
                    >
                      <Copy size={12} className="text-gray-400" />
                    </button>
                    <ExportAssetButton
                      ids={[report.id]}
                      name={report.name ?? "Report"}
                      iconOnly
                      variant="ghost"
                      className="!h-auto !p-1 text-gray-400"
                    />
                    <button
                      onClick={() =>
                        setDeleteTarget({
                          id: report.id,
                          name: report.name ?? "Report",
                        })
                      }
                      className="p-1 rounded hover:bg-red-50"
                      title="Delete"
                    >
                      <Trash2 size={12} className="text-red-400" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination footer */}
        {sorted.length > 0 && (
          <div
            className="flex items-center justify-between px-3 py-2 rounded-lg border text-[11px]"
            style={{
              borderColor: "var(--theme-surface-border)",
              backgroundColor: "var(--theme-card-bg)",
              color: "var(--theme-muted-text)",
            }}
          >
            <div className="flex items-center gap-2">
              <span>
                Showing {(safePage - 1) * pageSize + 1}–
                {Math.min(safePage * pageSize, sorted.length)} of{" "}
                {sorted.length}
              </span>
              <span>·</span>
              <label className="flex items-center gap-1">
                Rows per page
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="rounded border px-1.5 py-0.5 text-[11px]"
                  style={{
                    borderColor: "var(--theme-surface-border)",
                    backgroundColor: "var(--theme-card-bg)",
                    color: "var(--theme-card-text)",
                  }}
                >
                  {[12, 25, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="px-2 py-1 rounded disabled:opacity-30 hover:bg-[var(--theme-surface)]"
                >
                  ‹ Prev
                </button>
                <span className="px-2">
                  Page {safePage} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className="px-2 py-1 rounded disabled:opacity-30 hover:bg-[var(--theme-surface)]"
                >
                  Next ›
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bulk delete confirmation */}
      <Dialog.Root
        open={showBulkDelete}
        onOpenChange={(open) => {
          if (!open) {
            setShowBulkDelete(false);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50 dialog-overlay" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(24rem,92vw)] rounded-xl p-6 shadow-xl dialog-content"
            style={{ backgroundColor: "var(--theme-card-bg)" }}
          >
            <Dialog.Title
              className="text-lg font-semibold mb-2"
              style={{ color: "var(--theme-card-text)" }}
            >
              Delete {selected.size} Report{selected.size !== 1 ? "s" : ""}
            </Dialog.Title>
            <p
              className="text-sm mb-1"
              style={{ color: "var(--theme-muted-text)" }}
            >
              Are you sure you want to delete {selected.size} selected report
              {selected.size !== 1 ? "s" : ""}?
            </p>
            <p
              className="text-xs mb-4"
              style={{ color: "var(--theme-danger, #DC2626)" }}
            >
              <AlertTriangle size={11} className="inline mr-1" /> This will
              permanently delete the selected reports.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowBulkDelete(false);
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="!bg-red-600 hover:!bg-red-700 !text-white"
              >
                {bulkDeleting
                  ? `Deleting (${selected.size})...`
                  : `Delete ${selected.size}`}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
