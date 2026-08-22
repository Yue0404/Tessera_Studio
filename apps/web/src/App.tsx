import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { EditorStore, type ProjectState } from "@tessera/core";
import { LazyEditorView } from "./components/LazyEditorView.js";
import { NewProjectDialog } from "./components/NewProjectDialog.js";
import { FragmentMergeDialog } from "./components/FragmentMergeDialog.js";
import { SameProjectConflictDialog } from "./components/SameProjectConflictDialog.js";
import type { FragmentTranslation } from "@tessera/formats";
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

interface AppRepository extends ProjectSaveTarget {
  loadLatest(): Promise<ProjectState | null>;
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

interface Props {
  repository?: AppRepository;
  repositoryFactory?: () => OwnedAppRepository;
  decideSameProjectId?: (
    context: SameProjectIdContext,
  ) => SameProjectIdDecision | Promise<SameProjectIdDecision>;
  fragmentWorkflowLoader?: FragmentWorkflowLoader;
  projectWorkflowLoader?: ProjectWorkflowLoader;
}

export function App({
  repository: suppliedRepository,
  repositoryFactory,
  decideSameProjectId,
  fragmentWorkflowLoader = loadFragmentWorkflowDefault,
  projectWorkflowLoader = loadProjectWorkflowDefault,
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
    void repository
      .loadLatest()
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
  }, [repository]);

  const create = (project: ProjectState) => {
    const next = new EditorStore(project);
    setStore(next);
    setNewProjectOpen(false);
    setStartupErrorKey(null);
    setFileErrorKey(null);
    void repository.save(next.state).catch(() => {
      if (!mounted.current) return;
      setFileErrorKey("error.projectFileSaveFailed");
    });
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
          repository,
          decideSameProjectId: decideSameProjectId ?? requestSameIdDecision,
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
      return workflow.prepareFragmentMerge(store.state, fragment);
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
    if (fragmentMerge === null) return;
    const operation = fileOperation.current;
    setFragmentBusy(true);
    setFragmentErrorKey(null);
    try {
      const workflow = await fragmentWorkflowLoader();
      const nextStore = await workflow.commitFragmentMerge(
        fragmentMerge,
        repository,
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
        />
        {workflowDialogs}
      </>
    );
  return (
    <>
      <LazyEditorView
        store={store}
        repository={repository}
        onNew={() => setNewProjectOpen(true)}
        onOpenFile={openFile}
        onOpenFragmentFile={openFragmentFile}
        externalErrorKey={fileErrorKey}
        onDismissExternalError={() => setFileErrorKey(null)}
      />
      {workflowDialogs}
    </>
  );
}
