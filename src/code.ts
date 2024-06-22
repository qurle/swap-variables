// Disclamer: I am not a programmer. Read at yor risk
const LOGS = true
const TIMERS = false

import { cloneVariables } from './clone'
import { Collections, Errors, Scope } from './types'
import { figmaRGBToHex } from './utils'

// Constants
const actionMsgs = ["Swapped variables in", "Affected variables in", "Replaced variables in", "Updated variables in"]
const idleMsgs = ["No variables swapped", "Nothing changed", "Any layers to affect? Can't see it", "Nothing to do"]
const complexProperties = ['fills', 'strokes', 'layoutGrids', 'effects']
const typographyProperties = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'paragraphIndent']
const mixedProperties = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing']
const affectingInitFont = ['characters', 'fontSize', 'fontName', 'textStyleId', 'textCase', 'textDecoration', 'letterSpacing', 'leadingTrim', 'lineHeight']
const notAffectingFont = ['fills', 'fillStyleId', 'strokes', 'strokeWeight', 'strokeAlign', 'strokeStyleId']

const rCollectionId = /(VariableCollectionId:(?:\w|:)*)(?:\/[0-9]*:[0-9]*)?/
const rVariableId = /(VariableId:(?:\w|:)*)(?:\/[0-9]*:[0-9]*)?/

const uiSize = { width: 300, height: 340 }
// Idk why I made this
const OK = -1

// Variables
let notification: NotificationHandler
let working: boolean
let count: number
let times = new Map()
let collections
let toVariables: Variable[] | LibraryVariable[] = []
let errors: Errors = {
  limitation: [],
  noMatch: [],
  mixed: [],
  badProp: [],
  unsupported: [],
  noVariable: []
}
let gotErrors = false
let currentScope: Scope
let availableFonts: Font[] = []
let loadedFonts: FontName[] = []
let loadedFontFamilies: string[] = []

// Shorthands
const v = figma.variables
const tl = figma.teamLibrary

// Cancel on page change
figma.on("currentpagechange", cancel)

// Connect with UI
figma.showUI(__html__, { themeColors: true, width: uiSize.width, height: uiSize.height, })

figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case 'swap':

      errors = {
        limitation: [],
        noVariable: [],
        noMatch: [],
        mixed: [],
        badProp: [],
        unsupported: [],
      }

      count = 0

      notification = figma.notify('Working...', { timeout: Infinity })
      const selection = figma.currentPage.selection
      const nodes = selection && selection.length > 0 ? selection : figma.currentPage.children

      const collections: Collections = msg.message.collections
      c(`Collections to swap ↴`)
      c(collections)
      const newCollection = collections.to === null
      currentScope = msg.message.scope
      c(`Scope of swapping ↴`)
      c(currentScope)

      await figma.clientStorage.setAsync('scope', currentScope)

      if (newCollection) {
        const { collection, variables } = (await cloneVariables(collections.from))
        collections.to = collection
        toVariables = variables
        c(`Cloned variables`)
      }

      figma.ui.resize(uiSize.width, uiSize.height)

      const message = await startSwap(collections, currentScope)
      finish(newCollection ? collections.to : null, message)
      break

    case 'goToNode': {
      if (currentScope === 'styles') {

        notify(`Error in ${(await figma.getStyleByIdAsync(msg.message.nodeId)).name} style`)
        break
      }

      const node = await figma.getNodeByIdAsync(msg.message.nodeId) as SceneNode

      if (msg.message.shiftPressed) {
        figma.currentPage.selection = [...figma.currentPage.selection, node]
      } else {
        figma.currentPage.selection = [node as SceneNode]
      }
      figma.viewport.scrollAndZoomIntoView(figma.currentPage.selection)
      notify(`Going to ${node.name}`)
      break
    }
  }
}

// Engine start
run(figma.currentPage)

