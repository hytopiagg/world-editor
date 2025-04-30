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