import { useState } from "react";
import {
  type Clock,
  elapsed,
  formatClock,
  type Kind,
  PHASE_LABEL,
  timers,
  useTimers,
} from "../timerStore";

function Controls({ kind, clock }: { kind: Kind; clock: Clock }) {
  return (
    <div className="timer-controls">
      {clock.running ? (
        <button className="btn" onClick={() => timers.pause(kind)}>
          Pause
        </button>
      ) : (
        <button className="btn primary" onClick={() => timers.start(kind)}>
          {clock.carried > 0 ? "Resume" : "Start"}
        </button>
      )}
      <button className="btn" onClick={() => timers.reset(kind)}>
        Reset
      </button>
    </div>
  );
}

const PRESETS = [1, 5, 10, 15, 25];

export function TimerTab() {
  const t = useTimers();
  const [custom, setCustom] = useState("");
  const now = Date.now();
  const cdLeft = t.countdown.duration - elapsed(t.countdown, now);
  const pomoLeft = t.pomodoro.duration - elapsed(t.pomodoro, now);

  return (
    <div className="timers">
      <section className="timer-card">
        <h3>Countdown</h3>
        <div className="timer-time">{formatClock(cdLeft)}</div>
        <div className="seg">
          {PRESETS.map((m) => (
            <button
              key={m}
              className={t.countdown.duration === m * 60_000 ? "on" : ""}
              disabled={t.countdown.running}
              onClick={() => timers.setCountdownMinutes(m)}
            >
              {m}m
            </button>
          ))}
        </div>
        <input
          className="field mini"
          inputMode="decimal"
          value={custom}
          placeholder="min"
          disabled={t.countdown.running}
          onChange={(e) => {
            setCustom(e.target.value);
            timers.setCountdownMinutes(Number(e.target.value));
          }}
        />
        <Controls kind="countdown" clock={t.countdown} />
      </section>

      <section className="timer-card">
        <h3>Stopwatch</h3>
        <div className="timer-time">{formatClock(elapsed(t.stopwatch, now))}</div>
        <Controls kind="stopwatch" clock={t.stopwatch} />
      </section>

      <section className="timer-card">
        <h3>
          Pomodoro <span className="muted">· {PHASE_LABEL[t.pomodoro.phase]}</span>
        </h3>
        <div className="timer-time">{formatClock(pomoLeft)}</div>
        <div className="muted">Cycles done: {t.pomodoro.cycle}</div>
        <Controls kind="pomodoro" clock={t.pomodoro} />
      </section>
    </div>
  );
}