async function run(node: SceneNode | PageNode) {
  const scope = await figma.clientStorage.getAsync('scope')
  figma.ui.postMessage({ type: 'scope', message: { scope: scope } })

  availableFonts = await figma.listAvailableFontsAsync()
  collections = await getCollections()

  time('Getting current collection')
  const selection = figma.currentPage.selection
  const nodes = selection && selection.length > 0 ? selection : figma.currentPage.children
  let currentCollectionKey = nodes[0].getPluginData('currentCollectionKey')
  currentCollectionKey = nodes.every((el) => el.getPluginData('currentCollectionKey') === currentCollectionKey) ? currentCollectionKey : null
  timeEnd('Getting current collection')

  figma.ui.postMessage({ type: 'collections', message: { collections: collections, current: currentCollectionKey } })
}

/**
 * Saving local and external collections that have > 0 variables
 * @returns {Collections} List of collections
 */
async function getCollections() {
  time('Getting internal collections')
  const localCollections = (await v.getLocalVariableCollectionsAsync()).filter(el => el.variableIds.length > 0).map(el => ({
    key: el.key,
    lib: 'Local Collections',
    name: el.name,
    id: el.id,
    local: true,
    modes: el.modes
  }))
  c(`Got local collections ↴`)
  c(localCollections)
  timeEnd('Getting internal collections')

  time('Getting external collections')
  const allExternalCollections = await tl.getAvailableLibraryVariableCollectionsAsync()

  // Non empty collections
  const externalCollections = []
  for (const collection of allExternalCollections) {
    const variables = await tl.getVariablesInLibraryCollectionAsync(collection.key)
    if (variables.length > 0) {
      externalCollections.push(collection)
      // Finding ID by importing variable from collection
      const firstVariable = await v.importVariableByKeyAsync(variables[0].key)
      collection['id'] = firstVariable.variableCollectionId
      collection['local'] = false
      collection['modes'] = (await v.getVariableCollectionByIdAsync(collection['id'])).modes
      // Renaming libraryName -> lib (as in local)
      delete Object.assign(collection, { ['lib']: collection['libraryName'] })['libraryName']
      c(collection)
    }
  }
  timeEnd('Getting external collections')

  const collections = [...externalCollections, ...localCollections]
  c(collections)
  return collections
}

/**
 * Entry point to swap variables within selected in UI scope
 * @param {Collections} collections — object containing source and destination collections
 * @param {Scope} scope — selection, current page or all pages
 */
async function startSwap(collections: Collections, scope: Scope) {
  if (collections.from.key === collections.to.key) {
    return
  }
  toVariables = collections.to.local === true ?
    (await v.getLocalVariablesAsync()).filter(el => el.variableCollectionId === collections.to.id) :
    (await tl.getVariablesInLibraryCollectionAsync(collections.to.key))

  switch (scope) {
    case 'allPages':
      await swapAll(collections)
      break
    case 'thisPage':
      await swapPage(collections, figma.currentPage)
      break
    case 'selection':
      const selection = figma.currentPage.selection
      if (selection.length > 0)
        await swapNodes(collections, selection)
      else
        return 'No layers selected'
      break
    case 'styles':
      await swapStyles(collections)
      break
  }
}

/**
 * Swapping all the pages
 * @param {Collections} collections — object containing source and destination collections
 */
async function swapAll(collections: Collections) {
  const pageCount = figma.root.children.length
  for (let i = 0; i < pageCount; i++) {
    const page = figma.root.children[i]
    notify(`Swapping page ${i + 1} of ${pageCount}: ${page.name}`)
    await swapPage(collections, page)
  }
}

/**
 * Checking if page is loaded and swapping variables on whole page
 * @param {Collections} collections — object containing source and destination collections
 * @param {PageNode} page – page to swap
 */
async function swapPage(collections: Collections, page: PageNode) {
  if (page !== figma.currentPage)
    await page.loadAsync()
  await swapNodes(collections, page.children)
}

/**
 * Main recursive function for swapping variables 
 * @param {Collections} collections — object containing source and destination collections
 * @param {SceneNode[]} nodes – nodes to affect
 */
