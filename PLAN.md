# Multi-View Architecture Plan

Split the monolithic `src/App.tsx` (1 136 lines, zero routing) into three role-based views served by a lightweight hash router. No new npm dependencies are required.

---

## 1. Target views

| Route           | Role          | What it shows                                                                    |
| --------------- | ------------- | -------------------------------------------------------------------------------- |
| `#/`            | Customer      | Landing page with call controls (live + demo), feedback/error banners            |
| `#/lead`        | Team leader   | Header metrics, active calls, ticket queue, ticket detail panel, per-agent lanes |
| `#/agent/:slug` | Support agent | Filtered dashboard for one agent, ticket list, ticket detail                     |

All three views share the same Convex backend -- no API changes needed.

---

## 2. Router approach

Use a **hash-based router** built from scratch (~40 lines) rather than pulling in `react-router-dom`. The app is a single deployment target (Vite SPA) and only needs three patterns.

### `src/lib/router.ts`

```ts
type Route =
  | { view: "landing" }
  | { view: "lead" }
  | { view: "agent"; slug: string };

function parseHash(hash: string): Route { ... }
function useRoute(): Route { ... }          // useState + hashchange listener
function navigate(path: string): void { ... } // window.location.hash = path
```

### `src/main.tsx` (unchanged)

Still renders `<ConvexProvider><App /></ConvexProvider>`. The `App` component becomes a thin shell that reads `useRoute()` and renders the correct view.

---

## 3. New file structure

```
src/
  main.tsx                      # unchanged
  App.tsx                       # slim shell: useRoute() -> render view
  lib/
    router.ts                   # hash router (useRoute, navigate, parseHash)
    agoraClient.ts              # unchanged
    callSession.ts              # unchanged
  components/
    ui.tsx                      # shared primitives extracted from App.tsx
                                #   SectionHeading, Panel, StatCard, MetricPanel,
                                #   ActionButton, Tag, DetailRow, EmptyState
    LiveCallPanel.tsx            # extracted from App.tsx
    AgentLane.tsx                # extracted from App.tsx
    TicketDetail.tsx             # extracted from App.tsx (ticket detail section)
    TicketQueue.tsx              # extracted from App.tsx (ticket list with selection)
    ActiveCalls.tsx              # extracted from App.tsx (active calls panel)
    NavBar.tsx                   # top navigation bar for switching views
  views/
    LandingPage.tsx              # customer call interface
    LeadDashboard.tsx            # team leader view
    AgentView.tsx                # per-agent filtered view
  demoScenarios.ts              # unchanged
```

---

## 4. Extraction map

What moves out of `App.tsx` and where it goes.

### 4a. Shared UI primitives -> `src/components/ui.tsx`

Extracted verbatim (no logic changes):

- `SectionHeading`
- `Panel`
- `StatCard`
- `MetricPanel`
- `ActionButton`
- `Tag`
- `DetailRow`
- `EmptyState`

Also move the utility functions:

- `getErrorMessage`
- `humanizePriority`
- `humanizeStatus`
- `humanizeToken`
- `formatTimestamp`

### 4b. Compound components -> `src/components/`

| Component       | Source lines (approx) | Notes                                                                                                             |
| --------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `LiveCallPanel` | 851-903               | Already a standalone function. Move as-is.                                                                        |
| `AgentLane`     | 908-971               | Already standalone. Uses `useQuery(agentDashboard)` internally. Move as-is.                                       |
| `TicketDetail`  | 738-841               | Extract the ticket detail section. Receives `selectedTicket`, `onStatusChange`, `pendingAction` as props.         |
| `TicketQueue`   | 659-708               | Extract the ticket queue list. Receives `tickets`, `selectedTicketId`, `onSelectTicket` as props.                 |
| `ActiveCalls`   | 617-657               | Extract the active calls panel. Receives `calls`, `onEndDemoCall`, `pendingAction` as props.                      |
| `NavBar`        | new                   | Simple row of links: Landing / Lead Dashboard / Agent views. Highlights current route. Uses neobrutalist styling. |

### 4c. Views -> `src/views/`

#### `LandingPage.tsx`

Owns:

- Customer name input
- Input mode toggle (live / demo)
- Live call flow: `handleStartLiveCall`, `handleEndLiveCall`, `handleToggleMute` + all `callState` / `liveCall` / `isMuted` / `callDuration` state
- Demo script flow: scenario selector, `handleStartDemoCall`
- Seed agents / Reset demo buttons
- Feedback and error banners

Convex hooks used:

- `useMutation(api.demo.ensureDemoReady)`
- `useMutation(api.demo.resetDemo)`
- `useMutation(api.calls.startCall)`
- `useAction(api.agora.generateToken)`
- `useAction(api.agora.startAgent)`
- `useAction(api.callActions.processCallEnd)`

Does NOT query tickets or agents -- it only writes calls and starts agents.

#### `LeadDashboard.tsx`

Owns:

