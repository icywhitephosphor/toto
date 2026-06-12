"use client";
import { useBootstrap } from "@/lib/client/bootstrap";
import { LoginScreen } from "@/components/LoginScreen";
import { ClaimScreen } from "@/components/ClaimScreen";
import { MatchCalendar } from "@/components/MatchCalendar";
import { BrowserLink } from "@/components/BrowserLink";

export default function Home() {
  const { data, isLoading } = useBootstrap();

  if (isLoading && !data) {
    return (
      <div className="stack gap-12" style={{ paddingTop: 18 }}>
        <div className="skel" style={{ height: 220 }} />
        <div className="skel" style={{ height: 120 }} />
      </div>
    );
  }
  if (!data?.user) return <LoginScreen />;
  if (!data.participant) return <ClaimScreen />;
  return <Hub />;
}

// Home is deliberately just the greeting + the game-day calendar: bonuses,
// the leaderboard and the bracket live behind their own tabs in the tab bar.
function Hub() {
  const { data } = useBootstrap();
  const me = data?.participant;
  const firstName = me?.display_name?.split(" ")[1] ?? data?.user?.first_name ?? "друг";

  return (
    <div className="rise" style={{ paddingTop: 6 }}>
      <div className="eyebrow">С возвращением</div>
      <h1 className="h-display" style={{ fontSize: 32, marginTop: 4 }}>
        Привет, {firstName}!
      </h1>

      <div className="mt-16">
        <MatchCalendar />
      </div>

      <BrowserLink />
    </div>
  );
}