async function swapNodes(collections: Collections, nodes) {
  c(`Nodes to swap ↴`)
  c(nodes)
  // try {
  for (const node of nodes) {
    c(`Swapping node ${node.name}`)
    // Change explicit mode
    swapMode(node, collections)

    // Special text handling
    if (node.type === 'TEXT') {
      await swapTextNode(node, collections)
    } else {

      for (let [property, value] of Object.entries(node.boundVariables || {})) {

        if (property === 'componentProperties') {
          await swapComponentProperty(node, value, collections)
        }
        else if (Array.isArray(value)) {
          // Complex immutable properties
          await swapComplexProperty(node, property, collections)
        }
        else {
          await swapSimpleProperty(node, value, property, collections)
        }
      }
    }

    node.setRelaunchData({ relaunch: '' })
    node.setPluginData('currentCollectionKey', collections.to.key)

    // Recursion
    if (node.children && node.children.length > 0) {
      c(`Got children`)
      await swapNodes(collections, node.children)
    }
  }
  // } catch (e) {
  //   figma.closePlugin(`${e}`)
  // }
}

/**
 * Swapping explicit mode if source collection has mode with the same name 
 * @param {SceneNode} node – node that may have explicit mode
 * @param {Collections} collections — object containing source and destination collections
 */
async function swapMode(node, collections) {
  const explicitMode = (node.explicitVariableModes[collections.from.id])
  if (!explicitMode)
    return
  c(`Explicit mode ↴`)
  c(explicitMode)

  c(`Current collection ↴`)
  c(collections.from)
  c(`Current modes ↴`)
  c(collections.from.modes)
  if (node.type === 'INSTANCE') {
    error('unsupported', {
      property: 'mode',
      type: node.type,
      nodeName: node.name,
      nodeId: node.id
    })
    return
  }
  const currentMode = collections.from.modes.find(mode => mode.modeId === explicitMode)
  if (!currentMode)
    return
  c(`Mode to swap: ${currentMode.name}`)

  const newMode = collections.to.modes.find(mode => mode.name === currentMode.name)
  if (!newMode) {
    error('noMatch', { name: `Mode "${currentMode.name}"`, type: 'STRING', value: '?', nodeName: node.name, nodeId: node.id })
    return
  }
  c(`New mode: ${collections.to.modes.find(mode => mode.name === currentMode.name)}`)

  node.setExplicitVariableModeForCollection(collections.to, newMode.modeId)
}

/**
 * Swap variables of text node
 * @param {SceneNode} node – node to affect
 * @param {Collections} collections — object containing source and destination collections
 */
async function swapTextNode(node: TextNode, collections) {
  c(`Working with text`)
  if (!Object.keys(node.boundVariables)) {
    c(`No variables`)
    return 'no variables'
  }
  // Checking if we need to load font
  if (Object.keys(node.boundVariables).find(el => affectingInitFont.includes(el))) {
    c(`Loading fonts ↴`)
    c(node.getRangeAllFontNames(0, node.characters.length))
    if (node.hasMissingFont) {
      error('badProp', { property: 'fontName', nodeName: node.name, nodeId: node.id })
      return 'badProp'
    }
    await Promise.all(
      node.getRangeAllFontNames(0, node.characters.length).map(async (fontName) => await loadFont(fontName, loadedFonts))
    )
  }

  // Props that can't be mixed are stored in nonMixedProperties array
  for (const property of Object.keys(node.boundVariables).filter(el => !mixedProperties.includes(el))) {
    if (property === 'textRangeFills' || property === 'textRangeStrokes') continue
    c(`Swapping ${property} of ${node.name}`)
    if (property === 'fills') {
      for (const segment of node.getStyledTextSegments(['fills'])) {
        node.setRangeFills(segment.start, segment.end, await swapPropertyLayers(segment.fills, collections, v.setBoundVariableForPaint, node))
      }
    }
    else if (node[property].toString() === `Symbol(figma.mixed)`) {
      // Maybe we can swap at least fills?

      error('mixed', { nodeName: node.name, nodeId: node.id })
      continue
    }
    else if (complexProperties.includes(property))
      await swapComplexProperty(node, property, collections)
    else
      await swapSimpleProperty(node, node.boundVariables[property][0] || node.boundVariables[property], property, collections)
  }

  // Props that can be mixed
  c(`Segments  ↴`)
  c(node.getStyledTextSegments(['boundVariables']))

  for (const segment of node.getStyledTextSegments(['boundVariables'])) {
    c(`Current segment ↴`)
    c(segment)
    for (const [property, value] of Object.entries(segment.boundVariables)) {
      c(`Swapping ranged property ${property} of ${node.name}`)
      c(`Value ↴`)
      c(value)
      // if (complexProperties.includes(property)) { }
      await swapSimpleProperty(node, value, property, collections, [segment.start, segment.end])
    }
  }
}

