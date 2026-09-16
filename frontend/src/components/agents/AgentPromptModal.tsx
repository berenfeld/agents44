import { useCallback, useEffect, useState } from "react";
import { api, userFacingApiError } from "@/api/client";
import { FileEditorPane } from "@/components/files/FileEditorPane";
import { ConfirmModal, Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/primitives";
import type { AgentPromptState } from "@/lib/agent-prompt";
import {
  agentInputPath,
  isPdfFile,
  promptFileLabel,
  readTextDirection,
  writeTextDirection,
  type PathResponse,
  type TextDirection,
} from "@/lib/workspace-files";

export type AgentPromptNotice = { title: string; message: string };

export function AgentPromptModal({
  state,
  onStateChange,
  onNotice,
}: {
  state: AgentPromptState | null;
  onStateChange: (state: AgentPromptState | null) => void;
  onNotice: (notice: AgentPromptNotice) => void;
}) {
  const [content, setContent] = useState("");
  const [sizeBytes, setSizeBytes] = useState<number | null>(null);
  const [modifiedAt, setModifiedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [viewMode, setViewMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [textDirection, setTextDirection] = useState<TextDirection>(readTextDirection);
  const [discardOpen, setDiscardOpen] = useState(false);

  const selectedPath = state?.selectedPath ?? "";
  const pickerOpen = !!state && !state.selectedPath;
  const editorOpen = !!state?.selectedPath;

  const setFileTextDirection = useCallback((direction: TextDirection) => {
    setTextDirection(direction);
    writeTextDirection(direction);
  }, []);

  const resetEditor = useCallback(() => {
    setContent("");
    setSizeBytes(null);
    setModifiedAt(null);
    setDirty(false);
    setSaveStatus("idle");
    setViewMode(false);
    setLoading(false);
    setDiscardOpen(false);
  }, []);

  const close = useCallback(() => {
    resetEditor();
    onStateChange(null);
  }, [onStateChange, resetEditor]);

  useEffect(() => {
    if (!selectedPath) {
      resetEditor();
      return;
    }

    let cancelled = false;
    setLoading(true);
    setDirty(false);
    setSaveStatus("idle");
    setViewMode(isPdfFile(selectedPath));

    api
      .get<PathResponse>("/files", { params: { path: selectedPath } })
      .then((res) => {
        if (cancelled) return;
        setContent(res.data.content || "");
        setSizeBytes(res.data.size_bytes ?? null);
        setModifiedAt(res.data.modified_at ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        onNotice({ title: "Could not open prompt", message: userFacingApiError(err) });
        close();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPath, close, onNotice, resetEditor]);

  const saveFile = useCallback(async () => {
    if (!selectedPath || !dirty || saveStatus === "saving") return;
    setSaveStatus("saving");
    try {
      await api.put("/files", { path: selectedPath, content });
      setDirty(false);
      const res = await api.get<PathResponse>("/files", { params: { path: selectedPath } });
      setSizeBytes(res.data.size_bytes ?? null);
      setModifiedAt(res.data.modified_at ?? null);
      setSaveStatus("saved");
    } catch (err) {
      setSaveStatus("idle");
      onNotice({ title: "Could not save prompt", message: userFacingApiError(err) });
    }
  }, [selectedPath, dirty, saveStatus, content, onNotice]);

  const requestCloseEditor = (nextOpen: boolean) => {
    if (nextOpen) return;
    if (saveStatus === "saving") return;
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    close();
  };

  const inputPath = state ? agentInputPath(state.agent.department, state.agent.name) : "";

  return (
    <>
      <Modal
        open={pickerOpen}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title="Select prompt file"
      >
        {state ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {state.agent.name} has several files in <code>input/</code>. Choose which one to edit.
            </p>
            <ul className="divide-y rounded-md border">
              {state.files.map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onClick={() => onStateChange({ ...state, selectedPath: file.path })}
                  >
                    <span className="min-w-0 truncate font-medium">{promptFileLabel(inputPath, file.path)}</span>
                    <span className="shrink-0 text-sky-700">Edit</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={editorOpen}
        onOpenChange={requestCloseEditor}
        title={state ? `${state.agent.name} prompt` : "Prompt"}
        size="large"
      >
        {loading ? (
          <p className="flex h-[70vh] items-center text-sm text-slate-500">Loading...</p>
        ) : selectedPath ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <FileEditorPane
              path={selectedPath}
              content={content}
              sizeBytes={sizeBytes}
              modifiedAt={modifiedAt}
              dirty={dirty}
              saveStatus={saveStatus}
              viewMode={viewMode}
              textDirection={textDirection}
              onContentChange={(value) => {
                setContent(value);
                setDirty(true);
                setSaveStatus("idle");
              }}
              onViewModeChange={setViewMode}
              onTextDirectionChange={setFileTextDirection}
              onSave={() => {
                void saveFile();
              }}
              fillHeight
              className="h-[70vh]"
            />
          </div>
        ) : null}
      </Modal>

      <ConfirmModal
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard unsaved changes?"
        confirmLabel="Discard"
        destructive
        description={<p>The prompt file has unsaved edits. Close without saving?</p>}
        onConfirm={() => {
          setDiscardOpen(false);
          close();
        }}
      />
    </>
  );
}
