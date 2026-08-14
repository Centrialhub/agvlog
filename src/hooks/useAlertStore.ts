import { create } from 'zustand';

interface AlertState {
  isOpen: boolean;
  title: string;
  description: string;
  type: 'error' | 'warning' | 'info' | 'success';
  showAlert: (title: string, description?: string, type?: 'error' | 'warning' | 'info' | 'success') => void;
  hideAlert: () => void;
}

export const useAlertStore = create<AlertState>((set) => ({
  isOpen: false,
  title: '',
  description: '',
  type: 'error',
  showAlert: (title, description = '', type = 'error') => 
    set({ isOpen: true, title, description, type }),
  hideAlert: () => set({ isOpen: false }),
}));

/**
 * Hook centralizador para erros críticos que precisam de confirmação.
 */
export const useErrorPopup = () => {
  const showAlert = useAlertStore((state) => state.showAlert);
  
  return {
    showError: (title: string, description?: string) => showAlert(title, description, 'error'),
    showWarning: (title: string, description?: string) => showAlert(title, description, 'warning'),
  };
};
