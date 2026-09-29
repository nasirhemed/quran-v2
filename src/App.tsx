import { lazy, Suspense, useCallback } from "react";
import { Route, Switch, useLocation } from "wouter";
import AppShell from "@/components/layout/AppShell";
import HomePage from "@/pages/HomePage";
import ReaderPage from "@/pages/ReaderPage";
import BrowsePage from "@/pages/BrowsePage";
import PracticePage from "@/pages/PracticePage";
import BrowseSurahPage from "@/pages/browse/BrowseSurahPage";
import BrowseVersePage from "@/pages/browse/BrowseVersePage";
import BrowsePhrasePage from "@/pages/browse/BrowsePhrasePage";

// Voice settings load on demand, so the reader stays as small as before.
const VoicePage = lazy(() => import("@/pages/VoicePage"));
const TranscribePage = lazy(() => import("@/pages/TranscribePage"));

export default function App() {
  const [, setLocation] = useLocation();

  const handleNavigateToSurah = useCallback(
    (surahIndex: number) => {
      setLocation(`/read?surah=${surahIndex}`);
    },
    [setLocation]
  );

  return (
    <AppShell>
      <Switch>
        <Route path="/">
          <HomePage onNavigateToSurah={handleNavigateToSurah} />
        </Route>
        <Route path="/read">
          <ReaderPage />
        </Route>
        <Route path="/browse">
          <BrowsePage />
        </Route>
        <Route path="/browse/surah/:surah">
          {(p) => <BrowseSurahPage surah={Number(p.surah)} />}
        </Route>
        <Route path="/browse/surah/:surah/:ayah">
          {(p) => <BrowseVersePage surah={Number(p.surah)} ayah={Number(p.ayah)} />}
        </Route>
        <Route path="/browse/phrase/:id">{(p) => <BrowsePhrasePage id={p.id} />}</Route>
        <Route path="/practice">
          <PracticePage />
        </Route>
        <Route path="/transcribe">
          <Suspense fallback={<div className="py-24 text-center text-muted">Loading…</div>}>
            <TranscribePage />
          </Suspense>
        </Route>
        <Route path="/voice">
          <Suspense fallback={<div className="py-24 text-center text-muted">Loading…</div>}>
            <VoicePage />
          </Suspense>
        </Route>
        <Route>
          <div className="py-24 text-center text-muted">Page not found.</div>
        </Route>
      </Switch>
    </AppShell>
  );
}
