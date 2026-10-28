import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'UserTasks',
    short_name: 'UserTasks',
    description: 'Open-source headless workflow engine.',
    start_url: '/tasks',
    display: 'standalone',
    background_color: '#FAF8F3',
    theme_color: '#17150F',
    icons: [
      { src: '/brand/mark-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/mark-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/mark-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  }
}
