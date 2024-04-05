const LOGS = true
const TIMERS = true

import { Collection, Collections, Errors } from './types'
import { figmaRGBToHex } from './utils'
import { cloneVariables } from './clone'

// Constants
const actionMsgs = ["Swapped", "Affected", "Made it with", "Fixed", "Updated"]
const idleMsgs = ["No variables swapped", "Nothing changed", "Any layers to affect? Can't see it", "Nothing to do"]
const uiSize = { width: 300, height: 300 }
let times = new Map()

// Variables
let notification: NotificationHandler
let working: boolean
let count: number
let collections
let errors: Errors = {
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
        noMatch: [],
        mixed: [],
        badProp: [],
        unsupported: []
      }

      count = 0

      notification = figma.notify('Working...', { timeout: Infinity })
      const selection = figma.currentPage.selection
      const nodes = selection && selection.length > 0 ? selection : figma.currentPage.children

      const collections: Collections = msg.message
      c(`Collections to swap ↴`)
      c(collections)
      const newCollection = collections.to === null

      if (newCollection) {
        collections.to = await cloneVariables(collections.from)
        c(`Cloned variables`)
      }

      await swap(collections, nodes)
      nodes.forEach(node => {
        node.setRelaunchData({ relaunch: '' })
        node.setPluginData('currentCollectionKey', msg.message.to.key)
      })

      finish(newCollection ? collections.to : null)
      break


    case 'goToNode': {
      const node = await figma.getNodeByIdAsync(msg.message.nodeId)
      figma.viewport.scrollAndZoomIntoView([node])
      notify(`Going to ${node.name}`)
      break
    }
  }
}

// Engine start
figma.ui.postMessage("started")
run(figma.currentPage)

async function run(node: SceneNode | PageNode) {
  collections = await getCollections()

  time('Getting current collection')
  const selection = figma.currentPage.selection
  const nodes = selection && selection.length > 0 ? selection : figma.currentPage.children
  let currentCollectionKey = nodes[0].getPluginData('currentCollectionKey')
  currentCollectionKey = nodes.every((el) => el.getPluginData('currentCollectionKey') === currentCollectionKey) ? currentCollectionKey : null
  timeEnd('Getting current collection')

  figma.ui.postMessage({ type: 'collections', message: { collections: collections, current: currentCollectionKey } })
}

async function getCollections() {
  time('Getting internal collections')
  const localCollections = (await v.getLocalVariableCollectionsAsync()).filter(el => el.variableIds.length > 0).map(el => ({ key: el.key, lib: 'Local Collections', name: el.name, id: el.id, local: true }))
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
      collection['id'] = (await v.importVariableByKeyAsync(variables[0].key)).variableCollectionId
      collection['local'] = false
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



let swappingSimpleTime = 0
async function swap(collections: Collections, nodes) {

  for (const node of nodes) {
    c(`swapping ${node.name}`)
    for (const [property, value] of Object.entries(node.boundVariables || {})) {
      // Complex immutable properties
      if (Array.isArray(value)) {
        await swapComplex(node, property, collections)
      }
      // Simple properties
      else {
        time('Swapping simple')
        c(`swapping ${property}`)
        const newVariable = await getNewVariable(value as Variable, collections, node)
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
      await swap(collections, node.children)
    }
  }
}

let swappingComplexTime = 0
let boundingComplexTime = 0
let layers = 0

async function swapComplex(node, property: string, collections: Collections) {
  time('Swapping complex')
  let setBoundVarible
  c('swapping complex ' + property)
  switch (property) {
    case 'fills':
      if (node[property].toString() === `Symbol(figma.mixed)`) {
        error('mixed', { nodeName: node.name, nodeId: node.id })
        return
      }
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

async function getNewVariable(variable, collections: Collections, node) {
  const variableObject = await v.getVariableByIdAsync(variable.id)
  c(`Swapping ↴`)
  c(variableObject)
  if (variableObject.variableCollectionId !== collections.from.id) {
    c(`Varaible not exists in source collection`)
    return
  }

  c(`Varaible exists in source collection`)
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
    error('noMatch', { name: variableObject.name, type: resolvedType, value: value, nodeId: node.id })
  }

  return newVariable || variableObject
}

let findingTime = 0
async function findVariable(collection, variable) {
  time('Finding')
  const name = variable.name
  c(`Is local: ${collection.local}`)

  const newVariable = collection.local === true ?
    (await v.getLocalVariablesAsync()).find(el => el.variableCollectionId === collection.id && el.name === variable.name) :
    await v.importVariableByKeyAsync((await tl.getVariablesInLibraryCollectionAsync(collection.key)).find(el => el.name === name).key)
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
function finish(newCollection = null) {
  showTimers()
  figma.ui.postMessage({ type: 'finish', message: { errors: errors, newCollection: newCollection } })
  const errorCount = Object.values(errors).reduce((acc, err) => acc + err.length, 0)

  if (errorCount > 0)
    figma.ui.resize(uiSize.width, uiSize.height + 60)
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

