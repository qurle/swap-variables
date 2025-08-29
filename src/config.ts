// Show logs and timers
export const logs = true
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

// Unfreezing every 20% of nodes / styles amount, clamped between 50 and 500 by default
export const unfreezePercentage = 0.2
// If whole nodes / styles amount is not calculated
export const defaultUnfreezeRate = 50
// Skipping this amount of nodes / styles
export const minUnfreezeRate = defaultUnfreezeRate
// Every 500 nodes / styles UI SHOULD unfreeze
export const maxUnfreezeRate = 500

