import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  EditorStore,
  TESSERA_APP_VERSION,
  type GridType,
  type ProjectState,
} from "@tessera/core";
import { LazyEditorView } from "./components/LazyEditorView.js";
import { NewProjectDialog } from "./components/NewProjectDialog.js";
import { FragmentMergeDialog } from "./components/FragmentMergeDialog.js";
import { SameProjectConflictDialog } from "./components/SameProjectConflictDialog.js";
import type {
  FragmentModuleResolver,
  FragmentTranslation,
  ProjectV1Document,
} from "@tessera/formats";
import type {
  LocalPackageRegistration,
  LocalPackageRepository,
} from "@tessera/storage";
import type { ParsedExtensionPackage } from "@tessera/module-runtime";
import { PackageSettingsDialog } from "./components/PackageSettingsDialog.js";
import type {
  PreparedFragmentMerge,
  commitFragmentMerge,
  fragmentFileErrorTranslationKey,
  prepareFragmentMerge,
  readFragmentFile,
} from "./fragment-file-workflow.js";
import type {
  importProjectFile,
  projectFileErrorTranslationKey,
  ProjectSaveTarget,
  SameProjectIdDecision,
  SameProjectIdContext,
} from "./project-file-workflow.js";
import type { InstalledPackageCatalog } from "./local-package-workflow.js";
import type { InstalledPresetAvailability } from "./package-project-runtime.js";
import type {
  ExtractorRelease,
  ExtractorReleaseCatalog,
} from "./extractor-release-catalog.js";
import { countProjectModuleObjectReferences } from "./project-module-references.js";
import { ProjectSaveCoordinator } from "./project-save-coordinator.js";

interface AppRepository extends ProjectSaveTarget {
  loadLatest(): Promise<ProjectState | null>;
  setModuleResolutionProvider?(
    provider: () => {
      readonly moduleResolver?: FragmentModuleResolver;
      readonly currentAppVersion?: string;
      readonly moduleResolutionMode?: "strict" | "tolerant";
    },
  ): void;
}

interface OwnedAppRepository extends AppRepository {
  close(): void;
}

interface FragmentWorkflowModule {
  readonly readFragmentFile: typeof readFragmentFile;
  readonly prepareFragmentMerge: typeof prepareFragmentMerge;
  readonly commitFragmentMerge: typeof commitFragmentMerge;
  readonly fragmentFileErrorTranslationKey: typeof fragmentFileErrorTranslationKey;
}
type FragmentWorkflowLoader = () => Promise<FragmentWorkflowModule>;

const loadFragmentWorkflowDefault: FragmentWorkflowLoader = () =>
  import("./fragment-file-workflow.js");

interface ProjectWorkflowModule {
  readonly importProjectFile: typeof importProjectFile;
  readonly projectFileErrorTranslationKey: typeof projectFileErrorTranslationKey;
}
type ProjectWorkflowLoader = () => Promise<ProjectWorkflowModule>;

const loadProjectWorkflowDefault: ProjectWorkflowLoader = () =>
  import("./project-file-workflow.js");

type ExtractorCatalogLoader = (
  signal: AbortSignal,
  installedModuleVersions: ReadonlySet<string>,
) => Promise<ExtractorRelease | null>;

const loadExtractorCatalogDefault: ExtractorCatalogLoader = async (
  signal,
  installedModuleVersions,
) => {
  const runtime = await import("./extractor-release-catalog.js");
  const catalog: ExtractorReleaseCatalog =
    await runtime.fetchExtractorReleaseCatalog({ signal });
  return (
    runtime.selectCiv6ExtractorRelease(
      catalog,
      TESSERA_APP_VERSION,
      installedModuleVersions,
    ) ?? null
  );
};

interface Props {
  repository?: AppRepository;
  repositoryFactory?: () => OwnedAppRepository;
  decideSameProjectId?: (
    context: SameProjectIdContext,
  ) => SameProjectIdDecision | Promise<SameProjectIdDecision>;
  fragmentWorkflowLoader?: FragmentWorkflowLoader;
  projectWorkflowLoader?: ProjectWorkflowLoader;
  packageRepository?: LocalPackageRepository;
  extractorCatalogLoader?: ExtractorCatalogLoader;
}

