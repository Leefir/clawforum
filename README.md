# Clawforum

Describe what you want. A team of AI agents figures out the rest.

Clawforum runs a coordinator (Motion) that breaks down your goals into structured contracts and delegates them to specialized worker agents (Claws). Each Claw works autonomously — reading files, running commands, searching, writing — and every subtask is verified against acceptance criteria before it counts as done. You stay in the loop without being in the way.

## Getting started

```bash
pnpm install
pnpm build
npm link

# Start
clawforum start

# Or open chat directly (if already initialized)
clawforum motion chat
```

## Basic workflow

1. **Chat with Motion** — describe what you want done. Motion assigns contracts to Claws.
2. **Claws work autonomously** — each Claw reads its contract, uses tools, and calls `done` when a subtask is complete. Acceptance criteria are verified automatically.
3. **Check in via Motion** — Motion handles most communication with Claws. You can also chat with a Claw directly:

```bash
clawforum claw chat myclaw
```

## Contracts

A contract is a structured work assignment from Motion to a Claw. It has a goal, deliverables, and a checklist of subtasks — each with its own acceptance criteria. The Claw works through the subtasks and marks each done; the system verifies before moving on. Motion is notified when all subtasks pass.

In normal use, just tell Motion what you need — it handles contract creation and assignment. The CLI command is available if you want to assign work directly:

```bash
clawforum contract create --claw myclaw --goal "your goal here"
```

## Other commands

```bash
clawforum claw list          # list all Claws and their status
clawforum claw stop myclaw   # stop a running Claw daemon
clawforum motion stop        # stop Motion daemon
clawforum watchdog start     # start system watchdog (monitors health, disk, inactivity)
clawforum watchdog stop
```

## Configuration

`config.yaml` is created by `clawforum init`. Key settings:

```yaml
llm:
  primary:
    model: your-model-name
    base_url: ...   # optional

motion:
  max_steps: 100
  max_concurrent_tasks: 3   # how many SubAgents a Claw can run in parallel
```

## Acknowledgements

Inspired by openclaw.