/**
 * Swapping local styles 
 * @param {Collections} collections — object containing source and destination collections
 */
async function swapStyles(collections) {

  // This styles got same layers logic, but different names in objects
  const styleReferences = {
    grids: {
      getFunction: figma.getLocalGridStylesAsync,
      layersName: 'layoutGrids',
      bindFunction: v.setBoundVariableForLayoutGrid
    },
    effects: {
      getFunction: figma.getLocalEffectStylesAsync,
      layersName: 'effects',
      bindFunction: v.setBoundVariableForEffect
    },
    paints: {
      getFunction: figma.getLocalPaintStylesAsync,
      layersName: 'paints',
      bindFunction: v.setBoundVariableForPaint
    }
  }
  c(`Swapping styles`)
  for (const [styleName, reference] of Object.entries(styleReferences)) {
    const styles = await reference.getFunction()
    c(`Got ${styles.length} ${styleName}`)
    for (const style of styles) {
      c(`Got style ${style.name}`)
      if (style.boundVariables && Object.entries(style.boundVariables).length > 0) {
        c(`Swapping`)
        style[reference.layersName] = await swapPropertyLayers(style[reference.layersName], collections, reference.bindFunction, null, style)
      }
    }
  }

  // Text doesn't contain any layers so logic differs here
  const textStyles = await figma.getLocalTextStylesAsync()
  for (const style of textStyles) {
    c(`Bound variables ↴`)
    c(style.boundVariables)
    await loadFont(style.fontName, loadedFonts)
    for (const [field, variable] of Object.entries(style.boundVariables)) {
      c(`Setting field ${field}`)
      c(`Current variable ↴`)
      c(variable)
      const newVariable = await getNewVariable(variable, collections, null, style, field)
      if (!newVariable)
        continue
      if (field === 'fontFamily') {
        for (const family of Object.values(newVariable.valuesByMode)) {
          await loadFontsByFamily(family as string, loadedFontFamilies, availableFonts)
        }
      }
      //@ts-ignore
      style.setBoundVariable(field, newVariable)
    }
  }
}

let swappingSimpleTime = 0

/**
 * Swap variable of simple property
 * @param {SceneNode} node – node to affect
 * @param value – current value
 * @param property – name of property to swap
 * @param {Collections} collections — object containing source and destination collections
 * @param range — range of application (for texts)
 */
async function swapSimpleProperty(node, value, property, collections, range = []) {
  time('Swapping simple')
  c(`Swapping simple property: ${property}`)
  c(`Current value:`)
  c(value || node[property])
  const newVariable = await getNewVariable(value as Variable, collections, node, null, property)
  if (newVariable) {
    if (property === 'characters' && newVariable.resolvedType === 'FLOAT') {
      c(`Swapping characters to float variable`)
      error("unsupported", { property: property, nodeName: node.name, type: node.type, nodeId: node.id })
      return 'unsupported'
    }
    // Text
    if (range.length > 0) {
      c(`Setting ranged variable from ${node.characters[range[0]]}:${range[0]} to ${node.characters[range[1] - 1]}:${range[1] - 1}`)
      node.setRangeBoundVariable(range[0], range[1], property, newVariable)
    } else
      node.setBoundVariable(property, newVariable)
  }
  swappingSimpleTime = timeEnd('Swapping simple', false)
  return OK
}

let swappingComplexTime = 0
let boundingComplexTime = 0
let layerCount = 0

