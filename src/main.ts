// Browser entry: wires the canvas, controls, and RAF loop to the pure sim.
import { createWorld, setRobotCount, step, DEFAULT_PARAMS, type World } from "./sim";
import { render, computeStats } from "./render";

const SIM_W = 800;
const SIM_H = 600;

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const robotRange = document.getElementById("robots") as HTMLInputElement;
const robotLabel = document.getElementById("robots-val") as HTMLSpanElement;
const speedRange = document.getElementById("speed") as HTMLInputElement;
const speedLabel = document.getElementById("speed-val") as HTMLSpanElement;
const commRange = document.getElementById("comm") as HTMLInputElement;
const commLabel = document.getElementById("comm-val") as HTMLSpanElement;
const seedInput = document.getElementById("seed") as HTMLInputElement;
const pauseBtn = document.getElementById("pause") as HTMLButtonElement;
const resetBtn = document.getElementById("reset") as HTMLButtonElement;

const statRobots = document.getElementById("s-robots") as HTMLSpanElement;
const statOpen = document.getElementById("s-open") as HTMLSpanElement;
const statDone = document.getElementById("s-done") as HTMLSpanElement;
const statTput = document.getElementById("s-tput") as HTMLSpanElement;
const statConf = document.getElementById("s-conf") as HTMLSpanElement;

let world: World;
let paused = false;

function currentSeed(): number {
  const n = parseInt(seedInput.value, 10);
  return Number.isFinite(n) ? n : 1;
}

function reset(): void {
  world = createWorld(SIM_W, SIM_H, {
    ...DEFAULT_PARAMS,
    robotCount: parseInt(robotRange.value, 10),
    speed: parseFloat(speedRange.value),
    commRange: parseInt(commRange.value, 10),
  }, currentSeed());
}

function setupCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = SIM_W * dpr;
  canvas.height = SIM_H * dpr;
  canvas.style.width = `${SIM_W}px`;
  canvas.style.height = `${SIM_H}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

robotRange.addEventListener("input", () => {
  robotLabel.textContent = robotRange.value;
  setRobotCount(world, parseInt(robotRange.value, 10));
});

speedRange.addEventListener("input", () => {
  speedLabel.textContent = parseFloat(speedRange.value).toFixed(1);
  world.params.speed = parseFloat(speedRange.value);
});

commRange.addEventListener("input", () => {
  commLabel.textContent = commRange.value;
  world.params.commRange = parseInt(commRange.value, 10);
});

pauseBtn.addEventListener("click", () => {
  paused = !paused;
  pauseBtn.textContent = paused ? "Resume" : "Pause";
});

resetBtn.addEventListener("click", reset);
seedInput.addEventListener("change", reset);

function frame(): void {
  if (!paused) {
    // Several steps per frame so motion reads as continuous flow.
    for (let i = 0; i < 3; i++) step(world);
  }
  render(ctx, world);

  const s = computeStats(world);
  statRobots.textContent = String(s.robots);
  statOpen.textContent = String(s.open);
  statDone.textContent = String(s.completed);
  statTput.textContent = s.throughput.toFixed(2);
  statConf.textContent = String(s.conflicts);

  requestAnimationFrame(frame);
}

setupCanvas();
robotLabel.textContent = robotRange.value;
speedLabel.textContent = parseFloat(speedRange.value).toFixed(1);
commLabel.textContent = commRange.value;
reset();
requestAnimationFrame(frame);
