// Canvas rendering for the sim. Reads world state, draws nothing back into it.
import { conflictCount, type World } from "./sim";

export interface Stats {
  robots: number;
  open: number;
  completed: number;
  throughput: number; // completed tasks per 100 ticks
  conflicts: number; // tasks currently double-assigned (consensus in flight)
}

export function render(ctx: CanvasRenderingContext2D, world: World): void {
  const { width, height } = world;

  ctx.fillStyle = "#0b0f14";
  ctx.fillRect(0, 0, width, height);

  const taskById = new Map(world.tasks.map((t) => [t.id, t]));

  // Open tasks: small squares.
  for (const task of world.tasks) {
    ctx.fillStyle = "#334155";
    ctx.fillRect(task.pos.x - 3, task.pos.y - 3, 6, 6);
  }

  // Assignment links: faint line from each robot to the task it is executing.
  for (const robot of world.robots) {
    if (robot.assigned === null) continue;
    const task = taskById.get(robot.assigned);
    if (!task) continue;
    ctx.strokeStyle = "rgba(148, 163, 184, 0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(robot.pos.x, robot.pos.y);
    ctx.lineTo(task.pos.x, task.pos.y);
    ctx.stroke();
  }

  // Robots: filled circle with a heading line in the robot's colour.
  for (const robot of world.robots) {
    ctx.fillStyle = robot.color;
    ctx.beginPath();
    ctx.arc(robot.pos.x, robot.pos.y, 5, 0, Math.PI * 2);
    ctx.fill();

    const speed = Math.hypot(robot.vel.x, robot.vel.y);
    if (speed > 0.01) {
      ctx.strokeStyle = robot.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(robot.pos.x, robot.pos.y);
      ctx.lineTo(
        robot.pos.x + (robot.vel.x / speed) * 10,
        robot.pos.y + (robot.vel.y / speed) * 10,
      );
      ctx.stroke();
    }
  }
}

export function computeStats(world: World): Stats {
  return {
    robots: world.robots.length,
    open: world.tasks.length,
    completed: world.completed,
    throughput: world.ticks > 0 ? (world.completed / world.ticks) * 100 : 0,
    conflicts: conflictCount(world),
  };
}