interface PackageCatalogState {
  readonly entries: readonly {
    readonly registration: LocalPackageRegistration;
    readonly parsed: ParsedExtensionPackage | null;
    readonly statusKey: string;
    readonly displayName: string;
    readonly sourceDetails: readonly {
      readonly labelKey: string;
      readonly value: string;
    }[];
  }[];
  readonly packages: readonly ParsedExtensionPackage[];
  readonly presetAvailability: ReadonlyMap<
    string,
    Readonly<Record<GridType, InstalledPresetAvailability>>
  >;
}

interface PresetAvailabilityRuntime {
  inspectInstalledPresetAvailability(
    packages: readonly ParsedExtensionPackage[],
    presetIdentity: string,
    currentAppVersion: string,
    grid: GridType,
  ): Promise<InstalledPresetAvailability>;
}

async function withPresetAvailability(
  catalog: InstalledPackageCatalog,
  runtime: PresetAvailabilityRuntime,
): Promise<PackageCatalogState> {
  const entries = await Promise.all(
    catalog.packages
      .filter((item) => item.kind === "preset")
      .map(async (preset) => {
        const identity = packageIdentityKey(preset);
        const [square, hexPointy] = await Promise.all([
          runtime.inspectInstalledPresetAvailability(
            catalog.packages,
            identity,
            TESSERA_APP_VERSION,
            "square",
          ),
          runtime.inspectInstalledPresetAvailability(
            catalog.packages,
            identity,
            TESSERA_APP_VERSION,
            "hex-pointy",
          ),
        ]);
        return [identity, { square, "hex-pointy": hexPointy }] as const;
      }),
  );
  return { ...catalog, presetAvailability: new Map(entries) };
}

function packageIdentityKey(item: ParsedExtensionPackage): string {
  return `${item.kind}:${item.artifactId}@${item.version}`;
}

interface ProjectModuleReference {
  readonly moduleId: string;
  readonly version: string;
  readonly packageSourceKind: "built-in" | "user-file" | "generated-local";
}

function projectModules(
  state: ProjectState | null,
): readonly ProjectModuleReference[] {
  const document = state?.formatSource.opaqueDocument;
  if (typeof document !== "object" || document === null) return [];
  const modules = (document as { readonly modules?: unknown }).modules;
  if (!Array.isArray(modules)) return [];
  return modules.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const module = item as {
      readonly moduleId?: unknown;
      readonly version?: unknown;
      readonly packageSourceKind?: unknown;
    };
    if (
      typeof module.moduleId !== "string" ||
      typeof module.version !== "string" ||
      (module.packageSourceKind !== "built-in" &&
        module.packageSourceKind !== "user-file" &&
        module.packageSourceKind !== "generated-local")
    )
      return [];
    return [
      {
        moduleId: module.moduleId,
        version: module.version,
        packageSourceKind: module.packageSourceKind,
      },
    ];
  });
}

