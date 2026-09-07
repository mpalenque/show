import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { metrics, root } from './radiance-browser.mjs';

const directory = join(root, 'radiance-check', 'production');
const percentile = (list, q) => [...list].sort((a, b) => a - b)[Math.floor((list.length - 1) * q)];
const summaries = [];
for (let pass = 1; pass <= 3; pass++) {
  const file = join(directory, `pass-${pass}.json`);
  const result = JSON.parse(readFileSync(file, 'utf8'));
  const samples = result.samples.filter(s => s.time < 152.694);
  const first = samples[0], last = samples.at(-1);
  const windows = [];
  for (let second = 1; second < 152; second++) {
    const group = samples.filter(s => s.time >= second && s.time < second + 1);
    if (group.length > 1) windows.push({ second,
      stepsPerSecond: (group.at(-1).solverFrame - group[0].solverFrame) / (group.at(-1).time - group[0].time) });
  }
  let reused = 0, maxConsecutiveReused = 0, consecutive = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].solverFrame === samples[i - 1].solverFrame) { reused++; consecutive++; }
    else consecutive = 0;
    maxConsecutiveReused = Math.max(maxConsecutiveReused, consecutive);
  }
  result.summary = { pass, ...metrics(samples), activeSeconds: last.time - first.time,
    solverStepsPerSecond: (last.solverFrame - first.solverFrame) / (last.time - first.time),
    worstOneSecond: windows.sort((a, b) => a.stepsPerSecond - b.stepsPerSecond)[0],
    workerP95: percentile(samples.map(s => s.solverMs), .95), workerP99: percentile(samples.map(s => s.solverMs), .99),
    maxWorkerMs: Math.max(...samples.map(s => s.solverMs)),
    snapshotAgeP95: percentile(samples.map(s => s.age), .95), snapshotAgeP99: percentile(samples.map(s => s.age), .99),
    maxSnapshotAge: Math.max(...samples.map(s => s.age)), reused, maxConsecutiveReused,
    outliers: samples.filter(s => s.dt > 20) };
  summaries.push(result.summary);
  writeFileSync(file, JSON.stringify(result, null, 2));
}
const reportFile = join(directory, 'report.json');
const report = JSON.parse(readFileSync(reportFile, 'utf8'));
report.performance = summaries;
report.measurementNote = 'Se excluyen del rendimiento los frames que mantienen el cierre con física congelada después de 152,694 s.';
writeFileSync(reportFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(summaries, null, 2));
