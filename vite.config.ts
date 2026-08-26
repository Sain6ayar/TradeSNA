import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    // Web app is served from the domain root (the desktop build used './'
    // because Electron loaded index.html off the filesystem).
    base: '/',
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            output: {
                // Split the heavy, rarely-changing libraries out of the app
                // bundle so app edits don't invalidate them in browser caches.
                manualChunks: {
                    react: ['react', 'react-dom'],
                    charts: ['recharts'],
                    supabase: ['@supabase/supabase-js'],
                },
            },
        },
    },
    server: {
        port: 5173,
        strictPort: true,
    }
})
