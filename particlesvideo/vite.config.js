import { defineConfig } from 'vite'
import tslOperatorPlugin from 'vite-plugin-tsl-operator'
import plainText from 'vite-plugin-plain-text';

export default defineConfig({
    base: './',
    assetsInclude: ['**/*.hdr'],
    server: {
        port: 1234,
    },
    plugins: [
        tslOperatorPlugin({logs:false}),
        plainText(
            [/\.obj$/],
            { namedExport: false },
        ),
    ]
});