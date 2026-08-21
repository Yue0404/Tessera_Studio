import { BrowserOpfsGateway } from "@tessera/storage";

/** 仅由 Playwright 通过 Vite 单独加载，不进入应用入口或生产 bundle。 */
export async function stageAndCommit(commitId: string): Promise<number> {
  const gateway = new BrowserOpfsGateway();
  await gateway.createCommitExclusive(commitId);
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3, 4]));
      controller.close();
    },
  });
  const bytes = await gateway.writeFile(commitId, "file-000000", source, 4);
  await gateway.markCommitted(commitId);
  return bytes;
}

export async function reopenAndRead(
  commitId: string,
): Promise<Readonly<{ committed: boolean; bytes: readonly number[] }>> {
  const gateway = new BrowserOpfsGateway();
  const stream = await gateway.openFile(commitId, "file-000000");
  const bytes: number[] = [];
  for await (const chunk of stream) bytes.push(...chunk);
  return { committed: await gateway.isCommitted(commitId), bytes };
}

export async function deleteAndList(
  commitId: string,
): Promise<readonly string[]> {
  const gateway = new BrowserOpfsGateway();
  await gateway.deleteCommit(commitId);
  return gateway.listCommitIds();
}
