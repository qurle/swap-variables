import { error, errors, gotErrors } from './errors';
import { state } from './state';
import { time, timeEnd as te, timeStart as ts, timeAdd as ta } from './timers';
import { MessageEntity, ProgressOptions } from './types';
import { c, countChildren, generateProgress, random } from './utils';

const actionMsgs = ["Affected", "Updated"]
const idleMsgs = ["No variables swapped", "Nothing changed", "Any layers to affect? Can't see it", "Nothing to do"]

let showProgress = true

let prevProgressNotification: NotificationHandler
let progressNotification: NotificationHandler
let progressNotificationTimeout: number

export let currentNotification = null as NotificationHandler

export function notify(text: string, options: NotificationOptions = {}, clearProgress = true) {
	if (clearProgress) {
		stopProgressNotification()
	}
	if (currentNotification != null) {
		currentNotification.cancel()
	}
	currentNotification = figma.notify(text, options)
}

export async function initProgressNotification(nodesAmount, progressOptions: ProgressOptions) {
	state.nodesProcessed = 0

	showProgress = true
	c(`Initiating progress notification`)
	// if (progressOptions.scope !== 'allPages')
	showProgressNotification(progressOptions)
}

export function showWorkingNotification() {
	currentNotification = figma.notify('Working...', { timeout: Infinity })

}

export async function showProgressNotification(progressOptions: ProgressOptions) {
	c(`Showing work notification`)


	const timeout = progressOptions.scope === 'allPages' ? 2000 : 500
	let message: string;
	(function loop(options = progressOptions) {
		if (showProgress) {
			ts('showingProgress')
			c(`Options ↴`)
			c(options)
			switch (options.scope) {
				case 'allPages':
					message = `Page ${state.currentPage} of ${options.pageAmount}. Processing node ${state.nodesProcessed} of ${state.nodesAmount}  ${generateProgress(Math.round(state.currentPage / options.pageAmount * 100))}`
					break
				case 'styles':
					message = `Processing style ${state.nodesProcessed} of ${state.nodesAmount}  ${generateProgress(Math.round(state.nodesProcessed / state.nodesAmount * 100))}`
					break
				case 'aliases':
					message = `Processing variable ${state.nodesProcessed} of ${state.nodesAmount}  ${generateProgress(Math.round(state.nodesProcessed / state.nodesAmount * 100))}`
					break
				default:
					message = `Processing node ${state.nodesProcessed} of ${state.nodesAmount}  ${generateProgress(Math.round(state.nodesProcessed / state.nodesAmount * 100))}`
					break
			}
			prevProgressNotification = progressNotification
			progressNotification = figma.notify(message, { timeout: timeout + 50 })
			setTimeout(() => prevProgressNotification?.cancel(), 100)
			progressNotificationTimeout = setTimeout(() => { loop(progressOptions) }, timeout);
			ta('showingProgress')
		}
	})();
}

export function stopProgressNotification() {
	showProgress = false
	prevProgressNotification?.cancel()
	progressNotification?.cancel()
	if (progressNotificationTimeout)
		clearTimeout(progressNotificationTimeout)

}

export function showFinishNotification(customMessage?: string) {
	if (customMessage) {
		notify(customMessage)
		return
	}

	const errorCount = Object.values(errors).reduce((acc, err) => acc + err.length, 0)
	const errorMsg = gotErrors ? `Got ${errorCount} error${errorCount === 1 ? "." : "s."} ` : ''

	const entity: MessageEntity = (() => {
		switch (state.currentScope) {
			case 'styles':
				return {
					application: {
						single: 'property',
						plural: 'properties'
					},
					preposition: 'of',
					object: {
						single: 'style',
						plural: 'styles'
					},
				}
			case 'aliases':
				return {
					application: {
						single: 'link',
						plural: 'links'
					},
					preposition: 'in',
					object: {
						single: 'variable',
						plural: 'variables'
					},
				}
			default:
				return {
					application: {
						single: 'property',
						plural: 'properties'
					},
					preposition: 'of',
					object: {
						single: 'layer',
						plural: 'layers'
					},
				}
		}
	})()

	const objects = state.nodesProcessed === 1 ? entity.object.single : entity.object.plural
	const applications = state.variablesProcessed === 1 ? entity.application.single : entity.application.plural

	let msg = state.variablesProcessed === 0 ?
		`${random(idleMsgs)}. Checked ${state.nodesProcessed} ${objects}` :
		`${random(actionMsgs)} ${state.variablesProcessed} ${applications} ${entity.preposition} ${state.nodesAmount} ${objects}`

	notify(`${msg} ${errorMsg}`)
}

export function clearNotifications() {
	currentNotification?.cancel()
}