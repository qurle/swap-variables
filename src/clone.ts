import { Collection, Collections } from './types'
import { c } from './code'

// Shorthands
const v = figma.variables
const tl = figma.teamLibrary


export async function cloneVariables(from): Promise<Collection> {

    let fromVariables: Variable[]
    let fromCollection: VariableCollection

    fromCollection = await v.getVariableCollectionByIdAsync(from.id)
    fromVariables = await Promise.all(fromCollection.variableIds.map(async (vid) => await v.getVariableByIdAsync(vid)))

    c('Cloning variables:')
    c(fromVariables.map(v => v.name))
    c('Fron collection')
    c(fromCollection)

    let toVariables: Variable[] = []
    let toCollection: VariableCollection = await createCollection(from)

    const modeMap = createModeMap(fromCollection, toCollection)

    mergeWithCollection(fromVariables, toVariables, toCollection, modeMap)

    if (['Mode 1', 'Value'].includes(toCollection.modes[0].name)) {
        if (!fromCollection.modes.find(mode => mode.name === toCollection.modes[0].name))
            toCollection.removeMode(toCollection.modes[0].modeId)
    }

    return {
        lib: "Local Collections",
        name: toCollection.name,
        key: toCollection.key,
        id: toCollection.id,
        local: true
    } as Collection
}

async function createCollection(from: Collection) {
    // const copyRegex = /\(copy(?: ([0-9]+))*\)/
    // Create new collection
    const collectionName = (from.local || await sameNameExist(from.name))
        ? from.name + ' (copy)'
        : from.name

    return v.createVariableCollection(collectionName)
}

async function sameNameExist(name: string) {
    return (await v.getLocalVariableCollectionsAsync()).find(col => col.name === name)
}

function createModeMap(fromCollection, toCollection) {
    let modeMap = {}
    for (const fromMode of fromCollection.modes) {
        const toMode = toCollection.modes.find(el => el.name === fromMode.name)
        if (toMode)
            modeMap[fromMode.modeId] = toMode.modeId
        else
            modeMap[fromMode.modeId] = toCollection.addMode(fromMode.name)
    }
    return modeMap
}

function mergeWithCollection(fromVariables, toVariables, toCollection, modeMap) {
    for (const fromVariable of fromVariables) {
        let toVariable: Variable
        // If variable with this name exists
        toVariable = toVariables.find(el => el.name === fromVariable.name)
        if (!toVariable) {
            toVariable = v.createVariable(
                fromVariable.name,
                toCollection,
                fromVariable.resolvedType
            )
            toVariables.push(toVariable)
        }

        Object.entries(fromVariable.valuesByMode).forEach(
            ([k, v]) => toVariable.setValueForMode(modeMap[k], (v as VariableValue))
        )
    }
}