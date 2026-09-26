import { create } from "zustand";

interface UnsavedChangesState {
  dirtyKeys: Set<string>;
  setDirty: (key: string, dirty: boolean) => void;
}

/** Which 设置 sections hold unsaved edits, so the shell can ask before leaving the tab. */
export const useUnsavedChangesStore = create<UnsavedChangesState>((set) => ({
  dirtyKeys: new Set(),
  setDirty: (key, dirty) =>
    set((state) => {
      const dirtyKeys = new Set(state.dirtyKeys);
      if (dirty) dirtyKeys.add(key);
      else dirtyKeys.delete(key);
      return { dirtyKeys };
    }),
}));
