import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { err?: Error }> {
  state: { err?: Error } = {};
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { console.error('[widget]', err); }
  render() {
    if (this.state.err) return <div className="grid h-full place-items-center text-center text-xs text-bad">Widget crashed: {this.state.err.message}</div>;
    return this.props.children;
  }
}
