import { Component, type ReactNode } from 'react';

/** `resetKey`: when it changes (new data arrived) a crashed child gets another chance instead of staying broken until a reload. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: unknown; page?: boolean }, { err?: Error }> {
  state: { err?: Error } = {};
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { console.error(this.props.page ? '[app]' : '[widget]', err); }
  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (this.state.err && prev.resetKey !== this.props.resetKey) this.setState({ err: undefined });
  }
  render() {
    if (!this.state.err) return this.props.children;
    if (this.props.page)
      return (
        <div className="grid min-h-full place-items-center p-6 text-center">
          <div className="space-y-3">
            <div className="text-lg font-semibold">Something went wrong</div>
            <div className="text-sm text-bad">{this.state.err.message}</div>
            <button className="rounded-full border border-line-2 px-4 py-2 text-sm" onClick={() => location.reload()}>Reload</button>
          </div>
        </div>
      );
    return <div className="grid h-full place-items-center text-center text-xs text-bad">Widget crashed: {this.state.err.message}</div>;
  }
}
