/**
 * BobChat.test.tsx -- Tests for src/components/BobChat.tsx
 *
 * Covers: initial render, KB responses, prompt chips, typing indicator, MCP status
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../bob-mcp', () => ({
  initBob: vi.fn().mockResolvedValue(false),
  searchKnowledge: vi.fn(),
  getContractAddresses: vi.fn(),
  getAuditInfo: vi.fn(),
  getCliHelp: vi.fn(),
  getBtcMonitor: vi.fn(),
  getDevDocs: vi.fn(),
  getSkillCatalog: vi.fn(),
}));

import BobChat from '../components/BobChat';

// jsdom does not implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

describe('BobChat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders chat with initial bot message', () => {
    render(<BobChat />);
    expect(screen.getByRole('region', { name: 'Bob AI Chat' })).toBeTruthy();
    expect(screen.getByText(/Bob AI \u2014 OP_NET Instructor/)).toBeTruthy();
  });

  it('renders suggested topic chips', () => {
    render(<BobChat />);
    const chipList = screen.getByRole('list', { name: 'Suggested topics' });
    expect(chipList).toBeTruthy();
    // Should have multiple chips
    const chips = screen.getAllByRole('listitem');
    expect(chips.length).toBeGreaterThan(5);
  });

  it('renders chat input and send button', () => {
    render(<BobChat />);
    expect(screen.getByLabelText('Chat message')).toBeTruthy();
    expect(screen.getByLabelText('Send message')).toBeTruthy();
  });

  it('renders MCP status indicator', () => {
    render(<BobChat />);
    // Initially "Connecting..." then settles to "Local KB"
    expect(screen.getByText(/Connecting/)).toBeTruthy();
  });

  it('resolves to Local KB when MCP init fails', async () => {
    render(<BobChat />);
    // Let initBob promise resolve
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(screen.getByText('Local KB')).toBeTruthy();
  });

  it('sends user message and shows local KB response', async () => {
    render(<BobChat />);
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const input = screen.getByLabelText('Chat message');
    fireEvent.change(input, { target: { value: 'hello' } });

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    // User message should appear
    expect(screen.getByText('hello')).toBeTruthy();

    // Let local response delay resolve
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    // Bob should respond with greeting
    const messages = screen.getAllByText(/Bob/);
    expect(messages.length).toBeGreaterThan(1);
  });

  it('send button sends message', async () => {
    render(<BobChat />);
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const input = screen.getByLabelText('Chat message');
    fireEvent.change(input, { target: { value: 'opnet' } });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Send message'));
    });

    expect(screen.getByText('opnet')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
  });

  it('does not send empty message', async () => {
    render(<BobChat />);
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const input = screen.getByLabelText('Chat message');
    fireEvent.change(input, { target: { value: '' } });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Send message'));
    });

    // Should still only have the initial bot message
    const chatLog = screen.getByRole('log');
    const bubbles = chatLog.querySelectorAll('.bub');
    expect(bubbles.length).toBe(1);
  });

  it('sets localStorage on send', async () => {
    render(<BobChat />);
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const input = screen.getByLabelText('Chat message');
    fireEvent.change(input, { target: { value: 'test' } });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Send message'));
    });

    expect(localStorage.getItem('hub_bob_used')).toBe('1');
  });

  it('renders link to ai.opnet.org', () => {
    render(<BobChat />);
    const links = screen.getAllByText(/ai\.opnet\.org/);
    expect(links.length).toBeGreaterThanOrEqual(1);
  });
});
