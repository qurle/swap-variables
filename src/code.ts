const LOGS = false

import { Libs, Errors } from './types'
import { figmaRGBToHex } from './utils'

// Constants
const actionMsgs = ["Swapped", "Affected", "Made it with", "Fixed", "Updated"]
const idleMsgs = ["No variables swapped", "Nothing changed", "Any layers to affect? Can't see it", "Nothing to do"]
const uiSize = { width: 300, height: 300 }

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
let nodesCount: number = 0

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

      notify('Working...')
      const selection = figma.currentPage.selection
      const nodes = selection && selection.length > 0 ? selection : figma.currentPage.children

      nodesCount = 0
      recursiveCount(nodes)

      await swap(msg.message, nodes)
      nodes.forEach(node => { node.setRelaunchData({ relaunch: '' }) })
      finish()
      break
    case 'goToNode': {
      figma.viewport.scrollAndZoomIntoView([figma.getNodeById(msg.message.nodeId)])
      break
    }
    case 'finished': // Real plugin finish (after server's last response)
      figma.closePlugin()
  }
}

// Engine start
figma.ui.postMessage("started")
run(figma.currentPage)

async function run(node: SceneNode | PageNode) {
  libraries = await getLibraries()
  figma.ui.postMessage({ type: 'libs', message: libraries })
}

async function getLibraries() {
  const localCollections = figma.variables.getLocalVariableCollections().filter(el => el.variableIds.length > 0).map(el => ({ key: el.key, libraryName: 'Local Collections', name: el.name, local: true }))
  const allExternalCollections = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()

  // Non empty collections
  const externalCollections = []
  for (const library of allExternalCollections) {
    if ((await figma.teamLibrary.getVariablesInLibraryCollectionAsync(library.key)).length > 0) {
      externalCollections.push(library)
    }
  }
  const collections = [...externalCollections, ...localCollections]
  console.log(collections)
  return collections
}

async function swap(libs: Libs, nodes) {
  for (const node of nodes) {
    c(`swapping ${node.name}`)
    for (const [property, value] of Object.entries(node.boundVariables)) {
      // Complex immutable properties
      if (Array.isArray(value)) {
        await swapComplex(node, property, libs)
      }
      // Simple properties
      else {
        const newVariable = await getNewVariable(value as Variable, libs, node)
        if (newVariable) {
          if (node.type === 'TEXT' && newVariable.resolvedType === 'FLOAT') {
            error("unsupported", { property: property, nodeName: node.name, type: node.type, nodeId: node.id })
            break
          }
          node.setBoundVariable(property, newVariable.id)
          count++
        }
      }
    }

    // Recursion
    if (node.children && node.children.length > 0) {
      await swap(libs, node.children)
    }
  }
}

function recursiveCount(nodes) {
  nodesCount++
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      recursiveCount(node.children)
    }
  }
}

async function swapComplex(node, property: string, libs: Libs) {

  let setBoundVarible
  switch (property) {
    case 'fills':
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
      error('mixed', { nodeName: node.name, nodeId: node.id })
      return
    default:
      error('badProp', { property: property, nodeName: node.name, nodeId: node.id })
      return
  }


  node[property] = await Promise.all(
    node[property].map(async (layer) => {
      if (Object.entries(layer.boundVariables).length === 0)
        return layer

      for (const [field, variable] of Object.entries(layer.boundVariables)) {
        const newVariable = await getNewVariable(variable, libs, node)
        if (newVariable) {
          c('Bounding to')
          c(layer)
          c(newVariable)
          count++
          return setBoundVarible(layer, field, newVariable)
        }
        return layer
      }
    }))
}

async function getNewVariable(variable, libs: Libs, node) {
  variable = figma.variables.getVariableById(variable.id)
  if (getCollectionKey(variable) !== libs.from.key)
    return

  let newVariable
  try {
    newVariable = await findVariable(libs.to, variable,)
    c(`New variable`)
    c(newVariable)

  }
  catch {
    let { value, resolvedType } = variable.resolveForConsumer(node)
    if (resolvedType === 'COLOR') {
      value = figmaRGBToHex(value)
    }
    error('noMatch', { name: variable.name, type: resolvedType, value: value, nodeId: node.id })
  }

  return newVariable || variable
}

async function findVariable(lib, variable) {
  c(`Looking for new ${variable.name} at ${lib.key}`)
  const name = variable.name
  c(lib)
  const newVariable = lib.local === 'true' ?
    figma.variables.getVariableById(figma.variables.getLocalVariableCollections().find(c => c.key === lib.key).variableIds.find(vId => figma.variables.getVariableById(vId).name === variable.name)) :
    await figma.variables.importVariableByKeyAsync((await figma.teamLibrary.getVariablesInLibraryCollectionAsync(lib.key)).find(el => el.name === name).key)
  return newVariable
}

function getCollectionKey(variable) {
  const variableId = (typeof variable === 'string') ? variable : variable.id
  const collectionId = figma.variables.getVariableById(variableId).variableCollectionId
  return figma.variables.getVariableCollectionById(collectionId).key
}

function error(type: 'noMatch' | 'mixed' | 'badProp' | 'unsupported', options) {
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
  figma.ui.postMessage({ type: 'errors', message: errors })
  const errorCount = Object.values(errors).reduce((acc, err) => acc + err.length, 0)

  if (errorCount > 0)
    figma.ui.resize(uiSize.width + 16, uiSize.height + 60)
  else
    figma.ui.resize(uiSize.width, uiSize.height)

  working = false
  figma.root.setRelaunchData({ relaunch: '' })
  if (count > 0) {
    notify(actionMsgs[Math.floor(Math.random() * actionMsgs.length)] +
      " " + (count + " variable") + (count === 1 ? "." : "s.") +
      " Got " + (errorCount + " error") + (errorCount === 1 ? "." : "s."))
  }
  else notify(idleMsgs[Math.floor(Math.random() * idleMsgs.length)] +
    " Got " + (errorCount + " error") + (errorCount === 1 ? "." : "s."))

  console.log(errors)
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