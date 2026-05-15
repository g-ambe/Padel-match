"use client";

import { create } from "zustand";

type EventState = {
  selectedEventId?: string;
  setSelectedEventId: (id: string) => void;
};

export const useEventStore = create<EventState>((set) => ({
  selectedEventId: undefined,
  setSelectedEventId: (id) => set({ selectedEventId: id })
}));
