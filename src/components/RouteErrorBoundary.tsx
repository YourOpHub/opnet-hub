import React from 'react';
import { logger } from '../logger';

interface Props {
  children: React.ReactNode;
  routeName?: string | undefined;
  onReset?: (() => void) | undefined;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class RouteErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const route = this.props.routeName ?? 'unknown';
    logger.error(`[RouteErrorBoundary:${route}]`, error.message, info.componentStack);
  }

  handleRetry = (): void => {
    // If it's a stale chunk error (post-deploy cache mismatch), force reload
    const msg = this.state.error?.message || '';
    if (msg.includes('dynamically imported module') || msg.includes('Failed to fetch')) {
      window.location.reload();
      return;
    }
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  componentDidUpdate(_prevProps: Props, prevState: State): void {
    // Auto-reload once on stale chunk errors (post-deploy cache)
    if (this.state.hasError && !prevState.hasError) {
      const msg = this.state.error?.message || '';
      if (msg.includes('dynamically imported module') || msg.includes('Failed to fetch')) {
        const key = `reb_reload_${msg.slice(0, 50)}`;
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, '1');
          window.location.reload();
        }
      }
    }
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      const isStaleChunk = (this.state.error?.message || '').includes('dynamically imported module');
      return (
        <div className="reb-container" role="alert" aria-live="assertive">
          <div className="reb-card">
            <div className="reb-icon" aria-hidden="true">!</div>
            <h2 className="reb-title">{isStaleChunk ? 'New version available' : 'Something went wrong'}</h2>
            {this.props.routeName && (
              <div className="reb-route">
                in <span className="reb-route-name">{this.props.routeName}</span>
              </div>
            )}
            <p className="reb-message">
              {isStaleChunk
                ? 'A new version was deployed. Click reload to update.'
                : (this.state.error?.message || 'An unexpected error occurred in this section.')}
            </p>
            <button className="reb-retry" onClick={this.handleRetry}>
              {isStaleChunk ? 'Reload Page' : 'Try Again'}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default RouteErrorBoundary;
