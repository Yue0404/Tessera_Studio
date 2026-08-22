import { satisfies } from "semver";
import { runtimeError } from "./errors.js";
import type {
  MigrationPlan,
  ModuleMigrationManifest,
  ParsedModulePackage,
} from "./types.js";

export function createMigrationPlan(): {
  readonly status: "not-required";
  readonly steps: readonly never[];
};
export function createMigrationPlan(
  module: ParsedModulePackage,
  fromVersion: string,
): MigrationPlan;
export function createMigrationPlan(
  module?: ParsedModulePackage,
  fromVersion?: string,
): MigrationPlan {
  if (
    module === undefined ||
    fromVersion === undefined ||
    fromVersion === module.version
  ) {
    return Object.freeze({ status: "not-required", steps: Object.freeze([]) });
  }
  const matches: ModuleMigrationManifest[] = module.migrations.filter(
    (migration) =>
      satisfies(fromVersion, migration.fromVersionRange, {
        includePrerelease: true,
      }),
  );
  if (matches.length === 0) {
    return Object.freeze({ status: "not-required", steps: Object.freeze([]) });
  }
  if (matches.length > 1) {
    runtimeError("package-migration-ambiguous", "migrations", {
      fromVersion,
      migrationIds: matches.map((migration) => migration.migrationId),
    });
  }
  // v1 流水线必须经过这里，但 MVP 明确不执行任何实例转换。
  return Object.freeze({
    status: "execution-not-supported",
    steps: Object.freeze([matches[0] as ModuleMigrationManifest]),
  });
}
