import { create } from 'zustand';

interface AlertState {
  isOpen: boolean;
  title: string;
  description: string;
  type: 'error' | 'warning' | 'info' | 'success';
  onConfirm?: () => void;
  onSecondaryConfirm?: () => void;
  onCancel?: () => void;
  confirmLabel?: string;
  secondaryLabel?: string;
  cancelLabel?: string;
  showAlert: (
    title: string,
    description?: string,
    type?: 'error' | 'warning' | 'info' | 'success',
    options?: {
      onConfirm?: () => void;
      onSecondaryConfirm?: () => void;
      onCancel?: () => void;
      confirmLabel?: string;
      secondaryLabel?: string;
      cancelLabel?: string;
    }
  ) => void;
  hideAlert: () => void;
}

export const useAlertStore = create<AlertState>((set) => ({
  isOpen: false,
  title: '',
  description: '',
  type: 'error',
  showAlert: (title, description = '', type = 'error', options = {}) =>
    set({
      isOpen: true,
      title,
      description,
      type,
      onConfirm: options.onConfirm,
      onSecondaryConfirm: options.onSecondaryConfirm,
      onCancel: options.onCancel,
      confirmLabel: options.confirmLabel,
      secondaryLabel: options.secondaryLabel,
      cancelLabel: options.cancelLabel,
    }),
  hideAlert: () =>
    set({
      isOpen: false,
      onConfirm: undefined,
      onSecondaryConfirm: undefined,
      onCancel: undefined,
      confirmLabel: undefined,
      secondaryLabel: undefined,
      cancelLabel: undefined,
    }),
}));

/**
 * Hook centralizador para erros críticos que precisam de confirmação.
 */
export const useErrorPopup = () => {
  const showAlert = useAlertStore((state) => state.showAlert);

  return {
    showError: (title: string, description?: string) => showAlert(title, description, 'error'),
    showWarning: (title: string, description?: string) => showAlert(title, description, 'warning'),
    showConfirmation: (
      title: string,
      description: string,
      onConfirm: () => void,
      options: {
        confirmLabel?: string;
        cancelLabel?: string;
        onCancel?: () => void;
        type?: 'error' | 'warning' | 'info' | 'success';
      } = {}
    ) =>
      showAlert(title, description, options.type || 'warning', {
        onConfirm,
        confirmLabel: options.confirmLabel,
        cancelLabel: options.cancelLabel,
        onCancel: options.onCancel,
      }),
  };
};
