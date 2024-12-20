// Show logs and timers
export const logs = false
export const timers = false
export const useMap = true

// Arrays of specific prooperties
export const complexProperties = ['fills', 'strokes', 'layoutGrids', 'effects']
export const typographyProperties = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'paragraphIndent']
export const mixedProperties = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textRangeFills']
export const affectingInitFont = ['characters', 'fontSize', 'fontName', 'textStyleId', 'textCase', 'textDecoration', 'letterSpacing', 'leadingTrim', 'lineHeight']
export const notAffectingFont = ['fills', 'fillStyleId', 'strokes', 'strokeWeight', 'strokeAlign', 'strokeStyleId']

// Regex
export const rCollectionId = /(VariableCollectionId:(?:\w|:)*)(?:\/[0-9]*:[0-9]*)?/
export const rVariableId = /(VariableId:(?:\w|:)*)(?:\/[0-9]*:[0-9]*)?/

export const uiSize = { width: 300, height: 340 }
