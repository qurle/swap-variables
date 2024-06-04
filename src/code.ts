// Disclamer: I am not a programmer. Read at yor risk
const LOGS = false
const TIMERS = false

import { Scope, Collection, Collections, Errors } from './types'
import { figmaRGBToHex } from './utils'
import { cloneVariables } from './clone'

// Constants
const actionMsgs = ["Swapped", "Affected", "Made it with", "Fixed", "Updated"]
const idleMsgs = ["No variables swapped", "Nothing changed", "Any layers to affect? Can't see it", "Nothing to do"]
const complexProperties = ['fills', 'strokes', 'layoutGrids', 'effects']
const typographyProperties = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'paragraphIndent']
const mixedProperties = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing']
const affectingInitFont = ['characters', 'fontSize', 'fontName', 'textStyleId', 'textCase', 'textDecoration', 'letterSpacing', 'leadingTrim', 'lineHeight']
const notAffectingFont = ['fills', 'fillStyleId', 'strokes', 'strokeWeight', 'strokeAlign', 'strokeStyleId']

const rCollectionId = /(VariableCollectionId:(?:\w|:)*)(?:\/[0-9]*:[0-9]*)?/
const rVariableId = /(VariableId:(?:\w|:)*)(?:\/[0-9]*:[0-9]*)?/

const uiSize = { width: 300, height: 353 }
// Idk why I made this
const OK = -1

