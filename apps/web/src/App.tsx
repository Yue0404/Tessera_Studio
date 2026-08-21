import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EditorStore, type ProjectState } from "@tessera/core";
import { parseProjectV1 } from "@tessera/formats";
import { ProjectRepository } from "@tessera/storage";
import { EditorView } from "./components/EditorView.js";
import { NewProjectDialog } from "./components/NewProjectDialog.js";

export function App() {
  const { t } = useTranslation();
  const repository = useMemo(() => new ProjectRepository(), []);
  const [store, setStore] = useState<EditorStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void repository
      .loadLatest()
      .then((project) => {
        if (!active) return;
        if (project !== null) setStore(new EditorStore(project));
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => {
      active = false;
    };
  }, [repository]);

  const create = (project: ProjectState) => {
    const next = new EditorStore(project);
    setStore(next);
    setNewProjectOpen(false);
    void repository.save(next.state);
  };

  const openFile = async (file: File) => {
    const next = new EditorStore(parseProjectV1(await file.text()));
    await repository.save(next.state);
    setStore(next);
    setNewProjectOpen(false);
  };

  if (loading) return <div role="status">{t("app.loading")}</div>;
  if (store === null || newProjectOpen)
    return (
      <NewProjectDialog
        onCreate={create}
        onOpenFile={openFile}
        onCancel={store === null ? undefined : () => setNewProjectOpen(false)}
      />
    );
  return (
    <EditorView
      store={store}
      repository={repository}
      onNew={() => setNewProjectOpen(true)}
      onLoaded={(next) => setStore(next)}
    />
  );
}
