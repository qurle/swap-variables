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

export function delay(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}

function showWorkingNotification(msgArray, noficationArray, notificatonId) {
    const workingWord = msgArray[Math.floor(Math.random() * msgArray.length)]
    const ntfAmount = 6
    const ntfLoopDuration = 1000
    const ntfTimeout = ntfAmount / ntfLoopDuration
    const ntfDelay = ntfTimeout / ntfAmount
    noficationArray.push(setInterval(() => notificatonId = figma.notify(`🕛  ${workingWord}`, { timeout: ntfTimeout }), ntfTimeout))
    delay(ntfDelay).then(() => noficationArray.push(setInterval(() => notificatonId = figma.notify(`🕑  ${workingWord}`, { timeout: ntfTimeout }), ntfTimeout)))
    delay(ntfDelay).then(() => noficationArray.push(setInterval(() => notificatonId = figma.notify(`🕓  ${workingWord}`, { timeout: ntfTimeout }), ntfTimeout)))
    delay(ntfDelay).then(() => noficationArray.push(setInterval(() => notificatonId = figma.notify(`🕕  ${workingWord}`, { timeout: ntfTimeout }), ntfTimeout)))
    delay(ntfDelay).then(() => noficationArray.push(setInterval(() => notificatonId = figma.notify(`🕗  ${workingWord}`, { timeout: ntfTimeout }), ntfTimeout)))
    delay(ntfDelay).then(() => noficationArray.push(setInterval(() => notificatonId = figma.notify(`🕙  ${workingWord}`, { timeout: ntfTimeout }), ntfTimeout)))
}

function stopWorkingNotification(noficationArray, notificatonId) {
    noficationArray.forEach(interval => clearInterval(interval))
    noficationArray = []
    notificatonId.cancel()
}

function countAll() {
    return figma.currentPage.findAll.length;
}  