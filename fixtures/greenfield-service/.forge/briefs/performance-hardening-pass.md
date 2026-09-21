<!-- forge:generated v=0.0.0 hash=b517f879e639a29a852e756a395f0e5c9146d686336892e51917de4fd0fe6135 — edits will be overwritten; use overrides/ -->
Measure the stage against its performance and reliability requirements and file every miss as a
defect. Measure first; do not tune. A later step fixes what you file, and `G-Stable` will not pass
while a Sev1 or Sev2 defect is open.

### Inputs

This step declares no inputs. Read the NFRs enforced at this stage (latency percentiles, throughput,
resource limits, availability and recovery targets) and each one's `verification` reference, the
architecture spec's stated failure mode per component boundary, the SLOs if any exist, the benchmark
and load-test tooling already in the repository, and the existing reports under
`docs/forge/reports/`.

### Method

For each performance NFR, run or design the benchmark that its own statement describes: the same
load, data volume, percentile and environment. If a benchmark exists, use it rather than writing an
easier one. If your grant does not let you run a benchmark, give the exact command and the
conditions, mark it not run, and list that NFR as unmeasured in your final summary. An NFR you could
not measure is not a Defect and must not disappear: record it as an `OpenQuestion` with status
`open`, naming the NFR and the exact command to run, so `G-Stable`'s open-questions policy keeps the
gate closed until someone measures it (raise it with `FORGE_ASK:` if you cannot write that
register), and list it in your final summary too. Record the method with the result: hardware or
environment, data size, warm-up, run count and the seed, so the result reproduces. Where a target is
missed, find where the time or resource goes (profile, flame graph, query plans, allocation) before
naming a cause.

Then check reliability against the failure modes the architecture states for each boundary:

- every outbound call has a timeout, and retries are bounded, use backoff and are safe to repeat;
- overload behaviour: bounded queues and pools, back-pressure, and no unbounded growth in memory,
  connections or files;
- dependency failure: what the system does when a dependency is slow or down, and that it degrades
  as the design says;
- recovery: startup and restart behaviour, and that a rollback or restart does not lose or duplicate
  data.

### Produce

`Defect` records, one per distinct finding (many, possibly none), with the standard front matter and
`status: open` (the gate counts only that literal value as open, so a finding must start there).

- `observed` is the measured value with its conditions, and `expected` is the NFR's target;
- `evidence` names the benchmark command, the report path and, where relevant, the profile;
- `affected` lists stories or capabilities;
- `first_seen`, `frequency` and `environment`: the date, how often the miss occurs across your runs,
  and where it was measured;
- `severity`: no spec fixes the scale, so treat this as a heuristic and follow any severity policy
  in the KB's `constraints/**` first. Absent one, a measured miss on an NFR enforced at this stage
  (its `nfr_subset`) is at least Sev2, since `G-Stable` exists to hold the stage on such misses;
  reserve Sev3 and Sev4 for reliability gaps no NFR covers and for thin margins. Give the reason for
  each assignment.

For each NFR, whether it passed or failed, note the measured value in the defect or in your final
summary, so a reader sees what was measured, not only what failed.

### Do not

- Do not change code, configuration or the NFR targets, and do not fix anything you find.
- Do not report a result from a benchmark that differs from the NFR's stated conditions without
  saying so.
- Do not file a speculative optimisation as a defect. A defect is a measured miss or a demonstrated
  failure mode.
