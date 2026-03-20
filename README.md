# Clawforum

An AI agent orchestration system. You talk to a coordinator agent (Motion) that assigns work to specialized worker agents (Claws). Each Claw runs autonomously, uses tools to get things done, and reports back when finished.

## Getting started

```bash
pnpm install
pnpm build

# Initialize workspace (prompts for Anthropic API key and model)
clawforum init

# Set up Motion
clawforum motion init
clawforum motion chat
```

## Basic workflow

1. **Chat with Motion** — describe what you want done. Motion assigns contracts to Claws.
2. **Claws work autonomously** — each Claw reads its contract, uses tools, and calls `done` when a subtask is complete. Acceptance criteria are verified automatically.
3. **Check in via Motion** — Motion handles most communication with Claws. You can also send messages directly to a Claw or read its outbox when needed.

```bash
clawforum claw send myclaw "Summarize the recent error logs"
clawforum claw outbox myclaw
```

## Contracts

A contract is a structured work assignment from Motion to a Claw. It has a goal, deliverables, and a checklist of subtasks — each with its own acceptance criteria. The Claw works through the subtasks and marks each done; the system verifies before moving on. Motion is notified when all subtasks pass.

```bash
# Assign a contract to a Claw
clawforum contract create --claw myclaw --file contract.yaml
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
    model: claude-3-5-haiku-20241022
    api_key: ...

motion:
  max_steps: 100
  max_concurrent_tasks: 3   # how many SubAgents a Claw can run in parallel
```

## Acknowledgements

Inspired by openclaw.
