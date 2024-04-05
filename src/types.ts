export interface Collections {
    from: Collection,
    to: Collection
}

export interface Collection {
    lib: string,
    name: string,
    key: string,
    id?: string,
    local?: boolean
}

export interface Errors {
    noMatch: {
        name: string,
        value: string,
        type: string,
        nodeId: string
    }[]
    mixed: {
        nodeName: string,
        nodeId: string
    }[],
    badProp: {
        property: string,
        nodeName: string,
        nodeId: string
    }[],
    unsupported: {
        property: string,
        nodeName: string,
        type: string,
        nodeId: string

    }[]
}