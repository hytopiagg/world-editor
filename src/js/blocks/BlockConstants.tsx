export const BlockFaceEnum = {
    left: 0,
    right: 1,
    top: 2,
    bottom: 3,
    front: 4,
    back: 5,
};

export const BlockFaceAxes = {
    left: "-x",
    right: "+x",
    top: "+y",
    bottom: "-y",
    front: "+z",
    back: "-z",
};

export const BlockFaces = Object.keys(BlockFaceEnum);


export const DEFAULT_BLOCK_AO_INTENSITY = [0, 0, 0, 0];

export const DEFAULT_BLOCK_COLOR = [1.0, 1.0, 1.0, 1.0];

export const DEFAULT_BLOCK_FACE_NORMALS = {
    left: [-1, 0, 0],
    right: [1, 0, 0],
    top: [0, 1, 0],
    bottom: [0, -1, 0],
    front: [0, 0, 1],
    back: [0, 0, -1],
};

export const DEFAULT_BLOCK_FACE_GEOMETRIES = {
    left: {
        normal: DEFAULT_BLOCK_FACE_NORMALS.left,
        vertices: [

            {
                pos: [0, 1, 0],
                uv: [0, 1],
                ao: {
                    corner: [-0.5, -0.5, 0.5],
                    side1: [-0.5, 0.5, -0.5],
                    side2: [-0.5, -0.5, -0.5],
                },
            },

            {
                pos: [0, 0, 0],
                uv: [0, 0],
                ao: {
                    corner: [-0.5, -0.5, 0.5],
                    side1: [-0.5, 0.5, -0.5],
                    side2: [-0.5, -0.5, -0.5],
                },
            },

            {
                pos: [0, 1, 1],
                uv: [1, 1],
                ao: {
                    corner: [-0.5, 0.5, -0.5],
                    side1: [-0.5, 0.5, 0.5],
                    side2: [-0.5, -0.5, 0.5],
                },
            },

            {
                pos: [0, 0, 1],
                uv: [1, 0],
                ao: {
                    corner: [-0.5, -0.5, -0.5],
                    side1: [-0.5, 0.5, 0.5],
                    side2: [-0.5, -0.5, 0.5],
                },
            },
        ],
    },
    right: {
        normal: DEFAULT_BLOCK_FACE_NORMALS.right,
        vertices: [

            {
                pos: [1, 1, 1],
                uv: [0, 1],
                ao: {
                    corner: [0.5, 0.5, -0.5],
                    side1: [0.5, 0.5, 0.5],
                    side2: [0.5, -0.5, 0.5],
                },
            },

            {
                pos: [1, 0, 1],
                uv: [0, 0],
                ao: {
                    corner: [0.5, -0.5, -0.5],
                    side1: [0.5, 0.5, 0.5],
                    side2: [0.5, -0.5, 0.5],
                },
            },

            {
                pos: [1, 1, 0],
                uv: [1, 1],
                ao: {
                    corner: [0.5, 0.5, 0.5],
                    side1: [0.5, 0.5, -0.5],
                    side2: [0.5, -0.5, -0.5],
                },
            },

            {
                pos: [1, 0, 0],
                uv: [1, 0],
                ao: {
                    corner: [0.5, -0.5, 0.5],
                    side1: [0.5, 0.5, -0.5],
                    side2: [0.5, -0.5, -0.5],
                },
            },
        ],
    },
    top: {
        normal: DEFAULT_BLOCK_FACE_NORMALS.top,
        vertices: [

            {
                pos: [0, 1, 1],
                uv: [1, 1],
                ao: {
                    corner: [-0.5, 0.5, 0.5],
                    side1: [0.5, 0.5, 0.5],
                    side2: [-0.5, 0.5, -0.5],
                },
            },

            {
                pos: [1, 1, 1],
                uv: [0, 1],
                ao: {
                    corner: [0.5, 0.5, 0.5],
                    side1: [-0.5, 0.5, 0.5],
                    side2: [0.5, 0.5, -0.5],
                },
            },

            {
                pos: [0, 1, 0],
                uv: [1, 0],
                ao: {
                    corner: [-0.5, 0.5, -0.5],
                    side1: [0.5, 0.5, -0.5],
                    side2: [-0.5, 0.5, 0.5],
                },
            },

            {
                pos: [1, 1, 0],
                uv: [0, 0],
                ao: {
                    corner: [0.5, 0.5, -0.5],
                    side1: [-0.5, 0.5, -0.5],
                    side2: [0.5, 0.5, 0.5],
                },
            },
        ],
    },
    bottom: {
        normal: DEFAULT_BLOCK_FACE_NORMALS.bottom,
        vertices: [

            {
                pos: [1, 0, 1],
                uv: [1, 0],
                ao: {
                    corner: [0.5, -0.5, 0.5],
                    side1: [-0.5, -0.5, 0.5],
                    side2: [0.5, -0.5, -0.5],
                },
            },

            {
                pos: [0, 0, 1],
                uv: [0, 0],
                ao: {
                    corner: [-0.5, -0.5, 0.5],
                    side1: [0.5, -0.5, 0.5],
                    side2: [-0.5, -0.5, 0.5],
                },
            },

            {
                pos: [1, 0, 0],
                uv: [1, 1],
                ao: {
                    corner: [0.5, -0.5, -0.5],
                    side1: [0.5, -0.5, 0.5],
                    side2: [-0.5, -0.5, -0.5],
                },
            },

            {
                pos: [0, 0, 0],
                uv: [0, 1],
                ao: {
                    corner: [-0.5, -0.5, -0.5],
                    side1: [0.5, -0.5, -0.5],
                    side2: [-0.5, -0.5, 0.5],
                },
            },
        ],
    },
    front: {
        normal: DEFAULT_BLOCK_FACE_NORMALS.front,
        vertices: [

            {
                pos: [0, 0, 1],
                uv: [0, 0],
                ao: {
                    corner: [0.5, -0.5, 0.5],
                    side1: [-0.5, 0.5, 0.5],
                    side2: [-0.5, -0.5, 0.5],
                },
            },

            {
                pos: [1, 0, 1],
                uv: [1, 0],
                ao: {
                    corner: [-0.5, -0.5, 0.5],
                    side1: [0.5, 0.5, 0.5],
                    side2: [0.5, -0.5, 0.5],
                },
            },

            {
                pos: [0, 1, 1],
                uv: [0, 1],
                ao: {
                    corner: [0.5, 0.5, 0.5],
                    side1: [-0.5, -0.5, 0.5],
                    side2: [-0.5, 0.5, 0.5],
                },
            },

            {
                pos: [1, 1, 1],
                uv: [1, 1],
                ao: {
                    corner: [-0.5, 0.5, 0.5],
                    side1: [0.5, -0.5, 0.5],
                    side2: [0.5, 0.5, 0.5],
                },
            },
        ],
    },
    back: {
        normal: DEFAULT_BLOCK_FACE_NORMALS.back,
        vertices: [

            {
                pos: [1, 0, 0],
                uv: [0, 0],
                ao: {
                    corner: [-0.5, -0.5, -0.5],
                    side1: [0.5, 0.5, -0.5],
                    side2: [0.5, -0.5, -0.5],
                },
            },

            {
                pos: [0, 0, 0],
                uv: [1, 0],
                ao: {
                    corner: [0.5, -0.5, -0.5],
                    side1: [-0.5, 0.5, -0.5],
                    side2: [-0.5, -0.5, -0.5],
                },
            },

            {
                pos: [1, 1, 0],
                uv: [0, 1],
                ao: {
                    corner: [-0.5, 0.5, -0.5],
                    side1: [0.5, 0.5, -0.5],
                    side2: [0.5, -0.5, -0.5],
                },
            },

            {
                pos: [0, 1, 0],
                uv: [1, 1],
                ao: {
                    corner: [0.5, 0.5, -0.5],
                    side1: [-0.5, 0.5, -0.5],
                    side2: [-0.5, -0.5, -0.5],
                },
            },
        ],
    },
};

export const DEFAULT_BLOCK_NEIGHBOR_OFFSETS = [
    [0, 0, 0], // self
    [0, 1, 0], // top
    [0, -1, 0], // bottom

    [-1, 0, 0], // left
    [-1, 1, 0], // top left
    [-1, -1, 0], // bottom left

    [1, 0, 0], // right
    [1, 1, 0], // top right
    [1, -1, 0], // bottom right

    [0, 0, 1], // front
    [0, 1, 1], // top front
    [0, -1, 1], // bottom front
    [-1, 0, 1], // front left
    [-1, 1, 1], // top front left
    [-1, -1, 1], // bottom front left
    [1, 0, 1], // front right
    [1, 1, 1], // top front right
    [1, -1, 1], // bottom front right

    [0, 0, -1], // back
    [0, 1, -1], // top back
    [0, -1, -1], // bottom back
    [-1, 0, -1], // back left
    [-1, 1, -1], // top back left
    [-1, -1, -1], // bottom back left
    [1, 0, -1], // back right
    [1, 1, -1], // top back right
    [1, -1, -1], // bottom back right
];
