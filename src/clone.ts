import { error } from './errors'
import { Collection } from './types'
import { c } from './utils'

// Shorthands
const v = figma.variables
const tl = figma.teamLibrary

// Const
const platforms: CodeSyntaxPlatform[] = ['WEB', 'ANDROID', 'iOS']

/**
 * Clones variables from one collection to another and creates a new variable collection.
 * 
 * @param {Collection} from - The source collection from which variables are to be cloned.
 * @returns {Promise<{ collection: Collection, variablesMap: Map<string, Variable> }>} - Returns a new collection and a map of variables.
 */
export async function cloneVariables(from: Collection): Promise<{ collection: Collection, variablesMap: Map<string, Variable> }> {

    let fromVariables: Variable[]
    let fromCollection: VariableCollection

    fromCollection = await v.getVariableCollectionByIdAsync(from.id)

    fromVariables = from.local ?
        await Promise.all(fromCollection.variableIds.map(async (vid) => await v.getVariableByIdAsync(vid))) :
        await Promise.all((await tl.getVariablesInLibraryCollectionAsync(fromCollection.key)).map(async variable => v.importVariableByKeyAsync(variable.key)))

    c('Cloning variables:')
    c(fromVariables.map(v => v.name))
    c('From collection')
    c(fromCollection)

    let toVariables: Variable[] = []
    let toCollection: VariableCollection = await createCollection(from)

    const modeMap = createModeMap(fromCollection, toCollection)

    toVariables = mergeWithCollection(fromVariables, toVariables, toCollection, modeMap)

    if (['Mode 1', 'Value'].includes(toCollection.modes[0].name)) {
        if (!fromCollection.modes.find(mode => mode.name === toCollection.modes[0].name))
            toCollection.removeMode(toCollection.modes[0].modeId)
    }

    let toVariablesMap = new Map<string, Variable>(toVariables.map(v => [v.name, v]))

    return {
        collection: {
            lib: "Local Collections",
            name: toCollection.name,
            key: toCollection.key,
            id: toCollection.id,
            local: true
        } as Collection,
        variablesMap: toVariablesMap
    }
}

async function createCollection(from: Collection) {
    let collectionName = from.name
    let copyIndex = 0

    while (await sameNameExist(collectionName)) {
        copyIndex++
        collectionName = from.name + (copyIndex === 1 ? ' (copy)' : ` (copy ${copyIndex})`)
    }

    return v.createVariableCollection(collectionName)
}

async function sameNameExist(name: string) {
    return (await v.getLocalVariableCollectionsAsync()).find(col => col.name === name)
}

function createModeMap(fromCollection: VariableCollection, toCollection: VariableCollection) {
    let modeMap = {}
    c(`Cloning ${fromCollection.modes.length} modes:`)
    c(fromCollection.modes)
    for (const fromMode of fromCollection.modes) {
        // Renaming default modes if no variables is present
        if (toCollection.variableIds.length === 0)
            toCollection.modes.forEach((mode, i) => toCollection.renameMode(mode.modeId, fromCollection.modes[i].name))

        // Checking if we have modes with same names
        const toMode = toCollection.modes.find(el => el.name === fromMode.name)
        if (toMode)
            modeMap[fromMode.modeId] = toMode.modeId
        else {
            try {
                modeMap[fromMode.modeId] = toCollection.addMode(fromMode.name)
            }
            catch (e) {
                const maxModes = e.message.match(/in addMode: Limited to ([0-9]+) modes only/)[1]
                if (maxModes)
                    error('limitation', {
                        currentModes: toCollection.modes.filter(el => el.name !== fromMode.name).length + fromCollection.modes.length,
                        maxModes: maxModes
                    })
                else
                    throw e
            }
        }
    }
    c(`Created modeMap:`)
    c(modeMap)
    return modeMap
}

function mergeWithCollection(fromVariables: Variable[], toVariables, toCollection, modeMap) {
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

            copyCodeSyntax(fromVariable, toVariable)
            copyScopes(fromVariable, toVariable)

            toVariables.push(toVariable)
        }

        Object.entries(fromVariable.valuesByMode).forEach(
            ([k, v]) => {
                if (modeMap[k])
                    toVariable.setValueForMode(modeMap[k], (v as VariableValue))
            }
        )
    }
    return toVariables
}

function copyCodeSyntax(fromVariable: Variable, toVariable: Variable) {
    for (const platform of platforms) {
        if (fromVariable.codeSyntax[platform])
            toVariable.setVariableCodeSyntax(platform, fromVariable.codeSyntax[platform])
    }
}

function copyScopes(fromVariable: Variable, toVariable: Variable) {
    toVariable.scopes = fromVariable.scopes
}