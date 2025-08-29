// Disclamer: I am not a programmer. Read at yor risk

import { cloneVariables } from './clone'
import { affectingInitFont, complexProperties, mixedProperties, rCollectionId, typographyProperties, unfreezePercentage, useMap } from './config'
import { clearErrors, error, errorCount, errors } from './errors'
import { loadFont, loadFontsByFamily } from './fonts'
import { clearNotifications, initProgressNotification, notify, showFinishNotification, stopProgressNotification } from './notifications'
import { clearCounters, state } from './state'
import { clearTimers, showTimers, timeAdd as ta, timeEnd as te, time, timeStart as ts } from './timers'
import { Collection, CollectionsToSwap, ProgressOptions, Scope } from './types'
import { c, countChildren, figmaRGBToHex, getNodesToUnfreeze, setNodesToUnfreeze, wakeUpMainThread } from './utils'

// Idk why I made this
const OK = -1

// Shorthands
const v = figma.variables
const tl = figma.teamLibrary

// Storing window size
const ui = {
  width: 300,
  height: 316,
  defWidth: 300,
  defHeight: 316,
  minWidth: 280,
  minHeight: 160,
  resized: false
}

// Strings for client storage
const storage = {
  uiWidth: 'uiWidth',
  uiHeight: 'uiHeight',
  lastLaunch: 'lastLaunch',
  scope: 'scope',
  resized: 'resized'
}

ts('Cold start')
// Cancel on page change
figma.on("currentpagechange", cancel)
// Save last launch date on close
figma.on("close", async () => { await close() })



// Engine start
run()

async function run() {
  await setUI()
  const scope = await figma.clientStorage.getAsync(storage.scope)
  figma.ui.postMessage({ type: 'scope', message: { scope: scope } })
  state.collectionList = await getCollections()

  ts('Getting current collection')
  const selection = figma.currentPage.selection
  const nodes = selection && selection.length > 0 ? selection : figma.currentPage.children
  let currentCollectionKey = nodes[0].getPluginData('currentCollectionKey')
  currentCollectionKey = nodes.every((el) => el.getPluginData('currentCollectionKey') === currentCollectionKey) ? currentCollectionKey : null
  te('Getting current collection')


  figma.ui.postMessage({ type: 'collections', message: { collections: state.collectionList, current: currentCollectionKey } })
}

// Reactions to UI
figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    // Main action for big blue button
    case 'swap':
      clearErrors()
      clearCounters()
      clearTimers()

      // Setting by default, will update later with counting nodes / styles amount
      setNodesToUnfreeze()

      state.availableFonts = await figma.listAvailableFontsAsync()

      state.collectionsToSwap = msg.message.collections
      c(`Collections to swap ↴`)
      c(state.collectionsToSwap)
      const newCollection = state.collectionsToSwap.to === null
      state.currentScope = msg.message.scope
      c(`Scope of swapping ↴`)
      c(state.currentScope)

      figma.clientStorage.setAsync(storage.scope, state.currentScope)

      // Cloning variables
      if (newCollection) {
        const { collection, variablesMap } = (await cloneVariables(state.collectionsToSwap.from))
        state.collectionsToSwap.to = collection
        state.toVariablesMap = variablesMap
        c(`Cloned variables`)
      }

      if (!ui.resized)
        figma.ui.resize(ui.width, ui.height)

      const message = await startSwap(state.collectionsToSwap, state.currentScope)
      finish(newCollection ? state.collectionsToSwap.to : null, message)
      break

    // Going to node (from errors)
    case 'goToNode': {
      if (state.currentScope === 'styles') {
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

    // Resizing event
    case 'resize': {
      ui.width = Math.max(ui.minWidth, Number(msg.message.width))
      ui.height = Math.max(ui.minHeight, Number(msg.message.height))

      figma.ui.resize(ui.width, ui.height)
      ui.resized = true
      break
    }

    // Save state of resized width to client storage
    case 'saveSize': {
      saveSize(msg.message.width, msg.message.height, true)
      console.log('saving')
      break
    }

    // Back to default size event
    case 'defaultSize': {
      saveSize(ui.defWidth, ui.defHeight, false)

      ui.width = ui.defWidth
      ui.height = ui.defHeight
      figma.ui.resize(ui.width, ui.height)
      ui.resized = false
      break
    }
  }
}

