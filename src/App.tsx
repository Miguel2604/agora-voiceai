import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  DEMO_SCENARIOS,
  getScenarioById,
  type DemoScenario,
} from "./demoScenarios";
// buildChannelName is available in ./lib/callSession if dynamic channels are needed
import {
  joinChannel,
  leaveChannel,
  toggleMute,
  type CallSessionState,
} from "./lib/agoraClient";

type PendingAction =
  | "seeding"
  | "resetting"
  | "starting"
  | "ending"
  | "updating"
  | null;

type InputMode = "live" | "demo";

type LiveCallInfo = {
  callId: Id<"calls">;
  agentId: string;
  channelName: string;
  startedAt: number;
};

export default function App() {
  const [inputMode, setInputMode] = useState<InputMode>("live");
  const [customerName, setCustomerName] = useState("Alyssa");
  const [selectedScenarioId, setSelectedScenarioId] = useState(
    DEMO_SCENARIOS[0].id,
  );
  const [selectedTicketId, setSelectedTicketId] =
    useState<Id<"tickets"> | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Live call state
  const [callState, setCallState] = useState<CallSessionState>("idle");
  const [liveCall, setLiveCall] = useState<LiveCallInfo | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const durationRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const ensureDemoReady = useMutation(api.demo.ensureDemoReady);
  const resetDemo = useMutation(api.demo.resetDemo);
  const startCallMutation = useMutation(api.calls.startCall);
  const endCallMutation = useMutation(api.calls.endCall);
  const updateStatus = useMutation(api.tickets.updateStatus);

  // Agora actions
  const generateToken = useAction(api.agora.generateToken);
  const startAgent = useAction(api.agora.startAgent);
  const processCallEnd = useAction(api.callActions.processCallEnd);

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

  // Call duration timer
  useEffect(() => {
    if (callState === "connected" && liveCall) {
      durationRef.current = setInterval(() => {
        setCallDuration(Math.floor((Date.now() - liveCall.startedAt) / 1000));
      }, 1000);
    } else {
      if (durationRef.current) {
        clearInterval(durationRef.current);
        durationRef.current = null;
      }
      if (callState === "idle") {
        setCallDuration(0);
      }
    }

    return () => {
      if (durationRef.current) {
        clearInterval(durationRef.current);
      }
    };
  }, [callState, liveCall]);

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

  // ── Live call flow ─────────────────────────────────────────────
  const handleStartLiveCall = useCallback(async () => {
    const trimmedName = customerName.trim();
    if (!trimmedName) {
      setErrorMessage("Add a customer name before starting a call.");
      return;
    }

    setCallState("joining");
    setFeedback(null);
    setErrorMessage(null);

    try {
      // 1. Use fixed channel name (must match the temp token's channel)
      const channelName = "neosolve";

      // 2. Get token + app ID
      const { token, appId } = await generateToken({
        channelName,
        uid: 0,
      });

      // 3. Join Agora RTC channel from the browser
      const session = await joinChannel({
        appId,
        channelName,
        token: token || null,
      });

      const customerUid = String(session.uid);

      // 4. Create call record in Convex
      const { callId } = await startCallMutation({
        customerName: trimmedName,
        channelName,
      });

      // 5. Start the AI agent via Convex action
      const agentResult = await startAgent({
        channelName,
        customerUid,
        token: token || "",
      });

      setLiveCall({
        callId,
        agentId: agentResult.agentId,
        channelName,
        startedAt: Date.now(),
      });
      setCallState("connected");
      setFeedback(
        `Connected! Nova is greeting ${trimmedName}. Speak into your microphone.`,
      );
    } catch (error) {
      setCallState("error");
      setErrorMessage(getErrorMessage(error));
      // Clean up browser RTC if it partially joined
      try {
        await leaveChannel();
      } catch {
        // ignore cleanup errors
      }
    }
  }, [customerName, generateToken, startCallMutation, startAgent]);

  const handleEndLiveCall = useCallback(async () => {
    if (!liveCall) return;

    setCallState("leaving");
    setFeedback(null);
    setErrorMessage(null);

    try {
      // 1. Leave the browser RTC channel
      await leaveChannel();

      // 2. Process the call end on the server (fetch transcript, classify, create ticket)
      const result = await processCallEnd({
        callId: liveCall.callId,
        agentId: liveCall.agentId,
      });

      setSelectedTicketId(result.ticketId);
      setFeedback(
        result.assignedAgentName
          ? `Call ended. Ticket routed to ${result.assignedAgentName}.`
          : "Call ended. Ticket created without an assigned agent.",
      );
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setLiveCall(null);
      setCallState("idle");
      setIsMuted(false);
    }
  }, [liveCall, processCallEnd]);

  const handleToggleMute = useCallback(async () => {
    try {
      const newMuted = await toggleMute();
      setIsMuted(newMuted);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }, []);

  // ── Demo script flow (unchanged) ──────────────────────────────
  async function handleStartDemoCall() {
    const trimmedName = customerName.trim();
    if (!trimmedName) {
      setErrorMessage("Add a customer name before starting a call.");
      return;
    }

    setPendingAction("starting");
    setFeedback(null);
    setErrorMessage(null);

    try {
      await startCallMutation({
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

  const isInCall = callState === "connected" || callState === "joining";

  return (
    <div className="min-h-screen px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
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
                  Customers talk to Nova (AI voice agent) via Agora
                  Conversational AI. Gemini classifies the transcript and routes
                  tickets to the right specialist in real time.
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
              eyebrow="Call controls"
              title="Start a support call"
              description="Use Live Call to talk to Nova via your microphone, or Demo Script to run a pre-written scenario."
            />

            {/* Mode toggle */}
            <div className="grid grid-cols-2 gap-0 rounded-md border-2 border-black overflow-hidden">
              <button
                type="button"
                onClick={() => setInputMode("live")}
                disabled={isInCall}
                className={[
                  "px-4 py-3 text-sm font-bold uppercase tracking-widest transition-all border-r-2 border-black",
                  inputMode === "live"
                    ? "bg-[#2a6de1] text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50",
                  isInCall ? "cursor-not-allowed opacity-60" : "",
                ].join(" ")}
              >
                Live call
              </button>
              <button
                type="button"
                onClick={() => setInputMode("demo")}
                disabled={isInCall}
                className={[
                  "px-4 py-3 text-sm font-bold uppercase tracking-widest transition-all",
                  inputMode === "demo"
                    ? "bg-[#2a6de1] text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50",
                  isInCall ? "cursor-not-allowed opacity-60" : "",
                ].join(" ")}
              >
                Demo script
              </button>
            </div>

            {/* Shared: customer name + admin buttons */}
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
              {inputMode === "demo" ? (
                <ActionButton
                  busy={pendingAction === "starting"}
                  onClick={() => void handleStartDemoCall()}
                >
                  Start call
                </ActionButton>
              ) : (
                <div /> /* spacer */
              )}
            </div>

            <label className="grid gap-2 text-sm font-bold text-slate-900 font-mono uppercase tracking-tight">
              Customer name
              <input
                className="rounded-md border-2 border-black bg-white px-4 py-3 text-base text-slate-900 outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                placeholder="Enter customer name"
                disabled={isInCall}
              />
            </label>

            {/* ── Live call mode ──────────────────────────────── */}
            {inputMode === "live" && (
              <>
                {callState === "idle" || callState === "error" ? (
                  <div className="grid gap-4">
                    <div className="rounded-md border-2 border-black bg-slate-50 p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 font-mono">
                        How it works
                      </p>
                      <p className="mt-2 text-sm font-medium leading-7 text-slate-700">
                        Click "Call Now" to connect via your microphone. Nova
                        (AI agent) will greet you, gather your support issue
                        details, then the call transcript is classified by
                        Gemini and routed to the right specialist.
                      </p>
                    </div>
                    <ActionButton
                      busy={false}
                      onClick={() => void handleStartLiveCall()}
                    >
                      Call now
                    </ActionButton>
                  </div>
                ) : null}

                {callState === "joining" ? (
                  <div className="rounded-md border-2 border-black bg-[#f5ce4d] p-6 text-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <p className="text-lg font-black text-black animate-pulse">
                      Connecting to Nova...
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-700">
                      Allow microphone access if prompted by your browser.
                    </p>
                  </div>
                ) : null}

                {callState === "connected" ? (
                  <LiveCallPanel
                    duration={callDuration}
                    isMuted={isMuted}
                    onToggleMute={() => void handleToggleMute()}
                    onEndCall={() => void handleEndLiveCall()}
                  />
                ) : null}

                {callState === "leaving" ? (
                  <div className="rounded-md border-2 border-black bg-slate-900 p-6 text-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <p className="text-lg font-black text-white animate-pulse">
                      Processing call...
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-400">
                      Fetching transcript, classifying with Gemini, creating
                      ticket.
                    </p>
                  </div>
                ) : null}
              </>
            )}

            {/* ── Demo script mode ───────────────────────────── */}
            {inputMode === "demo" && (
              <>
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
                            ? "border-black bg-[#f5ce4d] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] translate-x-[-2px] translate-y-[-2px]"
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
                          <Tag>
                            {humanizePriority(scenario.expectedPriority)}
                          </Tag>
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
              </>
            )}

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
                            <Tag>{call.agoraAgentId ? "live" : "demo"}</Tag>
                          </div>
                          <p className="text-sm leading-6 text-slate-600">
                            {call.notes ?? "Live voice call in progress."}
                          </p>
                          {/* Only show end button for demo calls — live calls end from the call panel */}
                          {!call.agoraAgentId && (
                            <ActionButton
                              busy={pendingAction === "ending"}
                              onClick={() => void handleEndDemoCall(call._id)}
                            >
                              End call and create ticket
                            </ActionButton>
                          )}
                        </article>
                      ))
                    ) : (
                      <EmptyState message="No active calls. Start one from the call controls." />
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
                                ? "border-black bg-[#f5ce4d] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] translate-x-[-2px] translate-y-[-2px]"
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
                description="Use this panel to see the summary, transcript, assignment reason, and status controls."
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
                              onClick={() =>
                                void handleStatusChange(
                                  selectedTicket.ticket._id,
                                  status,
                                )
                              }
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
                      <EmptyState message="No transcript saved for this ticket." />
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

// ── Live call panel ──────────────────────────────────────────────

function LiveCallPanel(props: {
  duration: number;
  isMuted: boolean;
  onToggleMute: () => void;
  onEndCall: () => void;
}) {
  const minutes = Math.floor(props.duration / 60);
  const seconds = props.duration % 60;
  const timeDisplay = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  return (
    <div className="grid gap-4 rounded-md border-2 border-black bg-slate-900 p-6 text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
          </span>
          <p className="text-sm font-bold uppercase tracking-widest font-mono">
            Live call with Nova
          </p>
        </div>
        <p className="text-2xl font-black font-mono tabular-nums">
          {timeDisplay}
        </p>
      </div>
      <p className="text-sm text-slate-400">
        Speak into your microphone. Nova is listening and will gather your
        support issue details.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={props.onToggleMute}
          className={[
            "rounded-md border-2 border-white/20 px-4 py-3 text-sm font-bold transition-all",
            props.isMuted
              ? "bg-[#f5ce4d] text-black"
              : "bg-white/10 text-white hover:bg-white/20",
          ].join(" ")}
        >
          {props.isMuted ? "Unmute" : "Mute"}
        </button>
        <button
          type="button"
          onClick={props.onEndCall}
          className="rounded-md border-2 border-[#e03b24] bg-[#e03b24] px-4 py-3 text-sm font-bold text-white transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none"
        >
          End call
        </button>
      </div>
    </div>
  );
}

// ── Agent lane ───────────────────────────────────────────────────

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
              .join(" / ")}
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

// ── Shared UI components ─────────────────────────────────────────

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
        <h3 className="text-lg font-black text-black uppercase tracking-tight">
          {props.title}
        </h3>
        <p className="mt-1 text-sm font-medium text-slate-700">
          {props.subtitle}
        </p>
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
      <p className="mt-2 text-3xl font-black text-black">{props.value}</p>
    </div>
  );
}

function MetricPanel(props: {
  label: string;
  value: string;
  tone: "cyan" | "amber" | "rose";
}) {
  const toneClassNames = {
    cyan: "bg-[#2a6de1] text-white",
    amber: "bg-[#f5ce4d] text-black",
    rose: "bg-[#e03b24] text-white",
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

// ── Utilities ────────────────────────────────────────────────────

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
