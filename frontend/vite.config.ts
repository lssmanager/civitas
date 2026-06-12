import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const defaultPreviewAllowedHosts = ['civitas.socialstudies.cloud']
const runtimeEnv = globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> }
}
const extraPreviewAllowedHosts =
  runtimeEnv.process?.env?.PREVIEW_ALLOWED_HOSTS ?? ''
const previewAllowedHosts = [
  ...defaultPreviewAllowedHosts,
  ...extraPreviewAllowedHosts
    .split(',')
    .map((host: string) => host.trim())
    .filter(Boolean),
]

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: [...new Set(previewAllowedHosts)],
  },
})
