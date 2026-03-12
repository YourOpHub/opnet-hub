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
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="reb-container" role="alert" aria-live="assertive">
          <div className="reb-card">
            <div className="reb-icon" aria-hidden="true">!</div>
            <h2 className="reb-title">Something went wrong</h2>
            {this.props.routeName && (
              <div className="reb-route">
                in <span className="reb-route-name">{this.props.routeName}</span>
              </div>
            )}
            <p className="reb-message">
              {this.state.error?.message || 'An unexpected error occurred in this section.'}
            </p>
            <button className="reb-retry" onClick={this.handleRetry}>
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default RouteErrorBoundary;