/**
 * Swap variable of complex property
 * @param {SceneNode} node – node to affect
 * @param property – name of property to swap
 * @param {Collections} collections — object containing source and destination collections
 */
async function swapComplexProperty(node, property: string, collections: Collections) {
  time('Swapping complex')
  let bindFunction
  c(`Swapping complex property: ${property}`)

  switch (property) {
    case 'fills':
      bindFunction = v.setBoundVariableForPaint
      break
    case 'strokes':
      if (node.type === 'SECTION') {
        // Strokes are not supported for sections with Figma Plugin API
        // https://forum.figma.com/t/why-are-strokes-not-available-on-section-nodes/41658
        error('unsupported', { property: property, nodeName: node.name, type: node.type, nodeId: node.id })
        return
      }
      else
        bindFunction = v.setBoundVariableForPaint
      break
    case 'layoutGrids':
      bindFunction = v.setBoundVariableForLayoutGrid
      break
    case 'effects':
      bindFunction = v.setBoundVariableForEffect
      break
    default:
      error('badProp', { property: property, nodeName: node.name, nodeId: node.id })
      return
  }

  // Swapping by layers
  node[property] = await swapPropertyLayers(node[property], collections, bindFunction, node)
  swappingComplexTime += timeEnd('Swapping complex', false)
}

async function swapPropertyLayers(layers, collections, bindFunction, node, style?) {
  return await Promise.all(
    layers.map(async (layer) => {
      layerCount++
      count++
      c(`Current layer ↴`)
      c(layer)
      if (!('boundVariables' in layer) || Object.entries(layer.boundVariables).length === 0)
        return layer

      c(`Found ${Object.entries(layer.boundVariables).length} variables`)
      for (const [field, variable] of Object.entries(layer.boundVariables)) {
        const newVariable = await getNewVariable(variable, collections, node, style, field)
        if (newVariable) {
          c('found new variable')
          time('Bounding complex')
          layer = bindFunction(layer, field, newVariable)
          boundingComplexTime += timeEnd('Bounding complex', false)
        }
      }
      return layer
    })
  )
}

/**
 * Swap variable of instance variant property
 * @param {SceneNode} node – node to affect
 * @param value – current value
 * @param {Collections} collections — object containing source and destination collections
 */
async function swapComponentProperty(node, value, collections: Collections) {
  for (const [propertyName, variable] of Object.entries(value)) {
    c(`Property ↴`)
    c(propertyName)
    c(`Value ↴`)
    c(value)

    if (!Object.keys(node.componentProperties).includes(propertyName)) {
      c(`Not in destination`)
      continue
    }

    const newVariable = await getNewVariable(variable, collections, node, null, propertyName)

    if (!newVariable) {
      c(`No new variable`)
      continue
    }
    node.setProperties({ [propertyName]: v.createVariableAlias(newVariable) })
  }
}


async function getNewVariable(variable, collections: Collections, node, style?, property?) {
  const variableObject = await v.getVariableByIdAsync(variable.id)
  c(`Source variable ↴`)
  c(variableObject)
  try {
    variableObject.variableCollectionId
  }
  catch (e) {
    error('noVariable', { variableId: variable.id, nodeName: node?.name || style?.name || null, nodeId: node?.id || style?.id || null, property: property })
    return
  }

  if (!collections.from.id.includes(variableObject.variableCollectionId.match(rCollectionId)?.[1])) {
    c(`Variable doesn't belong to source collection`)
    return
  }

  c(`Variable belongs to source collection`)
  let newVariable
  try {
    newVariable = await findVariable(collections.to, variableObject)
    count++
  }
  catch {
    let value = node ?
      variableObject.resolveForConsumer(node).value : '?'

    if (variableObject.resolvedType === 'COLOR') {
      value = figmaRGBToHex(value as RGB | RGBA)
    }
    error('noMatch', { name: variableObject.name, type: variableObject.resolvedType, value: value, nodeName: node?.name || style?.name || null, nodeId: node?.id || style?.id || null })
  }

  return newVariable || variableObject
}

