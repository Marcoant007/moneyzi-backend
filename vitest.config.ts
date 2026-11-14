import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'
import path from 'path'

export default defineConfig({
    test: {
        globals: true,
        root: './',
        exclude: ['dist/**', 'node_modules/**', 'coverage/**'],
        // Vários testes fazem `await import(...)` dentro do it(): o carregamento do
        // módulo conta no timeout e, com a suíte inteira em paralelo (pre-push),
        // passava dos 5s padrão de forma intermitente. A folga ainda pega teste travado.
        testTimeout: 15000,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            reportsDirectory: 'coverage',
            thresholds: {
                global: {
                    statements: 80,
                    branches: 80,
                    functions: 80,
                    lines: 80,
                },
            }
        },
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
