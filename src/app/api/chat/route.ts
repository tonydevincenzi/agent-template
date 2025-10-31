import { NextRequest, NextResponse } from 'next/server';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { getAgentConfig } from '@/lib/config';
import type { SDKAssistantMessage } from '@anthropic-ai/claude-agent-sdk';

// Enable CORS for internal prototyping
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const config = await getAgentConfig();
    
    // Check if API key is available
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey.trim() === '') {
      console.error('ANTHROPIC_API_KEY is not set or is empty in environment variables');
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY is not configured. Please check environment variables.' },
        { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }
    
    // Parse request body
    const body = await request.json();
    
    // Support both formats: {"message": "..."} and {"messages": [...]}
    let messages: Array<{ role: string; content: string }>;
    if (body.messages && Array.isArray(body.messages)) {
      // Full conversation format
      messages = body.messages;
    } else if (body.message && typeof body.message === 'string') {
      // Simple format - convert to messages array
      messages = [{ role: 'user', content: body.message }];
    } else {
      return NextResponse.json(
        { error: 'Request must include either "message" (string) or "messages" (array) field' },
        { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }
    
    // Get the last user message (the current prompt)
    const lastUserMessage = messages
      .filter((msg) => msg.role === 'user')
      .pop();
    
    if (!lastUserMessage) {
      return NextResponse.json(
        { error: 'No user message found in request' },
        { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }
    
    // Build system prompt with rules
    let systemPrompt = config.agent.systemPrompt;
    if (config.agent.rules && config.agent.rules.length > 0) {
      systemPrompt += '\n\nRules:\n' + config.agent.rules.map(rule => `- ${rule}`).join('\n');
    }
    
    // Build conversation context from previous messages
    // For the Agent SDK, we'll include conversation history in the prompt
    let conversationContext = '';
    if (messages.length > 1) {
      const previousMessages = messages.slice(0, -1);
      conversationContext = previousMessages
        .map((msg) => {
          const role = msg.role === 'user' ? 'User' : 'Assistant';
          return `${role}: ${msg.content}`;
        })
        .join('\n\n') + '\n\n';
    }
    
    // Combine conversation context with the current user message
    const fullPrompt = conversationContext + `User: ${lastUserMessage.content}`;
    
    // Build allowed tools list
    const allowedTools: string[] = [];
    
    // Add custom tools from config
    if (config.services.tools && config.services.tools.length > 0) {
      const customTools = config.services.tools
        .filter(tool => tool.enabled)
        .map(tool => tool.name);
      allowedTools.push(...customTools);
    }
    
    // Build tools array for Agent SDK
    const tools: Array<{ type: string; name: string; max_uses?: number }> = [];
    
    // Add web search tool if enabled
    if (config.services.webSearch) {
      tools.push({
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 5, // Limit to 5 searches per request
      });
    }
    
    // Get model from config, fallback to Haiku
    const model = config.agent.model || 'claude-haiku-4-5-20251001';
    
    // Log configuration for debugging
    console.log(`[Agent Config] model: ${model}, webSearch: ${config.services.webSearch}, tools: ${tools.length}, allowedTools: ${allowedTools.join(', ')}`);
    
    // Configure Agent SDK options
    const options = {
      systemPrompt,
      // Model configuration - default is Claude Sonnet 4.5
      // Can be overridden via CLAUDE_MODEL environment variable
      // Common models: 'claude-sonnet-4-5-20250929', 'claude-opus-4-20250514', 'claude-haiku-4-5-20251001'
      // For Agent SDK, you can also use: 'sonnet', 'opus', 'haiku' as shortcuts
      model: model,
      // Enable streaming with partial messages - this is required for real-time streaming
      // See: https://docs.claude.com/en/api/agent-sdk/overview
      includePartialMessages: true,
      // Include web search tool in tools array if enabled
      tools: tools.length > 0 ? tools : undefined,
      // Set allowed tools only if we have custom tools AND web search is disabled
      // If web search is enabled, don't restrict allowedTools to allow built-in tools
      allowedTools: (!config.services.webSearch && allowedTools.length > 0) ? allowedTools : undefined,
      // Configure MCP servers if provided
      mcpServers: config.services.mcps && config.services.mcps.length > 0
        ? config.services.mcps
            .filter(mcp => mcp.enabled)
            .reduce((acc: Record<string, { type: 'http'; url: string }>, mcp) => {
              acc[mcp.name] = { type: 'http' as const, url: mcp.url };
              return acc;
            }, {})
        : undefined,
      // Set permission mode - use 'bypassPermissions' if web search is enabled to allow tool usage
      permissionMode: (config.services.webSearch ? 'bypassPermissions' : 'default') as 'bypassPermissions' | 'default',
      // Explicitly allow web search tool if enabled - handle all possible tool name variations
      canUseTool: config.services.webSearch
        ? async (toolName: string, input: unknown) => {
            console.log(`[canUseTool] Tool requested: ${toolName}`);
            // Allow web search tool variations when enabled
            const webSearchVariants = [
              'web_search',
              'web_search_20250305',
              'WebSearch',
              'webSearch',
              'web-search',
              'websearch'
            ];
            const normalizedToolName = toolName.toLowerCase().replace(/[-_]/g, '');
            const isWebSearch = webSearchVariants.some(variant => 
              variant.toLowerCase().replace(/[-_]/g, '') === normalizedToolName
            );
            
            if (isWebSearch) {
              console.log(`[canUseTool] Allowing web search tool: ${toolName}`);
              return { behavior: 'allow' as const, updatedInput: input as Record<string, unknown> };
            }
            // Allow other tools from config
            if (allowedTools.includes(toolName)) {
              console.log(`[canUseTool] Allowing configured tool: ${toolName}`);
              return { behavior: 'allow' as const, updatedInput: input as Record<string, unknown> };
            }
            // For bypassPermissions mode, allow all other tools too
            if (config.services.webSearch) {
              console.log(`[canUseTool] Allowing tool in bypassPermissions mode: ${toolName}`);
              return { behavior: 'allow' as const, updatedInput: input as Record<string, unknown> };
            }
            // Deny by default for unknown tools
            console.log(`[canUseTool] Denying unknown tool: ${toolName}`);
            return { behavior: 'deny' as const, message: `Tool ${toolName} is not permitted` };
          }
        : undefined,
    };
    
    // Create query with the full prompt
    const queryResult = query({
      prompt: fullPrompt,
      options,
    });
    
    // Create a readable stream for Server-Sent Events
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let assistantMessage = '';
        let thinking = '';
        // Store tool calls in chronological order - use array to maintain order
        const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown>; result?: unknown; status: string; timestamp: number }> = [];
        const toolCallsMap: Map<string, number> = new Map(); // Map tool ID to array index
        let finalMessage: SDKAssistantMessage | null = null;
        const usageMetadata: { input_tokens?: number; output_tokens?: number } = {};
        
        const sendChunk = (data: Record<string, unknown>) => {
          try {
            const chunk = encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
            controller.enqueue(chunk);
            // Force flush to ensure immediate delivery
          } catch (error) {
            console.error('Error sending chunk:', error);
          }
        };
        
        try {
          for await (const message of queryResult) {
            // Handle partial assistant messages (streaming) - this is the key for real-time streaming
            // With includePartialMessages: true, we get stream_event messages as they're generated
            if (message.type === 'stream_event') {
              const streamMsg = message as { event?: { type?: string; content_block?: { type?: string }; delta?: { type?: string; thinking?: string; text?: string; tool_use_id?: string; id?: string; name?: string; input?: unknown; usage?: { input_tokens?: number; output_tokens?: number } }; usage?: { input_tokens?: number; output_tokens?: number } } };
              const event = streamMsg.event;
              
              // According to SDK docs, events can be: content_block_delta, message_delta, etc.
              // See: https://docs.claude.com/en/api/agent-sdk/overview
              
              // Handle content_block_start - check if it's a thinking block
              if (event?.type === 'content_block_start') {
                const block = event.content_block;
                if (block?.type === 'thinking') {
                  // Reset thinking when a new thinking block starts
                  thinking = '';
                  console.log('[Stream] Thinking block started');
                }
              }
              
              // Handle content_block_delta - this is the ONLY place we process text/thinking/tool deltas
              // Processing it multiple times causes duplicates
              if (event?.type === 'content_block_delta' && event.delta) {
                const delta = event.delta;
                
                // Extract thinking deltas FIRST - these come before text in extended thinking models
                if (delta?.type === 'thinking_delta' && delta.thinking) {
                  thinking += delta.thinking;
                  // Send thinking tokens immediately for real-time streaming
                  sendChunk({
                    type: 'thinking',
                    content: thinking,
                  });
                }
                
                // Extract text deltas - these come character by character or token by token
                if (delta?.type === 'text_delta' && delta.text) {
                  assistantMessage += delta.text;
                  // Send ONLY the delta, not the full accumulated content
                  sendChunk({
                    type: 'content_delta',
                    delta: delta.text, // Only send the new chunk
                  });
                }
                
                // Handle tool_use_delta - maintain chronological order
                if (delta.type === 'tool_use_delta' || delta.tool_use_id) {
                  const toolId = delta.tool_use_id || delta.id;
                  if (toolId) {
                    const existingIndex = toolCallsMap.get(toolId);
                    let toolCall: { id: string; name: string; input: Record<string, unknown>; status: string; timestamp: number };
                    
                    if (existingIndex !== undefined) {
                      // Update existing tool call
                      toolCall = toolCalls[existingIndex];
                      if (delta.name) toolCall.name = delta.name;
                      if (delta.input) {
                        toolCall.input = { ...toolCall.input, ...(delta.input as Record<string, unknown>) };
                      }
                    } else {
                      // Create new tool call and add to timeline in chronological order
                      toolCall = {
                        id: toolId,
                        name: delta.name || '',
                        input: (delta.input as Record<string, unknown>) || ({} as Record<string, unknown>),
                        status: 'pending',
                        timestamp: Date.now(),
                      };
                      const index = toolCalls.length;
                      toolCalls.push(toolCall);
                      toolCallsMap.set(toolId, index);
                    }
                    
                    // Send all tool calls in chronological order
                    console.log(`[API] Sending tool_call event with ${toolCalls.length} tool calls:`, toolCalls.map(tc => ({ id: tc.id, name: tc.name })));
                    sendChunk({
                      type: 'tool_call',
                      toolCalls: [...toolCalls], // Send copy to maintain order
                    });
                  }
                }
              }
              
              // Handle message_delta events (metadata updates only - NOT text content)
              // Text content comes via content_block_delta above, processing here causes duplicates
              if (event?.type === 'message_delta' && event.delta) {
                // Capture usage metadata if available
                if (event.delta.usage || event.usage) {
                  const usage = event.delta.usage || event.usage;
                  if (usage && usage.input_tokens !== undefined) {
                    usageMetadata.input_tokens = usage.input_tokens;
                  }
                  if (usage && usage.output_tokens !== undefined) {
                    usageMetadata.output_tokens = usage.output_tokens;
                  }
                }
              }
            }
            
            // Handle system messages that might contain model info
            if (message.type === 'system') {
              const systemMsg = message as { model?: string };
              if (systemMsg.model) {
                console.log(`[Agent] Model from system message: ${systemMsg.model}`);
              }
            }
            
            // Handle final assistant message
            if (message.type === 'assistant') {
              finalMessage = message as SDKAssistantMessage;
              
              // Extract model info if available
              const modelInfo = (finalMessage as { model?: string }).model || model || 'default';
              console.log(`[Agent] Using model: ${modelInfo}`);
              
              // Extract usage information from final message
              const messageUsage = (finalMessage as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
              if (messageUsage) {
                if (messageUsage.input_tokens !== undefined) {
                  usageMetadata.input_tokens = messageUsage.input_tokens;
                }
                if (messageUsage.output_tokens !== undefined) {
                  usageMetadata.output_tokens = messageUsage.output_tokens;
                }
              }
              
              // Extract text content
              if (finalMessage.message?.content && Array.isArray(finalMessage.message.content)) {
                const textParts = finalMessage.message.content
                  .filter((part: { type?: string }) => part.type === 'text')
                  .map((part) => (part as { text?: string }).text || '');
                assistantMessage = textParts.join('');
                
                // Extract tool calls from final message - merge with existing tool calls in order
                let hasNewToolCalls = false;
                finalMessage.message.content.forEach((part: { type?: string; id?: string; name?: string; input?: unknown }) => {
                  if (part.type === 'tool_use' && part.id) {
                    const toolId = part.id;
                    const existingIndex = toolCallsMap.get(toolId);
                    
                    if (existingIndex === undefined) {
                      // New tool call - add to timeline
                      const toolCall = {
                        id: toolId,
                        name: part.name || '',
                        input: (part.input as Record<string, unknown>) || ({} as Record<string, unknown>),
                        status: 'pending' as const,
                        timestamp: Date.now(),
                      };
                      const index = toolCalls.length;
                      toolCalls.push(toolCall);
                      toolCallsMap.set(toolId, index);
                      hasNewToolCalls = true;
                      console.log(`[API] Found new tool call in final message: ${toolId} (${part.name})`);
                    } else {
                      // Update existing tool call
                      const toolCall = toolCalls[existingIndex];
                      if (part.name) toolCall.name = part.name;
                      if (part.input) toolCall.input = part.input as Record<string, unknown>;
                    }
                  }
                });
                
                // If we found new tool calls in the final message, send them as separate events
                if (hasNewToolCalls && toolCalls.length > 0) {
                  console.log(`[API] Sending tool_call event from final message with ${toolCalls.length} tool calls`);
                  sendChunk({
                    type: 'tool_call',
                    toolCalls: [...toolCalls], // Send copy to maintain order
                  });
                }
                
                // Send final assistant message - but don't duplicate content that was already streamed
                // Only send if there's new content not already sent as deltas
                if (assistantMessage) {
                  sendChunk({
                    type: 'assistant',
                    content: assistantMessage, // Final complete content
                    thinking: thinking || undefined,
                    toolCalls: toolCalls.length > 0 ? [...toolCalls] : undefined,
                    model: modelInfo,
                    usage: Object.keys(usageMetadata).length > 0 ? usageMetadata : undefined,
                  });
                }
              }
            }
            
            // Handle tool results - update existing tool calls, don't remove them
            if (message.type === 'result') {
              const resultMsg = message as { tool_use_id?: string; content?: unknown; subtype?: string };
              if (resultMsg.tool_use_id) {
                const toolId = resultMsg.tool_use_id;
                const existingIndex = toolCallsMap.get(toolId);
                
                if (existingIndex !== undefined) {
                  // Update existing tool call with result
                  const toolCall = toolCalls[existingIndex];
                  toolCall.result = resultMsg.content;
                  toolCall.status = resultMsg.subtype === 'success' ? 'success' : 'error';
                  
                  // Send updated tool calls in chronological order
                  const contentPreview = typeof resultMsg.content === 'string' ? resultMsg.content.substring(0, 100) : JSON.stringify(resultMsg.content).substring(0, 100);
                  console.log(`[API] Sending tool_result event for tool ${toolId}:`, contentPreview);
                  sendChunk({
                    type: 'tool_result',
                    toolUseId: toolId,
                    result: resultMsg.content,
                    toolCalls: [...toolCalls], // Send all tool calls in order
                  });
                }
              }
            }
          }
          
          // Send final message with all tool calls in chronological order
          sendChunk({
            type: 'done',
            content: assistantMessage,
            thinking: thinking || undefined,
            toolCalls: toolCalls.length > 0 ? [...toolCalls] : undefined,
            model: model,
            usage: Object.keys(usageMetadata).length > 0 ? usageMetadata : undefined,
          });
          
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to process request';
          sendChunk({
            type: 'error',
            error: errorMessage,
          });
        } finally {
          controller.close();
        }
      },
    });
    
    // Return streaming response with CORS headers
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error in chat API:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to process request';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }
}

