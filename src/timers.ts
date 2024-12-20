import { timers } from './config'
import { state } from './state'

const times: Map<string, number> = new Map()

export const time = {
	swappingSimpleTime: 0,
	swappingComplexTime: 0,
	boundingComplexTime: 0,
	findingTime: 0,
	layerCount: 0,
}

export function timeStart(str: string): number {
	if (!timers) return 0
	const time = Date.now()
	times.set(str, time)
	return time
}

export function timeEnd(str: string, show = timers): number {
	if (!timers) return 0
	const time = Date.now() - times.get(str)
	if (show) console.log(`⏱️ ${str}: ${time} ms`)
	times.delete(str)
	return time
}

export function showTimers() {
	if (!timers) return
	console.log(`⏱️ Swapping simple: ${time.swappingSimpleTime} `)
	console.log(`⏱️ Bounding complex: ${time.boundingComplexTime} `)
	console.log(`Time per layer: ${Math.round(time.boundingComplexTime / time.layerCount)} `)
	console.log(`⏱️ Swapping complex: ${time.swappingComplexTime} `)
	console.log(`Time per layer: ${Math.round(time.swappingComplexTime / time.layerCount)} `)
	console.log(`⏱️ Finding: ${time.findingTime} `)
	console.log(`Time per property: ${Math.round(time.findingTime / state.variablesProcessed)} `)
	for (const key in time) {
		if (key.startsWith('-'))
			console.log(`⏱️ ${key}: ${time[key]} `)
	}
	clearTimers()
}

export function timeAdd(key: string) {
	const systemKey = '-' + key
	if (time[systemKey] === undefined) time[systemKey] = 0
	time[systemKey] += timeEnd(key, false)
}

export function clearTimers() {
	Object.keys(time).forEach(key => {
		time[key] = 0
	})
}