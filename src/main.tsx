import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app/App.tsx'
import DebugWindow from './debug/DebugWindow.tsx'

const RootView = new URLSearchParams(window.location.search).get('view') === 'debug' ? DebugWindow : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootView />
  </StrictMode>,
)
