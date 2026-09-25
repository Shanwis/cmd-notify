// Mod: cmd-notify — pings you when a turn is over, when the agent needs approval,
// and when the agent finishes its task. Every ping shows as a TUI notice and as
// an OS desktop notification (notify-send on Linux; macOS support is deferred
// to a later release). The desktop notification carries the Command Code logo
// from images/.
//
// Signal map:
//   turn_end                 -> each model round finished ("a turn is over")
//   interaction_requested -> the agent is waiting on the user: tool permission
//                             prompts (kind 'permission') and plan/approval
//                             dialogs (kind 'question')
//   run_end                   -> only stopReason 'end_turn' counts as "task
//                             finished"; interrupts/denials/max_turns do not

import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import type {ModApi} from '@commandcode/harness';

const TITLE = 'Command Code';
const ICON_PATH = fileURLToPath(
	new URL('./images/commandcodelogo.png', import.meta.url),
);
const hasIcon = existsSync(ICON_PATH);

// `interaction_requested` is emitted on the agent event bus but is missing from
// the documented AgentEvent type union, so subscribe through a loose alias.
type LooseOn = (
	event: string,
	handler: (event: any) => void,
) => {dispose(): void};

function desktopNotify(cmd: ModApi, message: string): void {
	if (process.platform === 'linux') {
		const args = hasIcon
			? ['--icon', ICON_PATH, TITLE, message]
			: [TITLE, message];
		cmd.exec({command: 'notify-send', args}).catch(() => {});
	}
}

function notify(cmd: ModApi, message: string): void {
	cmd.ui.notify(message);
	desktopNotify(cmd, message);
}

// A natural finish fires turn_end for the final turn right before the run ends,
// which would double-ping. Hold the turn ping behind a short timer and drop it
// once the run is known to be finishing (onStop / run_end) in favor of the
// finish ping. If another mod force-continues the run, the dropped ping is
// restored on the next turn_start.
const TURN_NOTICE_DELAY_MS = 500;

let pendingTurn: {timer: ReturnType<typeof setTimeout>; message: string} | undefined;
let droppedTurn: string | undefined;

function scheduleTurnNotice(cmd: ModApi, message: string): void {
	if (pendingTurn) {
		clearTimeout(pendingTurn.timer);
		notify(cmd, pendingTurn.message);
	}
	pendingTurn = {
		timer: setTimeout(() => {
			pendingTurn = undefined;
			notify(cmd, message);
		}, TURN_NOTICE_DELAY_MS),
		message,
	};
}

function dropTurnNotice(): void {
	if (!pendingTurn) return;
	clearTimeout(pendingTurn.timer);
	droppedTurn = pendingTurn.message;
	pendingTurn = undefined;
}

function restoreTurnNotice(cmd: ModApi): void {
	if (pendingTurn) {
		clearTimeout(pendingTurn.timer);
		notify(cmd, pendingTurn.message);
		pendingTurn = undefined;
	}
	if (droppedTurn) {
		notify(cmd, droppedTurn);
		droppedTurn = undefined;
	}
}

export default function (cmd: ModApi): void {
	cmd.on('turn_end', event => {
		if (event.type !== 'turn_end') return;
		scheduleTurnNotice(cmd, `Turn ${event.turnNumber} over`);
	});

	cmd.on('turn_start', event => {
		if (event.type !== 'turn_start') return;
		restoreTurnNotice(cmd);
	});

	cmd.hooks({
		onStop: () => {
			dropTurnNotice();
			return undefined;
		},
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
		dropTurnNotice();
		droppedTurn = undefined;
		notify(cmd, `Task finished after ${result.turnCount} turn(s)`);
	});
}