async function setUI() {
  ts('Setting UI')
  const lastLaunch = await figma.clientStorage.getAsync(storage.lastLaunch)
  if (Date.now() - lastLaunch < (1000 * 60 * 60 * 2)) {
    ui.width = Number(await figma.clientStorage.getAsync(storage.uiWidth)) || ui.defWidth
    ui.height = Number(await figma.clientStorage.getAsync(storage.uiHeight)) || ui.defHeight
    ui.resized = Boolean(await figma.clientStorage.getAsync(storage.resized)) || false
  }
  figma.showUI(__html__, { themeColors: true, width: ui.width, height: ui.height, })
  te('Setting UI')
}

/**
 * Saving local and external collections that have > 0 variables
 * @returns {Promise<Collection[]>} List of available collections
 */
async function getCollections(): Promise<Collection[]> {
  ts('Getting internal collections')
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
  te('Getting internal collections')

  ts('Getting external collections')
  ts('List of external collections')
  const allExternalCollections = await tl.getAvailableLibraryVariableCollectionsAsync()
  te('List of external collections')

  // Non empty collections
  const externalCollections = []
  for (const collection of allExternalCollections) {
    ts(`Variables for ${collection.key}`)
    const variables = await tl.getVariablesInLibraryCollectionAsync(collection.key)
    te(`Variables for ${collection.key}`)

    if (variables.length > 0) {
      externalCollections.push(collection)
      // Finding ID by importing variable from collection
      ts(`Importing variable ${variables[0].key}`)
      const firstVariable = await v.importVariableByKeyAsync(variables[0].key)
      te(`Importing variable ${variables[0].key}`)

      collection['id'] = firstVariable.variableCollectionId
      collection['local'] = false
      // We'll set ['modes'] later 

      // Renaming libraryName -> lib (as in local)
      delete Object.assign(collection, { ['lib']: collection['libraryName'] })['libraryName']
      c(collection)
    }
  }
  te('Getting external collections')

  const collections = [...externalCollections, ...localCollections]
  c(collections)
  return collections
}

/**
 * Entry point to swap variables within selected in UI scope
 * @param {CollectionsToSwap} collections — object containing source and destination collections
 * @param {Scope} scope — selection, current page or all pages
 */
