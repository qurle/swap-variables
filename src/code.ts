const LOGS = false
const TIMERS = false

import { Libs, Errors } from './types'
import { figmaRGBToHex } from './utils'

// Constants
const actionMsgs = ["Swapped", "Affected", "Made it with", "Fixed", "Updated"]
const idleMsgs = ["No variables swapped", "Nothing changed", "Any layers to affect? Can't see it", "Nothing to do"]
const uiSize = { width: 300, height: 300 }
let times = new Map()
let addTimes = new Map()

// Variables
let notification: NotificationHandler
let working: boolean
let count: number
let libraries
let errors: Errors = {
  noMatch: [],
  mixed: [],
  badProp: [],
  unsupported: []
}
let gotErrors = false

// Cancel on page change
figma.on("currentpagechange", cancel)

// Connect with UI
figma.showUI(__html__, { themeColors: true, width: uiSize.width, height: uiSize.height, })

figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case 'swap':

      errors = {
        noMatch: [],
        mixed: [],
        badProp: [],
        unsupported: []
      }

      count = 0

      notification = figma.notify('Working...', { timeout: Infinity })
      const selection = figma.currentPage.selection
      const nodes = selection && selection.length > 0 ? selection : figma.currentPage.children

      await swap(msg.message, nodes)
      nodes.forEach(node => {
        node.setRelaunchData({ relaunch: '' })
        node.setPluginData('currentLibKey', msg.message.to.key)
      })

      finish()
      break

    case 'goToNode': {
      figma.viewport.scrollAndZoomIntoView([await figma.getNodeByIdAsync(msg.message.nodeId)])
      break
    }
  }
}

// Engine start
figma.ui.postMessage("started")
run(figma.currentPage)

async function run(node: SceneNode | PageNode) {
  libraries = await getLibraries()

  time('Getting current lib')
  const selection = figma.currentPage.selection
  const nodes = selection && selection.length > 0 ? selection : figma.currentPage.children
  let currentLibKey = nodes[0].getPluginData('currentLibKey')
  currentLibKey = nodes.every((el) => el.getPluginData('currentLibKey') === currentLibKey) ? currentLibKey : null
  timeEnd('Getting current lib')

  figma.ui.postMessage({ type: 'libs', message: { libs: libraries, current: currentLibKey } })
}

async function getLibraries() {
  time('Getting internal libs')
  const localCollections = (await figma.variables.getLocalVariableCollectionsAsync()).filter(el => el.variableIds.length > 0).map(el => ({ key: el.key, libraryName: 'Local Collections', name: el.name, id: el.id, local: true }))
  timeEnd('Getting internal libs')

  time('Getting external libs')
  const allExternalCollections = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()

  // Non empty collections
  const externalCollections = []
  for (const library of allExternalCollections) {
    const variables = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(library.key)
    if (variables.length > 0) {
      externalCollections.push(library)
      library['id'] = (await figma.variables.importVariableByKeyAsync(variables[0].key)).variableCollectionId
      library['local'] = false
    }
  }
  timeEnd('Getting external libs')

  const collections = [...externalCollections, ...localCollections]
  c(collections)
  return collections
}

let swappingSimpleTime = 0
async function swap(libs: Libs, nodes) {
  c(`Libs to swap ↴`)
  c(libs)
  for (const node of nodes) {
    c(`swapping ${node.name}`)
    for (const [property, value] of Object.entries(node.boundVariables)) {
      // Complex immutable properties
      if (Array.isArray(value)) {
        await swapComplex(node, property, libs)
      }
      // Simple properties
      else {
        time('Swapping simple')
        c(`swapping ${property}`)
        const newVariable = await getNewVariable(value as Variable, libs, node)
        if (newVariable) {
          if (node.type === 'TEXT' && newVariable.resolvedType === 'FLOAT') {
            error("unsupported", { property: property, nodeName: node.name, type: node.type, nodeId: node.id })
            break
          }
          node.setBoundVariable(property, newVariable)
        }
        swappingSimpleTime = timeEnd('Swapping simple', false)
      }
    }

    // Recursion
    if (node.children && node.children.length > 0) {
      await swap(libs, node.children)
    }
  }
}

