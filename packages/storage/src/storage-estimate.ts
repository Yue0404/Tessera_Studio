import { StorageRepositoryError } from "./storage-error.js";

export interface StorageEstimateSnapshot {
  readonly quota: number | undefined;
  readonly usage: number | undefined;
}

export interface StorageEstimateGateway {
  estimate(): Promise<StorageEstimateSnapshot>;
  requestPersistence(): Promise<boolean>;
}

export interface StorageCapacityPolicy {
  readonly minimumSafetyMarginBytes: number;
  readonly maximumPeakUsageRatio: number;
}

export const DEFAULT_STORAGE_CAPACITY_POLICY: StorageCapacityPolicy = {
  minimumSafetyMarginBytes: 256 * 1024 * 1024,
  maximumPeakUsageRatio: 0.8,
};

export interface StorageCapacityPlan {
  readonly mode: "estimated" | "persistent-best-effort";
  readonly archiveBytes: number;
  readonly expandedBytes: number;
  readonly peakBytes: number;
  readonly safetyMarginBytes: number;
  readonly requiredBytes: number;
  readonly availableBytes: number | null;
  readonly quotaBytes: number | null;
  readonly usageBytes: number | null;
}

export class BrowserStorageEstimateGateway implements StorageEstimateGateway {
  async estimate(): Promise<StorageEstimateSnapshot> {
    const manager = globalThis.navigator?.storage;
    if (manager === undefined || typeof manager.estimate !== "function") {
      return { quota: undefined, usage: undefined };
    }
    const estimate = await manager.estimate();
    return { quota: estimate.quota, usage: estimate.usage };
  }

  async requestPersistence(): Promise<boolean> {
    const manager = globalThis.navigator?.storage;
    if (manager === undefined || typeof manager.persist !== "function") {
      return false;
    }
    return manager.persist();
  }
}

export class FixedStorageEstimateGateway implements StorageEstimateGateway {
  constructor(
    readonly snapshot: StorageEstimateSnapshot,
    readonly persistenceGranted = true,
  ) {}

  async estimate(): Promise<StorageEstimateSnapshot> {
    return this.snapshot;
  }

  async requestPersistence(): Promise<boolean> {
    return this.persistenceGranted;
  }
}

function isValidByteCount(value: number | undefined): value is number {
  return (
    value !== undefined &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    Number.isFinite(value)
  );
}

export async function requireStorageCapacity(
  gateway: StorageEstimateGateway,
  archiveBytes: number,
  expandedBytes: number,
  policy: StorageCapacityPolicy = DEFAULT_STORAGE_CAPACITY_POLICY,
): Promise<StorageCapacityPlan> {
  const peakBytes = archiveBytes + expandedBytes;
  if (
    !isValidByteCount(archiveBytes) ||
    !isValidByteCount(expandedBytes) ||
    !Number.isSafeInteger(peakBytes) ||
    peakBytes < 0 ||
    !Number.isSafeInteger(policy.minimumSafetyMarginBytes) ||
    policy.minimumSafetyMarginBytes < 0 ||
    !(policy.maximumPeakUsageRatio > 0) ||
    !(policy.maximumPeakUsageRatio < 1)
  ) {
    throw new StorageRepositoryError(
      "local-package-input-invalid",
      { field: "capacity" },
      "reimport-package",
    );
  }
  let snapshot: StorageEstimateSnapshot;
  try {
    snapshot = await gateway.estimate();
  } catch {
    snapshot = { quota: undefined, usage: undefined };
  }
  const ratioMargin = Math.ceil(
    peakBytes * (1 / policy.maximumPeakUsageRatio - 1),
  );
  const safetyMarginBytes = Math.max(
    policy.minimumSafetyMarginBytes,
    ratioMargin,
  );
  const requiredBytes = peakBytes + safetyMarginBytes;
  if (
    !isValidByteCount(ratioMargin) ||
    !isValidByteCount(safetyMarginBytes) ||
    !isValidByteCount(requiredBytes)
  ) {
    throw new StorageRepositoryError(
      "local-package-input-invalid",
      { field: "capacityPolicy" },
      "reimport-package",
    );
  }
  if (!isValidByteCount(snapshot.quota) || !isValidByteCount(snapshot.usage)) {
    let persistenceGranted = false;
    try {
      persistenceGranted = await gateway.requestPersistence();
    } catch {
      // 持久化请求失败不暴露浏览器原始异常。
    }
    if (persistenceGranted) {
      return {
        mode: "persistent-best-effort",
        archiveBytes,
        expandedBytes,
        peakBytes,
        safetyMarginBytes,
        requiredBytes,
        availableBytes: null,
        quotaBytes: null,
        usageBytes: null,
      };
    }
    throw new StorageRepositoryError(
      "storage-estimate-unavailable",
      { archiveBytes, expandedBytes, peakBytes },
      "export-project",
    );
  }
  const availableBytes = Math.max(0, snapshot.quota - snapshot.usage);
  const details = {
    mode: "estimated" as const,
    archiveBytes,
    expandedBytes,
    peakBytes,
    safetyMarginBytes,
    requiredBytes,
    availableBytes,
    quotaBytes: snapshot.quota,
    usageBytes: snapshot.usage,
  };
  if (requiredBytes > availableBytes) {
    throw new StorageRepositoryError(
      "storage-quota-insufficient",
      details,
      "free-space",
    );
  }
  return details;
}
