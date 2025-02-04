import { Errors } from './types'
import { c } from './utils'

export let gotErrors = false
export let errorCount = 0
export const errors = {
	limitation: [],
	noMatch: [],
	mixed: [],
	badProp: [],
	unsupported: [],
	noVariable: [],
	badFont: [],
} as Errors

type ErrorType = 'limitation' | 'noMatch' | 'mixed' | 'badProp' | 'unsupported' | 'noVariable' | 'badFont'

export function error(type: ErrorType, options) {
	gotErrors = true
	c(`Encountered error: ${type} ↴`)
	c(options)
	if (!errors[type])
		errors[type] = new Array()

	// Exceptions (don't write same errors)
	switch (type) {
		case 'noMatch':
			if (errors[type].findIndex(el => el.name === options.name) >= 0)
				return
			break
		case 'mixed':
			if (errors[type].findIndex(el => el.nodeId === options.nodeId) >= 0)
				return
			break
		case 'badProp':
			if (errors[type].findIndex(el => el.nodeId === options.nodeId && el.property === options.property) >= 0)
				return
			break
		case 'badFont':
			if (errors[type].findIndex(el => el.name === options.name) >= 0)
				return
			break
		case 'unsupported':
			if (errors[type].findIndex(el => el.nodeId === options.nodeId && el.property === options.property) >= 0)
				return
			break
		case 'noVariable':
			if (errors[type].findIndex(el => el.nodeId === options.nodeId && el.variableId === options.variableId) >= 0)
				return
			break
	}
	errors[type].push(options)
	errorCount++
	c(`Can't swap ${type === 'noMatch' ? `variable ${options.name} for ` : `${options.property} of ${options.nodeName}`}: ${type}`, 'error')
}

export function clearErrors() {
	gotErrors = false
	errorCount = 0
	Object.keys(errors).forEach(key => {
		errors[key] = []
	})
}