import { create } from 'zustand';

interface AlertInputOptions {
  label: string;
  placeholder?: string;
  initialValue?: string;
  required?: boolean;
  minLength?: number;
}

interface AlertState {
  isOpen: boolean;
  title: string;
  description: string;
  type: 'error' | 'warning' | 'info' | 'success';
  onConfirm?: (inputValue?: string) => void;
  onSecondaryConfirm?: () => void;
  onCancel?: () => void;
  confirmLabel?: string;
  secondaryLabel?: string;
  cancelLabel?: string;
  input?: AlertInputOptions;
  inputValue: string;
  inputError?: string;
  showAlert: (
    title: string,
    description?: string,
    type?: 'error' | 'warning' | 'info' | 'success',
    options?: {
      onConfirm?: (inputValue?: string) => void;
      onSecondaryConfirm?: () => void;
      onCancel?: () => void;
      confirmLabel?: string;
      secondaryLabel?: string;
      cancelLabel?: string;
      input?: AlertInputOptions;
    }
  ) => void;
  setInputValue: (value: string) => void;
  setInputError: (error?: string) => void;
  hideAlert: () => void;
}

export const useAlertStore = create<AlertState>((set) => ({
  isOpen: false,
  title: '',
  description: '',
  type: 'error',
  inputValue: '',
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
      input: options.input,
      inputValue: options.input?.initialValue ?? '',
      inputError: undefined,
    }),
  setInputValue: (inputValue) => set({ inputValue, inputError: undefined }),
  setInputError: (inputError) => set({ inputError }),
  hideAlert: () =>
    set({
      isOpen: false,
      onConfirm: undefined,
      onSecondaryConfirm: undefined,
      onCancel: undefined,
      confirmLabel: undefined,
      secondaryLabel: undefined,
      cancelLabel: undefined,
      input: undefined,
      inputValue: '',
      inputError: undefined,
    }),
}));

interface ConfirmActionOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  type?: AlertState['type'];
}

interface PromptActionOptions extends ConfirmActionOptions {
  label?: string;
  placeholder?: string;
  initialValue?: string;
  required?: boolean;
  minLength?: number;
}

export function confirmAction(
  description: string,
  options: ConfirmActionOptions = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    useAlertStore.getState().showAlert(
      options.title ?? 'Confirmar ação',
      description,
      options.type ?? 'warning',
      {
        confirmLabel: options.confirmLabel ?? 'Confirmar',
        cancelLabel: options.cancelLabel ?? 'Cancelar',
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      },
    );
  });
}

export function promptAction(
  description: string,
  options: PromptActionOptions = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    useAlertStore.getState().showAlert(
      options.title ?? 'Informe a justificativa',
      description,
      options.type ?? 'warning',
      {
        confirmLabel: options.confirmLabel ?? 'Continuar',
        cancelLabel: options.cancelLabel ?? 'Cancelar',
        onConfirm: (value) => resolve(value?.trim() ?? ''),
        onCancel: () => resolve(null),
        input: {
          label: options.label ?? 'Justificativa',
          placeholder: options.placeholder,
          initialValue: options.initialValue,
          required: options.required ?? true,
          minLength: options.minLength,
        },
      },
    );
  });
}

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
