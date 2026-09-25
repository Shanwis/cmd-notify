# cmd-notify

A [Command Code](https://commandcode.ai) mod that pings you when the agent needs
you — so you can look away from the terminal during long runs.

Every notification is delivered twice: a notice row in the TUI feed and an OS
desktop notification (`notify-send` on Linux).

## What notifies

| Moment | Event | Message |
|---|---|---|
| A turn is over (each model round) | `turn_end` | `Turn 12 over — Refactored the auth handler` |
| The agent requires approval | `interaction_requested` (`kind: 'permission'`) | `Approval needed: write_file` |
| Plan / approval dialogs | `interaction_requested` (`kind: 'question'`) | `Your input is needed` |
| The agent finishes its task | `run_end` with `stopReason: 'end_turn'` | `Task finished after 8 turn(s) — All tests green` |
| The run stops abnormally (interrupt, denial, cutoff, hook) | `run_end` (other `stopReason`s) | `Run interrupted after 8 turn(s)` |
| The run fails (network / API) | `run_error` | `Run failed: Connection refused` |
| The connection stalls in the retry loop | `api_retry` | `Connection trouble — retrying` |

Every run ending pings, worded by its cause — interruptions, permission denials,
max-turn cutoffs, hook stops, and network/API failures included. The run-ending
ping replaces the final turn's ping, so only one pops. Connection stalls ping at
most once per minute; when retries are exhausted the failure ping reports
`Run failed: …` instead of the generic stop message.

Turn and finish pings carry a short summary of the turn's output — the
assistant's text (or its tool calls when it wrote nothing), collapsed to one
line and capped at 100 characters.

## Install

From GitHub (user scope):

```bash
cmd mods add -g shanwis/cmd-notify
```

From a local checkout (referenced in place — edits apply on `/reload`):

```bash
cmd mods add -g ./cmd-notify
```

Then start a new session, or run `/reload` in the current one. Verify with
`cmd mods list` — the mod must appear with no load warnings.

## Notes

- No build step: Command Code loads the TypeScript directly via jiti.
- Desktop notifications are Linux-only for now; macOS support is planned for a
  later release.
- Desktop notifications are fire-and-forget; if `notify-send` is unavailable the
  TUI notice still renders.
- Desktop notifications carry the Command Code logo icon from
  `images/commandcodelogo.png`, which must ship alongside the mod file.
- `interaction_requested` is emitted on the agent event bus but is not yet in the
  documented `AgentEvent` type union, so the mod subscribes through a loose cast.

## License

MIT
