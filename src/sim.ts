// Pure simulation core. No rendering, no DOM, no globals.
//
// Decentralized task allocation via CBAA (Consensus-Based Auction Algorithm,
// Choi, Brunton & How, 2009) — the single-assignment case of CBBA, adapted to a
// continuous/online setting where tasks refill and robots keep moving.
//
// Each robot is an autonomous agent. There is no central assigner. Every tick:
//   1. Bid     — an unassigned robot bids on the open task it can win (score
//                = 1/(1+distance)) given what it currently believes about other
//                robots' bids.
//   2. Consensus — robots exchange their (winning-bid, winning-agent) beliefs
//                ONLY with neighbours inside the communication radius (local
//                message passing over a dynamic comm graph), merging by the
//                max-bid rule. This is where conflicts get resolved: when a
//                robot learns it was outbid on its task, it releases it.
//   3. Act     — assigned robots drive to their task with local separation,
//                and complete it within reach.
//
// With a large comm radius the graph is connected and the assignment is always
// conflict-free. Shrink it and you can watch two robots momentarily chase the
// same task until their bids propagate — the demo of why the consensus step
// exists.
import { mulberry32, type Rng } from "./rng";

export interface Vec {
  x: number;
  y: number;
}

export interface Robot {
  id: number;
  pos: Vec;
  vel: Vec;
  color: string;
  completed: number;
  assigned: number | null; // task id this robot is executing
  // Local belief vectors (CBAA y and z): per task, the best bid seen and who holds it.
  winBid: Map<number, number>;
  winAgent: Map<number, number>;
}

export interface Task {
  id: number;
  pos: Vec;
}

export interface SimParams {
  robotCount: number;
  taskTarget: number; // how many open tasks to keep in the world
  speed: number; // max units per tick
  sense: number; // local separation radius
  reach: number; // distance at which a task counts as done
  commRange: number; // communication radius for the consensus step
}

export interface World {
  width: number;
  height: number;
  robots: Robot[];
  tasks: Task[];
  completed: number;
  ticks: number;
  rng: Rng;
  nextTaskId: number;
  params: SimParams;
}

export const DEFAULT_PARAMS: SimParams = {
  robotCount: 18,
  taskTarget: 24,
  speed: 1.8,
  sense: 26,
  reach: 8,
  commRange: 180,
};

const COLORS = [
  "#5eead4",
  "#7dd3fc",
  "#a5b4fc",
  "#f0abfc",
  "#fca5a5",
  "#fcd34d",
  "#86efac",
  "#fdba74",
];

function spawnPos(world: World): Vec {
  return { x: world.rng() * world.width, y: world.rng() * world.height };
}

function makeRobot(world: World, id: number): Robot {
  return {
    id,
    pos: spawnPos(world),
    vel: { x: 0, y: 0 },
    color: COLORS[id % COLORS.length],
    completed: 0,
    assigned: null,
    winBid: new Map(),
    winAgent: new Map(),
  };
}

function makeTask(world: World): Task {
  return { id: world.nextTaskId++, pos: spawnPos(world) };
}

export function createWorld(
  width: number,
  height: number,
  params: SimParams = DEFAULT_PARAMS,
  seed = 1,
): World {
  const world: World = {
    width,
    height,
    robots: [],
    tasks: [],
    completed: 0,
    ticks: 0,
    rng: mulberry32(seed),
    nextTaskId: 0,
    params: { ...params },
  };
  for (let i = 0; i < params.robotCount; i++) {
    world.robots.push(makeRobot(world, i));
  }
  refillTasks(world);
  return world;
}

export function refillTasks(world: World): void {
  while (world.tasks.length < world.params.taskTarget) {
    world.tasks.push(makeTask(world));
  }
}

export function setRobotCount(world: World, count: number): void {
  world.params.robotCount = count;
  while (world.robots.length < count) {
    world.robots.push(makeRobot(world, world.robots.length));
  }
  if (world.robots.length > count) {
    const dropped = world.robots.splice(count);
    const removedIds = new Set(dropped.map((r) => r.id));
    // Heal beliefs: drop any claim attributed to a robot that no longer exists,
    // so its tasks reopen for bidding instead of deadlocking.
    for (const robot of world.robots) {
      for (const [taskId, agent] of robot.winAgent) {
        if (removedIds.has(agent)) {
          robot.winAgent.delete(taskId);
          robot.winBid.delete(taskId);
        }
      }
    }
  }
}

function dist2(a: Vec, b: Vec): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function score(robot: Robot, task: Task): number {
  return 1 / (1 + Math.sqrt(dist2(robot.pos, task.pos)));
}

// Does bid (bA, agentA) beat (bB, agentB)? Higher bid wins; ties broken by the
// lower agent id so the rule is deterministic and order-independent.
function beats(bA: number, agentA: number, bB: number, agentB: number): boolean {
  if (bA > bB) return true;
  if (bA < bB) return false;
  return agentA < agentB;
}

// CBAA phase 1: each unassigned robot claims the best open task it can win,
// given its current belief about who is winning what.
function bidPhase(world: World): void {
  for (const robot of world.robots) {
    if (robot.assigned !== null) continue;

    let bestTask: Task | null = null;
    let bestScore = -1;
    for (const task of world.tasks) {
      const s = score(robot, task);
      const curBid = robot.winBid.get(task.id) ?? -1;
      const curAgent = robot.winAgent.get(task.id) ?? Infinity;
      // It can claim only if it outbids the holder it currently believes in.
      if (!beats(s, robot.id, curBid, curAgent)) continue;
      if (s > bestScore) {
        bestScore = s;
        bestTask = task;
      }
    }

    if (bestTask) {
      robot.assigned = bestTask.id;
      robot.winBid.set(bestTask.id, bestScore);
      robot.winAgent.set(bestTask.id, robot.id);
    }
  }
}

