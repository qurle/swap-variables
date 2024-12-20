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
	console.log(`⏱️ Swapping simple: ${time.swappingSimpleTime} ms`)
	console.log(`⏱️ Bounding complex: ${time.boundingComplexTime} ms`)
	console.log(`Time per layer: ${Math.round(time.boundingComplexTime / time.layerCount)} ms`)
	console.log(`⏱️ Swapping complex: ${time.swappingComplexTime} ms`)
	console.log(`Time per layer: ${Math.round(time.swappingComplexTime / time.layerCount)} ms`)
	console.log(`⏱️ Finding: ${time.findingTime} ms`)
	console.log(`Time per property: ${Math.round(time.findingTime / state.variablesProcessed)} ms`)
	for (const key in time) {
		if (key.startsWith('-'))
			console.log(`⏱️ ${key.replace('-', '')}: ${time[key]} ms`)
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