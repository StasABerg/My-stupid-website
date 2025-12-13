import { useState, type ReactNode } from "preact/compat";
import { cn } from "@/lib/utils";

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
};

export const AlertDialogLite = ({ open, onOpenChange, title, description, children }: DialogProps) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="fixed inset-0" onClick={() => onOpenChange(false)} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative z-10 grid w-full max-w-lg gap-4 border bg-background p-6 shadow-lg sm:rounded-lg",
          "animate-in fade-in-0 zoom-in-95 slide-in-from-top-[48%]",
        )}
      >
        <div className="flex flex-col space-y-2 text-center sm:text-left">
          <div className="text-lg font-semibold">{title}</div>
          {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
        </div>
        {children}
      </div>
    </div>
  );
};