async function startSwap(collections: CollectionsToSwap, scope: Scope) {
  ts('Whole swap')
  // Same collections? No need to swap
  if (collections.from.key === collections.to.key) {
    return
  }

  ts('relaunchData')
  figma.currentPage.selection.forEach(node => node.setPluginData('currentCollectionKey', collections.to.key))
  ta('relaunchData')

  // Get variables based on local or external collection
  const toVariables = collections.to.local === true ?
    // Just cherry-picking local variables
    (await v.getLocalVariablesAsync()).filter(el => el.variableCollectionId === collections.to.id) :
    // Resolving external variables by key
    await Promise.all((await tl.getVariablesInLibraryCollectionAsync(collections.to.key)).map(async variable => await v.importVariableByKeyAsync(variable.key)))

  // Converting to map to speed this shit up
  state.toVariablesMap = new Map(toVariables.map((el: Variable) => [el.name, el]))

  // Getting modes for collections
  const resolvedToCollection = await v.getVariableCollectionByIdAsync(collections.to.id)
  collections.from.modes = (await v.getVariableCollectionByIdAsync(collections.from.id)).modes
  collections.to.modes = resolvedToCollection.modes
  if (collections.from.modes.length > 1 && collections.to.modes.length > 1) {
    // Need to store this collection only if we set explicit modes
    collections.to.variableCollection = await v.getVariableCollectionByIdAsync(collections.to.id)
  }

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

/**
 * Swapping all the pages
 * @param {CollectionsToSwap} collections — object containing source and destination collections
 */
async function swapAll(collections: CollectionsToSwap) {
  const pageAmount = figma.root.children.length
  for (let i = 0; i < pageAmount; i++) {
    const page = figma.root.children[i]
    state.currentPage = i + 1
    await swapPage(collections, page, { pageIndex: i + 1, pageAmount: pageAmount, scope: 'allPages' })
  }
}

/**
 * Checking if page is loaded and swapping variables on whole page
 * @param {CollectionsToSwap} collections — object containing source and destination collections
 * @param {PageNode} page – page to swap
 */
async function swapPage(collections: CollectionsToSwap, page: PageNode, progressOptions?: ProgressOptions) {
  if (page !== figma.currentPage)
    await page.loadAsync()
  c(`Current page: ${progressOptions.pageIndex}`)
  await swapNodes(collections, page.children, true, progressOptions)
}

/**
 * Main recursive function for swapping variables 
 * @param {CollectionsToSwap} collections — object containing source and destination collections
 * @param {SceneNode[]} nodes – nodes to affect
 */
async function swapNodes(collections: CollectionsToSwap, nodes, first = false, progressOptions?: ProgressOptions) {
  if (first) {
    c(`Swapping first nodes`)
    // Keeping it here for proper multipage work
    stopProgressNotification()
    if (progressOptions.scope !== 'styles') {
      // If styles, set this later
      state.nodesAmount = countChildren(nodes)
      c(state.nodesAmount)
      c(`Unfreeze nodes rate: ${state.nodesAmount * unfreezePercentage}`)
      setNodesToUnfreeze(state.nodesAmount * unfreezePercentage)
    }
    initProgressNotification(nodes, progressOptions)
    ts('mainThread')
    await wakeUpMainThread()
    ta('mainThread')

  }
  const nodeLength = nodes.length
  c(`Nodes to swap ↴`)
  c(nodes)
  for (let i = 0; i < nodeLength; i++) {
    const node = nodes[i]
    c(`Swapping node ${node.name}`)
    // Change explicit mode
    ts(`swappingModes`)
    swapMode(node, collections)
    ta('swappingModes')

    // Special text handling
    if (node.type === 'TEXT' && (node as TextNode).characters.length > 0) {
      ts('textHandling')
      await swapTextNode(node, collections)
      ta('textHandling')
    } else {
      // Non-text nodes
      for (let [property, value] of Object.entries(node.boundVariables || {})) {
        if (property === 'componentProperties') {
          await swapComponentProperty(node, value, collections)
        }
        else if (Array.isArray(value)) {
          // Complex immutable properties
          ts('swappingComplex')
          await swapComplexProperty(node, property, collections)
          ta('swappingComplex')

        }
        else {
          ts('swappingSimple')
          await swapSimpleProperty(node, value, property, collections)
          ta('swappingSimple')
        }
      }
    }

    state.nodesProcessed++
    if (state.nodesProcessed % getNodesToUnfreeze() === 0) {
      ts('mainThread')
      await wakeUpMainThread()
      ta('mainThread')
    }

    // Recursion
    if (node.children && node.children.length > 0) {
      c(`Got children`)
      await swapNodes(collections, node.children)
    }
  }
}


/**
 * Swapping explicit mode if source collection has mode with the same name 
 * @param {SceneNode} node – node that may have explicit mode
 * @param {CollectionsToSwap} collections — object containing source and destination collections
 */
async function swapMode(node: SceneNode, collections: CollectionsToSwap) {
  // If one mode in collection, no need to swap
  if (collections.from.modes.length === 1 || collections.to.modes.length === 1)
    return

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
    node.setExplicitVariableModeForCollection(collections.to.variableCollection, newMode.modeId)
  } catch {
  }
}

