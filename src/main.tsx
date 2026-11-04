import React from "react";
import ReactDOM from "react-dom/client";
import { useEffect } from "react";
import App from "./App";
// Aerie theme: default colour variables first (no flash), then PILLAR's styles,
// then Material shape/type overrides. Roboto Flex is bundled locally (CSP: no remote fonts).
import "./aerie/theme/defaults.css";
import "@fontsource-variable/roboto-flex/full.css";
import "./index.css";
import "./aerie/theme/material.css";
import { CrashBoundary } from "./components/CrashBoundary";
import { useCrashRecovery } from "./hooks/useCrashRecovery";
import { PrompterWindow } from "./aerie/prompter/PrompterWindow";

function AppWithRecovery() {
  const { reportCrash } = useCrashRecovery({
    enableAutoRecovery: true,
    crashThreshold: 3,
    timeWindow: 60_000,
  });

  useEffect(() => {
    const onWindowError = (event: ErrorEvent) => {
      reportCrash(event.error ?? event.message, {
        severity: "severe",
        component: "window",
        action: "error",
      });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      reportCrash(event.reason instanceof Error ? event.reason : String(event.reason), {
        severity: "moderate",
        component: "window",
        action: "unhandledrejection",
      });
    };

    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, [reportCrash]);

  return (
    <CrashBoundary
      onError={(error, errorInfo) =>
        reportCrash(error, {
          severity: "critical",
          component: "ReactTree",
          action: errorInfo.componentStack ? "render_with_stack" : "render",
        })
      }
    >
      <App />
    </CrashBoundary>
  );
}

// Aerie: the teleprompter opens this same bundle in its own window at #prompter/<scriptId>.
const prompterMatch = /^#prompter\/([A-Za-z0-9-]+)$/.exec(window.location.hash);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {prompterMatch ? <PrompterWindow scriptId={prompterMatch[1]} /> : <AppWithRecovery />}
  </React.StrictMode>
);
