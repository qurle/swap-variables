// Disclamer: I am not a programmer. Read at yor risk
export const LOGS = false
export const TIMERS = false

import { cloneVariables } from './clone'
import { Collections, Errors, ProgressOptions, Scope } from './types'
import { c, countChildren, figmaRGBToHex, generateProgress } from './utils'

// Constants
const actionMsgs = ["Swapped variables in", "Affected variables in", "Replaced variables in", "Updated variables in"]
const idleMsgs = ["No variables swapped", "Nothing changed", "Any layers to affect? Can't see it", "Nothing to do"]
const complexProperties = ['fills', 'strokes', 'layoutGrids', 'effects']
const typographyProperties = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'paragraphIndent']
const mixedProperties = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textRangeFills']
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
let prevProgressNotification: NotificationHandler
let progressNotification: NotificationHandler
let progressNotificationTimeout: number
let count: number = 0
let nodesProcessed: number = 0
let nodesAmount: number = 0
let currentPage: number = 1
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
let showProgress: boolean = false
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

      if (notification != null)
        notification.cancel()

      notification = figma.notify('Working...', { timeout: Infinity })

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
      await swapPage(collections, figma.currentPage, { scope: 'thisPage' })
      break
    case 'selection':
      const selection = figma.currentPage.selection
      if (selection.length > 0) {
        await swapNodes(collections, selection, true, { scope: 'selection' })
      }
      else
        return 'No layers selected'
      break
    case 'styles':
      await swapStyles(collections)
      break
  }
}

function initProgressNotification(nodes, progressOptions: ProgressOptions) {
  nodesProcessed = 0
  if (progressOptions.scope !== 'styles')
    nodesAmount = countChildren(nodes)
  showProgress = true
  // if (progressOptions.scope !== 'allPages')
    showProgressNotification(progressOptions)
}



function showProgressNotification(progressOptions: ProgressOptions) {
  c(`Showing work notification`);
  const timeout = progressOptions.scope === 'allPages' ? 1500 : 300
  let message;
  (function loop(options = progressOptions) {
    if (showProgress) {
      c(`Options ↴`)
      c(options)
      switch (options.scope) {
        case 'allPages':
          message = `Page ${currentPage} of ${options.pageAmount}. Processing node ${nodesProcessed} of ${nodesAmount}  ${generateProgress(Math.round(currentPage / options.pageAmount * 100))}`
          break
        case 'styles':
          message = `Processing style ${nodesProcessed} of ${nodesAmount}  ${generateProgress(Math.round(nodesProcessed / nodesAmount * 100))}`
          break
        default:
          message = `Processing node ${nodesProcessed} of ${nodesAmount}  ${generateProgress(Math.round(nodesProcessed / nodesAmount * 100))}`
          break
      }
      prevProgressNotification = progressNotification
      progressNotification = figma.notify(message, { timeout: timeout + 50 })
      setTimeout(() => prevProgressNotification?.cancel(), 100)
      progressNotificationTimeout = setTimeout(() => { loop(progressOptions) }, timeout);
    }
  })();
}


function stopProgressNotification() {
  showProgress = false
  prevProgressNotification?.cancel()
  progressNotification?.cancel()
  if (progressNotificationTimeout)
    clearTimeout(progressNotificationTimeout)

}

/**
 * Swapping all the pages
 * @param {Collections} collections — object containing source and destination collections
 */
async function swapAll(collections: Collections) {
  const pageAmount = figma.root.children.length
  for (let i = 0; i < pageAmount; i++) {
    const page = figma.root.children[i]
    currentPage = i + 1
    await swapPage(collections, page, { pageIndex: i + 1, pageAmount: pageAmount, scope: 'allPages' })
  }
}

/**
 * Checking if page is loaded and swapping variables on whole page
 * @param {Collections} collections — object containing source and destination collections
 * @param {PageNode} page – page to swap
 */
async function swapPage(collections: Collections, page: PageNode, progressOptions?: ProgressOptions) {
  if (page !== figma.currentPage)
    await page.loadAsync()
  c(`Current page: ${progressOptions.pageIndex}`)
  await swapNodes(collections, page.children, true, progressOptions)
}

/**
 * Main recursive function for swapping variables 
 * @param {Collections} collections — object containing source and destination collections
 * @param {SceneNode[]} nodes – nodes to affect
 */
