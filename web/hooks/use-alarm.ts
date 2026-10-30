"use client";

import { useEffect, useRef } from "react";
import { ping, startAlarm, stopAlarm } from "@/lib/sound";
import { selectOverlayEvent, useAgentStore } from "@/lib/store";

/**
 * Drives lib/sound from store state:
 * - looping alarm while a critical unacknowledged event is on screen
 *   (respects settings.notifications.sound + the mute toggle)
 * - a gentle ping when a new warning-level event arrives
 */
export function useAlarm(): void {
  const overlayEvent = useAgentStore(selectOverlayEvent);
  const alarmMuted = useAgentStore((s) => s.alarmMuted);
  const soundEnabled = useAgentStore((s) => s.settings?.notifications.sound ?? true);
  const latestEvent = useAgentStore((s) => s.events[0] ?? null);
  const lastPingedId = useRef<string | null>(null);

  // Critical alarm loop.
  useEffect(() => {
    if (overlayEvent && soundEnabled && !alarmMuted) {
      startAlarm();
    } else {
      stopAlarm();
    }
  }, [overlayEvent, soundEnabled, alarmMuted]);

  useEffect(() => {
    return () => stopAlarm();
  }, []);

  // Gentle ping on new warning events.
  useEffect(() => {
    if (!latestEvent) return;
    if (lastPingedId.current === null) {
      // First render after load: don't beep for history.
      lastPingedId.current = latestEvent.id;
      return;
    }
    if (latestEvent.id !== lastPingedId.current) {
      lastPingedId.current = latestEvent.id;
      if (latestEvent.severity === "warning" && soundEnabled && !alarmMuted) {
        ping();
      }
    }
  }, [latestEvent, soundEnabled, alarmMuted]);
}
