import { clone } from "./utils/clone"
import { Libs } from './types'

// Constants
const confirmMsgs = ["Done!", "You got it!", "Aye!", "Is that all?", "My job here is done.", "Gotcha!", "It wasn't hard.", "Got it! What's next?"]
const renameMsgs = ["Cleaned", "Affected", "Made it with", "Fixed"]
const idleMsgs = ["All great, already", "Nothing to do, everything's good", "Any layers to affect? Can't see it", "Nothing to do, your layers are great"]
const errors = {
  noMatch: [],
  mixed: []
}

// Variables
let notification: NotificationHandler
let selection: ReadonlyArray<SceneNode>
let working: boolean
let count: number = 0
let libraries


// Cancel on page change
figma.on("currentpagechange", cancel)

// Connect with UI
figma.showUI(__html__, { height: 300, width: 400 })
figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case 'swap':
      const selection = figma.currentPage.selection
      const nodes = selection && selection.length > 0 ? selection : figma.currentPage.children
      await swap(msg.message, nodes)
      console.log(errors)
      break;
  }
  if (msg === "finished") // Real plugin finish (after server's last response)
    figma.closePlugin()
  else
    console.log(msg)
}

// Engine start
figma.ui.postMessage("started")
working = true
run(figma.currentPage)

async function run(node: SceneNode | PageNode) {
  libraries = await getLibraries()
  figma.ui.postMessage({ type: 'libs', message: libraries })
  count++
  // finish()
  // figma.closePlugin()
}

async function getLibraries() {
  const localCollections = figma.variables.getLocalVariableCollections().map(el => ({ key: el.key, libraryName: 'Local Collections', name: el.name }))
  return [...await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync(), ...localCollections]
}

async function swap(libs: Libs, nodes) {
  for (const node of nodes) {
    // If no bound variables
    if (!Object.keys(node.boundVariables).length)
      return 'No bound variables'

    const variables = Object.entries(node.boundVariables)
    console.log(variables)
    for (const [property, value] of variables) {
      // Properties can contain both variables and array of variables
      if (Array.isArray(value))
        for (const variable of value)
          await rebindVariables(libs, node, property, variable)
      else
        await rebindVariables(libs, node, property, value as Variable)
    }
    // Recursion
    if (node.children)
      swap(libs, node.children)
  }
}

async function rebindVariables(libs: Libs, node, property, variable: Variable) {
  if (!getCollectionId(variable).includes(libs.from.key))
    return

  const name = figma.variables.getVariableById(variable.id).name
  const newVariable = await findVariable(libs.to.key, name)

  if (!newVariable)
    return

  console.log(`Rebinding ${property} of ${node.name}`)

  switch (property) {
    case 'fills':
    case 'strokes':
      const paints = node[property].map(paint => {
        if (paint.type === 'SOLID')
          return figma.variables.setBoundVariableForPaint(paint, 'color', newVariable)
      })
      node[property] = paints
      break
    // case 'layoutGrids':
    //   const grids = node[property].map(paint => {
    //     if (paint.type === 'SOLID') {
    //       console.log(paint.type)
    //       return figma.variables.setBoundVariableForLayoutGrid(paint, 'gutterSize', newVariable)
    //     }
    //   })
    //   node[property] = grids
  }
}

function getCollectionId(variable) {
  const variableId = (typeof variable === 'string') ? variable : variable.id
  return figma.variables.getVariableById(variableId).variableCollectionId
}

async function findVariable(key, name) {
  const variable = await figma.variables.importVariableByKeyAsync((await figma.teamLibrary.getVariablesInLibraryCollectionAsync(key)).find(el => el.name === name).key)
  if (!variable)
    errors.noMatch.push(`${name} not found`)
  return variable
}

// Ending the work
function finish() {
  working = false
  figma.root.setRelaunchData({ relaunch: '' })
  if (count > 0) {
    notify(confirmMsgs[Math.floor(Math.random() * confirmMsgs.length)] +
      " " + renameMsgs[Math.floor(Math.random() * renameMsgs.length)] +
      " " + ((count === 1) ? "only one layer" : (count + " layers")))
  }
  else notify(idleMsgs[Math.floor(Math.random() * idleMsgs.length)])
  setTimeout(() => { console.log("Timeouted"), figma.closePlugin() }, 30000)
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
