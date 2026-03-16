import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assignBestAgent } from "./lib/assignAgent";
import { classifyCallIntake } from "./lib/classifyCall";
import { ensureSeededAgents } from "./lib/demoData";
import {
  callStatusValidator,
  supportCategoryValidator,
  ticketPriorityValidator,
  transcriptValidator,
} from "./lib/validators";

export const startCall = mutation({
  args: {
    customerName: v.string(),
    channelName: v.optional(v.string()),
    agoraAgentId: v.optional(v.string()),
    notes: v.optional(v.string()),
    transcript: v.optional(transcriptValidator),
  },
  handler: async (ctx, args) => {
    const customerName = args.customerName.trim();
    if (customerName.length === 0) {
      throw new Error("Customer name is required.");
    }

    await ensureSeededAgents(ctx.db);

    const startedAt = Date.now();
    const callId = await ctx.db.insert("calls", {
      customerName,
      channelName: args.channelName,
      agoraAgentId: args.agoraAgentId,
      notes: args.notes?.trim() || undefined,
      transcript: args.transcript,
      status: "active",
      startedAt,
    });

    return { callId, startedAt };
  },
});

export const endCall = mutation({
  args: {
    callId: v.id("calls"),
    notes: v.optional(v.string()),
    transcript: v.optional(transcriptValidator),
    /** When provided by the processCallEnd action, this overrides the keyword classifier. */
    aiClassification: v.optional(
      v.object({
        category: supportCategoryValidator,
        priority: ticketPriorityValidator,
        summary: v.string(),
        isLegitimate: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call) {
      throw new Error("Call not found.");
    }
    if (call.status === "ended") {
      throw new Error("Call has already ended.");
    }

    const endedAt = Date.now();
    const finalNotes = args.notes?.trim() || call.notes;
    const finalTranscript = args.transcript ?? call.transcript ?? [];

    // Use AI classification if provided, otherwise fall back to keyword classifier
    const classification =
      args.aiClassification ??
      classifyCallIntake({
        customerName: call.customerName,
        notes: finalNotes,
        transcript: finalTranscript,
      });

    const agents = await ensureSeededAgents(ctx.db);
    const tickets = await ctx.db.query("tickets").collect();
    const assignment = assignBestAgent({
      category: classification.category,
      agents,
      tickets,
    });

    const ticketId = await ctx.db.insert("tickets", {
      callId: call._id,
      customerName: call.customerName,
      category: classification.category,
      priority: classification.priority,
      summary: classification.summary,
      transcript: finalTranscript,
      assignedAgentId: assignment.agent?._id,
      assignedAgentName: assignment.agent?.name,
      assignedAgentSlug: assignment.agent?.slug,
      assignmentReason: assignment.reason,
      status: "open",
      isLegitimate: classification.isLegitimate,
      startedAt: call.startedAt,
      endedAt,
      createdAt: endedAt,
    });

    await ctx.db.patch(call._id, {
      status: "ended",
      endedAt,
      notes: finalNotes,
      transcript: finalTranscript,
      ticketId,
    });

    return {
      callId: call._id,
      ticketId,
      assignmentReason: assignment.reason,
      assignedAgentName: assignment.agent?.name ?? null,
    };
  },
});

export const listCalls = query({
  args: {
    status: v.optional(callStatusValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const calls = await ctx.db.query("calls").collect();
    return calls
      .filter((call) => (args.status ? call.status === args.status : true))
      .sort((left, right) => right.startedAt - left.startedAt)
      .slice(0, args.limit ?? 20);
  },
});
