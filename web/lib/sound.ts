/**
 * Tiny WebAudio alarm: looping beeps for critical alerts and a gentle ping
 * for warnings. All client-side; browsers may require a user gesture before
 * audio can start — if the context is suspended we try to resume and give up
 * quietly otherwise.
 */

type AudioContextCtor = typeof AudioContext;

let ctx: AudioContext | null = null;
let alarmTimer: ReturnType<typeof setInterval> | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { webkitAudioContext?: AudioContextCtor };
  const Ctor = window.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => undefined);
  }
  return ctx;
}

function beep(context: AudioContext, freq: number, startMs: number, durationMs: number, gainValue: number): void {
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  const t0 = context.currentTime + startMs / 1000;
  const t1 = t0 + durationMs / 1000;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(gainValue, t0 + 0.015);
  gain.gain.linearRampToValueAtTime(0, t1);
  osc.connect(gain);
  gain.connect(context.destination);
  osc.start(t0);
  osc.stop(t1 + 0.02);
}

/** Start the critical alarm loop: three rising beeps, repeated every ~1.4s. */
export function startAlarm(): void {
  if (alarmTimer) return;
  const playOnce = (): void => {
    const c = getContext();
    if (!c || c.state !== "running") return;
    beep(c, 880, 0, 160, 0.14);
    beep(c, 660, 220, 160, 0.14);
    beep(c, 880, 440, 200, 0.16);
  };
  playOnce();
  alarmTimer = setInterval(playOnce, 1400);
}

export function stopAlarm(): void {
  if (alarmTimer) {
    clearInterval(alarmTimer);
    alarmTimer = null;
  }
}

export function isAlarmActive(): boolean {
  return alarmTimer !== null;
}

/** Gentle single ping for warning-level events. */
export function ping(): void {
  const c = getContext();
  if (!c || c.state !== "running") return;
  beep(c, 640, 0, 140, 0.07);
}

/** One-time unlock after a user gesture so later programmatic beeps are allowed. */
export function primeAudio(): void {
  const c = getContext();
  if (c && c.state === "suspended") {
    void c.resume().catch(() => undefined);
  }
}
