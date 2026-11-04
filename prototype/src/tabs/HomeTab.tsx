import { useNow } from "../useNow";

export function HomeTab() {
  const now = useNow();
  return (
    <div className="home">
      <div className="home-time">
        {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </div>
      <div className="home-date">
        {now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
      </div>
      <p className="muted">Tools arrive in later phases. See PLAN.md.</p>
    </div>
  );
}
