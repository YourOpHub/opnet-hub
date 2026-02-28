import React from 'react';
import ReactDOM from 'react-dom/client';
import { WalletConnectProvider } from '@btc-vision/walletconnect';
import { ToastProvider } from './components/Toast';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <WalletConnectProvider theme="dark">
            <ToastProvider>
                <App />
            </ToastProvider>
        </WalletConnectProvider>
    </React.StrictMode>
);
