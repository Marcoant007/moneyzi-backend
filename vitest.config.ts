import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'
import path from 'path'

export default defineConfig({
    test: {
        globals: true,
        root: './',
    },
    plugins: [
        swc.vite({
            module: { type: 'es6' },
        }),
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
})