/**
 * Swap variables of text node
 * @param {SceneNode} node – node to affect
 * @param {CollectionsToSwap} collections — object containing source and destination collections
 */
async function swapTextNode(node: TextNode, collections: CollectionsToSwap) {
  try {
    c(`Working with text`)
    ts('textCheckingVariables')
    if (!Object.keys(node.boundVariables)) {
      c(`No variables`)
      return 'no variables'
    }
    ta('textCheckingVariables')

    // Checking if we need to load font
    ts(`loadingFonts`)
    if (Object.keys(node.boundVariables).find(el => affectingInitFont.includes(el))) {
      c(`Loading fonts ↴`)
      if (node.hasMissingFont) {
        error('badProp', { property: 'fontName', nodeName: node.name, nodeId: node.id })
        return 'badProp'
      }
      await Promise.all(
        node.getRangeAllFontNames(0, node.characters.length).map(async (fontName) => await loadFont(fontName, { name: node.name, id: node.id }))
      )
    }
    ta(`loadingFonts`)
    c(`Properties with variables ↴`)
    c(Object.keys(node.boundVariables))

    // Props that can't be mixed are stored in nonMixedProperties array
    ts('textSwappingNonMixed')
    c(`Not mixed properties`)
    for (const property of Object.keys(node.boundVariables).filter(el => !mixedProperties.includes(el))) {
      c(`Swapping ${property} of ${node.name}`)
      if (property === 'textRangeStrokes') {
        c(`Skipping ${property}`)
        continue
      }
      if (node[property].toString() === `Symbol(figma.mixed)`) {
        // Some other random props
        // error('mixed', { nodeName: node.name, nodeId: node.id })
        continue
      }
      else if (complexProperties.includes(property)) {
        ts('textSwappingComplex')
        await swapComplexProperty(node, property, collections)
        ta('textSwappingComplex')
      }
      else {
        ts('textSwappingSimple')
        await swapSimpleProperty(node, node.boundVariables[property][0] || node.boundVariables[property], property, collections)
        ta('textSwappingSimple')
      }
    }
    ta('textSwappingNonMixed')


    // Props that can be mixed
    ts('textSwappingMixed')
    c(`Mixed segments  ↴`)
    c(node.getStyledTextSegments(['boundVariables', 'fills', 'textStyleId', 'fillStyleId']))

    // Have no clue why fills aren't in bound variables. They surely should be
    for (const segment of node.getStyledTextSegments(['boundVariables', 'fills', 'textStyleId', 'fillStyleId'])) {
      c(`Current segment ↴`)
      c(segment)
      c('Segment bound variables ↴')
      c(segment.boundVariables)

      // Saving it to avoid unnecessary rechecks for every typo property
      let segmentHasTextStyle: boolean = undefined

      // Fills are not here!
      for (const [property, value] of Object.entries(segment.boundVariables)) {
        // Checking styles once per segment
        if (segmentHasTextStyle === undefined)
          segmentHasTextStyle = typographyProperties.includes(property) && segmentHasStyles(node, segment, 'typography')

        c(`Segment has text style: ${segmentHasTextStyle}`)
        if (!segmentHasTextStyle) {
          c(`Swapping ranged property ${property} of ${node.name}`)
          c(`Value ↴`)
          c(value)
          ts('textSwappingMixedSimple')
          // if (complexProperties.includes(property)) { }
          await swapSimpleProperty(node, value, property, collections, [segment.start, segment.end])
          ta('textSwappingMixedSimple')
        }
      }
      // Fills are here!
      if ('fills' in segment) {
        ts('textSwappingMixedFills')
        c(`Swapping ranged fills`)
        // We check it only once so no needs to store function value
        if (!segmentHasStyles(node, segment, 'fills')) {
          c(`No styles here`)
          c(segment.fills)
          const newPropertyLayers = await swapPropertyLayers(segment.fills, 'fills', collections, v.setBoundVariableForPaint, node)
          if (newPropertyLayers)
            node.setRangeFills(segment.start, segment.end, newPropertyLayers)
        }
        ta('textSwappingMixedFills')
      }
    }
    ta('textSwappingMixed')
  }
  catch (e) {
    notify(`Can't swap text node ${node.name}: ${e}`, { error: true })
  }
}

