import { useRoute } from "./lib/router";
import { NavBar } from "./components/NavBar";
import { LandingPage } from "./views/LandingPage";
import { LeadDashboard } from "./views/LeadDashboard";
import { AgentView } from "./views/AgentView";

export default function App() {
  const route = useRoute();

  return (
    <div className="min-h-screen px-4 py-4 text-slate-950 sm:px-5 lg:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <NavBar />
        {route.view === "landing" && <LandingPage />}
        {route.view === "lead" && <LeadDashboard />}
        {route.view === "agent" && <AgentView slug={route.slug} />}
      </div>
    </div>
  );
}
