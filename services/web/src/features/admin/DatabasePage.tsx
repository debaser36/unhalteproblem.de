import { useAtomRefresh } from "@effect/atom-react";
import type { DatabaseOverview } from "@unhalteproblem.de/api";
import { RefreshCw } from "lucide-react";
import { AsyncView } from "#api/AsyncView.tsx";
import { formatBytes, formatDateTime, formatNumber } from "#lib/format.ts";
import { Button } from "#ui/Button.tsx";
import { StatTile } from "#ui/StatTile.tsx";
import { Table, Td, Th } from "#ui/Table.tsx";
import { AdminHeading } from "./AdminHeading.tsx";
import { databaseAtom } from "./insightsAtoms.ts";

export function DatabasePage() {
  const refresh = useAtomRefresh(databaseAtom);
  return (
    <>
      <AdminHeading
        title="Database"
        actions={
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw size={14} />}
            onClick={refresh}
          >
            Refresh
          </Button>
        }
      >
        Postgres as it is right now: statistics only, never the rows.
      </AdminHeading>
      <AsyncView atom={databaseAtom}>
        {(overview) => <Overview overview={overview} />}
      </AsyncView>
    </>
  );
}

/** `PostgreSQL 17.2 on x86_64…` → `PostgreSQL 17.2` */
const shortVersion = (version: string) => version.split(" on ")[0] ?? version;

function Overview({ overview }: { readonly overview: DatabaseOverview }) {
  const { connections } = overview;
  const largest = Math.max(
    1,
    ...overview.tables.map((table) => table.totalBytes),
  );
  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Server"
          value={shortVersion(overview.postgresVersion)}
          note={`up since ${formatDateTime(overview.startedAt)}`}
        />
        <StatTile
          label="Size"
          value={formatBytes(overview.databaseBytes)}
          note={overview.databaseName}
        />
        <StatTile
          label="Connections"
          value={`${connections.total} / ${connections.max}`}
          note={`${connections.active} active · ${connections.idle} idle`}
        />
        <StatTile
          label="Cache hit ratio"
          value={
            overview.cacheHitRatio === null
              ? "—"
              : `${(overview.cacheHitRatio * 100).toFixed(1)} %`
          }
          note="of block reads served from memory"
        />
      </div>

      <section aria-labelledby="tables" className="space-y-3">
        <h2 id="tables" className="font-semibold text-fg">
          Tables
        </h2>
        <Table>
          <thead>
            <tr>
              <Th>Table</Th>
              <Th className="w-[30%]">Size (table + indexes)</Th>
              <Th className="text-right">≈ Rows</Th>
              <Th className="text-right">Seq / index scans</Th>
              <Th>Last vacuum / analyze</Th>
            </tr>
          </thead>
          <tbody>
            {overview.tables.map((table) => {
              const vacuum = table.lastVacuum ?? table.lastAutovacuum;
              const analyze = table.lastAnalyze ?? table.lastAutoanalyze;
              return (
                <tr key={table.name} className="hover:bg-surface-2/50">
                  <Td className="font-mono text-xs text-fg">{table.name}</Td>
                  <Td>
                    <div
                      className="flex items-center gap-3"
                      title={`${formatBytes(table.tableBytes)} table, ${formatBytes(table.indexBytes)} indexes`}
                    >
                      <div className="h-2 flex-1 rounded-full bg-surface-3">
                        <div
                          className="h-2 rounded-full bg-accent"
                          style={{
                            width: `${Math.max(2, (table.totalBytes / largest) * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums">
                        {formatBytes(table.totalBytes)}
                      </span>
                    </div>
                  </Td>
                  <Td className="text-right font-mono text-xs tabular-nums">
                    {formatNumber(table.estimatedRows)}
                  </Td>
                  <Td className="text-right font-mono text-xs tabular-nums">
                    {formatNumber(table.sequentialScans)} /{" "}
                    {table.indexScans === null
                      ? "—"
                      : formatNumber(table.indexScans)}
                  </Td>
                  <Td className="text-xs whitespace-nowrap">
                    {vacuum === null ? "never" : formatDateTime(vacuum)}
                    <span className="text-muted"> / </span>
                    {analyze === null ? "never" : formatDateTime(analyze)}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </section>

      <section aria-labelledby="migrations" className="space-y-3">
        <h2 id="migrations" className="font-semibold text-fg">
          Migrations{" "}
          <span className="font-mono text-sm text-muted">
            ({overview.migrations.length})
          </span>
        </h2>
        <ol className="space-y-1 rounded-xl border border-border bg-surface/80 p-4 font-mono text-xs">
          {[...overview.migrations].reverse().map((migration) => (
            <li
              key={migration.id}
              className="flex flex-wrap justify-between gap-2"
            >
              <span className="text-fg-soft">
                <span className="text-accent">
                  {String(migration.id).padStart(4, "0")}
                </span>{" "}
                {migration.name}
              </span>
              <span className="text-muted">
                {formatDateTime(migration.appliedAt)}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
