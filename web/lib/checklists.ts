import type { EventType, RecommendedAction, ShieldEvent } from "@/lib/types";

/**
 * Recommended-action catalog — EXACT copy of CONTRACT §4 id -> {label, why}.
 * Used as the fallback when an event arrives without actions (demo mode).
 */
export const ACTION_MAP: Record<string, { label: string; why: string }> = {
  disconnect_network: {
    label: "Disconnect from Wi-Fi / Ethernet now",
    why: "Cutting the connection can stop the attack from receiving commands or sending your data away.",
  },
  do_not_restart: {
    label: "Do not restart or shut down",
    why: "Some ransomware finishes encrypting during shutdown. Keeping the machine on helps recovery tools.",
  },
  do_not_pay_ransom: {
    label: "Do not pay the ransom",
    why: "Paying funds crime and often gets nothing back. Talk to professionals instead.",
  },
  unplug_backup_drives: {
    label: "Unplug external / backup drives",
    why: "Ransomware copies itself to connected drives. Unplug backup disks so your clean copies survive.",
  },
  unplug_usb: {
    label: "Unplug USB drives",
    why: "Stop anything from copying more files to or from the USB drive.",
  },
  change_passwords_clean_device: {
    label: "Change passwords from a DIFFERENT device",
    why: "If files were stolen, assume passwords in them are compromised. Use a clean device, and turn on 2FA.",
  },
  run_full_antivirus: {
    label: "Run a full antivirus scan",
    why: "ShieldGuard is an early-warning system. A full antivirus scan can find and remove the culprit.",
  },
  restore_clean_backup: {
    label: "Restore from a clean backup",
    why: "Your latest verified snapshot is the safest way to get unencrypted files back.",
  },
  update_os: {
    label: "Update Windows / macOS / Linux and your apps",
    why: "Updates close the security holes attackers use.",
  },
  contact_professional: {
    label: "Contact IT support or a professional",
    why: "A professional can identify the ransomware family and check for a free decryption tool.",
  },
  open_panic: {
    label: "Open the Panic Button",
    why: "One click: pause the suspicious program, snapshot your files, and (optionally) cut the network.",
  },
  review_process: {
    label: "Review the suspicious program",
    why: "Look at what the program is, where it came from, then choose Trust or Stop it.",
  },
  enable_2fa: {
    label: "Turn on two-factor authentication",
    why: "Even if a password leaks, 2FA blocks most account takeovers.",
  },
};

/** Per-event-type default action ids (CONTRACT §4). */
export const DEFAULT_ACTIONS: Partial<Record<EventType, string[]>> = {
  canary_triggered: ["disconnect_network", "do_not_restart", "open_panic"],
  mass_file_change: ["disconnect_network", "do_not_restart", "do_not_pay_ransom", "unplug_backup_drives", "open_panic"],
  mass_extension_change: [
    "disconnect_network",
    "do_not_restart",
    "do_not_pay_ransom",
    "unplug_backup_drives",
    "change_passwords_clean_device",
    "open_panic",
  ],
  ransom_note: ["disconnect_network", "do_not_restart", "do_not_pay_ransom", "contact_professional", "open_panic"],
  entropy_jump: ["disconnect_network", "do_not_restart", "open_panic"],
  suspicious_extension: ["disconnect_network", "review_process"],
  signature_mismatch: ["review_process", "restore_clean_backup"],
  exfil_read_then_send: ["disconnect_network", "change_passwords_clean_device", "review_process", "open_panic"],
  exfil_upload_spike: ["disconnect_network", "review_process"],
  exfil_many_connections: ["review_process"],
  exfil_archive: ["review_process", "disconnect_network"],
  usb_bulk_copy: ["unplug_usb", "review_process"],
  persistence_new: ["review_process"],
  remote_access_tool: ["disconnect_network", "review_process"],
  suspicious_port: ["review_process"],
  process_suspicious: ["review_process"],
  backup_completed: [],
  system: [],
};

/** Resolve the checklist for an event: prefer the event's own actions, fall back to the catalog. */
export function actionsForEvent(event: ShieldEvent): RecommendedAction[] {
  if (event.recommended_actions && event.recommended_actions.length > 0) {
    // Some emitters (demo engine, older agents) send bare ids — enrich them
    // from the catalog so the UI never shows raw identifiers.
    return event.recommended_actions.map((a) => {
      const known = ACTION_MAP[a.id];
      return {
        id: a.id,
        label: a.label || known?.label || a.id,
        why: a.why || known?.why || "Recommended by ShieldGuard for this kind of alert.",
      };
    });
  }
  const ids = DEFAULT_ACTIONS[event.type] ?? [];
  return ids
    .map((id) => {
      const a = ACTION_MAP[id];
      return a ? { id, label: a.label, why: a.why } : null;
    })
    .filter((a): a is RecommendedAction => a !== null);
}
