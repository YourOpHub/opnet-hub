import React from 'react';
import ReactDOM from 'react-dom/client';
import { WalletConnectProvider } from '@btc-vision/walletconnect';
import { ToastProvider } from './components/Toast';
import App from './App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

ReactDOM.createRoot(root).render(
    <React.StrictMode>
        <WalletConnectProvider theme="dark">
            <ToastProvider>
                <App />
            </ToastProvider>
        </WalletConnectProvider>
    </React.StrictMode>
);
