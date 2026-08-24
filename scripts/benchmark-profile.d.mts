export interface WindowsMachineFacts {
  readonly hardwareProbe: {
    readonly succeeded: boolean;
    readonly reason: string;
  };
  readonly os: string;
  readonly osBuildNumber: number;
  readonly osArchitecture: "x64" | "arm64" | "unknown";
  readonly cpu: string;
  readonly physicalCoreCount: number;
  readonly logicalCpuCount: number;
  readonly pcSystemType: number;
  readonly chassisTypes: readonly number[];
  readonly machineType: "desktop" | "non-desktop" | "unknown";
  readonly availableMemoryBytes: number;
}

export interface BenchmarkGitProvenance {
  readonly gitProbe: {
    readonly succeeded: true;
    readonly reason: "git-read-only";
  };
  readonly testedCommit: string;
  readonly worktreeClean: boolean;
}

export interface BenchmarkRepositoryEvidence {
  readonly probeSucceeded: boolean;
  readonly reason: string;
  readonly currentHead: string | null;
  readonly testedCommitIsAncestor: boolean;
  readonly performanceSensitiveChangedPaths: readonly string[];
}

export const OFFICIAL_BENCHMARK_PROFILE_PATH: string;
export const PERFORMANCE_REFERENCE_REQUIREMENTS: readonly string[];
export const PERFORMANCE_SENSITIVE_PATHS: readonly string[];
export function collectWindowsMachineFacts(): WindowsMachineFacts;
export function collectGitProvenance(): BenchmarkGitProvenance;
export function collectBenchmarkRepositoryEvidence(
  testedCommit: string,
): BenchmarkRepositoryEvidence;
export function referenceEnvironmentIssues(
  environment: Readonly<Record<string, unknown>>,
): string[];
export function validateOfficialBenchmarkProfile(profile: unknown): string[];
export function validateBenchmarkSourceProvenance(
  profile: unknown,
  repositoryEvidence: BenchmarkRepositoryEvidence | undefined,
): string[];