let swappingComplexTime = 0
let boundingComplexTime = 0
let layers = 0
async function swapComplex(node, property: string, libs: Libs) {
  time('Swapping complex')
  let setBoundVarible
  c('swapping complex ' + property)
  switch (property) {
    case 'fills':
      if (node[property].toString() === `Symbol(figma.mixed)`) {
        error('mixed', { nodeName: node.name, nodeId: node.id })
        return
      }
      setBoundVarible = figma.variables.setBoundVariableForPaint
      break
    case 'strokes':
      if (node.type === 'SECTION') {
        // Strokes are not supported for sections with Figma Plugin API
        // https://forum.figma.com/t/why-are-strokes-not-available-on-section-nodes/41658
        error('unsupported', { property: property, nodeName: node.name, type: node.type, nodeId: node.id })
        return
      }
      else
        setBoundVarible = figma.variables.setBoundVariableForPaint
      break
    case 'layoutGrids':
      setBoundVarible = figma.variables.setBoundVariableForLayoutGrid
      break
    case 'effects':
      setBoundVarible = figma.variables.setBoundVariableForEffect
      break
    case 'textRangeFills':
    case 'textRangeStrokes':
      c(`skipping ${property}`)
      // error('mixed', { nodeName: node.name, nodeId: node.id })
      return
    default:
      error('badProp', { property: property, nodeName: node.name, nodeId: node.id })
      return
  }

  node[property] = await Promise.all(
    node[property].map(async (layer) => {
      layers++
      c(`Found ${Object.entries(layer.boundVariables).length} variables`)
      if (Object.entries(layer.boundVariables).length === 0)
        return layer

      for (const [field, variable] of Object.entries(layer.boundVariables)) {
        const newVariable = await getNewVariable(variable, libs, node)
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

async function getNewVariable(variable, libs: Libs, node) {
  const variableObject = await figma.variables.getVariableByIdAsync(variable.id)
  c(`Swapping ↴`)
  c(variableObject)
  if (variableObject.variableCollectionId !== libs.from.id)
    return

  let newVariable
  try {
    newVariable = await findVariable(libs.to, variableObject)
    count++
  }
  catch {
    let { value, resolvedType } = variableObject.resolveForConsumer(node)
    if (resolvedType === 'COLOR') {
      value = figmaRGBToHex(value as RGB | RGBA)
    }
    error('noMatch', { name: variableObject.name, type: resolvedType, value: value, nodeId: node.id })
  }

  return newVariable || variableObject
}

let findingTime = 0
async function findVariable(lib, variable) {
  time('Finding')
  const name = variable.name
  c(`Is local: ${lib.local}`)

  const newVariable = lib.local === true ?
    (await figma.variables.getLocalVariablesAsync()).find(el => el.variableCollectionId === lib.id && el.name === variable.name) :
    await figma.variables.importVariableByKeyAsync((await figma.teamLibrary.getVariablesInLibraryCollectionAsync(lib.key)).find(el => el.name === name).key)
  c(`Found new ${newVariable.name} with id ${newVariable.id}`)
  findingTime += timeEnd('Finding', false)
  return newVariable
}

function error(type: 'noMatch' | 'mixed' | 'badProp' | 'unsupported', options) {
  gotErrors = true
  if (!errors[type])
    errors[type] = new Array()

  // Exceptions (don't write same errors)
  switch (type) {
    case 'noMatch':
      if (errors[type].findIndex(el => el.name === options.name) >= 0)
        return
      break
    case 'mixed':
      if (errors[type].findIndex(el => el.nodeName === options.nodeName) >= 0)
        return
      break
    case 'badProp':
      if (errors[type].findIndex(el => el.nodeName === options.nodeName && el.property === options.property) >= 0)
        return
      break
    case 'unsupported':
      if (errors[type].findIndex(el => el.nodeName === options.nodeName && el.property === options.property) >= 0)
        return
      break
  }

  errors[type].push(options)

}

// Ending the work
function finish() {
  showTimers()
  figma.ui.postMessage({ type: 'finish' })
  figma.ui.postMessage({ type: 'errors', message: errors })
  const errorCount = Object.values(errors).reduce((acc, err) => acc + err.length, 0)

  if (errorCount > 0)
    figma.ui.resize(uiSize.width + 16, uiSize.height + 60)
  else
    figma.ui.resize(uiSize.width, uiSize.height)

  working = false
  if (count > 0) {
    notify(actionMsgs[Math.floor(Math.random() * actionMsgs.length)] +
      " " + (count + " variable") + (count === 1 ? "." : "s.") +
      " Got " + (errorCount + " error") + (errorCount === 1 ? "." : "s."))
  }
  else notify(idleMsgs[Math.floor(Math.random() * idleMsgs.length)] +
    " Got " + (errorCount + " error") + (errorCount === 1 ? "." : "s."))

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
  console.log(`⏱️ Swapping simple: ${swappingSimpleTime}`)
  console.log(`⏱️ Bounding complex: ${boundingComplexTime}`)
  console.log(`Time per layer: ${Math.round(boundingComplexTime / layers)}`)
  console.log(`⏱️ Swapping complex: ${swappingComplexTime}`)
  console.log(`Time per layer: ${Math.round(swappingComplexTime / layers)}`)
  console.log(`⏱️ Finding: ${findingTime}`)
  console.log(`Time per variable: ${Math.round(findingTime / count)}`)
  swappingSimpleTime = 0
  swappingComplexTime = 0
  boundingComplexTime = 0
  findingTime = 0
  layers = 0
}

function c(str: any = 'here', type?) {
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

