export type UndoRedoState = {
    terrain: {
        added: any[];
        removed: any[];
    };
    environment: {
        added: any[];
        removed: any[];
    }
}

export type CustomModel = {
    data: ArrayBuffer;
    name: string;
    timestamp: number;
}