- Header with metric cards (active calls, open, in progress, resolved, unassigned)
- `ActiveCalls` component
- `TicketQueue` component (with selection state)
- `TicketDetail` component
- Per-agent lanes (renders `AgentLane` for each agent)
- Status update handler (`handleStatusChange`)

Convex hooks used:

- `useQuery(api.tickets.leadDashboard)`
- `useQuery(api.supportAgents.listAgents)`
- `useQuery(api.calls.listCalls, { status: "active" })`
- `useQuery(api.tickets.getTicketDetail, ...)`
- `useMutation(api.tickets.updateStatus)`
- `useMutation(api.calls.endCall)` (for ending demo calls from the active calls panel)

#### `AgentView.tsx`

Owns:

- Agent header with name, specialties, workload summary
- Filtered ticket list (only tickets assigned to this agent)
- Ticket detail panel (same `TicketDetail` component)
- Status update handler

Convex hooks used:

- `useQuery(api.tickets.agentDashboard, { agentSlug })`
- `useQuery(api.tickets.getTicketDetail, ...)`
- `useMutation(api.tickets.updateStatus)`

The `slug` comes from the route: `#/agent/kean`, `#/agent/maya`, `#/agent/carlos`.

---

## 5. Slim `App.tsx` (after refactor)

```tsx
import { useRoute } from "./lib/router";
import { NavBar } from "./components/NavBar";
import { LandingPage } from "./views/LandingPage";
import { LeadDashboard } from "./views/LeadDashboard";
import { AgentView } from "./views/AgentView";

export default function App() {
  const route = useRoute();

  return (
    <div className="min-h-screen px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <NavBar />
        {route.view === "landing" && <LandingPage />}
        {route.view === "lead" && <LeadDashboard />}
        {route.view === "agent" && <AgentView slug={route.slug} />}
      </div>
    </div>
  );
}
```

---

## 6. NavBar design

A full-width bar matching the neobrutalist style:

- Pill/tab for each view: **Call** | **Lead** | **Kean** | **Maya** | **Carlos**
- Active tab: `bg-[#2a6de1] text-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]`
- Inactive tab: `bg-white text-black border-2 border-black hover:bg-slate-50`
- Agent tabs are populated from `useQuery(api.supportAgents.listAgents)` so they stay dynamic
- The bar wraps in a `border-2 border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]` container

---

## 7. Implementation order

| Step | Task                                                                        | Estimated size |
| ---- | --------------------------------------------------------------------------- | -------------- |
| 1    | Create `src/lib/router.ts`                                                  | ~40 lines      |
| 2    | Create `src/components/ui.tsx` -- extract all shared primitives + utilities | ~180 lines     |
| 3    | Create `src/components/LiveCallPanel.tsx`                                   | ~55 lines      |
| 4    | Create `src/components/AgentLane.tsx`                                       | ~70 lines      |
| 5    | Create `src/components/TicketDetail.tsx`                                    | ~110 lines     |
| 6    | Create `src/components/TicketQueue.tsx`                                     | ~50 lines      |
| 7    | Create `src/components/ActiveCalls.tsx`                                     | ~45 lines      |
| 8    | Create `src/components/NavBar.tsx`                                          | ~60 lines      |
| 9    | Create `src/views/LandingPage.tsx`                                          | ~220 lines     |
| 10   | Create `src/views/LeadDashboard.tsx`                                        | ~150 lines     |
| 11   | Create `src/views/AgentView.tsx`                                            | ~120 lines     |
| 12   | Rewrite `src/App.tsx` as slim shell                                         | ~25 lines      |
| 13   | Run `npm run build` + `npm test` -- fix any issues                          | --             |

Total: ~1 125 lines across 12 files, replacing the current 1 136-line monolith.

---

## 8. What stays unchanged

- **Convex backend** -- no schema, query, mutation, or action changes
- **`src/main.tsx`** -- still renders `<ConvexProvider><App /></ConvexProvider>`
- **`src/lib/agoraClient.ts`** and **`src/lib/callSession.ts`** -- untouched
- **`src/demoScenarios.ts`** -- untouched
- **All styling** -- same neobrutalist design tokens, no new CSS classes
- **No new npm dependencies** -- hash router is hand-rolled

---

## 9. Risks and mitigations

| Risk                                                                                       | Mitigation                                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared state between views (e.g., selecting a ticket from landing then viewing it in lead) | Each view owns its own selection state. Cross-view linking uses `navigate("#/lead")` or `navigate("#/agent/kean")` with optional query params if needed later. |
| Agent slugs in URL must match DB                                                           | `AgentView` handles unknown slugs gracefully with an `EmptyState` fallback.                                                                                    |
| Hash router doesn't support back/forward well                                              | `hashchange` event gives us free browser history support.                                                                                                      |
| Large component prop drilling                                                              | Keep it shallow -- views pass props to at most one level of extracted components. No context providers needed at this scale.                                   |
