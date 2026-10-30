"use client";

import * as React from "react";
import { Printer, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ReportView } from "@/components/report-view";
import { api } from "@/lib/api";
import { useAgentStore } from "@/lib/store";
import type { ReportPayload } from "@/lib/types";

export default function ReportPage() {
  const storeReport = useAgentStore((s) => s.report);
  const setReport = useAgentStore((s) => s.setReport);
  const [report, setLocal] = React.useState<ReportPayload | null>(storeReport);
  const [loading, setLoading] = React.useState(storeReport === null);

  const refresh = React.useCallback((): void => {
    setLoading(true);
    api
      .report()
      .then((r) => {
        setLocal(r);
        setReport(r);
      })
      .catch(() => setLocal(null))
      .finally(() => setLoading(false));
  }, [setReport]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="no-print flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          A calm, printable summary of the last 7 days — great to show family or an IT helper.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={refresh} aria-label="Refresh report">
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden="true" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            Download PDF
          </Button>
        </div>
      </div>

      <Card className="no-print hidden print:block print:border-0 print:bg-transparent" />
      {loading && !report ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : report ? (
        <Card className="print:border-0 print:bg-transparent print:shadow-none">
          <CardContent className="p-6 print:p-0">
            <ReportView report={report} />
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          icon={Printer}
          title="No report available"
          body="The agent could not produce a report. Check the connection and try Refresh."
          action={
            <Button onClick={refresh} variant="secondary">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Retry
            </Button>
          }
        />
      )}
    </div>
  );
}
