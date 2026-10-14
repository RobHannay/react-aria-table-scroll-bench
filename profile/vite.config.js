import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Profiling build: production mode (NODE_ENV=production), unminified, one output file per source module so CPU
// profile call frames carry the originating module in their URL (used to bucket self time).
export default defineConfig({
    plugins: [react()],
    mode: 'production',
    base: './',
    build: {
        outDir: process.env.ARM_OUT ?? 'dist',
        emptyOutDir: true,
        minify: false,
        rollupOptions: { preserveEntrySignatures: 'strict', output: { preserveModules: true } },
    },
});
