const loadedFonts = [] as FontName[]
const loadedFontFamilies = [] as string[]

export async function loadFont(font: FontName) {
	if (loadedFonts.some(el => el.family === font.family && el.style === font.style))
		return

	await figma.loadFontAsync(font)
	loadedFonts.push(font)
}

export async function loadFontsByFamily(fontFamily: string, availableFonts: Font[]) {
	if (loadedFontFamilies.includes(fontFamily))
		return

	const fonts = availableFonts.filter(font => font.fontName.family === fontFamily)
	for (const font of fonts) {
		await figma.loadFontAsync(font.fontName)
	}
	loadedFontFamilies.push(fontFamily)
}