// CBAA phase 2: one synchronous round of belief exchange between robots within
// comm range. Jacobi-style — everyone merges from a snapshot of the previous
// state, so the result doesn't depend on iteration order. Returns true if any
// belief changed (so the caller can iterate to convergence).
function consensusSweep(world: World): boolean {
  const comm2 = world.params.commRange * world.params.commRange;
  const snap = world.robots.map((r) => ({
    pos: r.pos,
    bid: new Map(r.winBid),
    agent: new Map(r.winAgent),
  }));

  let changed = false;
  for (let i = 0; i < world.robots.length; i++) {
    const robot = world.robots[i];
    for (let k = 0; k < snap.length; k++) {
      if (k === i) continue;
      if (dist2(snap[i].pos, snap[k].pos) > comm2) continue; // not a neighbour
      for (const [taskId, kBid] of snap[k].bid) {
        const kAgent = snap[k].agent.get(taskId)!;
        const curBid = robot.winBid.get(taskId) ?? -1;
        const curAgent = robot.winAgent.get(taskId) ?? Infinity;
        if (beats(kBid, kAgent, curBid, curAgent)) {
          robot.winBid.set(taskId, kBid);
          robot.winAgent.set(taskId, kAgent);
          changed = true;
        }
      }
    }
  }
  return changed;
}

function runConsensus(world: World): void {
  // Converges in at most the comm-graph diameter; cap as a backstop and
  // early-exit once stable.
  const maxSweeps = world.robots.length + 4;
  for (let n = 0; n < maxSweeps; n++) {
    if (!consensusSweep(world)) break;
  }
  // Release tasks we got outbid on.
  for (const robot of world.robots) {
    if (robot.assigned === null) continue;
    if (robot.winAgent.get(robot.assigned) !== robot.id) {
      robot.assigned = null;
    }
  }
}

function pruneBeliefs(world: World, removed: Set<number>): void {
  for (const robot of world.robots) {
    for (const taskId of removed) {
      robot.winBid.delete(taskId);
      robot.winAgent.delete(taskId);
    }
  }
}

export function step(world: World): void {
  bidPhase(world);
  runConsensus(world);

  const taskById = new Map<number, Task>();
  for (const task of world.tasks) taskById.set(task.id, task);

  const { speed, sense, reach } = world.params;
  const sense2 = sense * sense;
  const completedIds = new Set<number>();

  for (const robot of world.robots) {
    let ax = 0;
    let ay = 0;

    // Seek the assigned task.
    if (robot.assigned !== null) {
      const task = taskById.get(robot.assigned);
      if (task) {
        const dx = task.pos.x - robot.pos.x;
        const dy = task.pos.y - robot.pos.y;
        const d = Math.hypot(dx, dy) || 1;
        ax += dx / d;
        ay += dy / d;
      } else {
        robot.assigned = null; // task already gone
      }
    }

    // Local separation from sensed neighbours.
    let sepX = 0;
    let sepY = 0;
    for (const other of world.robots) {
      if (other.id === robot.id) continue;
      const dx = robot.pos.x - other.pos.x;
      const dy = robot.pos.y - other.pos.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 0 && d2 < sense2) {
        const d = Math.sqrt(d2);
        sepX += dx / d / d;
        sepY += dy / d / d;
      }
    }
    ax += sepX * 12;
    ay += sepY * 12;

    const am = Math.hypot(ax, ay);
    if (am > 0) {
      robot.vel.x = (ax / am) * speed;
      robot.vel.y = (ay / am) * speed;
    } else {
      robot.vel.x = 0;
      robot.vel.y = 0;
    }

    robot.pos.x += robot.vel.x;
    robot.pos.y += robot.vel.y;

    if (robot.pos.x < 0) robot.pos.x = 0;
    else if (robot.pos.x > world.width) robot.pos.x = world.width;
    if (robot.pos.y < 0) robot.pos.y = 0;
    else if (robot.pos.y > world.height) robot.pos.y = world.height;

    // Complete the assigned task if close enough (and not already taken this tick).
    if (robot.assigned !== null && !completedIds.has(robot.assigned)) {
      const task = taskById.get(robot.assigned);
      if (task && dist2(robot.pos, task.pos) <= reach * reach) {
        completedIds.add(task.id);
        robot.completed++;
        robot.assigned = null;
        world.completed++;
      }
    }
  }

  if (completedIds.size) {
    world.tasks = world.tasks.filter((t) => !completedIds.has(t.id));
    pruneBeliefs(world, completedIds);
    // A robot that was racing a now-finished task drops its stale claim.
    for (const robot of world.robots) {
      if (robot.assigned !== null && completedIds.has(robot.assigned)) {
        robot.assigned = null;
      }
    }
    refillTasks(world);
  }

  world.ticks++;
}

// Number of open tasks currently assigned to more than one robot. Zero once
// consensus has converged on a connected comm graph; spikes transiently when
// the graph is sparse. Exposed so the UI can show conflict resolution at work.
export function conflictCount(world: World): number {
  const perTask = new Map<number, number>();
  for (const robot of world.robots) {
    if (robot.assigned === null) continue;
    perTask.set(robot.assigned, (perTask.get(robot.assigned) ?? 0) + 1);
  }
  let conflicts = 0;
  for (const count of perTask.values()) if (count > 1) conflicts++;
  return conflicts;
}
