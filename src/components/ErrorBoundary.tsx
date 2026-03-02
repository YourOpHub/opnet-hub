import React from 'react';

interface Props {
  children: React.ReactNode;
  fallbackTab?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error.message, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '48px 24px',
          textAlign: 'center',
          maxWidth: 480,
          margin: '0 auto',
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: 16, margin: '0 auto 20px',
            background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.8rem',
          }}>!</div>
          <div style={{
            fontSize: '1.1rem', fontWeight: 700, color: '#fff',
            marginBottom: 8, letterSpacing: '-.02em',
          }}>Something went wrong</div>
          <div style={{
            fontSize: '.8rem', color: '#7a8494', lineHeight: 1.6,
            marginBottom: 20,
          }}>
            {this.state.error?.message || 'An unexpected error occurred in this module.'}
          </div>
          <button
            onClick={this.handleReset}
            style={{
              padding: '10px 24px', borderRadius: 12, border: 'none',
              background: 'linear-gradient(135deg, #F7931A, #ffab40)',
              color: '#000', fontWeight: 700, fontSize: '.82rem',
              cursor: 'pointer', fontFamily: "'Inter', sans-serif",
              boxShadow: '0 4px 16px rgba(247,147,26,.2)',
              transition: 'all .2s',
            }}
          >Try Again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
