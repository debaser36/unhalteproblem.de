import { assert, describe, it } from "@effect/vitest";
import { Exit, Schema } from "effect";
import { DatabaseOverview, DatabaseTable } from "./Database.ts";

const table: typeof DatabaseTable.Encoded = {
  name: "users",
  estimatedRows: 12,
  totalBytes: 98304,
  tableBytes: 16384,
  indexBytes: 81920,
  sequentialScans: 3,
  indexScans: 140,
  lastVacuum: null,
  lastAutovacuum: "2026-03-01T03:00:00.000Z",
  lastAnalyze: null,
  lastAutoanalyze: "2026-03-01T03:00:01.000Z",
};

const overview: typeof DatabaseOverview.Encoded = {
  postgresVersion: "17.5",
  databaseName: "unhalteproblem",
  databaseBytes: 8_000_000_000,
  startedAt: "2026-02-28T10:00:00.000Z",
  connections: { active: 1, idle: 4, total: 5, max: 100 },
  cacheHitRatio: 0.995,
  tables: [table, { ...table, name: "outbox", indexScans: null }],
  migrations: [
    {
      id: 1,
      name: "create_auth_tables",
      appliedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

describe("DatabaseOverview", () => {
  const decode = Schema.decodeUnknownExit(DatabaseOverview);

  it("round-trips, with and without a cache hit ratio", () => {
    for (const encoded of [overview, { ...overview, cacheHitRatio: null }]) {
      const decoded = Schema.decodeUnknownSync(DatabaseOverview)(encoded);
      assert.deepStrictEqual(
        Schema.encodeSync(DatabaseOverview)(decoded),
        encoded,
      );
    }
  });

  it("bounds the cache hit ratio to 0..1", () => {
    for (const cacheHitRatio of [0, 1]) {
      assert.isTrue(Exit.isSuccess(decode({ ...overview, cacheHitRatio })));
    }
    for (const cacheHitRatio of [-0.1, 1.1, Number.NaN, "0.9"]) {
      assert.isTrue(
        Exit.isFailure(decode({ ...overview, cacheHitRatio })),
        String(cacheHitRatio),
      );
    }
  });

  it("takes byte sizes and counters as non-negative safe integers, not strings", () => {
    for (const databaseBytes of [-1, 1.5, "8000000000", 2 ** 53]) {
      assert.isTrue(
        Exit.isFailure(decode({ ...overview, databaseBytes })),
        String(databaseBytes),
      );
    }
    assert.isTrue(
      Exit.isFailure(
        decode({ ...overview, tables: [{ ...table, totalBytes: "98304" }] }),
      ),
    );
    assert.isTrue(
      Exit.isFailure(
        decode({
          ...overview,
          connections: { ...overview.connections, max: -1 },
        }),
      ),
    );
  });
});
