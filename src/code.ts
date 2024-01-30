import { Libs, Errors } from './types'
import { figmaRGBToHex } from './utils'

// Constants
const actionMsgs = ["Swapped", "Affected", "Made it with", "Fixed", "Updated"]
const idleMsgs = ["All great, already", "Nothing to do, everything's good", "Any layers to affect? Can't see it", "Nothing to do, your layers are great"]

// Variables
let notification: NotificationHandler
let selection: ReadonlyArray<SceneNode>
let working: boolean
let count: number
let libraries
let errors: Errors = {
  noMatch: [],
  mixed: [],
  badProp: []
}


// Cancel on page change
figma.on("currentpagechange", cancel)

// Connect with UI
figma.showUI(__html__, { themeColors: true, width: 300, height: 280, })
figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case 'swap':

      errors = {
        noMatch: [],
        mixed: [],
        badProp: []
      }
      count = 0

      const selection = figma.currentPage.selection
      const nodes = selection && selection.length > 0 ? selection : figma.currentPage.children
      await swap(msg.message, nodes)
      nodes.forEach(node => { node.setRelaunchData({ relaunch: '' }) })
      finish()
      break;
  }
  if (msg === "finished") // Real plugin finish (after server's last response)
    figma.closePlugin()
  else
    console.log(msg)
}

// Engine start
figma.ui.postMessage("started")
run(figma.currentPage)

async function run(node: SceneNode | PageNode) {
  libraries = await getLibraries()
  figma.ui.postMessage({ type: 'libs', message: libraries })
  // finish()
  // figma.closePlugin()
}

async function getLibraries() {
  const localCollections = figma.variables.getLocalVariableCollections().filter(el => el.variableIds.length > 0).map(el => ({ key: el.key, libraryName: 'Local Collections', name: el.name }))
  const externalCollections = await Promise.all((await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()).filter(
    async (el) => (await figma.teamLibrary.getVariablesInLibraryCollectionAsync(el.key)).length > 0
  ))
  return [...await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync(), ...localCollections]
}

async function swap(libs: Libs, nodes) {
  for (const node of nodes) {
    for (const [property, value] of Object.entries(node.boundVariables)) {
      // Complex immutable properties
      if (Array.isArray(value)) {
        await swapComplex(node, property, libs)
      }
      // Simple properties
      else {
        const newVariable = await getNewVariable(value as Variable, libs, node)
        if (newVariable) {
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

async function swapComplex(node, property: string, libs: Libs) {

  let setBoundVarible
  switch (property) {
    case 'fills':
    case 'strokes':
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
      error('mixed', { nodeName: node.name })
      return
    default:
      error('badProp', { property: property, nodeName: node.name })
      return
  }


  node[property] = await Promise.all(
    node[property].map(async (paint) => {
      for (const [field, variable] of Object.entries(paint.boundVariables)) {
        const newVariable = await getNewVariable(variable, libs, node)
        if (newVariable) {
          count++
          return setBoundVarible(paint, field, newVariable)
        }
        return paint
      }
    }))
}

async function getNewVariable(variable, libs: Libs, node) {
  // Assuring we have full variable object
  variable = figma.variables.getVariableById(variable.id)
  if (!getCollectionId(variable).includes(libs.from.key))
    return


  let newVariable
  try {
    newVariable = await findVariable(libs.to.key, variable)
  }
  catch {
    let { value, resolvedType } = variable.resolveForConsumer(node)
    if (resolvedType === 'COLOR') {
      value = figmaRGBToHex(value)
    }
    error('noMatch', { name: variable.name, type: resolvedType, value: value })
  }

  return newVariable || variable
}

async function findVariable(libKey, variable) {
  const name = variable.name
  const newVariable = await figma.variables.importVariableByKeyAsync((await figma.teamLibrary.getVariablesInLibraryCollectionAsync(libKey)).find(el => el.name === name).key)
  return newVariable
}

function getCollectionId(variable) {
  const variableId = (typeof variable === 'string') ? variable : variable.id
  return figma.variables.getVariableById(variableId).variableCollectionId
}

function error(type: 'noMatch' | 'mixed' | 'badProp', options) {
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
  }

  errors[type].push(options)

}

// Ending the work
function finish() {
  figma.ui.postMessage({ type: 'errors', message: errors })
  const errorCount = Object.values(errors).reduce((acc, err) => acc + err.length, 0)

  if (errorCount > 0)
    figma.ui.resize(310, 360)
  else
    figma.ui.resize(300, 280)

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
