<!-- forge:generated v=0.0.0 hash=e38529c62bb6641995a6686fe0dc82f930458b08841d1b7644ac54e1f4ac0aff — edits will be overwritten; use overrides/ -->
### Specialisation for scaffolding a project

Decide first, then generate: the repository-strategy decision already exists, so implement it
exactly, and take the rest in this order: layout, build specification, scaffold. Do not generate
files before the decisions that shape them are in front of you.

1. Read the architecture specification, the repository-strategy record and the constraints in the KB
   before generating anything. The language, runtime, hosting and compliance constraints are inputs,
   not preferences; if the stack is not yet decided, do not decide it here, raise it to the
   architect.
2. Layout specification: map every architectural component to a directory, with its purpose, owner
   role, and allowed dependencies. Check that two components which will be built in parallel do not
   share a directory; overlapping ownership globs will cause conflicts later. If the architecture
   has layering rules, specify the check that enforces them.
3. Build specification: define the commands the scaffold brief lists, including the base commands,
   the verification target, the per-layer test commands and the preflight command, and give the CI
   equivalent of each. They must be the same commands. Specify pinned versions for the runtime and
   package manager and how the lockfile is enforced.
4. Scaffold: everything the scaffold brief lists is required, including the definition-of-done
   profiles the readiness gate depends on, and nothing beyond it; a clean clone must install, build,
   and pass real tests through the documented commands. Do not add packages, services, or
   infrastructure the architecture has not asked for.
5. If the repository already has content, reconcile instead of overwriting: list what exists, what
   conflicts with your layout, and what you left alone, and propose changes to existing files rather
   than making them silently.
6. Document the base commands and the layout in the build and layout specifications you own, create
   the README the scaffold brief asks for (the commands, with a pointer to the pipeline
   documentation for deployment, which is the SRE role's; narrative documentation is the technical
   writer's), and create the environment example file that documents every variable.

In your handoff to the CI skeleton step and to the engineers, include: the commands and what each
must produce, the constraints they must respect (for example, no new language runtime without a
recorded decision), and acceptance checks that can be run from a clean clone.

Common mistakes: commands that differ between local and CI; unpinned tool versions; hooks that need
a global install; generated files whose commit-or-ignore status is undecided; a scaffold that
includes example code with placeholder returns; an ambitious layout that anticipates services that
do not exist yet; a test command that runs zero tests and reports success.
