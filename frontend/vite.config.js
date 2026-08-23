import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite configuration for the Healthcare Data Exchange frontend
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,  // Default Vite port
    open: true,  // Automatically open browser on 'npm run dev'
  },
})
