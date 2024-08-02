export type Scope = 'selection' | 'thisPage' | 'allPages' | 'styles'

export interface Collections {
    from: Collection,
    to: Collection
}

export interface Collection {
    lib: string,
    name: string,
    key: string,
    modes: {
        name: string,
        modeId: string
    }[],
    id?: string,
    local?: boolean
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
}

export interface ProgressOptions {
    scope: Scope,
    pageIndex?: number,
    pageAmount?: number,
}