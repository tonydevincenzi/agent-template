'use client';

import { useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content?: string;
  toolCall?: ToolCall; // Single tool call per message (for timeline)
  thinking?: string;
  eventType: 'message' | 'thinking' | 'tool_call' | 'tool_result' | 'content';
  timestamp: Date;
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
  const [agentName, setAgentName] = useState('AI Agent');
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [showTodos, setShowTodos] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(data => {
        setAgentName(data.name);
        if (data.uiCustomization?.todoListVisible !== undefined) {
          setShowTodos(data.uiCustomization.todoListVisible);
        }
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input,
      eventType: 'message',
      timestamp: new Date(),
    };
    
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Create a single assistant message that will accumulate streaming content
    // Store start time in a variable accessible to the stream handler
    const assistantMessageStartTime = Date.now();
    const assistantMessageId = `assistant-${assistantMessageStartTime}`;
    const initialAssistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      eventType: 'message',
      timestamp: new Date(assistantMessageStartTime),
    };
    setMessages(prev => [...prev, initialAssistantMessage]);

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
              
              if (data.type === 'thinking') {
                // Update the assistant message with thinking tokens
                setMessages(prev => prev.map(msg => {
                  if (msg.id === assistantMessageId) {
                    return { ...msg, thinking: data.content };
                  }
                  return msg;
                }));
                setTimeout(() => scrollToBottom(), 0);
              } else if (data.type === 'content' || data.type === 'content_delta') {
                // Accumulate streaming content into the single assistant message
                setMessages(prev => prev.map(msg => {
                  if (msg.id === assistantMessageId) {
                    const newDelta = data.delta || data.content || '';
                    return { ...msg, content: (msg.content || '') + newDelta };
                  }
                  return msg;
                }));
                setTimeout(() => scrollToBottom(), 0);
              } else if (data.type === 'tool_call') {
                // Create separate messages for each NEW tool call - BE VERBOSE
                console.log('[Frontend] Received tool_call event:', data.toolCalls);
                if (data.toolCalls && Array.isArray(data.toolCalls)) {
                  setMessages(prev => {
                    // Track existing tool call IDs to avoid duplicates
                    const existingToolCallIds = new Set(
                      prev
                        .filter(m => m.toolCall)
                        .map(m => m.toolCall!.id)
                    );
                    
                    console.log('[Frontend] Existing tool call IDs:', Array.from(existingToolCallIds));
                    
                    // Create new messages for tool calls that don't exist yet
                    // Tool calls happen DURING streaming, so timestamp them appropriately
                    const newToolCallMessages: Message[] = [];
                    // Find the assistant message to get its timestamp
                    const assistantMsg = prev.find(m => m.id === assistantMessageId);
                    const assistantStartTime = assistantMsg ? assistantMsg.timestamp.getTime() : assistantMessageStartTime;
                    const now = Date.now();
                    // Tool calls arrive during streaming - timestamp them at a point DURING the response
                    // Use a time that's after assistant started but reflects they happen mid-stream
                    // If tool call arrives very early (< 1s after start), place it early in the timeline
                    // Otherwise, place it at assistantStartTime + 500ms (during early streaming)
                    const timeSinceStart = now - assistantStartTime;
                    const toolCallBaseTime = timeSinceStart < 1000 
                      ? assistantStartTime + 300 + (timeSinceStart / 2) // Early arrival: place early in timeline
                      : assistantStartTime + 500; // Late arrival: backdate to early in timeline
                    let toolCallCounter = 0;
                    data.toolCalls.forEach((tc: any) => {
                      console.log(`[Frontend] Processing tool call: ${tc.id} (${tc.name}), exists: ${existingToolCallIds.has(tc.id)}`);
                      if (!existingToolCallIds.has(tc.id)) {
                        // Timestamp tool calls sequentially during early streaming phase
                        const toolCallTimestamp = toolCallBaseTime + (toolCallCounter * 100);
                        const toolCallMsg: Message = {
                          id: `tool-${tc.id}-${Date.now()}`,
                          role: 'assistant',
                          toolCall: {
                            id: tc.id,
                            name: tc.name,
                            input: tc.input,
                            result: tc.result,
                            status: tc.status || 'pending',
                            timestamp: toolCallTimestamp,
                          },
                          eventType: 'tool_call',
                          timestamp: new Date(toolCallTimestamp),
                        };
                        console.log('[Frontend] Creating tool call message:', toolCallMsg, 'timestamp:', toolCallTimestamp, 'assistant start:', assistantStartTime, 'time since start:', timeSinceStart);
                        newToolCallMessages.push(toolCallMsg);
                        toolCallCounter++;
                      }
                    });
                    
                    console.log(`[Frontend] Creating ${newToolCallMessages.length} new tool call messages`);
                    return [...prev, ...newToolCallMessages];
                  });
                }
                setTimeout(() => scrollToBottom(), 0);
              } else if (data.type === 'tool_result') {
                // Create separate message for tool result - BE VERBOSE
                console.log('[Frontend] Received tool_result event:', data.toolUseId, data.result);
                setMessages(prev => {
                  // Find the original tool call message to get its details
                  const originalToolCallMsg = prev.find(m => 
                    m.toolCall && m.toolCall.id === data.toolUseId
                  );
                  
                  console.log('[Frontend] Found original tool call message:', originalToolCallMsg);
                  
                  // Check if result message already exists
                  const resultExists = prev.some(m => 
                    m.toolCall && m.toolCall.id === data.toolUseId && m.eventType === 'tool_result'
                  );
                  
                  console.log('[Frontend] Result already exists:', resultExists);
                  
                  if (!resultExists && originalToolCallMsg?.toolCall) {
                    // Tool result should come AFTER the tool call
                    const toolCallTimestamp = originalToolCallMsg.timestamp.getTime();
                    const resultTimestamp = toolCallTimestamp + 500; // 500ms after tool call
                    const resultMessage: Message = {
                      id: `result-${data.toolUseId}-${Date.now()}`,
                      role: 'assistant',
                      toolCall: {
                        id: data.toolUseId,
                        name: originalToolCallMsg.toolCall.name,
                        input: originalToolCallMsg.toolCall.input,
                        result: data.result,
                        status: 'success',
                        timestamp: resultTimestamp,
                      },
                      eventType: 'tool_result',
                      timestamp: new Date(resultTimestamp),
                    };
                    console.log('[Frontend] Creating tool result message:', resultMessage, 'timestamp:', resultTimestamp);
                    return [...prev, resultMessage];
                  }
                  return prev;
                });
                setTimeout(() => scrollToBottom(), 0);
              } else if (data.type === 'assistant' || data.type === 'done') {
                // Final update to the assistant message
                // Also check if there are tool calls in the final message that weren't sent as separate events
                setMessages(prev => {
                  const assistantMsg = prev.find(m => m.id === assistantMessageId);
                  const updatedMessages = prev.map(msg => {
                    if (msg.id === assistantMessageId) {
                      return {
                        ...msg,
                        content: data.content || msg.content,
                        thinking: data.thinking || msg.thinking,
                        toolCalls: data.toolCalls || msg.toolCalls,
                      };
                    }
                    return msg;
                  });
                  
                  // If final message has tool calls that weren't created as separate messages, create them now
                  // with timestamps BEFORE the final content (backdate to when assistant started)
                  if (data.toolCalls && Array.isArray(data.toolCalls) && assistantMsg) {
                    const existingToolCallIds = new Set(
                      updatedMessages
                        .filter(m => m.toolCall)
                        .map(m => m.toolCall!.id)
                    );
                    
                    const assistantStartTime = assistantMsg.timestamp.getTime();
                    const newToolCallMessages: Message[] = [];
                    let toolCallCounter = 0;
                    
                    data.toolCalls.forEach((tc: any) => {
                      if (!existingToolCallIds.has(tc.id)) {
                        // Backdate tool call to happen DURING streaming, not at the end
                        // Place it 500ms after assistant started (during early streaming)
                        const toolCallTimestamp = assistantStartTime + 500 + (toolCallCounter * 100);
                        newToolCallMessages.push({
                          id: `tool-${tc.id}-${Date.now()}`,
                          role: 'assistant',
                          toolCall: {
                            id: tc.id,
                            name: tc.name,
                            input: tc.input,
                            result: tc.result,
                            status: tc.status || 'pending',
                            timestamp: toolCallTimestamp,
                          },
                          eventType: 'tool_call',
                          timestamp: new Date(toolCallTimestamp),
                        });
                        toolCallCounter++;
                      }
                    });
                    
                    if (newToolCallMessages.length > 0) {
                      console.log(`[Frontend] Creating ${newToolCallMessages.length} tool call messages from final message`);
                      return [...updatedMessages, ...newToolCallMessages];
                    }
                  }
                  
                  return updatedMessages;
                });
                
                // Extract todos from final content if present
                if (data.content) {
                  const extractedTodos = extractTodos({ content: data.content });
                  if (extractedTodos.length > 0) {
                    setTodos(prev => {
                      const newTodos = extractedTodos.filter(
                        todo => !prev.find(t => t.content === todo.content)
                      );
                      return [...prev, ...newTodos];
                    });
                  }
                }
              } else if (data.type === 'error') {
                throw new Error(data.error);
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
            eventType: 'message',
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
    <div className="flex h-screen bg-gray-50">
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="border-b border-gray-200 bg-white px-6 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold text-gray-900">{agentName}</h1>
            {showTodos && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowTodos(!showTodos)}
                className="text-sm"
              >
                {showTodos ? 'Hide' : 'Show'} Todos ({todos.filter(t => t.status === 'pending').length})
              </Button>
            )}
          </div>
        </header>

        {/* Messages Area */}
        <ScrollArea className="flex-1 p-6">
          <div className="max-w-4xl mx-auto space-y-6">
            {messages.length === 0 && (
              <div className="text-center text-gray-500 mt-12">
                <p className="text-lg mb-2">Start a conversation</p>
                <p className="text-sm">Ask me anything, and I'll help you!</p>
              </div>
            )}

            {/* Sort messages by timestamp to ensure chronological order */}
            {[...messages]
              .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
              .map((message, index) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  isLoading={isLoading && message.id === messages[messages.length - 1]?.id}
                />
              ))}
            
            {/* Debug: Show all message IDs and types */}
            {process.env.NODE_ENV === 'development' && (
              <div className="mt-4 p-2 bg-gray-100 rounded text-xs">
                <div className="font-semibold mb-1">Debug: Messages ({messages.length})</div>
                {[...messages]
                  .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
                  .map((msg, idx) => (
                    <div key={msg.id} className="text-xs">
                      {idx + 1}. {msg.eventType} @ {msg.timestamp.toISOString()} - {msg.toolCall ? `Tool: ${msg.toolCall.name}` : msg.content ? `Content: ${msg.content.substring(0, 30)}...` : 'Empty'}
                    </div>
                  ))}
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="border-t border-gray-200 bg-white p-4">
          <div className="max-w-4xl mx-auto">
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                placeholder="Type your message..."
                disabled={isLoading}
                className="flex-1"
              />
              <Button
                onClick={sendMessage}
                disabled={isLoading || !input.trim()}
              >
                {isLoading ? 'Sending...' : 'Send'}
              </Button>
            </div>
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
    </div>
  );
}

