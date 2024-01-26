// Constants
const confirmMsgs = ["Done!", "You got it!", "Aye!", "Is that all?", "My job here is done.", "Gotcha!", "It wasn't hard.", "Got it! What's next?"]
const renameMsgs = ["Cleaned", "Affected", "Made it with", "Fixed"]
const idleMsgs = ["All great, already", "Nothing to do, everything's good", "Any layers to affect? Can't see it", "Nothing to do, your layers are great"]

// Variables
let notification: NotificationHandler
let selection: ReadonlyArray<SceneNode>
let working: boolean
let count: number = 0

figma.on("currentpagechange", cancel)

// Connect with UI
figma.showUI(__html__, { height: 300, width: 400 })
figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case 'swap':
      selection = figma.currentPage.selection
      swap(msg.message, selection)
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
  figma.ui.postMessage({ type: 'libs', message: await getLibraries() })
  count++
  // finish()
  // figma.closePlugin()
}

async function getLibraries() {
  return await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()
}

function swap(libs, selection) {
  const nodes = selection && selection.length > 0 ? selection : figma.currentPage.children
  for (const node of nodes) {
    console.log(node)
  }
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
