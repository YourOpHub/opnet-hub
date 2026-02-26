import { useState, useCallback } from 'react';

interface WalletState {
    connected: boolean;
    address: string;
    balance: string;
    connecting: boolean;
}

export function useWallet() {
    const [wallet, setWallet] = useState<WalletState>({
        connected: false,
        address: '',
        balance: '0',
        connecting: false,
    });

    const connect = useCallback(async () => {
        setWallet(prev => ({ ...prev, connecting: true }));

        // Simulate wallet connection for demo
        // In production, this would use @btc-vision/walletconnect
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Generate a realistic-looking testnet address
        const chars = 'abcdef0123456789';
        let addr = 'tb1q';
        for (let i = 0; i < 38; i++) {
            addr += chars[Math.floor(Math.random() * chars.length)];
        }

        setWallet({
            connected: true,
            address: addr,
            balance: (Math.random() * 0.5 + 0.01).toFixed(8),
            connecting: false,
        });
    }, []);

    const disconnect = useCallback(() => {
        setWallet({
            connected: false,
            address: '',
            balance: '0',
            connecting: false,
        });
    }, []);

    return { ...wallet, connect, disconnect };
}
