import type { ProjectV1Document } from "@tessera/formats";

/** 统计工程对象实例引用；modules 声明本身不计入对象数量。 */
export function countProjectModuleObjectReferences(
  document: ProjectV1Document,
  moduleId: string,
  version: string,
): number {
  if (
    !document.modules.some(
      (item) => item.moduleId === moduleId && item.version === version,
    )
  )
    return 0;
  const prefix = `${moduleId}:`;
  let count = 0;
  for (const chunk of document.chunks) {
    for (const cell of chunk.cellOverrides) {
      count += cell.layerInstances.filter((item) =>
        item.elementId.startsWith(prefix),
      ).length;
    }
  }
  for (const edge of document.managers.edgeManager.edges) {
    count += edge.layerInstances.filter((item) =>
      item.elementId.startsWith(prefix),
    ).length;
  }
  count += document.managers.overlayManager.overlays.filter((item) =>
    item.elementId.startsWith(prefix),
  ).length;
  count += document.managers.connectionManager.connections.filter((item) =>
    item.elementId.startsWith(prefix),
  ).length;
  count += document.domainGroups.filter((item) =>
    item.elementId.startsWith(prefix),
  ).length;
  return count;
}
