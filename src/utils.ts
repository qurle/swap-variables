import { defaultUnfreezeRate, logs, maxUnfreezeRate, minUnfreezeRate } from './config'

let nodesToUnfreeze = defaultUnfreezeRate
const progressBar = {
    count: 10,
    indicators: [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'],
    filled: `█`,
    empty: `░`
}

// Got it from here https://www.figma.com/plugin-docs/api/properties/nodes-findall/
const typesWithChildren: NodeType[] = ['BOOLEAN_OPERATION', 'COMPONENT', 'COMPONENT_SET', 'FRAME', 'GROUP', 'INSTANCE', 'PAGE', 'SECTION']



export function getNodesToUnfreeze() {
    return nodesToUnfreeze
}

export function setNodesToUnfreeze(nodesCount = defaultUnfreezeRate) {
    nodesToUnfreeze = setRangedRandom(clamp(nodesCount, minUnfreezeRate, maxUnfreezeRate))
    return nodesToUnfreeze
}

export function setRangedRandom(average = defaultUnfreezeRate) {
    const bias = 10
    return getRandomInteger(average - bias, average + bias)
}

export function getRandomInteger(min: number, max: number): number {
    return Math.round(Math.floor(Math.random() * (max - min)) + min)
}

export function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max)
}

export function delay(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms)
    })
}

export function countChildren(nodes) {
    return nodes.reduce((accumulator,
        node) => {
        return typesWithChildren.includes(node.type) ? accumulator + node.findAll().length : accumulator
    }, 0
    ) + nodes.length
}

export function generateProgress(percent) {
    c(`Generating simple progress: ${percent}%`)
    const currentProgress = Math.floor(percent / progressBar.count)
    return progressBar.filled.repeat(currentProgress) + progressBar.empty.repeat(progressBar.count - currentProgress)
}

export function generateDetailedProgress(percent) {
    const currentProgress = Math.floor(percent / progressBar.count)
    const partlyFilled = progressBar.indicators[Math.round((percent % 10) / 10 * (progressBar.indicators.length - 1))]
    return '[' + progressBar.filled.repeat(currentProgress) + partlyFilled + progressBar.empty.repeat(Math.max(progressBar.count - currentProgress - 1, 0)) + ']'
}

// Let figma ui thread to take a little breath
export async function wakeUpMainThread(delay = 1000) {
    return await new Promise((resolve) => {
        setTimeout(resolve, delay)
    })
}

export function c(str: any = 'here', type?: 'error' | 'warn') {
    if (!logs)
        return
    switch (type) {
        case 'error':
            console.error(str)
            break
        case 'warn':
            console.warn(str)
            break
        default:
            console.log(str)
    }
}

// From https://github.com/figma-plugin-helper-functions/figma-plugin-helpers/blob/master/src/helpers/convertColor.ts
const namesRGB = ['r', 'g', 'b']
function figmaRGBToWebRGB(color: RGBA): webRGBA
function figmaRGBToWebRGB(color: RGB): webRGB
function figmaRGBToWebRGB(color): any {
    const rgb = []

    namesRGB.forEach((e, i) => {
        rgb[i] = Math.round(color[e] * 255)
    })

    if (color['a'] !== undefined) rgb[3] = Math.round(color['a'] * 100) / 100
    return rgb
}

export function figmaRGBToHex(color: RGB | RGBA): string {
    let hex = '#'

    const rgb = figmaRGBToWebRGB(color) as webRGB | webRGBA
    hex += ((1 << 24) + (rgb[0] << 16) + (rgb[1] << 8) + rgb[2]).toString(16).slice(1)

    if (rgb[3] !== undefined) {
        const a = Math.round(rgb[3] * 255).toString(16)
        if (a.length == 1) {
            hex += '0' + a
        } else {
            if (a !== 'ff') hex += a
        }
    }
    return hex
}

type webRGB = [number, number, number]
type webRGBA = [number, number, number, number]