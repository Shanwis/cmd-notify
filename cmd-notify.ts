// Mod: cmd-notify — pings you when a turn is over, when the agent needs approval,
// and when the agent finishes its task. Every ping shows as a TUI notice and as
// an OS desktop notification (notify-send on Linux; macOS support is deferred
// to a later release). The desktop notification carries the Command Code logo
// from images/.
//
// Signal map:
//   message_end              -> captures the round's output for the turn summary
//   turn_end                 -> each model round finished ("a turn is over",
//                             summarized with the round's output)
//   interaction_requested -> the agent is waiting on the user: tool permission
//                             prompts (kind 'permission') and plan/approval
//                             dialogs (kind 'question')
//   run_start                 -> resets per-run ping state
//   run_end                   -> run over, worded by stopReason: 'end_turn'
//                             finishes the task; interrupted/max_turns/
//                             permission_denied/terminate/stop_hook stop it
//                             abnormally; unknown reasons get a generic line
//   run_error                 -> non-retryable failure (network/API): "Run failed"
//   api_retry                 -> connection trouble, at most one ping per minute

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

function endMessage(stopReason: string, turnCount: number): string {
	switch (stopReason) {
		case 'end_turn':
			return `Task finished after ${turnCount} turn(s)`;
		case 'interrupted':
			return `Run interrupted after ${turnCount} turn(s)`;
		case 'max_turns':
			return `Hit max turns after ${turnCount} turn(s)`;
		case 'permission_denied':
			return 'Stopped: permission denied';
		case 'terminate':
			return 'Stopped by a tool hook';
		case 'stop_hook':
			return `Stopped early after ${turnCount} turn(s)`;
		default:
			return `Run ended (${stopReason}) after ${turnCount} turn(s)`;
	}
}

// The summary is the turn's own output: assistant text first, tool names as
// fallback for tool-only turns. Collapsed to one line and capped.
const SUMMARY_MAX_CHARS = 100;

function summarize(content: unknown): string | undefined {
	const blocks: unknown[] = Array.isArray(content) ? content : [content];
	const texts: string[] = [];
	const tools: string[] = [];
	for (const block of blocks) {
		if (typeof block === 'string') {
			texts.push(block);
		} else if (block && typeof block === 'object') {
			const {text, name} = block as {text?: unknown; name?: unknown};
			if (typeof text === 'string') texts.push(text);
			else if (typeof name === 'string') tools.push(name);
		}
	}
	const source = texts.length > 0 ? texts.join(' ') : tools.join(', ');
	const line = source.replace(/\s+/g, ' ').trim();
	if (!line) return undefined;
	return line.length > SUMMARY_MAX_CHARS
		? `${line.slice(0, SUMMARY_MAX_CHARS)}…`
		: line;
}

let turnOutput: unknown;

// A run ends through two channels (run_error may precede run_end): ping once
// per run, and always swallow the final turn's ping in favor of the
// run-ending one.
let runPinged = false;

function finishRun(cmd: ModApi, message: string): void {
	dropTurnNotice();
	droppedTurn = undefined;
	if (runPinged) return;
	runPinged = true;
	notify(cmd, message);
}

// api_retry can fire repeatedly while the connection is down - one ping per
// minute at most.
const RETRY_PING_INTERVAL_MS = 60_000;
let lastRetryPingAt = 0;

export default function (cmd: ModApi): void {
	cmd.on('message_end', event => {
		if (event.type !== 'message_end') return;
		turnOutput = event.content;
	});

	cmd.on('turn_end', event => {
		if (event.type !== 'turn_end') return;
		const summary = summarize(turnOutput);
		turnOutput = undefined;
		scheduleTurnNotice(
			cmd,
			`Turn ${event.turnNumber} over${summary ? ` — ${summary}` : ''}`,
		);
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

	cmd.on('run_start', event => {
		if (event.type !== 'run_start') return;
		runPinged = false;
		lastRetryPingAt = 0;
		turnOutput = undefined;
	});

	cmd.on('run_error', event => {
		if (event.type !== 'run_error') return;
		const error = (event as {error?: unknown}).error;
		const text =
			typeof error === 'string'
				? error
				: ((error as {message?: string} | undefined)?.message ??
					'unknown error');
		finishRun(cmd, `Run failed: ${text.split('\n')[0].slice(0, 120)}`);
	});

	cmd.on('api_retry', event => {
		if (event.type !== 'api_retry') return;
		const now = Date.now();
		if (now - lastRetryPingAt < RETRY_PING_INTERVAL_MS) return;
		lastRetryPingAt = now;
		notify(cmd, 'Connection trouble — retrying');
	});

	cmd.on('run_end', event => {
		if (event.type !== 'run_end') return;
		const {result} = event;
		const message = endMessage(result.stopReason, result.turnCount);
		const summary = summarize(result.finalText);
		finishRun(cmd, summary ? `${message} — ${summary}` : message);
	});
}
