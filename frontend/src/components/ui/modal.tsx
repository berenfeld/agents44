import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { Button } from "./primitives";

export function Modal({
  open,
  onOpenChange,
  title,
  headerExtra,
  children,
  size = "default",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
  size?: "default" | "large";
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 max-h-[92vh] w-full -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl",
            size === "large"
              ? "flex max-w-5xl flex-col overflow-hidden"
              : "max-w-lg overflow-y-auto",
          )}
        >
          <div className="flex shrink-0 items-center gap-3">
            <Dialog.Title className="shrink-0 text-lg font-semibold">{title}</Dialog.Title>
            {headerExtra ? <div className="flex min-w-0 flex-1 items-center gap-2">{headerExtra}</div> : null}
          </div>
          <div className={cn("mt-3", size === "large" && "flex min-h-0 flex-1 flex-col overflow-hidden")}>
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ConfirmModal({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title}>
      <div className="space-y-4 text-sm text-slate-600">{description}</div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant={destructive ? "destructive" : "default"} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
