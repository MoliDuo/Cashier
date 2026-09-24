import { create } from "zustand";

/**
 * The stack only ever holds source documents: an entry has no sheet of its
 * own, and the row that opens one lands on the record it belongs to.
 */
export type ModalItem = {
  type: "source-document";
  id: string;
  ledgerId: string;
  returnFocus?: HTMLElement | null;
};

interface ModalStackState {
  stack: ModalItem[];
  push: (item: ModalItem) => void;
  pop: () => void;
  closeAll: () => void;
  syncToDetail: (item: ModalItem | null) => void;
}

export const useModalStackStore = create<ModalStackState>((set) => ({
  stack: [],

  push: (item) =>
    set((state) => {
      const existingIndex = state.stack.findIndex(
        (existing) =>
          existing.type === item.type &&
          existing.id === item.id &&
          existing.ledgerId === item.ledgerId
      );
      const stack =
        existingIndex === -1 ? [...state.stack, item] : state.stack.slice(0, existingIndex + 1);
      return { stack };
    }),

  pop: () =>
    set((state) => {
      const stack = state.stack.slice(0, -1);
      return { stack };
    }),

  closeAll: () => set({ stack: [] }),

  syncToDetail: (item) =>
    set((state) => {
      if (item == null) return { stack: [] };
      const existingIndex = state.stack.findIndex(
        (existing) =>
          existing.type === item.type &&
          existing.id === item.id &&
          existing.ledgerId === item.ledgerId
      );
      const stack = existingIndex === -1 ? [item] : state.stack.slice(0, existingIndex + 1);
      return { stack };
    }),
}));
