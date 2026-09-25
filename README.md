# cmd-notify

A [Command Code](https://commandcode.ai) mod that pings you when the agent needs
you — so you can look away from the terminal during long runs.

Every notification is delivered twice: a notice row in the TUI feed and an OS
desktop notification (`notify-send` on Linux, `osascript` on macOS).

## What notifies

| Moment | Event | Message |
|---|---|---|
| A turn is over (each model round) | `turn_end` | `Turn 12 over` |
| The agent requires approval | `interaction_requested` (`kind: 'permission'`) | `Approval needed: write_file` |
| Plan / approval dialogs | `interaction_requested` (`kind: 'question'`) | `Your input is needed` |
| The agent finishes its task | `run_end` with `stopReason: 'end_turn'` | `Task finished after 8 turn(s)` |

Interrupted runs, permission denials, and max-turn cutoffs stay silent — only a
natural completion counts as "task finished".

## Install

From GitHub (user scope):

```bash
cmd mods add -g <your-github-user>/cmd-notify
```

From npm:

```bash
cmd mods add -g cmd-notify
```

From a local checkout (referenced in place — edits apply on `/reload`):

```bash
cmd mods add -g ./cmd-notify
```

Then start a new session, or run `/reload` in the current one. Verify with
`cmd mods list` — the mod must appear with no load warnings.

## Notes

- No build step: Command Code loads the TypeScript directly via jiti.
- Desktop notifications are fire-and-forget; if `notify-send` is unavailable the
  TUI notice still renders.
- `interaction_requested` is emitted on the agent event bus but is not yet in the
  documented `AgentEvent` type union, so the mod subscribes through a loose cast.

## License

MIT
