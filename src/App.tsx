import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  DEMO_SCENARIOS,
  getScenarioById,
  type DemoScenario,
} from "./demoScenarios";

type PendingAction =
  | "seeding"
  | "resetting"
  | "starting"
  | "ending"
  | "updating"
  | null;

export default function App() {
  const [customerName, setCustomerName] = useState("Alyssa");
  const [selectedScenarioId, setSelectedScenarioId] = useState(
    DEMO_SCENARIOS[0].id,
  );
  const [selectedTicketId, setSelectedTicketId] =
    useState<Id<"tickets"> | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const ensureDemoReady = useMutation(api.demo.ensureDemoReady);
  const resetDemo = useMutation(api.demo.resetDemo);
  const startCall = useMutation(api.calls.startCall);
  const endCall = useMutation(api.calls.endCall);
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

  const selectedScenario = useMemo(
    () => getScenarioById(selectedScenarioId),
    [selectedScenarioId],
  );

  useEffect(() => {
    void ensureDemoReady({}).catch((error: unknown) => {
      setErrorMessage(getErrorMessage(error));
    });
  }, [ensureDemoReady]);

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

  async function handleResetDemo() {
    setPendingAction("resetting");
    setFeedback(null);
    setErrorMessage(null);

    try {
      const result = await resetDemo({});
      setSelectedTicketId(null);
      setFeedback(`Reset complete. ${result.agentCount} demo agents ready.`);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleEnsureDemoReady() {
    setPendingAction("seeding");
    setFeedback(null);
    setErrorMessage(null);

    try {
      const result = await ensureDemoReady({});
      setFeedback(
        `Demo agents ready. ${result.agentCount} specialists loaded.`,
      );
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleStartCall() {
    const trimmedName = customerName.trim();
    if (!trimmedName) {
      setErrorMessage("Add a customer name before starting a call.");
      return;
    }

    setPendingAction("starting");
    setFeedback(null);
    setErrorMessage(null);

    try {
      await startCall({
        customerName: trimmedName,
        channelName: `${selectedScenario.channelPrefix}-${Date.now()}`,
        notes: selectedScenario.notes,
        transcript: selectedScenario.transcript,
      });
      setFeedback(
        `Call started for ${trimmedName}. End it to create a ticket for ${selectedScenario.expectedAgent}.`,
      );
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleEndCall(callId: Id<"calls">) {
    setPendingAction("ending");
    setFeedback(null);
    setErrorMessage(null);

    try {
      const result = await endCall({ callId });
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
    <div className="min-h-screen px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="overflow-hidden rounded-md border-2 border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
          <div className="grid gap-6 px-6 py-8 lg:grid-cols-[1.5fr_1fr] lg:px-8">
            <div className="space-y-4">
              <span className="inline-flex items-center rounded-sm border-2 border-black bg-[#f5ce4d] px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-black">
                Neosolve demo backend
              </span>
              <div className="space-y-3">
                <h1 className="max-w-3xl text-4xl font-black tracking-tight text-black sm:text-5xl">
                  Build the scripted support flow now, then plug Agora voice and
                  AI in tomorrow.
                </h1>
                <p className="max-w-3xl text-base font-bold leading-7 text-slate-800 sm:text-lg">
                  This control room exercises the Convex backend with
                  deterministic intake scenarios, real-time ticket routing, and
                  per-agent queues.
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

        <div className="grid gap-6 xl:grid-cols-[1.05fr_1.45fr]">
          <section className="space-y-6 rounded-md border-2 border-black bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] lg:p-7">
            <SectionHeading
              eyebrow="Demo controls"
              title="Create scripted calls against the live backend"
              description="Seed the support roster, pick a scenario, and run the exact call-to-ticket path you want to show tomorrow."
            />

            <div className="grid gap-3 sm:grid-cols-3">
              <ActionButton
                busy={pendingAction === "seeding"}
                onClick={() => void handleEnsureDemoReady()}
                tone="secondary"
              >
                Seed agents
              </ActionButton>
              <ActionButton
                busy={pendingAction === "resetting"}
                onClick={() => void handleResetDemo()}
                tone="secondary"
              >
                Reset demo
              </ActionButton>
              <ActionButton
                busy={pendingAction === "starting"}
                onClick={() => void handleStartCall()}
              >
                Start call
              </ActionButton>
            </div>

            <label className="grid gap-2 text-sm font-bold text-slate-900 font-mono uppercase tracking-tight">
              Customer name
              <input
                className="rounded-md border-2 border-black bg-white px-4 py-3 text-base text-slate-900 outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 transition-all"
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                placeholder="Enter customer name"
              />
            </label>

            <div className="grid gap-3">
              {DEMO_SCENARIOS.map((scenario) => {
                const isSelected = scenario.id === selectedScenarioId;
                return (
                  <button
                    key={scenario.id}
                    type="button"
                    onClick={() => setSelectedScenarioId(scenario.id)}
                    className={[
                      "grid gap-3 rounded-md border-2 px-4 py-4 text-left transition-all sm:px-5 group",
                      isSelected
                        ? "border-black bg-[#f5ce4d] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] translate-x-[-2px] translate-y-[-2px]" /* Popped out state for selected */
                        : "border-black bg-white hover:bg-slate-50 shadow-none hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[-2px] hover:translate-y-[-2px]",
                    ].join(" ")}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold text-slate-950">
                          {scenario.title}
                        </p>
                        <p className="text-sm text-slate-600">
                          {scenario.preview}
                        </p>
                      </div>
                      <span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white">
                        {humanizeToken(scenario.expectedCategory)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-600">
                      <Tag>{scenario.expectedAgent}</Tag>
                      <Tag>{humanizePriority(scenario.expectedPriority)}</Tag>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="rounded-md border-2 border-black bg-white p-5 text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase font-bold uppercase tracking-widest text-[#2a6de1] font-mono">
                    Selected script
                  </p>
                  <h2 className="mt-2 text-2xl font-black">
                    {selectedScenario.title}
                  </h2>
                </div>
                <div className="rounded-sm border-2 border-black bg-[#2a6de1] px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white">
                  Routes to {selectedScenario.expectedAgent}
                </div>
              </div>
              <p className="mt-4 text-sm font-medium leading-7 text-slate-700">
                {selectedScenario.notes}
              </p>
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

          <section className="grid gap-6">
            <div className="rounded-md border-2 border-black bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] lg:p-7">
              <SectionHeading
                eyebrow="Live operations"
                title="Team lead dashboard"
                description="Watch calls turn into tickets and confirm the deterministic router sends them to the intended specialist."
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
                    {activeCalls && activeCalls.length > 0 ? (
                      activeCalls.map((call) => (
                        <article
                          key={call._id}
                          className="grid gap-3 rounded-[24px] border border-slate-200 bg-slate-50/80 p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-base font-semibold text-slate-950">
                                {call.customerName}
                              </p>
                              <p className="text-sm text-slate-600">
                                Started {formatTimestamp(call.startedAt)}
                              </p>
                            </div>
                            <Tag>{call.status}</Tag>
                          </div>
                          <p className="text-sm leading-6 text-slate-600">
                            {call.notes ?? "No call notes captured yet."}
                          </p>
                          <ActionButton
                            busy={pendingAction === "ending"}
                            onClick={() => void handleEndCall(call._id)}
                          >
                            End call and create ticket
                          </ActionButton>
                        </article>
                      ))
                    ) : (
                      <EmptyState message="No active calls yet. Start one from the scripted scenarios." />
                    )}
                  </Panel>
                </div>

                <div className="grid gap-4">
                  <Panel
                    title="Ticket queue"
                    subtitle="Select a ticket to inspect the transcript, routing reason, and status."
                  >
                    {leadDashboard && leadDashboard.tickets.length > 0 ? (
                      leadDashboard.tickets.map((ticket) => {
                        const isSelected = ticket._id === selectedTicketId;
                        return (
                          <button
                            key={ticket._id}
                            type="button"
                            onClick={() => setSelectedTicketId(ticket._id)}
                            className={[
                              "grid gap-3 rounded-md border-2 px-4 py-4 text-left transition-all",
                              isSelected
                                ? "border-black bg-[#f5ce4d] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] translate-x-[-2px] translate-y-[-2px]" /* Popped out state for selected */
                                : "border-black bg-white hover:bg-slate-50 shadow-none hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[-2px] hover:translate-y-[-2px]",
                            ].join(" ")}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="space-y-2">
                                <p className="text-base font-semibold text-slate-950">
                                  {ticket.customerName}
                                </p>
                                <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
                                  <Tag>{humanizeToken(ticket.category)}</Tag>
                                  <Tag>{humanizePriority(ticket.priority)}</Tag>
                                </div>
                              </div>
                              <span className="text-sm text-slate-500">
                                {formatTimestamp(ticket.createdAt)}
                              </span>
                            </div>
                            <p className="text-sm leading-6 text-slate-600">
                              {ticket.summary}
                            </p>
                            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                              {ticket.assignedAgentName
                                ? `Assigned to ${ticket.assignedAgentName}`
                                : "Waiting for assignment"}
                            </p>
                          </button>
                        );
                      })
                    ) : (
                      <EmptyState message="No tickets created yet. End a call to populate the dashboard." />
                    )}
                  </Panel>
                </div>
              </div>
            </div>

            <div className="rounded-md border-2 border-black bg-white p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] lg:p-7">
              <SectionHeading
                eyebrow="Support lanes"
                title="Per-agent dashboards"
                description="These lists mirror the filtered agent views you will wire into dedicated routes later."
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
                description="Use this panel to show the summary, transcript, assignment reason, and status controls during the demo."
              />

              {selectedTicket ? (
                <div className="mt-6 grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
                  <div className="grid gap-4 rounded-md border-2 border-black bg-white p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
                          Customer
                        </p>
                        <h3 className="mt-2 text-2xl font-semibold text-slate-950">
                          {selectedTicket.ticket.customerName}
                        </h3>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Tag>
                          {humanizeToken(selectedTicket.ticket.category)}
                        </Tag>
                        <Tag>
                          {humanizePriority(selectedTicket.ticket.priority)}
                        </Tag>
                      </div>
                    </div>

                    <DetailRow label="Assignment">
                      {selectedTicket.ticket.assignmentReason}
                    </DetailRow>
                    <DetailRow label="Summary">
                      {selectedTicket.ticket.summary}
                    </DetailRow>
                    <DetailRow label="Call started">
                      {formatTimestamp(selectedTicket.ticket.startedAt)}
                    </DetailRow>
                    <DetailRow label="Call ended">
                      {formatTimestamp(selectedTicket.ticket.endedAt)}
                    </DetailRow>

                    <div className="grid gap-3 pt-2">
                      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Update status
                      </p>
                      <div className="grid gap-3 sm:grid-cols-3">
                        {(["open", "in_progress", "resolved"] as const).map(
                          (status) => (
                            <ActionButton
                              key={status}
                              busy={pendingAction === "updating"}
                              onClick={() => void handleStatusChange(
                                selectedTicket.ticket._id,
                                status,
                              )}
                              tone={
                                selectedTicket.ticket.status === status
                                  ? "primary"
                                  : "secondary"
                              }
                            >
                              {humanizeStatus(status)}
                            </ActionButton>
                          ),
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 rounded-md border-2 border-black bg-white p-5 text-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <p className="text-sm font-bold uppercase tracking-widest text-[#2a6de1] font-mono">
                      Transcript
                    </p>
                    {selectedTicket.ticket.transcript.length > 0 ? (
                      selectedTicket.ticket.transcript.map((message, index) => (
                        <div
                          key={`${message.role}-${index}`}
                          className={[
                            "max-w-[92%] rounded-md px-4 py-3 text-sm leading-6 border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]",
                            message.role === "customer"
                              ? "justify-self-start bg-white text-black"
                              : "justify-self-end bg-[#2a6de1] text-white",
                          ].join(" ")}
                        >
                          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest opacity-80 font-mono">
                            {message.role}
                          </p>
                          <p className="font-medium">{message.content}</p>
                        </div>
                      ))
                    ) : (
                      <EmptyState
                        message="No transcript saved for this ticket."
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-6">
                  <EmptyState message="Select a ticket to view its transcript and routing detail." />
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function AgentLane(props: {
  agentSlug: string;
  agentName: string;
  specialties: string[];
  activeCount: number;
  onSelectTicket: (ticketId: Id<"tickets">) => void;
  selectedTicketId: Id<"tickets"> | null;
}) {
  const dashboard = useQuery(api.tickets.agentDashboard, {
    agentSlug: props.agentSlug,
  });

  return (
    <div className="grid gap-4 rounded-[28px] border border-slate-200 bg-slate-50/80 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold text-slate-950">
            {props.agentName}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {props.specialties
              .map((specialty) => humanizeToken(specialty))
              .join(" • ")}
          </p>
        </div>
        <span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-white">
          {props.activeCount} active
        </span>
      </div>

      {dashboard && dashboard.tickets.length > 0 ? (
        dashboard.tickets.map((ticket) => {
          const isSelected = ticket._id === props.selectedTicketId;
          return (
            <button
              key={ticket._id}
              type="button"
              onClick={() => props.onSelectTicket(ticket._id)}
              className={[
                "grid gap-2 rounded-md border-2 px-4 py-3 text-left transition-all",
                isSelected
                  ? "border-black bg-[#f5ce4d] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] translate-x-[-2px] translate-y-[-2px]"
                  : "border-black bg-white shadow-none hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[-2px] hover:translate-y-[-2px]",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-slate-950">
                  {ticket.customerName}
                </p>
                <Tag>{humanizeStatus(ticket.status)}</Tag>
              </div>
              <p className="text-sm leading-6 text-slate-600">
                {ticket.summary}
              </p>
            </button>
          );
        })
      ) : (
        <EmptyState
          message={`No tickets assigned to ${props.agentName} yet.`}
        />
      )}
    </div>
  );
}

function SectionHeading(props: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-2 border-b-2 border-black pb-4 mb-4">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-900 font-mono">
        {props.eyebrow}
      </p>
      <h2 className="text-2xl font-black tracking-tight text-black sm:text-3xl">
        {props.title}
      </h2>
      <p className="max-w-3xl text-sm font-medium text-slate-800 sm:text-base">
        {props.description}
      </p>
    </div>
  );
}

function Panel(props: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-4 rounded-md border-2 border-black bg-white p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
      <div className="border-b-2 border-black pb-3">
        <h3 className="text-lg font-black text-black uppercase tracking-tight">{props.title}</h3>
        <p className="mt-1 text-sm font-medium text-slate-700">{props.subtitle}</p>
      </div>
      <div className="grid gap-3">{props.children}</div>
    </div>
  );
}

function StatCard(props: { label: string; value: number }) {
  return (
    <div className="rounded-md border-2 border-black bg-white p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 font-mono">
        {props.label}
      </p>
      <p className="mt-2 text-3xl font-black text-black">
        {props.value}
      </p>
    </div>
  );
}

function MetricPanel(props: {
  label: string;
  value: string;
  tone: "cyan" | "amber" | "rose";
}) {
  const toneClassNames = {
    cyan: "bg-[#2a6de1] text-white", // Classic thick blue
    amber: "bg-[#f5ce4d] text-black", // Neobrutalist yellow
    rose: "bg-[#e03b24] text-white", // Hard red
  } as const;

  return (
    <div
      className={`rounded-md border-2 border-black px-4 py-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] ${toneClassNames[props.tone]}`}
    >
      <p className="text-[10px] font-bold uppercase tracking-widest font-mono">
        {props.label}
      </p>
      <p className="mt-3 text-3xl font-bold font-mono">{props.value}</p>
    </div>
  );
}

function ActionButton(props: {
  children: React.ReactNode;
  onClick: () => void;
  busy?: boolean;
  tone?: "primary" | "secondary";
}) {
  const tone = props.tone ?? "primary";
  const className =
    tone === "primary"
      ? "bg-[#2a6de1] text-white active:bg-[#1a55b8]"
      : "bg-white text-slate-900 active:bg-slate-100";

  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.busy}
      className={`rounded-md border-2 border-black px-4 py-3 text-sm font-bold transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none disabled:translate-x-1 disabled:translate-y-1 disabled:shadow-none disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {props.busy ? "Working..." : props.children}
    </button>
  );
}

function Tag(props: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm border-2 border-black bg-[#f5ce4d] px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-black">
      {props.children}
    </span>
  );
}

function DetailRow(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 rounded-sm border-2 border-black bg-slate-50 px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 font-mono">
        {props.label}
      </p>
      <p className="text-sm font-medium text-slate-900">{props.children}</p>
    </div>
  );
}

function EmptyState(props: { message: string; dark?: boolean }) {
  return (
    <div
      className={[
        "rounded-md border-2 border-dashed px-4 py-6 text-sm font-bold font-mono",
        props.dark
          ? "border-slate-500 bg-slate-900 text-slate-300"
          : "border-black bg-slate-100 text-slate-500",
      ].join(" ")}
    >
      {props.message}
    </div>
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong while talking to the backend.";
}

function humanizePriority(priority: DemoScenario["expectedPriority"]): string {
  return humanizeToken(priority);
}

function humanizeStatus(status: "open" | "in_progress" | "resolved"): string {
  return humanizeToken(status);
}

function humanizeToken(value: string): string {
  return value.replace(/_/g, " ");
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp));
}
