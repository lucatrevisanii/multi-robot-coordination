// Headless verification harness. Runs the pure sim for many ticks and asserts
// the coordination invariants hold. Exits non-zero on any failure.
// Run with: npm run check
import { createWorld, step, conflictCount, DEFAULT_PARAMS, type World } from "./sim";

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function check(world: World, label: string): void {
  const robotIds = new Set(world.robots.map((r) => r.id));
  const taskIds = new Set(world.tasks.map((t) => t.id));

  // Every robot inside bounds.
  for (const robot of world.robots) {
    if (
      robot.pos.x < 0 ||
      robot.pos.x > world.width ||
      robot.pos.y < 0 ||
      robot.pos.y > world.height
    ) {
      fail(`${label}: robot ${robot.id} out of bounds (${robot.pos.x}, ${robot.pos.y})`);
    }
    // An assignment must reference a real task.
    if (robot.assigned !== null && !taskIds.has(robot.assigned)) {
      fail(`${label}: robot ${robot.id} assigned to dead task ${robot.assigned}`);
    }
    // No belief may credit a winner that is not a live robot.
    for (const agent of robot.winAgent.values()) {
      if (!robotIds.has(agent)) {
        fail(`${label}: belief credits missing robot ${agent}`);
      }
    }
  }

  // With full connectivity (large comm range) consensus must converge to a
  // conflict-free assignment: no task held by two robots.
  if (conflictCount(world) !== 0) {
    fail(`${label}: ${conflictCount(world)} task(s) double-assigned after consensus`);
  }

  // Open task count is held at the target.
  if (world.tasks.length !== world.params.taskTarget) {
    fail(`${label}: ${world.tasks.length} tasks open, expected ${world.params.taskTarget}`);
  }
}

// Comm range >> world diagonal => fully connected graph => strict conflict-free.
const world = createWorld(
  800,
  600,
  { ...DEFAULT_PARAMS, commRange: 5000 },
  42,
);
const STEPS = 3000;

for (let i = 0; i < STEPS; i++) {
  step(world);
  if (i % 250 === 0) check(world, `tick ${i}`);
}
check(world, "final");

if (world.completed <= 0) {
  fail(`no tasks completed after ${STEPS} ticks`);
}

console.log(
  `OK: ${STEPS} ticks, ${world.completed} tasks completed, ` +
    `${world.robots.length} robots, ${world.tasks.length} open tasks, ` +
    `0 assignment conflicts, invariants held.`,
);
