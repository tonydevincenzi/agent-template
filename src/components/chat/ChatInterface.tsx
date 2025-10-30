'use client';

import { useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { createSession, logMessage, isLoggingEnabled } from '@/lib/platformLogger';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content?: string;
  toolCall?: ToolCall;
  thinking?: string;
  eventType: 'user_message' | 'thinking_start' | 'thinking_delta' | 'thinking' | 'content_start' | 'content_delta' | 'tool_call_start' | 'tool_call_delta' | 'tool_call' | 'tool_result' | 'assistant_message' | 'done' | 'error';
  timestamp: Date;
  raw?: any; // Store raw event data for debugging
}

interface ToolCall {
  id: string;
  name: string;
  input: any;
  result?: any;
  status: 'pending' | 'success' | 'error';
  timestamp?: number; // For chronological ordering
}

interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'completed';
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [agentConfig, setAgentConfig] = useState<any>(null);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [showTodos, setShowTodos] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Initialize session on first load
  useEffect(() => {
    const initSession = async () => {
      if (isLoggingEnabled()) {
        const sessionId = await createSession();
        setSessionId(sessionId);
      } else {
        console.log('[Platform Logger] Session logging disabled - env vars not set');
      }
    };
    
    initSession();
  }, []);

  // Load config and initialize theme
  useEffect(() => {
    // Check URL parameter first
    const urlParams = new URLSearchParams(window.location.search);
    const urlTheme = urlParams.get('theme');
    if (urlTheme === 'dark' || urlTheme === 'light') {
      setTheme(urlTheme);
    }

    fetch('/api/config')
      .then(r => r.json())
      .then(data => {
        setAgentConfig(data);
        if (data.uiCustomization?.todoListVisible !== undefined) {
          setShowTodos(data.uiCustomization.todoListVisible);
        }
        // Initialize theme from config (if not set by URL)
        if (!urlTheme && data.uiCustomization?.theme) {
          setTheme(data.uiCustomization.theme);
        }
      })
      .catch(console.error);
  }, []);

  // Listen for theme changes from parent window (when embedded in iframe)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'THEME_CHANGE') {
        setTheme(event.data.theme);
      }
    };
    
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Focus input after message is sent
  useEffect(() => {
    if (!isLoading) {
      inputRef.current?.focus();
    }
  }, [isLoading]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input,
      eventType: 'user_message',
      timestamp: new Date(),
    };
    
    setMessages(prev => [...prev, userMessage]);
    const userMessageContent = input;
    setInput('');
    setIsLoading(true);

    // Log user message to platform
    if (sessionId && userMessageContent) {
      await logMessage(sessionId, 'user', userMessageContent);
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          messages: [...messages, userMessage].map(m => ({
            role: m.role,
            content: m.content,
          }))
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (!reader) {
        throw new Error('No response body');
      }

      // Track accumulated content and current message ID for content deltas
      let contentAccumulator = '';
      let contentMessageId: string | null = null;
      let responseMetadata: { model?: string; inputTokens?: number; outputTokens?: number } = {};

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              // Handle content_delta - accumulate into single message
              if (data.type === 'content_delta' || data.type === 'content') {
                const delta = data.delta || data.content || '';
                contentAccumulator += delta;
                
                if (!contentMessageId) {
                  // Create new content message
                  contentMessageId = `content-${Date.now()}`;
                  const contentMessage: Message = {
                    id: contentMessageId,
                    role: 'assistant',
                    content: contentAccumulator,
                    eventType: 'content_delta',
                    timestamp: new Date(),
                    raw: data,
                  };
                  setMessages(prev => [...prev, contentMessage]);
                } else {
                  // Update existing content message
                  setMessages(prev => prev.map(msg => 
                    msg.id === contentMessageId 
                      ? { ...msg, content: contentAccumulator }
                      : msg
                  ));
                }
                setTimeout(() => scrollToBottom(), 0);
              }
              // Handle thinking - separate event
              else if (data.type === 'thinking') {
                const thinkingMessage: Message = {
                  id: `thinking-${Date.now()}`,
                  role: 'assistant',
                  thinking: data.content,
                  eventType: 'thinking',
                  timestamp: new Date(),
                  raw: data,
                };
                setMessages(prev => [...prev, thinkingMessage]);
                setTimeout(() => scrollToBottom(), 0);
              }
              // Handle tool_call - separate event
              else if (data.type === 'tool_call' && data.toolCalls && data.toolCalls.length > 0) {
                const toolCallMessage: Message = {
                  id: `tool-call-${Date.now()}`,
                  role: 'assistant',
                  toolCall: data.toolCalls[0],
                  eventType: 'tool_call',
                  timestamp: new Date(),
                  raw: data,
                };
                setMessages(prev => [...prev, toolCallMessage]);
                setTimeout(() => scrollToBottom(), 0);
              }
              // Handle tool_result - separate event
              else if (data.type === 'tool_result') {
                const toolResultMessage: Message = {
                  id: `tool-result-${Date.now()}`,
                  role: 'assistant',
                  toolCall: {
                    id: data.toolUseId,
                    name: 'Tool Result',
                    input: {},
                    result: data.result,
                    status: 'success',
                  },
                  eventType: 'tool_result',
                  timestamp: new Date(),
                  raw: data,
                };
                setMessages(prev => [...prev, toolResultMessage]);
                setTimeout(() => scrollToBottom(), 0);
              }
              // Handle done and assistant events - capture metadata
              else if (data.type === 'done' || data.type === 'assistant') {
                // Capture metadata from the response
                if (data.model) {
                  responseMetadata.model = data.model;
                }
                if (data.usage || data.metadata?.usage) {
                  const usage = data.usage || data.metadata?.usage;
                  responseMetadata.inputTokens = usage.input_tokens;
                  responseMetadata.outputTokens = usage.output_tokens;
                }
                
                // Log assistant message to platform with metadata
                if (sessionId && contentAccumulator) {
                  await logMessage(sessionId, 'assistant', contentAccumulator, responseMetadata);
                }
                
                // Reset content accumulator for next response
                contentAccumulator = '';
                contentMessageId = null;
              }
              // Handle other events
              else if (data.type === 'error') {
                const errorMessage: Message = {
                  id: `error-${Date.now()}`,
                  role: 'assistant',
                  content: data.error || 'An error occurred',
                  eventType: 'error',
                  timestamp: new Date(),
                  raw: data,
                };
                setMessages(prev => [...prev, errorMessage]);
                setTimeout(() => scrollToBottom(), 0);
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e, line);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error:', error);
      // Create error message as unique event
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: error instanceof Error ? error.message : 'Sorry, I encountered an error. Please try again.',
        eventType: 'error',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const extractToolCalls = (response: any): ToolCall[] => {
    const toolCalls: ToolCall[] = [];
    if (response?.message?.content) {
      response.message.content.forEach((content: any) => {
        if (content.type === 'tool_use') {
          toolCalls.push({
            id: content.id,
            name: content.name,
            input: content.input,
            status: 'pending',
          });
        }
      });
    }
    return toolCalls;
  };

  const extractTodos = (response: any): TodoItem[] => {
    // Extract TODO items from the response
    const todos: TodoItem[] = [];
    const content = response?.content || response?.message?.content?.find((c: any) => c.type === 'text')?.text || '';
    const todoMatches = content.match(/TODO:\s*(.+)/gi);
    if (todoMatches) {
      todoMatches.forEach((match: string) => {
        const todoContent = match.replace(/TODO:\s*/i, '').trim();
        if (todoContent) {
          todos.push({
            id: Date.now().toString() + Math.random(),
            content: todoContent,
            status: 'pending',
          });
        }
      });
    }
    return todos;
  };

  const toggleTodo = (id: string) => {
    setTodos(prev => prev.map(todo => 
      todo.id === id 
        ? { ...todo, status: todo.status === 'pending' ? 'completed' : 'pending' }
        : todo
    ));
  };

  const deleteTodo = (id: string) => {
    setTodos(prev => prev.filter(todo => todo.id !== id));
  };

  const isDark = theme === 'dark';

  return (
    <div className={`flex h-screen relative ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Messages Area - scrollable */}
        <div className="flex-1 overflow-y-auto p-6 pb-32 relative">
          {/* Gradient fadeout at bottom - fades content under input */}
          <div className={`fixed bottom-0 left-0 right-0 h-40 pointer-events-none z-40 bg-gradient-to-t ${
            isDark ? 'from-gray-900 via-gray-900/80' : 'from-gray-50 via-gray-50/80'
          } to-transparent`} />
          <div className="max-w-4xl mx-auto px-4 space-y-6 relative z-10 min-h-full flex flex-col">
            {messages.length === 0 && agentConfig && (
              <div className="flex-1 flex items-center justify-center">
                <div className={`w-full max-w-2xl space-y-3 text-sm text-center ${
                  isDark ? 'text-gray-500' : 'text-gray-400'
                }`}>
                  <div>{agentConfig.name}</div>
                  <div>{agentConfig.model || 'Model not specified'}</div>
                  {(() => {
                    const toolsList: string[] = [];
                    if (agentConfig.webSearch) toolsList.push('Web Search');
                    if (agentConfig.tools?.filter((t: any) => t.enabled).length > 0) {
                      toolsList.push(...agentConfig.tools.filter((t: any) => t.enabled).map((t: any) => t.name));
                    }
                    if (agentConfig.mcps?.filter((mcp: any) => mcp.enabled).length > 0) {
                      toolsList.push(...agentConfig.mcps.filter((mcp: any) => mcp.enabled).map((mcp: any) => mcp.name));
                    }
                    return toolsList.length > 0 ? <div>{toolsList.join(', ')}</div> : null;
                  })()}
                  {agentConfig.rules && agentConfig.rules.length > 0 && (
                    <div>{agentConfig.rules.length} rule{agentConfig.rules.length !== 1 ? 's' : ''}</div>
                  )}
                </div>
              </div>
            )}

            {/* Show messages in order received - no sorting */}
            {messages.map((message, index) => {
              // Render plain text for regular content messages (no bubble)
              if (message.eventType === 'content_delta' && message.content && !message.toolCall && !message.thinking) {
                const isStreaming = isLoading && index === messages.length - 1;
                return (
                  <div key={message.id} className="max-w-4xl">
                    <div 
                      className={`text-base whitespace-pre-wrap inline-block max-w-full transition-all duration-75 ease-out ${
                        isDark ? 'text-gray-100' : 'text-gray-900'
                      }`}
                      style={{
                        width: 'fit-content',
                        maxWidth: '100%',
                      }}
                    >
                      {message.content}
                    </div>
                  </div>
                );
              }
              // Render bubbles for all other message types
              return (
                <MessageBubble
                  key={message.id}
                  message={message}
                  isLoading={isLoading && index === messages.length - 1}
                  theme={theme}
                />
              );
            })}
            
            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>

      {/* Todo List Sidebar */}
      {showTodos && (
        <div className={`w-80 border-l flex flex-col ${
          isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'
        }`}>
          <div className={`p-4 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
            <h2 className={`font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>Todo List</h2>
            <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {todos.filter(t => t.status === 'pending').length} pending
            </p>
          </div>
          <ScrollArea className="flex-1 p-4">
            {todos.length === 0 ? (
              <p className={`text-sm text-center mt-8 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                No todos yet. The agent will add tasks here as it works.
              </p>
            ) : (
              <div className="space-y-2">
                {todos.map((todo) => (
                  <Card key={todo.id} className={`p-3 ${
                    isDark ? 'bg-gray-700 border-gray-600' : ''
                  }`}>
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={todo.status === 'completed'}
                        onChange={() => toggleTodo(todo.id)}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <p className={`text-sm ${
                          todo.status === 'completed' 
                            ? `line-through ${isDark ? 'text-gray-500' : 'text-gray-400'}` 
                            : isDark ? 'text-gray-100' : 'text-gray-900'
                        }`}>
                          {todo.content}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteTodo(todo.id)}
                        className={`h-6 w-6 p-0 ${
                          isDark ? 'hover:bg-gray-600 text-gray-300' : ''
                        }`}
                      >
                        ×
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      )}

      {/* Input Area - Floating over content */}
      <div className="fixed bottom-0 left-0 right-0 z-50 pb-6 pt-4 pointer-events-none">
        <div className="max-w-4xl mx-auto px-4 pointer-events-auto">
          <div className="relative flex items-center">
              {/* Plus icon on left */}
              <button
                className={`absolute left-4 z-10 p-1.5 rounded-full transition-colors ${
                  isDark 
                    ? 'text-gray-300 hover:bg-gray-700' 
                    : 'text-black hover:bg-gray-100'
                }`}
                aria-label="Attach"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M10 4V16M4 10H16"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="Ask anything"
                disabled={isLoading}
                rows={1}
                className={`w-full resize-none rounded-full border-0 pl-12 pr-20 py-4 text-base shadow-md focus:outline-none focus:ring-0 placeholder:text-base leading-normal flex items-center ${
                  isDark
                    ? 'bg-gray-800 text-gray-100 placeholder:text-gray-500 disabled:bg-gray-700 disabled:text-gray-600'
                    : 'bg-white text-gray-900 placeholder:text-gray-400 disabled:bg-gray-50 disabled:text-gray-500'
                }`}
                style={{
                  minHeight: '56px',
                  maxHeight: '200px',
                  lineHeight: '1.5',
                }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
                }}
              />
              
              {/* Right side icons */}
              <div className="absolute right-4 flex items-center">
                {isLoading && (
                  <div className={`w-5 h-5 border-2 rounded-full animate-spin ${
                    isDark 
                      ? 'border-gray-600 border-t-gray-300' 
                      : 'border-gray-300 border-t-gray-600'
                  }`} />
                )}
                {!isLoading && (
                  <button
                    className={`p-1.5 rounded-full transition-colors ${
                      isDark 
                        ? 'text-gray-300 hover:bg-gray-700' 
                        : 'text-black hover:bg-gray-100'
                    }`}
                    aria-label="Voice input"
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 20 20"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M10 14C12.2091 14 14 12.2091 14 10V6C14 3.79086 12.2091 2 10 2C7.79086 2 6 3.79086 6 6V10C6 12.2091 7.79086 14 10 14Z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M10 14V17M6 17H14"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
    </div>
  );
}

function MessageBubble({ message, isLoading, theme }: { message: Message; isLoading: boolean; theme: 'light' | 'dark' }) {
  const [rawExpanded, setRawExpanded] = useState(false);
  const [toolExpanded, setToolExpanded] = useState(false); // Collapsed by default
  const isDark = theme === 'dark';
  
  // Don't show badge for user messages or accumulated content
  const showBadge = message.role !== 'user' && message.eventType !== 'content_delta';
  
  // Check if this is a tool-related message for subtle styling
  const isToolMessage = message.eventType === 'tool_call' || message.eventType === 'tool_result';
  
  return (
    <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-3xl w-full ${message.role === 'user' ? 'flex justify-end' : ''}`}>
        {isToolMessage ? (
          // Tool calls: single line, no shadow, subtle background
          <div className={`border rounded-lg shadow-none py-1.5 px-3 ${
            isDark 
              ? 'bg-gray-800/40 border-gray-700/60' 
              : 'bg-gray-50/40 border-gray-200/60'
          }`}>
            <button
              onClick={() => setToolExpanded(!toolExpanded)}
              className={`w-full flex items-center justify-between text-left rounded transition-colors -mx-1 px-1 py-0.5 ${
                isDark ? 'hover:bg-gray-700/30' : 'hover:bg-gray-100/30'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {message.eventType === 'tool_call' ? 'Tool' : 'Result'}
                </span>
                <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{message.toolCall?.name}</span>
              </div>
              <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {toolExpanded ? '▼' : '▶'}
              </span>
            </button>
            
            {/* Tool details - shown when expanded */}
            {toolExpanded && message.toolCall && (
              <div className={`space-y-2 pt-2 mt-1 border-t ${
                isDark ? 'border-gray-700/60' : 'border-gray-200/60'
              }`}>
                {message.toolCall.input && Object.keys(message.toolCall.input).length > 0 && (
                  <div>
                    <div className={`text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Input</div>
                    <pre className={`text-xs p-2 rounded border overflow-x-auto font-mono ${
                      isDark 
                        ? 'bg-gray-900/60 border-gray-700/60 text-gray-300' 
                        : 'bg-white/60 border-gray-200/60 text-gray-700'
                    }`}>
                      {JSON.stringify(message.toolCall.input, null, 2)}
                    </pre>
                  </div>
                )}
                {message.toolCall.result && (
                  <div>
                    <div className={`text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Result</div>
                    <pre className={`text-xs p-2 rounded border overflow-x-auto max-h-60 font-mono ${
                      isDark 
                        ? 'bg-gray-900/60 border-gray-700/60 text-gray-300' 
                        : 'bg-white/60 border-gray-200/60 text-gray-700'
                    }`}>
                      {typeof message.toolCall.result === 'string' 
                        ? message.toolCall.result 
                        : JSON.stringify(message.toolCall.result, null, 2)}
                    </pre>
                  </div>
                )}
                {message.raw && (
                  <div className={`pt-2 border-t ${isDark ? 'border-gray-700/60' : 'border-gray-200/60'}`}>
                    <button
                      onClick={() => setRawExpanded(!rawExpanded)}
                      className={`text-xs ${
                        isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'
                      }`}
                    >
                      {rawExpanded ? '▼' : '▶'} raw
                    </button>
                    {rawExpanded && (
                      <pre className={`text-xs p-2 rounded border overflow-x-auto max-h-60 font-mono mt-1 ${
                        isDark 
                          ? 'bg-gray-800/60 border-gray-700/60 text-gray-400' 
                          : 'bg-gray-50/60 border-gray-200/60 text-gray-600'
                      }`}>
                        {JSON.stringify(message.raw, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <Card className={`${
            message.role === 'user'
              ? isDark 
                ? 'bg-blue-600 text-white border-blue-600 p-4'
                : 'bg-black text-white border-black p-4'
              : message.eventType === 'thinking'
              ? isDark
                ? 'bg-purple-900/20 border-purple-700/40 p-3'
                : 'bg-purple-50/30 border-purple-200/40 p-3'
              : isDark
              ? 'bg-gray-800 text-gray-100 border-gray-700 p-4'
              : 'bg-white text-gray-900 border-gray-200 p-4'
          }`}>
            {/* Event Type Badge - for non-tool messages */}
            {showBadge && (
              <div className="mb-2 flex items-center justify-between">
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  message.eventType === 'thinking' 
                    ? isDark ? 'text-purple-400 bg-purple-900/30' : 'text-purple-600 bg-purple-50'
                  : message.eventType === 'error' 
                    ? isDark ? 'text-red-400 bg-red-900/30' : 'text-red-600 bg-red-50'
                    : isDark ? 'text-gray-400 bg-gray-700' : 'text-gray-500 bg-gray-100'
                }`}>
                  {message.eventType === 'thinking' ? 'Thinking' :
                   message.eventType.replace('_', ' ').toUpperCase()}
                </span>
                {message.raw && (
                  <button
                    onClick={() => setRawExpanded(!rawExpanded)}
                    className={`text-xs ml-2 ${
                      isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    {rawExpanded ? '▼' : '▶'} raw
                  </button>
                )}
              </div>
            )}
            
            {/* Content Display */}
            {message.thinking && (
              <div className={`text-sm whitespace-pre-wrap italic ${
                isDark ? 'text-purple-300/80' : 'text-purple-700/80'
              }`}>
                {message.thinking}
              </div>
            )}
            
            {message.content && (
              <div className={`text-base whitespace-pre-wrap ${
                message.role === 'user' 
                  ? 'text-white' 
                  : isDark ? 'text-gray-100' : 'text-gray-900'
              }`}>
                {message.content}
              </div>
            )}
            
            {/* Raw Event Data (expandable) */}
            {rawExpanded && message.raw && (
              <div className={`mt-3 pt-3 border-t ${
                isDark ? 'border-gray-700/60' : 'border-gray-200/60'
              }`}>
                <div className={`text-xs font-medium mb-2 ${
                  isDark ? 'text-gray-400' : 'text-gray-500'
                }`}>Raw Event Data</div>
                <pre className={`text-xs p-2 rounded border overflow-x-auto max-h-60 font-mono ${
                  isDark 
                    ? 'bg-gray-900/80 border-gray-700/60 text-gray-400' 
                    : 'bg-gray-50/80 border-gray-200/60 text-gray-600'
                }`}>
                  {JSON.stringify(message.raw, null, 2)}
                </pre>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

