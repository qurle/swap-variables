export interface Libs {
    from: {
        lib: string,
        collection: string,
        key: string
    },
    to: {
        lib: string,
        collection: string,
        key: string
    }
}

export interface Errors {
    noMatch: {
        name: string,
        value: string,
        type: string
    }[]
    mixed: {
        nodeName: string
    }[],
    badProp: {
        property: string,
        nodeName: string
    }[]
}