export function App({
  repository: suppliedRepository,
  repositoryFactory,
  decideSameProjectId,
  fragmentWorkflowLoader = loadFragmentWorkflowDefault,
  projectWorkflowLoader = loadProjectWorkflowDefault,
  packageRepository,
  extractorCatalogLoader = loadExtractorCatalogDefault,
}: Props = {}) {
  const { t } = useTranslation();
  const repositoryHolder = useMemo(() => {
    if (suppliedRepository !== undefined) {
      return { repository: suppliedRepository, owned: null };
    }
    if (repositoryFactory === undefined) {
      throw new Error("缺少生产环境工程仓库工厂");
    }
    const owned = repositoryFactory();
    return { repository: owned, owned };
  }, [repositoryFactory, suppliedRepository]);
  const repository = repositoryHolder.repository;
  const saveTarget = useMemo(
    () => new ProjectSaveCoordinator(repository),
    [repository],
  );
  const [store, setStore] = useState<EditorStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [startupErrorKey, setStartupErrorKey] = useState<string | null>(null);
  const [fileErrorKey, setFileErrorKey] = useState<string | null>(null);
  const mounted = useRef(true);
  const fileOperation = useRef(0);
  const importQueue = useRef<Promise<void>>(Promise.resolve());
  const ownedCloseTokens = useRef(new Map<OwnedAppRepository, symbol>());
  const [sameIdConflict, setSameIdConflict] = useState<{
    context: SameProjectIdContext;
    confirmingReplace: boolean;
  } | null>(null);
  const sameIdResolver = useRef<
    ((decision: SameProjectIdDecision) => void) | null
  >(null);
  const conflictPreviousFocus = useRef<HTMLElement | null>(null);
  const [fragmentMerge, setFragmentMerge] =
    useState<PreparedFragmentMerge | null>(null);
  const fragmentMergeRef = useRef<PreparedFragmentMerge | null>(null);
  const [fragmentBusy, setFragmentBusy] = useState(false);
  const [fragmentErrorKey, setFragmentErrorKey] = useState<string | null>(null);
  const fragmentPreviousFocus = useRef<HTMLElement | null>(null);
  const moduleResolverRef = useRef<FragmentModuleResolver | undefined>(
    undefined,
  );
  const [packageCatalog, setPackageCatalog] = useState<PackageCatalogState>({
    entries: [],
    packages: [],
    presetAvailability: new Map(),
  });
  const [packageSettingsOpen, setPackageSettingsOpen] = useState(false);
  const [packageReferenceDocument, setPackageReferenceDocument] =
    useState<ProjectV1Document | null>(null);
  const [packageBusy, setPackageBusy] = useState(false);
  const [packageErrorKey, setPackageErrorKey] = useState<string | null>(null);
  const [extractorCatalog, setExtractorCatalog] = useState<{
    readonly status: "loading" | "ready" | "error";
    readonly release: ExtractorRelease | null;
  }>({ status: "loading", release: null });
  const extractorCatalogOperation = useRef(0);
  const createInFlight = useRef(false);
  const [createBusy, setCreateBusy] = useState(false);

  const refreshPackages = useCallback(
    async (rehydrateCurrent: boolean) => {
      if (packageRepository === undefined) return;
      const [workflow, media, runtime] = await Promise.all([
        import("./local-package-workflow.js"),
        import("./package-media-decoder.js"),
        import("./package-project-runtime.js"),
      ]);
      const catalog = await workflow.loadInstalledPackageCatalog(
        packageRepository,
        new media.BrowserResourceDecodeGateway(),
      );
      const catalogState = await withPresetAvailability(catalog, runtime);
      const resolver = runtime.createInstalledModuleResolver(catalog.packages);
      moduleResolverRef.current = resolver;
      if (!mounted.current) return;
      setPackageCatalog(catalogState);
      if (rehydrateCurrent && store !== null) {
        const formats = await import("@tessera/formats");
        const restored = formats.restoreProjectV1(
          formats.stringifyProjectV1(store.state, { mode: "preserve" }),
          {
            moduleResolver: resolver,
            currentAppVersion: TESSERA_APP_VERSION,
            moduleResolutionMode: "tolerant",
          },
        );
        if (mounted.current) setStore(new EditorStore(restored));
      }
    },
    [packageRepository, store],
  );

  const settleSameIdConflict = useCallback(
    (decision: SameProjectIdDecision) => {
      const resolve = sameIdResolver.current;
      sameIdResolver.current = null;
      setSameIdConflict(null);
      resolve?.(decision);
      queueMicrotask(() => conflictPreviousFocus.current?.focus());
    },
    [],
  );

  const requestSameIdDecision = useCallback(
    (context: SameProjectIdContext) =>
      new Promise<SameProjectIdDecision>((resolve) => {
        sameIdResolver.current?.("cancel");
        conflictPreviousFocus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        sameIdResolver.current = resolve;
        setSameIdConflict({ context, confirmingReplace: false });
      }),
    [],
  );

  useEffect(() => {
    const owned = repositoryHolder.owned;
    if (owned === null) return;
    const closeTokens = ownedCloseTokens.current;
    const token = Symbol("owned-repository-lifetime");
    closeTokens.set(owned, token);
    return () => {
      // React StrictMode 会立即 setup→cleanup→setup；延后一拍即可区分真实卸载。
      queueMicrotask(() => {
        if (closeTokens.get(owned) !== token) return;
        closeTokens.delete(owned);
        owned.close();
      });
    };
  }, [repositoryHolder]);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    repository.setModuleResolutionProvider?.(() => ({
      ...(moduleResolverRef.current === undefined
        ? {}
        : { moduleResolver: moduleResolverRef.current }),
      currentAppVersion: TESSERA_APP_VERSION,
      moduleResolutionMode: "tolerant",
    }));
    void (async () => {
      if (packageRepository !== undefined) {
        try {
          const [workflow, media, runtime] = await Promise.all([
            import("./local-package-workflow.js"),
            import("./package-media-decoder.js"),
            import("./package-project-runtime.js"),
          ]);
          const catalog = await workflow.loadInstalledPackageCatalog(
            packageRepository,
            new media.BrowserResourceDecodeGateway(),
          );
          const catalogState = await withPresetAvailability(catalog, runtime);
          moduleResolverRef.current = runtime.createInstalledModuleResolver(
            catalog.packages,
          );
          if (active) setPackageCatalog(catalogState);
        } catch {
          if (active) setPackageErrorKey("package.error.recovery");
        }
      }
      return repository.loadLatest();
    })()
      .then((project) => {
        if (!active) return;
        if (project !== null) setStore(new EditorStore(project));
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setStartupErrorKey("error.projectRecoveryFailed");
        setLoading(false);
      });
    return () => {
      active = false;
      mounted.current = false;
      fileOperation.current += 1;
      sameIdResolver.current?.("cancel");
      sameIdResolver.current = null;
    };
  }, [packageRepository, repository]);

  useEffect(() => {
    if (!packageSettingsOpen) return;
    const operation = extractorCatalogOperation.current + 1;
    extractorCatalogOperation.current = operation;
    const controller = new AbortController();
    const installedVersions = new Set(
      packageCatalog.entries
        .filter(
          (entry) =>
            entry.registration.identity.kind === "module" &&
            entry.registration.identity.artifactId === "tessera.civ6",
        )
        .map((entry) => entry.registration.identity.version),
    );
    setExtractorCatalog({ status: "loading", release: null });
    void extractorCatalogLoader(controller.signal, installedVersions).then(
      (release) => {
        if (
          !mounted.current ||
          controller.signal.aborted ||
          extractorCatalogOperation.current !== operation
        )
          return;
        setExtractorCatalog({ status: "ready", release });
      },
      () => {
        if (
          !mounted.current ||
          controller.signal.aborted ||
          extractorCatalogOperation.current !== operation
        )
          return;
        setExtractorCatalog({ status: "error", release: null });
      },
    );
    return () => controller.abort();
  }, [extractorCatalogLoader, packageCatalog.entries, packageSettingsOpen]);

  useEffect(() => {
    if (!packageSettingsOpen || store === null) {
      setPackageReferenceDocument(null);
      return;
    }
    setPackageReferenceDocument(null);
    let current = true;
    void import("@tessera/formats").then(({ toProjectV1 }) => {
      if (current && mounted.current) {
        setPackageReferenceDocument(
          toProjectV1(store.state, { mode: "preserve" }),
        );
      }
    });
    return () => {
      current = false;
    };
  }, [packageSettingsOpen, store]);

  const create = async (
    project: ProjectState,
    packageSelection?: {
      readonly presetIdentity?: string;
      readonly moduleIdentities: readonly string[];
    },
  ) => {
    if (createInFlight.current) return;
    const previousState = store?.state ?? null;
    createInFlight.current = true;
    setCreateBusy(true);
    let configured = project;
    try {
      if (
        packageSelection !== undefined &&
        (packageSelection.presetIdentity !== undefined ||
          packageSelection.moduleIdentities.length > 0)
      ) {
        const runtime = await import("./package-project-runtime.js");
        const registry =
          packageSelection.presetIdentity === undefined
            ? await runtime.buildRegistryForInstalledModules(
                packageCatalog.packages,
                packageSelection.moduleIdentities,
                TESSERA_APP_VERSION,
                project.grid.type,
              )
            : await runtime.buildRegistryForInstalledPreset(
                packageCatalog.packages,
                packageSelection.presetIdentity,
                TESSERA_APP_VERSION,
                project.grid.type,
                packageSelection.moduleIdentities,
              );
        const presetId = packageSelection.presetIdentity
          ?.replace(/^preset:/, "")
          .replace(/@[^@]+$/, "");
        configured =
          presetId === undefined
            ? runtime.createProjectFromModules(
                project,
                registry,
                TESSERA_APP_VERSION,
              )
            : runtime.createProjectFromPreset(
                project,
                registry,
                presetId,
                TESSERA_APP_VERSION,
              );
      }
    } catch {
      if (mounted.current) setFileErrorKey("package.error.presetCreate");
      createInFlight.current = false;
      if (mounted.current) setCreateBusy(false);
      return;
    }
    const next = new EditorStore(configured);
    setStore(next);
    setNewProjectOpen(false);
    setStartupErrorKey(null);
    setFileErrorKey(null);
    const createSaveTarget =
      previousState === null
        ? saveTarget
        : saveTarget.replacementTarget(previousState, {
            candidateIncludesPrevious: false,
          });
    void createSaveTarget
      .save(next.state)
      .catch(() => {
        if (!mounted.current) return;
        setFileErrorKey("error.projectFileSaveFailed");
      })
      .finally(() => {
        createInFlight.current = false;
        if (mounted.current) setCreateBusy(false);
      });
  };

  const importPackage = async (file: File) => {
    if (packageRepository === undefined || packageBusy) return;
    setPackageBusy(true);
    setPackageErrorKey(null);
    try {
      const [workflow, media] = await Promise.all([
        import("./local-package-workflow.js"),
        import("./package-media-decoder.js"),
      ]);
      await workflow.installPackageFile(packageRepository, file, {
        decoder: new media.BrowserResourceDecodeGateway(),
      });
      await refreshPackages(true);
    } catch (error) {
      if (!mounted.current) return;
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : "";
      setPackageErrorKey(
        code === "package-version-reuse"
          ? "package.error.versionReuse"
          : "package.error.import",
      );
    } finally {
      if (mounted.current) setPackageBusy(false);
    }
  };

  const deletePackage = async (registration: LocalPackageRegistration) => {
    if (packageRepository === undefined || packageBusy) return;
    setPackageBusy(true);
    setPackageErrorKey(null);
    try {
      await packageRepository.delete(registration.identity);
      await refreshPackages(true);
    } catch {
      if (mounted.current) setPackageErrorKey("package.error.delete");
    } finally {
      if (mounted.current) setPackageBusy(false);
    }
  };

  const changeProjectModule = async (
    registration: LocalPackageRegistration,
    enabled: boolean,
  ) => {
    if (
      store === null ||
      packageBusy ||
      registration.identity.kind !== "module"
    )
      return;
    setPackageBusy(true);
    setPackageErrorKey(null);
    try {
      const workflow = await import("./project-module-settings-workflow.js");
      const nextStore = await workflow.commitProjectModuleChange(
        store.state,
        packageCatalog.packages,
        {
          moduleId: registration.identity.artifactId,
          version: registration.identity.version,
          enabled,
        },
        TESSERA_APP_VERSION,
        saveTarget.replacementTarget(store.state, {
          candidateIncludesPrevious: true,
        }),
      );
      if (mounted.current) setStore(nextStore);
    } catch {
      if (mounted.current) {
        setPackageErrorKey(
          enabled
            ? "package.error.moduleEnable"
            : "package.error.moduleDisable",
        );
      }
    } finally {
      if (mounted.current) setPackageBusy(false);
    }
  };

  const openFile = async (file: File) => {
    const operation = fileOperation.current + 1;
    fileOperation.current = operation;
    fragmentMergeRef.current = null;
    setFragmentMerge(null);
    setFileErrorKey(null);
    let workflowPromise: Promise<ProjectWorkflowModule> | null = null;
    const loadWorkflow = () => (workflowPromise ??= projectWorkflowLoader());
    const execute = async () => {
      if (!mounted.current || fileOperation.current !== operation) {
        return { status: "cancelled" as const };
      }
      const workflow = await loadWorkflow();
      return workflow.importProjectFile(
        {
          file,
          currentProjectId: store?.state.projectId ?? null,
          repository:
            store === null
              ? saveTarget
              : saveTarget.replacementTarget(store.state, {
                  candidateIncludesPrevious: false,
                }),
          decideSameProjectId: decideSameProjectId ?? requestSameIdDecision,
          ...(moduleResolverRef.current === undefined
            ? {}
            : { moduleResolver: moduleResolverRef.current }),
        },
        {
          beforeSave: () =>
            mounted.current && fileOperation.current === operation,
        },
      );
    };
    const queued = importQueue.current.then(execute, execute);
    importQueue.current = queued.then(
      () => undefined,
      () => undefined,
    );
    try {
      const result = await queued;
      if (!mounted.current || fileOperation.current !== operation) return;
      if (result.status === "cancelled") return;
      setStore(result.store);
      setNewProjectOpen(false);
      setStartupErrorKey(null);
    } catch (error) {
      if (!mounted.current || fileOperation.current !== operation) return;
      try {
        const workflow = await loadWorkflow();
        setFileErrorKey(workflow.projectFileErrorTranslationKey(error));
      } catch {
        setFileErrorKey("error.invalidProject");
      }
    }
  };

  const openFragmentFile = async (file: File) => {
    fragmentPreviousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const operation = fileOperation.current + 1;
    fileOperation.current = operation;
    fragmentMergeRef.current = null;
    setFragmentMerge(null);
    setFileErrorKey(null);
    setFragmentErrorKey(null);
    let workflowPromise: Promise<FragmentWorkflowModule> | null = null;
    const loadWorkflow = () => (workflowPromise ??= fragmentWorkflowLoader());
    const execute = async () => {
      const workflow = await loadWorkflow();
      const fragment = await workflow.readFragmentFile(file);
      if (
        !mounted.current ||
        fileOperation.current !== operation ||
        store === null
      )
        return null;
      return workflow.prepareFragmentMerge(
        store.state,
        fragment,
        undefined,
        moduleResolverRef.current,
      );
    };
    const queued = importQueue.current.then(execute, execute);
    importQueue.current = queued.then(
      () => undefined,
      () => undefined,
    );
    try {
      const prepared = await queued;
      if (
        !mounted.current ||
        fileOperation.current !== operation ||
        prepared === null
      )
        return;
      fragmentMergeRef.current = prepared;
      setFragmentMerge(prepared);
    } catch (error) {
      if (!mounted.current || fileOperation.current !== operation) return;
      try {
        const workflow = await loadWorkflow();
        setFileErrorKey(workflow.fragmentFileErrorTranslationKey(error));
      } catch {
        setFileErrorKey("error.fragmentInvalid");
      }
    }
  };

  const translateFragment = (translation: FragmentTranslation) => {
    if (fragmentMerge === null || store === null) return;
    const requestedPrepared = fragmentMerge;
    const requestedStore = store;
    const operation = fileOperation.current;
    void fragmentWorkflowLoader()
      .then((workflow) => {
        if (
          !mounted.current ||
          fileOperation.current !== operation ||
          fragmentMergeRef.current !== requestedPrepared
        )
          return;
        let next: PreparedFragmentMerge;
        try {
          next = workflow.prepareFragmentMerge(
            requestedStore.state,
            requestedPrepared.fragment,
            translation,
            moduleResolverRef.current,
          );
        } catch (error) {
          if (
            mounted.current &&
            fileOperation.current === operation &&
            fragmentMergeRef.current === requestedPrepared
          ) {
            setFragmentErrorKey(
              workflow.fragmentFileErrorTranslationKey(error),
            );
          }
          return;
        }
        if (
          !mounted.current ||
          fileOperation.current !== operation ||
          fragmentMergeRef.current !== requestedPrepared
        )
          return;
        fragmentMergeRef.current = next;
        setFragmentMerge(next);
        setFragmentErrorKey(null);
      })
      .catch(() => {
        if (
          mounted.current &&
          fileOperation.current === operation &&
          fragmentMergeRef.current === requestedPrepared
        ) {
          setFragmentErrorKey("error.fragmentMergeFailed");
        }
      });
  };

  const confirmFragmentMerge = async () => {
    if (fragmentMerge === null || store === null) return;
    const operation = fileOperation.current;
    setFragmentBusy(true);
    setFragmentErrorKey(null);
    try {
      const workflow = await fragmentWorkflowLoader();
      const nextStore = await workflow.commitFragmentMerge(
        fragmentMerge,
        saveTarget.replacementTarget(store.state, {
          candidateIncludesPrevious: true,
        }),
        moduleResolverRef.current,
      );
      if (!mounted.current || fileOperation.current !== operation) return;
      setStore(nextStore);
      fragmentMergeRef.current = null;
      setFragmentMerge(null);
      queueMicrotask(() => fragmentPreviousFocus.current?.focus());
    } catch (error) {
      if (!mounted.current || fileOperation.current !== operation) return;
      try {
        const workflow = await fragmentWorkflowLoader();
        setFragmentErrorKey(workflow.fragmentFileErrorTranslationKey(error));
      } catch {
        setFragmentErrorKey("error.fragmentMergeFailed");
      }
    } finally {
      if (mounted.current && fileOperation.current === operation)
        setFragmentBusy(false);
    }
  };

  const currentModules = projectModules(store?.state ?? null);
  const currentDependencies = new Set(
    currentModules.map(
      (module) => `module:${module.moduleId}@${module.version}`,
    ),
  );
  const registeredIdentities = new Set(
    packageCatalog.entries.map(
      (entry) =>
        `${entry.registration.identity.kind}:${entry.registration.identity.artifactId}@${entry.registration.identity.version}`,
    ),
  );
  const missingEntries: (PackageCatalogState["entries"][number] & {
    readonly canDeleteLocalPackage: boolean;
    readonly missingPlaceholder: boolean;
  })[] = currentModules
    .filter(
      (module) =>
        module.moduleId !== "tessera.basic" &&
        !registeredIdentities.has(
          `module:${module.moduleId}@${module.version}`,
        ),
    )
    .map((module) => ({
      registration: {
        identity: {
          kind: "module",
          artifactId: module.moduleId,
          version: module.version,
        },
        sourceKind:
          module.packageSourceKind === "user-file"
            ? "user-file"
            : "generated-local",
        package: null,
        status: "corrupted",
        reasonCode: null,
      },
      parsed: null,
      statusKey: "package.status.missing",
      displayName: module.moduleId,
      sourceDetails: [],
      canDeleteLocalPackage: false,
      missingPlaceholder: true,
    }));
  const packageDialogEntries = [
    ...packageCatalog.entries.map((entry) => ({
      ...entry,
      canDeleteLocalPackage: true,
      missingPlaceholder: false,
    })),
    ...missingEntries,
  ];
  const packageDialogItems = packageDialogEntries.map((entry) => {
    const gridSupported =
      store === null ||
      entry.parsed === null ||
      (entry.parsed.kind === "module"
        ? entry.parsed.manifest.supportedGrids
        : entry.parsed.manifest.grid.supportedGrids
      ).includes(store.state.grid.type);
    const projectEnabled = currentDependencies.has(
      `module:${entry.registration.identity.artifactId}@${entry.registration.identity.version}`,
    );
    return {
      ...entry,
      statusKey: gridSupported
        ? entry.statusKey
        : "package.status.incompatible",
      projectEnabled,
      canDeleteLocalPackage: entry.canDeleteLocalPackage,
      canToggleProjectModule:
        entry.registration.identity.kind === "module" &&
        (projectEnabled
          ? packageReferenceDocument !== null
          : entry.parsed?.kind === "module" &&
            gridSupported &&
            entry.statusKey === "package.status.ready"),
      referenceCount:
        packageReferenceDocument === null ||
        entry.registration.identity.kind !== "module"
          ? 0
          : countProjectModuleObjectReferences(
              packageReferenceDocument,
              entry.registration.identity.artifactId,
              entry.registration.identity.version,
            ),
      reasonKey: entry.missingPlaceholder
        ? "package.reason.missing"
        : entry.registration.reasonCode === "local-package-not-ready"
          ? "package.reason.notReady"
          : entry.registration.reasonCode === "local-package-storage-corrupted"
            ? "package.reason.storageCorrupted"
            : null,
    };
  });
  const civ6Items = packageDialogItems.filter(
    (item) =>
      item.canDeleteLocalPackage &&
      item.registration.identity.kind === "module" &&
      item.registration.identity.artifactId === "tessera.civ6",
  );
  const readyCiv6Items = civ6Items.filter(
    (item) => item.statusKey === "package.status.ready",
  );
  const civ6Versions = (readyCiv6Items.length > 0 ? readyCiv6Items : civ6Items)
    .map((item) => item.registration.identity.version)
    .sort();
  const civ6StatusKey =
    civ6Items.length === 0
      ? "package.civ6.status.notInstalled"
      : readyCiv6Items.length > 0
        ? "package.civ6.status.installed"
        : civ6Items.some(
              (item) =>
                item.statusKey === "package.status.corrupted" ||
                item.statusKey === "package.status.pending",
            )
          ? "package.civ6.status.corrupted"
          : "package.civ6.status.incompatible";
  const installedPresets = packageCatalog.packages
    .filter((item) => item.kind === "preset")
    .map((item) => {
      const entry = packageCatalog.entries.find(
        (candidate) => candidate.parsed === item,
      );
      return {
        identity: packageIdentityKey(item),
        label: entry?.displayName ?? item.artifactId,
        availabilityByGrid:
          packageCatalog.presetAvailability.get(packageIdentityKey(item)) ??
          ({
            square: "required-unavailable",
            "hex-pointy": "required-unavailable",
          } as const),
        supportedGrids: item.manifest.grid.supportedGrids,
      };
    });
  const installedModules = packageCatalog.packages
    .filter(
      (item) => item.kind === "module" && item.artifactId !== "tessera.basic",
    )
    .map((item) => {
      const entry = packageCatalog.entries.find(
        (candidate) => candidate.parsed === item,
      );
      return {
        identity: packageIdentityKey(item),
        label: entry?.displayName ?? item.artifactId,
        statusKey: entry?.statusKey ?? "package.status.ready",
        supportedGrids:
          item.kind === "module" ? item.manifest.supportedGrids : [],
      };
    });

  const workflowDialogs = (
    <>
      {sameIdConflict !== null && (
        <SameProjectConflictDialog
          context={sameIdConflict.context}
          confirmingReplace={sameIdConflict.confirmingReplace}
          onBeginReplace={() =>
            setSameIdConflict((current) =>
              current === null
                ? null
                : { ...current, confirmingReplace: !current.confirmingReplace },
            )
          }
          onDecision={settleSameIdConflict}
        />
      )}
      {fragmentMerge !== null && (
        <FragmentMergeDialog
          prepared={fragmentMerge}
          busy={fragmentBusy}
          errorKey={fragmentErrorKey}
          onTranslate={translateFragment}
          onConfirm={() => void confirmFragmentMerge()}
          onCancel={() => {
            fileOperation.current += 1;
            fragmentMergeRef.current = null;
            setFragmentMerge(null);
            setFragmentErrorKey(null);
            queueMicrotask(() => fragmentPreviousFocus.current?.focus());
          }}
        />
      )}
      {packageSettingsOpen && packageRepository !== undefined && (
        <PackageSettingsDialog
          registrations={packageDialogItems}
          busy={packageBusy}
          errorKey={packageErrorKey}
          civ6={{
            statusKey: civ6StatusKey,
            installedVersions: civ6Versions,
            catalogStatus: extractorCatalog.status,
            release: extractorCatalog.release,
          }}
          onImport={(file) => void importPackage(file)}
          onEnableModule={(registration) =>
            void changeProjectModule(registration, true)
          }
          onDisableModule={(registration) =>
            void changeProjectModule(registration, false)
          }
          onDelete={(registration) => void deletePackage(registration)}
          onClose={() => {
            extractorCatalogOperation.current += 1;
            setPackageSettingsOpen(false);
          }}
        />
      )}
    </>
  );

  if (loading) return <div role="status">{t("app.loading")}</div>;
  if (store === null || newProjectOpen)
    return (
      <>
        <NewProjectDialog
          onCreate={create}
          onOpenFile={openFile}
          externalErrorKey={fileErrorKey ?? startupErrorKey}
          onDismissExternalError={() => {
            setFileErrorKey(null);
            setStartupErrorKey(null);
          }}
          onCancel={store === null ? undefined : () => setNewProjectOpen(false)}
          installedPresets={installedPresets}
          installedModules={installedModules}
          busy={createBusy}
          onOpenPackageSettings={
            packageRepository === undefined
              ? undefined
              : () => setPackageSettingsOpen(true)
          }
        />
        {workflowDialogs}
      </>
    );
  return (
    <>
      <LazyEditorView
        store={store}
        repository={saveTarget}
        onNew={() => setNewProjectOpen(true)}
        onOpenFile={openFile}
        onOpenFragmentFile={openFragmentFile}
        onOpenPackageSettings={() => setPackageSettingsOpen(true)}
        externalErrorKey={fileErrorKey}
        onDismissExternalError={() => setFileErrorKey(null)}
      />
      {workflowDialogs}
    </>
  );
}
