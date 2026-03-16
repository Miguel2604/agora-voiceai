import type { Id } from "../../convex/_generated/dataModel";
import { Tag, EmptyState, ActionButton, formatTimestamp } from "./ui";

type ActiveCall = {
  _id: Id<"calls">;
  customerName: string;
  startedAt: number;
  agoraAgentId?: string | null;
  notes?: string | null;
};

export function ActiveCalls(props: {
  calls: ActiveCall[] | undefined;
  onEndDemoCall: (callId: Id<"calls">) => void;
  pendingAction: string | null;
}) {
  if (!props.calls || props.calls.length === 0) {
    return (
      <EmptyState message="No active calls. Start one from the call controls." />
    );
  }

  return (
    <>
      {props.calls.map((call) => (
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
          {/* Only show end button for demo calls -- live calls end from the call panel */}
          {!call.agoraAgentId && (
            <ActionButton
              busy={props.pendingAction === "ending"}
              onClick={() => void props.onEndDemoCall(call._id)}
            >
              End call and create ticket
            </ActionButton>
          )}
        </article>
      ))}
    </>
  );
}