function MessageBubble({ message, isLoading }: { message: Message; isLoading: boolean }) {
  const [expandedToolCalls, setExpandedToolCalls] = useState<Set<string>>(new Set());

  const toggleToolCall = (id: string) => {
    setExpandedToolCalls(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Always show tool call messages, even if empty
  const isEmpty = !message.content && !message.thinking && !message.toolCall;
  const isToolMessage = message.toolCall !== undefined;
  
  return (
    <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-3xl w-full ${message.role === 'user' ? 'flex justify-end' : ''}`}>
        <Card className={`p-4 ${
          message.role === 'user'
            ? 'bg-black text-white border-black'
            : isToolMessage
            ? 'bg-purple-50 border-purple-200' // Highlight tool messages
            : 'bg-white text-gray-900'
        }`}>
          {/* Thinking indicator */}
          {message.thinking && (
            <div className="mb-3 p-3 bg-blue-50 dark:bg-blue-950 rounded-lg text-xs text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800">
              <div className="flex items-start gap-2">
                <span className="font-semibold text-blue-900 dark:text-blue-100">💭 Thinking:</span>
                <div className="flex-1 whitespace-pre-wrap font-mono">{message.thinking}</div>
              </div>
            </div>
          )}

          {/* Event type indicator - show what type of event this is */}
          {message.eventType && message.eventType !== 'message' && (
            <div className="mb-2">
              <span className={`text-xs font-semibold px-2 py-1 rounded ${
                message.eventType === 'tool_call' ? 'bg-purple-100 text-purple-800' :
                message.eventType === 'tool_result' ? 'bg-green-100 text-green-800' :
                message.eventType === 'thinking' ? 'bg-blue-100 text-blue-800' :
                message.eventType === 'content' ? 'bg-gray-100 text-gray-800' :
                'bg-gray-100 text-gray-800'
              }`}>
                {message.eventType === 'tool_call' ? '🔧 TOOL CALL' :
                 message.eventType === 'tool_result' ? '✅ TOOL RESULT' :
                 message.eventType === 'thinking' ? '💭 THINKING' :
                 message.eventType === 'content' ? '📝 CONTENT' :
                 message.eventType.toUpperCase()}
              </span>
            </div>
          )}

          {/* Message content */}
          <div className="prose prose-sm max-w-none">
            {message.content ? (
              <div className={`whitespace-pre-wrap ${
                message.role === 'user' ? 'text-white' : 'text-gray-900'
              }`}>
                {message.content}
              </div>
            ) : isLoading && !message.toolCall ? (
              <div className="flex gap-2 items-center">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200" />
                <span className="text-sm text-gray-500 ml-2">Thinking...</span>
              </div>
            ) : message.toolCall ? (
              // Tool call messages don't need content - they show the tool call itself
              null
            ) : (
              // Empty message - show event type
              <div className="text-sm text-gray-500 italic">
                {message.eventType === 'tool_call' ? 'Tool call event' :
                 message.eventType === 'tool_result' ? 'Tool result event' :
                 message.eventType === 'thinking' ? 'Thinking event' :
                 'Empty message'}
              </div>
            )}
          </div>

          {/* Tool call - single tool call per message (timeline event) - ALWAYS SHOW PROMINENTLY */}
          {message.toolCall && (
            <div className={`space-y-2 ${message.content || message.thinking ? 'mt-4 border-t pt-3' : ''}`}>
              <div className={`p-3 rounded-lg border-2 ${
                message.eventType === 'tool_result' 
                  ? 'bg-green-50 border-green-300' 
                  : 'bg-purple-50 border-purple-300'
              }`}>
                <p className={`text-sm font-bold mb-3 flex items-center gap-2 ${
                  message.role === 'user' ? 'text-gray-300' : message.eventType === 'tool_result' ? 'text-green-900' : 'text-purple-900'
                }`}>
                  <span className="text-lg">{message.eventType === 'tool_result' ? '✅' : '🔧'}</span>
                  <span>{message.eventType === 'tool_result' ? 'TOOL RESULT' : 'TOOL CALL'}</span>
                  <span className="text-xs font-normal opacity-75">({message.toolCall.name || 'Unknown Tool'})</span>
                </p>
                <div
                  className={`text-xs rounded-lg p-3 border ${
                    message.role === 'user'
                      ? 'bg-gray-900 text-gray-200 border-gray-700'
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700'
                  }`}
                >
                <button
                  onClick={() => toggleToolCall(message.toolCall!.id)}
                  className="flex items-center justify-between w-full font-semibold hover:opacity-80 transition-opacity"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-base">⚙️</span>
                    <span>{message.toolCall.name || 'Unknown Tool'}</span>
                  </span>
                  <span className="text-lg">{expandedToolCalls.has(message.toolCall.id) ? '−' : '+'}</span>
                </button>
                {expandedToolCalls.has(message.toolCall.id) && (
                  <div className="mt-3 pt-3 border-t border-gray-300 dark:border-gray-700 space-y-3">
                    {message.toolCall.input && Object.keys(message.toolCall.input).length > 0 && (
                      <div>
                        <span className="font-semibold text-gray-600 dark:text-gray-400">Input:</span>
                        <pre className="mt-1 text-xs overflow-x-auto p-2 bg-gray-100 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                          {JSON.stringify(message.toolCall.input, null, 2)}
                        </pre>
                      </div>
                    )}
                    {message.toolCall.result !== undefined && (
                      <div>
                        <span className="font-semibold text-gray-600 dark:text-gray-400">Result:</span>
                        <pre className="mt-1 text-xs overflow-x-auto p-2 bg-gray-100 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                          {typeof message.toolCall.result === 'string'
                            ? message.toolCall.result
                            : JSON.stringify(message.toolCall.result, null, 2)}
                        </pre>
                      </div>
                    )}
                    <div className={`text-xs font-medium ${
                      message.toolCall.status === 'success' ? 'text-green-600 dark:text-green-400' :
                      message.toolCall.status === 'error' ? 'text-red-600 dark:text-red-400' :
                      'text-yellow-600 dark:text-yellow-400'
                    }`}>
                      Status: <span className="uppercase">{message.toolCall.status || 'pending'}</span>
                    </div>
                  </div>
                )}
                </div>
              </div>
            </div>
          )}

        </Card>
      </div>
    </div>
  );
}

