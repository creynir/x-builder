import { useEffect, useState } from "react";
import {
  AppShell,
  createBrowserShellHistory,
  createBrowserShellPreferencesStore,
} from "../shell/app-shell";

export function App() {
  const [history] = useState(createBrowserShellHistory);
  const [preferencesStore] = useState(createBrowserShellPreferencesStore);

  useEffect(() => {
    return () => {
      history.dispose?.();
    };
  }, [history]);

  return <AppShell history={history} preferencesStore={preferencesStore} />;
}
