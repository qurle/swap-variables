import { error } from './errors'

interface Source {
	id: string,
	name: string
}

const loadedFonts = [] as FontName[]
const loadedFontFamilies = [] as string[]

export async function loadFont(font: FontName, source: Source) {
	if (loadedFonts.some(el => el.family === font.family && el.style === font.style))
		return

	try {
		await figma.loadFontAsync(font)
		loadedFonts.push(font)
	}
	catch {
		error('badFont', { name: `${font.family} ${font.style}`, nodeName: source.name, nodeId: source.id })
		return
	}
}

export async function loadFontsByFamily(fontFamily: string, availableFonts: Font[], source: Source) {
	if (loadedFontFamilies.includes(fontFamily))
		return

	const fonts = availableFonts.filter(font => font.fontName.family === fontFamily)
	for (const font of fonts) {
		try {
			await figma.loadFontAsync(font.fontName)
			loadedFonts.push(font.fontName)
		}
		catch {
			error('badFont', { name: `${font.fontName.family} ${font.fontName.style}`, nodeName: source.name, nodeId: source.id })
			return

		}
	}
	loadedFontFamilies.push(fontFamily)
}

