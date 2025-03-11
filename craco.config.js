module.exports = {
    webpack: {
        configure: {
            experiments: {
                asyncWebAssembly: true,
            },
            module: {
                rules: [
                    {
                        test: /\.wasm$/,
                        type: "webassembly/async",
                        mimetype: 'application/wasm',
                    },
                ],
            },
            resolve: {
                fallback: {
                    wbg: false
                }
            }
        },
    },
};