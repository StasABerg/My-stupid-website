type ToastType = 'success' | 'error' | 'info';
type ToastId = string;

interface Toast {
  id: ToastId;
  message: string;
  type: ToastType;
  timestamp: number;
}

class ToastManager {
  private toasts: Toast[] = [];
  private listeners: Set<(toasts: Toast[]) => void> = new Set();
  private nextId = 0;

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
    this.notify();

    if (duration > 0) {
      setTimeout(() => this.dismiss(id), duration);
    }

    return id;
  }

  dismiss(id: ToastId) {
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
