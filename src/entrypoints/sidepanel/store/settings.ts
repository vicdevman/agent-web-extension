import { create } from "zustand";
import { send } from "@/core/messaging";
import type { Settings } from "@/core/schema/settings";
import type { Reply } from "@/core/schema/message";

interface SettingsState {
  settings: Settings | null;
  loading: boolean;
  load: () => Promise<void>;
  save: (patch: Partial<Settings>) => Promise<Reply<Settings>>;
}

export const useSettings = create<SettingsState>((set) => ({
  settings: null,
  loading: true,
  load: async () => {
    const res = await send<Settings>("SETTINGS_GET");
    set({ settings: res.ok ? res.data : null, loading: false });
  },
  save: async (patch) => {
    const res = await send<Settings>("SETTINGS_UPDATE", patch);
    if (res.ok && res.data) set({ settings: res.data });
    return res;
  },
}));