function segmentHasStyles(node: TextNode, segment: Pick<StyledTextSegment, "fills" | "characters" | "start" | "end">, type: 'fills' | 'typography') {
  // Yes I ✨architectured✨ one-case switch so what
  ts('textFindingStyleSegment')
  switch (type) {
    case 'fills':
      c(`Fill style from ${segment.start} to ${segment.end}: ${String(node.getRangeFillStyleId(segment.start, segment.end)) || 'Not found'}`)
      ta('textFindingStyleSegment')

      return node.getRangeFillStyleId(segment.start, segment.end) !== ''
    case 'typography':
      c(`Typo style from ${segment.start} to ${segment.end}: ${String(node.getRangeTextStyleId(segment.start, segment.end)) || 'Not found'}`)
      ta('textFindingStyleSegment')
      return node.getRangeTextStyleId(segment.start, segment.end) !== ''
    default:
      return false
  }

}

/**
 * Swapping local styles 
 * @param {CollectionsToSwap} collections — object containing source and destination collections
 */
async function swapStyles(collections: CollectionsToSwap) {
  stopProgressNotification()
  initProgressNotification(null, { scope: 'styles' })

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
    state.nodesAmount += styles.length
    c(`Got ${styles.length} ${styleName}`)
    for (const style of styles) {
      c(`Got style ${style.name}`)
      if (style.boundVariables && Object.entries(style.boundVariables).length > 0) {
        c(`Swapping`)
        style[reference.layersName] = await swapPropertyLayers(style[reference.layersName], reference.layersName, collections, reference.bindFunction, null, style)
        state.variablesProcessed++
      }
      state.nodesProcessed++
    }
  }
  setNodesToUnfreeze(state.nodesAmount * unfreezePercentage)


  // Text doesn't contain any layers so logic differs here
  const textStyles = await figma.getLocalTextStylesAsync()
  for (const style of textStyles) {
    c(`Got style ${style.name}`)
    c(`Bound variables ↴`)
    c(style.boundVariables)
    await loadFont(style.fontName, { name: style.name, id: style.id })

    for (const [field, variable] of Object.entries(style.boundVariables)) {
      c(`Setting field ${field}`)
      c(`Current variable ↴`)
      c(variable)
      const newVariable = await getNewVariable(variable, collections, null, style, field)
      if (!newVariable)
        continue
      if (field === 'fontFamily') {
        for (const family of Object.values(newVariable.valuesByMode)) {
          await loadFontsByFamily(family as string, state.availableFonts, { name: style.name, id: style.id })
        }
      }
      //@ts-ignore
      style.setBoundVariable(field, newVariable)
    }
  }
}

/**
 * Swap variable of simple property
 * @param {SceneNode} node – node to affect
 * @param value – current value
 * @param property – name of property to swap
 * @param {CollectionsToSwap} collections — object containing source and destination collections
 * @param range — range of application (for texts)
 */
async function swapSimpleProperty(node, value, property, collections, range = []) {
  ts('Swapping simple')
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
  time.swappingSimpleTime = te('Swapping simple', false)
  return OK
}

/**
 * Swap variable of complex property
 * @param {SceneNode} node – node to affect
 * @param property – name of property to swap
 * @param {CollectionsToSwap} collections — object containing source and destination collections
 */
