# Multi-robot coordination

Decentralized multi-robot task allocation in the browser, via a
**consensus-based auction**. Runs live, no central planner.

**[Live demo →](https://lucatrevisanii.github.io/multi-robot-coordination/)**

A swarm of robots clears a field of tasks. No node assigns work. Each robot is an
autonomous agent that bids on tasks and reaches agreement with its neighbours
through local message passing — the same shape of problem you hit with real
distributed robot teams that can't rely on a central server.

## The algorithm

This implements **CBAA** (Consensus-Based Auction Algorithm — Choi, Brunton &
How, *IEEE T-RO* 2009), the single-assignment case of CBBA, adapted to a
continuous setting where tasks refill and robots keep moving. Every tick:

1. **Bid** — each unassigned robot scores the open tasks (closer = higher bid)
   and claims the best one it can win given what it currently believes about
   other robots' bids.
2. **Consensus** — robots exchange their `(winning-bid, winning-agent)` beliefs
   **only with neighbours inside the communication radius**, merging by a
   deterministic max-bid rule. This is where conflicts get resolved: a robot that
   learns it was outbid releases the task and re-bids.
3. **Act** — each robot drives to its task with boids-style local separation and
   completes it within reach.

The `conflicts` counter is the point of the whole thing. Shrink the **comm
range** and the comm graph fragments — two robots momentarily chase the same task
because their bids haven't propagated yet, and the counter climbs. Widen it and
consensus drives conflicts back to zero. That gap is exactly why the consensus
step exists.

## Run it

```bash
npm install
npm run dev      # local dev server
npm run check    # headless invariant check (no browser)
npm run build    # production build to dist/
```

`npm run check` runs the pure sim for 3000 ticks under a fully-connected comm
graph and asserts the coordination invariants: every robot stays in bounds, no
task is double-assigned after consensus, no belief credits a non-existent robot,
a robot's assignment always references a live task, and the open-task count holds
steady.

## Scope, honestly

This is a focused simulation of the *coordination* problem, not a robotics stack.
The auction and consensus logic (`src/sim.ts`) is the real content and is pure
and headless; rendering (`src/render.ts`) and controls (`src/main.ts`) are
separate. What it deliberately leaves out: real robot dynamics, collision
guarantees, sensor noise, and asynchronous messaging — the consensus rounds run
synchronously each tick. The bid is distance-based rather than a full
reward-minus-cost utility. Think of it as a faithful, inspectable model of
decentralized auction + consensus, not a physics simulator.

## License

MIT
