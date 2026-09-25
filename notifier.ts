// Mod: notifier — pings you when a turn is over, when the agent needs approval,
// and when the agent finishes its task. Every ping shows as a TUI notice and as
// an OS desktop notification (notify-send on Linux, osascript on macOS).
//
// Signal map:
//   turn_end                 -> each model round finished ("a turn is over")
//   interaction_requested -> the agent is waiting on the user: tool permission
//                             prompts (kind 'permission') and plan/approval
//                             dialogs (kind 'question')
//   run_end                   -> only stopReason 'end_turn' counts as "task
//                             finished"; interrupts/denials/max_turns do not

import type {ModApi} from '@commandcode/harness';

const TITLE = 'Command Code';

// `interaction_requested` is emitted on the agent event bus but is missing from
// the documented AgentEvent type union, so subscribe through a loose alias.
type LooseOn = (
	event: string,
	handler: (event: any) => void,
) => {dispose(): void};

function desktopNotify(cmd: ModApi, message: string): void {
	if (process.platform === 'linux') {
		cmd.exec({command: 'notify-send', args: [TITLE, message]}).catch(() => {});
	} else if (process.platform === 'darwin') {
		const quoted = (text: string) => JSON.stringify(text);
		cmd.exec({
			command: 'osascript',
			args: [
				'-e',
				`display notification ${quoted(message)} with title ${quoted(TITLE)}`,
			],
		}).catch(() => {});
	}
}

function notify(cmd: ModApi, message: string): void {
	cmd.ui.notify(message);
	desktopNotify(cmd, message);
}

export default function (cmd: ModApi): void {
	cmd.on('turn_end', event => {
		if (event.type !== 'turn_end') return;
		notify(cmd, `Turn ${event.turnNumber} over`);
	});

	const onLoose = cmd.on.bind(cmd) as unknown as LooseOn;
	onLoose('interaction_requested', event => {
		if (event.kind === 'permission') {
			notify(cmd, `Approval needed: ${event.toolName}`);
		} else if (event.kind === 'question') {
			notify(cmd, 'Your input is needed');
		}
	});

	cmd.on('run_end', event => {
		if (event.type !== 'run_end') return;
		const {result} = event;
		if (result.stopReason !== 'end_turn') return;
		notify(cmd, `Task finished after ${result.turnCount} turn(s)`);
	});
}