async function swapComplexProperty(node, property: string, collections: CollectionsToSwap) {
  ts(`Swapping complex`)
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
  time.swappingComplexTime += te(`Swapping complex`, false)
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
        time.layerCount++
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
            ts('Bounding complex')
            layer = bindFunction(layer, field, newVariable)
            time.boundingComplexTime += te('Bounding complex', false)
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
 * @param {CollectionsToSwap} collections — object containing source and destination collections
 */
async function swapComponentProperty(node, value, collections: CollectionsToSwap) {
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

    // IDK Figma why I have to detach the variable first
    node.setProperties({ [propertyName]: node.variantProperties[propertyName] })
    // And then attach new variable
    node.setProperties({ [propertyName]: v.createVariableAlias(newVariable) })
  }
}


async function getNewVariable(variable, collections: CollectionsToSwap, node, style?, property?) {
  // Resolving variable if it's an alias
  // Cheking by property that doesn't exists in aliases
  const resolvedVariable = variable?.resolvedType ? variable : await v.getVariableByIdAsync(variable.id)
  c(`Source variable ↴`)
  c(resolvedVariable)
  try {
    resolvedVariable.variableCollectionId
  }
  catch (e) {
    error('noVariable', { variableId: variable.id, nodeName: node?.name || style?.name || null, nodeId: node?.id || style?.id || null, property: property })
    return
  }

  if (!collections.from.id.includes(resolvedVariable.variableCollectionId.match(rCollectionId)?.[1])) {
    c(`Variable doesn't belong to source collection`)
    return
  }

  c(`Variable belongs to source collection`)
  let newVariable
  try {
    newVariable = await findVariable(collections.to, resolvedVariable)
    state.variablesProcessed++
  }
  catch {
    let value = node ?
      resolvedVariable.resolveForConsumer(node).value : '?'

    if (resolvedVariable.resolvedType === 'COLOR') {
      value = figmaRGBToHex(value as RGB | RGBA)
    }
    error('noMatch', { name: resolvedVariable.name, type: resolvedVariable.resolvedType, value: value, nodeName: node?.name || style?.name || null, nodeId: node?.id || style?.id || null })
  }

  return newVariable || resolvedVariable
}


/**
 * Finds a variable within a given collection.
 *
 * @param {Collection} collection - The collection to search within.
 * @param {Variable} variable - The variable to find.
 * @returns {Promise<Variable>} - A promise that resolves to the found variable.
 */
async function findVariable(collection: Collection, variable: Variable): Promise<Variable> {
  ts('Finding')
  const name = variable.name
  c(`Destination is local: ${collection.local}`)

  let newVariable: Variable
  if (useMap) {
    newVariable = state.toVariablesMap.get(name)
  } else {
    newVariable = state.toVariables.find(el => el.name === name)
  }

  c(`Found new ${newVariable.name} with id ${newVariable.id} ↴`)
  c(newVariable)
  time.findingTime += te('Finding', false)
  return newVariable
}

async function saveSize(width, height, resized = true) {
  figma.clientStorage.setAsync(storage.uiWidth, width)
  figma.clientStorage.setAsync(storage.uiHeight, height)
  figma.clientStorage.setAsync(storage.resized, resized)
}



// Ending the work
function finish(newCollection = null, message?: string) {
  showTimers()
  // Killing work notification
  stopProgressNotification()

  // Sending finish message
  figma.ui.postMessage({ type: 'finish', message: { errors: errors, newCollection: newCollection } })

  showFinishNotification(message)

  c(`Count: ${state.variablesProcessed}`)
  // Expanding to show some errors
  if (errorCount > 0) {
    if (!ui.resized)
      figma.ui.resize(ui.width, ui.height + 60)
    console.error(errors)
  }
  else if (!ui.resized)
    figma.ui.resize(ui.width, ui.height)
  te('Whole swap')

}

// Showing interruption notification
function cancel() {
  clearNotifications()
  stopProgressNotification()
  finish(state.collectionsToSwap.to || null,)
}

async function close() {
  clearNotifications()
  // Saving the date of last launch
  await figma.clientStorage.setAsync(storage.lastLaunch, Date.now())
}

function stub(...args) {
  return 0
}