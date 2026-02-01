import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import 'monaco-editor/min/vs/editor/editor.main.css'
import './i18n'
import App from './App.tsx'
import { configureMonaco } from './lib/monacoEnv'

configureMonaco()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
