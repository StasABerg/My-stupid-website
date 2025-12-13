import { useEffect, useState } from "react";
import { toast as toastManager } from "@/lib/toast-manager";

type Toast = {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  timestamp: number;
};

const ToastItem = ({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) => {
  const bgColor = {
    success: 'bg-terminal-green',
    error: 'bg-terminal-red',
    info: 'bg-terminal-cyan',
  }[toast.type];

  return (
    <div
      className={`${bgColor} text-black px-4 py-3 rounded mb-2 flex items-center justify-between animate-in slide-in-from-right duration-200`}
      role="alert"
    >
      <span className="text-sm font-mono">{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        className="ml-4 text-black hover:text-gray-700 font-bold"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
};

export const Toaster = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    return toastManager.subscribe(setToasts);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed top-4 right-4 z-50 flex flex-col items-end max-w-sm"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map(toast => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={toastManager.dismiss.bind(toastManager)}
        />
      ))}
    </div>
  );
};
