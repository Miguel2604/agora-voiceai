import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  SectionHeading,
  StatCard,
  Panel,
  MetricPanel,
  EmptyState,
  getErrorMessage,
  humanizeStatus,
} from "../components/ui";
import { ActiveCalls } from "../components/ActiveCalls";
import { TicketQueue } from "../components/TicketQueue";
import { TicketDetail } from "../components/TicketDetail";
import { AgentLane } from "../components/AgentLane";

type PendingAction = "ending" | "updating" | null;

export function LeadDashboard() {
  const [selectedTicketId, setSelectedTicketId] =
    useState<Id<"tickets"> | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const endCallMutation = useMutation(api.calls.endCall);
  const updateStatus = useMutation(api.tickets.updateStatus);

  const leadDashboard = useQuery(api.tickets.leadDashboard, {});
  const supportAgents = useQuery(api.supportAgents.listAgents, {});
  const activeCalls = useQuery(api.calls.listCalls, {
    status: "active",
    limit: 10,
  });
  const selectedTicket = useQuery(
    api.tickets.getTicketDetail,
    selectedTicketId ? { ticketId: selectedTicketId } : "skip",
  );

  useEffect(() => {
    const firstTicket = leadDashboard?.tickets[0]?._id ?? null;
    if (!selectedTicketId && firstTicket) {
      setSelectedTicketId(firstTicket);
      return;
    }

    if (
      selectedTicketId &&
      leadDashboard &&
      !leadDashboard.tickets.some((ticket) => ticket._id === selectedTicketId)
    ) {
      setSelectedTicketId(firstTicket);
    }
  }, [leadDashboard, selectedTicketId]);

  async function handleEndDemoCall(callId: Id<"calls">) {
    setPendingAction("ending");
    setFeedback(null);
    setErrorMessage(null);

    try {
      const result = await endCallMutation({ callId });
      setSelectedTicketId(result.ticketId);
      setFeedback(
        result.assignedAgentName
          ? `Ticket routed to ${result.assignedAgentName}.`
          : "Ticket created without an assigned agent.",
      );
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleStatusChange(
    ticketId: Id<"tickets">,
    status: "open" | "in_progress" | "resolved",
  ) {
    setPendingAction("updating");
    setFeedback(null);
    setErrorMessage(null);

    try {
      await updateStatus({ ticketId, status });
      setFeedback(`Ticket marked as ${humanizeStatus(status)}.`);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section className="grid gap-6">
      <header className="overflow-hidden rounded-md border-2 border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
        <div className="grid gap-6 px-6 py-8 lg:grid-cols-[1.5fr_1fr] lg:px-8">
          <div className="space-y-4">
            <span className="inline-flex items-center rounded-sm border-2 border-black bg-[#f5ce4d] px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-black">
              Neosolve AI support
            </span>
            <div className="space-y-3">
              <h1 className="max-w-3xl text-4xl font-black tracking-tight text-black sm:text-5xl">
                Voice AI support intake powered by Agora and Gemini.
              </h1>
              <p className="max-w-3xl text-base font-bold leading-7 text-slate-800 sm:text-lg">
                Customers talk to Nova (AI voice agent) via Agora Conversational
                AI. Gemini classifies the transcript and routes tickets to the
                right specialist in real time.
              </p>
            </div>
          </div>

          <div className="grid gap-3 rounded-md border-2 border-black bg-slate-900 p-5 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <MetricPanel
              label="Active calls"
              value={String(leadDashboard?.metrics.activeCalls ?? 0)}
              tone="cyan"
            />
            <MetricPanel
              label="Open tickets"
              value={String(leadDashboard?.metrics.openTickets ?? 0)}
              tone="amber"
            />
            <MetricPanel
              label="Unassigned"
              value={String(leadDashboard?.metrics.unassignedTickets ?? 0)}
              tone="rose"
            />
          </div>
        </div>
      </header>

      <div className="rounded-md border-2 border-black bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] lg:p-7">
        <SectionHeading
          eyebrow="Live operations"
          title="Team lead dashboard"
          description="Watch calls turn into tickets and confirm routing sends them to the intended specialist."
        />

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Active calls"
            value={leadDashboard?.metrics.activeCalls ?? 0}
          />
          <StatCard
            label="Open"
            value={leadDashboard?.metrics.openTickets ?? 0}
          />
          <StatCard
            label="In progress"
            value={leadDashboard?.metrics.inProgressTickets ?? 0}
          />
          <StatCard
            label="Resolved"
            value={leadDashboard?.metrics.resolvedTickets ?? 0}
          />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="grid gap-4">
            <Panel
              title="Active calls"
              subtitle="End a live call to trigger classification and assignment."
            >
              <ActiveCalls
                calls={activeCalls}
                onEndDemoCall={(callId) => void handleEndDemoCall(callId)}
                pendingAction={pendingAction}
              />
            </Panel>
          </div>

          <div className="grid gap-4">
            <Panel
              title="Ticket queue"
              subtitle="Select a ticket to inspect the transcript, routing reason, and status."
            >
              <TicketQueue
                tickets={leadDashboard?.tickets ?? []}
                selectedTicketId={selectedTicketId}
                onSelectTicket={setSelectedTicketId}
              />
            </Panel>
          </div>
        </div>
      </div>

      <div className="rounded-md border-2 border-black bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] lg:p-7">
        <SectionHeading
          eyebrow="Support lanes"
          title="Per-agent dashboards"
          description="These lists mirror the filtered agent views you can access from the navigation bar."
        />

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {supportAgents && supportAgents.length > 0 ? (
            supportAgents.map((agent) => (
              <AgentLane
                key={agent._id}
                agentName={agent.name}
                agentSlug={agent.slug}
                specialties={agent.specialties}
                activeCount={agent.workload.active}
                onSelectTicket={setSelectedTicketId}
                selectedTicketId={selectedTicketId}
              />
            ))
          ) : (
            <EmptyState message="No agents loaded yet. Seed the demo roster first." />
          )}
        </div>
      </div>

      <div className="rounded-md border-2 border-black bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] lg:p-7">
        <SectionHeading
          eyebrow="Ticket detail"
          title="Inspect the exact intake payload stored in Convex"
          description="Use this panel to see the summary, transcript, assignment reason, and status controls."
        />

        <div className="mt-6">
          <TicketDetail
            selectedTicket={selectedTicket}
            onStatusChange={(ticketId, status) =>
              void handleStatusChange(ticketId, status)
            }
            pendingAction={pendingAction}
          />
        </div>
      </div>

      {feedback ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {feedback}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : null}
    </section>
  );
}
