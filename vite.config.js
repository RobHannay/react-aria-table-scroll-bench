import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// ARM_OUT: output dir. COMPILER=1 compiles the app source (src/) with babel-plugin-react-compiler.
export default defineConfig({
    plugins: [
        react(
            process.env.COMPILER === '1'
                ? { babel: { plugins: [['babel-plugin-react-compiler', { target: '19' }]] } }
                : {},
        ),
    ],
    mode: 'production',
    base: './',
    build: {
        outDir: process.env.ARM_OUT ?? 'dist',
        emptyOutDir: true,
        minify: process.env.MINIFY !== '0',
        rollupOptions: {
            output: {
                // Keep node_modules in a separate chunk so arms can be diffed chunk by chunk.
                manualChunks: (id) => (id.includes('node_modules') ? 'vendor' : undefined),
            },
        },
    },
});