let findingTime = 0
async function findVariable(collection, variable) {
  time('Finding')
  const name = variable.name
  c(`Destination is local: ${collection.local}`)

  const newVariable = collection.local === true ?
    toVariables.find(el => el.name === name) as Variable :
    await v.importVariableByKeyAsync(toVariables.find(el => el.name === name).key) as Variable

  c(`Found new ${newVariable.name} with id ${newVariable.id} ↴`)
  c(newVariable)
  findingTime += timeEnd('Finding', false)
  return newVariable
}

export function error(type: 'limitation' | 'noMatch' | 'mixed' | 'badProp' | 'unsupported' | 'noVariable', options) {
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
  c(`Can't swap ${type === 'noMatch' ? `variable ${options.name} for ` : `${options.property} of ${options.nodeName}`}: ${type}`, 'error')
}

async function loadFont(font: FontName, loadedFonts: FontName[]) {
  if (loadedFonts.includes(font))
    return

  await figma.loadFontAsync(font)
  loadedFonts.push(font)
}

async function loadFontsByFamily(fontFamily: string, loadedFontFamilies: string[], availableFonts: Font[]) {
  if (loadedFontFamilies.includes(fontFamily))
    return

  const fonts = availableFonts.filter(font => font.fontName.family === fontFamily)
  for (const font of fonts) {
    await figma.loadFontAsync(font.fontName)
  }
  loadedFontFamilies.push(fontFamily)
}

// Ending the work
function finish(newCollection = null, message?: string) {
  showTimers()
  figma.ui.postMessage({ type: 'finish', message: { errors: errors, newCollection: newCollection } })
  const errorCount = Object.values(errors).reduce((acc, err) => acc + err.length, 0)

  if (errorCount > 0)
    figma.ui.resize(uiSize.width, uiSize.height + 60)
  else
    figma.ui.resize(uiSize.width, uiSize.height)

  working = false
  if (message)
    notify(message)
  else if (count > 0) {
    const actionMsg = `${actionMsgs[Math.floor(Math.random() * actionMsgs.length)]} ${count} propert${(count === 1 ? "y." : "ies.")}`
    const errorMsg = gotErrors ? `Got ${errorCount} error${errorCount === 1 ? "." : "s."} ` : ''
    notify(`${actionMsg} ${errorMsg}`)
  }
  else {
    const idleMsg = `${idleMsgs[Math.floor(Math.random() * idleMsgs.length)]} ${count} variable${(count === 1 ? "." : "s.")}`
    const errorMsg = gotErrors ? `Got ${errorCount} error${errorCount === 1 ? "." : "s."} ` : ''
    notify(`${idleMsg} ${errorMsg}`)
  }
  if (gotErrors) console.error(errors)
}

// Show new notification
function notify(text: string) {
  if (notification != null)
    notification.cancel()
  notification = figma.notify(text)
}

// Showing interruption notification
function cancel() {
  if (notification != null)
    notification.cancel()
  if (working) {
    notify("Plugin work have been interrupted")
  }
}

function showTimers() {
  c(`⏱️ Swapping simple: ${swappingSimpleTime} `)
  c(`⏱️ Bounding complex: ${boundingComplexTime} `)
  c(`Time per layer: ${Math.round(boundingComplexTime / layerCount)} `)
  c(`⏱️ Swapping complex: ${swappingComplexTime} `)
  c(`Time per layer: ${Math.round(swappingComplexTime / layerCount)} `)
  c(`⏱️ Finding: ${findingTime} `)
  c(`Time per variable: ${Math.round(findingTime / count)} `)
  swappingSimpleTime = 0
  swappingComplexTime = 0
  boundingComplexTime = 0
  findingTime = 0
  layerCount = 0
}

export function c(str: any = 'here', type?: 'error' | 'warn') {
  if (!LOGS)
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

function time(str) {
  if (!TIMERS) return

  const time = Date.now()
  times.set(str, time)
  return time
}

function timeEnd(str, show = true) {
  if (!TIMERS) return

  const time = Date.now() - times.get(str)
  if (show) console.log(`⏱️ ${str}: ${time} ms`)
  times.delete(str)
  return time
}