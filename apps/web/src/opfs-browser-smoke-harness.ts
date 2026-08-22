import {
  BrowserOpfsGateway,
  BrowserStorageEstimateGateway,
  LocalPackageRepository,
  type LocalPackageIdentity,
} from "@tessera/storage";

/** 仅由 Playwright 通过 Vite 单独加载，不进入应用入口或生产 bundle。 */
function identityOf(seed: string): LocalPackageIdentity {
  return {
    kind: "module",
    artifactId: `example.opfs-${seed.replaceAll("-", "")}`,
    version: "1.0.0",
  };
}

function bytesSource(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3, 4]));
      controller.close();
    },
  });
}

function repository(): LocalPackageRepository {
  return new LocalPackageRepository({
    opfs: new BrowserOpfsGateway(),
    estimateGateway: new BrowserStorageEstimateGateway(),
  });
}

export async function stageAndCommit(seed: string): Promise<number> {
  const packages = repository();
  try {
    const identity = identityOf(seed);
    const result = await packages.install({
      identity,
      sourceKind: "user-file",
      archive: {
        fileName: `${identity.artifactId}.tessera-module.zip`,
        bytes: 4,
        source: bytesSource(),
      },
      expandedBytes: 4,
      files: [{ path: "payload.bin", bytes: 4, source: bytesSource() }],
    });
    return result.package.files[0]?.bytes ?? 0;
  } finally {
    packages.close();
  }
}

export async function reopenAndRead(
  seed: string,
): Promise<Readonly<{ committed: boolean; bytes: readonly number[] }>> {
  const packages = repository();
  try {
    await packages.recover();
    const identity = identityOf(seed);
    const stream = await packages.openFile(identity, "payload.bin");
    const bytes: number[] = [];
    for await (const chunk of stream) bytes.push(...chunk);
    const registration = await packages.findExact(identity);
    return { committed: registration !== undefined, bytes };
  } finally {
    packages.close();
  }
}

export async function deleteAndCheck(seed: string): Promise<boolean> {
  const packages = repository();
  try {
    const identity = identityOf(seed);
    await packages.delete(identity);
    return (await packages.findExact(identity)) !== undefined;
  } finally {
    packages.close();
  }
}