async function swapNodes(collections: Collections, nodes, first = false, progressOptions?: ProgressOptions) {
  if (first) {
    c(`Swapping first nodes`)
    // Keeping it here for proper multipage work
    stopProgressNotification()
    initProgressNotification(nodes, progressOptions)
  }
  const nodeLength = nodes.length
  c(`Nodes to swap ↴`)
  c(nodes)
  // try {
  for (let i = 0; i < nodeLength; i++) {
    const node = nodes[i]
    // notify(`Checking node ${i} of ${nodeLength}`)
    c(`Swapping node ${node.name}`)
    // Change explicit mode
    swapMode(node, collections)

    // Special text handling
    if (node.type === 'TEXT' && (node as TextNode).characters.length > 0) {
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

    nodesProcessed++

    // node.setRelaunchData({ relaunch: '' })
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
  // if (node.type === 'INSTANCE') {
  //   error('unsupported', {
  //     property: 'mode',
  //     type: node.type,
  //     nodeName: node.name,
  //     nodeId: node.id
  //   })
  //   return
  // }
  const currentMode = collections.from.modes.find(mode => mode.modeId === explicitMode)
  if (!currentMode)
    return
  c(`Mode to swap: ${currentMode.name}`)

  const newMode = collections.to.modes.find(mode => mode.name === currentMode.name)
  if (!newMode) {
    error('noMatch', { name: `Mode "${currentMode.name}"`, type: 'STRING', value: '?', nodeName: node.name, nodeId: node.id })
    return
  }
  c(`New mode ↴`)
  c(collections.to.modes.find(mode => mode.name === currentMode.name))
  try {
    node.setExplicitVariableModeForCollection(collections.to, newMode.modeId)
  } catch (e) {
    console.log(`Couldn't set mode: ${e}`)
  }
}

/**
 * Swap variables of text node
 * @param {SceneNode} node – node to affect
 * @param {Collections} collections — object containing source and destination collections
 */
async function swapTextNode(node: TextNode, collections) {
  try {
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
    c(`Properties with variables ↴`)
    c(Object.keys(node.boundVariables))

    // Props that can't be mixed are stored in nonMixedProperties array
    c(`Not mixed properties`)
    for (const property of Object.keys(node.boundVariables).filter(el => !mixedProperties.includes(el))) {
      c(`Swapping ${property} of ${node.name}`)
      if (property === 'textRangeStrokes') {
        c(`Skipping ${property}`)
        continue
      }
      if (node[property].toString() === `Symbol(figma.mixed)`) {
        // Some other random props
        error('mixed', { nodeName: node.name, nodeId: node.id })
        continue
      }
      else if (complexProperties.includes(property))
        await swapComplexProperty(node, property, collections)
      else
        await swapSimpleProperty(node, node.boundVariables[property][0] || node.boundVariables[property], property, collections)
    }

    // Props that can be mixed
    // Also my formatting is broken
    c(`Mixed segments  ↴`)
    c(node.getStyledTextSegments(['boundVariables', 'fills']))
    // Have no clue why fills aren't in bound variables. They surely should be
    for (const segment of node.getStyledTextSegments(['boundVariables', 'fills'])) {
      c(`Current segment ↴`)
      c(segment)
      // Fills are not here!
      for (const [property, value] of Object.entries(segment.boundVariables)) {
        c(`Swapping ranged property ${property} of ${node.name}`)
        c(`Value ↴`)
        c(value)
        // if (complexProperties.includes(property)) { }
        await swapSimpleProperty(node, value, property, collections, [segment.start, segment.end])
      }
      // Fills are here!
      if ('fills' in segment) {
        c(`Swapping ranged fills`)
        if (!segmentHasStyles(node, segment, 'textRangeFills')) {
          c(`No styles here`)
          c(segment.fills)
          const newPropertyLayers = await swapPropertyLayers(segment.fills, 'fills', collections, v.setBoundVariableForPaint, node)
          if (newPropertyLayers)
            node.setRangeFills(segment.start, segment.end, newPropertyLayers)
        }
      }
    }
  }
  catch (e) {
    notify(`Can't swap text node ${node.name}: ${e}`, { error: true })
  }
}

function segmentHasStyles(node: TextNode, segment: Pick<StyledTextSegment, "fills" | "characters" | "start" | "end">, type: 'textRangeFills' | 'fills' | 'textRangeStrokes' | 'strokes' | 'fontFamily' | 'fontWeight' | 'fontSize') {
  // Yes I ✨architectured✨ one-case switch so what
  switch (type) {
    case 'textRangeFills':
    case 'fills':
      c(`Style from ${segment.start} to ${segment.end}: ${String(node.getRangeFillStyleId(segment.start, segment.end)) || 'Not found'}`)
      c(`Returning ${node.getRangeFillStyleId(segment.start, segment.end) !== ''}`)
      return node.getRangeFillStyleId(segment.start, segment.end) !== ''
    default:
      return false
  }
}

/**
 * Swapping local styles 
 * @param {Collections} collections — object containing source and destination collections
 */
async function swapStyles(collections) {
  stopProgressNotification()
  initProgressNotification([], { scope: 'styles' })

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
    nodesAmount += styles.length
    c(`Got ${styles.length} ${styleName}`)
    for (const style of styles) {
      c(`Got style ${style.name}`)
      if (style.boundVariables && Object.entries(style.boundVariables).length > 0) {
        c(`Swapping`)
        style[reference.layersName] = await swapPropertyLayers(style[reference.layersName], reference.layersName, collections, reference.bindFunction, null, style)
        nodesProcessed++
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
  const newPropertyLayers = await swapPropertyLayers(node[property], property, collections, bindFunction, node)
  if (newPropertyLayers) node[property] = newPropertyLayers
  swappingComplexTime += timeEnd('Swapping complex', false)
}

async function swapPropertyLayers(layers, property, collections, bindFunction, node, style?) {
  c(`Swapping layers of ${property}`)
  c(`Style ↴`)
  c(style)
  c(style === undefined)
  // Unaffect styles (otherwise they'll be detached)
  if (style === undefined && (
    (property === 'fills' && node.fillStyleId && node.fillStyleId.toString() !== `Symbol(figma.mixed)`) ||
    (property === 'effects' && node.effectStyleId && node.effectStyleId.toString() !== `Symbol(figma.mixed)`) ||
    (property === 'grids' && node.gridStyleId && node.gridStyleId.toString() !== `Symbol(figma.mixed)`) ||
    (property === 'strokes' && node.strokeStyleId && node.strokeStyleId.toString() !== `Symbol(figma.mixed)`)
  )) {

    return null
  }
  else {
    c(`No inner styles`)
  return await Promise.all(
    layers.map(async (layer) => {
      layerCount++
      c(`Current layer ↴`)
      c(layer)

      if ('gradientStops' in layer) {
        c('Got gradient ↴')
        c(layer.gradientStops)
        const newLayer = JSON.parse(JSON.stringify(layer)) as GradientPaint
        for (const gradientStop of newLayer.gradientStops) {
          // Does this stop has some bound variables?
          if (!('color' in gradientStop.boundVariables))
            continue

          const newVariable = await getNewVariable(gradientStop.boundVariables.color, collections, node, null, 'gradient')
          if (newVariable) gradientStop.boundVariables.color = v.createVariableAlias(newVariable)
          c('New stop ↴')
          c(gradientStop)
        }
        c('New layer ↴')
        c(newLayer)

        return newLayer || layer
      }
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
  // showTimers()
  // Killing work notification
  stopProgressNotification()

  // Sending finish message
  figma.ui.postMessage({ type: 'finish', message: { errors: errors, newCollection: newCollection } })
  const errorCount = Object.values(errors).reduce((acc, err) => acc + err.length, 0)

  c(`Count: ${count}`)
  // Expanding to show some errors
  if (errorCount > 0)
    figma.ui.resize(uiSize.width, uiSize.height + 60)
  else
    figma.ui.resize(uiSize.width, uiSize.height)

  working = false
  if (message)
    notify(message)
  else if (count > 0) {
    const actionMsg = `${actionMsgs[Math.floor(Math.random() * actionMsgs.length)]} ${count} propert${(count === 1 ? "y" : "ies")} of ${nodesProcessed} node${(nodesProcessed === 1 ? "." : "s.")}`
    const errorMsg = gotErrors ? `Got ${errorCount} error${errorCount === 1 ? "." : "s."} ` : ''
    notify(`${actionMsg} ${errorMsg}`)
  }
  else {
    const idleMsg = `${idleMsgs[Math.floor(Math.random() * idleMsgs.length)]}. Checked ${nodesProcessed} node${(nodesProcessed === 1 ? "." : "s.")}`
    const errorMsg = gotErrors ? `Got ${errorCount} error${errorCount === 1 ? "." : "s."} ` : ''
    notify(`${idleMsg} ${errorMsg}`)
  }
  if (gotErrors) console.error(errors)
}

// Show new notification
function notify(text: string, options: NotificationOptions = {}, clearProgress = true) {
  if (clearProgress) {
    stopProgressNotification()
  }
  if (notification != null) {
    notification.cancel()
  }
  notification = figma.notify(text, options)
}

// Showing interruption notification
function cancel() {
  if (notification != null)
    notification.cancel()
  stopProgressNotification()
  if (working) {
    // notify("Plugin work have been interrupted")
  }
  finish(collections.to || null,)

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

function time(str) {
  if (!TIMERS) return

  const time = Date.now()
  times.set(str, time)
  return time
}

function timeEnd(str, show = TIMERS) {
  if (!TIMERS) return

  const time = Date.now() - times.get(str)
  if (show) console.log(`⏱️ ${str}: ${time} ms`)
  times.delete(str)
  return time
}