// Variables
let notification: NotificationHandler
let working: boolean
let count: number
let times = new Map()
let collections
let errors: Errors = {
  limitation: [],
  noMatch: [],
  mixed: [],
  badProp: [],
  unsupported: []
}
let gotErrors = false

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
        noMatch: [],
        mixed: [],
        badProp: [],
        unsupported: []
      }

      count = 0

      notification = figma.notify('Working...', { timeout: Infinity })
      const selection = figma.currentPage.selection
      const nodes = selection && selection.length > 0 ? selection : figma.currentPage.children

      const collections: Collections = msg.message.collections
      c(`Collections to swap ↴`)
      c(collections)
      const newCollection = collections.to === null
      const scope: Scope = msg.message.scope
      c(`Scope of swapping ↴`)
      c(scope)

      await figma.clientStorage.setAsync('scope', scope)

      if (newCollection) {
        collections.to = await cloneVariables(collections.from)
        c(`Cloned variables`)
      }
      const message = await startSwap(collections, scope)

      finish(newCollection ? collections.to : null, message)
      break

    case 'goToNode': {
      const node = await figma.getNodeByIdAsync(msg.message.nodeId)
      figma.viewport.scrollAndZoomIntoView([node])
      figma.currentPage.selection = [node as SceneNode]
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
 * @param {Collections} collections — object containing source and destionation collections
 * @param {Scope} scope — selection, current page or all pages
 */
async function startSwap(collections: Collections, scope: Scope) {
  switch (scope) {
    case 'all':
      await swapAll(collections)
      break
    case 'page':
      await swapPage(collections, figma.currentPage)
      break
    case 'selection':
      const selection = figma.currentPage.selection
      if (selection.length > 0)
        await swapNodes(collections, selection)
      else
        return 'No layers selected'
      break
  }
}

/**
 * Swapping all the pages
 * @param {Collections} collections — object containing source and destionation collections
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
 * @param {Collections} collections — object containing source and destionation collections
 * @param {PageNode} page – page to swap
 */
async function swapPage(collections: Collections, page: PageNode) {
  if (page !== figma.currentPage)
    await page.loadAsync()
  await swapNodes(collections, page.children)
}

/**
 * Main recursive function for swapping variables 
 * @param {Collections} collections — object containing source and destionation collections
 * @param {SceneNode[]} nodes – nodes to affect
 */
async function swapNodes(collections: Collections, nodes) {
  // try {
  for (const node of nodes) {
    // Change explicit mode
    swapMode(node, collections)

    // Special text handling
    if (node.type === 'TEXT') {
      await swapTextNode(node, collections)
    } else {

      for (let [property, value] of Object.entries(node.boundVariables || {})) {

        if (property === 'componentProperties') {
          await swapComponentProperty(node, value, collections)
          return
        }

        // Complex immutable properties
        if (Array.isArray(value)) {
          await swapComplexProperty(node, property, collections)
        }
        else {
          await swapSimpleProperty(node, value, property, collections)
        }
      }

      node.setRelaunchData({ relaunch: '' })
      node.setPluginData('currentCollectionKey', collections.to.key)

      // Recursion
      if (node.children && node.children.length > 0) {
        await swapNodes(collections, node.children)
      }
    }
  }
  // } catch (e) {
  //   figma.closePlugin(`${e}`)
  // }
}

/**
 * Swapping explicit mode if source collection has mode with the same name 
 * @param {SceneNode} node – node that may have explicit mode
 * @param {Collections} collections — object containing source and destionation collections
 */
async function swapMode(node, collections) {
  const explicitMode = (node.explicitVariableModes[collections.from.id])
  c(`Explicit mode ↴`)
  c(explicitMode)
  if (!explicitMode)
    return

  c(`Current collection ↴`)
  c(collections.from)
  c(`Current modes ↴`)
  c(collections.from.modes)
  const currentMode = collections.from.modes.find(mode => mode.modeId === explicitMode)
  c(`Mode to swap: ${currentMode.name}`)
  if (!currentMode)
    return

  c(`New mode: ${collections.to.modes.find(mode => mode.name === currentMode.name)}`)
  const newMode = collections.to.modes.find(mode => mode.name === currentMode.name)
  if (!newMode) {
    error('noMatch', { name: `Mode "${currentMode.name}"`, type: 'STRING', value: '?', nodeName: node.name, nodeId: node.id })
    return
  }

  node.setExplicitVariableModeForCollection(collections.to, newMode.modeId)
}

/**
 * Swap variables of text node
 * @param {SceneNode} node – node to affect
 * @param {Collections} collections — object containing source and destionation collections
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
    node.getRangeAllFontNames(0, node.characters.length).map(figma.loadFontAsync)
  }

  // Props that can't be mixed are stored in nonMixedProperties array
  for (const property of Object.keys(node.boundVariables).filter(el => !mixedProperties.includes(el))) {
    if (property === 'textRangeFills' || property === 'textRangeStrokes') continue
    c(`Swapping ${property} of ${node.name}`)
    if (node[property].toString() === `Symbol(figma.mixed)`) {
      error('mixed', { nodeName: node.name, nodeId: node.id })
      continue
    }
    if (complexProperties.includes(property))
      await swapComplexProperty(node, property, collections)
    else
      await swapSimpleProperty(node, node.boundVariables[property][0], property, collections)
  }

  // Props that can be mixed
  for (const segment of node.getStyledTextSegments(['boundVariables'])) {
    for (const [property, value] of Object.entries(segment.boundVariables)) {
      if (complexProperties.includes(property)) { }
      await swapSimpleProperty(node, value, property, collections, [segment.start, segment.end])
    }
  }
}

let swappingSimpleTime = 0

/**
 * Swap variable of simple property
 * @param {SceneNode} node – node to affect
 * @param value – current value
 * @param property – name of property to swap
 * @param {Collections} collections — object containing source and destionation collections
 * @param range — range of application (for texts)
 */
async function swapSimpleProperty(node, value, property, collections, range = []) {
  time('Swapping simple')
  c(`Swapping simple property: ${property}`)
  c(`Current value:`)
  c(node[property])
  const newVariable = await getNewVariable(value as Variable, collections, node)
  if (newVariable) {
    if (property === 'characters' && newVariable.resolvedType === 'FLOAT') {
      error("unsupported", { property: property, nodeName: node.name, type: node.type, nodeId: node.id })
      return 'unsupported'
    }
    // Text
    if (range.length > 0) {
      c(`Setting ranged variable from ${node.characters[range[0]]}:${range[0]} to ${node.characters[range[1] - 1]}:${range[1] - 1}`)
      node.setRangeBoundVariable(range[0], range[1], property, newVariable)
    }
    node.setBoundVariable(property, newVariable)
  }
  swappingSimpleTime = timeEnd('Swapping simple', false)
  return OK
}

let swappingComplexTime = 0
let boundingComplexTime = 0
let layers = 0

/**
 * Swap variable of complex property
 * @param {SceneNode} node – node to affect
 * @param property – name of property to swap
 * @param {Collections} collections — object containing source and destionation collections
 */
async function swapComplexProperty(node, property: string, collections: Collections) {
  time('Swapping complex')
  let setBoundVarible
  c(`Swapping complex property: ${property}`)

  switch (property) {
    case 'fills':
      setBoundVarible = v.setBoundVariableForPaint
      break
    case 'strokes':
      if (node.type === 'SECTION') {
        // Strokes are not supported for sections with Figma Plugin API
        // https://forum.figma.com/t/why-are-strokes-not-available-on-section-nodes/41658
        error('unsupported', { property: property, nodeName: node.name, type: node.type, nodeId: node.id })
        return
      }
      else
        setBoundVarible = v.setBoundVariableForPaint
      break
    case 'layoutGrids':
      setBoundVarible = v.setBoundVariableForLayoutGrid
      break
    case 'effects':
      setBoundVarible = v.setBoundVariableForEffect
      break
    default:
      error('badProp', { property: property, nodeName: node.name, nodeId: node.id })
      return
  }

  // Swapping by layers
  node[property] = await Promise.all(
    node[property].map(async (layer) => {
      layers++
      c(`Current layer ↴`)
      c(layer)
      if (!('boundVariables' in layer) || Object.entries(layer.boundVariables).length === 0)
        return layer

      c(`Found ${Object.entries(layer.boundVariables).length} variables`)
      for (const [field, variable] of Object.entries(layer.boundVariables)) {
        const newVariable = await getNewVariable(variable, collections, node)
        if (newVariable) {
          c('found new variable')
          time('Bounding complex')
          layer = setBoundVarible(layer, field, newVariable)
          boundingComplexTime += timeEnd('Bounding complex', false)
        }
      }
      return layer
    }))
  swappingComplexTime += timeEnd('Swapping complex', false)
}

/**
 * Swap variable of instance variant property
 * @param {SceneNode} node – node to affect
 * @param value – current value
 * @param {Collections} collections — object containing source and destionation collections
 */
async function swapComponentProperty(node, value, collections: Collections) {
  for (const [propertyName, variable] of Object.entries(value)) {
    c(`Property ↴`)
    c(propertyName)
    c(`Value ↴`)
    c(value)

    if (!Object.keys(node.componentProperties).includes(propertyName))
      continue

    const newVariable = await getNewVariable(variable, collections, node)

    if (!newVariable)
      continue
    node.setProperties({ [propertyName]: v.createVariableAlias(newVariable) })
  }
}


async function getNewVariable(variable, collections: Collections, node) {
  const variableObject = await v.getVariableByIdAsync(variable.id)
  c(`Source variable ↴`)
  c(variableObject)
  if (!collections.from.id.includes(variableObject.variableCollectionId.match(rCollectionId)?.[1])) {
    c(`Variable doesn't belong to source collection`)
    return
  }

  c(`Varaible belongs to source collection`)
  let newVariable
  try {
    newVariable = await findVariable(collections.to, variableObject)
    count++
  }
  catch {
    let { value, resolvedType } = variableObject.resolveForConsumer(node)
    if (resolvedType === 'COLOR') {
      value = figmaRGBToHex(value as RGB | RGBA)
    }
    error('noMatch', { name: variableObject.name, type: resolvedType, value: value, nodeName: node.name, nodeId: node.id })
  }

  return newVariable || variableObject
}

let findingTime = 0
async function findVariable(collection, variable) {
  time('Finding')
  const name = variable.name
  c(`Destination is local: ${collection.local}`)

  const newVariable = collection.local === true ?
    (await v.getLocalVariablesAsync()).find(el => el.variableCollectionId === collection.id && el.name === variable.name) :
    await v.importVariableByKeyAsync((await tl.getVariablesInLibraryCollectionAsync(collection.key)).find(el => el.name === name).key)
  c(`Found new ${newVariable.name} with id ${newVariable.id}`)
  findingTime += timeEnd('Finding', false)
  return newVariable
}

export function error(type: 'limitation' | 'noMatch' | 'mixed' | 'badProp' | 'unsupported', options) {
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
  }
  errors[type].push(options)
  c(`Can't swap ${type === 'noMatch' ? `variable ${options.name} for ` : `${options.property} of ${options.nodeName}`}: ${type}`, 'error')
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
    notify(`${actionMsgs[Math.floor(Math.random() * actionMsgs.length)]} ${count} variable${(count === 1 ? "." : "s.")}`
      + gotErrors ? ` Got ${errorCount} error${errorCount === 1 ? "." : "s."}` : '')
  }
  else
    notify(`${idleMsgs[Math.floor(Math.random() * idleMsgs.length)]} ${count} variable${(count === 1 ? "." : "s.")}`
      + gotErrors ? ` Got ${errorCount} error${errorCount === 1 ? "." : "s."}` : '')

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
  c(`⏱️ Swapping simple: ${swappingSimpleTime}`)
  c(`⏱️ Bounding complex: ${boundingComplexTime}`)
  c(`Time per layer: ${Math.round(boundingComplexTime / layers)}`)
  c(`⏱️ Swapping complex: ${swappingComplexTime}`)
  c(`Time per layer: ${Math.round(swappingComplexTime / layers)}`)
  c(`⏱️ Finding: ${findingTime}`)
  c(`Time per variable: ${Math.round(findingTime / count)}`)
  swappingSimpleTime = 0
  swappingComplexTime = 0
  boundingComplexTime = 0
  findingTime = 0
  layers = 0
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