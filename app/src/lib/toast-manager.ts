type ToastType = 'success' | 'error' | 'info';
type ToastId = string;

export interface Toast {
  id: ToastId;
  message: string;
  type: ToastType;
  timestamp: number;
}

const MAX_TOASTS = 5;

class ToastManager {
  private toasts: Toast[] = [];
  private listeners: Set<(toasts: Toast[]) => void> = new Set();
  private nextId = 0;
  private timeouts: Map<ToastId, NodeJS.Timeout> = new Map();

  subscribe(listener: (toasts: Toast[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach(listener => listener([...this.toasts]));
  }

  show(message: string, type: ToastType = 'info', duration = 4000): ToastId {
    const id = `toast-${this.nextId++}`;
    const toast: Toast = { id, message, type, timestamp: Date.now() };

    this.toasts.push(toast);

    // Enforce max toast limit
    if (this.toasts.length > MAX_TOASTS) {
      const removed = this.toasts.shift();
      if (removed) {
        // Clear timeout for removed toast
        const timeout = this.timeouts.get(removed.id);
        if (timeout) {
          clearTimeout(timeout);
          this.timeouts.delete(removed.id);
        }
      }
    }

    this.notify();

    if (duration > 0) {
      const timeout = setTimeout(() => {
        this.timeouts.delete(id);
        this.dismiss(id);
      }, duration);
      this.timeouts.set(id, timeout);
    }

    return id;
  }

  dismiss(id: ToastId) {
    // Clear timeout if exists
    const timeout = this.timeouts.get(id);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(id);
    }

    this.toasts = this.toasts.filter(t => t.id !== id);
    this.notify();
  }

  success(message: string) {
    return this.show(message, 'success');
  }

  error(message: string) {
    return this.show(message, 'error');
  }

  info(message: string) {
    return this.show(message, 'info');
  }
}

export const toast = new ToastManager();
