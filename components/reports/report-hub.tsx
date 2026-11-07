"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  FileBarChart,
  ClipboardList,
  Workflow,
  Bot,
  Network,
  Star,
  StarOff,
  Share2,
  Trash2,
  Copy,
  Scale,
  Archive,
  ChevronUp,
  ChevronDown,
  FileDown,
  LayoutGrid,
  List as ListIcon,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SearchInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Tag } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Pagination } from "@/components/ui/list-controls";
import { Table, THead, TBody, TR, TH, TD, TDActions } from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format/date";
import { formatCount } from "@/lib/format/number";
import { plural } from "@/lib/format/plural";
import { bulkDeleteWithJob, useJobs } from "@/components/jobs/jobs-provider";
import {
  deleteReport,
  toggleFavorite,
  toggleShare,
  duplicateReport,
} from "@/app/actions/reports";
import { InlineNotice } from "@/components/ui/inline-notice";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ExportAssetDialog } from "@/components/shared/config-transfer";
import { usePermissions } from "@/lib/permissions-context";
import { canAccessPath } from "@/lib/route-permissions";
import {
  buildQueuedDeleteNotice,
  type DeleteNotice,
} from "@/lib/queued-delete-feedback";

const PRE_BUILT_REPORTS = [
  {
    href: "/reports/tasks",
    label: "Task analytics",
    description:
      "Status distribution, completion rates, effort accuracy, overdue analysis",
    icon: ClipboardList,
  },
  {
    href: "/reports/workflows",
    label: "Workflow analytics",
    description:
      "Execution success/failure, duration, error patterns, queue health",
    icon: Workflow,
  },
  {
    href: "/reports/integrations",
    label: "Integration health",
    description: "Connection status, test results, usage metrics",
    icon: Network,
  },
  {
    href: "/reports/business-rules",
    label: "Business rules",
    description:
      "Rule executions, matched branches, and workflow usage patterns",
    icon: Scale,
  },
  {
    href: "/reports/retention",
    label: "Retention policies",
    description:
      "Coverage, reviews, executions, and upcoming governance actions",
    icon: Archive,
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
  // Each analytics page needs its domain's permission (lib/route-permissions).
  const { permissions } = usePermissions();
  const analytics = PRE_BUILT_REPORTS.filter((r) => canAccessPath(r.href, permissions));
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
  const [exportTarget, setExportTarget] = useState<{ ids: string[]; name: string } | null>(null);

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
    return sortDir === "asc" ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />;
  }

  function RowMenu({ report }: { report: any }) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton size="sm" label={`Actions for ${report.name ?? "report"}`} icon={<MoreHorizontal />} loading={actionLoading === report.id} onClick={(e) => e.stopPropagation()} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem icon={report.is_favorite ? <StarOff /> : <Star />} onSelect={() => safeAction(report.id, () => toggleFavorite(report.id))}>
            {report.is_favorite ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Share2 />} onSelect={() => safeAction(report.id, () => toggleShare(report.id))}>
            {report.is_shared ? "Make private" : "Share with workspace"}
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Copy />} onSelect={() => safeAction(report.id, () => duplicateReport(report.id).then(() => {}))}>
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem icon={<FileDown />} onSelect={() => setExportTarget({ ids: [report.id], name: report.name ?? "Report" })}>
            Export definition
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem danger icon={<Trash2 />} onSelect={() => setDeleteTarget({ id: report.id, name: report.name ?? "Report" })}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const filterOptions: Array<{ value: SavedFilter; text: string }> = [
    { value: "all", text: "All" },
    { value: "mine", text: "Mine" },
    { value: "shared", text: "Shared" },
    { value: "favorites", text: "Pinned" },
  ];

  return (
    <div className="space-y-8">
      {/* Pre-built analytics */}
      {analytics.length > 0 && <section className="space-y-3" aria-labelledby="reports-analytics">
        <h2 id="reports-analytics" className="text-base font-semibold text-fg">Analytics</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {analytics.map((r) => (
            <Link key={r.href} href={r.href} className="block rounded-lg">
              <Card variant="interactive" padding="md" className="flex h-full items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-subtle text-fg-muted" aria-hidden>
                  <r.icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-fg">{r.label}</span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-fg-muted">{r.description}</span>
                </span>
              </Card>
            </Link>
          ))}
        </div>
      </section>}

      {/* Saved reports */}
      <section className="space-y-3" aria-labelledby="reports-saved">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="reports-saved" className="text-base font-semibold text-fg">Saved reports</h2>
          <span className="num text-xs text-fg-muted">
            {sorted.length === localReports.length
              ? plural(localReports.length, "report")
              : `${formatCount(sorted.length)} of ${plural(localReports.length, "report")}`}
          </span>
        </div>

        {notice && <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />}
        {bulkDeleteNotice && <InlineNotice tone={bulkDeleteNotice.tone} message={bulkDeleteNotice.message} onDismiss={() => setBulkDeleteNotice(null)} />}

        <ConfirmDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
          title={`Delete '${deleteTarget?.name ?? "this report"}'?`}
          description="The saved report is removed for everyone it is shared with. Its data is not affected."
          confirmLabel="Delete report"
          destructive
          busy={Boolean(deleteTarget && actionLoading === deleteTarget.id)}
          onConfirm={async () => {
            if (!deleteTarget) return;
            await safeDeleteReport(deleteTarget.id);
            setDeleteTarget(null);
          }}
        />
        <ConfirmDialog
          open={showBulkDelete}
          onOpenChange={(open) => { if (!open) setShowBulkDelete(false); }}
          title={`Delete ${plural(selected.size, "report")}?`}
          description="The selected reports are deleted for everyone they are shared with. This can't be undone."
          confirmLabel={`Delete ${plural(selected.size, "report")}`}
          destructive
          busy={bulkDeleting}
          onConfirm={handleBulkDelete}
        />
        <ExportAssetDialog
          ids={exportTarget?.ids ?? []}
          name={exportTarget?.name ?? ""}
          open={exportTarget !== null}
          onOpenChange={(open) => { if (!open) setExportTarget(null); }}
        />

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onValueChange={setSearch} placeholder="Search reports…" className="w-full min-w-[220px] max-w-sm" />
          <SegmentedControl aria-label="Show" size="sm" value={filter} onValueChange={(v) => setFilter(v)} options={filterOptions} />
          <div className="ml-auto flex items-center gap-2">
            {viewMode === "grid" && (
              <Select
                aria-label="Sort by"
                size="sm"
                value={sortBy}
                onChange={(e) => { setSortBy(e.target.value as SavedSortField); setSortDir(e.target.value === "name" ? "asc" : "desc"); }}
                options={[{ value: "updated_at", label: "Recently updated" }, { value: "name", label: "Name" }, { value: "category", label: "Category" }]}
                wrapperClassName="w-40"
              />
            )}
            <SegmentedControl
              aria-label="View"
              size="sm"
              value={viewMode}
              onValueChange={(v) => setViewMode(v)}
              options={[{ value: "grid", icon: <LayoutGrid />, label: "Cards" }, { value: "list", icon: <ListIcon />, label: "List" }]}
            />
          </div>
        </div>

        {/* Selection bar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-3 rounded-md border border-border bg-subtle px-3 py-1.5">
            <span className="num text-ui font-medium text-fg">{formatCount(selected.size)} selected</span>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            <div className="flex-1" />
            <Button size="sm" variant="secondary" leadingIcon={<FileDown />} onClick={() => setExportTarget({ ids: [...selected], name: plural(selected.size, "report") })}>
              Export
            </Button>
            <Button size="sm" variant="danger" leadingIcon={<Trash2 />} onClick={() => setShowBulkDelete(true)}>
              Delete {formatCount(selected.size)}
            </Button>
          </div>
        )}

        {pageRows.length === 0 ? (
          localReports.length === 0 ? (
            <EmptyState
              icon={FileBarChart}
              title="No saved reports yet"
              description="Build a report from any data source, chart it, and share it with your workspace."
              action={{ label: "New report", href: "/reports/builder" }}
            />
          ) : (
            <EmptyState
              size="sm"
              variant="no-results"
              title="No reports match your filters"
              action={{ label: "Clear filters", onClick: () => { setSearch(""); setFilter("all"); } }}
            />
          )
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pageRows.map((report) => {
              const Icon = CATEGORY_ICONS[report.category] ?? FileBarChart;
              const isSelected = selected.has(report.id);
              return (
                <Card
                  key={report.id}
                  variant="interactive"
                  padding="md"
                  className={cn("group relative flex min-w-0 cursor-pointer flex-col", isSelected && "border-primary bg-primary-wash")}
                  onClick={() => router.push(`/reports/${report.id}`)}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      aria-label={`Select ${report.name ?? "report"}`}
                      checked={isSelected}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelect(report.id)}
                      className="mt-0.5"
                    />
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-subtle text-fg-muted" aria-hidden>
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link href={`/reports/${report.id}`} onClick={(e) => e.stopPropagation()} className="block truncate text-sm font-semibold text-fg hover:underline">
                        {report.name}
                      </Link>
                      {report.description && <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{report.description}</p>}
                    </div>
                    <RowMenu report={report} />
                  </div>
                  <div className="mt-auto flex items-center gap-2 pt-3 text-xs text-fg-muted">
                    <Tag className="capitalize">{String(report.category ?? "custom").replace(/_/g, " ")}</Tag>
                    {report.is_favorite && <Star className="size-3.5 fill-current text-warning" aria-label="Pinned" />}
                    {report.is_shared && <Share2 className="size-3.5" aria-label="Shared" />}
                    <span className="num ml-auto">{formatRelative(report.updated_at)}</span>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH className="w-10">
                  <Checkbox aria-label={allPageSelected ? "Deselect all on page" : "Select all on page"} checked={allPageSelected} onChange={toggleSelectPage} />
                </TH>
                <TH aria-sort={sortBy === "name" ? (sortDir === "asc" ? "ascending" : "descending") : undefined}>
                  <button type="button" className="inline-flex items-center gap-1 hover:text-fg" onClick={() => toggleSort("name")}>Name <SortIcon field="name" /></button>
                </TH>
                <TH aria-sort={sortBy === "category" ? (sortDir === "asc" ? "ascending" : "descending") : undefined}>
                  <button type="button" className="inline-flex items-center gap-1 hover:text-fg" onClick={() => toggleSort("category")}>Category <SortIcon field="category" /></button>
                </TH>
                <TH>Sharing</TH>
                <TH aria-sort={sortBy === "updated_at" ? (sortDir === "asc" ? "ascending" : "descending") : undefined}>
                  <button type="button" className="inline-flex items-center gap-1 hover:text-fg" onClick={() => toggleSort("updated_at")}>Updated <SortIcon field="updated_at" /></button>
                </TH>
                <TH><span className="sr-only">Actions</span></TH>
              </tr>
            </THead>
            <TBody>
              {pageRows.map((report) => {
                const Icon = CATEGORY_ICONS[report.category] ?? FileBarChart;
                const isSelected = selected.has(report.id);
                return (
                  <TR key={report.id} selected={isSelected}>
                    <TD className="w-10">
                      <Checkbox aria-label={`Select ${report.name ?? "report"}`} checked={isSelected} onChange={() => toggleSelect(report.id)} />
                    </TD>
                    <TD className="max-w-[420px]">
                      <Link href={`/reports/${report.id}`} className="flex min-w-0 items-center gap-2">
                        <Icon className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
                        <span className="truncate font-medium text-fg hover:underline">{report.name}</span>
                        {report.is_favorite && <Star className="size-3.5 shrink-0 fill-current text-warning" aria-label="Pinned" />}
                      </Link>
                    </TD>
                    <TD className="capitalize text-fg-muted">{String(report.category ?? "—").replace(/_/g, " ")}</TD>
                    <TD className="text-fg-muted">{report.is_shared ? "Shared" : "Private"}</TD>
                    <TD className="num whitespace-nowrap text-fg-muted">{formatRelative(report.updated_at)}</TD>
                    <TDActions><RowMenu report={report} /></TDActions>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}

        <Pagination
          page={safePage}
          pageSize={pageSize}
          total={sorted.length}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          pageSizeOptions={[12, 25, 50, 100]}
          showPageNumbers
          noun="reports"
        />
      </section>
    </div>
  );
}
