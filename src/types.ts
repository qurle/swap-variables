export type Scope = 'selection' | 'thisPage' | 'allPages' | 'styles' | 'aliases'

export interface CollectionsToSwap {
    from: Collection,
    to: Collection
}

// Simplified representation of Figma variable collection
// Can optionally contain the original VariableCollection of Figma's
export interface Collection {
    lib: string,
    name: string,
    key: string,
    modes: {
        name: string,
        modeId: string
    }[],
    id?: string,
    local?: boolean,
    variableCollection?: VariableCollection
}

// Actual structure
export interface Errors {
    limitation: {
        maxModes: number
        currentModes: number
    }[],
    noVariable: {
        property?: string,
        nodeName: string,
        nodeId: string,
        variableId: string
    }[],
    noMatch: {
        name?: string,
        value?: string | VariableValue,
        type?: string,
        nodeName?: string,
        nodeId?: string
    }[]
    mixed: {
        property?: string,
        nodeName: string,
        nodeId: string
    }[],
    badProp: {
        property?: string,
        nodeName: string,
        nodeId: string
    }[],
    unsupported: {
        property?: string,
        type?: string,
        nodeName: string,
        nodeId: string
    }[],
    badFont: {
        name: string,
        nodeName: string,
        nodeId: string
    }[]
}

export interface ProgressOptions {
    scope: Scope,
    pageIndex?: number,
    pageAmount?: number,
}

export interface MessageEntity {
    application: {
        single: string,
        plural: string
    },
    preposition: string,
    object: {
        single: string,
        plural: string
    }
}