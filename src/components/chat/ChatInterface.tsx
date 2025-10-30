'use client';

import { useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(data => {
        setAgentConfig(data);
        if (data.uiCustomization?.todoListVisible !== undefined) {
          setShowTodos(data.uiCustomization.todoListVisible);
        }
      })
      .catch(console.error);
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
    setInput('');
    setIsLoading(true);

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
              // Skip done and assistant events - they duplicate accumulated content
              else if (data.type === 'done' || data.type === 'assistant') {
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

  return (
    <div className="flex h-screen bg-gray-50 relative">
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Messages Area - scrollable */}
        <div className="flex-1 overflow-y-auto p-6 pb-32 relative">
          {/* Gradient fadeout at bottom - fades content under input */}
          <div className="fixed bottom-0 left-0 right-0 h-40 pointer-events-none z-40 bg-gradient-to-t from-gray-50 via-gray-50/80 to-transparent" />
          <div className="max-w-4xl mx-auto px-4 space-y-6 relative z-10 min-h-full flex flex-col">
            {messages.length === 0 && agentConfig && (
              <div className="flex-1 flex items-center justify-center">
                <div className="w-full max-w-2xl space-y-3 text-gray-400 text-sm text-center">
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
                return (
                  <div key={message.id} className="max-w-4xl mx-auto">
                    <div className="text-base text-gray-900 whitespace-pre-wrap">
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
                />
              );
            })}
            
            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>

      {/* Todo List Sidebar */}
      {showTodos && (
        <div className="w-80 border-l border-gray-200 bg-white flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Todo List</h2>
            <p className="text-sm text-gray-500 mt-1">
              {todos.filter(t => t.status === 'pending').length} pending
            </p>
          </div>
          <ScrollArea className="flex-1 p-4">
            {todos.length === 0 ? (
              <p className="text-sm text-gray-500 text-center mt-8">
                No todos yet. The agent will add tasks here as it works.
              </p>
            ) : (
              <div className="space-y-2">
                {todos.map((todo) => (
                  <Card key={todo.id} className="p-3">
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
                            ? 'line-through text-gray-400' 
                            : 'text-gray-900'
                        }`}>
                          {todo.content}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteTodo(todo.id)}
                        className="h-6 w-6 p-0"
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
                className="absolute left-4 z-10 p-1.5 text-black hover:bg-gray-100 rounded-full transition-colors"
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
                className="w-full resize-none rounded-full border-0 bg-white pl-12 pr-20 py-4 text-base shadow-md focus:outline-none focus:ring-0 disabled:bg-gray-50 disabled:text-gray-500 placeholder:text-gray-400 placeholder:text-base leading-normal flex items-center"
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
                  <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                )}
                {!isLoading && (
                  <button
                    className="p-1.5 text-black hover:bg-gray-100 rounded-full transition-colors"
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

function MessageBubble({ message, isLoading }: { message: Message; isLoading: boolean }) {
  const [expanded, setExpanded] = useState(false);
  
  // Don't show badge for user messages or accumulated content
  const showBadge = message.role !== 'user' && message.eventType !== 'content_delta';
  
  return (
    <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-3xl w-full ${message.role === 'user' ? 'flex justify-end' : ''}`}>
        <Card className={`p-4 ${
          message.role === 'user'
            ? 'bg-black text-white border-black'
            : message.eventType === 'tool_call'
            ? 'bg-orange-50 border-orange-200'
            : message.eventType === 'tool_result'
            ? 'bg-cyan-50 border-cyan-200'
            : message.eventType === 'thinking'
            ? 'bg-purple-50 border-purple-200'
            : 'bg-white text-gray-900 border-gray-200'
        }`}>
          {/* Event Type Badge - only for special events */}
          {showBadge && (
            <div className="mb-2 flex items-center justify-between">
              <span className={`text-xs font-bold px-2 py-1 rounded ${
                message.eventType === 'thinking' ? 'bg-purple-200 text-purple-900' :
                message.eventType === 'tool_call' ? 'bg-orange-200 text-orange-900' :
                message.eventType === 'tool_result' ? 'bg-cyan-200 text-cyan-900' :
                message.eventType === 'error' ? 'bg-red-200 text-red-900' :
                'bg-gray-200 text-gray-700'
              }`}>
                {message.eventType === 'tool_call' ? '🔧 Tool Call' :
                 message.eventType === 'tool_result' ? '✅ Tool Result' :
                 message.eventType === 'thinking' ? '💭 Thinking' :
                 message.eventType.replace('_', ' ').toUpperCase()}
              </span>
              {message.raw && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="text-xs text-gray-500 hover:text-gray-700 ml-2"
                >
                  {expanded ? '▼' : '▶'} raw
                </button>
              )}
            </div>
          )}
          
          {/* Content Display */}
          {message.thinking && (
            <div className="text-sm text-purple-900 whitespace-pre-wrap italic">
              {message.thinking}
            </div>
          )}
          
          {message.content && (
            <div className={`text-sm whitespace-pre-wrap ${
              message.role === 'user' ? 'text-white' : 'text-gray-900'
            }`}>
              {message.content}
            </div>
          )}
          
          {message.toolCall && (
            <div className="space-y-3">
              <div className="text-sm font-semibold">{message.toolCall.name}</div>
              {message.toolCall.input && Object.keys(message.toolCall.input).length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-gray-600 mb-1">Input:</div>
                  <pre className="text-xs bg-white p-3 rounded border overflow-x-auto">
                    {JSON.stringify(message.toolCall.input, null, 2)}
                  </pre>
                </div>
              )}
              {message.toolCall.result && (
                <div>
                  <div className="text-xs font-semibold text-gray-600 mb-1">Result:</div>
                  <pre className="text-xs bg-white p-3 rounded border overflow-x-auto max-h-60">
                    {typeof message.toolCall.result === 'string' 
                      ? message.toolCall.result 
                      : JSON.stringify(message.toolCall.result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
          
          {/* Raw Event Data (expandable) */}
          {expanded && message.raw && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <div className="text-xs font-semibold text-gray-600 mb-2">Raw Event Data:</div>
              <pre className="text-xs bg-gray-50 p-3 rounded border overflow-x-auto max-h-60 font-mono">
                {JSON.stringify(message.raw, null, 2)}
              </pre>
            </div>
          )}
          
        </Card>
      </div>
    </div>
  );
}

