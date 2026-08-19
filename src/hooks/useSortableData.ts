import { useState, useMemo } from 'react';

export type SortDirection = 'asc' | 'desc' | null;

export interface SortConfig {
  key: string;
  direction: SortDirection;
}

/**
 * Hook para ordenação genérica de listas de objetos.
 * @param items Lista original de itens
 * @param initialConfig Configuração inicial de ordenação
 * @returns { sortedItems, requestSort, sortConfig }
 */
export function useSortableData<T>(items: T[], initialConfig: SortConfig | null = null) {
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(initialConfig);

  const sortedItems = useMemo(() => {
    const sortableItems = [...items];
    if (sortConfig !== null && sortConfig.direction !== null) {
      sortableItems.sort((a, b) => {
        // Acesso a propriedades aninhadas via string "a.b.c"
        const getValue = (obj: any, path: string) => {
          return path.split('.').reduce((acc, part) => acc && acc[part], obj);
        };

        const aValue = getValue(a, sortConfig.key);
        const bValue = getValue(b, sortConfig.key);

        // Tratamento de nulos/undefined (sempre no final)
        if (aValue === null || aValue === undefined) return 1;
        if (bValue === null || bValue === undefined) return -1;

        if (aValue < bValue) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [items, sortConfig]);

  const requestSort = (key: string) => {
    let direction: SortDirection = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    } else if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = null; // Volta ao estado original
    }
    setSortConfig({ key, direction });
  };

  return { sortedItems, requestSort, sortConfig };
}
