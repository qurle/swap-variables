export interface Libs {
    from: {
        lib: string,
        collection: string,
        key: string,
        local?: boolean
    },
    to: {
        lib: string,
        collection: string,
        key: string,
        local?: boolean
    }
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