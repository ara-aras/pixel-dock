import { useSyncExternalStore } from "react";

export type Kind = "countdown" | "stopwatch" | "pomodoro";
export type Phase = "work" | "short" | "long";

export interface Clock {
  running: boolean;
  startedAt: number;
  /** Time banked from earlier runs, so pause/resume keeps the total. */
  carried: number;
  /** 0 for the stopwatch. */
  duration: number;
}

export interface TimerState {
  countdown: Clock;
  stopwatch: Clock;
  pomodoro: Clock & { phase: Phase; cycle: number };
}

const MIN = 60_000;
export const POMODORO: Record<Phase, number> = { work: 25 * MIN, short: 5 * MIN, long: 15 * MIN };
export const PHASE_LABEL: Record<Phase, string> = {
  work: "Focus",
  short: "Short break",
  long: "Long break",
};

const idle = (duration: number): Clock => ({ running: false, startedAt: 0, carried: 0, duration });

// Timers live outside React so they keep running while the panel is closed.
// They are not persisted: a restart resets them.
let state: TimerState = {
  countdown: idle(5 * MIN),
  stopwatch: idle(0),
  pomodoro: { ...idle(POMODORO.work), phase: "work", cycle: 0 },
};

const listeners = new Set<() => void>();
let onFinished: (message: string) => void = () => {};
let interval: number | undefined;

export const setFinishedHandler = (cb: (message: string) => void) => {
  onFinished = cb;
};

export const elapsed = (c: Clock, now = Date.now()) =>
  c.carried + (c.running ? now - c.startedAt : 0);

function emit() {
  state = { ...state };
  listeners.forEach((l) => l());
}

function syncTicker() {
  const any = state.countdown.running || state.stopwatch.running || state.pomodoro.running;
  if (any && interval === undefined) interval = window.setInterval(tick, 250);
  else if (!any && interval !== undefined) {
    window.clearInterval(interval);
    interval = undefined;
  }
}

function tick() {
  const now = Date.now();
  const { countdown, pomodoro } = state;

  if (countdown.running && elapsed(countdown, now) >= countdown.duration) {
    state.countdown = { ...countdown, running: false, carried: 0 };
    onFinished("Timer finished");
  }

  if (pomodoro.running && elapsed(pomodoro, now) >= pomodoro.duration) {
    const finishedWork = pomodoro.phase === "work";
    const cycle = finishedWork ? pomodoro.cycle + 1 : pomodoro.cycle;
    const phase: Phase = finishedWork ? (cycle % 4 === 0 ? "long" : "short") : "work";
    state.pomodoro = { ...idle(POMODORO[phase]), phase, cycle };
    onFinished(finishedWork ? "Focus done. Time for a break" : "Break over. Back to focus");
  }

  syncTicker();
  emit();
}

function update<K extends Kind>(kind: K, patch: Partial<TimerState[K]>) {
  state[kind] = { ...state[kind], ...patch };
  syncTicker();
  emit();
}

export const timers = {
  start(kind: Kind) {
    const c = state[kind];
    if (c.running) return;
    const spent = c.duration > 0 && elapsed(c) >= c.duration;
    update(kind, { running: true, startedAt: Date.now(), carried: spent ? 0 : c.carried });
  },
  pause(kind: Kind) {
    const c = state[kind];
    if (!c.running) return;
    update(kind, { running: false, carried: elapsed(c) });
  },
  reset(kind: Kind) {
    if (kind === "pomodoro") {
      state.pomodoro = { ...idle(POMODORO.work), phase: "work", cycle: 0 };
      syncTicker();
      emit();
    } else {
      update(kind, { running: false, carried: 0 });
    }
  },
  setCountdownMinutes(minutes: number) {
    if (state.countdown.running || !(minutes > 0)) return;
    update("countdown", { duration: Math.round(minutes * MIN), carried: 0 });
  },
};

export function useTimers(): TimerState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** What the idle pill should show while something is running, or null. */
export function pillSummary(t: TimerState, now = Date.now()): { label: string; progress: number } | null {
  for (const c of [t.pomodoro, t.countdown]) {
    if (c.running) {
      const spent = elapsed(c, now);
      return { label: formatClock(c.duration - spent), progress: Math.min(1, spent / c.duration) };
    }
  }
  if (t.stopwatch.running) return { label: formatClock(elapsed(t.stopwatch, now)), progress: 0 };
  return null;
}
