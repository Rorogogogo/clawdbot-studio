/// <reference types="vite/client" />

import type { StudioAPI } from "./types/studio"

declare global {
  interface Window {
    studioAPI?: StudioAPI
  }
}

export {}
