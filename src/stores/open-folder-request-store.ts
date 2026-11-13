import { create } from "zustand";

interface OpenFolderRequestStore {
  requested: boolean;
  /** Ask Home to offer its folder chooser when it is next shown. */
  request: () => void;
  /** Whether a request was waiting; it is used up by the call. */
  take: () => boolean;
}

/**
 * How a page that needs a folder chosen hands the human over to Home, which
 * owns the chooser.
 */
export const useOpenFolderRequestStore = create<OpenFolderRequestStore>()(
  (set, get) => ({
    requested: false,
    request: () => set({ requested: true }),
    take: () => {
      const { requested } = get();
      if (requested) set({ requested: false });
      return requested;
    },
  }),
);
