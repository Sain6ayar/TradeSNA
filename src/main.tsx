import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { AuthGate } from './components/AuthGate.tsx'
import { installWebAPI } from './api'
import './index.css'

// Stand up the window.electronAPI compatibility layer before anything mounts:
// every page and component in the app reaches for it.
installWebAPI()

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <AuthGate>
            <App />
        </AuthGate>
    </React.StrictMode>,
)
