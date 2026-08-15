import { create } from 'zustand';
export const useAlertStore = create((set) => ({
    isOpen: false,
    title: '',
    description: '',
    type: 'error',
    showAlert: (title, description = '', type = 'error', options = {}) => set({
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
    hideAlert: () => set({
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
        showError: (title, description) => showAlert(title, description, 'error'),
        showWarning: (title, description) => showAlert(title, description, 'warning'),
        showConfirmation: (title, description, onConfirm, options = {}) => showAlert(title, description, options.type || 'warning', {
            onConfirm,
            confirmLabel: options.confirmLabel,
            cancelLabel: options.cancelLabel,
            onCancel: options.onCancel,
        }),
    };
};
